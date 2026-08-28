/**
 * Recorrido completo contra el catalogo real, de punta a punta.
 *
 * A diferencia del resto de la suite, este archivo NO usa datos inventados:
 * baja los 293 productos y 15 proveedores del servidor y hace el recorrido
 * que haria el encargado. Sirve para detectar lo que los tests con datos de
 * juguete no ven -- nombres con acentos, productos sin unidad, proveedores
 * sin dia de entrega, precios ausentes.
 *
 * Necesita el servidor levantado y un usuario de prueba, por eso esta
 * excluido de `npm test`:
 *   npm run dev -w @resto/server
 *   npm run usuario -w @resto/server -- encargado 1234
 *   npm run test:integracion -w @resto/web
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { pullResponseSchema, type Producto } from '@resto/shared'
import { api } from './api.js'
import { aplicarDelServidor, db, guardarNombreRestaurante } from '../db/dexie.js'
import { asegurarConteoAbierto, setCantidadPedir, setStockActual } from '../lib/conteo.js'
import { leerPedidos, linkWhatsApp, recalcularPedidos } from '../lib/pedidos.js'

beforeAll(async () => {
  await db.delete()
  await db.open()

  const r = await api('/api/sync/pull?since=0')
  if (!r.ok) throw new Error(`el servidor no responde (${r.status})`)
  // Se valida con el mismo esquema que usa la app: si el contrato cambio,
  // este test lo detecta antes que el celular.
  const datos = pullResponseSchema.parse(await r.json())
  await aplicarDelServidor(datos)
  await guardarNombreRestaurante('La Nonna')
})

describe('catalogo real', () => {
  it('baja los 293 productos y los 15 proveedores', async () => {
    expect(await db.productos.count()).toBe(293)
    expect(await db.proveedores.count()).toBe(15)
  })

  it('camara es el unico sector con el recorrido completo', async () => {
    const camara = await db.productos.where('sector').equals('camara').toArray()
    const configurados = camara.filter(
      (p) => p.unidad !== null && p.ordenRecorrido !== null && p.stockMinimo !== null,
    )
    expect(configurados).toHaveLength(90)
  })
})

describe('recorrido del encargado', () => {
  it('cuenta camara, agrupa por proveedor y arma mensajes validos', async () => {
    const conteo = await asegurarConteoAbierto('encargado')

    // Se cuenta la mitad del minimo en cada producto de camara: todo lo
    // contado deberia terminar en un pedido.
    const camara = await db.productos
      .where('sector').equals('camara')
      .filter((p) => p.activo && p.stockMinimo !== null)
      .toArray()

    for (const p of camara) {
      await setStockActual(conteo, p, Math.floor((p.stockMinimo ?? 0) / 2))
    }

    await recalcularPedidos(conteo)
    const pedidos = await leerPedidos(conteo.id)

    expect(pedidos.length).toBeGreaterThan(1)

    for (const { pedido, proveedor, items } of pedidos) {
      expect(proveedor).toBeDefined()
      expect(items.length).toBeGreaterThan(0)

      // Cada item pertenece al proveedor del pedido: si la agrupacion
      // fallara, un pedido llevaria productos de otro proveedor.
      for (const item of items) {
        const producto = await db.productos.get(item.productoId)
        expect(producto?.proveedorId).toBe(pedido.proveedorId)
      }

      // El mensaje tiene que salir legible aunque falten datos.
      expect(pedido.mensajeGenerado).toContain('Hola! Pedido de La Nonna')
      expect(pedido.mensajeGenerado).toContain('Gracias!')
      expect(pedido.mensajeGenerado).not.toContain('undefined')
      expect(pedido.mensajeGenerado).not.toContain('null')
      expect(pedido.mensajeGenerado).not.toContain('NaN')

      const link = linkWhatsApp(proveedor!, pedido.mensajeGenerado)
      expect(link).toMatch(/^https:\/\/wa\.me\/\d+\?text=/)
      // Los acentos y los saltos de linea tienen que sobrevivir el ida y vuelta.
      expect(decodeURIComponent(link.split('text=')[1]!)).toBe(pedido.mensajeGenerado)
    }
  })

  it('un producto sin minimo entra al pedido con la cantidad puesta a mano', async () => {
    const conteo = await asegurarConteoAbierto('encargado')
    const sinMinimo = await db.productos
      .filter((p) => p.activo && p.stockMinimo === null)
      .first() as Producto

    expect(sinMinimo).toBeDefined()
    await setCantidadPedir(conteo, sinMinimo, 3)
    await recalcularPedidos(conteo)

    const pedidos = await leerPedidos(conteo.id)
    const linea = pedidos
      .flatMap((p) => p.items)
      .find((i) => i.productoId === sinMinimo.id)

    expect(linea).toBeDefined()
    expect(Number(linea!.cantidad)).toBe(3)
  })

  it('ningun producto se pide a dos proveedores a la vez', async () => {
    const conteo = await asegurarConteoAbierto('encargado')
    const pedidos = await leerPedidos(conteo.id)
    const nombres = pedidos.flatMap((p) => p.items.map((i) => i.nombreProducto))
    // Los 19 duplicados quedan resueltos en el maestro: uno solo activo.
    expect(new Set(nombres).size).toBe(nombres.length)
  })
})
