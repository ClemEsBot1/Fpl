"""Walk-forward test of the ML model against the formula, as run before it
replaced the formula. Each test season is predicted only from earlier
seasons and, retrained every gameweek, that season's finished weeks.

  # the formula's predictions for the same rows, without the archive's xP
  NO_XP=1 DUMP=/tmp/formula.csv node scripts/backtest.mjs
  python scripts/ml/evaluate.py --formula /tmp/formula.csv --out /tmp/ml.json
  # team-level: the best XI picked from the ML model's predictions
  NO_XP=1 ML_PREDS=/tmp/ml.json node scripts/backtest.mjs

  python scripts/ml/evaluate.py --leak-check   # why the archive's xP is left out

Results (2022-23 to 2025-26, 42,199 player-gameweeks, retrained weekly;
predictions scored as the app serves them, a player ruled out at the
deadline being 0 that week):
                          formula   ML before   ML now
  next-gameweek corr       0.443     0.520      0.540
  4-week corr              0.558     0.649      0.669
  4-week typical miss      1.091     1.001      0.968
  best XI pts/gameweek     54.8      63.0       64.4
"ML now" adds betting odds, club Elo, injury history and the two-stage
model (retrain.py's CONFIG); compare.py tests each change on its own.
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F  # noqa: E402
import matchdata as MD  # noqa: E402
import model as ML  # noqa: E402
from compare import served  # noqa: E402
from retrain import CONFIG  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SEASONS = ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26']


def leak_check(cache):
    """FPL's xP for gameweek G should forecast G about as well as G + 1. In
    the archive it matches G far better: it was recorded afterwards."""
    for season in ('2021-22', '2022-23', '2024-25'):
        _, _, gws = F.load_season(cache, season)
        g = gws.groupby(['element', 'round']).agg(xP=('xP', 'first'), pts=('total_points', 'sum')).reset_index()
        g = g.sort_values(['element', 'round'])
        g['pts_next'] = g.groupby('element').pts.shift(-1)
        h = g[(g['round'] >= 6) & (g['round'] <= 33)].dropna()
        same = np.corrcoef(h.xP, h.pts)[0, 1]
        nxt = np.corrcoef(h.xP, h.pts_next)[0, 1]
        print(f'{season}: corr(xP_G, points_G) = {same:.3f}, corr(xP_G, points_G+1) = {nxt:.3f}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.backtest-cache'))
    ap.add_argument('--formula', help='CSV from NO_XP=1 DUMP=... node scripts/backtest.mjs')
    ap.add_argument('--out', default='ml_preds.json')
    ap.add_argument('--test', default='2022-23,2023-24,2024-25,2025-26')
    ap.add_argument('--refit-every', type=int, default=1, help='gameweeks between retrains (0 = once a season)')
    ap.add_argument('--leak-check', action='store_true')
    args = ap.parse_args()
    if args.leak_check:
        leak_check(args.cache)
        return

    from retrain import INJURIES, US_DIR
    rows = F.build(args.cache, SEASONS, md=MD.MatchData(), injuries=pd.read_csv(INJURIES), snapshots=F.load_snapshots(),
                   understat_dir=US_DIR if os.path.isdir(US_DIR) else None)
    rows = rows[rows.known]
    preds = []
    for test in args.test.split(','):
        past = rows[rows.season.isin(SEASONS[:SEASONS.index(test)])]
        cur = rows[rows.season == test]
        gws = sorted(cur.gw.unique())
        step = args.refit_every or len(gws)
        for i in range(0, len(gws), step):
            block = gws[i:i + step]
            known = cur[(cur.gw + cur.k) < block[0]]
            train = pd.concat([past, known])
            model = ML.train(train, CONFIG)
            part = cur[cur.gw.isin(block)].copy()
            part['ml'] = served(model, part)
            preds.append(part[['season', 'gw', 'id', 'k', 'ml', 'target']])
        print('tested', test, flush=True)
    P = pd.concat(preds)
    nxt = P[P.k == 0][['season', 'gw', 'id', 'ml', 'target']].rename(columns={'ml': 'ml_next', 'target': 'actual'})
    four = P[P.k < 4].groupby(['season', 'gw', 'id']).agg(ml_pred4=('ml', 'mean'), actual4=('target', 'mean'), nk=('k', 'count')).reset_index()
    ml = nxt.merge(four, on=['season', 'gw', 'id'])

    out = {}
    for r in ml.itertuples():
        out.setdefault(r.season, {}).setdefault(int(r.gw), {})[int(r.id)] = [round(float(r.ml_next), 2), round(float(r.ml_pred4), 2)]
    with open(args.out, 'w') as f:
        json.dump(out, f)
    print('wrote', args.out)

    if args.formula:
        formula = pd.read_csv(args.formula)
        both = formula.merge(ml, on=['season', 'gw', 'id'], how='left').fillna({'ml_next': 0, 'ml_pred4': 0, 'actual': 0})
        mae = lambda a, b: float(np.mean(np.abs(a - b)))
        corr = lambda a, b: float(np.corrcoef(a, b)[0, 1])
        f4 = both[both.nk == 4]
        print(f'{len(both)} rows')
        print(f'next gameweek  MAE formula {mae(both.next, both.actual):.3f}  ML {mae(both.ml_next, both.actual):.3f}  '
              f'corr formula {corr(both.next, both.actual):.4f}  ML {corr(both.ml_next, both.actual):.4f}')
        print(f'4-week average MAE formula {mae(f4.pred4, f4.actual4):.3f}  ML {mae(f4.ml_pred4, f4.actual4):.3f}  '
              f'corr formula {corr(f4.pred4, f4.actual4):.4f}  ML {corr(f4.ml_pred4, f4.actual4):.4f}')


if __name__ == '__main__':
    main()
