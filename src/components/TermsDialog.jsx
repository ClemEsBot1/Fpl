// Shown the first time someone presses Start: a short summary of the Terms
// (the full text is at /terms) and one button to agree and carry on.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

export function TermsDialog({ onAgree, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);
  return (
    <dialog ref={dialogRef} className="fpl-dialog" aria-labelledby="terms-title" aria-describedby="terms-summary" onCancel={e => { e.preventDefault(); onClose(); }}>
      <div className="fpl-dialog-card">
        <button type="button" onClick={onClose} aria-label={t('Close')} className="fpl-dialog-close"><X size={18} /></button>
        <h2 id="terms-title" className="fpl-display" style={{ fontSize: '1.3rem', fontWeight: 700, margin: '0 0 12px', textAlign: 'center' }}>{t('Before you start')}</h2>
        <ul id="terms-summary" className="fpl-terms-list">
          <li>{t('FPL Checker is free and independent. It isn’t run by or linked to the Premier League or Fantasy Premier League.')}</li>
          <li>{t('Predictions are estimates, not promises. Decisions about your team are yours.')}</li>
          <li>{t('We store as little as we can. No ads and no selling your data. An account is optional.')}</li>
        </ul>
        <p className="fpl-meta" style={{ margin: '0 0 16px', textAlign: 'center' }}>
          {tr('Read the full <a>Terms and privacy notice</a>.', undefined, { a: s => <a href={TERMS_PATH} target="_blank" rel="noopener">{s}</a> })}
        </p>
        <button type="button" className="fpl-btn fpl-btn-solid" style={{ width: '100%' }} onClick={onAgree}>{t('Agree and continue')}</button>
      </div>
    </dialog>
  );
}
