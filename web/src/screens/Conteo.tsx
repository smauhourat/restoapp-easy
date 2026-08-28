import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  SECTORES, SECTOR_LABEL, ordenarParaConteo,
  type Conteo as ConteoT, type ConteoItem, type Producto, type Sector,
} from '@resto/shared'
import { db } from '../db/dexie.js'
import { setCantidadPedir, setStockActual, fechaHoy } from '../lib/conteo.js'
import type { useSync } from '../sync/useSync.js'

/**
 * Pantalla de conteo. Es la unica que se usa caminando por el deposito, y de
 * la que depende que el proyecto no vuelva al papel.
 *
 * Lee todo de IndexedDB via useLiveQuery: no hace un solo fetch. Con la red
 * caida se comporta exactamente igual que con red.
 */

interface Props {
  conteo: ConteoT
  sync: ReturnType<typeof useSync>
  onVerPedido: () => void
  onVerHistorial: () => void
}

const ETIQUETA_CONEXION = {
  inicial: 'conectando',
  sincronizando: 'sincronizando',
  ok: 'al día',
  'sin-conexion': 'sin conexión',
} as const

const CLASE_PUNTO = {
  inicial: '', sincronizando: 'sync', ok: 'ok', 'sin-conexion': 'sin',
} as const

/** '' -> null. Un 0 escrito a proposito significa "no queda nada". */
function parseNum(v: string): number | null {
  const s = v.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function Fila({ producto, item, conteo }: {
  producto: Producto
  item: ConteoItem | undefined
  conteo: ConteoT
}) {
  const proveedor = useLiveQuery(
    () => db.proveedores.get(producto.proveedorId), [producto.proveedorId],
  )
  const [texto, setTexto] = useState<string | null>(null)

  const stock = item?.stockActual ?? null
  const valor = texto ?? (stock === null ? '' : String(stock))
  const pedir = item?.cantidadPedir ?? null
  const hayQuePedir = pedir !== null && pedir > 0
  const sinMinimo = producto.stockMinimo === null

  const guardar = (n: number | null) => {
    setTexto(null)
    void setStockActual(conteo, producto, n)
  }

  const paso = (delta: number) => {
    const base = stock ?? 0
    guardar(Math.max(0, Math.round((base + delta) * 100) / 100))
  }

  return (
    <div className={'fila' + (hayQuePedir ? ' falta' : '')}>
      <div className="fila-arriba">
        <div className="fila-datos">
          <div className="nombre">{producto.nombre}</div>
          <div className="meta">
            {producto.unidad ?? '—'}
            <span className="sep">·</span>
            {sinMinimo ? 'sin mínimo' : `mín ${producto.stockMinimo}`}
            <span className="sep">·</span>
            {proveedor?.nombre ?? '…'}
          </div>
        </div>

        <div className="contador">
          <button type="button" onClick={() => paso(-1)} aria-label="restar uno">−</button>
          <input
            type="text"
            inputMode="decimal"
            className={valor === '' ? 'vacio' : ''}
            placeholder="—"
            value={valor}
            aria-label={`stock actual de ${producto.nombre}`}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => guardar(parseNum(valor))}
          />
          <button type="button" onClick={() => paso(1)} aria-label="sumar uno">+</button>
        </div>
      </div>

      {/*
        Dos modos segun el producto tenga minimo o no. Los 191 productos sin
        configurar tienen que poder pedirse igual: si la app solo sirviera
        para el catalogo completo, nadie terminaria de completarlo.
      */}
      {sinMinimo ? (
        <div className="fila-abajo">
          <span className="sin-config">sin mínimo</span>
          <span className="pedir-label">pedir</span>
          <input
            type="text"
            inputMode="decimal"
            className="pedir-manual"
            placeholder="—"
            defaultValue={pedir ?? ''}
            aria-label={`cantidad a pedir de ${producto.nombre}`}
            onBlur={(e) => void setCantidadPedir(conteo, producto, parseNum(e.target.value))}
          />
          <span className="pedir-label">{producto.unidad ?? ''}</span>
        </div>
      ) : hayQuePedir ? (
        <div className="fila-abajo">
          <span className="pedir-auto">
            Pedir {pedir} {producto.unidad ?? ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function Conteo({ conteo, sync, onVerPedido, onVerHistorial }: Props) {
  const [sector, setSector] = useState<Sector>('camara')

  const productos = useLiveQuery(
    () => db.productos.where('sector').equals(sector).filter((p) => p.activo).toArray(),
    [sector], undefined,
  )
  const items = useLiveQuery(
    () => db.conteoItems.where('conteoId').equals(conteo.id).toArray(),
    [conteo.id], undefined,
  )
  const totales = useLiveQuery(async () => {
    const activos = await db.productos.filter((p) => p.activo).toArray()
    const cuenta = new Map<Sector, number>()
    for (const p of activos) cuenta.set(p.sector, (cuenta.get(p.sector) ?? 0) + 1)
    return cuenta
  }, [], undefined)

  const porProducto = useMemo(() => {
    const m = new Map<string, ConteoItem>()
    for (const i of items ?? []) m.set(i.productoId, i)
    return m
  }, [items])

  const ordenados = useMemo(
    () => ordenarParaConteo(productos ?? []), [productos],
  )

  const contados = ordenados.filter(
    (p) => (porProducto.get(p.id)?.stockActual ?? null) !== null,
  ).length
  const aPedir = (items ?? []).filter((i) => (i.cantidadPedir ?? 0) > 0).length

  if (productos === undefined || totales === undefined) {
    return <div className="centrado">Cargando…</div>
  }

  return (
    <>
      {/*
        Cabecera y chips van juntos en el mismo bloque sticky: al desplazar la
        lista, el sector en el que se esta contando tiene que seguir visible.
      */}
      <header className="cabecera">
        <div className="cabecera-fila">
          <div>
            <h1 className="titulo">Conteo de depósito</h1>
            <div className="subtitulo">{fechaHoy()}</div>
          </div>
          <div className="acciones-cabecera">
            <button
              type="button" className="conexion"
              onClick={() => void sync.sincronizar()}
              title="Tocar para sincronizar ahora"
            >
              <span className={'punto ' + CLASE_PUNTO[sync.estado]} />
              {ETIQUETA_CONEXION[sync.estado]}
              {/*
                Lo que falta subir se muestra siempre, no solo cuando hay
                error. Es la prueba visible de que un conteo hecho sin senal
                no se perdio: sin esto, "sin conexion" se lee como "se borro".
              */}
              {sync.pendientes > 0 && (
                <span className="pendientes" title="cambios sin subir">
                  {sync.pendientes}
                </span>
              )}
            </button>
            <button
              type="button" className="icono" onClick={onVerHistorial}
              title="Historial de pedidos" aria-label="Historial de pedidos"
            >
              ☰
            </button>
          </div>
        </div>

        <div className="sectores">
          {SECTORES.map((s) => {
            const n = totales.get(s) ?? 0
            if (n === 0) return null
            return (
              <button
                key={s} type="button" className="chip"
                aria-pressed={s === sector} onClick={() => setSector(s)}
              >
                {SECTOR_LABEL[s]}<span className="cuenta">{n}</span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="lista">
        {ordenados.length === 0 ? (
          <div className="vacio-sector">No hay productos activos en este sector.</div>
        ) : (
          ordenados.map((p) => (
            <Fila key={p.id} producto={p} item={porProducto.get(p.id)} conteo={conteo} />
          ))
        )}
      </div>

      <div className="pie">
        <div className="progreso">
          <div className="progreso-texto">
            {contados} de {ordenados.length} contados en {SECTOR_LABEL[sector]}
          </div>
          <div className="barra">
            <div style={{
              width: ordenados.length === 0 ? '0%'
                : `${Math.round((contados / ordenados.length) * 100)}%`,
            }} />
          </div>
        </div>
        <button type="button" className="boton" disabled={aPedir === 0} onClick={onVerPedido}>
          Ver pedido{aPedir > 0 ? ` (${aPedir})` : ''}
        </button>
      </div>
    </>
  )
}
