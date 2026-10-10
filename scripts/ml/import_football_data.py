"""Turns football-data.co.uk Premier League files (E0.csv, one per season)
into the compact per-season files the model reads, in
scripts/ml/data/football-data/E0-<season>.csv:

  date, home, away, hg, ag, odds_h, odds_d, odds_a, odds_over, odds_under

Odds are pre-match (not closing) decimal odds: the market average where the
file has one, otherwise Bet365 or Pinnacle. Over/under is the 2.5-goals
line. Missing values are left empty.

  python scripts/ml/import_football_data.py path/to/folder-of-E0-files
"""
import glob
import os
import sys

import pandas as pd

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'football-data')

# First column present wins.
CHAINS = {
    'odds_h': ['AvgH', 'BbAvH', 'B365H', 'PSH'],
    'odds_d': ['AvgD', 'BbAvD', 'B365D', 'PSD'],
    'odds_a': ['AvgA', 'BbAvA', 'B365A', 'PSA'],
    'odds_over': ['Avg>2.5', 'BbAv>2.5', 'B365>2.5', 'P>2.5'],
    'odds_under': ['Avg<2.5', 'BbAv<2.5', 'B365<2.5', 'P<2.5'],
}


def season_of(date):
    start = date.year if date.month >= 7 else date.year - 1
    return f'{start}-{(start + 1) % 100:02d}'


def compact(df):
    df = df.dropna(subset=['HomeTeam', 'AwayTeam']).copy()
    dates = pd.to_datetime(df['Date'], format='%d/%m/%Y', errors='coerce')
    short = pd.to_datetime(df['Date'], format='%d/%m/%y', errors='coerce')
    df['date'] = dates.fillna(short)
    df = df.dropna(subset=['date'])
    out = pd.DataFrame({
        'date': df['date'].dt.strftime('%Y-%m-%d'),
        'home': df['HomeTeam'].str.strip(), 'away': df['AwayTeam'].str.strip(),
        'hg': pd.to_numeric(df.get('FTHG'), errors='coerce'), 'ag': pd.to_numeric(df.get('FTAG'), errors='coerce'),
    })
    for name, cols in CHAINS.items():
        val = pd.Series(float('nan'), index=df.index)
        for c in cols:
            if c in df.columns:
                val = val.fillna(pd.to_numeric(df[c], errors='coerce'))
        out[name] = val
    return out


def main(src):
    os.makedirs(OUT, exist_ok=True)
    by_season = {}
    for f in sorted(glob.glob(os.path.join(src, '*.csv'))):
        df = compact(pd.read_csv(f, encoding='latin-1', on_bad_lines='skip'))
        if len(df):
            # One file is one season, named from its first match (2019-20
            # ran on into July 2020).
            by_season.setdefault(season_of(pd.Timestamp(df['date'].min())), []).append(df)
    for season, parts in sorted(by_season.items()):
        df = pd.concat(parts).drop_duplicates(['date', 'home', 'away']).sort_values(['date', 'home'])
        df.to_csv(os.path.join(OUT, f'E0-{season}.csv'), index=False, float_format='%.3f')
        print(season, len(df), 'matches')


if __name__ == '__main__':
    main(sys.argv[1])
