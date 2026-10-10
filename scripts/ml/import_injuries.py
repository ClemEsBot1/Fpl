"""Injury history for the model: Transfermarkt injury records (from the
salimt/football-datasets collection: player_profiles.csv and
player_injuries*.csv) matched to FPL players, written to
scripts/ml/data/injuries.csv:

  code, from_date, end_date, days_missed, games_missed, reason

`code` is FPL's player code, the same in every season. Players are
matched by full name and date of birth (FPL gives birth dates from 2025-26,
and a player's code carries them back to earlier seasons), then by surname
and date of birth, then by a full name that only one Transfermarkt player
has. Only injuries starting from July 2020 (the seasons the model learns
from) are kept.

  python scripts/ml/import_injuries.py <transfermarkt dir> [<FPL cache dir>]
"""
import glob
import os
import re
import sys
import unicodedata

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'data', 'injuries.csv')
SINCE = '2020-07-01'


def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(\d+\)', '', s)
    return ' '.join(re.sub(r'[^a-z ]', ' ', s).split())


def fpl_players(cache):
    """FPL player code -> {'names', 'dob'} across every cached season."""
    out = {}
    for season in sorted(os.listdir(cache)):
        path = os.path.join(cache, season, 'players_raw.csv')
        if not os.path.exists(path):
            continue
        p = pd.read_csv(path)
        for r in p.itertuples():
            d = out.setdefault(int(r.code), {'names': set(), 'dob': None})
            for n in (f'{getattr(r, "first_name", "")} {getattr(r, "second_name", "")}', getattr(r, 'web_name', '')):
                if norm(n):
                    d['names'].add(norm(n))
            dob = getattr(r, 'birth_date', None)
            if isinstance(dob, str) and dob:
                d['dob'] = dob[:10]
    return out


def match(players, prof):
    prof = prof.assign(key=prof.player_name.map(norm), dob=prof.date_of_birth.astype(str).str[:10])
    by_name = prof.groupby('key').player_id.apply(set).to_dict()
    by_name_dob = {(k, d): p for k, d, p in zip(prof.key, prof.dob, prof.player_id)}
    by_dob = prof.groupby('dob')[['key', 'player_id']].apply(lambda g: list(zip(g.key, g.player_id))).to_dict()
    out = {}
    for code, d in players.items():
        got = None
        if d['dob']:
            got = next((by_name_dob[(n, d['dob'])] for n in d['names'] if (n, d['dob']) in by_name_dob), None)
            if got is None:
                surnames = {n.split()[-1] for n in d['names']}
                hits = [pid for k, pid in by_dob.get(d['dob'], []) if k and k.split()[-1] in surnames]
                got = hits[0] if len(hits) == 1 else None
        if got is None:
            ids = set().union(*[by_name.get(n, set()) for n in d['names'] if len(n.split()) >= 2] or [set()])
            got = ids.pop() if len(ids) == 1 else None
        if got is not None:
            out[code] = got
    return out


def main(tm, cache):
    prof = pd.read_csv(os.path.join(tm, 'player_profiles', 'player_profiles.csv'),
                       usecols=['player_id', 'player_name', 'date_of_birth'], low_memory=False)
    files = sorted(glob.glob(os.path.join(tm, 'player_injuries', 'player_injuries*.csv')))
    inj = pd.concat([pd.read_csv(f) for f in files]).drop_duplicates(['player_id', 'from_date', 'injury_reason'])
    inj = inj[pd.to_datetime(inj.from_date, errors='coerce') >= SINCE]
    players = fpl_players(cache)
    codes = match(players, prof)
    by_tm = {}
    for code, pid in codes.items():
        by_tm.setdefault(pid, []).append(code)
    rows = []
    for r in inj.itertuples():
        for code in by_tm.get(r.player_id, []):
            rows.append({'code': code, 'from_date': str(r.from_date)[:10],
                         'end_date': str(r.end_date)[:10] if isinstance(r.end_date, str) else '',
                         'days_missed': r.days_missed, 'games_missed': r.games_missed,
                         'reason': str(r.injury_reason)})
    df = pd.DataFrame(rows).sort_values(['code', 'from_date'])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f'{len(codes)} of {len(players)} FPL players matched; {len(df)} injuries since {SINCE} written to {OUT}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '..', '.backtest-cache'))
