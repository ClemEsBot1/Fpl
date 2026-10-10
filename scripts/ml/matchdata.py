"""Match-level inputs for the model, from football-data.co.uk Premier League
files (see import_football_data.py):

  - bookmaker odds per match, turned into the chances of a home win, draw,
    away win and over 2.5 goals (the bookmakers' margin taken out);
  - an Elo rating for every club, carried across seasons from 2000-01, so a
    club's strength isn't forgotten every August.

The committed files in data/football-data/ cover every past season. The
daily retrain also downloads this season's file and the upcoming fixtures
(with their odds) into the cache, best-effort; without them the model just
sees no odds for those matches.
"""
import bisect
import glob
import os
import re
import urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data', 'football-data')
SITE = 'https://www.football-data.co.uk'

# FPL's names for the few clubs football-data spells differently.
ALIASES = {'Man Utd': 'Man United', 'Spurs': 'Tottenham', 'Sheffield Utd': 'Sheffield United'}

ELO_START = 1500.0
ELO_K = 20.0
ELO_HOME = 65.0  # home advantage, in rating points
ELO_CARRY = 0.8  # share of a club's distance from average kept over the summer


def canon(name):
    name = str(name).strip()
    return ALIASES.get(name, name)


def _season_of(path):
    m = re.search(r'(\d{4}-\d{2})', os.path.basename(path))
    return m.group(1) if m else None


def download_current(cache, season, teams=None, app_url=None):
    """This season's results and the upcoming fixtures with odds, into
    <cache>/football-data/. Best-effort: failures are printed, not raised.
    With `teams` (FPL bootstrap teams) and `app_url`, the app's own cached
    odds (/api/odds, from The Odds API) are saved too, as a fallback for
    the gameweek being predicted."""
    import json
    import import_football_data as imp
    out = os.path.join(cache, 'football-data')
    os.makedirs(out, exist_ok=True)
    start = int(season[:4])
    code = f'{start % 100:02d}{(start + 1) % 100:02d}'
    for url, name, keep in ((f'{SITE}/mmz4281/{code}/E0.csv', f'E0-{season}.csv', None),
                            (f'{SITE}/fixtures.csv', f'fixtures-{season}.csv', 'E0')):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'fpl-squad-check-ml'})
            with urllib.request.urlopen(req, timeout=30) as r:
                path = os.path.join(out, name + '.raw')
                with open(path, 'wb') as f:
                    f.write(r.read())
            df = pd.read_csv(path, encoding='latin-1', on_bad_lines='skip')
            if keep and 'Div' in df.columns:
                df = df[df['Div'] == keep]
            imp.compact(df).to_csv(os.path.join(out, name), index=False, float_format='%.3f')
            os.remove(path)
        except Exception as e:  # noqa: BLE001 - missing odds are tolerated
            print(f'football-data {url}: {e}')
    if teams and app_url:
        try:
            req = urllib.request.Request(f'{app_url.rstrip("/")}/api/odds', headers={'User-Agent': 'fpl-squad-check-ml'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            names = {t['id']: t['name'] for t in teams}
            rows = [{'date': '', 'home': names.get(m.get('homeTeamId')), 'away': names.get(m.get('awayTeamId')),
                     'hg': np.nan, 'ag': np.nan, 'odds_h': m.get('homeWinOdds'), 'odds_d': m.get('drawOdds'),
                     'odds_a': m.get('awayWinOdds'), 'odds_over': np.nan, 'odds_under': np.nan}
                    for m in (data if isinstance(data, list) else [])]
            rows = [r for r in rows if r['home'] and r['away']]
            # Written first so football-data's own copy (with over/under) wins.
            pd.DataFrame(rows).to_csv(os.path.join(out, f'app-odds-{season}.csv'), index=False)
            print('app odds:', len(rows), 'matches')
        except Exception as e:  # noqa: BLE001
            print(f'app odds: {e}')


def _probs(oh, od, oa, oo, ou):
    """De-margined chances: (home, draw, away, over 2.5)."""
    if not all(np.isfinite([oh, od, oa])) or min(oh, od, oa) <= 1:
        h = d = a = np.nan
    else:
        inv = np.array([1 / oh, 1 / od, 1 / oa])
        h, d, a = inv / inv.sum()
    if np.isfinite(oo) and np.isfinite(ou) and min(oo, ou) > 1:
        over = (1 / oo) / (1 / oo + 1 / ou)
    else:
        over = np.nan
    return h, d, a, over


class MatchData:
    def __init__(self, dirs=(DATA,)):
        frames = []
        for priority, d in enumerate(dirs):
            for path in glob.glob(os.path.join(d, '*.csv')):
                season = _season_of(path)
                if not season:
                    continue
                df = pd.read_csv(path)
                df['season'] = season
                # Later directories win; the app's odds lose to football-data's.
                df['priority'] = priority * 2 - (1 if os.path.basename(path).startswith('app-') else 0)
                frames.append(df)
        if not frames:
            raise FileNotFoundError(f'no football-data files in {dirs}')
        m = pd.concat(frames, ignore_index=True)
        m['home'] = m['home'].map(canon)
        m['away'] = m['away'].map(canon)
        # The same match from several files: prefer one with a result, then
        # the later directory (a fresh download over the committed copy).
        m['has_result'] = m['hg'].notna() & m['ag'].notna()
        m = m.sort_values(['has_result', 'priority']).drop_duplicates(['season', 'home', 'away'], keep='last')
        self.matches = m.sort_values('date').reset_index(drop=True)

        self._odds = {}
        for r in self.matches.itertuples():
            p = _probs(r.odds_h, r.odds_d, r.odds_a, r.odds_over, r.odds_under)
            if np.isfinite(p[0]) or np.isfinite(p[3]):
                self._odds[(r.season, r.home, r.away)] = p
        self._build_elo()

    def _build_elo(self):
        ratings = {}
        self._hist = {}  # club -> ([dates], [rating from that date on])
        played = self.matches[self.matches.has_result]

        def note(club, date, rating):
            dates, vals = self._hist.setdefault(club, ([], []))
            dates.append(date)
            vals.append(rating)

        prev_clubs = set()
        for season, games in played.groupby('season', sort=True):
            clubs = set(games.home) | set(games.away)
            start = f'{season[:4]}-07-01'
            # Summer: everyone drifts back toward average; promoted clubs
            # start where last season's bottom three finished.
            if prev_clubs:
                bottom = sorted(ratings[c] for c in prev_clubs)[:3]
                promoted_at = float(np.mean(bottom))
            else:
                promoted_at = ELO_START
            for c in clubs:
                if c in prev_clubs:
                    ratings[c] = ELO_START + ELO_CARRY * (ratings[c] - ELO_START)
                else:
                    ratings[c] = promoted_at
                note(c, start, ratings[c])
            for g in games.itertuples():
                rh, ra = ratings[g.home], ratings[g.away]
                expect = 1 / (1 + 10 ** ((ra - rh - ELO_HOME) / 400))
                result = 1.0 if g.hg > g.ag else 0.5 if g.hg == g.ag else 0.0
                gd = abs(g.hg - g.ag)
                mult = 1 if gd <= 1 else 1.5 if gd == 2 else (11 + gd) / 8
                delta = ELO_K * mult * (result - expect)
                ratings[g.home] = rh + delta
                ratings[g.away] = ra - delta
                # Effective from the day after, so a match never sees itself.
                day_after = (pd.Timestamp(g.date) + pd.Timedelta(days=1)).strftime('%Y-%m-%d')
                note(g.home, day_after, ratings[g.home])
                note(g.away, day_after, ratings[g.away])
            prev_clubs = clubs
        self._promoted_at = promoted_at if prev_clubs else ELO_START

    def elo(self, club, date):
        """Club's rating going into `date` (YYYY-MM-DD), from results before
        it. A club with no history yet rates as a promoted club."""
        h = self._hist.get(canon(club))
        if not h:
            return self._promoted_at
        dates, vals = h
        i = bisect.bisect_right(dates, date) - 1
        return vals[i] if i >= 0 else self._promoted_at

    def odds(self, season, home, away):
        """(home win, draw, away win, over 2.5) chances, or None."""
        return self._odds.get((season, canon(home), canon(away)))
