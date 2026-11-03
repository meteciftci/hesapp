import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'HesApp',
        short_name: 'HesApp',
        description: 'Ev bütçesi takibi',
        lang: 'tr',
        id: '/',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f3ef',
        theme_color: '#2a3fbf',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Yalnızca derlenmiş dosyalar (js, css, simgeler) önbelleğe alınır. index.html önbelleğe alınmaz:
      // sayfa her açılışta ağdan gelir, böylece yeni sürüm ve simge bağlantıları hemen görünür.
      // API istekleri ve oturum asla önbelleğe alınmaz.
      workbox: { importScripts: ['push-sw.js'], globPatterns: ['**/*.{js,css,png,ico,webmanifest}'], globIgnores: ['**/exceljs*.js'], navigateFallback: null, cleanupOutdatedCaches: true, runtimeCaching: [] },
    }),
    cloudflare(),
  ],
})
