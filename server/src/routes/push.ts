import { Router } from 'express'
import { z } from 'zod'
import {
  conteoItemSchema, conteoSchema, pedidoItemSchema, pedidoSchema,
  pushRequestSchema, type Mutation, type MutableEntity, type PushResponse,
} from '@resto/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

/** Cliente transaccional: todas las escrituras de una mutacion van por aca. */
type Tx = Prisma.TransactionClient

export const pushRouter = Router()

/**
 * Esquemas de validacion de los payloads que manda el cliente.
 *
 * Se descartan serverSeq, updatedAt y deletedAt: esos tres los controla el
 * servidor. Aceptarlos del cliente permitiria que un celular con el reloj
 * mal, o una version vieja de la app, corrompa el cursor de sincronizacion
 * de todos los demas dispositivos.
 */
const ESQUEMA: Record<MutableEntity, z.ZodTypeAny> = {
  conteo: conteoSchema,
  conteoItem: conteoItemSchema,
  pedido: pedidoSchema,
  pedidoItem: pedidoItemSchema,
}

class MutacionInvalida extends Error {}

function validar(m: Mutation): Record<string, unknown> {
  const parsed = ESQUEMA[m.entity].safeParse(m.payload)
  if (!parsed.success) {
    throw new MutacionInvalida(
      `payload invalido: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    )
  }
  const { serverSeq, updatedAt, deletedAt, ...datos } = parsed.data as Record<string, unknown>
  return datos
}

/**
 * Aplica una mutacion.
 *
 * Devuelve false cuando la mutacion es vieja y pierde el last-write-wins: se
 * procesó correctamente, pero no cambia nada. Se distingue de un rechazo
 * porque el cliente igual tiene que sacarla de la cola.
 */
async function aplicar(tx: Tx, m: Mutation): Promise<boolean> {
  const datos = validar(m)
  const id = datos['id'] as string
  const clientUpdatedAt = new Date(m.clientUpdatedAt)

  if (m.op === 'delete') {
    // Baja logica: el pull le comunica la baja al resto de los dispositivos
    // a traves de deletedAt, y una fila borrada de la tabla no puede
    // comunicar nada.
    const borrar = { deletedAt: new Date() }
    switch (m.entity) {
      case 'conteo': await tx.conteo.updateMany({ where: { id }, data: borrar }); break
      case 'conteoItem': await tx.conteoItem.updateMany({ where: { id }, data: borrar }); break
      case 'pedido': await tx.pedido.updateMany({ where: { id }, data: borrar }); break
      case 'pedidoItem': await tx.pedidoItem.updateMany({ where: { id }, data: borrar }); break
    }
    return true
  }

  switch (m.entity) {
    case 'conteo': {
      const d = datos as unknown as { id: string; fecha: string; usuario: string; estado: 'borrador' | 'cerrado' }
      await tx.conteo.upsert({
        where: { id },
        create: { id: d.id, fecha: d.fecha, usuario: d.usuario, estado: d.estado },
        update: { fecha: d.fecha, usuario: d.usuario, estado: d.estado, deletedAt: null },
      })
      return true
    }

    case 'conteoItem': {
      const d = datos as unknown as {
        id: string; conteoId: string; productoId: string
        stockActual: number | null; cantidadPedir: number | null
      }

      /**
       * Last-write-wins con grano fino: la unidad de conflicto es la fila de
       * UN producto dentro de un conteo, no el conteo entero. Dos personas
       * contando sectores distintos no chocan nunca; si tocan el mismo
       * producto, gana la edicion mas reciente segun el reloj del
       * dispositivo.
       *
       * La comparacion es contra clientUpdatedAt y no contra updatedAt del
       * servidor: lo que importa es cuando la persona conto, no cuando llego
       * el paquete. Un celular que estuvo tres horas sin senal no debe
       * pisar a otro que conto despues pero subio antes.
       */
      const existente = await tx.conteoItem.findUnique({
        where: { conteoId_productoId: { conteoId: d.conteoId, productoId: d.productoId } },
      })
      if (existente !== null && existente.clientUpdatedAt >= clientUpdatedAt) {
        return false
      }

      await tx.conteoItem.upsert({
        // Se busca por (conteo, producto) y no por id: dos dispositivos
        // offline generan UUID distintos para el mismo producto del mismo
        // conteo, y por id se crearian dos filas duplicadas.
        where: { conteoId_productoId: { conteoId: d.conteoId, productoId: d.productoId } },
        create: {
          id: d.id, conteoId: d.conteoId, productoId: d.productoId,
          stockActual: d.stockActual, cantidadPedir: d.cantidadPedir, clientUpdatedAt,
        },
        update: {
          stockActual: d.stockActual, cantidadPedir: d.cantidadPedir,
          clientUpdatedAt, deletedAt: null,
        },
      })
      return true
    }

    case 'pedido': {
      const d = datos as unknown as {
        id: string; conteoId: string; proveedorId: string; fecha: string
        estado: 'pendiente' | 'enviado' | 'recibido'
        mensajeGenerado: string; mensajeEditado: boolean
      }
      const existente = await tx.pedido.findUnique({
        where: { conteoId_proveedorId: { conteoId: d.conteoId, proveedorId: d.proveedorId } },
      })
      if (existente !== null && existente.clientUpdatedAt >= clientUpdatedAt) {
        return false
      }
      await tx.pedido.upsert({
        where: { conteoId_proveedorId: { conteoId: d.conteoId, proveedorId: d.proveedorId } },
        create: {
          id: d.id, conteoId: d.conteoId, proveedorId: d.proveedorId, fecha: d.fecha,
          estado: d.estado, mensajeGenerado: d.mensajeGenerado,
          mensajeEditado: d.mensajeEditado, clientUpdatedAt,
        },
        update: {
          estado: d.estado, mensajeGenerado: d.mensajeGenerado,
          mensajeEditado: d.mensajeEditado, clientUpdatedAt, deletedAt: null,
        },
      })
      return true
    }

    case 'pedidoItem': {
      const d = datos as unknown as {
        id: string; pedidoId: string; productoId: string; cantidad: number
        nombreProducto: string; unidad: 'kg' | 'lt' | 'un' | null
        precioUnitario: number | null
      }
      await tx.pedidoItem.upsert({
        where: { pedidoId_productoId: { pedidoId: d.pedidoId, productoId: d.productoId } },
        create: {
          id: d.id, pedidoId: d.pedidoId, productoId: d.productoId, cantidad: d.cantidad,
          nombreProducto: d.nombreProducto, unidad: d.unidad, precioUnitario: d.precioUnitario,
        },
        update: {
          cantidad: d.cantidad, nombreProducto: d.nombreProducto,
          unidad: d.unidad, precioUnitario: d.precioUnitario, deletedAt: null,
        },
      })
      return true
    }
  }
}

/**
 * Recibe las mutaciones pendientes del cliente.
 *
 * Es idempotente por mutationId: reenviar una mutacion ya vista no hace
 * nada. Eso es lo que hace seguro reintentar cuando la red se corta despues
 * de que el servidor aplico los cambios pero antes de que la respuesta
 * llegue al celular -- en un deposito sin senal, pasa seguido.
 *
 * Cada mutacion va en su propia transaccion, no todas en una. Si una fila
 * rota abortara el lote entero, una sola mutacion invalida bloquearia la
 * cola del dispositivo para siempre.
 */
pushRouter.post('/push', async (req, res) => {
  const parsed = pushRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }

  const applied: string[] = []
  const rejected: Array<{ mutationId: string; motivo: string }> = []

  // En orden: la outbox del cliente preserva la secuencia de ediciones, y un
  // conteoItem no se puede insertar antes que su conteo.
  for (const m of parsed.data.mutations) {
    const yaVista = await prisma.appliedMutation.findUnique({
      where: { mutationId: m.mutationId },
    })
    if (yaVista !== null) {
      applied.push(m.mutationId)
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        await aplicar(tx, m)
        await tx.appliedMutation.create({
          data: { mutationId: m.mutationId, entity: m.entity, op: m.op },
        })
      })
      applied.push(m.mutationId)
    } catch (e) {
      // Un error permanente -- payload invalido, FK inexistente -- se rechaza
      // para que el cliente lo saque de la cola. Reintentarlo para siempre
      // dejaria todas las mutaciones posteriores atascadas detras.
      const motivo = e instanceof MutacionInvalida
        ? e.message
        : e instanceof Error ? e.message : String(e)
      rejected.push({ mutationId: m.mutationId, motivo })
    }
  }

  const max = await prisma.$queryRaw<Array<{ seq: bigint }>>`SELECT last_value AS seq FROM global_seq`
  const respuesta: PushResponse = {
    applied,
    rejected,
    serverSeq: (max[0]?.seq ?? 0n).toString(),
  }
  res.json(respuesta)
})
