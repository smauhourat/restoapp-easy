import { db } from '../db/dexie.js'

/**
 * Sesion del dispositivo.
 *
 * El token se guarda en IndexedDB junto al resto de los datos, no en
 * localStorage, para que todo el estado del dispositivo viva en un solo
 * lugar y se borre junto.
 */

const TOKEN = 'authToken'
const USUARIO = 'authUsuario'

export class SesionExpirada extends Error {
  constructor() { super('sesion expirada') }
}

export async function leerToken(): Promise<string | null> {
  return (await db.meta.get(TOKEN))?.valor ?? null
}

export async function leerUsuario(): Promise<string | null> {
  return (await db.meta.get(USUARIO))?.valor ?? null
}

export async function guardarSesion(token: string, usuario: string): Promise<void> {
  await db.meta.bulkPut([
    { clave: TOKEN, valor: token },
    { clave: USUARIO, valor: usuario },
  ])
}

/**
 * Cierra la sesion.
 *
 * Borra el token y nada mas: los conteos, los pedidos y la cola de subida se
 * quedan donde estan. Perder la sesion no puede costar trabajo ya hecho, y
 * al volver a entrar la cola se sube sola.
 */
export async function cerrarSesion(): Promise<void> {
  await db.meta.bulkDelete([TOKEN, USUARIO])
}

export async function login(usuario: string, pin: string): Promise<
  { ok: true } | { ok: false; motivo: 'credenciales' | 'red' }
> {
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario, pin }),
    })
    if (r.status === 401 || r.status === 400) return { ok: false, motivo: 'credenciales' }
    if (!r.ok) return { ok: false, motivo: 'red' }

    const datos = (await r.json()) as { token: string; usuario: { nombre: string } }
    await guardarSesion(datos.token, datos.usuario.nombre)
    return { ok: true }
  } catch {
    // Sin conexion no se puede entrar por primera vez, pero un dispositivo
    // que ya entro alguna vez sigue funcionando con su token guardado.
    return { ok: false, motivo: 'red' }
  }
}

/**
 * fetch con el token de sesion.
 *
 * Distingue tres situaciones que la interfaz tiene que tratar distinto:
 *   - respuesta normal
 *   - SesionExpirada (401): hay que volver a entrar, pero el conteo local
 *     sigue intacto y la cola espera
 *   - error de red: no pasa nada, se reintenta despues
 */
export async function fetchConSesion(
  url: string, opts: RequestInit = {},
): Promise<Response> {
  const token = await leerToken()
  const headers = new Headers(opts.headers)
  if (token !== null) headers.set('Authorization', `Bearer ${token}`)

  const r = await fetch(url, { ...opts, headers })
  if (r.status === 401) {
    await cerrarSesion()
    throw new SesionExpirada()
  }
  return r
}
