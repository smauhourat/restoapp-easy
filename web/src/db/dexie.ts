import Dexie, { type Table } from 'dexie'
import { v7 as uuidv7 } from 'uuid'
import type {
  Conteo, ConteoItem, MutableEntity, Mutation, MutationOp,
  Pedido, PedidoItem, Producto, Proveedor,
} from '@resto/shared'

/**
 * Base local del celular.
 *
 * Es la unica fuente de datos de la interfaz: ningun componente hace fetch
 * para pintar una pantalla. La red solo escribe aca por atras. Esa regla es
 * lo que hace que la app funcione igual en modo avion, que es el requisito
 * duro del proyecto.
 */

/** Mutacion pendiente de enviar al servidor. */
export interface OutboxItem extends Mutation {
  /** Autoincremental: preserva el orden en que se hicieron las ediciones. */
  seq?: number
  intentos: number
  ultimoError: string | null
}

export interface Meta {
  clave: string
  valor: string
}

export class RestoDB extends Dexie {
  // Maestro: se baja del servidor y no se edita aca. El ABM del servidor es
  // el unico lugar donde se escribe, lo que elimina los conflictos sobre el
  // catalogo por construccion.
  proveedores!: Table<Proveedor, string>
  productos!: Table<Producto, string>

  // Operacion: se crea en el celular, offline, y sube por la outbox.
  conteos!: Table<Conteo, string>
  conteoItems!: Table<ConteoItem, string>
  pedidos!: Table<Pedido, string>
  pedidoItems!: Table<PedidoItem, string>

  outbox!: Table<OutboxItem, number>
  meta!: Table<Meta, string>

  constructor() {
    super('restoapp')
    this.version(1).stores({
      proveedores: 'id, nombre',
      // El indice compuesto [sector+ordenRecorrido] sirve la consulta central
      // del conteo: los productos de un sector en orden de recorrido fisico.
      productos: 'id, nombre, proveedorId, sector, [sector+ordenRecorrido]',
      conteos: 'id, fecha, estado',
      conteoItems: 'id, conteoId, productoId, [conteoId+productoId]',
      pedidos: 'id, conteoId, proveedorId, [conteoId+proveedorId]',
      pedidoItems: 'id, pedidoId, [pedidoId+productoId]',
      outbox: '++seq, mutationId, entity',
      meta: 'clave',
    })
  }
}

export const db = new RestoDB()

// ------------------------------------------------------------------ meta

const CURSOR = 'syncCursor'
const NOMBRE_RESTAURANTE = 'nombreRestaurante'

export async function leerCursor(): Promise<string> {
  return (await db.meta.get(CURSOR))?.valor ?? '0'
}

export async function guardarCursor(valor: string): Promise<void> {
  await db.meta.put({ clave: CURSOR, valor })
}

/**
 * El nombre del restaurante encabeza todos los mensajes de WhatsApp, asi que
 * tiene que estar en el dispositivo antes de perder la senal. Se guarda en
 * cada sincronizacion y se lee siempre de aca, nunca de la red.
 */
export async function leerNombreRestaurante(): Promise<string> {
  return (await db.meta.get(NOMBRE_RESTAURANTE))?.valor ?? 'nuestro restaurante'
}

export async function guardarNombreRestaurante(valor: string): Promise<void> {
  await db.meta.put({ clave: NOMBRE_RESTAURANTE, valor })
}

// --------------------------------------------------------------- escritura

/** Las tablas sobre las que el cliente puede escribir. */
const TABLA: Record<MutableEntity, 'conteos' | 'conteoItems' | 'pedidos' | 'pedidoItems'> = {
  conteo: 'conteos',
  conteoItem: 'conteoItems',
  pedido: 'pedidos',
  pedidoItem: 'pedidoItems',
}

/**
 * Campos de sincronizacion que lleva una fila creada localmente y que el
 * servidor todavia no vio. serverSeq en '0' la marca como no confirmada.
 */
function camposLocales(clientUpdatedAt: string) {
  return { serverSeq: '0', updatedAt: clientUpdatedAt, deletedAt: null }
}

/**
 * Escribe una fila local y encola su mutacion, EN LA MISMA TRANSACCION.
 *
 * La atomicidad es el punto entero de esta funcion. Si la fila se guardara
 * primero y la mutacion despues, cerrar la app entre las dos operaciones
 * dejaria un conteo que se ve en pantalla pero que no sube nunca al
 * servidor: el peor tipo de perdida de datos, porque es invisible.
 */
export async function escribirLocal<T extends { id: string }>(
  entity: MutableEntity,
  fila: T,
  op: MutationOp = 'upsert',
): Promise<void> {
  const tabla = TABLA[entity]
  const clientUpdatedAt = new Date().toISOString()

  await db.transaction('rw', db[tabla], db.outbox, async () => {
    if (op === 'delete') {
      await (db[tabla] as Table<{ id: string }, string>).delete(fila.id)
    } else {
      await (db[tabla] as Table<{ id: string }, string>).put(fila)
    }
    await db.outbox.add({
      mutationId: uuidv7(),
      entity,
      op,
      payload: fila as unknown as Record<string, unknown>,
      clientUpdatedAt,
      intentos: 0,
      ultimoError: null,
    })
  })
}

/**
 * Aplica al almacen local las filas que llegaron del servidor.
 *
 * Deliberadamente NO pasa por la outbox: son cambios que el servidor ya
 * conoce, y reencolarlos los mandaria de vuelta en un ciclo infinito.
 *
 * Regla de precedencia: una fila con mutaciones pendientes en la outbox NO
 * se pisa con la version del servidor. El servidor todavia no vio esa
 * edicion, asi que lo que manda es necesariamente mas viejo; aplicarlo
 * borraria de la pantalla algo que la persona acaba de contar. Cuando el
 * push confirma la mutacion, se saca de la outbox y el proximo pull ya
 * escribe la version canonica.
 */
export async function aplicarDelServidor(datos: {
  proveedores: Proveedor[]
  productos: Producto[]
  conteos: Conteo[]
  conteoItems: ConteoItem[]
  pedidos: Pedido[]
  pedidoItems: PedidoItem[]
}): Promise<void> {
  await db.transaction(
    'rw',
    [db.proveedores, db.productos, db.conteos, db.conteoItems,
      db.pedidos, db.pedidoItems, db.outbox],
    async () => {
      const pendientes = new Set<string>()
      await db.outbox.each((m) => {
        const id = (m.payload as { id?: string }).id
        if (id !== undefined) pendientes.add(id)
      })

      // Una fila con deletedAt se borra del almacen local en vez de
      // guardarse: en el celular no hace falta el historial de bajas, solo
      // que el producto deje de aparecer en el conteo.
      const aplicar = async <T extends { id: string; deletedAt: string | null }>(
        tabla: Table<T, string>, filas: T[], respetarPendientes: boolean,
      ) => {
        const candidatas = respetarPendientes
          ? filas.filter((f) => !pendientes.has(f.id))
          : filas
        const vivas = candidatas.filter((f) => f.deletedAt === null)
        const muertas = candidatas.filter((f) => f.deletedAt !== null).map((f) => f.id)
        if (vivas.length > 0) await tabla.bulkPut(vivas)
        if (muertas.length > 0) await tabla.bulkDelete(muertas)
      }

      // El maestro no se edita en el cliente, asi que nunca tiene pendientes
      // y la version del servidor siempre gana.
      await aplicar(db.proveedores, datos.proveedores, false)
      await aplicar(db.productos, datos.productos, false)

      await aplicar(db.conteos, datos.conteos, true)
      await aplicar(db.conteoItems, datos.conteoItems, true)
      await aplicar(db.pedidos, datos.pedidos, true)
      await aplicar(db.pedidoItems, datos.pedidoItems, true)
    },
  )
}

export { camposLocales }
