-- Contador global de sincronizacion.
--
-- Todas las tablas sincronizables comparten UNA sola secuencia, no una por
-- tabla. Esa es la razon de ser de este archivo: el cliente guarda un unico
-- cursor ("vi hasta el serverSeq N") y con eso pide los cambios de todas las
-- entidades a la vez. Con secuencias por tabla haria falta un cursor por
-- tabla y el pull dejaria de ser atomico.
--
-- Se asigna por trigger BEFORE INSERT OR UPDATE, no con un DEFAULT, porque un
-- default solo dispara en el INSERT. Una fila modificada -- o borrada con
-- soft delete -- tiene que recibir un serverSeq nuevo para volver a viajar al
-- cliente en el proximo pull. Ponerlo desde el codigo de la aplicacion seria
-- equivalente pero se puede olvidar en una ruta nueva; el trigger no.

CREATE SEQUENCE IF NOT EXISTS global_seq AS BIGINT START WITH 1;

CREATE OR REPLACE FUNCTION set_server_seq() RETURNS TRIGGER AS $$
BEGIN
  NEW."serverSeq" := nextval('global_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['Proveedor', 'Producto', 'Conteo', 'ConteoItem', 'Pedido', 'PedidoItem']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_server_seq ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_server_seq BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_server_seq()', t);
  END LOOP;
END $$;

-- Filas preexistentes (ninguna en la instalacion inicial, pero la migracion
-- tiene que ser correcta si se aplica sobre una base con datos).
UPDATE "Proveedor"  SET "serverSeq" = nextval('global_seq') WHERE "serverSeq" = 0;
UPDATE "Producto"   SET "serverSeq" = nextval('global_seq') WHERE "serverSeq" = 0;
UPDATE "Conteo"     SET "serverSeq" = nextval('global_seq') WHERE "serverSeq" = 0;
UPDATE "ConteoItem" SET "serverSeq" = nextval('global_seq') WHERE "serverSeq" = 0;
UPDATE "Pedido"     SET "serverSeq" = nextval('global_seq') WHERE "serverSeq" = 0;
UPDATE "PedidoItem" SET "serverSeq" = nextval('global_seq') WHERE "serverSeq" = 0;
