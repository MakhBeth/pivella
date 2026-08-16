# **Piv**ell**a**

**Pivella** - Gestione P.IVA Semplificata

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
