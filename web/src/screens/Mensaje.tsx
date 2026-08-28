import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie.js'
import {
  guardarMensajeEditado, linkWhatsApp, marcarEnviado,
} from '../lib/pedidos.js'

/**
 * Previsualizacion del mensaje.
 *
 * Muestra el texto exactamente como va a llegar por WhatsApp. El envio final
 * lo hace la persona: la app abre el chat con el mensaje precargado y ahi
 * termina su trabajo. Ese control humano antes de que salga el pedido es
 * deliberado.
 */
interface Props {
  pedidoId: string
  onVolver: () => void
}

export function Mensaje({ pedidoId, onVolver }: Props) {
  const pedido = useLiveQuery(() => db.pedidos.get(pedidoId), [pedidoId], undefined)
  const proveedor = useLiveQuery(
    async () => {
      const p = await db.pedidos.get(pedidoId)
      return p ? db.proveedores.get(p.proveedorId) : undefined
    },
    [pedidoId], undefined,
  )

  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')

  useEffect(() => {
    if (pedido && !editando) setTexto(pedido.mensajeGenerado)
  }, [pedido, editando])

  if (pedido === undefined || proveedor === undefined) {
    return <div className="centrado">Cargando…</div>
  }

  const abrirChat = () => {
    void marcarEnviado(pedido)
    // El link se abre despues de marcar: si el navegador bloquea la ventana,
    // el estado ya quedo registrado y no se pierde el rastro de que se mando.
    window.open(linkWhatsApp(proveedor, pedido.mensajeGenerado), '_blank', 'noopener')
  }

  const guardarEdicion = () => {
    void guardarMensajeEditado(pedido, texto)
    setEditando(false)
  }

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-fila">
          <button type="button" className="volver" onClick={onVolver} aria-label="volver al resumen">
            ←
          </button>
          <div>
            <h1 className="titulo">{proveedor.nombre}</h1>
            <div className="subtitulo">
              {proveedor.telefonoWa === ''
                ? 'sin teléfono cargado'
                : `+${proveedor.telefonoWa}`}
            </div>
          </div>
          {pedido.estado === 'enviado' && (
            <span className="estado-pedido enviado">enviado</span>
          )}
        </div>
      </header>

      <div className="lista">
        {proveedor.telefonoEsPlaceholder && (
          <div className="aviso-fuerte">
            <strong>Este es el teléfono de prueba.</strong> El pedido no le
            llegaría a {proveedor.nombre}. Cargá el número real en el maestro
            antes de enviarlo.
          </div>
        )}

        {pedido.mensajeEditado && !editando && (
          <div className="nota-editado">
            Mensaje escrito a mano. No se actualiza solo si cambiás el conteo.
          </div>
        )}

        {editando ? (
          <>
            <textarea
              className="editor" value={texto} rows={14}
              onChange={(e) => setTexto(e.target.value)}
              aria-label="mensaje del pedido"
            />
            <div className="acciones">
              <button type="button" className="boton secundario" onClick={() => setEditando(false)}>
                Cancelar
              </button>
              <button type="button" className="boton" onClick={guardarEdicion}>
                Guardar
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Burbuja con la forma del mensaje en WhatsApp: lo que se
                previsualiza tiene que parecerse a lo que se manda. */}
            <div className="burbuja">{pedido.mensajeGenerado}</div>
            <div className="acciones">
              <button type="button" className="boton secundario" onClick={() => setEditando(true)}>
                Editar
              </button>
              <button
                type="button" className="boton"
                onClick={abrirChat}
                disabled={proveedor.telefonoWa === ''}
              >
                Abrir chat
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
