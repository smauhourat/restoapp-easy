/**
 * Borra conteos y pedidos del servidor. Para volver a empezar durante pruebas.
 *
 *   npm run reset -w @resto/server                    -- muestra que borraria
 *   npm run reset -w @resto/server -- --si            -- borra TODOS los conteos
 *   npm run reset -w @resto/server -- --si --fecha 2026-08-28
 *   npm run reset -w @resto/server -- --si --tests    -- solo los de prueba
 *
 * NO toca el maestro: productos, proveedores y usuarios quedan intactos.
 *
 * Sin --si no borra nada. Es una operacion destructiva sobre datos que no se
 * pueden recuperar -- un conteo es media hora de alguien caminando un
 * deposito -- asi que pedir la confirmacion explicita vale mas que el ahorro
 * de tipear cuatro caracteres.
 */
import { prisma } from '../src/lib/prisma.js'

/** Los conteos que dejan los tests de integracion usan fechas del ano 2099. */
const PREFIJO_TESTS = '2099-'

async function main() {
  const args = process.argv.slice(2)
  const confirmado = args.includes('--si')
  const soloTests = args.includes('--tests')
  const iFecha = args.indexOf('--fecha')
  const fecha = iFecha >= 0 ? args[iFecha + 1] : undefined

  if (soloTests && fecha !== undefined) {
    throw new Error('--tests y --fecha son excluyentes')
  }

  const where =
    fecha !== undefined ? { fecha }
      : soloTests ? { fecha: { startsWith: PREFIJO_TESTS } }
        : {}

  const conteos = await prisma.conteo.findMany({
    where,
    include: { _count: { select: { items: true, pedidos: true } } },
    orderBy: { fecha: 'asc' },
  })

  if (conteos.length === 0) {
    console.log('No hay conteos que coincidan.')
    return
  }

  console.log(confirmado ? 'Borrando:' : 'Se borraria:')
  for (const c of conteos) {
    const marca = c.fecha.startsWith(PREFIJO_TESTS) ? '  (de tests)' : ''
    console.log(
      `  ${c.fecha}  ${c.usuario.padEnd(12)} ` +
      `${c._count.items} items, ${c._count.pedidos} pedidos${marca}`,
    )
  }

  if (!confirmado) {
    console.log('')
    console.log('Nada se borro. Agrega --si para confirmar.')
    return
  }

  const ids = conteos.map((c) => c.id)

  // En orden de dependencia, y en una sola transaccion: si algo falla, no
  // queda un pedido sin items ni un item apuntando a un pedido que ya no esta.
  const [items, pedidoItems, pedidos] = await prisma.$transaction(async (tx) => {
    const pedidosDe = await tx.pedido.findMany({
      where: { conteoId: { in: ids } }, select: { id: true },
    })
    const pedidoIds = pedidosDe.map((p) => p.id)

    const pi = await tx.pedidoItem.deleteMany({ where: { pedidoId: { in: pedidoIds } } })
    const p = await tx.pedido.deleteMany({ where: { conteoId: { in: ids } } })
    const ci = await tx.conteoItem.deleteMany({ where: { conteoId: { in: ids } } })
    await tx.conteo.deleteMany({ where: { id: { in: ids } } })

    // Las mutaciones ya aplicadas se limpian tambien: si quedaran, un cliente
    // que reenvia su cola las veria como "ya vistas" y no se reaplicarian.
    await tx.appliedMutation.deleteMany({})

    return [ci.count, pi.count, p.count]
  })

  console.log('')
  console.log(`Borrados: ${conteos.length} conteos, ${items} items contados, `
    + `${pedidos} pedidos, ${pedidoItems} items de pedido.`)
  console.log('El maestro (productos, proveedores, usuarios) quedo intacto.')
  console.log('')
  console.log('Ahora limpia tambien el dispositivo, o el proximo sync los vuelve a subir:')
  console.log('  DevTools > Application > Storage > Clear site data')
}

main()
  .catch((e) => {
    console.error('ERROR:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
