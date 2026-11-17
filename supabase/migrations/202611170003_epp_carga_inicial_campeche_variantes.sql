-- Carga inicial de EPP en CAMPECHE, segunda parte: renglones cuya variante quedó pendiente
-- (Archivos/Pendientes carga inicial.txt, sección 2), ya definidos el 17/11/2026.
-- Ejecutar DESPUÉS de 202611170002_epp_carga_inicial_campeche.sql, UNA sola vez
-- (si ya se corrió, se detiene sin cambiar nada).
--
-- * Cada renglón entra como un INGRESO en Campeche (queda en el historial) y suma a la existencia.
-- * Lo contado en "pares" queda con unidad PARES (misma cifra).
-- * Siguen pendientes (falta talla): Camisola 13, Overoles 7, Botas altas 1, Botas dieléctricas 2.

begin;

create temporary table epp_carga (
  nombre   text    not null,
  unidad   text    not null,
  cantidad integer not null check (cantidad > 0),
  origen   text    not null
) on commit drop;

insert into epp_carga (nombre, unidad, cantidad, origen) values
  ('FILTROS DE REPUESTO PARA RESPIRADOR CARA COMPLETA', 'PARES',  2,   'Cartucho carbón activado 2 pares'),
  ('RETENEDORES PARA RESPIRADOR CARA COMPLETA',         'PARES',  3,   'Tapas para almohadilla 3 pares'),
  ('GUANTES DE NITRILO (LIGEROS)',                      'PARES',  120, 'Guantes nitrilo 120 pares'),
  ('POLAINAS DE CARNAZA',                               'PARES',  4,   'Polainas 4 pares'),
  ('GUANTES OPERADOR PUÑO LARGO',                       'PIEZAS', 16,  'Guantes carnaza manga larga 16');

-- ---------------------------------------------------------------------------
-- 0. No repetir la carga
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.epp_movements where source_key like 'carga-inicial-campeche-20261117b:%') then
    raise exception 'Esta parte de la carga inicial de Campeche ya se aplicó; no se cambió nada.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Todos deben existir en Campeche (sin talla); las variantes vienen de 202611170001
-- ---------------------------------------------------------------------------
do $$
declare v_faltan text;
begin
  select string_agg(c.nombre, ', ' order by c.nombre) into v_faltan
  from epp_carga c
  where not exists (
    select 1 from public.epp_articles a
    where a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
  );
  if v_faltan is not null then
    raise exception 'No están en el catálogo de Campeche (¿se corrió 202611170001?): %', v_faltan;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Unidad PARES en lo que se contó por pares
-- ---------------------------------------------------------------------------
update public.epp_articles a
set unit = c.unidad
from epp_carga c
where a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
  and a.unit is distinct from c.unidad;

-- ---------------------------------------------------------------------------
-- 3. Registro de existencia en Campeche (si faltara)
-- ---------------------------------------------------------------------------
insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by_name)
select a.id, 'Campeche', 0, 5, now(), 'Carga inicial'
from epp_carga c
join public.epp_articles a
  on a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
on conflict (article_id, site) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Sumar la existencia y dejar el ingreso en el historial
-- ---------------------------------------------------------------------------
with carga as (
  select a.id as article_id, c.cantidad, c.origen
  from epp_carga c
  join public.epp_articles a
    on a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
),
actualizado as (
  update public.epp_stock s
  set stock = s.stock + k.cantidad, updated_at = now(), updated_by_name = 'Carga inicial'
  from carga k
  where s.article_id = k.article_id and s.site = 'Campeche'
  returning s.article_id, s.stock as stock_after, k.cantidad, k.origen
)
insert into public.epp_movements
  (article_id, kind, delta, stock_after, site, moved_on, notes, created_by_name, historical, source_key)
select article_id, 'ingreso', cantidad, stock_after, 'Campeche', date '2026-11-17',
       'Carga inicial de inventario (' || origen || ')', 'Carga inicial', false,
       'carga-inicial-campeche-20261117b:' || article_id
from actualizado;

-- Debe haber un ingreso por cada renglón (5).
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.epp_movements where source_key like 'carga-inicial-campeche-20261117b:%';
  if v_n <> (select count(*) from epp_carga) then
    raise exception 'Se esperaban % ingresos y se registraron %; no se aplicó nada.', (select count(*) from epp_carga), v_n;
  end if;
end;
$$;

commit;

-- Verificación (opcional): 5 artículos, 145 unidades.
-- select a.name, a.unit, s.stock
-- from public.epp_movements m
-- join public.epp_articles a on a.id = m.article_id
-- join public.epp_stock s on s.article_id = a.id and s.site = 'Campeche'
-- where m.source_key like 'carga-inicial-campeche-20261117b:%'
-- order by a.name;
