import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { firmarToken, requiereSesion, verificarPin } from '../lib/auth.js'

export const authRouter = Router()

const loginSchema = z.object({
  usuario: z.string().min(1),
  pin: z.string().min(4),
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'datos_invalidos' })
  }
  const { usuario, pin } = parsed.data

  const fila = await prisma.usuario.findUnique({ where: { nombre: usuario } })

  // Se verifica el PIN incluso cuando el usuario no existe, contra un hash
  // descartable, para que la respuesta tarde lo mismo en los dos casos. Si
  // no, el tiempo de respuesta revelaria que nombres existen.
  const hash = fila?.pinHash ?? 'x'.repeat(32) + ':' + 'y'.repeat(128)
  const pinOk = await verificarPin(pin, hash)

  if (fila === null || !fila.activo || !pinOk) {
    return res.status(401).json({ error: 'credenciales_invalidas' })
  }

  res.json({
    token: firmarToken({ usuarioId: fila.id, nombre: fila.nombre }),
    usuario: { id: fila.id, nombre: fila.nombre },
  })
})

/** Permite al cliente saber si su token sigue sirviendo. */
authRouter.get('/yo', requiereSesion, (req, res) => {
  res.json({ usuario: req.sesion })
})
