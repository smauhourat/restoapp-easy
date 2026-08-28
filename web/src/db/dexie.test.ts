import { beforeEach, describe, expect, it } from 'vitest'
import type { ConteoItem, Producto, Proveedor } from '@resto/shared'
import { aplicarDelServidor, camposLocales, db, escribirLocal } from './dexie.js'

/**
 * Tests de la capa offline.
 *
 * Es la parte del sistema donde el proyecto se gana o se pierde: si un conteo
 * hecho sin senal se pierde o se pisa, el encargado vuelve al papel. Corren
 * contra IndexedDB de verdad (fake-indexeddb), no contra un mock.
 */

const ahora = '2026-08-28T12:00:00.000Z'

const producto = (id: string, o: Partial<Producto> = {}): Producto => ({
  id, nombre: 'X', familia: null, unidad: 'kg', proveedorId: 'prov1',
  sector: 'camara', ordenRecorrido: 100, stockMinimo: 10, precioUnitario: null,
  cantidadBulto: null, precioBulto: null, activo: true,
  serverSeq: '1', updatedAt: ahora, deletedAt: null, ...o,
})

const item = (id: string, o: Partial<ConteoItem> = {}): ConteoItem => ({
  id, conteoId: 'c1', productoId: 'p1', stockActual: 4, cantidadPedir: 6,
  clientUpdatedAt: ahora, ...camposLocales(ahora), ...o,
})

const vacio = {
  proveedores: [] as Proveedor[], productos: [] as Producto[],
  conteos: [], conteoItems: [] as ConteoItem[], pedidos: [], pedidoItems: [],
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('escribirLocal', () => {
  it('guarda la fila y encola la mutacion en la misma operacion', async () => {
    await escribirLocal('conteoItem', item('i1'))

    expect(await db.conteoItems.get('i1')).toMatchObject({ stockActual: 4 })
    const cola = await db.outbox.toArray()
    expect(cola).toHaveLength(1)
    expect(cola[0]).toMatchObject({ entity: 'conteoItem', op: 'upsert', intentos: 0 })
    expect((cola[0]!.payload as { id: string }).id).toBe('i1')
  })

  it('encola una mutacion por cada edicion, en orden', async () => {
    await escribirLocal('conteoItem', item('i1', { stockActual: 4 }))
    await escribirLocal('conteoItem', item('i1', { stockActual: 2 }))

    // Una sola fila -- la ultima gana -- pero dos mutaciones: el servidor
    // tiene que poder reconstruir la secuencia de ediciones.
    expect(await db.conteoItems.count()).toBe(1)
    expect(await db.conteoItems.get('i1')).toMatchObject({ stockActual: 2 })
    const cola = await db.outbox.orderBy('seq').toArray()
    expect(cola.map((m) => (m.payload as { stockActual: number }).stockActual)).toEqual([4, 2])
  })

  it('marca las filas locales como no confirmadas', async () => {
    await escribirLocal('conteoItem', item('i1'))
    expect((await db.conteoItems.get('i1'))?.serverSeq).toBe('0')
  })
})

describe('aplicarDelServidor', () => {
  it('guarda el maestro que baja del servidor', async () => {
    await aplicarDelServidor({ ...vacio, productos: [producto('p1'), producto('p2')] })
    expect(await db.productos.count()).toBe(2)
  })

  it('borra del almacen local las filas dadas de baja', async () => {
    await aplicarDelServidor({ ...vacio, productos: [producto('p1')] })
    await aplicarDelServidor({
      ...vacio,
      productos: [producto('p1', { deletedAt: '2026-08-28T13:00:00.000Z' })],
    })
    expect(await db.productos.get('p1')).toBeUndefined()
  })

  it('no encola en la outbox lo que viene del servidor', async () => {
    await aplicarDelServidor({ ...vacio, productos: [producto('p1')] })
    // Reencolarlo lo mandaria de vuelta al servidor en un ciclo infinito.
    expect(await db.outbox.count()).toBe(0)
  })

  /**
   * El caso que importa de verdad: contar sin senal y que un pull posterior
   * no borre lo contado. El servidor todavia no vio esa edicion, asi que lo
   * que manda es necesariamente mas viejo.
   */
  it('NO pisa una fila con mutaciones pendientes', async () => {
    await escribirLocal('conteoItem', item('i1', { stockActual: 2 }))

    await aplicarDelServidor({
      ...vacio,
      conteoItems: [item('i1', {
        stockActual: 99, serverSeq: '500', updatedAt: '2026-08-28T14:00:00.000Z',
      })],
    })

    expect(await db.conteoItems.get('i1')).toMatchObject({ stockActual: 2 })
  })

  it('aplica la version del servidor una vez confirmada la mutacion', async () => {
    await escribirLocal('conteoItem', item('i1', { stockActual: 2 }))
    // El push confirmo y saco la mutacion de la cola.
    await db.outbox.clear()

    await aplicarDelServidor({
      ...vacio,
      conteoItems: [item('i1', { stockActual: 99, serverSeq: '500' })],
    })

    expect(await db.conteoItems.get('i1')).toMatchObject({ stockActual: 99, serverSeq: '500' })
  })

  it('el maestro siempre gana, aunque haya pendientes de otra entidad', async () => {
    await escribirLocal('conteoItem', item('i1'))
    await aplicarDelServidor({ ...vacio, productos: [producto('p1', { nombre: 'NUEVO' })] })
    expect(await db.productos.get('p1')).toMatchObject({ nombre: 'NUEVO' })
  })
})
