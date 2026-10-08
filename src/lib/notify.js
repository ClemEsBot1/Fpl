// Notifications for alerts (src/lib/alerts.js). They come from this page
// while it's open, or the installed app while it's running: nothing is
// sent with the app closed, which would need a push server.

const PREF_KEY = 'fpl_notify';
const SENT_KEY = 'fpl_alerts_sent';
const MAX_SENT = 200;

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

// 'on', 'off', 'blocked' (the browser said no) or 'unsupported'.
export function notificationState() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  let pref = null;
  try { pref = localStorage.getItem(PREF_KEY); } catch { /* storage unavailable */ }
  return Notification.permission === 'granted' && pref === '1' ? 'on' : 'off';
}

export async function setNotifications(on) {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  if (!on || !notificationsSupported()) return notificationState();
  if (Notification.permission === 'default') await Notification.requestPermission();
  return notificationState();
}

function readSent() {
  try {
    const list = JSON.parse(localStorage.getItem(SENT_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

async function show(alert) {
  const options = { body: alert.body, tag: alert.id, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
  if (reg && reg.showNotification) return reg.showNotification(alert.title, options);
  return new Notification(alert.title, options);
}

// Sends each alert not sent before, when notifications are on. Alerts
// already showing when they're switched on count as sent, so turning them
// on doesn't fire a burst.
export async function notifyNewAlerts(alerts, { markOnly = false } = {}) {
  if (notificationState() !== 'on' && !markOnly) return;
  const sent = readSent();
  const fresh = alerts.filter(a => !sent.includes(a.id));
  if (!fresh.length) return;
  if (!markOnly) await Promise.all(fresh.map(a => show(a).catch(() => {})));
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...sent, ...fresh.map(a => a.id)].slice(-MAX_SENT))); } catch { /* storage unavailable */ }
}
