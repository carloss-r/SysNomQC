-- Catálogo inicial de EPP (lista oficial del 13/11/2026). Ejecutar DESPUÉS de 202611130007_epp_reinicio_con_tallas.sql.
-- Ejecútala UNA sola vez y antes de 202611130010_epp_articulos_por_sede.sql (esa reparte este catálogo
-- en un juego de artículos propio para cada sede; después de ella esta carga ya no aplica).
--
-- * 43 productos; los que tienen talla se separan en un artículo por talla (68 artículos en total).
-- * Es el inventario de CAMPECHE: todos empiezan con existencia 0 y mínimo 5 solo en Campeche.
--   Lagunas y Cruz Azul crean sus propios artículos (si ya corriste la versión anterior, la 011 lo corrige).
--   Así aparecen como "Agotado" y se pueden pedir a Compras; la existencia real entra con el conteo
--   de lo que llegue (o con "Ingreso de material").

begin;

with catalogo (categoria, nombre, tallas) as (
  values
  -- Protección de cabeza
  ('Protección de cabeza',       'CASCO NARANJA ALA ANCHA',                                     null::text[]),
  ('Protección de cabeza',       'CAPUCHA DE MEZCLILLA',                                        null),
  ('Protección de cabeza',       'BARBIQUEJO 4 PUNTOS',                                         null),
  ('Protección de cabeza',       'PASAMONTAÑAS',                                                null),
  ('Protección de cabeza',       'SOMBRERO PESCADOR',                                           null),
  ('Protección de cabeza',       'SOMBRILLA PARA CASCO',                                        null),
  -- Protección visual y facial
  ('Protección visual y facial', 'GAFAS TRANSPARENTES',                                         null),
  ('Protección visual y facial', 'GAFAS OSCURAS',                                               null),
  ('Protección visual y facial', 'GOOGLES',                                                     null),
  ('Protección visual y facial', 'CARETA FACIAL (CHAPONEO)',                                    null),
  ('Protección visual y facial', 'MICAS PARA CARETA FACIAL',                                    null),
  ('Protección visual y facial', 'CARETA ELECTRÓNICA',                                          null),
  -- Protección auditiva
  ('Protección auditiva',        'TAPONES AUDITIVOS CON CAJA',                                  null),
  -- Protección respiratoria
  ('Protección respiratoria',    'RESPIRADOR CARBÓN ACTIVADO (CERRADO O CON VÁLVULA)',          null),
  ('Protección respiratoria',    'RESPIRADOR PARA POLVOS',                                      null),
  ('Protección respiratoria',    'RESPIRADOR MEDIA CARA',                                       null),
  ('Protección respiratoria',    'RESPIRADOR CARA COMPLETA',                                    null),
  ('Protección respiratoria',    'RETENEDORES PARA RESPIRADOR (MEDIA CARA Y CARA COMPLETA)',    null),
  ('Protección respiratoria',    'FILTROS DE REPUESTO PARA RESPIRADOR (MEDIA CARA Y CARA COMPLETA)', null),
  ('Protección respiratoria',    'FILTROS REDONDOS P100',                                       null),
  -- Protección de manos
  ('Protección de manos',        'GUANTES OPERADOR PUÑO LARGO',                                 null),
  ('Protección de manos',        'GUANTES OPERADOR CARNAZA',                                    null),
  ('Protección de manos',        'GUANTES DE NITRILO (LIGEROS)',                                null),
  ('Protección de manos',        'GUANTES DE NITRILO (RESIDUOS PELIGROSOS)',                    null),
  ('Protección de manos',        'GUANTES DE SOLDADOR LARGOS',                                  null),
  -- Ropa de trabajo
  ('Ropa de trabajo',            'CAMISOLA DE MEZCLILLA CON REFLEJANTE',                        array['S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL']),
  ('Ropa de trabajo',            'OVEROL NARANJA CON REFLEJANTE',                               array['S', 'M', 'L', 'XL', 'XXL', 'XXXL']),
  ('Ropa de trabajo',            'CHALECO REFLEJANTE DE SEGURIDAD ROJO',                        null),
  ('Ropa de trabajo',            'MANDIL DE CARNAZA (PETO)',                                    null),
  ('Ropa de trabajo',            'MANDIL DE MEZCLILLA',                                         null),
  ('Ropa de trabajo',            'MANGAS DE CARNAZA',                                           null),
  ('Ropa de trabajo',            'POLAINAS VIBORERAS',                                          null),
  ('Ropa de trabajo',            'POLAINAS DE CARNAZA',                                         null),
  ('Ropa de trabajo',            'RODILLERAS',                                                  null),
  -- Calzado
  ('Calzado',                    'BOTAS CON CASQUILLO',                                         array['25', '25.5', '26', '26.5', '27', '27.5', '28', '28.5', '29', '29.5', '30']),
  ('Calzado',                    'BOTAS DIELÉCTRICAS',                                          array['24', '24.5', '25', '25.5', '26']),
  -- Trabajo en altura
  ('Trabajo en altura',          'ARNÉS DE SEGURIDAD',                                          null),
  -- Herramientas y otros
  ('Herramientas y otros',       'LÁMPARA DE CABEZA',                                           null),
  ('Herramientas y otros',       'LÁMPARA DE MANO',                                             null),
  ('Herramientas y otros',       'CINTA DE ACORDONAMIENTO (AMARILLA O ROJA)',                   null),
  ('Herramientas y otros',       'CADENA PLÁSTICA DE SEGURIDAD AMARILLA',                       null),
  ('Herramientas y otros',       'BANDEROLA REFLEJANTE',                                        null),
  ('Herramientas y otros',       'SILBATO DE EMERGENCIA',                                       null)
),
articulos as (
  -- Un renglón por talla; sin tallas, un solo renglón con talla vacía.
  select c.categoria, c.nombre, t.talla
  from catalogo c
  left join lateral unnest(c.tallas) with ordinality as t(talla, orden) on true
)
insert into public.epp_articles (name, category, size, unit, min_stock, active, updated_by_name)
select nombre, categoria, talla, 'PIEZAS', 5, true, 'Carga inicial'
from articulos a
where not exists (
  select 1 from public.epp_articles e
  where upper(btrim(e.name)) = upper(a.nombre) and upper(coalesce(btrim(e.size), '')) = upper(coalesce(a.talla, ''))
);

-- Cada artículo queda registrado solo en Campeche con existencia 0 y mínimo 5.
insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by_name)
select a.id, s.site, 0, 5, now(), 'Carga inicial'
from public.epp_articles a
cross join (values ('Campeche')) as s(site)
on conflict (article_id, site) do nothing;

commit;

-- Verificación (opcional): debe dar 68 artículos y 68 registros de existencia (Campeche).
-- select count(*) from public.epp_articles;
-- select count(*) from public.epp_stock;
