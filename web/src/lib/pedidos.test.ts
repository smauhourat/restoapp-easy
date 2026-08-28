import { beforeEach, describe, expect, it } from 'vitest'
import type { Producto, Proveedor } from '@resto/shared'
import { db, guardarNombreRestaurante } from '../db/dexie.js'
import { asegurarConteoAbierto, setCantidadPedir, setStockActual } from './conteo.js'
import {
  guardarMensajeEditado, leerPedidos, linkWhatsApp, marcarEnviado, recalcularPedidos,
} from './pedidos.js'

const ahora = '2026-08-28T12:00:00.000Z'

const proveedor = (id: string, o: Partial<Proveedor> = {}): Proveedor => ({
  id, nombre: 'PROV ' + id, telefonoWa: '376111222',
  telefonoEsPlaceholder: false, diasEntrega: 'martes', horaCorte: null,
  contacto: null, notas: null,
  serverSeq: '1', updatedAt: ahora, deletedAt: null, ...o,
})

const producto = (id: string, o: Partial<Producto> = {}): Producto => ({
  id, nombre: 'PROD ' + id, familia: null, unidad: 'kg', proveedorId: 'v1',
  sector: 'camara', ordenRecorrido: 100, stockMinimo: 10, precioUnitario: 5,
  cantidadBulto: null, precioBulto: null, activo: true,
  serverSeq: '1', updatedAt: ahora, deletedAt: null, ...o,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  await guardarNombreRestaurante('La Nonna')
  await db.proveedores.bulkPut([
    proveedor('v1', { nombre: 'ANDORCARN' }),
    proveedor('v2', { nombre: 'MOLINA', diasEntrega: null }),
  ])
})

describe('recalcularPedidos', () => {
  it('separa el pedido por proveedor', async () => {
    await db.productos.bulkPut([
      producto('p1', { proveedorId: 'v1' }),
      producto('p2', { proveedorId: 'v2' }),
      producto('p3', { proveedorId: 'v1' }),
    ])
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { proveedorId: 'v1' }), 4)
    await setStockActual(c, producto('p2', { proveedorId: 'v2' }), 2)
    await setStockActual(c, producto('p3', { proveedorId: 'v1' }), 1)

    await recalcularPedidos(c)
    const pedidos = await leerPedidos(c.id)

    expect(pedidos).toHaveLength(2)
    expect(pedidos.map((p) => p.proveedor?.nombre)).toEqual(['ANDORCARN', 'MOLINA'])
    expect(pedidos[0]!.items).toHaveLength(2)
    expect(pedidos[1]!.items).toHaveLength(1)
  })

  it('deja afuera los productos con stock suficiente', async () => {
    await db.productos.put(producto('p1'))
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 20)

    await recalcularPedidos(c)
    expect(await leerPedidos(c.id)).toHaveLength(0)
  })

  it('incluye los productos sin minimo con la cantidad puesta a mano', async () => {
    const p = producto('p1', { stockMinimo: null })
    await db.productos.put(p)
    const c = await asegurarConteoAbierto('u')
    await setCantidadPedir(c, p, 7)

    await recalcularPedidos(c)
    const [pedido] = await leerPedidos(c.id)
    expect(pedido!.items).toHaveLength(1)
    expect(Number(pedido!.items[0]!.cantidad)).toBe(7)
  })

  it('congela nombre, unidad y precio en el item del pedido', async () => {
    await db.productos.put(producto('p1', { nombre: 'MOZZARELLA', precioUnitario: 8.5 }))
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { nombre: 'MOZZARELLA', precioUnitario: 8.5 }), 4)
    await recalcularPedidos(c)

    // Cambiar el maestro despues no debe reescribir el pasado.
    await db.productos.put(producto('p1', { nombre: 'OTRO NOMBRE', precioUnitario: 99 }))

    const [pedido] = await leerPedidos(c.id)
    expect(pedido!.items[0]).toMatchObject({
      nombreProducto: 'MOZZARELLA', unidad: 'kg', precioUnitario: 8.5,
    })
  })

  it('no duplica items al recalcular dos veces', async () => {
    await db.productos.put(producto('p1'))
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 4)

    await recalcularPedidos(c)
    await recalcularPedidos(c)

    const [pedido] = await leerPedidos(c.id)
    expect(pedido!.items).toHaveLength(1)
    expect(await db.pedidos.count()).toBe(1)
  })

  it('borra el pedido de un proveedor que ya no tiene nada que pedir', async () => {
    const p = producto('p1')
    await db.productos.put(p)
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, p, 4)
    await recalcularPedidos(c)
    expect(await leerPedidos(c.id)).toHaveLength(1)

    // Se recuenta y aparece stock: el pedido deja de existir.
    await setStockActual(c, p, 20)
    await recalcularPedidos(c)

    expect(await leerPedidos(c.id)).toHaveLength(0)
    expect(await db.pedidoItems.count()).toBe(0)
  })

  it('conserva el estado enviado al recalcular', async () => {
    await db.productos.bulkPut([producto('p1'), producto('p2')])
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 4)
    await recalcularPedidos(c)

    const [antes] = await leerPedidos(c.id)
    await marcarEnviado(antes!.pedido)

    await setStockActual(c, producto('p2'), 1)
    await recalcularPedidos(c)

    const [despues] = await leerPedidos(c.id)
    expect(despues!.pedido.estado).toBe('enviado')
    expect(despues!.items).toHaveLength(2)
  })

  // El texto reescrito a mano es una decision del encargado. Perderla porque
  // se conto un producto mas seria peor que un mensaje desactualizado.
  it('no pisa un mensaje editado a mano', async () => {
    await db.productos.bulkPut([producto('p1'), producto('p2')])
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 4)
    await recalcularPedidos(c)

    const [antes] = await leerPedidos(c.id)
    await guardarMensajeEditado(antes!.pedido, 'Texto propio del encargado')

    await setStockActual(c, producto('p2'), 1)
    await recalcularPedidos(c)

    const [despues] = await leerPedidos(c.id)
    expect(despues!.pedido.mensajeGenerado).toBe('Texto propio del encargado')
    expect(despues!.pedido.mensajeEditado).toBe(true)
  })

  it('regenera el mensaje de los pedidos que no fueron editados', async () => {
    await db.productos.bulkPut([producto('p1', { nombre: 'HARINA' }), producto('p2', { nombre: 'SAL' })])
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { nombre: 'HARINA' }), 4)
    await recalcularPedidos(c)

    await setStockActual(c, producto('p2', { nombre: 'SAL' }), 1)
    await recalcularPedidos(c)

    const [pedido] = await leerPedidos(c.id)
    expect(pedido!.pedido.mensajeGenerado).toContain('HARINA')
    expect(pedido!.pedido.mensajeGenerado).toContain('SAL')
  })

  it('arma el mensaje con el formato acordado', async () => {
    await db.productos.put(producto('p1', { nombre: 'MOZZARELLA', stockMinimo: 10 }))
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1', { nombre: 'MOZZARELLA', stockMinimo: 10 }), 4)
    await recalcularPedidos(c)

    const [pedido] = await leerPedidos(c.id)
    expect(pedido!.pedido.mensajeGenerado).toBe(
      `Hola! Pedido de La Nonna\n${c.fecha.split('-').reverse().join('/')} — entrega martes\n`
      + '\n• MOZZARELLA — 6 kg\n\nGracias!',
    )
  })

  /**
   * El resumen se recalcula cada vez que se entra, y el encargado va y viene
   * entre contar y revisar. Si cada visita encolara mutaciones, la cola de
   * sincronizacion se llenaria de escrituras que no cambian nada y los otros
   * dispositivos tendrian que volver a bajarlas.
   */
  it('recalcular sin cambios no encola ninguna mutacion', async () => {
    await db.productos.put(producto('p1'))
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 4)
    await recalcularPedidos(c)

    await db.outbox.clear()
    await recalcularPedidos(c)
    await recalcularPedidos(c)

    expect(await db.outbox.count()).toBe(0)
  })

  it('mantiene el id del item entre recalculos', async () => {
    await db.productos.bulkPut([producto('p1'), producto('p2')])
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 4)
    await recalcularPedidos(c)
    const idOriginal = (await leerPedidos(c.id))[0]!.items[0]!.id

    // Agregar otro producto del mismo proveedor no debe renumerar el primero.
    await setStockActual(c, producto('p2'), 1)
    await recalcularPedidos(c)

    const items = (await leerPedidos(c.id))[0]!.items
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.id)).toContain(idOriginal)
  })

  it('actualiza la cantidad de un item que cambio', async () => {
    const p = producto('p1')
    await db.productos.put(p)
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, p, 4)
    await recalcularPedidos(c)

    await setStockActual(c, p, 2)
    await recalcularPedidos(c)

    const items = (await leerPedidos(c.id))[0]!.items
    expect(items).toHaveLength(1)
    expect(Number(items[0]!.cantidad)).toBe(8)
  })

  it('todo lo que escribe queda encolado para subir al servidor', async () => {
    await db.productos.put(producto('p1'))
    const c = await asegurarConteoAbierto('u')
    await setStockActual(c, producto('p1'), 4)
    await db.outbox.clear()

    await recalcularPedidos(c)

    const entidades = (await db.outbox.toArray()).map((m) => m.entity)
    expect(entidades).toContain('pedido')
    expect(entidades).toContain('pedidoItem')
  })
})

describe('linkWhatsApp', () => {
  it('arma el link con el telefono limpio y el mensaje codificado', () => {
    const url = linkWhatsApp(proveedor('v1', { telefonoWa: '376111222' }), 'Hola!\nPedido')
    expect(url).toBe('https://wa.me/376111222?text=Hola!%0APedido')
  })
})
