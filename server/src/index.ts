import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { maestroRouter } from './routes/maestro.js'
import { syncRouter } from './routes/sync.js'
import { pushRouter } from './routes/push.js'
import { authRouter } from './routes/auth.js'
import { requiereSesion } from './lib/auth.js'
import { prisma } from './lib/prisma.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = Number(process.env['PORT'] ?? 3001)

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true })
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e) })
  }
})

app.use('/api/auth', authRouter)

/**
 * Config que el cliente necesita y que no vive en la base.
 *
 * Va sin sesion: el nombre del restaurante lo necesita la pantalla de login
 * y no es un dato sensible.
 */
app.get('/api/config', (_req, res) => {
  res.json({
    nombreRestaurante: process.env['NOMBRE_RESTAURANTE'] ?? 'Mi Restaurante',
  })
})

// Todo lo que toca datos exige sesion. El cliente guarda el token y sigue
// contando sin red aunque el servidor no lo pueda validar en ese momento:
// perder la sesion nunca puede bloquear un conteo ya empezado.
app.use('/api/maestro', requiereSesion, maestroRouter)
app.use('/api/sync', requiereSesion, syncRouter)
app.use('/api/sync', requiereSesion, pushRouter)

// El ABM es una pagina estatica servida por el mismo proceso: se toca desde
// una computadora, no desde el celular, y no necesita funcionar offline.
app.use('/', express.static(resolve(__dirname, '../public')))

app.listen(PORT, async () => {
  console.log(`API   http://localhost:${PORT}/api`)
  console.log(`ABM   http://localhost:${PORT}/`)

  // Sin usuarios no se puede entrar a ningun lado. Se avisa al arrancar en
  // vez de dejar que alguien descubra el problema desde el celular, parado
  // en el deposito.
  const usuarios = await prisma.usuario.count({ where: { activo: true } })
  if (usuarios === 0) {
    console.log('')
    console.log('  No hay usuarios cargados: la API va a rechazar todo con 401.')
    console.log('  Crea el primero con:')
    console.log('    npm run usuario -w @resto/server -- encargado 1234')
    console.log('')
  }
})
