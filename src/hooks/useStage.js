// Which screen is shown, and the loading and error screens in between.
import { useRef, useState } from 'react';

export function useStage() {
  // 'boot' until we know whether someone is logged in: the welcome page
  // is for people who aren't, everyone else starts on Home.
  const [stage, setStageRaw] = useState('boot');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // An optional way forward offered on the error screen: { label, run }.
  const [errorAction, setErrorAction] = useState(null);

  // Every navigation and every load takes a ticket. A load only changes
  // the screen if no newer navigation or load has happened since it
  // started, so tapping Home (or starting something else) while a slow
  // lookup is running can't be overridden by that lookup finishing later.
  const ticketRef = useRef(0);
  const newTicket = () => { ticketRef.current += 1; return ticketRef.current; };
  const isCurrent = ticket => ticket === ticketRef.current;
  // Navigating somewhere abandons whatever was loading.
  function setStage(next) {
    newTicket();
    setStageRaw(next);
  }
  // For use inside a load: change the screen only if the load is current.
  function showStage(ticket, next) {
    if (isCurrent(ticket)) setStageRaw(next);
  }
  function showLoading(ticket, message) {
    if (!isCurrent(ticket)) return;
    setLoadingMessage(message);
    setStageRaw('loading');
  }
  function showError(ticket, message, action = null) {
    if (!isCurrent(ticket)) return;
    setErrorMessage(message);
    setErrorAction(action);
    setStageRaw('error');
  }

  return { stage, setStage, setStageRaw, newTicket, isCurrent, showStage, showLoading, showError, loadingMessage, errorMessage, errorAction };
}
