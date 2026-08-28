import {
  agruparPorProveedor, generarLinkWhatsApp, generarMensaje, idPedido, idPedidoItem,
  type Conteo, type Pedido, type PedidoItem, type Producto, type Proveedor,
} from '@resto/shared'
import { camposLocales, db, escribirLocal, leerNombreRestaurante } from '../db/dexie.js'

/**
 * Armado de los pedidos a partir del conteo.
 *
 * Corre entero en el cliente, sin tocar la red: el encargado cierra el conteo
 * parado en el deposito y tiene que ver los pedidos ahi mismo. El servidor se
 * entera despues, cuando vuelve la senal.
 */

export interface PedidoConDetalle {
  pedido: Pedido
  proveedor: Proveedor | undefined
  items: PedidoItem[]
}

/**
 * Recalcula los pedidos del conteo y los guarda.
 *
 * Es idempotente y se puede llamar cada vez que se entra al resumen: el
 * encargado va y viene entre contar y revisar, y los pedidos tienen que
 * reflejar siempre el ultimo conteo.
 *
 * Dos cosas se preservan entre recalculos, y las dos son decisiones humanas
 * que el sistema no debe descartar:
 *   - el estado (un pedido ya enviado sigue enviado)
 *   - el mensaje reescrito a mano
 */
export async function recalcularPedidos(conteo: Conteo): Promise<void> {
  const nombreRestaurante = await leerNombreRestaurante()

  const itemsConteo = await db.conteoItems.where('conteoId').equals(conteo.id).toArray()
  const productos = await db.productos.toArray()
  const porId = new Map<string, Producto>(productos.map((p) => [p.id, p]))

  const grupos = agruparPorProveedor(
    itemsConteo.flatMap((i) => {
      const producto = porId.get(i.productoId)
      return producto ? [{ producto, cantidadPedir: i.cantidadPedir }] : []
    }),
  )

  const previos = await db.pedidos.where('conteoId').equals(conteo.id).toArray()
  const previoPorProveedor = new Map(previos.map((p) => [p.proveedorId, p]))
  const ahora = new Date().toISOString()

  for (const grupo of grupos) {
    const proveedor = await db.proveedores.get(grupo.proveedorId)
    if (proveedor === undefined) continue

    const previo = previoPorProveedor.get(grupo.proveedorId)
    const mensaje = generarMensaje({
      nombreRestaurante,
      fecha: conteo.fecha,
      proveedor,
      lineas: grupo.lineas,
    })

    const pedido: Pedido = {
      // Deterministico: dos dispositivos que arman el pedido del mismo
      // proveedor sin verse llegan al mismo id.
      id: idPedido(conteo.id, grupo.proveedorId),
      conteoId: conteo.id,
      proveedorId: grupo.proveedorId,
      fecha: conteo.fecha,
      estado: previo?.estado ?? 'pendiente',
      mensajeGenerado: previo?.mensajeEditado === true
        ? previo.mensajeGenerado
        : mensaje,
      mensajeEditado: previo?.mensajeEditado ?? false,
      clientUpdatedAt: ahora,
      ...camposLocales(ahora),
    }
    // Solo se escribe si algo cambio de verdad. Esta funcion corre cada vez
    // que se entra al resumen, y el encargado va y viene entre contar y
    // revisar: escribir siempre llenaria la cola de sincronizacion de
    // mutaciones que no cambian nada.
    if (previo === undefined
      || previo.estado !== pedido.estado
      || previo.mensajeGenerado !== pedido.mensajeGenerado) {
      await escribirLocal('pedido', pedido)
    }

    // Los items se reconcilian por productoId en vez de borrarse y
    // recrearse. Recrearlos les daria un id nuevo en cada recalculo, y cada
    // id nuevo es una baja y un alta que viajan al servidor y que los otros
    // dispositivos tienen que volver a bajar.
    const anteriores = await db.pedidoItems.where('pedidoId').equals(pedido.id).toArray()
    const anteriorPorProducto = new Map(anteriores.map((i) => [i.productoId, i]))

    for (const linea of grupo.lineas) {
      const anterior = anteriorPorProducto.get(linea.productoId)
      anteriorPorProducto.delete(linea.productoId)

      const item: PedidoItem = {
        id: idPedidoItem(pedido.id, linea.productoId),
        pedidoId: pedido.id,
        productoId: linea.productoId,
        cantidad: linea.cantidad,
        // Snapshot: congelar nombre, unidad y precio es lo que permite
        // analizar precios historicos sin que un cambio en el maestro
        // reescriba el pasado.
        nombreProducto: linea.nombreProducto,
        unidad: linea.unidad,
        precioUnitario: linea.precioUnitario,
        ...camposLocales(ahora),
      }

      const sinCambios = anterior !== undefined
        && anterior.cantidad === item.cantidad
        && anterior.nombreProducto === item.nombreProducto
        && anterior.unidad === item.unidad
        && anterior.precioUnitario === item.precioUnitario
      if (!sinCambios) await escribirLocal('pedidoItem', item)
    }

    // Lo que quedo en el mapa ya no esta en el pedido: se dejo de pedir.
    for (const sobrante of anteriorPorProducto.values()) {
      await escribirLocal('pedidoItem', sobrante, 'delete')
    }
  }

  // Un proveedor que se quedo sin nada que pedir -- porque se recontó y ya
  // habia stock -- desaparece del resumen. Se borra incluso si estaba
  // enviado: sin items, el pedido no existe.
  const proveedoresConPedido = new Set(grupos.map((g) => g.proveedorId))
  for (const previo of previos) {
    if (proveedoresConPedido.has(previo.proveedorId)) continue
    const items = await db.pedidoItems.where('pedidoId').equals(previo.id).toArray()
    for (const i of items) await escribirLocal('pedidoItem', i, 'delete')
    await escribirLocal('pedido', previo, 'delete')
  }
}

/** Los pedidos del conteo, con su proveedor y sus items, listos para mostrar. */
export async function leerPedidos(conteoId: string): Promise<PedidoConDetalle[]> {
  const pedidos = await db.pedidos.where('conteoId').equals(conteoId).toArray()
  const detalle = await Promise.all(pedidos.map(async (pedido) => ({
    pedido,
    proveedor: await db.proveedores.get(pedido.proveedorId),
    items: await db.pedidoItems.where('pedidoId').equals(pedido.id).toArray(),
  })))
  return detalle.sort((a, b) =>
    (a.proveedor?.nombre ?? '').localeCompare(b.proveedor?.nombre ?? '', 'es'))
}

export async function marcarEnviado(pedido: Pedido): Promise<void> {
  const ahora = new Date().toISOString()
  await escribirLocal('pedido', {
    ...pedido, estado: 'enviado', clientUpdatedAt: ahora, updatedAt: ahora,
  })
}

/** Guarda el mensaje reescrito a mano y lo marca para no regenerarlo. */
export async function guardarMensajeEditado(
  pedido: Pedido, texto: string,
): Promise<void> {
  const ahora = new Date().toISOString()
  await escribirLocal('pedido', {
    ...pedido,
    mensajeGenerado: texto,
    mensajeEditado: true,
    clientUpdatedAt: ahora,
    updatedAt: ahora,
  })
}

/**
 * Link que abre WhatsApp con el mensaje precargado.
 *
 * El envio final lo hace la persona: el sistema deja el chat abierto con el
 * texto listo y nada mas. Es una decision de diseno del proyecto, no una
 * limitacion tecnica -- evita la API paga de WhatsApp Business y deja un
 * control humano antes de que el pedido salga.
 */
export function linkWhatsApp(proveedor: Proveedor, mensaje: string): string {
  return generarLinkWhatsApp(proveedor.telefonoWa, mensaje)
}
