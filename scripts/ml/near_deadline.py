"""Prints run=true when an FPL deadline is less than HOURS hours away (for
the extra retrains before a deadline, which catch the last injury news
from press conferences), run=false otherwise. Appends to $GITHUB_OUTPUT
when set.

  python scripts/ml/near_deadline.py [HOURS]
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

HOURS = float(sys.argv[1]) if len(sys.argv) > 1 else 6


def next_deadline(events, now):
    times = [datetime.fromisoformat(e['deadline_time'].replace('Z', '+00:00')) for e in events if e.get('deadline_time')]
    upcoming = [t for t in times if t > now]
    return min(upcoming) if upcoming else None


def main():
    req = urllib.request.Request('https://fantasy.premierleague.com/api/bootstrap-static/', headers={'User-Agent': 'fpl-squad-check-ml'})
    with urllib.request.urlopen(req, timeout=30) as r:
        events = json.loads(r.read())['events']
    now = datetime.now(timezone.utc)
    nxt = next_deadline(events, now)
    run = bool(nxt and nxt - now <= timedelta(hours=HOURS))
    print(f'next deadline {nxt}, run={str(run).lower()}')
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as f:
            f.write(f'run={str(run).lower()}\n')


if __name__ == '__main__':
    main()
