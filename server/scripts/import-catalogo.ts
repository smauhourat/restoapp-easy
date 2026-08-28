/**
 * Importador del catalogo desde catalogo-normalizado.xlsx.
 *
 * Uso:
 *   npm run import                     -- conservador (default)
 *   npm run import -- --overwrite      -- el Excel pisa lo cargado en el ABM
 *   npm run import -- --file otro.xlsx
 *
 * MODO CONSERVADOR (default). Al re-importar nunca pisa un valor ya cargado
 * en la base con un vacio del Excel: solo rellena campos que estan en null.
 * Es la decision mas importante del script. Completar unidad, minimo y orden
 * de los 203 productos sin configurar es la tarea mas larga del proyecto y la
 * hace una persona a mano; un import descuidado la borra entera.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { v7 as uuidv7 } from 'uuid'
import type { Prisma, Sector, Unidad } from '@prisma/client'
import { prisma } from '../src/lib/prisma.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** El telefono placeholder que comparten los 15 proveedores del catalogo. */
const TELEFONO_PLACEHOLDER = '5491136801621'

const SECTORES_VALIDOS = new Set([
  'camara', 'seco', 'bebidas', 'congelado', 'limpieza', 'descartables', 'bodega',
])
const UNIDADES_VALIDAS = new Set(['kg', 'lt', 'un'])

// ---------------------------------------------------------------- helpers

/**
 * Texto de celda -> string limpio o null.
 * Varios nombres del Excel traen espacios sobrantes y hay celdas "vacias"
 * que en realidad contienen un espacio.
 */
function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * Numero de celda -> number o null.
 *
 * Un vacio se convierte en null y NUNCA en 0. La diferencia gobierna toda la
 * pantalla de conteo: stockMinimo = 0 significa "este producto no se pide
 * nunca"; stockMinimo = null significa "todavia no se configuro". Colapsarlos
 * haria que la app afirme que no hace falta pedir sobre 203 productos que
 * nadie reviso.
 */
function num(v: unknown): number | null {
  const s = txt(v)
  if (s === null) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function int(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.round(n)
}

function normalizarUnidad(v: unknown, ctx: string, avisos: string[]): Unidad | null {
  const s = txt(v)?.toLowerCase()
  if (s === null || s === undefined) return null
  if (!UNIDADES_VALIDAS.has(s)) {
    avisos.push(`unidad desconocida "${s}" en ${ctx} -- se importa como null`)
    return null
  }
  return s as Unidad
}

function normalizarSector(v: unknown, ctx: string): Sector {
  const s = txt(v)?.toLowerCase()
  if (s === null || s === undefined || !SECTORES_VALIDOS.has(s)) {
    throw new Error(`sector invalido "${s ?? ''}" en ${ctx}`)
  }
  return s as Sector
}

/** Solo digitos: el ABM acepta que peguen el telefono con +, espacios o guiones. */
function normalizarTelefono(v: unknown): string {
  return (txt(v) ?? '').replace(/\D/g, '')
}

// ---------------------------------------------------------------- tipos

interface FilaProducto {
  proveedor: string
  familia: string | null
  producto: string
  unidad: Unidad | null
  sector: Sector
  ordenRecorrido: number | null
  stockMinimo: number | null
  precioUnitario: number | null
  cantidadBulto: number | null
  precioBulto: number | null
  activo: boolean
  fila: number
}

interface FilaProveedor {
  proveedor: string
  telefonoWa: string
  diasEntrega: string | null
  horaCorte: string | null
  contacto: string | null
  notas: string | null
}

// ---------------------------------------------------------------- lectura

function leerExcel(path: string, avisos: string[]) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' })

  // La hoja `leyenda` son instrucciones para el usuario, no datos.
  for (const requerida of ['productos', 'proveedores']) {
    if (!wb.SheetNames.includes(requerida)) {
      throw new Error(`falta la hoja "${requerida}" en ${path}`)
    }
  }

  const rawProd = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets['productos']!, { defval: null },
  )
  const rawProv = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets['proveedores']!, { defval: null },
  )

  const proveedores: FilaProveedor[] = []
  for (const r of rawProv) {
    const nombre = txt(r['proveedor'])
    if (nombre === null) continue // fila vacia al final de la hoja
    proveedores.push({
      proveedor: nombre,
      telefonoWa: normalizarTelefono(r['telefono_whatsapp']),
      diasEntrega: txt(r['dias_entrega']),
      horaCorte: txt(r['hora_corte_pedido']),
      contacto: txt(r['contacto']),
      notas: txt(r['notas']),
    })
  }

  const productos: FilaProducto[] = []
  rawProd.forEach((r, i) => {
    const fila = i + 2 // +1 por el encabezado, +1 porque Excel cuenta desde 1
    const nombre = txt(r['producto'])
    if (nombre === null) return
    const proveedor = txt(r['proveedor'])
    if (proveedor === null) {
      avisos.push(`fila ${fila}: producto "${nombre}" sin proveedor -- se omite`)
      return
    }
    const ctx = `fila ${fila} ("${nombre}")`
    productos.push({
      proveedor,
      familia: txt(r['familia']),
      producto: nombre,
      unidad: normalizarUnidad(r['unidad'], ctx, avisos),
      sector: normalizarSector(r['sector'], ctx),
      ordenRecorrido: int(r['orden_recorrido']),
      stockMinimo: num(r['stock_minimo']),
      precioUnitario: num(r['precio_unitario']),
      cantidadBulto: num(r['cantidad_bulto']),
      precioBulto: num(r['precio_bulto']),
      activo: (txt(r['activo']) ?? 'SI').toUpperCase() !== 'NO',
      fila,
    })
  })

  return { productos, proveedores }
}

// ------------------------------------------------------------ duplicados

interface GrupoDuplicado {
  nombre: string
  elegido: FilaProducto
  descartados: FilaProducto[]
}

/**
 * Resuelve los productos que aparecen en mas de un proveedor.
 *
 * El CLAUDE.md lo marca como problema #2: sin un proveedor por defecto, el
 * mismo producto se cuenta una vez pero se pide a tres proveedores.
 *
 * Todas las filas se importan igual -- no se pierde ninguna, y el precio de
 * cada proveedor queda registrado, que es la contracara util del problema.
 * Lo que hace esta funcion es elegir cual queda `activo`, para que el conteo
 * muestre el producto UNA sola vez. La eleccion es deterministica y se
 * reporta entera al final para poder revisarla y cambiarla en el ABM.
 *
 * Criterio, en orden:
 *   1. que tenga precio cargado -- sin precio no hay control de costos
 *   2. el precio unitario mas bajo
 *   3. el nombre del proveedor alfabetico, solo para desempatar sin azar
 */
function resolverDuplicados(productos: FilaProducto[]): GrupoDuplicado[] {
  const porNombre = new Map<string, FilaProducto[]>()
  for (const p of productos) {
    const clave = p.producto.toUpperCase()
    const g = porNombre.get(clave)
    if (g) g.push(p)
    else porNombre.set(clave, [p])
  }

  const grupos: GrupoDuplicado[] = []
  for (const filas of porNombre.values()) {
    if (filas.length < 2) continue
    const ordenadas = [...filas].sort((a, b) => {
      const aTiene = a.precioUnitario !== null
      const bTiene = b.precioUnitario !== null
      if (aTiene !== bTiene) return aTiene ? -1 : 1
      if (aTiene && bTiene && a.precioUnitario !== b.precioUnitario) {
        return a.precioUnitario! - b.precioUnitario!
      }
      return a.proveedor.localeCompare(b.proveedor, 'es')
    })
    grupos.push({
      nombre: filas[0]!.producto,
      elegido: ordenadas[0]!,
      descartados: ordenadas.slice(1),
    })
  }
  return grupos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

// ------------------------------------------------------------ importacion

async function main() {
  const args = process.argv.slice(2)
  const overwrite = args.includes('--overwrite')
  const fileArg = args.indexOf('--file')
  const path = fileArg >= 0 && args[fileArg + 1]
    ? resolve(args[fileArg + 1]!)
    : resolve(__dirname, '../../catalogo-normalizado.xlsx')

  if (!existsSync(path)) throw new Error(`no encuentro el archivo: ${path}`)

  const avisos: string[] = []
  console.log(`Leyendo ${path}`)
  console.log(overwrite
    ? 'Modo: --overwrite (el Excel pisa lo cargado en el ABM)'
    : 'Modo: conservador (no pisa datos ya cargados en el ABM)')
  console.log('')

  const { productos, proveedores } = leerExcel(path, avisos)

  // --- proveedores -------------------------------------------------------
  const idPorProveedor = new Map<string, string>()
  let provCreados = 0
  let provActualizados = 0

  for (const p of proveedores) {
    const existente = await prisma.proveedor.findUnique({
      where: { nombre: p.proveedor },
    })
    const esPlaceholder = p.telefonoWa === TELEFONO_PLACEHOLDER

    if (!existente) {
      const creado = await prisma.proveedor.create({
        data: {
          id: uuidv7(),
          nombre: p.proveedor,
          telefonoWa: p.telefonoWa,
          telefonoEsPlaceholder: esPlaceholder,
          diasEntrega: p.diasEntrega,
          horaCorte: p.horaCorte,
          contacto: p.contacto,
          notas: p.notas,
        },
      })
      idPorProveedor.set(p.proveedor, creado.id)
      provCreados++
      continue
    }

    idPorProveedor.set(p.proveedor, existente.id)

    // Conservador: un telefono real cargado en el ABM le gana al placeholder
    // del Excel. Es justo el dato que se carga a mano y que un re-import
    // descuidado destruiria, mandando pedidos al numero de prueba.
    //
    // Todas las asignaciones comparan contra el valor actual antes de
    // escribir. Un UPDATE que no cambia nada igual dispara el trigger de
    // serverSeq, y eso obligaria a todos los clientes a re-descargar el
    // maestro entero despues de cada import.
    const data: Prisma.ProveedorUpdateInput = {}
    const puedeTocarTelefono =
      overwrite || existente.telefonoEsPlaceholder || existente.telefonoWa === ''
    if (puedeTocarTelefono && p.telefonoWa !== '' && p.telefonoWa !== existente.telefonoWa) {
      data.telefonoWa = p.telefonoWa
      data.telefonoEsPlaceholder = esPlaceholder
    }
    if ((overwrite || existente.diasEntrega === null)
      && p.diasEntrega !== null && p.diasEntrega !== existente.diasEntrega) {
      data.diasEntrega = p.diasEntrega
    }
    if ((overwrite || existente.horaCorte === null)
      && p.horaCorte !== null && p.horaCorte !== existente.horaCorte) {
      data.horaCorte = p.horaCorte
    }
    if ((overwrite || existente.contacto === null)
      && p.contacto !== null && p.contacto !== existente.contacto) {
      data.contacto = p.contacto
    }
    if ((overwrite || existente.notas === null)
      && p.notas !== null && p.notas !== existente.notas) {
      data.notas = p.notas
    }
    if (existente.deletedAt !== null) data.deletedAt = null

    if (Object.keys(data).length > 0) {
      await prisma.proveedor.update({ where: { id: existente.id }, data })
      provActualizados++
    }
  }

  // Un producto que apunta a un proveedor ausente de la hoja `proveedores`
  // no se puede importar: la FK no existe.
  const proveedoresFaltantes = new Set(
    productos.map((p) => p.proveedor).filter((n) => !idPorProveedor.has(n)),
  )
  if (proveedoresFaltantes.size > 0) {
    throw new Error(
      'estos proveedores aparecen en la hoja "productos" pero no en "proveedores": ' +
      [...proveedoresFaltantes].join(', '),
    )
  }

  // --- duplicados --------------------------------------------------------
  const duplicados = resolverDuplicados(productos)
  const descartados = new Set<FilaProducto>()
  for (const g of duplicados) for (const d of g.descartados) descartados.add(d)

  // --- productos ---------------------------------------------------------
  let creados = 0
  let actualizados = 0
  let sinCambios = 0

  for (const p of productos) {
    const proveedorId = idPorProveedor.get(p.proveedor)!
    const activoCalculado = p.activo && !descartados.has(p)

    const existente = await prisma.producto.findUnique({
      where: { proveedorId_nombre: { proveedorId, nombre: p.producto } },
    })

    if (!existente) {
      await prisma.producto.create({
        data: {
          id: uuidv7(),
          nombre: p.producto,
          familia: p.familia,
          unidad: p.unidad,
          proveedorId,
          sector: p.sector,
          ordenRecorrido: p.ordenRecorrido,
          stockMinimo: p.stockMinimo,
          precioUnitario: p.precioUnitario,
          cantidadBulto: p.cantidadBulto,
          precioBulto: p.precioBulto,
          activo: activoCalculado,
        },
      })
      creados++
      continue
    }

    const data: Prisma.ProductoUpdateInput = {}

    /** Rellena solo si la base tiene null, salvo en modo --overwrite. */
    const completar = (
      campo: 'familia' | 'unidad' | 'ordenRecorrido' | 'stockMinimo'
        | 'precioUnitario' | 'cantidadBulto' | 'precioBulto',
      actual: unknown,
      nuevo: unknown,
    ) => {
      if (nuevo === null || nuevo === undefined) return
      if (overwrite || actual === null || actual === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data as any)[campo] = nuevo
      }
    }

    completar('familia', existente.familia, p.familia)
    completar('unidad', existente.unidad, p.unidad)
    completar('ordenRecorrido', existente.ordenRecorrido, p.ordenRecorrido)
    completar('stockMinimo', existente.stockMinimo, p.stockMinimo)
    completar('precioUnitario', existente.precioUnitario, p.precioUnitario)
    completar('cantidadBulto', existente.cantidadBulto, p.cantidadBulto)
    completar('precioBulto', existente.precioBulto, p.precioBulto)

    if (overwrite && existente.sector !== p.sector) data.sector = p.sector
    // `activo` solo se toca con --overwrite: si alguien resolvio un duplicado
    // a mano en el ABM, el import no le revierte la decision.
    if (overwrite && existente.activo !== activoCalculado) data.activo = activoCalculado
    if (existente.deletedAt !== null) data.deletedAt = null

    if (Object.keys(data).length > 0) {
      await prisma.producto.update({ where: { id: existente.id }, data })
      actualizados++
    } else {
      sinCambios++
    }
  }

  // --- reporte -----------------------------------------------------------
  const totalProd = await prisma.producto.count({ where: { deletedAt: null } })
  const totalProv = await prisma.proveedor.count({ where: { deletedAt: null } })
  const sinConfigurar = await prisma.producto.count({
    where: {
      deletedAt: null, activo: true,
      OR: [{ unidad: null }, { ordenRecorrido: null }, { stockMinimo: null }],
    },
  })
  const conPlaceholder = await prisma.proveedor.count({
    where: { deletedAt: null, telefonoEsPlaceholder: true },
  })

  console.log('Proveedores')
  console.log(`  creados ${provCreados} | actualizados ${provActualizados} | total ${totalProv}`)
  console.log('Productos')
  console.log(`  creados ${creados} | actualizados ${actualizados} | sin cambios ${sinCambios} | total ${totalProd}`)

  if (duplicados.length > 0) {
    console.log('')
    console.log(`Productos en mas de un proveedor: ${duplicados.length}`)
    console.log('  Se importaron todas las filas. Queda ACTIVO uno solo por producto,')
    console.log('  para que el conteo no genere pedidos duplicados. Revisalo en el ABM.')
    console.log('')
    const precio = (f: FilaProducto) =>
      f.precioUnitario === null ? 'sin precio' : `${f.precioUnitario} EUR`
    for (const g of duplicados) {
      console.log(`  ${g.nombre}`)
      console.log(`    activo    ${g.elegido.proveedor} (${precio(g.elegido)})`)
      for (const d of g.descartados) {
        console.log(`    inactivo  ${d.proveedor} (${precio(d)})`)
      }
    }
  }

  if (avisos.length > 0) {
    console.log('')
    console.log(`Avisos: ${avisos.length}`)
    for (const a of avisos) console.log(`  ${a}`)
  }

  console.log('')
  console.log('Pendiente de carga manual en el ABM')
  console.log(`  ${sinConfigurar} productos activos sin unidad, orden o minimo`)
  console.log(`  ${conPlaceholder} proveedores con el telefono de prueba ${TELEFONO_PLACEHOLDER}`)
}

main()
  .catch((e) => {
    console.error('')
    console.error('ERROR:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
