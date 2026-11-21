-- Carga inicial de EPP en CAMPECHE, tercera parte: CAMISOLA por talla
-- (Archivos/Pendientes carga inicial.txt, sección "Falta la talla"), desglose recibido el 21/11/2026.
-- Ejecutar DESPUÉS de 202611170003_epp_carga_inicial_campeche_variantes.sql, UNA sola vez
-- (si ya se corrió, se detiene sin cambiar nada).
--
-- * Cada renglón entra como un INGRESO en Campeche (queda en el historial) y suma a la existencia.
-- * Cada talla es un artículo propio: CAMISOLA DE MEZCLILLA CON REFLEJANTE · L / · M / · S.
-- * Si la talla no existe en el catálogo de Campeche, se da de alta (mínimo 5).
-- * El conteo del 17/11 decía Camisola 13; este desglose suma 7.

begin;

create temporary table epp_carga (
  nombre   text    not null,
  talla    text    not null,
  cantidad integer not null check (cantidad > 0),
  origen   text    not null
) on commit drop;

insert into epp_carga (nombre, talla, cantidad, origen) values
  ('CAMISOLA DE MEZCLILLA CON REFLEJANTE', 'L', 3, 'Camisola talla L 3'),
  ('CAMISOLA DE MEZCLILLA CON REFLEJANTE', 'M', 3, 'Camisola talla M 3'),
  ('CAMISOLA DE MEZCLILLA CON REFLEJANTE', 'S', 1, 'Camisola talla S 1');

-- ---------------------------------------------------------------------------
-- 0. No repetir la carga
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.epp_movements where source_key like 'carga-inicial-campeche-20261121-camisolas:%') then
    raise exception 'La carga de camisolas de Campeche ya se aplicó; no se cambió nada.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Alta de la talla en Campeche (si faltara)
-- ---------------------------------------------------------------------------
insert into public.epp_articles (name, category, size, unit, min_stock, active, site, updated_by_name)
select c.nombre, 'Ropa de trabajo', c.talla, 'PIEZAS', 5, true, 'Campeche', 'Carga inicial'
from epp_carga c
where not exists (
  select 1 from public.epp_articles a
  where a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre)
    and upper(coalesce(btrim(a.size), '')) = upper(c.talla)
);

-- ---------------------------------------------------------------------------
-- 2. Registro de existencia en Campeche (si faltara)
-- ---------------------------------------------------------------------------
insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by_name)
select a.id, 'Campeche', 0, 5, now(), 'Carga inicial'
from epp_carga c
join public.epp_articles a
  on a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre)
 and upper(coalesce(btrim(a.size), '')) = upper(c.talla)
on conflict (article_id, site) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Sumar la existencia y dejar el ingreso en el historial
-- ---------------------------------------------------------------------------
with carga as (
  select a.id as article_id, c.cantidad, c.origen
  from epp_carga c
  join public.epp_articles a
    on a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre)
   and upper(coalesce(btrim(a.size), '')) = upper(c.talla)
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
select article_id, 'ingreso', cantidad, stock_after, 'Campeche', date '2026-11-21',
       'Carga inicial de inventario (' || origen || ')', 'Carga inicial', false,
       'carga-inicial-campeche-20261121-camisolas:' || article_id
from actualizado;

-- Debe haber un ingreso por cada renglón (3).
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.epp_movements where source_key like 'carga-inicial-campeche-20261121-camisolas:%';
  if v_n <> (select count(*) from epp_carga) then
    raise exception 'Se esperaban % ingresos y se registraron %; no se aplicó nada.', (select count(*) from epp_carga), v_n;
  end if;
end;
$$;

commit;

-- Verificación (opcional): 3 tallas, 7 piezas.
-- select a.name, a.size, a.unit, s.stock
-- from public.epp_movements m
-- join public.epp_articles a on a.id = m.article_id
-- join public.epp_stock s on s.article_id = a.id and s.site = 'Campeche'
-- where m.source_key like 'carga-inicial-campeche-20261121-camisolas:%'
-- order by a.size;
