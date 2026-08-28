import { pullResponseSchema } from '@resto/shared'
import {
  aplicarDelServidor, guardarCursor, guardarNombreRestaurante, leerCursor,
} from '../db/dexie.js'
import { fetchConSesion, SesionExpirada } from './sesion.js'

/**
 * Descarga del servidor todo lo que cambio desde el ultimo cursor.
 *
 * Sigue paginando mientras el servidor diga hasMore, para que el primer
 * arranque de un dispositivo nuevo baje el catalogo entero aunque no entre
 * en una sola respuesta.
 *
 * Nunca lanza por falta de red: quedarse sin senal es el estado normal de
 * esta aplicacion, no un error. Devuelve si pudo o no y la interfaz decide
 * como mostrarlo.
 */
export interface ResultadoPull {
  ok: boolean
  filas: number
  /** true cuando hay que volver a entrar. El conteo local queda intacto. */
  sesionExpirada?: boolean
  error?: string
}

export async function pull(): Promise<ResultadoPull> {
  let cursor = await leerCursor()
  let filas = 0

  try {
    for (let pagina = 0; pagina < 50; pagina++) {
      const r = await fetchConSesion(`/api/sync/pull?since=${encodeURIComponent(cursor)}`)
      if (!r.ok) return { ok: false, filas, error: `HTTP ${r.status}` }

      // La respuesta se valida contra el mismo esquema Zod que usa el
      // servidor para construirla. Una version vieja de la app hablando con
      // un servidor nuevo falla aca, ruidosamente, en vez de guardar filas
      // corruptas en IndexedDB -- de donde despues cuesta mucho sacarlas.
      const datos = pullResponseSchema.parse(await r.json())

      await aplicarDelServidor(datos)
      filas += datos.proveedores.length + datos.productos.length
        + datos.conteos.length + datos.conteoItems.length
        + datos.pedidos.length + datos.pedidoItems.length

      cursor = datos.serverSeq
      // El cursor se guarda recien despues de aplicar los datos. Si el
      // proceso muere en el medio, la pagina se vuelve a pedir entera; como
      // las escrituras son upserts por id, repetirlas no hace dano.
      await guardarCursor(cursor)

      if (!datos.hasMore) break
    }

    // Config del servidor. Va despues de los datos y con su propio try: que
    // falle no invalida un pull que ya trajo el catalogo, y el nombre
    // cacheado de la vez anterior sigue sirviendo.
    try {
      const r = await fetchConSesion('/api/config')
      if (r.ok) {
        const cfg = (await r.json()) as { nombreRestaurante?: unknown }
        if (typeof cfg.nombreRestaurante === 'string' && cfg.nombreRestaurante !== '') {
          await guardarNombreRestaurante(cfg.nombreRestaurante)
        }
      }
    } catch { /* sin conexion: se usa el nombre ya guardado */ }

    return { ok: true, filas }
  } catch (e) {
    if (e instanceof SesionExpirada) {
      return { ok: false, filas, sesionExpirada: true, error: 'sesion expirada' }
    }
    return { ok: false, filas, error: e instanceof Error ? e.message : String(e) }
  }
}
