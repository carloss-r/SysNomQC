-- Carga inicial de existencias de EPP en CAMPECHE (conteo de Archivos/Carga incial.txt, 17/11/2026).
-- Ejecutar DESPUÉS de 202611170001_epp_catalogo_separar_variantes.sql, UNA sola vez
-- (si ya se corrió, se detiene sin cambiar nada).
--
-- * Cada renglón entra como un INGRESO en Campeche (queda en el historial de movimientos) y suma a la existencia.
-- * Nombres oficiales: catálogo de 202611130008_epp_catalogo_inicial.sql, con las variantes separadas en 202611170001.
-- * Artículos que no estaban en el catálogo se dan de alta en Campeche (mínimo 5).
-- * Lo contado en "pares" queda con unidad PARES (misma cifra).
-- * Tapón auditivo con cajita (39) + Tapones (58) = TAPONES AUDITIVOS CON CAJA (97).
-- * NO se cargan aquí los renglones con talla o variante por definir (camisola, overoles, botas, guantes de manga
--   larga, guantes de nitrilo, polainas, cartuchos y tapas para almohadilla): están en
--   Archivos/Pendientes carga inicial.txt para revisarlos y cargarlos después con "Ingreso de material".

begin;

create temporary table epp_carga (
  nombre    text    not null,
  categoria text    not null,
  unidad    text    not null,
  cantidad  integer not null check (cantidad > 0),
  nuevo     boolean not null,   -- true = no existe en el catálogo oficial; se crea
  origen    text    not null    -- cómo venía en el conteo
) on commit drop;

insert into epp_carga (nombre, categoria, unidad, cantidad, nuevo, origen) values
  -- Protección de cabeza
  ('CAPUCHA DE MEZCLILLA',                                             'Protección de cabeza',       'PIEZAS', 14,  false, 'Capuchas Mezclilla 14'),
  ('BARBIQUEJO 4 PUNTOS',                                              'Protección de cabeza',       'PIEZAS', 5,   false, 'Barbiquejos 5'),
  -- Protección visual y facial
  ('GAFAS TRANSPARENTES',                                              'Protección visual y facial', 'PIEZAS', 26,  false, 'Gafas transparentes 26'),
  ('GAFAS OSCURAS',                                                    'Protección visual y facial', 'PIEZAS', 19,  false, 'Gafas oscuras 19'),
  ('GOOGLES',                                                          'Protección visual y facial', 'PIEZAS', 2,   false, 'Goggles 2'),
  ('MICAS PARA CARETA DE SOLDADOR',                                    'Protección visual y facial', 'PIEZAS', 9,   true,  'Micas para caretas de soldador 9'),
  -- Protección auditiva
  ('TAPONES AUDITIVOS CON CAJA',                                       'Protección auditiva',        'PIEZAS', 97,  false, 'Tapón auditivo con cajita 39 + Tapones 58'),
  -- Protección respiratoria
  ('RESPIRADOR PARA POLVOS',                                           'Protección respiratoria',    'PIEZAS', 120, false, 'Respirador N95 120'),
  ('RESPIRADOR CARBÓN ACTIVADO CERRADO',                               'Protección respiratoria',    'PIEZAS', 52,  false, 'Respirador C/A sin válvula 52'),
  ('RESPIRADOR MEDIA CARA',                                            'Protección respiratoria',    'PIEZAS', 1,   false, 'Respirador media cara 1'),
  ('RESPIRADOR CARA COMPLETA',                                         'Protección respiratoria',    'PIEZAS', 3,   false, 'Respirador cara completa 3'),
  ('ALMOHADILLAS (PREFILTROS PARA RESPIRADOR)',                        'Protección respiratoria',    'PARES',  100, true,  'Almohadillas 100 pares'),
  -- Protección de manos
  ('GUANTES OPERADOR CARNAZA',                                         'Protección de manos',        'PARES',  28,  false, 'Guantes carnaza 28 pares'),
  ('GUANTES AICRON',                                                   'Protección de manos',        'PIEZAS', 7,   true,  'Guantes aicron 7'),
  -- Ropa de trabajo
  ('MANDIL DE MEZCLILLA',                                              'Ropa de trabajo',            'PIEZAS', 2,   false, 'Peto Mezclilla 2'),
  ('MANDIL DE CARNAZA (PETO)',                                         'Ropa de trabajo',            'PIEZAS', 5,   false, 'Petos de cuero 5'),
  ('MANGAS DE CARNAZA',                                                'Ropa de trabajo',            'PARES',  8,   false, 'Mangas de cuero 8 pares'),
  ('CUBRE BOTAS',                                                      'Ropa de trabajo',            'PARES',  6,   true,  'Cubre botas 6 pares');

-- ---------------------------------------------------------------------------
-- 0. No repetir la carga
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.epp_movements where source_key like 'carga-inicial-campeche-20261117:%') then
    raise exception 'La carga inicial de Campeche (17/11/2026) ya se aplicó; no se cambió nada.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Los artículos del catálogo oficial deben existir en Campeche (sin talla)
-- ---------------------------------------------------------------------------
do $$
declare v_faltan text;
begin
  select string_agg(c.nombre, ', ' order by c.nombre) into v_faltan
  from epp_carga c
  where not c.nuevo
    and not exists (
      select 1 from public.epp_articles a
      where a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
    );
  if v_faltan is not null then
    raise exception 'No están en el catálogo de Campeche (¿se renombraron?): %', v_faltan;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Alta de los artículos nuevos en Campeche
-- ---------------------------------------------------------------------------
insert into public.epp_articles (name, category, size, unit, min_stock, active, site, updated_by_name)
select c.nombre, c.categoria, null, c.unidad, 5, true, 'Campeche', 'Carga inicial'
from epp_carga c
where c.nuevo
  and not exists (
    select 1 from public.epp_articles a
    where a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
  );

-- ---------------------------------------------------------------------------
-- 3. Unidad PARES en lo que se contó por pares
-- ---------------------------------------------------------------------------
update public.epp_articles a
set unit = c.unidad
from epp_carga c
where a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
  and a.unit is distinct from c.unidad;

-- ---------------------------------------------------------------------------
-- 4. Registro de existencia en Campeche (si faltara)
-- ---------------------------------------------------------------------------
insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by_name)
select a.id, 'Campeche', 0, 5, now(), 'Carga inicial'
from epp_carga c
join public.epp_articles a
  on a.site = 'Campeche' and upper(btrim(a.name)) = upper(c.nombre) and coalesce(btrim(a.size), '') = ''
on conflict (article_id, site) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Sumar la existencia y dejar el ingreso en el historial
-- ---------------------------------------------------------------------------
with carga as (
  select a.id as article_id, a.name, c.cantidad, c.origen
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
       'carga-inicial-campeche-20261117:' || article_id
from actualizado;

-- Debe haber un ingreso por cada renglón de la carga (18).
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.epp_movements where source_key like 'carga-inicial-campeche-20261117:%';
  if v_n <> (select count(*) from epp_carga) then
    raise exception 'Se esperaban % ingresos y se registraron %; no se aplicó nada.', (select count(*) from epp_carga), v_n;
  end if;
end;
$$;

commit;

-- Verificación (opcional): 18 artículos, 504 unidades en total.
-- select a.name, a.unit, s.stock
-- from public.epp_movements m
-- join public.epp_articles a on a.id = m.article_id
-- join public.epp_stock s on s.article_id = a.id and s.site = 'Campeche'
-- where m.source_key like 'carga-inicial-campeche-20261117:%'
-- order by a.category, a.name;
