"""Retrains the ML model on everything known so far and writes its
predictions for the app. Run daily by .github/workflows/ml-retrain.yml.

Writes, in public/ml/:
  predictions.json          the gameweek being planned: { season, gwId,
                            builtAt, trainedRows, byId: { id: [points for
                            that gameweek and each of the next four] } }
  predictions-gw<N>.json    the same, kept per gameweek, so a past
                            gameweek can be shown with what was predicted
                            before its deadline
  history.json              how each finished gameweek's predictions did,
                            appended once that gameweek is over: the model
                            "learning" week by week

Usage: python scripts/ml/retrain.py [--cache DIR] [--out DIR]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F  # noqa: E402
import fpl_data  # noqa: E402
import matchdata as MD  # noqa: E402
import model as ML  # noqa: E402

INJURIES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'injuries.csv')
US_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'understat')


def save_snapshot(cache, current, target, folder=F.SNAPSHOTS):
    """FPL's figures right now (forecast, chance of playing, penalty order)
    as the snapshot at gameweek `target`'s deadline, kept in
    data/fpl-snapshots/<season>.csv (the workflow commits it), so FPL's
    own deadline data builds up for the model season by season."""
    import pandas as pd
    players = pd.read_csv(os.path.join(cache, current, 'players_raw.csv'))
    if 'ep_next' not in players.columns or not target:
        return
    num = lambda c: pd.to_numeric(players[c], errors='coerce') if c in players.columns else float('nan')
    now = pd.DataFrame({'id': players.id.astype(int), 'gw': int(target) - 1, 'ep_next': num('ep_next'),
                        'chance_next': num('chance_of_playing_next_round'), 'status': players.status.astype(str),
                        'penalties_order': num('penalties_order')})
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f'{current}.csv')
    old = pd.read_csv(path) if os.path.exists(path) else now.iloc[:0]
    old = old[old.gw != int(target) - 1]
    pd.concat([old, now]).sort_values(['gw', 'id']).to_csv(path, index=False, float_format='%.2f')


def load_injuries(cache, current, today):
    """Injury history (data/injuries.csv, from Transfermarkt) plus whoever
    FPL flags as injured right now, from the date the news was added, for
    the weeks since that file was made."""
    import pandas as pd
    inj = pd.read_csv(INJURIES) if os.path.exists(INJURIES) else pd.DataFrame(columns=['code', 'from_date', 'end_date'])
    players = pd.read_csv(os.path.join(cache, current, 'players_raw.csv'))
    if 'status' not in players.columns:
        return inj
    ongoing = set(inj[inj.end_date.isna() | (inj.end_date.astype(str) >= today)].code.astype(int))
    live = []
    for r in players[players.status == 'i'].itertuples():
        if int(r.code) in ongoing:
            continue
        start = str(r.news_added)[:10] if isinstance(r.news_added, str) and r.news_added else today
        live.append({'code': int(r.code), 'from_date': start, 'end_date': ''})
    return pd.concat([inj, pd.DataFrame(live)], ignore_index=True)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
APP_URL = os.environ.get('APP_URL', 'https://fplchecker.vercel.app')
# The variant that won the walk-forward comparison (compare.py; results in
# evaluate.py's docstring). See model.py for what each setting does. FPL's
# deadline figures and Understat's xG are still collected but left out:
# neither improved the best XI picked from the predictions.
CONFIG = dict(two_stage=True, drop=('fpl_', 'us_'))


def score_week(predictions, gw_csv):
    """How `predictions` (one gameweek's file) did against that gameweek's
    points, for players who played: typical miss and correlation."""
    import pandas as pd
    gw = pd.read_csv(gw_csv)
    played = gw.groupby('element').agg(pts=('total_points', 'sum'), mins=('minutes', 'sum'))
    played = played[played.mins > 0]
    pairs = [(predictions['byId'][str(i)][0], r.pts) for i, r in played.iterrows() if str(i) in predictions['byId']]
    if len(pairs) < 20:
        return None
    p, a = np.array(pairs).T
    return {'players': len(pairs), 'meanAbsError': round(float(np.mean(np.abs(p - a))), 2),
            'correlation': round(float(np.corrcoef(p, a)[0, 1]), 3)}


def main(api=None, now=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, 'scripts', 'ml', '.cache'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'ml'))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    seasons, current, target, last_finished, bootstrap = fpl_data.prepare(args.cache, **({'api': api} if api else {}), now=now)
    print('seasons', seasons, 'predicting GW', target, 'last finished', last_finished, flush=True)

    # How last gameweek's predictions did, once it's over (once only).
    history_path = os.path.join(args.out, 'history.json')
    history = json.load(open(history_path)) if os.path.exists(history_path) else {'weeks': []}
    done = {(w['season'], w['gwId']) for w in history['weeks']}
    for gw in range(1, last_finished + 1):
        snap = os.path.join(args.out, f'predictions-gw{gw}.json')
        if (current, gw) in done or not os.path.exists(snap):
            continue
        saved = json.load(open(snap))
        if saved.get('season') != current:
            continue
        scored = score_week(saved, os.path.join(args.cache, current, 'gws', f'gw{gw}.csv'))
        if scored:
            history['weeks'].append({'season': current, 'gwId': gw, 'trainedRows': saved.get('trainedRows'), **scored})
            print('scored GW', gw, scored, flush=True)
    history['weeks'].sort(key=lambda w: (w['season'], w['gwId']))

    if not target:
        print('season over: nothing to predict')
    else:
        # Bookmaker odds and club Elo ratings (matchdata.py): the committed
        # history plus this season's results and upcoming odds, fetched now.
        if not api:
            MD.download_current(args.cache, current, teams=bootstrap.get('teams'), app_url=APP_URL)
        md = MD.MatchData((MD.DATA, os.path.join(args.cache, 'football-data')))
        today = (now or datetime.now(timezone.utc)).strftime('%Y-%m-%d')
        injuries = load_injuries(args.cache, current, today)
        snap_dir = os.environ.get('SNAPSHOTS_DIR', F.SNAPSHOTS)
        save_snapshot(args.cache, current, target, snap_dir)
        rows = F.build(args.cache, seasons, current=current, last_finished=last_finished, predict_gw=target, md=md,
                       injuries=injuries, snapshots=F.load_snapshots(snap_dir),
                       understat_dir=US_DIR if os.path.isdir(US_DIR) else None)
        known = rows[rows.known]
        model = ML.train(known, CONFIG)
        todo = rows[(rows.season == current) & (rows.gw == target)].copy()
        # This gameweek, the app scales by FPL's own chance of playing (0 for
        # a player ruled out), so his own injury isn't counted twice here.
        # Later weeks keep it: the model has learned how long injuries last.
        if 'inj_now' in todo.columns:
            this_week = todo.k == 0
            todo.loc[this_week, 'inj_now'] = 0.0
            todo.loc[this_week, 'inj_days_out'] = np.nan
        todo['pred'] = model.predict(todo) if len(todo) else []
        # Low and high ends of this gameweek's likely score (10th and 90th
        # percentile), for the range shown next to each prediction.
        ranges = {}
        this_week = todo[todo.k == 0]
        if len(this_week):
            q = ML.train_quantiles(known, CONFIG)
            lo, hi = q[0.1].predict(this_week), q[0.9].predict(this_week)
            for pid, a, b, p in zip(this_week.id, lo, hi, this_week.pred):
                a, b = max(0.0, float(a)), max(0.0, float(b))
                ranges[str(int(pid))] = [round(min(a, p), 1), round(max(b, p), 1)]
        if len(todo):
            k0 = todo[todo.k == 0]
            print('odds for', round(float(k0.odds_win.notna().mean()) * 100), '% of this gameweek\'s rows', flush=True)
        by_id = {}
        for pid, grp in todo.groupby('id'):
            preds = grp.sort_values('k').pred.tolist()
            by_id[str(int(pid))] = [round(max(0.0, float(v)), 2) for v in preds]
        if by_id:
            out = {
                'season': current, 'gwId': int(target), 'builtAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'trainedRows': int(len(known)), 'model': 'lightgbm', 'config': CONFIG,
                # Later weeks already allow for injuries: the app scales only
                # this gameweek by FPL's chance of playing.
                'injuryAware': 'inj_now' in model.cols, 'byId': by_id, 'rangeById': ranges,
            }
            for name in ('predictions.json', f'predictions-gw{target}.json'):
                with open(os.path.join(args.out, name), 'w') as f:
                    json.dump(out, f, separators=(',', ':'))
            print('predicted', len(by_id), 'players for GW', target, 'from', len(known), 'rows', flush=True)
        else:
            print('no players to predict (first gameweek?)')

    with open(history_path, 'w') as f:
        json.dump(history, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
