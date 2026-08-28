-- CreateEnum
CREATE TYPE "Sector" AS ENUM ('camara', 'seco', 'bebidas', 'congelado', 'limpieza', 'descartables', 'bodega');

-- CreateEnum
CREATE TYPE "Unidad" AS ENUM ('kg', 'lt', 'un');

-- CreateEnum
CREATE TYPE "EstadoConteo" AS ENUM ('borrador', 'cerrado');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('pendiente', 'enviado', 'recibido');

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefonoWa" TEXT NOT NULL DEFAULT '',
    "telefonoEsPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "diasEntrega" TEXT,
    "horaCorte" TEXT,
    "contacto" TEXT,
    "notas" TEXT,
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "familia" TEXT,
    "unidad" "Unidad",
    "ordenRecorrido" INTEGER,
    "stockMinimo" DECIMAL(10,2),
    "proveedorId" UUID NOT NULL,
    "sector" "Sector" NOT NULL,
    "precioUnitario" DECIMAL(10,2),
    "cantidadBulto" DECIMAL(10,2),
    "precioBulto" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conteo" (
    "id" UUID NOT NULL,
    "fecha" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "estado" "EstadoConteo" NOT NULL DEFAULT 'borrador',
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conteo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConteoItem" (
    "id" UUID NOT NULL,
    "conteoId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "stockActual" DECIMAL(10,2),
    "cantidadPedir" DECIMAL(10,2),
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL,
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ConteoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" UUID NOT NULL,
    "conteoId" UUID NOT NULL,
    "proveedorId" UUID NOT NULL,
    "fecha" TEXT NOT NULL,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'pendiente',
    "mensajeGenerado" TEXT NOT NULL DEFAULT '',
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL,
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoItem" (
    "id" UUID NOT NULL,
    "pedidoId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "cantidad" DECIMAL(10,2) NOT NULL,
    "nombreProducto" TEXT NOT NULL,
    "unidad" "Unidad",
    "precioUnitario" DECIMAL(10,2),
    "serverSeq" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PedidoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedMutation" (
    "mutationId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedMutation_pkey" PRIMARY KEY ("mutationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_nombre_key" ON "Proveedor"("nombre");

-- CreateIndex
CREATE INDEX "Proveedor_serverSeq_idx" ON "Proveedor"("serverSeq");

-- CreateIndex
CREATE INDEX "Producto_sector_ordenRecorrido_idx" ON "Producto"("sector", "ordenRecorrido");

-- CreateIndex
CREATE INDEX "Producto_serverSeq_idx" ON "Producto"("serverSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_proveedorId_nombre_key" ON "Producto"("proveedorId", "nombre");

-- CreateIndex
CREATE INDEX "Conteo_fecha_idx" ON "Conteo"("fecha");

-- CreateIndex
CREATE INDEX "Conteo_serverSeq_idx" ON "Conteo"("serverSeq");

-- CreateIndex
CREATE INDEX "ConteoItem_serverSeq_idx" ON "ConteoItem"("serverSeq");

-- CreateIndex
CREATE UNIQUE INDEX "ConteoItem_conteoId_productoId_key" ON "ConteoItem"("conteoId", "productoId");

-- CreateIndex
CREATE INDEX "Pedido_serverSeq_idx" ON "Pedido"("serverSeq");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_conteoId_proveedorId_key" ON "Pedido"("conteoId", "proveedorId");

-- CreateIndex
CREATE INDEX "PedidoItem_serverSeq_idx" ON "PedidoItem"("serverSeq");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoItem_pedidoId_productoId_key" ON "PedidoItem"("pedidoId", "productoId");

-- CreateIndex
CREATE INDEX "AppliedMutation_appliedAt_idx" ON "AppliedMutation"("appliedAt");

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConteoItem" ADD CONSTRAINT "ConteoItem_conteoId_fkey" FOREIGN KEY ("conteoId") REFERENCES "Conteo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConteoItem" ADD CONSTRAINT "ConteoItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_conteoId_fkey" FOREIGN KEY ("conteoId") REFERENCES "Conteo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
