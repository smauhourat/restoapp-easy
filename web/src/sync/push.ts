import { pushResponseSchema, type Mutation } from '@resto/shared'
import { db } from '../db/dexie.js'
import { fetchConSesion, SesionExpirada } from './sesion.js'

/**
 * Envia al servidor las mutaciones pendientes de la outbox.
 *
 * Nunca lanza por falta de red: quedarse sin senal es el estado normal de
 * esta aplicacion. Lo que no se pudo mandar queda en la cola para el
 * proximo intento.
 */

/** Tope por lote. Alineado con el maximo que acepta el servidor. */
const LOTE = 200

export interface ResultadoPush {
  ok: boolean
  enviadas: number
  rechazadas: number
  /** true cuando hay que volver a entrar. La cola queda intacta. */
  sesionExpirada?: boolean
  error?: string
}

export async function push(): Promise<ResultadoPush> {
  // En orden de encolado: la secuencia importa, porque un conteoItem no se
  // puede insertar antes que su conteo.
  const pendientes = await db.outbox.orderBy('seq').limit(LOTE).toArray()
  if (pendientes.length === 0) return { ok: true, enviadas: 0, rechazadas: 0 }

  const mutations: Mutation[] = pendientes.map((m) => ({
    mutationId: m.mutationId,
    entity: m.entity,
    op: m.op,
    payload: m.payload,
    clientUpdatedAt: m.clientUpdatedAt,
  }))

  let respuesta
  try {
    const r = await fetchConSesion('/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutations }),
    })
    if (!r.ok) {
      await registrarFallo(pendientes, `HTTP ${r.status}`)
      return { ok: false, enviadas: 0, rechazadas: 0, error: `HTTP ${r.status}` }
    }
    respuesta = pushResponseSchema.parse(await r.json())
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await registrarFallo(pendientes, error)
    if (e instanceof SesionExpirada) {
      // La cola NO se toca: al volver a entrar, sube sola.
      return { ok: false, enviadas: 0, rechazadas: 0, sesionExpirada: true, error }
    }
    return { ok: false, enviadas: 0, rechazadas: 0, error }
  }

  const confirmadas = new Set(respuesta.applied)
  const rechazadas = new Map(respuesta.rejected.map((r) => [r.mutationId, r.motivo]))

  await db.transaction('rw', db.outbox, async () => {
    for (const m of pendientes) {
      if (m.seq === undefined) continue

      if (confirmadas.has(m.mutationId)) {
        // El servidor la aplico. Sacarla de la cola es lo que libera la fila
        // local para que el proximo pull escriba la version canonica.
        await db.outbox.delete(m.seq)
        continue
      }

      const motivo = rechazadas.get(m.mutationId)
      if (motivo !== undefined) {
        // Rechazo permanente: reintentarla trabaria todo lo que viene atras.
        console.warn(`mutacion rechazada (${m.entity}): ${motivo}`)
        await db.outbox.delete(m.seq)
        continue
      }

      // Ni confirmada ni rechazada: el servidor no llego a procesarla.
      await db.outbox.update(m.seq, {
        intentos: m.intentos + 1,
        ultimoError: 'sin respuesta del servidor',
      })
    }
  })

  return {
    ok: true,
    enviadas: confirmadas.size,
    rechazadas: rechazadas.size,
  }
}

/**
 * Anota el intento fallido de un lote que no llego a salir.
 *
 * Las mutaciones NO se descartan nunca por fallar la red. Quedarse sin senal
 * es el estado habitual dentro del deposito: si la cola se vaciara despues
 * de N intentos, un conteo hecho en un sotano sin cobertura se perderia solo,
 * en silencio, que es exactamente el fracaso que este diseno existe para
 * evitar. `intentos` y `ultimoError` quedan como diagnostico.
 *
 * La unica autoridad que puede sacar algo de la cola sin aplicarlo es el
 * servidor, con un rechazo explicito: es el unico que puede saber que una
 * mutacion no va a funcionar nunca.
 */
async function registrarFallo(
  pendientes: Array<{ seq?: number; intentos: number }>,
  error: string,
): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    for (const m of pendientes) {
      if (m.seq === undefined) continue
      await db.outbox.update(m.seq, { intentos: m.intentos + 1, ultimoError: error })
    }
  })
}

/** Cuantas mutaciones esperan subir. Alimenta el indicador de la cabecera. */
export async function pendientesDeSubir(): Promise<number> {
  return db.outbox.count()
}
