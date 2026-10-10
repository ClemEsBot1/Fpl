"""FPL's own player data as it stood after each gameweek, from the
olbauday/FPL-Elo-Insights collection (data/<season>/playerstats.csv, one
row per player per gameweek), written to
scripts/ml/data/fpl-snapshots/<season>.csv:

  id, gw, ep_next, chance_next, status, penalties_order

The row for gameweek g was taken after g finished, so ep_next is FPL's
forecast for g + 1 and chance_next its chance of playing in g + 1: both
known before g + 1's deadline. (Checked: ep_next there tracks g + 1's
points about as well as form does, unlike the vaastav archive's xP, which
was recorded after the gameweek it describes.) The collection starts in
2025-26.

  python scripts/ml/import_fpl_snapshots.py <FPL-Elo-Insights checkout>
"""
import glob
import os
import sys

import pandas as pd

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'fpl-snapshots')


def season_name(folder):
    start, end = os.path.basename(folder).split('-')
    return f'{start}-{end[-2:]}'


def compact(df):
    num = lambda c: pd.to_numeric(df[c], errors='coerce') if c in df.columns else pd.Series(float('nan'), index=df.index)
    return pd.DataFrame({
        'id': num('id').astype('Int64'), 'gw': num('gw').astype('Int64'),
        'ep_next': num('ep_next'), 'chance_next': num('chance_of_playing_next_round'),
        'status': df['status'].astype(str) if 'status' in df.columns else '',
        'penalties_order': num('penalties_order'),
    }).dropna(subset=['id', 'gw'])


def main(repo):
    os.makedirs(OUT, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(repo, 'data', '*', 'playerstats.csv'))):
        season = season_name(os.path.dirname(path))
        df = compact(pd.read_csv(path, low_memory=False)).drop_duplicates(['id', 'gw'], keep='last')
        df.sort_values(['gw', 'id']).to_csv(os.path.join(OUT, f'{season}.csv'), index=False, float_format='%.2f')
        print(season, len(df), 'rows, gameweeks', int(df.gw.min()), '-', int(df.gw.max()))


if __name__ == '__main__':
    main(sys.argv[1])
