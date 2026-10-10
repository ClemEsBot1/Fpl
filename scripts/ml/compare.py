"""Walk-forward comparison of model variants (see model.py), to decide what
goes into the daily model. Each test season is predicted only from earlier
seasons plus that season's finished gameweeks, refitting every
--refit-every gameweeks. For each variant it prints next-gameweek and
4-week accuracy and writes <out>/<variant>.json for
  NO_XP=1 ML_PREDS=<out>/<variant>.json node scripts/backtest.mjs
(the points of the best XI picked from those predictions).

  python scripts/ml/compare.py --variants base,all,all_tweedie --out /tmp/cmp
"""
import argparse
import json
import os
import pickle
import sys
import time
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F  # noqa: E402
import matchdata as M  # noqa: E402
import model as ML  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SEASONS = ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26']
NO_MATCH = ('elo_', 'odds_')

VARIANTS = {
    'base': dict(drop=NO_MATCH),  # the model before this change
    'elo': dict(drop=('odds_',)),
    'odds': dict(drop=('elo_',)),
    'all': dict(),
    'all_tweedie': dict(objective='tweedie'),
    'all_poisson': dict(objective='poisson'),
    'all_decay': dict(decay=0.8),
    'all_two_stage': dict(two_stage=True),
}


def load_rows(cache, rows_cache):
    if rows_cache and os.path.exists(rows_cache):
        return pickle.load(open(rows_cache, 'rb'))
    rows = F.build(cache, SEASONS, md=M.MatchData())
    if rows_cache:
        pickle.dump(rows, open(rows_cache, 'wb'))
    return rows


def walk_forward(rows, cfg, tests, refit_every):
    preds = []
    for test in tests:
        past = rows[rows.season.isin(SEASONS[:SEASONS.index(test)])]
        cur = rows[rows.season == test]
        gws = sorted(cur.gw.unique())
        for i in range(0, len(gws), refit_every):
            block = gws[i:i + refit_every]
            known = cur[(cur.gw + cur.k) < block[0]]
            m = ML.train(pd.concat([past, known]), cfg)
            part = cur[cur.gw.isin(block)].copy()
            part['ml'] = m.predict(part)
            preds.append(part[['season', 'gw', 'id', 'k', 'ml', 'target']])
    return pd.concat(preds)


def summarise(P):
    nxt = P[P.k == 0]
    four = P[P.k < 4].groupby(['season', 'gw', 'id']).agg(p=('ml', 'mean'), a=('target', 'mean'), n=('k', 'count')).reset_index()
    four = four[four.n == 4]
    corr = lambda a, b: float(np.corrcoef(a, b)[0, 1])
    return {
        'nextMAE': round(float(np.mean(np.abs(nxt.ml - nxt.target))), 3), 'nextCorr': round(corr(nxt.ml, nxt.target), 4),
        'fourMAE': round(float(np.mean(np.abs(four.p - four.a))), 3), 'fourCorr': round(corr(four.p, four.a), 4),
    }


def to_json(P):
    nxt = P[P.k == 0].set_index(['season', 'gw', 'id']).ml
    four = P[P.k < 4].groupby(['season', 'gw', 'id']).ml.mean()
    out = {}
    for (s, g, i), v in nxt.items():
        out.setdefault(s, {}).setdefault(int(g), {})[int(i)] = [round(max(0.0, float(v)), 2), round(max(0.0, float(four.get((s, g, i), v))), 2)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.backtest-cache'))
    ap.add_argument('--rows', help='pickle of built rows, reused across runs')
    ap.add_argument('--variants', default=','.join(VARIANTS))
    ap.add_argument('--configs', help='JSON {name: config} of extra variants')
    ap.add_argument('--test', default='2022-23,2023-24,2024-25,2025-26')
    ap.add_argument('--refit-every', type=int, default=4)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    variants = dict(VARIANTS)
    if args.configs:
        variants.update(json.loads(args.configs))
    rows = load_rows(args.cache, args.rows)
    rows = rows[rows.known]
    tests = args.test.split(',')
    for name in args.variants.split(','):
        t = time.time()
        P = walk_forward(rows, variants[name], tests, args.refit_every)
        with open(os.path.join(args.out, f'{name}.json'), 'w') as f:
            json.dump(to_json(P), f)
        print(json.dumps({'variant': name, **summarise(P), 'secs': round(time.time() - t)}), flush=True)


if __name__ == '__main__':
    main()
