/**
 * Cliente HTTP de los tests de integracion.
 *
 * Entra con el usuario de prueba una sola vez por corrida y agrega el token
 * a cada pedido. Los tests hablan con el servidor real, asi que tienen que
 * autenticarse igual que la app.
 */
export const API = 'http://localhost:3001'

const USUARIO = process.env['TEST_USUARIO'] ?? 'encargado'
const PIN = process.env['TEST_PIN'] ?? '1234'

let token: string | null = null

export async function entrar(): Promise<void> {
  if (token !== null) return
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIO, pin: PIN }),
  }).catch(() => null)

  if (r === null) {
    throw new Error(
      `no hay servidor en ${API}. Levantalo con: npm run dev -w @resto/server`,
    )
  }
  if (!r.ok) {
    throw new Error(
      `no pude entrar como "${USUARIO}" (HTTP ${r.status}). `
      + `Crea el usuario con: npm run usuario -w @resto/server -- ${USUARIO} ${PIN}`,
    )
  }
  token = ((await r.json()) as { token: string }).token
}

/** fetch contra la API con el token de la sesion de prueba. */
export async function api(ruta: string, opts: RequestInit = {}): Promise<Response> {
  await entrar()
  const headers = new Headers(opts.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (opts.body !== undefined) headers.set('content-type', 'application/json')
  return fetch(`${API}${ruta}`, { ...opts, headers })
}
