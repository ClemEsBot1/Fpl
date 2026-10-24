import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import { registerServiceWorker } from './lib/pwa.js'
import { initLanguage } from './lib/i18nLoad.js'
import { applyTheme, watchSystemTheme } from './lib/theme.js'

// Light or dark before anything is drawn (src/lib/theme.js).
applyTheme()
watchSystemTheme()

// The language's dictionary loads first, and the app's code only after it,
// so text built when a module loads (menus, lists of labels) is already
// translated.
initLanguage().finally(async () => {
  const { default: App } = await import('./App.jsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

registerServiceWorker()
