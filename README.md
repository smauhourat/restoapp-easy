# Sistema de pedidos de insumos

PWA de conteo de depósito que funciona sin señal y arma los pedidos separados
por proveedor, listos para enviar por WhatsApp.

El contexto del problema y las decisiones de diseño están en
[`CLAUDE.md`](./CLAUDE.md). Este archivo es solo cómo levantarlo y operarlo.

## Estructura

```
shared/   tipos, esquemas Zod y lógica pura de negocio (cálculo, mensaje)
server/   API + ABM del maestro. Express + Prisma + PostgreSQL
web/      la PWA. Vite + React + Dexie (IndexedDB)
```

## Puesta en marcha

Requiere Node 20+ y PostgreSQL.

```bash
npm install
npm run build:shared
```

**Base de datos.** Hay un `docker-compose.yml` (`npm run db:up`, puerto 5434), o
podés usar un PostgreSQL ya instalado. Configurá la conexión en `server/.env`
partiendo de `server/.env.example`.

> PostgreSQL 11 o anterior necesita `SHADOW_DATABASE_URL` apuntando a una base
> creada a mano: Prisma usa `DROP DATABASE ... WITH (FORCE)` para su shadow
> database y esa sintaxis existe recién desde PG 13.

```bash
npm run db:migrate          # crea las tablas
npm run import:catalogo     # carga catalogo-normalizado.xlsx
npm run usuario -w @resto/server -- encargado 1234
```

Sin al menos un usuario la API rechaza todo con 401 — el servidor lo avisa al
arrancar.

**Levantar:**

```bash
npm run dev:server    # API + ABM en http://localhost:3001
npm run dev:web       # PWA en http://localhost:5173
```

## Operación

### Completar el catálogo

Es la tarea más larga y hay que hacerla a mano. El ABM (`localhost:3001`) abre
filtrado por "solo los que faltan configurar", guarda cada campo al salir de la
celda y con Enter baja a la misma columna de la fila siguiente, para completar
una columna entera de corrido.

Faltan tres datos por producto:

- **unidad** — kg, lt o un
- **stock mínimo** — dispara el cálculo de cuánto pedir
- **orden de recorrido** — el orden físico en que se camina el depósito

Cámara ya está completa (90 productos, numerados de 5 en 5 para poder insertar
sin renumerar). El resto no.

> Vacío y `0` significan cosas distintas y el sistema los trata distinto: un
> mínimo en `0` es un producto que no se pide nunca; vacío es un producto que
> todavía no se configuró. La app permite contar y pedir productos sin mínimo
> escribiendo la cantidad a mano.

### Teléfonos de los proveedores

Los 15 comparten un teléfono de prueba. Hasta que cargues los reales en el ABM,
la app muestra una advertencia en cada pedido. Se acepta pegado con `+`,
espacios o guiones.

### Re-importar el Excel

`npm run import:catalogo` es idempotente y **conservador**: nunca pisa con un
vacío del Excel un dato ya cargado en el ABM. Solo rellena campos en null y da
de alta productos nuevos.

Para que el Excel gane sobre lo cargado a mano: `-- --overwrite`.

### Productos duplicados

19 productos existen en más de un proveedor. El importador los carga todos —así
queda registrado el precio de cada uno— pero deja **uno solo activo**, para que
el conteo no genere pedidos duplicados. Elige el que tenga precio, después el
más barato, y el proveedor alfabético solo para desempatar. Imprime las 19
decisiones al terminar; se cambian desde el ABM con la casilla "Activo".

## Cómo funciona la sincronización

Dos grupos de datos con direcciones opuestas:

- **Maestro** (productos, proveedores): se edita solo en el servidor. El
  celular únicamente lo baja. No hay conflictos posibles.
- **Operación** (conteos, pedidos): se crea en el celular, offline, y sube
  cuando hay red.

Cada escritura local guarda la fila **y** encola la mutación en la misma
transacción de IndexedDB. El servidor descarta mutaciones repetidas por
`mutationId`, así que reintentar es seguro. Los IDs se derivan de la clave
natural (`conteo+producto`), de modo que dos celulares que cuentan lo mismo sin
verse llegan al mismo ID y no se duplican filas.

Ante un conflicto real —dos personas contando el mismo producto— gana la
edición más reciente según el reloj del dispositivo que contó, no el que subió
primero.

La cola nunca se vacía por fallar la red: el contador de pendientes en la
cabecera muestra lo que falta subir.

## Tests

```bash
npm test                                # 54 tests, sin servidor ni base
npm run test:integracion -w @resto/web  # 10 tests contra el catálogo real
```

Los de integración necesitan el servidor levantado y el usuario `encargado` con
PIN `1234` (configurable con `TEST_USUARIO` y `TEST_PIN`).

La capa offline se testea contra IndexedDB de verdad (`fake-indexeddb`), no
contra un mock: si esos tests pasaran contra un doble de prueba no probarían
nada.

## Lo que falta verificar

Nada de esto se ejercitó en un navegador real. **El test que define el
proyecto** —si la app no abre sin señal, se vuelve al papel— hay que hacerlo a
mano:

1. Abrir la app y esperar a que el indicador diga "al día".
2. DevTools → Network → **Offline**.
3. **Recargar la página.** Tiene que abrir igual.
4. Contar productos, cerrar la pestaña, volver a abrirla offline.
5. Volver online: el contador de pendientes tiene que bajar a cero.
