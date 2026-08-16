import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { runCrossDomainMigration, runLegacyOriginHandoff } from './lib/utils/crossDomainMigration'

async function boot() {
  if (await runLegacyOriginHandoff()) return

  await runCrossDomainMigration()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  )
}

boot()
