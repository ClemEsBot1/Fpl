import { Component } from 'react';
import { ErrorScreen } from './common.jsx';
import { t } from '../lib/i18n.js';

// Shown instead of a blank page when a screen fails to render — most
// likely its code couldn't be downloaded (offline, or the app was updated
// since this page was opened and the old files are gone). A reload fixes
// both.
export class ScreenErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const screen = (
      <ErrorScreen
        message={t('Something went wrong showing this. Reloading usually fixes it: the app may have just been updated.')}
        retryLabel={t('Reload')}
        onRetry={() => window.location.reload()}
      />
    );
    return this.props.overlay ? <div className="fpl-dialog-card fpl-error-overlay">{screen}</div> : screen;
  }
}
