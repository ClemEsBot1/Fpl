// The bars along the top of the screen: confirm your email, FPL's data
// being out of date, the iPhone install tip and the Android tester call.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { onFplStale } from '../lib/fplClient.js';
import { showIosInstallTip } from '../lib/iosInstall.js';
import { TESTER_GROUP_URL, TESTER_OPT_IN_URL, isAppLaunch, showTesterBar } from '../lib/androidTesters.js';
import { fmtTime, t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

// The Android tester bar: hidden for good once closed, or once this
// browser has been opened by the app (the app shares its storage).
const TESTER_BAR_KEY = 'fpl_tester_bar';
function readTesterBarShown() {
  if (typeof window === 'undefined') return false;
  let stored = null;
  try { stored = localStorage.getItem(TESTER_BAR_KEY); } catch { /* storage unavailable */ }
  const inApp = stored === 'app' || isAppLaunch(document.referrer);
  if (inApp && stored !== 'app') { try { localStorage.setItem(TESTER_BAR_KEY, 'app'); } catch { /* storage unavailable */ } }
  const standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return showTesterBar({ userAgent: navigator.userAgent, referrer: document.referrer, standalone, inApp, dismissed: stored === 'hidden' });
}
// The iPhone "Add to Home Screen" tip, hidden for good once closed.
const IOS_TIP_KEY = 'fpl_ios_tip';
function readIosTipShown() {
  if (typeof window === 'undefined') return false;
  let dismissed = false;
  try { dismissed = localStorage.getItem(IOS_TIP_KEY) === 'hidden'; } catch { /* storage unavailable */ }
  const standalone = navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return showIosInstallTip({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0, standalone, dismissed });
}
function writeTesterBarHidden() {
  try { localStorage.setItem(TESTER_BAR_KEY, 'hidden'); } catch { /* storage unavailable */ }
}

export function NoticeBars({ stage, session, onEnterCode }) {
  // The "confirm your email" bar, hidden for this visit once dismissed.
  const [verifyBarHidden, setVerifyBarHidden] = useState(false);
  const [testerBarShown, setTesterBarShown] = useState(readTesterBarShown);
  const [iosTipShown, setIosTipShown] = useState(readIosTipShown);
  // When FPL is down: the time of the saved data being shown instead.
  const [fplStaleAt, setFplStaleAt] = useState(null);
  useEffect(() => onFplStale(setFplStaleAt), []);

  const verifyBarShown = !!(session && session.email && !session.emailVerified && !verifyBarHidden);
  const inApp = stage !== 'welcome' && stage !== 'boot';
  return (
    <>
      {verifyBarShown && stage !== 'welcome' && (
        <div className="fpl-verify-bar" role="status">
          <span>{t('Confirm your email to get password reset codes and deadline emails.')}</span>
          <button type="button" className="fpl-btn fpl-btn-solid" onClick={onEnterCode}>{t('Enter code')}</button>
          <button type="button" className="fpl-verify-bar-x" aria-label={t('Hide for now')} onClick={() => setVerifyBarHidden(true)}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      {fplStaleAt && inApp && (
        <div className="fpl-verify-bar" role="status">
          <span>{t('FPL is updating right now, so this shows its data from {time}. It refreshes once FPL is back.', { time: fmtTime(fplStaleAt, { hour: '2-digit', minute: '2-digit' }) })}</span>
          <button type="button" className="fpl-verify-bar-x" aria-label={t('Hide')} onClick={() => setFplStaleAt(null)}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      {iosTipShown && inApp && (
        <div className="fpl-verify-bar" role="status">
          <span>{tr('Get FPL Checker on your iPhone: tap <b>Share</b> ⬆︎, then <b>Add to Home Screen</b>.', undefined, { b: s => <b>{s}</b> })}</span>
          <button type="button" className="fpl-verify-bar-x" aria-label={t('Don’t show again')} onClick={() => { try { localStorage.setItem(IOS_TIP_KEY, 'hidden'); } catch { /* storage unavailable */ } setIosTipShown(false); }}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      {testerBarShown && !verifyBarShown && inApp && (
        <div className="fpl-verify-bar fpl-tester-bar" role="status">
          <span>{t('Help test the FPL Checker Android app on Google Play for 2 weeks. Join the group, then tap Become a tester.')}</span>
          <a className="fpl-btn" href={TESTER_GROUP_URL} target="_blank" rel="noopener noreferrer">{t('1. Join group')}</a>
          <a className="fpl-btn fpl-btn-solid" href={TESTER_OPT_IN_URL} target="_blank" rel="noopener noreferrer">{t('2. Become a tester')}</a>
          <button type="button" className="fpl-verify-bar-x" aria-label={t('Don’t show again')} onClick={() => { writeTesterBarHidden(); setTesterBarShown(false); }}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
    </>
  );
}
