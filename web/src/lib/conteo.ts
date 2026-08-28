import {
  calcularCantidadPedir, idConteo, idConteoItem,
  type Conteo, type ConteoItem, type Producto,
} from '@resto/shared'
import { camposLocales, db, escribirLocal } from '../db/dexie.js'

/** Fecha local en YYYY-MM-DD. No usa toISOString(): eso da UTC y a la noche cambia de dia. */
export function fechaHoy(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Devuelve el conteo en curso, y lo crea si no hay ninguno.
 *
 * Hay un solo conteo abierto a la vez, aunque lo editen varios celulares
 * -- es la decision de alcance de la v1. Se busca el borrador existente
 * antes de crear uno nuevo para que un segundo dispositivo se sume al mismo
 * conteo en vez de arrancar uno paralelo.
 */
export async function asegurarConteoAbierto(usuario: string): Promise<Conteo> {
  const abierto = await db.conteos.where('estado').equals('borrador').first()
  if (abierto) return abierto

  const ahora = new Date().toISOString()
  const nuevo: Conteo = {
    // Deterministico por fecha: dos celulares que arrancan el conteo del dia
    // sin verse llegan al mismo id y no crean dos conteos paralelos.
    id: idConteo(fechaHoy()),
    fecha: fechaHoy(),
    usuario,
    estado: 'borrador',
    ...camposLocales(ahora),
  }
  await escribirLocal('conteo', nuevo)
  return nuevo
}

async function itemExistente(conteoId: string, productoId: string) {
  return db.conteoItems.where('[conteoId+productoId]').equals([conteoId, productoId]).first()
}

/**
 * Registra el stock contado de un producto.
 *
 * Se carga el stock ACTUAL, no el faltante: es la decision de diseno central
 * del proyecto, porque baja la carga cognitiva y permite que cuente
 * cualquier empleado y no solo el encargado.
 *
 * La cantidad a pedir se recalcula sola a partir del minimo. Si el producto
 * no tiene minimo cargado -- hoy son 191 de 272 -- queda en null y la
 * escribe la persona a mano con setCantidadPedir.
 */
export async function setStockActual(
  conteo: Conteo,
  producto: Producto,
  stockActual: number | null,
): Promise<void> {
  const ahora = new Date().toISOString()

  const item: ConteoItem = {
    id: idConteoItem(conteo.id, producto.id),
    conteoId: conteo.id,
    productoId: producto.id,
    stockActual,
    cantidadPedir: calcularCantidadPedir(producto, stockActual),
    clientUpdatedAt: ahora,
    ...camposLocales(ahora),
  }
  await escribirLocal('conteoItem', item)
}

/**
 * Fija a mano la cantidad a pedir, sin tocar el stock contado.
 *
 * Dos usos: los productos sin minimo, donde no hay nada que calcular, y el
 * ajuste del encargado antes de mandar el pedido. Por eso cantidadPedir se
 * persiste en vez de derivarse en cada lectura.
 */
export async function setCantidadPedir(
  conteo: Conteo,
  producto: Producto,
  cantidadPedir: number | null,
): Promise<void> {
  const previo = await itemExistente(conteo.id, producto.id)
  const ahora = new Date().toISOString()

  const item: ConteoItem = {
    id: idConteoItem(conteo.id, producto.id),
    conteoId: conteo.id,
    productoId: producto.id,
    stockActual: previo?.stockActual ?? null,
    cantidadPedir,
    clientUpdatedAt: ahora,
    ...camposLocales(ahora),
  }
  await escribirLocal('conteoItem', item)
}

/** Un producto esta contado cuando tiene stock cargado, aunque sea 0. */
export function estaContado(item: ConteoItem | undefined): boolean {
  return item !== undefined && item.stockActual !== null
}
