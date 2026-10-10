"""Features for the ML model, from seasons in the archive's CSV layout (see
fpl_data.py).

One row per (season, gameweek G, player, horizon k): the features use only
gameweeks before G (what was known at G's deadline) and the fixture(s) in
gameweek G + k; the target is the player's points in G + k. FPL's own
expected points (xP) is left out on purpose: in the archive it was recorded
after the gameweek and partly knows the result (see evaluate.py).
"""
import os

import numpy as np
import pandas as pd

HORIZONS = 5  # this gameweek and the next four, as the transfer plan uses
G = 39  # rounds 1..38

STATS = ['total_points', 'minutes', 'bps', 'ict_index', 'threat', 'creativity', 'influence', 'goals_scored', 'assists',
         'expected_goals', 'expected_assists', 'clean_sheets', 'starts', 'saves', 'goals_conceded']
PER90 = ['bps', 'ict_index', 'threat', 'creativity', 'influence', 'goals_scored', 'assists', 'expected_goals',
         'expected_assists', 'saves', 'clean_sheets', 'goals_conceded']
ID_COLS = ['season', 'gw', 'id', 'code', 'k', 'target', 'target_min', 'known']


def injury_index(injuries):
    """code -> sorted list of (from_date, end_date) strings; an injury with
    no end date yet runs on."""
    out = {}
    if injuries is None:
        return out
    for r in injuries.itertuples():
        end = r.end_date if isinstance(r.end_date, str) and r.end_date else '9999-12-31'
        out.setdefault(int(r.code), []).append((str(r.from_date)[:10], end))
    for v in out.values():
        v.sort()
    return out


def injury_state(spans, date):
    """(out now, days out so far, injuries in the past year, days missed in
    the past year) as known on `date`: only injuries that began before it,
    and days missed only up to it."""
    if not spans or not date:
        return 0.0, np.nan, 0.0, 0.0
    d = pd.Timestamp(date)
    year_ago = (d - pd.Timedelta(days=365)).strftime('%Y-%m-%d')
    now, so_far, n, days = 0.0, np.nan, 0.0, 0.0
    for start, end in spans:
        if start >= date:
            break
        if end >= date:
            now, so_far = 1.0, float((d - pd.Timestamp(start)).days)
        if start >= year_ago:
            n += 1
            days += float((min(d, pd.Timestamp(end) if end < '9999' else d) - pd.Timestamp(start)).days)
    return now, so_far, n, days
# Match-level inputs from matchdata.py: club Elo ratings, and bookmaker
# odds for the gameweek being predicted (k = 0 only: later gameweeks aren't
# priced yet at the deadline).
EXTRAS = ('elo', 'odds')


def _read(path):
    try:
        return pd.read_csv(path, encoding='utf-8')
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding='latin-1')


def load_season(cache, season):
    d = os.path.join(cache, season)
    players = _read(os.path.join(d, 'players_raw.csv'))
    players = players[players.element_type <= 4].reset_index(drop=True)
    fixtures = _read(os.path.join(d, 'fixtures.csv'))
    frames = []
    for gw in range(1, 39):
        p = os.path.join(d, 'gws', f'gw{gw}.csv')
        if os.path.exists(p):
            df = _read(p)
            if len(df):
                df['round'] = gw
                frames.append(df)
    gws = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=['element', 'round', 'fixture', 'was_home'])
    return players, fixtures, gws


def _team_names(cache, season):
    """FPL team id -> club name, for matching football-data's files."""
    t = _read(os.path.join(cache, season, 'teams.csv'))
    col = 'name' if 'name' in t.columns else 'short_name'
    return dict(zip(t.id.astype(int), t[col].astype(str)))


def build_season(cache, season, prev_rates, last_finished=38, predict_gw=None, md=None, extras=EXTRAS, injuries=None):
    """Rows for one season. Gameweeks after `last_finished` have unknown
    targets (known = False); with `predict_gw`, rows stop at that gameweek.
    `md` (matchdata.MatchData) adds club Elo ratings and bookmaker odds, as
    `extras` says. `injuries` (code, from_date, end_date; see
    import_injuries.py) adds each player's injury state and history and how
    much of his team is missing. Returns (rows, this season's per-player
    rates for the next season's prior)."""
    players, fixtures, gws = load_season(cache, season)
    ids = players.id.astype(int).values
    idx = {pid: i for i, pid in enumerate(ids)}
    n = len(ids)
    fixtures = fixtures[pd.to_numeric(fixtures.event, errors='coerce').notna()].copy()
    fixtures['event'] = fixtures.event.astype(int)
    for c in ('team_h_score', 'team_a_score'):
        fixtures[c] = pd.to_numeric(fixtures[c], errors='coerce')
    fx_by_id = fixtures.set_index('id')

    M = {s: np.zeros((n, G)) for s in STATS}
    has = {}
    value = np.full((n, G), np.nan)
    selected = np.full((n, G), np.nan)
    tbal = np.full((n, G), np.nan)
    team_at = np.full((n, G), -1)
    g = gws[gws.element.isin(idx.keys())].copy()
    if len(g):
        g['i'] = g.element.map(idx)
        for s in STATS:
            has[s] = s in g.columns and pd.to_numeric(g[s], errors='coerce').fillna(0).abs().sum() > 0
            g[s] = pd.to_numeric(g[s], errors='coerce').fillna(0) if s in g.columns else 0.0
        if not has['starts']:
            g['starts'] = (g.minutes >= 60).astype(float)
            has['starts'] = True
        home = g.was_home.astype(str).str.lower().isin(['true', '1'])
        g['team'] = np.where(home, g.fixture.map(fx_by_id.team_h), g.fixture.map(fx_by_id.team_a))
        for c in ('value', 'selected', 'transfers_balance'):
            g[c] = pd.to_numeric(g[c], errors='coerce') if c in g.columns else np.nan
        agg = g.groupby(['i', 'round']).agg({**{s: 'sum' for s in STATS}, 'value': 'first', 'selected': 'first',
                                              'transfers_balance': 'first', 'team': 'first'})
        ii = agg.index.get_level_values(0).values
        rr = agg.index.get_level_values(1).values
        for s in STATS:
            M[s][ii, rr] = agg[s].values
        value[ii, rr] = agg.value.values / 10
        selected[ii, rr] = agg.selected.values
        tbal[ii, rr] = agg.transfers_balance.values
        team_at[ii, rr] = agg.team.fillna(-1).astype(int).values
    else:
        has = {s: s in ('total_points', 'minutes', 'starts') for s in STATS}

    base_team = players.team.astype(int).values
    now_cost = players.now_cost.values / 10
    for i in range(n):
        last_team = base_team[i]
        known_prices = np.where(~np.isnan(value[i, 1:]))[0]
        last_price = value[i, known_prices[0] + 1] if len(known_prices) else now_cost[i]
        last_sel, last_tb = np.nan, np.nan
        for r in range(1, G):
            if team_at[i, r] >= 0:
                last_team = team_at[i, r]
            else:
                team_at[i, r] = last_team
            if np.isnan(value[i, r]):
                value[i, r] = last_price
            else:
                last_price = value[i, r]
            if np.isnan(selected[i, r]):
                selected[i, r] = last_sel
            else:
                last_sel = selected[i, r]
            if np.isnan(tbal[i, r]):
                tbal[i, r] = last_tb
            else:
                last_tb = tbal[i, r]
    # The gameweek being predicted has no row yet: today's price.
    if predict_gw and 1 <= predict_gw < G:
        value[:, predict_gw] = now_cost

    T = int(max(fixtures.team_h.max(), fixtures.team_a.max())) + 1
    tgf = np.zeros((T, G)); tga = np.zeros((T, G)); tm = np.zeros((T, G))
    for f in fixtures.itertuples():
        if np.isnan(f.team_h_score) or np.isnan(f.team_a_score) or f.event > last_finished:
            continue
        tgf[f.team_h, f.event] += f.team_h_score; tga[f.team_h, f.event] += f.team_a_score; tm[f.team_h, f.event] += 1
        tgf[f.team_a, f.event] += f.team_a_score; tga[f.team_a, f.event] += f.team_h_score; tm[f.team_a, f.event] += 1
    names = _team_names(cache, season) if md is not None else {}
    kick = pd.to_datetime(fixtures.get('kickoff_time'), errors='coerce', utc=True) if 'kickoff_time' in fixtures else None
    event_start = {}
    if kick is not None:
        for e, k in zip(fixtures.event, kick):
            if pd.notna(k):
                d = k.strftime('%Y-%m-%d')
                event_start[e] = min(event_start.get(e, d), d)
    nan4 = (np.nan, np.nan, np.nan, np.nan)
    fx_team = {}
    for f in fixtures.itertuples():
        o = md.odds(season, names.get(f.team_h, ''), names.get(f.team_a, '')) if (md is not None and 'odds' in extras) else None
        h, d, a, over = o if o else nan4
        # (opponent, home, FDR, win, draw, loss, over 2.5) from this club's side
        fx_team.setdefault((f.team_h, f.event), []).append((f.team_a, 1, f.team_h_difficulty, h, d, a, over))
        fx_team.setdefault((f.team_a, f.event), []).append((f.team_h, 0, f.team_a_difficulty, a, d, h, over))
    elo_cache = {}

    def elo_at(team, g0):
        # As of gameweek g0's first kickoff: what was known at its deadline.
        key = (team, g0)
        if key not in elo_cache:
            date = event_start.get(g0)
            elo_cache[key] = md.elo(names.get(team, ''), date) if (date and names.get(team)) else np.nan
        return elo_cache[key]

    cs = {s: np.cumsum(M[s], axis=1) for s in STATS}
    inj_idx = injury_index(injuries) if injuries is not None else None
    cs_tm = np.cumsum(tm, axis=1); cs_gf = np.cumsum(tgf, axis=1); cs_ga = np.cumsum(tga, axis=1)

    def win(arr, row, g0, w):
        return arr[row, g0 - 1] - arr[row, max(0, g0 - 1 - w)]

    out = []
    codes = players.code.values
    pos = players.element_type.values
    last_g0 = min(38, predict_gw) if predict_gw else 38
    # Injuries at each deadline, and the share of each team's (and each
    # position's) points so far that is missing through injury.
    inj_state, team_out, pos_out = {}, {}, {}
    if inj_idx is not None:
        for g0 in range(2, last_g0 + 1):
            date = event_start.get(g0)
            tot_t, out_t, tot_p, out_p = {}, {}, {}, {}
            for i in range(n):
                st = injury_state(inj_idx.get(int(codes[i])), date)
                inj_state[(i, g0)] = st
                t = team_at[i, g0 - 1]
                tm_ = cs_tm[t, g0 - 1]
                share = cs['total_points'][i, g0 - 1] / tm_ if tm_ else 0.0
                tot_t[t] = tot_t.get(t, 0) + share
                tot_p[(t, pos[i])] = tot_p.get((t, pos[i]), 0) + share
                if st[0]:
                    out_t[t] = out_t.get(t, 0) + share
                    out_p[(t, pos[i])] = out_p.get((t, pos[i]), 0) + share
            for t, v in tot_t.items():
                team_out[(t, g0)] = out_t.get(t, 0) / v if v > 0 else 0.0
            for tp, v in tot_p.items():
                pos_out[tp + (g0,)] = out_p.get(tp, 0) / v if v > 0 else 0.0
    for g0 in range(2, last_g0 + 1):
        for i in range(n):
            if not cs['minutes'][i, g0 - 1] and codes[i] not in prev_rates:
                continue  # never played, no history: nothing to learn or say
            t = team_at[i, g0 - 1]
            team_matches = cs_tm[t, g0 - 1]
            if team_matches == 0:
                continue
            feats = {
                'season': season, 'gw': g0, 'id': int(ids[i]), 'code': int(codes[i]), 'pos': int(pos[i]),
                'price': value[i, g0], 'selected': selected[i, g0], 'tbal': tbal[i, g0], 'gw_frac': g0 / 38,
                'min_share_season': cs['minutes'][i, g0 - 1] / (90 * team_matches),
                'pts_tm_season': cs['total_points'][i, g0 - 1] / team_matches,
            }
            for w in (1, 3, 5, 10):
                tmw = win(cs_tm, t, g0, w)
                feats[f'min_share_{w}'] = win(cs['minutes'], i, g0, w) / (90 * tmw) if tmw else np.nan
                feats[f'pts_tm_{w}'] = win(cs['total_points'], i, g0, w) / tmw if tmw else np.nan
                feats[f'starts_{w}'] = win(cs['starts'], i, g0, w) / tmw if tmw else np.nan
            for s in PER90:
                for w in (5, 38):
                    m = win(cs['minutes'], i, g0, w)
                    feats[f'{s}_p90_{w}'] = (win(cs[s], i, g0, w) / m * 90) if (m >= 90 and has.get(s)) else np.nan
            for w in (5, 38):
                tmw = win(cs_tm, t, g0, w)
                feats[f'team_gf_{w}'] = win(cs_gf, t, g0, w) / tmw if tmw else np.nan
                feats[f'team_ga_{w}'] = win(cs_ga, t, g0, w) / tmw if tmw else np.nan
            if inj_idx is not None:
                st = inj_state[(i, g0)]
                feats['inj_now'], feats['inj_days_out'], feats['inj_n_365'], feats['inj_days_365'] = st
                # Share of the team's (and his position's) points that is
                # out injured; includes his own when he's the one out.
                feats['inj_team_out'] = team_out.get((t, g0), 0.0)
                feats['inj_pos_out'] = pos_out.get((t, pos[i], g0), 0.0)
            pr = prev_rates.get(codes[i])
            feats['prev_pts90'] = pr[0] if pr else np.nan
            feats['prev_min'] = pr[1] if pr else np.nan
            for k in range(HORIZONS):
                gk = g0 + k
                if gk > 38:
                    break
                fx = fx_team.get((t, gk), [])
                row = dict(feats)
                row['k'] = k
                row['n_fix'] = len(fx)
                if fx:
                    row['home'] = float(np.mean([f[1] for f in fx]))
                    row['fdr'] = float(np.mean([f[2] for f in fx]))
                    ogf, oga = [], []
                    for o, *_ in fx:
                        tmw = win(cs_tm, o, g0, 10)
                        ogf.append(win(cs_gf, o, g0, 10) / tmw if tmw else np.nan)
                        oga.append(win(cs_ga, o, g0, 10) / tmw if tmw else np.nan)
                    row['opp_gf_10'] = np.nanmean(ogf) if not np.all(np.isnan(ogf)) else np.nan
                    row['opp_ga_10'] = np.nanmean(oga) if not np.all(np.isnan(oga)) else np.nan
                else:
                    row['home'] = row['fdr'] = row['opp_gf_10'] = row['opp_ga_10'] = np.nan
                if md is not None and 'elo' in extras:
                    row['elo_team'] = elo_at(t, g0)
                    opp = [e for e in (elo_at(f[0], g0) for f in fx) if np.isfinite(e)]
                    row['elo_opp'] = float(np.mean(opp)) if opp else np.nan
                if md is not None and 'odds' in extras:
                    priced = [f for f in fx if np.isfinite(f[3])] if k == 0 else []
                    row['odds_win'] = float(np.mean([f[3] for f in priced])) if priced else np.nan
                    row['odds_loss'] = float(np.mean([f[5] for f in priced])) if priced else np.nan
                    over = [f[6] for f in fx if np.isfinite(f[6])] if k == 0 else []
                    row['odds_over'] = float(np.mean(over)) if over else np.nan
                row['known'] = gk <= last_finished
                row['target'] = M['total_points'][i, gk] if gk <= last_finished else np.nan
                row['target_min'] = M['minutes'][i, gk] if gk <= last_finished else np.nan
                out.append(row)
    rates = {}
    end = min(38, last_finished)
    for i in range(n):
        m = cs['minutes'][i, end]
        rates[codes[i]] = (cs['total_points'][i, end] / m * 90 if m >= 270 else np.nan, m)
    return pd.DataFrame(out), rates


def build(cache, seasons, current=None, last_finished=38, predict_gw=None, md=None, extras=EXTRAS, injuries=None):
    """Every season's rows, in order (each season's prior comes from the one
    before). Only `current` uses last_finished / predict_gw."""
    frames, prev = [], {}
    for s in seasons:
        is_cur = s == current
        df, prev = build_season(cache, s, prev, last_finished if is_cur else 38, predict_gw if is_cur else None, md, extras, injuries)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def feature_columns(df):
    return [c for c in df.columns if c not in ID_COLS]
