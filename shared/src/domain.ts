import { z } from 'zod'

/**
 * Sectores del deposito. Definen el recorrido fisico del conteo.
 * El orden del array es el orden en que aparecen los chips en la pantalla
 * de conteo, y sigue el recorrido real: camara primero porque es el unico
 * sector con orden_recorrido completo.
 */
export const SECTORES = [
  'camara',
  'seco',
  'bebidas',
  'congelado',
  'limpieza',
  'descartables',
  'bodega',
] as const

export const sectorSchema = z.enum(SECTORES)
export type Sector = z.infer<typeof sectorSchema>

export const SECTOR_LABEL: Record<Sector, string> = {
  camara: 'Cámara',
  seco: 'Seco',
  bebidas: 'Bebidas',
  congelado: 'Congelado',
  limpieza: 'Limpieza',
  descartables: 'Descartables',
  bodega: 'Bodega',
}

export const UNIDADES = ['kg', 'lt', 'un'] as const
export const unidadSchema = z.enum(UNIDADES)
export type Unidad = z.infer<typeof unidadSchema>

export const estadoConteoSchema = z.enum(['borrador', 'cerrado'])
export type EstadoConteo = z.infer<typeof estadoConteoSchema>

export const estadoPedidoSchema = z.enum(['pendiente', 'enviado', 'recibido'])
export type EstadoPedido = z.infer<typeof estadoPedidoSchema>

/**
 * Campos que lleva toda fila sincronizable.
 *
 * serverSeq es un contador global monotonico (no por tabla) que el cliente
 * usa como cursor del pull incremental. deletedAt propaga las bajas: sin
 * soft delete, una fila borrada en el servidor vive para siempre en el
 * IndexedDB del celular, porque el pull solo trae lo que existe.
 */
export const syncFieldsSchema = z.object({
  serverSeq: z.string(), // BigInt serializado como string en JSON
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
})

export const proveedorSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(1),
  telefonoWa: z.string().regex(/^\d*$/, 'solo digitos, sin + ni espacios'),
  telefonoEsPlaceholder: z.boolean(),
  diasEntrega: z.string().nullable(),
  horaCorte: z.string().nullable(),
  contacto: z.string().nullable(),
  notas: z.string().nullable(),
})
export type Proveedor = z.infer<typeof proveedorSchema> & SyncFields

export const productoSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(1),
  familia: z.string().nullable(),
  /**
   * null en unidad / ordenRecorrido / stockMinimo significa "falta cargar",
   * y es distinto de 0. Un stockMinimo de 0 es un producto que no se pide
   * nunca; un null es un producto que todavia no se configuro. Mezclarlos
   * hace que el conteo sugiera pedir de mas o que oculte productos.
   */
  unidad: unidadSchema.nullable(),
  proveedorId: z.string().uuid(),
  sector: sectorSchema,
  ordenRecorrido: z.number().int().nullable(),
  stockMinimo: z.number().nullable(),
  precioUnitario: z.number().nullable(),
  cantidadBulto: z.number().nullable(),
  precioBulto: z.number().nullable(),
  activo: z.boolean(),
})
export type Producto = z.infer<typeof productoSchema> & SyncFields

export const conteoSchema = z.object({
  id: z.string().uuid(),
  fecha: z.string(), // YYYY-MM-DD, fecha local del local
  usuario: z.string(),
  estado: estadoConteoSchema,
})
export type Conteo = z.infer<typeof conteoSchema> & SyncFields

export const conteoItemSchema = z.object({
  id: z.string().uuid(),
  conteoId: z.string().uuid(),
  productoId: z.string().uuid(),
  stockActual: z.number().nullable(),
  cantidadPedir: z.number().nullable(),
  /**
   * Reloj del dispositivo al momento de la edicion. Solo se usa para
   * desempatar dos versiones del mismo item (last-write-wins). El orden
   * de auditoria lo da updatedAt, que lo pone el servidor.
   */
  clientUpdatedAt: z.string().datetime(),
})
export type ConteoItem = z.infer<typeof conteoItemSchema> & SyncFields

export const pedidoSchema = z.object({
  id: z.string().uuid(),
  conteoId: z.string().uuid(),
  proveedorId: z.string().uuid(),
  fecha: z.string(),
  estado: estadoPedidoSchema,
  mensajeGenerado: z.string(),
  /**
   * true cuando la persona reescribio el mensaje a mano. Recalcular el pedido
   * regenera el texto de los que no fueron tocados, pero nunca pisa uno
   * editado: ese texto es una decision deliberada del encargado y perderla
   * al agregar un producto seria peor que un mensaje desactualizado.
   */
  mensajeEditado: z.boolean(),
  clientUpdatedAt: z.string().datetime(),
})
export type Pedido = z.infer<typeof pedidoSchema> & SyncFields

export const pedidoItemSchema = z.object({
  id: z.string().uuid(),
  pedidoId: z.string().uuid(),
  productoId: z.string().uuid(),
  cantidad: z.number(),
  /**
   * Snapshot del producto al momento del pedido. Congelar nombre, unidad
   * y precio es lo que hace posible el analisis historico: si el pedidoItem
   * solo referenciara al producto, cambiar un precio en el maestro
   * reescribiria el pasado.
   */
  nombreProducto: z.string(),
  unidad: unidadSchema.nullable(),
  precioUnitario: z.number().nullable(),
})
export type PedidoItem = z.infer<typeof pedidoItemSchema> & SyncFields

export type SyncFields = z.infer<typeof syncFieldsSchema>
