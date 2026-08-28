import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'

const scrypt = promisify(scryptCb) as (
  pass: string, salt: Buffer, len: number,
) => Promise<Buffer>

/**
 * El secreto de firma. En produccion se define por entorno; en desarrollo se
 * genera uno al azar por arranque, lo que invalida los tokens en cada
 * reinicio -- molesto a proposito, para que nadie despliegue sin definirlo.
 */
const SECRETO = process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex')
if (process.env['JWT_SECRET'] === undefined) {
  console.warn('JWT_SECRET no definido: se genera uno al azar (solo desarrollo)')
}

/**
 * Un mes de vigencia.
 *
 * Es mucho para una app web comun, y es deliberado: el token se renueva solo
 * cuando hay conexion, y este dispositivo pasa el dia en un deposito sin
 * senal. Un token corto expiraria en el peor momento posible -- en la mitad
 * de un conteo, sin red para renovarlo -- y dejaria al encargado sin poder
 * subir lo que ya conto.
 */
const VIGENCIA = '30d'

export interface Sesion {
  usuarioId: string
  nombre: string
}

/** Hash del PIN: scrypt con sal por usuario, guardado como salt:hash. */
export async function hashearPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pin, salt, 64)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verificarPin(pin: string, guardado: string): Promise<boolean> {
  const [saltHex, hashHex] = guardado.split(':')
  if (saltHex === undefined || hashHex === undefined) return false
  const hash = await scrypt(pin, Buffer.from(saltHex, 'hex'), 64)
  const esperado = Buffer.from(hashHex, 'hex')
  // Comparacion en tiempo constante: una comparacion normal filtra por
  // cuanto tarda cuantos caracteres del hash coinciden.
  return hash.length === esperado.length && timingSafeEqual(hash, esperado)
}

export function firmarToken(sesion: Sesion): string {
  return jwt.sign(sesion, SECRETO, { expiresIn: VIGENCIA })
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { sesion?: Sesion }
  }
}

/**
 * Exige un token valido.
 *
 * Responde 401 con un cuerpo reconocible para que el cliente distinga "hay
 * que volver a entrar" de "no hay red". Son dos situaciones muy distintas:
 * la primera pide una pantalla de login, la segunda no pide nada porque la
 * app sigue funcionando igual.
 */
export function requiereSesion(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (token === null) {
    return res.status(401).json({ error: 'sin_token' })
  }
  try {
    req.sesion = jwt.verify(token, SECRETO) as Sesion
    next()
  } catch {
    res.status(401).json({ error: 'token_invalido' })
  }
}
