import { describe, expect, it } from 'vitest'
import type { Producto, Proveedor } from './domain.js'
import {
  agruparPorProveedor, calcularCantidadPedir, estaConfigurado, formatCantidad,
  generarLinkWhatsApp, generarMensaje, ordenarParaConteo, redondearABulto,
} from './pedido.js'

const base: Producto = {
  id: 'p1', nombre: 'MOZZARELLA', familia: null, unidad: 'kg',
  proveedorId: 'prov1', sector: 'camara', ordenRecorrido: 300,
  stockMinimo: 10, precioUnitario: 8.5, cantidadBulto: null,
  precioBulto: null, activo: true,
  serverSeq: '1', updatedAt: '2026-08-28T10:00:00.000Z', deletedAt: null,
}
const producto = (o: Partial<Producto> = {}): Producto => ({ ...base, ...o })

describe('calcularCantidadPedir', () => {
  it('pide la diferencia entre el minimo y lo contado', () => {
    expect(calcularCantidadPedir(producto(), 4)).toBe(6)
  })

  it('devuelve 0 cuando hay stock de sobra', () => {
    expect(calcularCantidadPedir(producto(), 12)).toBe(0)
    expect(calcularCantidadPedir(producto(), 10)).toBe(0)
  })

  // El caso que sostiene todo el diseno: 191 de los 272 productos activos
  // no tienen minimo cargado. Devolver 0 seria afirmar "no hace falta pedir"
  // sobre productos que nadie configuro.
  it('devuelve null -- no 0 -- si el producto no tiene minimo', () => {
    expect(calcularCantidadPedir(producto({ stockMinimo: null }), 4)).toBeNull()
  })

  it('devuelve null si todavia no se conto', () => {
    expect(calcularCantidadPedir(producto(), null)).toBeNull()
  })

  // Un minimo de 0 SI es una respuesta: "este producto no se pide nunca".
  it('distingue un minimo de 0 de un minimo sin cargar', () => {
    expect(calcularCantidadPedir(producto({ stockMinimo: 0 }), 0)).toBe(0)
    expect(calcularCantidadPedir(producto({ stockMinimo: null }), 0)).toBeNull()
  })

  it('redondea al bulto solo si se lo pide', () => {
    const p = producto({ stockMinimo: 10, cantidadBulto: 4 })
    expect(calcularCantidadPedir(p, 3)).toBe(7)
    expect(calcularCantidadPedir(p, 3, { redondearABulto: true })).toBe(8)
  })
})

describe('redondearABulto', () => {
  it('sube al siguiente multiplo', () => {
    expect(redondearABulto(7, 4)).toBe(8)
    expect(redondearABulto(8, 4)).toBe(8)
  })
  it('no toca la cantidad si no hay bulto', () => {
    expect(redondearABulto(7, null)).toBe(7)
    expect(redondearABulto(7, 0)).toBe(7)
  })
})

describe('estaConfigurado', () => {
  it('exige los tres campos que gobiernan la UX del conteo', () => {
    expect(estaConfigurado(producto())).toBe(true)
    expect(estaConfigurado(producto({ unidad: null }))).toBe(false)
    expect(estaConfigurado(producto({ ordenRecorrido: null }))).toBe(false)
    expect(estaConfigurado(producto({ stockMinimo: null }))).toBe(false)
  })
})

describe('ordenarParaConteo', () => {
  it('ordena por recorrido fisico', () => {
    const r = ordenarParaConteo([
      producto({ nombre: 'C', ordenRecorrido: 300 }),
      producto({ nombre: 'A', ordenRecorrido: 100 }),
      producto({ nombre: 'B', ordenRecorrido: 200 }),
    ])
    expect(r.map((p) => p.nombre)).toEqual(['A', 'B', 'C'])
  })

  // Los sin configurar van al final y alfabeticos. Intercalarlos en
  // posiciones arbitrarias obligaria a caminar de vuelta por el deposito.
  it('manda al final los que no tienen orden, en alfabetico', () => {
    const r = ordenarParaConteo([
      producto({ nombre: 'Z', ordenRecorrido: null }),
      producto({ nombre: 'M', ordenRecorrido: 500 }),
      producto({ nombre: 'A', ordenRecorrido: null }),
    ])
    expect(r.map((p) => p.nombre)).toEqual(['M', 'A', 'Z'])
  })
})

describe('agruparPorProveedor', () => {
  it('separa el pedido por proveedor', () => {
    const g = agruparPorProveedor([
      { producto: producto({ id: 'a', proveedorId: 'p1' }), cantidadPedir: 2 },
      { producto: producto({ id: 'b', proveedorId: 'p2' }), cantidadPedir: 3 },
      { producto: producto({ id: 'c', proveedorId: 'p1' }), cantidadPedir: 1 },
    ])
    expect(g).toHaveLength(2)
    expect(g.find((x) => x.proveedorId === 'p1')?.lineas).toHaveLength(2)
  })

  it('descarta lo que no hay que pedir', () => {
    const g = agruparPorProveedor([
      { producto: producto({ id: 'a' }), cantidadPedir: 0 },
      { producto: producto({ id: 'b' }), cantidadPedir: null },
      { producto: producto({ id: 'c' }), cantidadPedir: -1 },
    ])
    expect(g).toHaveLength(0)
  })

  // Los 22 duplicados quedan inactivos justamente para no pedir dos veces
  // el mismo producto a dos proveedores distintos.
  it('ignora los productos inactivos', () => {
    const g = agruparPorProveedor([
      { producto: producto({ id: 'a', activo: false }), cantidadPedir: 5 },
    ])
    expect(g).toHaveLength(0)
  })
})

describe('generarMensaje', () => {
  const proveedor = (diasEntrega: string | null) =>
    ({ diasEntrega }) as Pick<Proveedor, 'diasEntrega'>

  it('usa el formato de la seccion 9 del CLAUDE.md', () => {
    const msg = generarMensaje({
      nombreRestaurante: 'La Nonna',
      fecha: '2026-08-28',
      proveedor: proveedor('martes y viernes'),
      lineas: [
        { productoId: 'a', nombreProducto: 'MOZZARELLA', unidad: 'kg', cantidad: 6, precioUnitario: null },
        { productoId: 'b', nombreProducto: 'RICOTA', unidad: 'kg', cantidad: 2.5, precioUnitario: null },
      ],
    })
    expect(msg).toBe(
      'Hola! Pedido de La Nonna\n' +
      '28/08/2026 — entrega martes y viernes\n' +
      '\n' +
      '• MOZZARELLA — 6 kg\n' +
      '• RICOTA — 2,5 kg\n' +
      '\n' +
      'Gracias!',
    )
  })

  it('omite el dia de entrega si el proveedor no lo tiene cargado', () => {
    const msg = generarMensaje({
      nombreRestaurante: 'La Nonna', fecha: '2026-08-28',
      proveedor: proveedor(null),
      lineas: [{ productoId: 'a', nombreProducto: 'X', unidad: 'un', cantidad: 1, precioUnitario: null }],
    })
    expect(msg).toContain('28/08/2026\n')
    expect(msg).not.toContain('entrega')
  })

  // Con 191 productos sin unidad cargada, el mensaje tiene que salir legible
  // igual en vez de imprimir "undefined".
  it('omite la unidad cuando el producto no la tiene', () => {
    const msg = generarMensaje({
      nombreRestaurante: 'La Nonna', fecha: '2026-08-28',
      proveedor: proveedor(null),
      lineas: [{ productoId: 'a', nombreProducto: 'SERVILLETAS', unidad: null, cantidad: 3, precioUnitario: null }],
    })
    expect(msg).toContain('• SERVILLETAS — 3\n')
    expect(msg).not.toContain('undefined')
  })
})

describe('formatCantidad', () => {
  it('usa coma decimal y no deja ceros sobrantes', () => {
    expect(formatCantidad(2)).toBe('2')
    expect(formatCantidad(2.5)).toBe('2,5')
    expect(formatCantidad(0.1 + 0.2)).toBe('0,3')
  })
})

describe('generarLinkWhatsApp', () => {
  it('limpia el telefono y codifica el mensaje', () => {
    const url = generarLinkWhatsApp('+376 123 456', 'Hola!\nPedido')
    expect(url).toBe('https://wa.me/376123456?text=Hola!%0APedido')
  })

  it('codifica los saltos de linea y los acentos', () => {
    const url = generarLinkWhatsApp('376123456', '• café — 2 kg')
    expect(url).not.toContain(' ')
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe('• café — 2 kg')
  })
})
