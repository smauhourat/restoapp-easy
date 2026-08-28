/**
 * Sincronizacion de dos dispositivos contra el servidor real.
 *
 * Simula el escenario del enunciado: dos celulares contando el mismo conteo,
 * los dos sin senal, y despues los dos vuelven online. Es el unico test que
 * puede detectar filas duplicadas o conteos pisados entre dispositivos.
 *
 * Necesita el servidor levantado y un usuario de prueba:
 *   npm run dev -w @resto/server
 *   npm run usuario -w @resto/server -- encargado 1234
 *   npm run test:integracion -w @resto/web
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  idConteo, idConteoItem, pullResponseSchema, pushResponseSchema,
  type Conteo, type ConteoItem, type Mutation, type Producto,
} from '@resto/shared'
import { api } from './api.js'

/**
 * Un dispositivo con su propia cola, sin IndexedDB.
 *
 * Los tests de dexie.test.ts ya cubren el almacen local; lo que se prueba
 * aca es el protocolo contra el servidor de verdad, asi que el cliente es
 * deliberadamente minimo.
 */
class Dispositivo {
  cola: Mutation[] = []
  filas = new Map<string, ConteoItem>()
  cursor = '0'

  constructor(readonly nombre: string) {}

  contar(conteo: Conteo, producto: Producto, stock: number, cuando: string) {
    const item: ConteoItem = {
      id: idConteoItem(conteo.id, producto.id),
      conteoId: conteo.id,
      productoId: producto.id,
      stockActual: stock,
      cantidadPedir: Math.max(0, (producto.stockMinimo ?? 0) - stock),
      clientUpdatedAt: cuando,
      serverSeq: '0', updatedAt: cuando, deletedAt: null,
    }
    this.filas.set(item.id, item)
    this.cola.push({
      mutationId: crypto.randomUUID(),
      entity: 'conteoItem',
      op: 'upsert',
      payload: item as unknown as Record<string, unknown>,
      clientUpdatedAt: cuando,
    })
  }

  encolarConteo(conteo: Conteo) {
    this.cola.push({
      mutationId: crypto.randomUUID(),
      entity: 'conteo',
      op: 'upsert',
      payload: conteo as unknown as Record<string, unknown>,
      clientUpdatedAt: new Date().toISOString(),
    })
  }

  async subir() {
    if (this.cola.length === 0) return { applied: [], rejected: [] }
    const r = await api('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ mutations: this.cola }),
    })
    const res = pushResponseSchema.parse(await r.json())
    const ok = new Set([...res.applied, ...res.rejected.map((x) => x.mutationId)])
    this.cola = this.cola.filter((m) => !ok.has(m.mutationId))
    return res
  }

  /**
   * Las filas del conteo en curso.
   *
   * Un dispositivo real guarda todos los conteos que bajo, incluidos los de
   * dias anteriores. Las aserciones tienen que mirar solo el conteo de esta
   * corrida o cuentan tambien el historial.
   */
  filasDe(conteo: Conteo): ConteoItem[] {
    return [...this.filas.values()].filter((i) => i.conteoId === conteo.id)
  }

  async bajar() {
    const r = await api(`/api/sync/pull?since=${this.cursor}`)
    const datos = pullResponseSchema.parse(await r.json())
    for (const i of datos.conteoItems) {
      if (i.deletedAt !== null) this.filas.delete(i.id)
      else this.filas.set(i.id, i)
    }
    this.cursor = datos.serverSeq
    return datos
  }
}

let productos: Producto[] = []
let conteo: Conteo

beforeAll(async () => {
  const r = await api('/api/sync/pull?since=0')
  if (!r.ok) throw new Error(`el servidor no responde (${r.status})`)
  const datos = pullResponseSchema.parse(await r.json())
  productos = datos.productos.filter((p) => p.activo && p.stockMinimo !== null)
  expect(productos.length).toBeGreaterThan(10)

  // Fecha unica por corrida: cada ejecucion trabaja sobre su propio conteo y
  // no arrastra estado de la anterior.
  const fecha = `2099-${String(Date.now() % 12 + 1).padStart(2, '0')}-${String(Date.now() % 28 + 1).padStart(2, '0')}`
  const ahora = new Date().toISOString()
  conteo = {
    id: idConteo(fecha + Math.random()),
    fecha, usuario: 'test', estado: 'borrador',
    serverSeq: '0', updatedAt: ahora, deletedAt: null,
  }
  const semilla = new Dispositivo('semilla')
  semilla.encolarConteo(conteo)
  const res = await semilla.subir()
  expect(res.rejected).toEqual([])
})

describe('dos dispositivos offline', () => {
  it('contando productos distintos, convergen sin perder nada', async () => {
    const a = new Dispositivo('A')
    const b = new Dispositivo('B')
    const ahora = new Date().toISOString()

    // Cada uno recorre un sector distinto: el caso normal de dos personas.
    a.contar(conteo, productos[0]!, 1, ahora)
    a.contar(conteo, productos[1]!, 2, ahora)
    b.contar(conteo, productos[2]!, 3, ahora)
    b.contar(conteo, productos[3]!, 4, ahora)

    await a.subir()
    await b.subir()
    await a.bajar()
    await b.bajar()

    expect(a.filasDe(conteo)).toHaveLength(4)
    expect(b.filasDe(conteo)).toHaveLength(4)

    for (const d of [a, b]) {
      const porProducto = d.filasDe(conteo).map((i) => i.productoId)
      // Ni una fila duplicada: es lo que garantizan los ids deterministicos.
      expect(new Set(porProducto).size).toBe(porProducto.length)
    }
  })

  /**
   * El conflicto real: los dos cuentan EL MISMO producto. Gana el que conto
   * despues segun el reloj de su dispositivo, no el que subio primero -- un
   * celular que estuvo horas sin senal no debe pisar a otro que conto mas
   * tarde pero se sincronizo antes.
   */
  it('contando el mismo producto, gana la edicion mas reciente', async () => {
    const a = new Dispositivo('A')
    const b = new Dispositivo('B')
    const producto = productos[4]!

    const temprano = new Date(Date.now() - 3 * 3600_000).toISOString()
    const tarde = new Date().toISOString()

    // B conto despues, pero sube primero.
    b.contar(conteo, producto, 99, tarde)
    a.contar(conteo, producto, 11, temprano)

    await b.subir()
    await a.subir()

    await a.bajar()
    await b.bajar()

    const id = idConteoItem(conteo.id, producto.id)
    expect(a.filas.get(id)?.stockActual).toBe(99)
    expect(b.filas.get(id)?.stockActual).toBe(99)
  })

  it('el mismo producto nunca genera dos filas en el servidor', async () => {
    const a = new Dispositivo('A')
    const b = new Dispositivo('B')
    const producto = productos[5]!
    const ahora = new Date().toISOString()

    a.contar(conteo, producto, 1, ahora)
    b.contar(conteo, producto, 2, ahora)
    await a.subir()
    await b.subir()

    const c = new Dispositivo('C')
    await c.bajar()
    const delProducto = c.filasDe(conteo).filter((i) => i.productoId === producto.id)
    expect(delProducto).toHaveLength(1)
  })
})

describe('idempotencia del push', () => {
  it('reenviar el mismo lote no duplica nada', async () => {
    const d = new Dispositivo('reintento')
    const producto = productos[6]!
    d.contar(conteo, producto, 7, new Date().toISOString())

    const lote = [...d.cola]
    const primera = await api('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ mutations: lote }),
    }).then((r) => r.json())

    // Simula la red que se corta despues de aplicar pero antes de responder:
    // el cliente no supo que funciono y reenvia el mismo lote.
    const segunda = await api('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ mutations: lote }),
    }).then((r) => r.json())

    expect(pushResponseSchema.parse(primera).applied).toHaveLength(1)
    expect(pushResponseSchema.parse(segunda).applied).toHaveLength(1)

    const c = new Dispositivo('verificador')
    await c.bajar()
    const filas = c.filasDe(conteo).filter((i) => i.productoId === producto.id)
    expect(filas).toHaveLength(1)
    expect(filas[0]?.stockActual).toBe(7)
  })

  it('rechaza una mutacion invalida sin trabar el resto del lote', async () => {
    const producto = productos[7]!
    const ahora = new Date().toISOString()
    const buena: Mutation = {
      mutationId: crypto.randomUUID(),
      entity: 'conteoItem', op: 'upsert',
      payload: {
        id: idConteoItem(conteo.id, producto.id),
        conteoId: conteo.id, productoId: producto.id,
        stockActual: 5, cantidadPedir: 1, clientUpdatedAt: ahora,
        serverSeq: '0', updatedAt: ahora, deletedAt: null,
      },
      clientUpdatedAt: ahora,
    }
    const rota: Mutation = {
      mutationId: crypto.randomUUID(),
      entity: 'conteoItem', op: 'upsert',
      payload: { id: 'no-es-un-uuid' },
      clientUpdatedAt: ahora,
    }

    const res = pushResponseSchema.parse(await api('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({ mutations: [rota, buena] }),
    }).then((r) => r.json()))

    // La rota se rechaza; la buena, que venia detras, igual se aplica.
    expect(res.rejected.map((r) => r.mutationId)).toEqual([rota.mutationId])
    expect(res.applied).toContain(buena.mutationId)
  })
})
