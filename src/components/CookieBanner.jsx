// Asks once whether visit counts and page-speed measurement may run
// (src/lib/consent.js). Accept and Reject are the same size and weight, so
// saying no is as easy as saying yes. It sits above the footer menu and
// doesn't block the page.
import { Cookie } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

export function CookieBanner({ onChoose }) {
  return (
    <section className="fpl-glass fpl-cookie" role="region" aria-labelledby="cookie-h">
      <h2 id="cookie-h" className="fpl-cookie-h"><Cookie size={16} aria-hidden="true" /> {t('Cookies')}</h2>
      <p className="fpl-cookie-text">
        {t('We use one cookie to keep you logged in. With your OK, we also count visits and measure page speed with Vercel Analytics, which doesn’t identify you. No ads.')}
        {' '}{tr('<a>Privacy notice</a>', undefined, { a: s => <a href={`${TERMS_PATH}#privacy`} target="_blank" rel="noopener">{s}</a> })}
      </p>
      <div className="fpl-cookie-actions">
        <button type="button" className="fpl-btn" onClick={() => onChoose(false)}>{t('Reject')}</button>
        <button type="button" className="fpl-btn" onClick={() => onChoose(true)}>{t('Accept')}</button>
      </div>
    </section>
  );
}
