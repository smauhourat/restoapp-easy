# Sistema de pedidos de insumos — contexto del proyecto

Documento de handoff. Resume el análisis del problema, las decisiones de diseño
y el estado del catálogo de datos.

> **El sistema está implementado.** Cómo levantarlo, cómo operarlo y qué falta
> probar está en [`README.md`](./README.md). Este documento conserva el *por
> qué* de cada decisión; el README explica el *cómo*.
>
> Lo que quedó por hacer no es de desarrollo sino de carga de datos: ver la
> sección 11.

Archivos que acompañan a este documento:

- `catalogo-normalizado.xlsx` — catálogo de productos y proveedores, ya migrado
  y parcialmente completado. Es la fuente de datos para el seed inicial.
- `Proveedores-v2.xlsx` — el Excel original del restaurante. Solo como referencia
  histórica; no usarlo como fuente.

---

## 1. Problema

El encargado de un restaurante arma pedidos de insumos a diario:

1. Va al depósito y anota en papel qué falta y cuánto.
2. Vuelve, cruza esa lista contra un Excel con productos por proveedor.
3. Arma un pedido separado por cada proveedor.
4. Lo escribe y lo envía por WhatsApp, uno por uno.

Puntos de dolor:

- **Doble carga de datos**: papel → Excel.
- **Separación manual por proveedor**: propensa a olvidos y errores.
- **Redacción manual de cada mensaje**: repetitiva, formato inconsistente.
- **Sin historial**: no hay registro de consumo ni de precios.

## 2. Idea central

Que la lista que se usa en el depósito sea la misma que genera los pedidos.

## 3. Flujo objetivo

```
Datos maestros → Conteo en depósito → Cálculo automático
                                            ↓
Historial ← Envío WhatsApp ← Mensaje pre-armado ← Agrupar por proveedor
                                            ↓
                                       Recepción
```

1. **Datos maestros**: catálogo de productos con proveedor, unidad, sector del
   depósito, orden de recorrido y stock mínimo.
2. **Conteo**: en el celular, offline, recorriendo el depósito sector por sector.
   Se carga el **stock actual**, no el faltante.
3. **Cálculo**: `cantidad_a_pedir = stock_minimo - stock_actual` (si es > 0).
   Se puede redondear a la unidad de compra del proveedor (`cantidad_bulto`).
4. **Agrupación**: el sistema separa el pedido por proveedor automáticamente.
5. **Mensaje**: se genera el texto con formato fijo por proveedor.
6. **Envío**: link `wa.me` que abre WhatsApp con el mensaje precargado. **El
   envío final lo hace la persona**, no el sistema.
7. **Historial**: cada pedido queda registrado para análisis de consumo y precios.

## 4. Decisiones de diseño (y por qué)

| Decisión | Razón |
|---|---|
| Se carga stock actual, no faltante | Menos carga cognitiva; cualquier empleado puede hacerlo, no solo el encargado |
| Lista ordenada por recorrido físico | Acelera el conteo más que cualquier otra optimización de UX |
| Offline obligatorio | Los depósitos suelen no tener señal; si falla sin internet, se vuelve al papel |
| Envío manual vía `wa.me` | Evita la API paga de WhatsApp Business y sus plantillas aprobadas; deja control humano antes de que salga el pedido |
| Proveedor invisible durante el conteo | El agrupamiento es problema del sistema, no del usuario |
| Producto pertenece a un solo proveedor | 20 productos se repiten entre proveedores; hay que elegir uno por defecto o el pedido se duplica |

---

## 5. Datos reales del restaurante

### 5.1 Escala

- **15 proveedores**, **293 productos**.
- Moneda: **euros**. Los proveedores parecen ser de España / Andorra
  (Andorcarn, IDPA, Molina). Los códigos de país para WhatsApp serían
  **376** (Andorra) o **34** (España).

Proveedores: `IL BOCONCCINO`, `ASG`, `VIDAL`, `MAPSA`, `IDPA`, `ANDORCARN`,
`SUMALISA`, `SIBARYUM`, `RODISNET`, `GARDA`, `DINO`, `HELADOS`, `MOLINA`,
`VINOS`, `CAFÉ Y TÉ`.

### 5.2 Distribución por sector

| Sector | Productos | Estado |
|---|---|---|
| seco | 107 | falta unidad, mínimo y orden |
| camara | 90 | **completo** |
| bebidas | 42 | falta unidad, mínimo y orden |
| limpieza | 22 | falta unidad, mínimo y orden |
| congelado | 15 | falta unidad, mínimo y orden |
| descartables | 14 | falta unidad, mínimo y orden |
| bodega | 3 | falta unidad, mínimo y orden |

Son las 293 filas del Excel. Tras el import quedan **272 activos** (los otros 21
son duplicados desactivados, ver 6.2) y **191 activos sin configurar**. El
tablero del ABM muestra el avance real por sector.

### 5.3 Estructura de `catalogo-normalizado.xlsx`

Hoja `productos` (293 filas):

```
proveedor          texto, coincide con hoja proveedores
familia            texto, opcional (solo IL BOCONCCINO y ASG lo traían)
producto           texto
unidad             kg | lt | un
sector             camara | seco | bebidas | congelado | limpieza | descartables | bodega
orden_recorrido    entero, ordena el conteo dentro del sector
stock_minimo       número
precio_unitario    número, opcional
cantidad_bulto     número, opcional
precio_bulto       número, opcional
activo             SI | NO
```

Hoja `proveedores` (15 filas):

```
proveedor           texto, clave
telefono_whatsapp   solo dígitos, con código de país, sin + ni espacios
dias_entrega        texto libre
hora_corte_pedido   texto libre
contacto            texto libre
notas               texto libre
```

Hoja `leyenda`: instrucciones para el usuario. No importar.

### 5.4 Recorrido de cámara

El orden de conteo de los 90 productos de cámara ya está definido:

```
100  lácteos y natas
200  verduras (MOLINA)
300  mozzarellas y burratas
400  quesos y embutidos
500  pastas frescas
600  carnes (ANDORCARN)
```

Numerado de 5 en 5 dentro de cada grupo para permitir inserciones sin renumerar.

---

## 6. Calidad de datos — problemas conocidos

Resolver antes o durante el seed. Ninguno bloquea el desarrollo, pero todos
degradan el resultado si se ignoran.

> Los conteos de los puntos 1 y 2 se corrigieron contra el archivo real al
> implementar el importador. Los originales (45 y 20) estaban mal.

1. **71 productos sin precio** sobre 293 (67 entre los activos). Concentrados en
   ASG, VIDAL y DINO. No bloquean el pedido; sí bloquean cualquier control de
   costos. — *Sigue pendiente: se cargan en el ABM.*

2. **19 productos aparecen en más de un proveedor.** Ejemplos: `PAPARDELLE`
   (ASG, IL BOCONCCINO, SIBARYUM), `SPIANATA` (ASG, GARDA, SIBARYUM),
   `GRANA PADANO`, `PROVOLONE`, `PIZZA SIN GLUTEN`, `GUANTES`,
   `SERVILLETAS AMARILLAS`. Sin un proveedor por defecto, el conteo genera
   pedidos duplicados. La contracara es la oportunidad: permite comparar precio
   del mismo ítem entre proveedores.

   **Resuelto.** El importador carga las 293 filas —así queda registrado el
   precio de cada proveedor— y deja **una sola activa** por producto. Elige la
   que tenga precio, después la más barata, y el nombre del proveedor solo para
   desempatar; imprime las 19 decisiones al terminar. Se cambia desde el ABM.
   Algunas diferencias son plata real: `PAPARDELLE` a 2,82 en IL BOCONCCINO
   contra 4,90 en SIBARYUM; `PISTACHO` a 11,23 contra 25,80.

3. **Nombres inconsistentes entre hojas.** `MOZZARELLA DI BUFALA`
   (IL BOCONCCINO) vs `MUZZARELLA DI BUFALA` (SIBARYUM) son el mismo producto.
   Hay typos (`CFREMA DUBAI`, `CERVAZA AMSTEL`, `LAMBRUSCO TINTO DIAMNATE`) y
   espacios sobrantes al final de varios nombres.

4. **Teléfonos de prueba.** Los 15 proveedores tienen cargado
   `5491136801621` como placeholder para probar el flujo end-to-end. La columna
   `notas` lo señala. Reemplazar antes de cualquier uso real.

5. **Supuestos sobre pastas rellenas.** Scrigni, tortellini, fiocchi, agnolotti,
   capelaccio y paccheri (ASG, GARDA) se asignaron a `camara` asumiendo que son
   frescas. Si vienen congeladas, mover a `congelado`.

6. **Stock mínimo de cámara es tentativo.** Se estimó por tipo de producto y
   unidad, con la regla "consumo de dos o tres días". Los más probablemente
   incorrectos son los de alta rotación: `MOZZARELLA GIFFONIELLO` (10 kg),
   `CEBOLLA` y `TOMATE REDONDO` (8 kg), `CARNE PICADA` (8 kg), `HUEVO` (60 un).

7. **`camara` y `congelado` pueden ser la misma zona física** en este depósito.
   Confirmar antes de tratarlos como recorridos separados.

---

## 7. Modelo de datos

Este era el borrador. **Está implementado** en `server/prisma/schema.prisma`,
con estas diferencias, todas por la sincronización offline:

- Los `id` son UUID **generados en el cliente**, nunca autoincrement: el
  encargado crea un conteo sin conexión y necesita IDs estables antes de que el
  servidor los vea. Los de `conteo`, `conteo_item`, `pedido` y `pedido_item` se
  **derivan de su clave natural**, para que dos celulares que cuentan lo mismo
  sin verse lleguen al mismo ID en vez de duplicar la fila.
- Toda fila lleva `serverSeq` (cursor del pull incremental, asignado por
  trigger), `updatedAt` y `deletedAt` (baja lógica, para poder propagar los
  borrados al celular).
- `conteo_item` y `pedido` llevan `clientUpdatedAt`: es el criterio de
  desempate del last-write-wins.
- `pedido_item` guarda un **snapshot** de nombre, unidad y precio. Sin eso,
  cambiar un precio en el maestro reescribiría el pasado.
- `pedido` lleva `mensaje_editado`, para no pisar un texto reescrito a mano.
- `proveedor` lleva `telefono_es_placeholder`, para avisar antes de mandar un
  pedido al número de prueba.
- Se agregaron `usuario` (login por PIN) y `applied_mutation` (idempotencia del
  push). Ninguna de las dos viaja al cliente.

```
proveedor
  id, nombre, telefono_wa, dias_entrega, hora_corte, contacto, notas

producto
  id, nombre, familia, unidad, proveedor_id, sector,
  orden_recorrido, stock_minimo, precio_unitario, cantidad_bulto,
  precio_bulto, activo

conteo
  id, fecha, usuario, estado (borrador | cerrado)

conteo_item
  conteo_id, producto_id, stock_actual, cantidad_pedir

pedido
  id, conteo_id, proveedor_id, fecha,
  estado (pendiente | enviado | recibido), mensaje_generado

pedido_item
  pedido_id, producto_id, cantidad, precio_unitario (opcional)
```

Notas:

- `cantidad_pedir` se persiste (no solo se calcula) porque el usuario puede
  ajustarla manualmente antes de enviar.
- `sector` y `orden_recorrido` son las dos columnas que gobiernan la UX del
  conteo. Si están mal, la app se abandona.

## 8. Pantallas

Solo tres pantallas operativas. El resto es configuración que se toca una vez.

> Implementadas las tres, más dos que aparecieron al decidir el alcance: un
> **login** con usuario y PIN, y el **historial** de pedidos por fecha. El ABM
> del maestro es una página aparte servida por el servidor, no forma parte de
> la PWA: se toca desde una computadora y no necesita funcionar offline.

### 8.1 Conteo

- Header con indicador de estado offline.
- Chips de sector (Cámara / Seco / Bebidas / Congelado / Limpieza / Descartables / Bodega).
- Lista de productos del sector, ordenada por `orden_recorrido`. Cada fila:
  nombre, unidad + mínimo + proveedor (secundario), controles `−` / cantidad / `+`.
- Las filas por debajo del mínimo se resaltan y muestran la cantidad sugerida.
- Footer: progreso ("12 de 34 contados") + botón "Ver pedido".

### 8.2 Resumen por proveedor

- Una tarjeta por proveedor con cantidad de ítems y día de entrega.
- Estado por proveedor: sin enviar / enviado.
- Botón "Revisar" por cada uno.

### 8.3 Previsualización del mensaje

- Nombre y teléfono del proveedor.
- Preview del mensaje tal como se va a ver en WhatsApp.
- Botones: "Editar" y "Abrir chat".

## 9. Generación del link de WhatsApp

```
https://wa.me/<telefono_sin_signos>?text=<mensaje_urlencoded>
```

El teléfono va con código de país y sin `+`, espacios ni guiones. El mensaje va
con `encodeURIComponent()`.

Formato del mensaje:

```
Hola! Pedido de <nombre_restaurante>
<fecha> — entrega <dia_entrega>

• <producto> — <cantidad> <unidad>
• ...

Gracias!
```

## 10. Opciones de implementación evaluadas

> **Decidido: PWA a medida.** El resto de la tabla queda como registro del
> razonamiento.

| Opción | Esfuerzo | Costo | Cuándo conviene |
|---|---|---|---|
| Google Sheets + Apps Script | Días | Gratis | Validar la idea rápido; UX pobre en celular, sin offline real |
| AppSheet / Glide sobre Sheets | 1–2 semanas | ~US$5–10 usuario/mes | Un solo local; sin programar; offline resuelto |
| PWA a medida (React + Supabase/Firebase) | Semanas | Infra + desarrollo | Varias sucursales, o si se suma costeo, precios y recepción |

Con 293 productos y 15 proveedores, la escala no exige una solución a medida.
El factor decisivo es si se quiere sumar control de costos y comparación de
precios entre proveedores — algo que los datos ya permiten y que las opciones
sin código soportan mal.

## 11. Decisiones

Resueltas:

- [x] **Camino de implementación**: PWA a medida. React + Dexie (IndexedDB) en
      el cliente, Express + Prisma + **PostgreSQL** en el servidor. Se eligió
      Postgres sobre Mongo porque el modelo es relacional y el valor futuro
      —comparar precios entre proveedores en el tiempo— son JOINs.
- [x] **Alcance**: un local. Maestro, conteo, pedido, WhatsApp e historial.
      Sin costeo ni pantalla de recepción.
- [x] **`proveedor_default` de los duplicados**: lo decide el importador con un
      criterio determinístico y se corrige en el ABM (ver punto 6.2).
- [x] **Precios en cada pedido**: sí, pero sin fricción. `pedido_item` congela
      el precio del maestro al momento de generar el pedido; nadie lo tipea.
      La comparación entre proveedores queda habilitada.
- [x] **Más de un usuario contando**: sí. Login con usuario y PIN, sin roles.
      Un conteo activo, varios dispositivos, con last-write-wins por producto.

Pendientes:

- [ ] Completar unidad, orden de recorrido y mínimo de los **191 productos
      activos** sin configurar. Empezar por `seco` (99) y `bebidas` (42).
      Se hace en el ABM; es la tarea más larga que queda.
- [ ] Cargar los teléfonos reales y los días de entrega de los 15 proveedores.
      Hoy los 15 comparten el número de prueba.
- [ ] Cargar los 67 precios faltantes (punto 6.1).
- [ ] Confirmar los puntos 6.5 (pastas rellenas) y 6.7 (`camara` y `congelado`
      como la misma zona física).
- [ ] Multi-local: fuera de alcance de la v1, pero el modelo le deja lugar.

## 12. Riesgos de adopción

El proyecto fracasa si el encargado vuelve al papel. Los tres motivos más
probables, en orden:

1. La app se cuelga sin señal en el depósito.
2. La lista no sigue el recorrido físico y contar se hace más lento que antes.
3. La carga inicial del catálogo queda incompleta y hay que salir de la app a
   buscar datos.
