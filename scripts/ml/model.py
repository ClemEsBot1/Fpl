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
  calibrate   after training, correct any steady over- or under-prediction
              by position and price band, measured on the most recent
              gameweeks held out of a first fit.
  params, rounds  LightGBM settings.
"""
import lightgbm as lgb
import numpy as np

import features as F

BASE_PARAMS = dict(learning_rate=0.03, num_leaves=31, min_data_in_leaf=200, feature_fraction=0.8,
                   bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=1, num_threads=0)

DEFAULT = dict(objective='regression', decay=None, two_stage=False, drop=(), params={}, rounds=300, odds_dropout=0,
               calibrate=False)

PRICE_BANDS = [5.0, 6.5, 8.5]  # < £5.0m, £5.0-6.5m, £6.5-8.5m, £8.5m+
CAL_SHRINK = 300  # rows' worth of pull towards no correction
CAL_HOLDOUT = 0.15  # share of the most recent training gameweeks held out


def _cal_group(rows):
    band = np.searchsorted(PRICE_BANDS, rows.price.fillna(0).values, side='right')
    return rows.pos.values * 10 + band


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
    def __init__(self, cfg, cols, reg, clf=None, offsets=None):
        self.cfg, self.cols, self.reg, self.clf, self.offsets = cfg, cols, reg, clf, offsets or {}

    def predict(self, rows):
        x = rows[self.cols]
        pts = self.reg.predict(x)
        if self.clf is not None:
            pts = self.clf.predict(x) * pts
        if self.offsets:
            pts = pts + np.array([self.offsets.get(g, 0.0) for g in _cal_group(rows)])
        return pts


def train(rows, cfg=None):
    """Trains on `rows` (all with known targets)."""
    cfg = {**DEFAULT, **(cfg or {})}
    if cfg['calibrate']:
        # Hold out the latest gameweeks, fit on the rest, and measure the
        # average miss there by position and price band.
        order = rows.season.str[:4].astype(int) * 100 + rows.gw + rows.k
        cut = np.quantile(order, 1 - CAL_HOLDOUT)
        first = train(rows[order < cut], {**cfg, 'calibrate': False})
        held = rows[order >= cut]
        resid = held.target.values - first.predict(held)
        groups = _cal_group(held)
        offsets = {}
        for g in np.unique(groups):
            r = resid[groups == g]
            offsets[int(g)] = float(r.sum() / (len(r) + CAL_SHRINK))
        full = train(rows, {**cfg, 'calibrate': False})
        full.offsets = offsets
        return full
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


def train_quantiles(rows, cfg=None, alphas=(0.1, 0.9), rounds=200):
    """Models of the low and high end of a player's likely score this
    gameweek (k = 0 rows): {alpha: model}, for the range the app shows."""
    cfg = {**DEFAULT, **(cfg or {})}
    rows = rows[rows.k == 0]
    cols = columns(rows, cfg)
    out = {}
    for a in alphas:
        p = {**_params(cfg, 'quantile'), 'alpha': a}
        out[a] = Model(cfg, cols, lgb.train(p, lgb.Dataset(rows[cols], rows.target.values), num_boost_round=rounds))
    return out
