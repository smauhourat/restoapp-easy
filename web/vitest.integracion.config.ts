import { defineConfig } from 'vitest/config'

/**
 * Config del recorrido de integracion, que corre contra el catalogo real y
 * necesita el servidor levantado. Va aparte de vitest.config.ts para que
 * `npm test` siga funcionando sin base de datos ni servidor.
 *
 *   npm run dev -w @resto/server
 *   npm run test:integracion -w @resto/web
 */
export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup.ts'],
    environment: 'node',
    include: ['src/test/integracion.test.ts', 'src/test/sincronizacion.test.ts'],
    // En serie: comparten el servidor y la misma base.
    fileParallelism: false,
  },
})
