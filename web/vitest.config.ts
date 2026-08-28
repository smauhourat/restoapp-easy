import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // fake-indexeddb da una implementacion real de IndexedDB en Node, asi que
    // los tests ejercitan el mismo Dexie que corre en el celular en vez de un
    // mock. La capa offline es donde se juega el proyecto: si estos tests
    // pasan contra un doble de prueba, no prueban nada.
    setupFiles: ['./src/test/setup.ts'],
    environment: 'node',
    // El recorrido de integracion necesita el servidor levantado, asi que no
    // corre por defecto. Se lanza a mano con:
    //   npx vitest run --mode integracion src/test/integracion.test.ts
    exclude: ['**/node_modules/**', '**/dist/**', '**/integracion.test.ts', '**/sincronizacion.test.ts'],
  },
})
