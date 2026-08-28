import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import { pull } from './pull.js'
import { push } from './push.js'

export type EstadoSync = 'inicial' | 'sincronizando' | 'ok' | 'sin-conexion'

/**
 * Estado de conexion y ciclo de sincronizacion.
 *
 * navigator.onLine solo dice si hay interfaz de red, no si el servidor
 * contesta -- en un deposito es habitual tener wifi conectado sin salida.
 * Por eso el estado real lo define si la ultima sincronizacion funciono, y
 * onLine se usa nada mas que como disparador para reintentar.
 */

/** Espera entre reintentos automaticos, en milisegundos. */
const BACKOFF = [5_000, 15_000, 60_000, 300_000] as const

export function useSync() {
  const [estado, setEstado] = useState<EstadoSync>('inicial')
  const [ultima, setUltima] = useState<Date | null>(null)
  const [sesionExpirada, setSesionExpirada] = useState(false)
  const fallos = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cuenta reactiva de lo que falta subir: alimenta el indicador de la
  // cabecera, para que se vea que nada se perdio aunque no haya senal.
  const pendientes = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0

  const sincronizar = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setEstado('sincronizando')

    // Push primero: si el dispositivo tiene cambios locales, subirlos antes
    // de bajar evita que el pull traiga una version vieja de una fila que
    // esta a punto de cambiar.
    const rPush = await push()
    const rPull = await pull()

    if (rPush.sesionExpirada === true || rPull.sesionExpirada === true) {
      // No se reintenta: reintentar sin sesion solo repite el 401. La
      // interfaz muestra el login y el ciclo se retoma al entrar.
      setSesionExpirada(true)
      setEstado('sin-conexion')
      return { ok: false }
    }

    if (rPush.ok && rPull.ok) {
      fallos.current = 0
      setSesionExpirada(false)
      setEstado('ok')
      setUltima(new Date())
      return { ok: true }
    }

    setEstado('sin-conexion')
    // Reintento con espera creciente. Sin esto, un servidor caido recibiria
    // un intento por segundo de cada celular del local.
    const espera = BACKOFF[Math.min(fallos.current, BACKOFF.length - 1)]!
    fallos.current += 1
    timer.current = setTimeout(() => { void sincronizar() }, espera)
    return { ok: false }
  }, [])

  useEffect(() => {
    void sincronizar()

    // Al recuperar la red y al volver a la app desde segundo plano. Lo
    // segundo importa mas de lo que parece: el recorrido del deposito son
    // varios minutos con la pantalla apagada.
    const alVolver = () => {
      if (document.visibilityState === 'visible') void sincronizar()
    }
    window.addEventListener('online', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('online', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [sincronizar])

  return { estado, ultima, pendientes, sesionExpirada, sincronizar }
}
