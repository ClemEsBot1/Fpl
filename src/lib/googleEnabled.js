import { useEffect, useState } from 'react';

// Whether "Continue with Google" is set up on this site (asked once).
let googleEnabledPromise = null;
export function useGoogleEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!googleEnabledPromise) {
      googleEnabledPromise = fetch('/api/auth?google=config').then(r => (r.ok ? r.json() : null)).then(d => !!(d && d.enabled)).catch(() => false);
    }
    let live = true;
    googleEnabledPromise.then(v => { if (live) setEnabled(v); });
    return () => { live = false; };
  }, []);
  return enabled;
}
