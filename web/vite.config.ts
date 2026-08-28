import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Habilita el service worker con `vite dev`, para poder probar el modo
      // avion sin hacer un build. El riesgo #1 del proyecto es que la app no
      // arranque sin senal; tiene que ser trivial de verificar.
      devOptions: { enabled: true, type: 'module' },
      workbox: {
        /**
         * Se precachea TODO el shell de la aplicacion.
         *
         * No hay ninguna estrategia de red en el camino critico del conteo, y
         * es a proposito: la UI lee siempre de IndexedDB y la red solo
         * alimenta a IndexedDB por atras. Una estrategia network-first sobre
         * el shell haria que la app tarde en abrir -- o directamente no abra
         * -- dentro de un deposito sin senal, que es exactamente donde se usa.
         */
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // La API nunca se cachea: los datos viven en IndexedDB, no en el
        // cache HTTP. Cachearla daria respuestas viejas indistinguibles de
        // las frescas.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Pedidos de insumos',
        short_name: 'Pedidos',
        description: 'Conteo de depósito y armado de pedidos por proveedor',
        theme_color: '#1c1f24',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // El front corre en 5173 y la API en 3001. El proxy los pone en el mismo
    // origen durante el desarrollo, asi el service worker ve las llamadas a
    // /api como propias y no hay CORS de por medio.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
