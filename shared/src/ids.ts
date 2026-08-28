import { v5 as uuidv5 } from 'uuid'

/**
 * IDs deterministicos para las filas que dos dispositivos pueden crear en
 * paralelo, sin conexion y sin saber uno del otro.
 *
 * El problema que resuelven: si dos celulares cuentan el mismo producto del
 * mismo conteo estando offline, cada uno generaria un UUID al azar. El
 * servidor los unifica -- la clave real es (conteo, producto) -- pero al
 * bajar la fila canonica de vuelta, el celular que perdio se quedaria con
 * DOS filas para el mismo producto: la suya y la del servidor. El conteo
 * mostraria el producto dos veces y el pedido lo pediria doble.
 *
 * Derivando el id de la misma clave natural que usa la base, los dos
 * dispositivos llegan al MISMO id sin haberse hablado nunca. El conflicto
 * desaparece en vez de tener que resolverse.
 *
 * El namespace es un UUID fijo y arbitrario: no es un secreto, solo tiene
 * que no cambiar nunca. Cambiarlo reasignaria el id de todas las filas
 * existentes.
 */
const NAMESPACE = 'a3f1c7e2-9b64-4d18-8e5a-2c7f0b4d9e13'

/** Un conteo por fecha. Es el alcance de la v1: un solo conteo activo. */
export function idConteo(fecha: string): string {
  return uuidv5(`conteo:${fecha}`, NAMESPACE)
}

export function idConteoItem(conteoId: string, productoId: string): string {
  return uuidv5(`conteoItem:${conteoId}:${productoId}`, NAMESPACE)
}

export function idPedido(conteoId: string, proveedorId: string): string {
  return uuidv5(`pedido:${conteoId}:${proveedorId}`, NAMESPACE)
}

export function idPedidoItem(pedidoId: string, productoId: string): string {
  return uuidv5(`pedidoItem:${pedidoId}:${productoId}`, NAMESPACE)
}
