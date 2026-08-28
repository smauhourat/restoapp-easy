import { beforeEach, describe, expect, it } from 'vitest'
import type { Producto } from '@resto/shared'
import { db } from '../db/dexie.js'
import {
  asegurarConteoAbierto, estaContado, setCantidadPedir, setStockActual,
} from './conteo.js'

const ahora = '2026-08-28T12:00:00.000Z'

const producto = (id: string, o: Partial<Producto> = {}): Producto => ({
  id, nombre: 'MOZZARELLA', familia: null, unidad: 'kg', proveedorId: 'prov1',
  sector: 'camara', ordenRecorrido: 100, stockMinimo: 10, precioUnitario: null,
  cantidadBulto: null, precioBulto: null, activo: true,
  serverSeq: '1', updatedAt: ahora, deletedAt: null, ...o,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('asegurarConteoAbierto', () => {
  it('crea un conteo si no hay ninguno abierto', async () => {
    const c = await asegurarConteoAbierto('encargado')
    expect(c.estado).toBe('borrador')
    expect(await db.conteos.count()).toBe(1)
  })

  // Con varios celulares sobre el mismo conteo, un segundo dispositivo tiene
  // que sumarse al que ya existe en vez de arrancar uno paralelo.
  it('reutiliza el conteo abierto en vez de crear otro', async () => {
    const a = await asegurarConteoAbierto('encargado')
    const b = await asegurarConteoAbierto('otro')
    expect(b.id).toBe(a.id)
    expect(await db.conteos.count()).toBe(1)
  })

  it('deja el conteo encolado para subir', async () => {
    await asegurarConteoAbierto('encargado')
    const cola = await db.outbox.toArray()
    expect(cola).toHaveLength(1)
    expect(cola[0]?.entity).toBe('conteo')
  })
})

describe('setStockActual', () => {
  it('calcula solo la cantidad a pedir a partir del minimo', async () => {
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { stockMinimo: 10 }), 4)

    const i = await db.conteoItems.where('productoId').equals('p1').first()
    expect(i).toMatchObject({ stockActual: 4, cantidadPedir: 6 })
  })

  it('no pide nada si hay stock de sobra', async () => {
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { stockMinimo: 10 }), 15)
    const i = await db.conteoItems.where('productoId').equals('p1').first()
    expect(i?.cantidadPedir).toBe(0)
  })

  // Los 191 productos sin minimo: se puede registrar el stock, pero no hay
  // nada que calcular. La cantidad la escribe la persona.
  it('deja la cantidad en null si el producto no tiene minimo', async () => {
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { stockMinimo: null }), 4)
    const i = await db.conteoItems.where('productoId').equals('p1').first()
    expect(i).toMatchObject({ stockActual: 4, cantidadPedir: null })
  })

  it('reescribe el mismo item al recontar, sin duplicarlo', async () => {
    const c = await asegurarConteoAbierto('u')
    const p = producto('p1')
    await setStockActual(c, p, 4)
    await setStockActual(c, p, 7)

    const items = await db.conteoItems.where('conteoId').equals(c.id).toArray()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ stockActual: 7, cantidadPedir: 3 })
  })
})

describe('setCantidadPedir', () => {
  it('fija la cantidad sin tocar el stock contado', async () => {
    const c = await asegurarConteoAbierto('u')
    const p = producto('p1', { stockMinimo: null })
    await setStockActual(c, p, 2)
    await setCantidadPedir(c, p, 12)

    const i = await db.conteoItems.where('productoId').equals('p1').first()
    expect(i).toMatchObject({ stockActual: 2, cantidadPedir: 12 })
  })

  it('funciona sobre un producto que todavia no se conto', async () => {
    const c = await asegurarConteoAbierto('u')
    await setCantidadPedir(c, producto('p1', { stockMinimo: null }), 5)
    const i = await db.conteoItems.where('productoId').equals('p1').first()
    expect(i).toMatchObject({ stockActual: null, cantidadPedir: 5 })
  })
})

describe('estaContado', () => {
  // Contar 0 es una respuesta: "no queda nada". Distinta de no haber pasado.
  it('un stock de 0 cuenta como contado', () => {
    expect(estaContado({ stockActual: 0 } as never)).toBe(true)
    expect(estaContado({ stockActual: null } as never)).toBe(false)
    expect(estaContado(undefined)).toBe(false)
  })
})
