import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Pivella - Gestione P.IVA in forfettario',
        short_name: 'Pivella',
        description: 'App per gestire il regime forfettario italiano',
        theme_color: '#6366f1',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-resources',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      }
    })
  ],
  build: {
    modulePreload: {
      resolveDependencies: (filename, deps) => {
        // Don't preload heavy PDF-related chunks
        return deps.filter(dep =>
          !dep.includes('react-pdf') &&
          !dep.includes('FatturaCortesia') &&
          !dep.includes('CourtesyInvoice') &&
          !dep.includes('renderer')
        );
      },
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          // Icons
          if (id.includes('@hugeicons')) {
            return 'vendor-icons';
          }
          // Don't manually chunk @react-pdf - let Vite handle it with dynamic imports
          // to avoid circular dependency issues
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
