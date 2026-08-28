import { Router } from 'express'
import type { PullResponse } from '@resto/shared'
import { prisma } from '../lib/prisma.js'
import {
  toConteoDTO, toConteoItemDTO, toPedidoDTO, toPedidoItemDTO,
  toProductoDTO, toProveedorDTO,
} from '../lib/serialize.js'

export const syncRouter = Router()

/**
 * Cuantas filas como maximo se traen por tabla y por pagina.
 *
 * El catalogo entero son ~308 filas, asi que en la practica el primer pull
 * de un dispositivo nuevo entra en una sola respuesta. El limite existe para
 * que el historial de conteos, que crece todos los dias, no convierta el
 * primer arranque en una descarga de varios megabytes con la app bloqueada.
 */
const LIMITE_POR_TABLA = 1000

interface Fila { serverSeq: string }

/**
 * Recorta las paginas de todas las tablas a un corte comun.
 *
 * El problema: cada tabla se consulta por separado con su propio LIMIT. Si
 * Producto se corta en el serverSeq 400 pero Proveedor llego hasta el 900,
 * avanzar el cursor a 900 saltearia para siempre los productos entre 400 y
 * 900. Por eso el corte es el MINIMO de los ultimos serverSeq entre las
 * tablas que se truncaron, y todo lo que pase de ahi se descarta: se vuelve
 * a pedir en la proxima pagina.
 */
function recortar(grupos: Fila[][], since: bigint) {
  let cap: bigint | null = null
  for (const filas of grupos) {
    if (filas.length < LIMITE_POR_TABLA) continue
    const ultima = BigInt(filas[filas.length - 1]!.serverSeq)
    if (cap === null || ultima < cap) cap = ultima
  }

  if (cap === null) {
    // Ninguna tabla se trunco: entro todo lo que habia.
    let max = since
    for (const filas of grupos) {
      for (const f of filas) {
        const s = BigInt(f.serverSeq)
        if (s > max) max = s
      }
    }
    return { cursor: max, hasMore: false, filtrar: (f: Fila) => true }
  }

  const corte = cap
  return {
    cursor: corte,
    hasMore: true,
    filtrar: (f: Fila) => BigInt(f.serverSeq) <= corte,
  }
}

/**
 * Pull incremental.
 *
 * Devuelve todo lo que cambio desde `since`, incluidas las filas borradas
 * (deletedAt != null): sin eso, una baja hecha en el servidor no llegaria
 * nunca al celular, porque el pull solo trae lo que existe.
 *
 * Limitacion conocida: PostgreSQL asigna el valor de la secuencia antes del
 * commit, asi que dos transacciones concurrentes pueden confirmarse en orden
 * distinto al de sus serverSeq. Una transaccion lenta podria commitear un
 * seq que un cliente ya paso por alto. A esta escala -- un local, un conteo
 * por dia, escrituras de unos pocos celulares -- la ventana es de
 * milisegundos y el riesgo es despreciable. Si algun dia deja de serlo, la
 * salida no es agregar timestamps sino publicar los cambios en una tabla de
 * outbox del lado del servidor, escrita dentro de la misma transaccion.
 */
syncRouter.get('/pull', async (req, res) => {
  const sinceRaw = typeof req.query['since'] === 'string' ? req.query['since'] : '0'
  let since: bigint
  try {
    since = BigInt(sinceRaw)
  } catch {
    return res.status(400).json({ error: 'since debe ser un entero' })
  }

  const where = { serverSeq: { gt: since } }
  const opts = {
    where,
    orderBy: { serverSeq: 'asc' as const },
    take: LIMITE_POR_TABLA,
  }

  const [proveedores, productos, conteos, conteoItems, pedidos, pedidoItems] =
    await Promise.all([
      prisma.proveedor.findMany(opts),
      prisma.producto.findMany(opts),
      prisma.conteo.findMany(opts),
      prisma.conteoItem.findMany(opts),
      prisma.pedido.findMany(opts),
      prisma.pedidoItem.findMany(opts),
    ])

  const dto = {
    proveedores: proveedores.map(toProveedorDTO),
    productos: productos.map(toProductoDTO),
    conteos: conteos.map(toConteoDTO),
    conteoItems: conteoItems.map(toConteoItemDTO),
    pedidos: pedidos.map(toPedidoDTO),
    pedidoItems: pedidoItems.map(toPedidoItemDTO),
  }

  const { cursor, hasMore, filtrar } = recortar(Object.values(dto), since)

  const respuesta: PullResponse = {
    proveedores: dto.proveedores.filter(filtrar),
    productos: dto.productos.filter(filtrar),
    conteos: dto.conteos.filter(filtrar),
    conteoItems: dto.conteoItems.filter(filtrar),
    pedidos: dto.pedidos.filter(filtrar),
    pedidoItems: dto.pedidoItems.filter(filtrar),
    serverSeq: cursor.toString(),
    hasMore,
  }
  res.json(respuesta)
})
