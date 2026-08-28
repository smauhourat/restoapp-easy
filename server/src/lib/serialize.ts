import type {
  Conteo, ConteoItem, Pedido, PedidoItem, Producto, Proveedor,
} from '@prisma/client'
import type {
  Conteo as ConteoDTO,
  ConteoItem as ConteoItemDTO,
  Pedido as PedidoDTO,
  PedidoItem as PedidoItemDTO,
  Producto as ProductoDTO,
  Proveedor as ProveedorDTO,
} from '@resto/shared'

/**
 * Traduccion de las filas de Prisma al DTO que viaja por la API.
 *
 * Existe porque dos tipos de Prisma no sobreviven a JSON.stringify:
 *   - Decimal es un objeto, y serializado directo sale como {s,e,d}.
 *   - BigInt tira TypeError al stringificar.
 *
 * serverSeq viaja como string a proposito, no como number: es un BigInt y a
 * la larga puede pasar Number.MAX_SAFE_INTEGER. El cliente solo lo compara y
 * lo reenvia, nunca hace aritmetica con el.
 */

function dec(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString())
}

function iso(d: Date | null): string | null {
  return d === null ? null : d.toISOString()
}

function syncFields(r: { serverSeq: bigint; updatedAt: Date; deletedAt: Date | null }) {
  return {
    serverSeq: r.serverSeq.toString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  }
}

export function toProveedorDTO(r: Proveedor): ProveedorDTO {
  return {
    id: r.id,
    nombre: r.nombre,
    telefonoWa: r.telefonoWa,
    telefonoEsPlaceholder: r.telefonoEsPlaceholder,
    diasEntrega: r.diasEntrega,
    horaCorte: r.horaCorte,
    contacto: r.contacto,
    notas: r.notas,
    ...syncFields(r),
  }
}

export function toProductoDTO(r: Producto): ProductoDTO {
  return {
    id: r.id,
    nombre: r.nombre,
    familia: r.familia,
    unidad: r.unidad,
    proveedorId: r.proveedorId,
    sector: r.sector,
    ordenRecorrido: r.ordenRecorrido,
    stockMinimo: dec(r.stockMinimo),
    precioUnitario: dec(r.precioUnitario),
    cantidadBulto: dec(r.cantidadBulto),
    precioBulto: dec(r.precioBulto),
    activo: r.activo,
    ...syncFields(r),
  }
}

export function toConteoDTO(r: Conteo): ConteoDTO {
  return {
    id: r.id,
    fecha: r.fecha,
    usuario: r.usuario,
    estado: r.estado,
    ...syncFields(r),
  }
}

export function toConteoItemDTO(r: ConteoItem): ConteoItemDTO {
  return {
    id: r.id,
    conteoId: r.conteoId,
    productoId: r.productoId,
    stockActual: dec(r.stockActual),
    cantidadPedir: dec(r.cantidadPedir),
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    ...syncFields(r),
  }
}

export function toPedidoDTO(r: Pedido): PedidoDTO {
  return {
    id: r.id,
    conteoId: r.conteoId,
    proveedorId: r.proveedorId,
    fecha: r.fecha,
    estado: r.estado,
    mensajeGenerado: r.mensajeGenerado,
    mensajeEditado: r.mensajeEditado,
    clientUpdatedAt: r.clientUpdatedAt.toISOString(),
    ...syncFields(r),
  }
}

export function toPedidoItemDTO(r: PedidoItem): PedidoItemDTO {
  return {
    id: r.id,
    pedidoId: r.pedidoId,
    productoId: r.productoId,
    cantidad: Number(r.cantidad.toString()),
    nombreProducto: r.nombreProducto,
    unidad: r.unidad,
    precioUnitario: dec(r.precioUnitario),
    ...syncFields(r),
  }
}
