-- REINICIO TOTAL DE EPP + artículos por talla. Ejecutar DESPUÉS de 202611130006_roles_por_area.sql.
--
-- ⚠️ BORRA SIN VUELTA ATRÁS todo lo de EPP en todas las sedes:
--    catálogo de artículos, existencias, entregas, ingresos, ajustes, historial importado,
--    solicitudes de compra, compras registradas y conteos. También vacía las tablas viejas
--    del primer diseño (inventario_epp, asignaciones_epp, categorias_epp).
--    No toca empleados, usuarios, roles, combustibles, facturas ni la bitácora (audit_log).
--    Antes de ejecutarla, ten un respaldo (el dump del 13/11/2026 09:47 ya lo es).
--
-- Después, el catálogo nuevo se carga con 202611130008_epp_catalogo_inicial.sql.
--
-- Tallas: cada talla es un artículo propio (su existencia y su mínimo son independientes), con el
-- mismo nombre y distinta talla: "CAMISOLA" talla M, "CAMISOLA" talla L, "BOTAS DE CASQUILLO" talla 27…
-- Antes el nombre tenía que ser único y por eso la talla se escribía en el nombre.

begin;

-- ---------------------------------------------------------------------------
-- 1. Vaciar EPP (los números de folio y de artículo vuelven a empezar en 1)
-- ---------------------------------------------------------------------------
truncate table
  public.epp_purchase_buys,
  public.epp_purchase_request_items,
  public.epp_purchase_requests,
  public.epp_movements,
  public.epp_stock,
  public.epp_articles
restart identity;

do $$
begin
  -- Tablas del primer diseño (SQLInital.sql). La app no las usa; se vacían para no dejar nada de EPP.
  if to_regclass('public.asignaciones_epp') is not null then truncate table public.asignaciones_epp restart identity; end if;
  if to_regclass('public.inventario_epp') is not null then truncate table public.inventario_epp restart identity cascade; end if;
  if to_regclass('public.categorias_epp') is not null then truncate table public.categorias_epp restart identity cascade; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Un artículo = nombre + talla
-- ---------------------------------------------------------------------------
drop index if exists public.epp_articles_name_key;
create unique index if not exists epp_articles_name_size_key
  on public.epp_articles (upper(btrim(name)), upper(coalesce(btrim(size), '')));

-- Nombre visible con talla ("CAMISOLA · M") para solicitudes, PDF y mensajes.
create or replace function public.epp_article_label(p_name text, p_size text)
returns text language sql immutable as $$
  select btrim(p_name) || coalesce(' · ' || nullif(btrim(p_size), ''), '');
$$;

-- Las solicitudes guardan una copia del nombre: que incluya la talla.
create or replace function public.epp_request_item_label()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_size text;
begin
  select name, size into v_name, v_size from public.epp_articles where id = new.article_id;
  if found then new.article_name := public.epp_article_label(v_name, v_size); end if;
  return new;
end;
$$;
drop trigger if exists epp_request_item_label on public.epp_purchase_request_items;
create trigger epp_request_item_label
before insert on public.epp_purchase_request_items
for each row execute function public.epp_request_item_label();

commit;
