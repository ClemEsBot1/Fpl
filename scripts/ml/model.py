"""Training and prediction for the points model, shared by retrain.py (the
daily run), evaluate.py and compare.py (the walk-forward tests), so all
three train exactly the same way.

A config chooses:
  objective   'regression' (squared error), 'tweedie' or 'poisson'. Points
              are skewed (mostly 0-3, rare hauls); the last two model that
              shape, and train on points floored at 0.
  decay       weight of each older season relative to the next newer one
              (None: every season counts the same).
  two_stage   predict the chance of playing at all and the points if he
              plays, separately, and multiply them.
  drop        feature-name prefixes to leave out (to test what each adds).
  odds_dropout  share of training rows whose odds are blanked, so the model
              still predicts sensibly in a week the odds couldn't be fetched.
  params, rounds  LightGBM settings.
"""
import lightgbm as lgb
import numpy as np

import features as F

BASE_PARAMS = dict(learning_rate=0.03, num_leaves=31, min_data_in_leaf=200, feature_fraction=0.8,
                   bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=1, num_threads=0)

DEFAULT = dict(objective='regression', decay=None, two_stage=False, drop=(), params={}, rounds=300, odds_dropout=0)


def columns(rows, cfg):
    return [c for c in F.feature_columns(rows) if not any(c.startswith(p) for p in cfg.get('drop', ()))]


def _weights(rows, decay):
    if not decay:
        return None
    start = rows.season.str[:4].astype(int)
    return (decay ** (start.max() - start)).values


def _params(cfg, objective):
    p = {**BASE_PARAMS, **cfg.get('params', {}), 'objective': objective}
    if objective == 'tweedie':
        p.setdefault('tweedie_variance_power', 1.2)
    return p


def _label(rows, objective):
    y = rows.target.values
    return np.maximum(y, 0) if objective in ('tweedie', 'poisson') else y


class Model:
    def __init__(self, cfg, cols, reg, clf=None):
        self.cfg, self.cols, self.reg, self.clf = cfg, cols, reg, clf

    def predict(self, rows):
        x = rows[self.cols]
        pts = self.reg.predict(x)
        if self.clf is not None:
            pts = self.clf.predict(x) * pts
        return pts


def train(rows, cfg=None):
    """Trains on `rows` (all with known targets)."""
    cfg = {**DEFAULT, **(cfg or {})}
    cols = columns(rows, cfg)
    odds_cols = [c for c in cols if c.startswith('odds_')]
    if cfg['odds_dropout'] and odds_cols:
        rows = rows.copy()
        hide = np.random.default_rng(1).random(len(rows)) < cfg['odds_dropout']
        rows.loc[hide, odds_cols] = np.nan
    obj = cfg['objective']
    w = _weights(rows, cfg['decay'])
    rounds = cfg['rounds']
    if not cfg['two_stage']:
        ds = lgb.Dataset(rows[cols], _label(rows, obj), weight=w)
        return Model(cfg, cols, lgb.train(_params(cfg, obj), ds, num_boost_round=rounds))
    played = (rows.target_min.values > 0)
    clf = lgb.train(_params(cfg, 'binary'), lgb.Dataset(rows[cols], played.astype(float), weight=w), num_boost_round=rounds)
    sub = rows[played]
    ws = w[played] if w is not None else None
    reg = lgb.train(_params(cfg, obj), lgb.Dataset(sub[cols], _label(sub, obj), weight=ws), num_boost_round=rounds)
    return Model(cfg, cols, reg, clf)
