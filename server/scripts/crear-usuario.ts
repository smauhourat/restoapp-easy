/**
 * Alta y cambio de PIN de usuarios.
 *
 *   npm run usuario -- encargado 1234
 *   npm run usuario -- --listar
 *
 * No hay pantalla de administracion de usuarios a proposito: en un local con
 * dos o tres personas, un comando que corre el dueno una vez al ano es menos
 * codigo y menos superficie de ataque que un ABM.
 */
import { v7 as uuidv7 } from 'uuid'
import { prisma } from '../src/lib/prisma.js'
import { hashearPin } from '../src/lib/auth.js'

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--listar')) {
    const usuarios = await prisma.usuario.findMany({ orderBy: { nombre: 'asc' } })
    if (usuarios.length === 0) {
      console.log('No hay usuarios. Crea uno con:  npm run usuario -- encargado 1234')
      return
    }
    for (const u of usuarios) {
      console.log(`  ${u.nombre}${u.activo ? '' : '  (inactivo)'}`)
    }
    return
  }

  const [nombre, pin] = args
  if (nombre === undefined || pin === undefined) {
    throw new Error('uso: npm run usuario -- <nombre> <pin>')
  }
  if (pin.length < 4) {
    throw new Error('el PIN tiene que tener al menos 4 digitos')
  }

  const pinHash = await hashearPin(pin)
  const existente = await prisma.usuario.findUnique({ where: { nombre } })

  if (existente === null) {
    await prisma.usuario.create({ data: { id: uuidv7(), nombre, pinHash } })
    console.log(`Usuario "${nombre}" creado.`)
  } else {
    await prisma.usuario.update({
      where: { nombre }, data: { pinHash, activo: true },
    })
    console.log(`PIN de "${nombre}" actualizado.`)
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
