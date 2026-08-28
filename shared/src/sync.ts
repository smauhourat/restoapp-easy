import { z } from 'zod'
import {
  conteoItemSchema,
  conteoSchema,
  pedidoItemSchema,
  pedidoSchema,
  productoSchema,
  proveedorSchema,
  syncFieldsSchema,
} from './domain.js'

const withSync = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.merge(syncFieldsSchema)

/**
 * Respuesta del pull incremental.
 *
 * Trae solo las filas con serverSeq > since, incluidas las borradas
 * (deletedAt != null). El cliente guarda el serverSeq devuelto como cursor
 * para el proximo pull.
 *
 * hasMore indica que la pagina se corto por limite y hay que volver a pedir
 * desde el nuevo cursor. Sin esto, el primer pull de un dispositivo nuevo
 * intentaria traer el catalogo entero en una respuesta.
 */
export const pullResponseSchema = z.object({
  proveedores: z.array(withSync(proveedorSchema)),
  productos: z.array(withSync(productoSchema)),
  conteos: z.array(withSync(conteoSchema)),
  conteoItems: z.array(withSync(conteoItemSchema)),
  pedidos: z.array(withSync(pedidoSchema)),
  pedidoItems: z.array(withSync(pedidoItemSchema)),
  serverSeq: z.string(),
  hasMore: z.boolean(),
})
export type PullResponse = z.infer<typeof pullResponseSchema>

/**
 * Entidades que el cliente puede escribir.
 *
 * proveedor y producto NO estan en esta lista, y es deliberado: el maestro
 * se edita solo en el servidor y el cliente lo trata como read-only. Eso
 * elimina por construccion la clase de conflictos mas molesta y deja el
 * sync reducido a un solo caso real (dos celulares en el mismo conteoItem).
 */
export const MUTABLE_ENTITIES = [
  'conteo',
  'conteoItem',
  'pedido',
  'pedidoItem',
] as const
export const mutableEntitySchema = z.enum(MUTABLE_ENTITIES)
export type MutableEntity = z.infer<typeof mutableEntitySchema>

export const mutationOpSchema = z.enum(['upsert', 'delete'])
export type MutationOp = z.infer<typeof mutationOpSchema>

/**
 * Una mutacion local pendiente de enviar.
 *
 * mutationId es un UUID generado en el cliente y el servidor lo guarda en
 * applied_mutation. Reenviar la misma mutacion es un no-op. Eso es lo que
 * hace seguro reintentar cuando la red se corta a mitad del push, que en un
 * deposito sin senal va a pasar seguido.
 */
export const mutationSchema = z.object({
  mutationId: z.string().uuid(),
  entity: mutableEntitySchema,
  op: mutationOpSchema,
  payload: z.record(z.unknown()),
  clientUpdatedAt: z.string().datetime(),
})
export type Mutation = z.infer<typeof mutationSchema>

export const pushRequestSchema = z.object({
  mutations: z.array(mutationSchema).max(500),
})
export type PushRequest = z.infer<typeof pushRequestSchema>

/**
 * rejected lleva las mutaciones que el servidor no pudo aplicar por un
 * motivo permanente (payload invalido, FK inexistente). El cliente las saca
 * de la outbox y las registra; reintentarlas para siempre bloquearia la cola
 * entera detras de una fila rota.
 */
export const pushResponseSchema = z.object({
  applied: z.array(z.string().uuid()),
  rejected: z.array(
    z.object({ mutationId: z.string().uuid(), motivo: z.string() }),
  ),
  serverSeq: z.string(),
})
export type PushResponse = z.infer<typeof pushResponseSchema>
