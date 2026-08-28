import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

/**
 * Prisma devuelve Decimal como objeto y BigInt como bigint; ninguno de los
 * dos sobrevive a JSON.stringify. Estos helpers los normalizan en el borde
 * de la API, que es el unico lugar donde importa.
 */
export function decToNum(d: unknown): number | null {
  if (d === null || d === undefined) return null
  return Number(d.toString())
}

export function seqToStr(s: bigint): string {
  return s.toString()
}
