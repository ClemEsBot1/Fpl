// Notifications for alerts (src/lib/alerts.js). They come from this page
// while it's open, or the installed app while it's running; with the app
// closed they come by Web Push (src/lib/push.js) when the server has it
// set up: switching notifications on subscribes this browser, with your
// squad's player ids so the server knows whose news to send.

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

const PUSH_KEY = 'fpl_push_players';

function base64UrlToBytes(text) {
  const padded = (text + '='.repeat((4 - (text.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function pushRegistration() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return navigator.serviceWorker.getRegistration().catch(() => null);
}

// Subscribes this browser to pushed alerts for `playerIds` (your squad), or
// updates the squad on its subscription. Only re-sent when the squad has
// changed. Quietly does nothing when push isn't available here or on the
// server.
export async function syncPush(playerIds) {
  if (notificationState() !== 'on') return;
  const ids = [...playerIds].sort((a, b) => a - b).join(',');
  let last = null;
  try { last = localStorage.getItem(PUSH_KEY); } catch { /* storage unavailable */ }
  const reg = await pushRegistration();
  if (!reg) return;
  let sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub && last === ids) return;
  if (!sub) {
    const res = await fetch('/api/auth?push=key').catch(() => null);
    if (!res || !res.ok) return;
    const { publicKey } = await res.json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }).catch(() => null);
    if (!sub) return;
  }
  const saved = await fetch('/api/auth?push=subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), playerIds }),
  }).catch(() => null);
  if (saved && saved.ok) {
    try { localStorage.setItem(PUSH_KEY, ids); } catch { /* storage unavailable */ }
  }
}

// Stops pushed alerts to this browser.
export async function stopPush() {
  try { localStorage.removeItem(PUSH_KEY); } catch { /* storage unavailable */ }
  const reg = await pushRegistration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return;
  await fetch('/api/auth?push=unsubscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => null);
  await sub.unsubscribe().catch(() => {});
}
