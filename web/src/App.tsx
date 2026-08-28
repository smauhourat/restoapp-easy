import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Conteo as ConteoT } from '@resto/shared'
import { db } from './db/dexie.js'
import { asegurarConteoAbierto } from './lib/conteo.js'
import { useSync } from './sync/useSync.js'
import { leerToken, leerUsuario } from './sync/sesion.js'
import { Conteo } from './screens/Conteo.js'
import { Historial } from './screens/Historial.js'
import { Login } from './screens/Login.js'
import { Mensaje } from './screens/Mensaje.js'
import { Resumen } from './screens/Resumen.js'

/**
 * Arranque y navegacion.
 *
 * Cuatro pantallas en una pila de un nivel: conteo -> resumen -> mensaje, mas
 * el historial. No hay router porque no hace falta: son cuatro estados y el
 * boton de atras de cada cabecera. Meter historial de URLs complicaria el
 * service worker sin darle nada al encargado.
 */
type Vista =
  | { nombre: 'conteo' }
  | { nombre: 'resumen' }
  | { nombre: 'mensaje'; pedidoId: string }
  | { nombre: 'historial' }

export function App() {
  const sync = useSync()
  const [conteo, setConteo] = useState<ConteoT | null>(null)
  const [vista, setVista] = useState<Vista>({ nombre: 'conteo' })
  const [autenticado, setAutenticado] = useState<boolean | null>(null)

  const hayCatalogo = useLiveQuery(
    async () => (await db.productos.count()) > 0, [], undefined,
  )

  const revisarSesion = useCallback(async () => {
    setAutenticado((await leerToken()) !== null)
  }, [])

  useEffect(() => { void revisarSesion() }, [revisarSesion])

  // Si el servidor rechazo el token, hay que volver a entrar. El conteo
  // local y la cola de subida quedan intactos: al entrar de nuevo, sube solo.
  useEffect(() => {
    if (sync.sesionExpirada) setAutenticado(false)
  }, [sync.sesionExpirada])

  useEffect(() => {
    if (autenticado !== true) return
    // El conteo se crea en la base local sin esperar al servidor: si hiciera
    // falta red para arrancar, la app no serviria dentro del deposito.
    // Queda a nombre de quien lo abrio; si despues se suma otro dispositivo,
    // se une al mismo conteo sin reescribir ese dato.
    void leerUsuario()
      .then((u) => asegurarConteoAbierto(u ?? 'encargado'))
      .then(setConteo)
  }, [autenticado])

  if (autenticado === null) {
    return <div className="app"><div className="centrado">Cargando…</div></div>
  }

  if (!autenticado) {
    return (
      <div className="app">
        <Login onEntrar={() => { setAutenticado(true); void sync.sincronizar() }} />
      </div>
    )
  }

  if (hayCatalogo === false) {
    return (
      <div className="app">
        <div className="centrado">
          <div>
            <p><strong>Todavía no hay catálogo en este dispositivo.</strong></p>
            <p>
              Conectate a la red una vez para descargarlo.<br />
              Después la app funciona sin señal.
            </p>
            <button
              type="button" className="boton"
              onClick={() => void sync.sincronizar()}
            >
              {sync.estado === 'sincronizando' ? 'Descargando…' : 'Descargar catálogo'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (conteo === null || hayCatalogo === undefined) {
    return <div className="app"><div className="centrado">Cargando…</div></div>
  }

  return (
    <div className="app">
      {vista.nombre === 'conteo' && (
        <Conteo
          conteo={conteo} sync={sync}
          onVerPedido={() => setVista({ nombre: 'resumen' })}
          onVerHistorial={() => setVista({ nombre: 'historial' })}
        />
      )}

      {vista.nombre === 'resumen' && (
        <Resumen
          conteo={conteo}
          onVolver={() => setVista({ nombre: 'conteo' })}
          onRevisar={(pedidoId) => setVista({ nombre: 'mensaje', pedidoId })}
        />
      )}

      {vista.nombre === 'mensaje' && (
        <Mensaje
          pedidoId={vista.pedidoId}
          onVolver={() => setVista({ nombre: 'resumen' })}
        />
      )}

      {vista.nombre === 'historial' && (
        <Historial onVolver={() => setVista({ nombre: 'conteo' })} />
      )}
    </div>
  )
}
