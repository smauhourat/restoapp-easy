import { useState } from 'react'
import { login } from '../sync/sesion.js'

/**
 * Entrada con usuario y PIN.
 *
 * Aparece solo cuando no hay token guardado o el servidor lo rechazo. Un
 * dispositivo que ya entro alguna vez no vuelve a ver esta pantalla aunque
 * este sin senal: el token vive en el dispositivo y el conteo no necesita
 * al servidor.
 */
export function Login({ onEntrar }: { onEntrar: () => void }) {
  const [usuario, setUsuario] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setEntrando(true)
    setError(null)

    const r = await login(usuario.trim(), pin)
    setEntrando(false)

    if (r.ok) { onEntrar(); return }
    setError(r.motivo === 'credenciales'
      ? 'Usuario o PIN incorrecto.'
      : 'No hay conexión con el servidor. Para entrar por primera vez hace falta red.')
  }

  return (
    <div className="centrado">
      <form className="login" onSubmit={enviar}>
        <h1 className="titulo">Pedidos de insumos</h1>

        <label className="campo">
          <span>Usuario</span>
          <input
            type="text" value={usuario} autoComplete="username"
            autoCapitalize="none" autoCorrect="off"
            onChange={(e) => setUsuario(e.target.value)}
          />
        </label>

        <label className="campo">
          <span>PIN</span>
          <input
            // inputMode numerico: en el celular abre el teclado de numeros.
            type="password" inputMode="numeric" value={pin}
            autoComplete="current-password"
            onChange={(e) => setPin(e.target.value)}
          />
        </label>

        {error !== null && <div className="error">{error}</div>}

        <button
          type="submit" className="boton"
          disabled={entrando || usuario.trim() === '' || pin === ''}
        >
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
