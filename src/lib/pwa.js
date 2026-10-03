// Installable-app support: registers the service worker (public/sw.js)
// and exposes Chrome's "install this app" prompt so the home screen can
// offer an Install button.
import { useEffect, useState } from 'react';

export function registerServiceWorker() {
  // Dev builds change on every save; a service worker would serve stale code.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Chrome fires beforeinstallprompt early, often before React mounts, so
// catch it at module load and hand it to whichever component asks.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn(deferredPrompt));
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // show our own button instead of the mini-infobar
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

// Returns install() while the browser says the app can be installed (it
// isn't yet, and the browser supports it), otherwise null.
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(deferredPrompt);
  useEffect(() => {
    listeners.add(setPrompt);
    return () => { listeners.delete(setPrompt); };
  }, []);
  if (!prompt) return null;
  return async () => {
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    // A prompt can only be used once; Chrome fires a new event if the
    // user dismissed it and may install later.
    deferredPrompt = null;
    notify();
  };
}
