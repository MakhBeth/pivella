import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { runCrossDomainMigration, runLegacyOriginHandoff } from './lib/utils/crossDomainMigration'

async function boot() {
  if (await runLegacyOriginHandoff()) return

  await runCrossDomainMigration()
  // Senza storage persistente Chrome può evincere IndexedDB quando il disco è
  // quasi pieno (successo il 2026-08-31: dati utente cancellati dal browser).
  navigator.storage?.persist?.().catch(() => {})
  // La rotella su un campo numero con il focus ne cambia il valore senza che
  // l'utente se ne accorga: si toglie il focus e la rotella scorre la pagina.
  document.addEventListener('wheel', (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement && target.type === 'number' && target === document.activeElement) target.blur()
  }, { passive: true, capture: true })
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  )
}

boot()
