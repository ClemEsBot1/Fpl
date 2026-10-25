// A dialog that the phone's Back button closes (see src/lib/backNav.js),
// for as long as the component is mounted.
import { useEffect, useRef } from 'react';
import { backNav } from '../lib/backNav.js';

export function useBackClose(onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!backNav) return undefined;
    const id = backNav.openDialog(() => closeRef.current());
    return () => backNav.closeDialog(id);
  }, []);
}
