"""Understat's per-match player data (data/understat/<season>.csv, from
import_understat.py) matched to FPL players, for the model's features.

Each Understat match is matched to its FPL fixture by the two clubs (a
home-away pairing happens once a season). Within that match, each
Understat player is matched by name to an FPL player of his club who
played in it: full name first, then surname, then first name.

Returns, per FPL player and gameweek: non-penalty xG, xA, shots, key
passes and penalties taken.
"""
import os
import re
import unicodedata

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data', 'understat')

CLUBS = {
    'Manchester City': 'Man City', 'Manchester United': 'Man Utd', 'Newcastle United': "Newcastle",
    'Nottingham Forest': "Nott'm Forest", 'Sheffield United': 'Sheffield Utd', 'Tottenham': 'Spurs',
    'West Bromwich Albion': 'West Brom', 'Wolverhampton Wanderers': 'Wolves', 'Leeds United': 'Leeds',
    'Leicester City': 'Leicester', 'Luton Town': 'Luton', 'Ipswich Town': 'Ipswich', 'Norwich City': 'Norwich',
}
STATS = ['npxg', 'xa', 'shots', 'key_passes', 'pens_taken']


def _norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z ]', ' ', s).split())


def _club(name):
    name = str(name).strip()
    return _norm(CLUBS.get(name, name))


def _pick(name, cands):
    """The one FPL element in `cands` ({element: [names]}) that `name` fits."""
    n = _norm(name)
    toks = n.split()
    for test in (lambda c: n in c,
                 lambda c: toks and any(x.split()[-1:] == toks[-1:] for x in c),
                 lambda c: toks and any(x.split()[:1] == toks[:1] for x in c)):
        hits = [e for e, names in cands.items() if test(names)]
        if len(hits) == 1:
            return hits[0]
    return None


def by_element(cache, season, data=DATA):
    """DataFrame(element, round, npxg, xa, shots, key_passes, pens_taken),
    or None when there's no Understat file for the season."""
    path = os.path.join(data, f'{season}.csv')
    if not os.path.exists(path):
        return None
    us = pd.read_csv(path)
    d = os.path.join(cache, season)
    teams = pd.read_csv(os.path.join(d, 'teams.csv'))
    tcol = 'name' if 'name' in teams.columns else 'short_name'
    tname = {int(i): _norm(n) for i, n in zip(teams.id, teams[tcol])}
    fx = pd.read_csv(os.path.join(d, 'fixtures.csv'))
    fx = fx[pd.to_numeric(fx.event, errors='coerce').notna()]
    pair = {(tname.get(int(r.team_h)), tname.get(int(r.team_a))): (int(r.id), int(r.event), int(r.team_h), int(r.team_a))
            for r in fx.itertuples()}
    players = pd.read_csv(os.path.join(d, 'players_raw.csv'))
    names = {}
    for r in players.itertuples():
        ns = {_norm(getattr(r, 'web_name', ''))}
        if hasattr(r, 'first_name'):
            ns.add(_norm(f'{r.first_name} {r.second_name}'))
        names[int(r.id)] = [x for x in ns if x]
    # Who played in each fixture, by club.
    played = {}
    for g in range(1, 39):
        p = os.path.join(d, 'gws', f'gw{g}.csv')
        if not os.path.exists(p):
            continue
        gw = pd.read_csv(p, encoding='latin-1')
        gw = gw[pd.to_numeric(gw.minutes, errors='coerce') > 0]
        for r in gw.itertuples():
            home = str(r.was_home).lower() in ('true', '1')
            played.setdefault((int(r.fixture), home), set()).add(int(r.element))
    out = []
    unmatched = 0
    for (mid, h, a), grp in us.groupby(['match_id', 'h_team', 'a_team']):
        f = pair.get((_club(h), _club(a)))
        if not f:
            unmatched += len(grp)
            continue
        fid, event, _, _ = f
        for side, rows in grp.groupby('h_a'):
            cands = {e: names.get(e, []) for e in played.get((fid, side == 'h'), set())}
            for r in rows.itertuples():
                if not r.minutes:
                    continue
                e = _pick(r.player, cands)
                if e is None:
                    unmatched += 1
                    continue
                out.append({'element': e, 'round': event, **{s: getattr(r, s) for s in STATS}})
    if not out:
        return None
    df = pd.DataFrame(out).groupby(['element', 'round'], as_index=False)[STATS].sum()
    df.attrs['unmatched'] = unmatched
    return df
