// How a player's price looks set to move at FPL's next change
// (predictPriceChange in src/lib/transferTrends.js), as a chip for lists.
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { t } from '../lib/i18n.js';

// FPL's own status ("Very likely to rise"), or for an estimate the
// change it would make ("+£0.1m likely").
export function PriceChip({ change }) {
  if (!change) return null;
  const rise = change.dir === 'rise';
  const Icon = rise ? ArrowUpRight : ArrowDownRight;
  const official = typeof change.percent === 'number';
  const strong = official ? change.confidence === 'very likely' : change.confidence === 'likely';
  const OFFICIAL = {
    'very likely': rise ? t('Very likely to rise') : t('Very likely to drop'),
    likely: rise ? t('Likely to rise') : t('Likely to drop'),
  };
  const ESTIMATE = { likely: t('likely'), possible: t('possible') };
  const label = official
    ? OFFICIAL[change.confidence] || change.confidence
    : `${rise ? '+' : '−'}£0.1m ${ESTIMATE[change.confidence] || change.confidence}`;
  return (
    <span className={`fpl-trend-chip ${rise ? 'is-rise' : 'is-fall'}${strong ? ' is-likely' : ''}`}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

