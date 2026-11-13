-- Nueva sede: El Carmen. Ejecutar DESPUÉS de 202611130011_epp_catalogo_solo_campeche.sql. Es seguro repetirla.
--
-- Las sedes válidas estaban escritas como lista fija ('Campeche', 'Lagunas', 'Cruz Azul') en:
--   * Restricciones CHECK: employees, authorized_users, epp_stock, epp_purchase_requests, epp_articles.
--   * Funciones que validan la sede: epp_apply_site, epp_request_purchase (y cualquier otra con la lista).
-- En lugar de copiar a mano cada función, se toma su definición actual de la base, se agrega 'El Carmen'
-- a la lista y se vuelve a crear (create or replace conserva los permisos). Igual con las restricciones.
--
-- El Carmen empieza sin artículos ni existencias: crea los suyos en EPP → Nuevo artículo.

begin;

-- ---------------------------------------------------------------------------
-- 1. Restricciones CHECK que enumeran las sedes
-- ---------------------------------------------------------------------------
do $$
declare r record; v_def text;
begin
  for r in
    select c.conrelid::regclass as tabla, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%''Cruz Azul''%'
      and pg_get_constraintdef(c.oid) not like '%''El Carmen''%'
  loop
    v_def := replace(r.def, '''Cruz Azul''::text', '''Cruz Azul''::text, ''El Carmen''::text');
    if v_def = r.def then
      raise exception 'No se pudo agregar El Carmen a la restricción % de %: %', r.conname, r.tabla, r.def;
    end if;
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabla, r.conname, v_def);
    raise notice 'Restricción actualizada: %.%', r.tabla, r.conname;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Funciones que validan la sede con la lista fija
-- ---------------------------------------------------------------------------
do $$
declare r record; v_def text;
begin
  for r in
    select p.oid::regprocedure as fn, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc like '%''Cruz Azul''%'
      and p.prosrc not like '%''El Carmen''%'
  loop
    v_def := replace(r.def, '''Lagunas'', ''Cruz Azul'')', '''Lagunas'', ''Cruz Azul'', ''El Carmen'')');
    if v_def = r.def then
      raise exception 'No se pudo agregar El Carmen a la función %; revísala a mano.', r.fn;
    end if;
    execute v_def;
    raise notice 'Función actualizada: %', r.fn;
  end loop;
end;
$$;

commit;

-- Verificación (opcional): nada debe quedar con la lista vieja.
-- select conrelid::regclass, conname from pg_constraint where contype = 'c'
--   and pg_get_constraintdef(oid) like '%Cruz Azul%' and pg_get_constraintdef(oid) not like '%El Carmen%';
-- select oid::regprocedure from pg_proc where prosrc like '%''Cruz Azul''%' and prosrc not like '%El Carmen%';
