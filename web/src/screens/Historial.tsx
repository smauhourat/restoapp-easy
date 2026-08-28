import { useLiveQuery } from 'dexie-react-hooks'
import { formatFecha } from '@resto/shared'
import { db } from '../db/dexie.js'

/**
 * Historial de pedidos.
 *
 * Lee de IndexedDB como todo lo demas, asi que tambien funciona sin senal:
 * el encargado puede revisar que pidio la semana pasada parado en el
 * deposito, que es justo donde surge la pregunta.
 *
 * Es la base del analisis de consumo y precios que el catalogo ya habilita.
 * Los items guardan el precio congelado al momento del pedido, asi que el
 * total de cada uno es historicamente correcto aunque el maestro haya
 * cambiado despues.
 */
export function Historial({ onVolver }: { onVolver: () => void }) {
  const dias = useLiveQuery(async () => {
    const pedidos = await db.pedidos.toArray()
    const proveedores = await db.proveedores.toArray()
    const nombre = new Map(proveedores.map((p) => [p.id, p.nombre]))

    const detalle = await Promise.all(pedidos.map(async (pedido) => {
      const items = await db.pedidoItems.where('pedidoId').equals(pedido.id).toArray()
      const total = items.reduce(
        (a, i) => a + (i.precioUnitario ?? 0) * i.cantidad, 0,
      )
      // Un total solo tiene sentido si TODOS los items tienen precio. Con 67
      // productos sin precio cargado, mostrar una suma parcial como si fuera
      // el total del pedido seria enganoso.
      const completo = items.length > 0 && items.every((i) => i.precioUnitario !== null)
      return {
        pedido,
        proveedor: nombre.get(pedido.proveedorId) ?? 'Proveedor desconocido',
        items: items.length,
        total: completo ? total : null,
      }
    }))

    const porFecha = new Map<string, typeof detalle>()
    for (const d of detalle) {
      const g = porFecha.get(d.pedido.fecha)
      if (g) g.push(d)
      else porFecha.set(d.pedido.fecha, [d])
    }

    return [...porFecha.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, pedidos]) => ({
        fecha,
        pedidos: pedidos.sort((a, b) => a.proveedor.localeCompare(b.proveedor, 'es')),
      }))
  }, [], undefined)

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-fila">
          <button type="button" className="volver" onClick={onVolver} aria-label="volver">←</button>
          <div>
            <h1 className="titulo">Historial de pedidos</h1>
            <div className="subtitulo">
              {dias === undefined ? '' : `${dias.length} día${dias.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
      </header>

      <div className="lista">
        {dias === undefined ? (
          <div className="vacio-sector">Cargando…</div>
        ) : dias.length === 0 ? (
          <div className="vacio-sector">Todavía no hay pedidos registrados.</div>
        ) : dias.map(({ fecha, pedidos }) => (
          <div key={fecha} className="grupo-fecha">
            <div className="fecha-titulo">{formatFecha(fecha)}</div>
            {pedidos.map(({ pedido, proveedor, items, total }) => (
              <div key={pedido.id} className="fila">
                <div className="fila-arriba">
                  <div className="fila-datos">
                    <div className="nombre">{proveedor}</div>
                    <div className="meta">
                      {items} ítem{items === 1 ? '' : 's'}
                      {total !== null && (
                        <><span className="sep">·</span>{total.toFixed(2)} €</>
                      )}
                    </div>
                  </div>
                  <span className={'estado-pedido ' + pedido.estado}>
                    {pedido.estado}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
