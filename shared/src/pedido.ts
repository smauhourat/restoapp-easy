import type { Producto, Proveedor, Unidad } from './domain.js'

/**
 * Logica pura de negocio: calculo de faltantes, redondeo a bulto,
 * agrupacion por proveedor y armado del mensaje de WhatsApp.
 *
 * Sin dependencias de React, Prisma ni Dexie a proposito: es la unica parte
 * del sistema con reglas de negocio no triviales y tiene que ser testeable
 * sin levantar nada.
 */

/** Redondea hacia arriba al multiplo de `bulto` mas cercano. */
export function redondearABulto(cantidad: number, bulto: number | null): number {
  if (bulto === null || bulto <= 0) return cantidad
  return Math.ceil(cantidad / bulto) * bulto
}

/**
 * Cantidad sugerida a pedir para un producto.
 *
 * Devuelve null cuando no hay sugerencia posible, que NO es lo mismo que 0:
 * - stockMinimo null  -> el producto no esta configurado; la cantidad la
 *   escribe el usuario a mano. 203 de los 293 productos estan asi hoy.
 * - stockActual null  -> todavia no se conto.
 *
 * Devolver 0 en esos casos haria que la app afirme "no hace falta pedir"
 * sobre productos que nadie miro.
 */
export function calcularCantidadPedir(
  producto: Pick<Producto, 'stockMinimo' | 'cantidadBulto'>,
  stockActual: number | null,
  opts: { redondearABulto?: boolean } = {},
): number | null {
  if (producto.stockMinimo === null || stockActual === null) return null
  const faltante = producto.stockMinimo - stockActual
  if (faltante <= 0) return 0
  return opts.redondearABulto
    ? redondearABulto(faltante, producto.cantidadBulto)
    : faltante
}

/** true si el producto tiene los tres campos que gobiernan la UX del conteo. */
export function estaConfigurado(
  p: Pick<Producto, 'unidad' | 'ordenRecorrido' | 'stockMinimo'>,
): boolean {
  return p.unidad !== null && p.ordenRecorrido !== null && p.stockMinimo !== null
}

/**
 * Ordena los productos de un sector para el conteo.
 *
 * Los que no tienen ordenRecorrido van al final y alfabeticos, en vez de
 * quedar intercalados en posiciones arbitrarias: el recorrido fisico del
 * deposito es lo que hace rapido el conteo, y una fila fuera de lugar
 * obliga a caminar de vuelta.
 */
export function ordenarParaConteo<T extends Pick<Producto, 'ordenRecorrido' | 'nombre'>>(
  productos: T[],
): T[] {
  return [...productos].sort((a, b) => {
    if (a.ordenRecorrido === null && b.ordenRecorrido === null) {
      return a.nombre.localeCompare(b.nombre, 'es')
    }
    if (a.ordenRecorrido === null) return 1
    if (b.ordenRecorrido === null) return -1
    if (a.ordenRecorrido !== b.ordenRecorrido) {
      return a.ordenRecorrido - b.ordenRecorrido
    }
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

export interface LineaPedido {
  productoId: string
  nombreProducto: string
  unidad: Unidad | null
  cantidad: number
  precioUnitario: number | null
}

export interface GrupoProveedor {
  proveedorId: string
  lineas: LineaPedido[]
}

/**
 * Agrupa las lineas a pedir por proveedor.
 *
 * Descarta cantidades <= 0 y productos inactivos. Los proveedores sin nada
 * que pedir no aparecen: la pantalla de resumen solo muestra tarjetas
 * accionables.
 */
export function agruparPorProveedor(
  items: Array<{ producto: Producto; cantidadPedir: number | null }>,
): GrupoProveedor[] {
  const porProveedor = new Map<string, LineaPedido[]>()

  for (const { producto, cantidadPedir } of items) {
    if (cantidadPedir === null || cantidadPedir <= 0) continue
    if (!producto.activo) continue

    const linea: LineaPedido = {
      productoId: producto.id,
      nombreProducto: producto.nombre,
      unidad: producto.unidad,
      cantidad: cantidadPedir,
      precioUnitario: producto.precioUnitario,
    }
    const actual = porProveedor.get(producto.proveedorId)
    if (actual) actual.push(linea)
    else porProveedor.set(producto.proveedorId, [linea])
  }

  return [...porProveedor.entries()].map(([proveedorId, lineas]) => ({
    proveedorId,
    lineas,
  }))
}

/**
 * Formatea una cantidad para el mensaje.
 * Coma decimal (los proveedores son de Espana / Andorra) y sin ceros
 * sobrantes: "2" y no "2,00"; "0,5" y no "0.50".
 */
export function formatCantidad(n: number): string {
  const redondeado = Math.round(n * 100) / 100
  return String(redondeado).replace('.', ',')
}

/** Fecha YYYY-MM-DD -> DD/MM/YYYY, sin depender de la zona horaria. */
export function formatFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

/**
 * Arma el mensaje de WhatsApp con el formato de la seccion 9 del CLAUDE.md.
 *
 * Si el producto no tiene unidad cargada se omite en vez de imprimir
 * "undefined": con 203 productos sin configurar, el mensaje tiene que salir
 * legible igual.
 */
export function generarMensaje(params: {
  nombreRestaurante: string
  fecha: string
  proveedor: Pick<Proveedor, 'diasEntrega'>
  lineas: LineaPedido[]
}): string {
  const { nombreRestaurante, fecha, proveedor, lineas } = params

  const entrega = proveedor.diasEntrega?.trim()
  const encabezadoFecha = entrega
    ? `${formatFecha(fecha)} — entrega ${entrega}`
    : formatFecha(fecha)

  const items = lineas.map((l) => {
    const cantidad = formatCantidad(l.cantidad)
    const unidad = l.unidad ? ` ${l.unidad}` : ''
    return `• ${l.nombreProducto} — ${cantidad}${unidad}`
  })

  return [
    `Hola! Pedido de ${nombreRestaurante}`,
    encabezadoFecha,
    '',
    ...items,
    '',
    'Gracias!',
  ].join('\n')
}

/**
 * Link de WhatsApp. El telefono va con codigo de pais y sin + ni separadores.
 * Cualquier caracter que no sea digito se descarta aca, no en la carga: el
 * ABM acepta que lo peguen con espacios y el link igual sale bien.
 */
export function generarLinkWhatsApp(telefono: string, mensaje: string): string {
  const soloDigitos = telefono.replace(/\D/g, '')
  return `https://wa.me/${soloDigitos}?text=${encodeURIComponent(mensaje)}`
}
