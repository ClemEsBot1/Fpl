"""Per-match player data from Understat (shots, xG, non-penalty xG, xA, key
passes, penalties taken) for Premier League seasons, written to
scripts/ml/data/understat/<season>.csv:

  match_id, date, h_team, a_team, player_id, player, team, h_a, minutes,
  shots, xg, npxg, xa, key_passes, goals, assists, pens_taken

Runs in GitHub Actions (.github/workflows/ml-import-understat.yml): this
site can't be reached from every network. Finished seasons are fetched
once (a file that exists is kept); the current one is refreshed. Pages are
fetched about one a second.

  python scripts/ml/import_understat.py [FIRST_YEAR [LAST_YEAR]]
"""
import codecs
import csv
import gzip
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'understat')
BASE = 'https://understat.com'
HEADERS = {'User-Agent': 'Mozilla/5.0 (fpl-squad-check-ml)', 'X-Requested-With': 'XMLHttpRequest'}
PEN_XG = 0.76  # Understat's xG for a penalty
FIELDS = ['match_id', 'date', 'h_team', 'a_team', 'player_id', 'player', 'team', 'h_a', 'minutes', 'shots', 'xg', 'npxg',
          'xa', 'key_passes', 'goals', 'assists', 'pens_taken']


# The JSON endpoints want the cookies the home page sets.
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
_warmed = False


def get(url, api=False):
    global _warmed
    if not _warmed:
        try:
            OPENER.open(urllib.request.Request(BASE + '/', headers={'User-Agent': HEADERS['User-Agent']}), timeout=30).read()
        except Exception as e:  # noqa: BLE001
            print(f'  home page: {e}', flush=True)
        _warmed = True
    headers = HEADERS if api else {'User-Agent': HEADERS['User-Agent']}
    for attempt in range(3):
        try:
            with OPENER.open(urllib.request.Request(url, headers=headers), timeout=30) as r:
                body = r.read()
            if body[:2] == b'\x1f\x8b':  # sent gzipped whether asked or not
                body = gzip.decompress(body)
            return body.decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            print(f'  {url}: {e} (attempt {attempt + 1})', flush=True)
            time.sleep(3 * (attempt + 1))
    return None


def api_json(path):
    raw = get(BASE + path, api=True)
    if raw and raw.lstrip().startswith(('{', '[')):
        return json.loads(raw)
    print(f'  {path}: not JSON: {(raw or "")[:200]!r}', flush=True)
    return None


def embedded(html, name):
    """A `var name = JSON.parse('...')` block from an Understat page."""
    m = re.search(rf"var\s+{name}\s*=\s*JSON\.parse\('(.*?)'\)", html or '', re.S)
    if not m:
        return None
    return json.loads(codecs.decode(m.group(1), 'unicode_escape'))


def league_matches(year):
    """Finished matches of the season starting in `year`: [{id, date, h, a}]."""
    d = api_json(f'/getLeagueData/EPL/{year}')
    data = d.get('dates') if isinstance(d, dict) else None
    if data is None:  # the older page layout, with the data in the HTML
        data = embedded(get(f'{BASE}/league/EPL/{year}'), 'datesData')
    if data is None:
        raise RuntimeError(f'no match list for {year}: the page layout may have changed')
    return [{'id': m['id'], 'date': m['datetime'][:10], 'h': m['h']['title'], 'a': m['a']['title']}
            for m in data if m.get('isResult')]


def match_rows(m):
    d = api_json(f'/getMatchData/{m["id"]}')
    rosters, shots = (d.get('rosters'), d.get('shots')) if isinstance(d, dict) else (None, None)
    if rosters is None:  # the older page layout
        html = get(f'{BASE}/match/{m["id"]}')
        rosters, shots = embedded(html, 'rostersData'), embedded(html, 'shotsData')
    if rosters is None:
        return None
    pens = {}
    for side in ('h', 'a'):
        for s in (shots or {}).get(side, []):
            if s.get('situation') == 'Penalty':
                pens[str(s.get('player_id'))] = pens.get(str(s.get('player_id')), 0) + 1
    rows = []
    for side in ('h', 'a'):
        for p in (rosters.get(side) or {}).values():
            pid = str(p.get('player_id'))
            xg = float(p.get('xG') or 0)
            rows.append({
                'match_id': m['id'], 'date': m['date'], 'h_team': m['h'], 'a_team': m['a'], 'player_id': pid,
                'player': p.get('player'), 'team': m['h'] if side == 'h' else m['a'], 'h_a': side,
                'minutes': int(p.get('time') or 0), 'shots': int(p.get('shots') or 0), 'xg': round(xg, 4),
                'npxg': round(max(0.0, xg - PEN_XG * pens.get(pid, 0)), 4), 'xa': round(float(p.get('xA') or 0), 4),
                'key_passes': int(p.get('key_passes') or 0), 'goals': int(p.get('goals') or 0),
                'assists': int(p.get('assists') or 0), 'pens_taken': pens.get(pid, 0),
            })
    return rows


def season(year, current):
    name = f'{year}-{(year + 1) % 100:02d}'
    path = os.path.join(OUT, f'{name}.csv')
    if os.path.exists(path) and not current:
        print(name, 'already imported')
        return
    done = set()
    rows = []
    if os.path.exists(path):  # the current season: only fetch new matches
        with open(path) as f:
            rows = list(csv.DictReader(f))
        done = {r['match_id'] for r in rows}
    matches = [m for m in league_matches(year) if m['id'] not in done]
    print(name, len(matches), 'matches to fetch', flush=True)
    failed = 0
    for i, m in enumerate(matches):
        got = match_rows(m)
        if got is None:
            failed += 1
        else:
            rows.extend(got)
        if i % 50 == 0:
            print(f'  {i}/{len(matches)}', flush=True)
        time.sleep(1)
    os.makedirs(OUT, exist_ok=True)
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(name, len(rows), 'player-matches written,', failed, 'matches failed', flush=True)


def main():
    now = datetime.now(timezone.utc)
    this_season = now.year if now.month >= 7 else now.year - 1
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 2020
    last = int(sys.argv[2]) if len(sys.argv) > 2 else this_season
    for year in range(first, last + 1):
        season(year, current=year == this_season)


if __name__ == '__main__':
    main()
