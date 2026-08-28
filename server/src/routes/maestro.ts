import { Router } from 'express'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { sectorSchema, unidadSchema } from '@resto/shared'
import { prisma } from '../lib/prisma.js'
import { toProductoDTO, toProveedorDTO } from '../lib/serialize.js'

/**
 * ABM del maestro. Es la unica via por la que se escriben productos y
 * proveedores: el cliente los trata como read-only y solo los baja por el
 * pull. Esa asimetria es lo que elimina los conflictos de sincronizacion
 * sobre el catalogo.
 *
 * Su razon de ser inmediata es destrabar la carga de los 191 productos
 * activos que no tienen unidad, orden de recorrido ni stock minimo. Sin esos
 * tres campos el conteo no puede sugerir cantidades, y completarlos es la
 * tarea mas larga del proyecto.
 */
export const maestroRouter = Router()

/** null explicito = "borrar el valor"; undefined = "no tocar este campo". */
const nullableNum = z.number().nullable().optional()

const productoPatchSchema = z.object({
  nombre: z.string().min(1).optional(),
  familia: z.string().nullable().optional(),
  unidad: unidadSchema.nullable().optional(),
  sector: sectorSchema.optional(),
  proveedorId: z.string().uuid().optional(),
  ordenRecorrido: z.number().int().nullable().optional(),
  stockMinimo: nullableNum,
  precioUnitario: nullableNum,
  cantidadBulto: nullableNum,
  precioBulto: nullableNum,
  activo: z.boolean().optional(),
})

const proveedorPatchSchema = z.object({
  nombre: z.string().min(1).optional(),
  telefonoWa: z.string().optional(),
  diasEntrega: z.string().nullable().optional(),
  horaCorte: z.string().nullable().optional(),
  contacto: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
})

// ------------------------------------------------------------- proveedores

maestroRouter.get('/proveedores', async (_req, res) => {
  const filas = await prisma.proveedor.findMany({
    where: { deletedAt: null },
    orderBy: { nombre: 'asc' },
  })
  res.json(filas.map(toProveedorDTO))
})

maestroRouter.patch('/proveedores/:id', async (req, res) => {
  const parsed = proveedorPatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const { telefonoWa, ...resto } = parsed.data
  const data: Record<string, unknown> = { ...resto }

  if (telefonoWa !== undefined) {
    // Se acepta pegado con +, espacios o guiones y se guarda solo con
    // digitos, que es lo que exige el link de wa.me.
    const digitos = telefonoWa.replace(/\D/g, '')
    data['telefonoWa'] = digitos
    // Cargar un telefono a mano es exactamente el acto de reemplazar el
    // placeholder, asi que la marca se limpia sola.
    data['telefonoEsPlaceholder'] = false
  }

  try {
    const fila = await prisma.proveedor.update({
      where: { id: req.params.id },
      data,
    })
    res.json(toProveedorDTO(fila))
  } catch {
    res.status(404).json({ error: 'proveedor no encontrado' })
  }
})

// --------------------------------------------------------------- productos

maestroRouter.get('/productos', async (req, res) => {
  const sector = req.query['sector']
  const proveedorId = req.query['proveedorId']
  const soloIncompletos = req.query['incompletos'] === 'true'
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : ''

  const where: Record<string, unknown> = { deletedAt: null }
  if (typeof sector === 'string' && sector !== '') where['sector'] = sector
  if (typeof proveedorId === 'string' && proveedorId !== '') where['proveedorId'] = proveedorId
  if (q !== '') where['nombre'] = { contains: q, mode: 'insensitive' }
  if (soloIncompletos) {
    where['activo'] = true
    where['OR'] = [{ unidad: null }, { ordenRecorrido: null }, { stockMinimo: null }]
  }

  const filas = await prisma.producto.findMany({
    where,
    // Mismo orden que usa el conteo: recorrido fisico del deposito. Los que
    // no tienen orden van al final, que es justo donde hay que trabajar.
    orderBy: [
      { sector: 'asc' },
      { ordenRecorrido: { sort: 'asc', nulls: 'last' } },
      { nombre: 'asc' },
    ],
  })
  res.json(filas.map(toProductoDTO))
})

maestroRouter.patch('/productos/:id', async (req, res) => {
  const parsed = productoPatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  try {
    const fila = await prisma.producto.update({
      where: { id: req.params.id },
      data: parsed.data,
    })
    res.json(toProductoDTO(fila))
  } catch {
    res.status(404).json({ error: 'producto no encontrado' })
  }
})

maestroRouter.post('/productos', async (req, res) => {
  const schema = productoPatchSchema.required({ nombre: true, sector: true, proveedorId: true })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() })
  }
  const fila = await prisma.producto.create({
    data: { id: uuidv7(), ...parsed.data },
  })
  res.status(201).json(toProductoDTO(fila))
})

/**
 * Baja logica. Nunca un DELETE fisico: el pull le avisa al cliente de la baja
 * a traves de deletedAt, y una fila que desaparece de la tabla no se puede
 * comunicar. Ademas los pedidos historicos referencian al producto.
 */
maestroRouter.delete('/productos/:id', async (req, res) => {
  try {
    const fila = await prisma.producto.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), activo: false },
    })
    res.json(toProductoDTO(fila))
  } catch {
    res.status(404).json({ error: 'producto no encontrado' })
  }
})

// ---------------------------------------------------------------- resumen

/** Alimenta el tablero del ABM: que falta cargar y donde. */
maestroRouter.get('/resumen', async (_req, res) => {
  const porSector = await prisma.producto.groupBy({
    by: ['sector'],
    where: { deletedAt: null, activo: true },
    _count: { _all: true },
  })

  const incompletosPorSector = await prisma.producto.groupBy({
    by: ['sector'],
    where: {
      deletedAt: null, activo: true,
      OR: [{ unidad: null }, { ordenRecorrido: null }, { stockMinimo: null }],
    },
    _count: { _all: true },
  })

  const incompletos = new Map(
    incompletosPorSector.map((r) => [r.sector, r._count._all]),
  )

  const proveedoresPlaceholder = await prisma.proveedor.count({
    where: { deletedAt: null, telefonoEsPlaceholder: true },
  })
  const sinPrecio = await prisma.producto.count({
    where: { deletedAt: null, activo: true, precioUnitario: null },
  })

  res.json({
    sectores: porSector
      .map((r) => ({
        sector: r.sector,
        total: r._count._all,
        incompletos: incompletos.get(r.sector) ?? 0,
      }))
      .sort((a, b) => b.total - a.total),
    proveedoresPlaceholder,
    sinPrecio,
  })
})
