// Counts one use of a feature (see src/lib/usage.js for the names). Never
// waits and never fails: a count lost to a bad connection doesn't matter.
export function track(name) {
  try {
    fetch('/api/auth', {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'event', name }),
    }).catch(() => {});
  } catch { /* no fetch: nothing to count with */ }
}
