"""Data for the ML model, all in the vaastav/Fantasy-Premier-League archive's
CSV layout so one feature builder reads every season the same way:

  <cache>/<season>/players_raw.csv, teams.csv, fixtures.csv, gws/gw<N>.csv

Past seasons come from the archive (downloaded once, they never change).
The current season is written from FPL's own API: bootstrap-static,
fixtures and each finished gameweek's live scores.
"""
import csv
import json
import os
import urllib.request
from datetime import datetime, timezone

ARCHIVE = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data'
FPL = 'https://fantasy.premierleague.com/api/'
FIRST_SEASON = 2020  # 2020-21: the oldest season the model learns from


def season_name(start_year):
    return f'{start_year}-{(start_year + 1) % 100:02d}'


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'fpl-squad-check-ml'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def fpl_json(path):
    return json.loads(_get(FPL + path))


def current_season(bootstrap):
    first = min(bootstrap['events'], key=lambda e: e['id'])
    return datetime.fromisoformat(first['deadline_time'].replace('Z', '+00:00')).year


def download_archive_season(cache, season):
    """Downloads a past season once; returns False if the archive lacks it."""
    d = os.path.join(cache, season)
    done = os.path.join(d, '.complete')
    if os.path.exists(done):
        return True
    os.makedirs(os.path.join(d, 'gws'), exist_ok=True)
    try:
        for f in ('players_raw.csv', 'teams.csv', 'fixtures.csv'):
            with open(os.path.join(d, f), 'wb') as out:
                out.write(_get(f'{ARCHIVE}/{season}/{f}'))
        for gw in range(1, 39):
            with open(os.path.join(d, 'gws', f'gw{gw}.csv'), 'wb') as out:
                out.write(_get(f'{ARCHIVE}/{season}/gws/gw{gw}.csv'))
    except Exception as e:  # noqa: BLE001 - a missing season is skipped, not fatal
        print(f'archive {season}: {e}')
        return False
    open(done, 'w').close()
    return True


GW_FIELDS = ['name', 'element', 'fixture', 'opponent_team', 'was_home', 'round', 'minutes', 'total_points', 'bps',
             'ict_index', 'threat', 'creativity', 'influence', 'goals_scored', 'assists', 'expected_goals',
             'expected_assists', 'clean_sheets', 'starts', 'saves', 'goals_conceded', 'value', 'selected',
             'transfers_balance', 'xP']


def write_current_season(cache, bootstrap, fixtures, live_by_gw):
    """Writes this season from FPL's API in the archive's layout.

    Prices, ownership and transfers are today's for every row: only the
    gameweek being predicted uses them, and that's today.
    """
    season = season_name(current_season(bootstrap))
    d = os.path.join(cache, season)
    os.makedirs(os.path.join(d, 'gws'), exist_ok=True)
    elements = bootstrap['elements']
    total = bootstrap.get('total_players') or 0
    with open(os.path.join(d, 'players_raw.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'code', 'element_type', 'team', 'now_cost', 'web_name'])
        for e in elements:
            w.writerow([e['id'], e['code'], e['element_type'], e['team'], e['now_cost'], e['web_name']])
    with open(os.path.join(d, 'teams.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'short_name'])
        for t in bootstrap['teams']:
            w.writerow([t['id'], t['short_name']])
    with open(os.path.join(d, 'fixtures.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'event', 'team_h', 'team_a', 'team_h_score', 'team_a_score', 'team_h_difficulty', 'team_a_difficulty', 'kickoff_time', 'finished'])
        for x in fixtures:
            w.writerow([x['id'], x['event'] if x['event'] is not None else '', x['team_h'], x['team_a'],
                        '' if x['team_h_score'] is None else x['team_h_score'], '' if x['team_a_score'] is None else x['team_a_score'],
                        x['team_h_difficulty'], x['team_a_difficulty'], x['kickoff_time'] or '', x['finished']])
    fx = {x['id']: x for x in fixtures}
    by_id = {e['id']: e for e in elements}
    for gw, live in live_by_gw.items():
        with open(os.path.join(d, 'gws', f'gw{gw}.csv'), 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(GW_FIELDS)
            for el in live.get('elements', []):
                e = by_id.get(el['id'])
                explain = el.get('explain') or []
                if not e or not explain:
                    continue  # no match this gameweek, or not in the game any more
                s = el['stats']
                first = fx.get(explain[0]['fixture'])
                if not first:
                    continue
                home = first['team_h'] == e['team']
                w.writerow([
                    e['web_name'], el['id'], first['id'], first['team_a'] if home else first['team_h'], home, gw,
                    s.get('minutes', 0), s.get('total_points', 0), s.get('bps', 0), s.get('ict_index', 0), s.get('threat', 0),
                    s.get('creativity', 0), s.get('influence', 0), s.get('goals_scored', 0), s.get('assists', 0),
                    s.get('expected_goals', 0), s.get('expected_assists', 0), s.get('clean_sheets', 0), s.get('starts', 0),
                    s.get('saves', 0), s.get('goals_conceded', 0), e['now_cost'],
                    round(float(e.get('selected_by_percent') or 0) * total / 100),
                    (e.get('transfers_in_event') or 0) - (e.get('transfers_out_event') or 0), '',
                ])
    return season


def prepare(cache, api=fpl_json, now=None):
    """Downloads what's needed. Returns (seasons in order, current season,
    the gameweek to predict, the last finished gameweek, bootstrap).
    `api` and `now` can be swapped for a test."""
    bootstrap = api('bootstrap-static/')
    fixtures = api('fixtures/')
    start = current_season(bootstrap)
    seasons = []
    for y in range(FIRST_SEASON, start):
        if download_archive_season(cache, season_name(y)):
            seasons.append(season_name(y))
    finished = [e['id'] for e in bootstrap['events'] if e.get('finished') and e.get('data_checked', True)]
    live = {gw: api(f'event/{gw}/live/') for gw in finished}
    current = write_current_season(cache, bootstrap, fixtures, live)
    seasons.append(current)
    now = now or datetime.now(timezone.utc)
    deadline = lambda e: datetime.fromisoformat(e['deadline_time'].replace('Z', '+00:00'))
    upcoming = [e for e in bootstrap['events'] if deadline(e) > now]
    target = min(upcoming, key=lambda e: e['id'])['id'] if upcoming else None
    return seasons, current, target, (max(finished) if finished else 0), bootstrap
