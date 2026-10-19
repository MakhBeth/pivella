# **Piv**ell**a**

**Pivella** - Gestione P.IVA in forfettario

App per gestire il regime forfettario - P.IVA italiana

**Live version:** https://pivella.netlify.app/

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher recommended)
- npm (comes with Node.js)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/MakhBeth/pivella.git
cd pivella
```

2. Install dependencies:
```bash
npm install
```

### Running the Application

#### Development Mode

Start the development server with hot module replacement:
```bash
npm run dev
```

The application will be available at `http://localhost:5173` (default Vite port).

#### Production Build

Build the application for production:
```bash
npm run build
```

The built files will be in the `dist/` directory.

#### Preview Production Build

Preview the production build locally:
```bash
npm run preview
```

### Linting

Check TypeScript types without building:
```bash
npm run lint
```

## 🏗️ Project Structure

```
pivella/
├── src/
│   ├── components/          # React components
│   │   ├── Header.tsx       # Header component with navigation
│   │   ├── Header.module.css
│   │   ├── Footer.tsx       # Footer component
│   │   ├── Footer.module.css
│   │   ├── Home.tsx         # Main home page component
│   │   ├── Home.module.css
│   │   └── ForfettarioApp.tsx # Main app logic
│   ├── App.tsx              # Root App component
│   ├── App.module.css       # Global styles
│   └── main.tsx             # Application entry point
├── public/                  # Static assets
├── index.html              # HTML template
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
└── package.json            # Project dependencies and scripts
```

## 🤖 AI assistant (MCP server)

Pivella ships a local MCP server so that Claude, Codex, Cursor or any MCP client can read your data and propose changes, all on your computer. The assistant only proposes; you confirm in the app. It can also generate the FatturaPA XML or a courtesy PDF for a saved invoice, written into `documenti/<year>` in the sync folder without touching your Pivella data.

```sh
claude mcp add pivella -- npx -y pivella-mcp --dir /path/to/sync-folder
```

Setup for every client, how it works and how to publish the package: [mcp/README.md](mcp/README.md). Package on npm: [pivella-mcp](https://www.npmjs.com/package/pivella-mcp).

pivella-mcp 1.0 requires Pivella 7.0 and vice versa: the sync file moves to schema version 3. Update both together.

### Browser assistants (WebMCP, experimental)

In **Impostazioni → Assistente nel browser**, enable WebMCP to let a compatible browser assistant query the selected profile and draft an invoice directly from the open app. No Node installation, MCP server or sync folder is needed. The setting is off by default and can be disabled at any time. Your assistant receives the data returned by its tool calls; its own data handling policy still applies.

The initial tools are `list_users` (selected profile only), `list_clienti`, `list_fatture`, `get_riepilogo_anno`, `propose_fattura`, `list_proposals` and `get_proposal`. Proposals persist in this browser for review in **Impostazioni → Proposte dell’assistente**. Confirming revalidates the current data, assigns the invoice number and downloads the XML; rejecting leaves the accounting data unchanged. Drafts are not included in backups or sync files. Confirmed invoices follow the existing backup and sync flows.

WebMCP needs browser and agent support, and Pivella must remain open. It is not a remote MCP URL that can be added to any MCP client. Unsupported browsers show the integration as unavailable; the local MCP server remains available. For testing browser support, see the [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp). The adapter uses `document.modelContext` with registration abort signals, and also supports the earlier `navigator.modelContext` / `unregisterTool` API.

## 🛠️ Technologies

- **React** 18.2.0 - UI library
- **TypeScript** 5.9.3 - Type safety
- **Vite** 5.0.8 - Build tool and dev server
- **CSS Modules** - Scoped component styling
- **Recharts** - Charting library
- **Lucide React** - Icon library

## 📝 Development

### Component Structure

Each component follows this pattern:
- `ComponentName.tsx` - TypeScript React component with typed props
- `ComponentName.module.css` - CSS module for component-specific styles

### TypeScript

The project uses strict TypeScript configuration. All components are typed with proper interfaces for props and state.

## 📦 Build Output

The production build generates optimized static files including:
- Minified JavaScript bundles
- Optimized CSS
- Service Worker for PWA functionality
- Static assets

## 🔧 Configuration

### Vite

Configuration can be modified in `vite.config.ts`.

### TypeScript

TypeScript compiler options are in `tsconfig.json` and `tsconfig.node.json`.

## 📄 License

This project is part of the Pivella suite for managing Italian VAT regime (regime forfettario).

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🧪 The Vibecoding Experiment

This started as an experiment in pure vibecoding. V1 was built entirely with the Claude iOS app, but it couldn't handle deployment. After manually deploying and configuring Netlify (the meme "AI: why can't they see my new site on localhost" is real), I started using GitHub Copilot for new features.

It didn't go badly until: I found conflicts to resolve... in the `node_modules` folder, a couple of "undefined is not a function" (sigh), and most importantly, hallucinations. So I had to bring out Claude Code and managed to rewrite the project so it wasn't a complete mess anymore.

The vibecoding experiment failed on some CSS and UI bugs that I just couldn't solve with prompting alone, but the product is still nice and it's a tool I'm proud of. Let's see how it goes.

## Importazione dei movimenti bancari

Apri **Flussi di cassa** (su mobile: **Altro → Flussi di cassa**).

1. Crea un **Nuovo formato** e carica un CSV di esempio, oppure inserisci le intestazioni delle colonne.
2. Imposta separatore, codifica UTF-8/Windows-1252, riga delle intestazioni, formato data e separatore decimale.
3. Mappa data e descrizione, poi un importo con segno oppure due colonne di entrate/uscite positive. Data valuta e riferimento bancario univoco sono facoltativi.
4. Salva il formato. In **Importa movimenti**, scegli la definizione salvata, indica il conto e carica il CSV.
5. Controlla l'anteprima e conferma. Gli errori bloccano l'intero import; i movimenti già presenti vengono saltati. I file possono pesare al massimo 10 MB.

I movimenti sono in euro e separati per profilo. Mantieni lo stesso nome per lo stesso conto. Per distinguere con certezza movimenti identici, mappa l'ID univoco della banca: senza questo campo la deduplicazione confronta data, descrizione, importo, data valuta e occorrenze identiche nel documento. Estratti parziali con movimenti indistinguibili possono quindi essere considerati già importati.

Formati e movimenti sono inclusi nei backup e nella sincronizzazione. Il file di sincronizzazione usa lo schema v4, leggibile da questa versione dell'app e del server MCP; i file v1/v2/v3 restano importabili. Aggiorna anche gli altri dispositivi e il server MCP prima di usare lo stesso file di sincronizzazione.

I totali mostrano entrate, uscite e flusso netto dei movimenti filtrati per conto e intervallo di date; non rappresentano il saldo bancario e non modificano automaticamente le fatture.

I **Flussi di cassa** includono una proiezione mensile degli incassi delle fatture non ancora incassate, con data prevista modificabile anche dalla finestra “Modifica Data Incasso” in Fatture. Le previsioni senza data sono mostrate separatamente e non entrano nei totali mensili; le date previste non incidono sui conteggi fiscali.

Dai movimenti in entrata puoi ripartire un pagamento tra più fatture o registrare un acconto: ogni quota ha importo in centesimi e data del movimento. La ripartizione non può superare il bonifico né il residuo delle fatture. Puoi lasciare importi non attribuiti. Modificare o rimuovere una quota aggiorna gli incassi effettivi e il residuo; le proiezioni includono solo il residuo. Le fatture già saldate manualmente non sono proposte per un secondo incasso. Dashboard, Scadenze e riepiloghi MCP conteggiano le quote nell’anno in cui sono state ricevute.

Sono disponibili il grafico cumulato interattivo e la tabella mensile. I filtri **Dal/Al** sono inclusivi e condivisi anche dai movimenti; i preset sono **Ultimo anno**, **Prossimo anno**, **−1 / +1 anno** (predefinito) e **Tutte le date**. La proiezione aggrega tutti i conti, parte da zero nel periodo selezionato e non stima uscite future né saldo bancario. Il filtro conto dell’elenco movimenti riguarda solo quell’elenco.

La sezione è organizzata in **Panoramica**, **Movimenti** e **Incassi attesi**. Importazione e formati CSV sono accessibili da **Importa CSV**. Nei movimenti puoi cercare per descrizione/riferimento/documento e filtrare per conto o stato di riconciliazione; le entrate non interamente attribuite hanno un contatore dedicato. La riconciliazione si apre in un pannello laterale con riepilogo sempre visibile, suggerimenti da confermare e azioni per coprire il residuo o attribuire il disponibile. La chiusura con modifiche non salvate richiede una scelta esplicita. Dal grafico mensile/cumulato puoi aprire i movimenti o gli incassi attesi del mese selezionato.
