import { useEffect, useState } from 'react'
import type { Conteo } from '@resto/shared'
import { leerPedidos, recalcularPedidos, type PedidoConDetalle } from '../lib/pedidos.js'

/**
 * Resumen por proveedor. El sistema ya separo el pedido; la persona solo
 * revisa y manda.
 *
 * El proveedor es invisible durante el conteo a proposito -- agrupar es
 * problema del sistema, no del usuario -- y aparece recien aca.
 */
interface Props {
  conteo: Conteo
  onVolver: () => void
  onRevisar: (pedidoId: string) => void
}

export function Resumen({ conteo, onVolver, onRevisar }: Props) {
  const [pedidos, setPedidos] = useState<PedidoConDetalle[] | null>(null)

  useEffect(() => {
    // Se recalcula al entrar: el encargado va y viene entre contar y revisar,
    // y el resumen tiene que reflejar el ultimo conteo, no el de hace un rato.
    void recalcularPedidos(conteo)
      .then(() => leerPedidos(conteo.id))
      .then(setPedidos)
  }, [conteo])

  if (pedidos === null) return <div className="centrado">Calculando pedidos…</div>

  const enviados = pedidos.filter((p) => p.pedido.estado === 'enviado').length
  const totalItems = pedidos.reduce((a, p) => a + p.items.length, 0)

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-fila">
          <button type="button" className="volver" onClick={onVolver} aria-label="volver al conteo">
            ←
          </button>
          <div>
            <h1 className="titulo">Pedido por proveedor</h1>
            <div className="subtitulo">
              {pedidos.length} proveedor{pedidos.length === 1 ? '' : 'es'}
              {' · '}{totalItems} ítem{totalItems === 1 ? '' : 's'}
              {enviados > 0 && ` · ${enviados} enviado${enviados === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
      </header>

      <div className="lista">
        {pedidos.length === 0 ? (
          <div className="vacio-sector">
            No hay nada que pedir todavía. Contá productos y volvé acá.
          </div>
        ) : pedidos.map(({ pedido, proveedor, items }) => (
          <button
            key={pedido.id} type="button" className="tarjeta-prov"
            onClick={() => onRevisar(pedido.id)}
          >
            <div className="tarjeta-arriba">
              <div className="tarjeta-datos">
                <div className="nombre">{proveedor?.nombre ?? 'Proveedor desconocido'}</div>
                <div className="meta">
                  {items.length} ítem{items.length === 1 ? '' : 's'}
                  {proveedor?.diasEntrega
                    ? <><span className="sep">·</span>entrega {proveedor.diasEntrega}</>
                    : null}
                </div>
              </div>
              <span className={'estado-pedido ' + pedido.estado}>
                {pedido.estado === 'enviado' ? 'enviado' : 'sin enviar'}
              </span>
            </div>

            {/*
              El aviso va en el resumen y no solo en la previsualizacion: los
              15 proveedores comparten un mismo telefono de prueba, y un
              pedido real mandado a ese numero es un error caro y silencioso.
            */}
            {proveedor?.telefonoEsPlaceholder === true && (
              <div className="aviso-telefono">
                Teléfono de prueba: este pedido no llegaría al proveedor real.
              </div>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
