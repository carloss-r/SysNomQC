-- Inventario propio por sede: cada artículo pertenece a UNA sede.
-- Ejecutar DESPUÉS de 202611130008_epp_catalogo_inicial.sql (y de 202611130009 si ya la corriste). Es seguro repetirla.
--
-- Antes el catálogo era común: desactivar, renombrar o cambiar la categoría de un artículo en una sede lo
-- cambiaba en las tres. Ahora Campeche, Lagunas y Cruz Azul tienen cada una sus propios artículos
-- (nombre, talla, categoría, unidad, estatus, mínimo y existencia) y nada se comparte ni se combina.
--
-- Conversión de lo que ya existe: cada artículo se copia a cada sede donde se usa (existencia, movimientos,
-- solicitudes y compras pasan a la copia de su sede). Todos quedan ACTIVOS: si desactivaste algo como
-- prueba (p. ej. botas en Lagunas), vuelve a desactivarlo; ahora solo afectará a esa sede.

begin;

alter table public.epp_articles add column if not exists site text;

-- La unicidad pasa a ser por sede: la misma "CAMISOLA · M" puede existir en las tres.
drop index if exists public.epp_articles_name_key;
drop index if exists public.epp_articles_name_size_key;
create unique index if not exists epp_articles_site_name_size_key
  on public.epp_articles (site, upper(btrim(name)), upper(coalesce(btrim(size), '')));

-- ---------------------------------------------------------------------------
-- 1. Separar los artículos existentes por sede
-- ---------------------------------------------------------------------------
do $$
declare
  a public.epp_articles; v_sites text[]; v_first text; s text; v_new bigint;
begin
  for a in select * from public.epp_articles where site is null order by id loop
    select array_agg(distinct x.site order by x.site) into v_sites
    from (
      select st.site from public.epp_stock st where st.article_id = a.id
      union select m.site from public.epp_movements m where m.article_id = a.id and m.site is not null
      union select r.site from public.epp_purchase_request_items i
        join public.epp_purchase_requests r on r.id = i.request_id where i.article_id = a.id
    ) x;
    if v_sites is null then v_sites := array['Campeche']; end if;
    v_first := case when 'Campeche' = any (v_sites) then 'Campeche' else v_sites[1] end;

    update public.epp_articles set site = v_first, active = true where id = a.id;

    foreach s in array v_sites loop
      continue when s = v_first;
      insert into public.epp_articles (name, category, size, unit, min_stock, active, site, updated_by_name)
      values (a.name, a.category, a.size, a.unit, a.min_stock, true, s, a.updated_by_name)
      returning id into v_new;
      update public.epp_stock set article_id = v_new where article_id = a.id and site = s;
      update public.epp_movements set article_id = v_new where article_id = a.id and site = s;
      update public.epp_purchase_request_items i set article_id = v_new
        from public.epp_purchase_requests r where r.id = i.request_id and i.article_id = a.id and r.site = s;
      update public.epp_purchase_buys b set article_id = v_new
        from public.epp_purchase_requests r where r.id = b.request_id and b.article_id = a.id and r.site = s;
    end loop;
  end loop;
end;
$$;

alter table public.epp_articles alter column site set not null;
alter table public.epp_articles drop constraint if exists epp_articles_site_check;
alter table public.epp_articles add constraint epp_articles_site_check check (site in ('Campeche', 'Lagunas', 'Cruz Azul'));
create index if not exists epp_articles_site_idx on public.epp_articles (site, category, name);
comment on column public.epp_articles.site is 'Sede dueña del artículo: cada sede tiene su propio catálogo e inventario.';

-- ---------------------------------------------------------------------------
-- 2. La base impide mezclar sedes: existencia, movimientos y solicitudes solo con artículos de su sede
-- ---------------------------------------------------------------------------
create or replace function public.epp_same_site_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_article_site text; v_target text; v_name text;
begin
  if tg_table_name = 'epp_purchase_request_items' then
    select site into v_target from public.epp_purchase_requests where id = new.request_id;
  else
    v_target := new.site;
  end if;
  if v_target is null then return new; end if;
  select site, name into v_article_site, v_name from public.epp_articles where id = new.article_id;
  if v_article_site is distinct from v_target then
    raise exception '% pertenece al inventario de %, no al de %.', coalesce(v_name, 'El artículo'), coalesce(v_article_site, 'otra sede'), v_target
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists epp_stock_same_site on public.epp_stock;
create trigger epp_stock_same_site before insert or update on public.epp_stock
for each row execute function public.epp_same_site_guard();
drop trigger if exists epp_movements_same_site on public.epp_movements;
create trigger epp_movements_same_site before insert or update on public.epp_movements
for each row execute function public.epp_same_site_guard();
drop trigger if exists epp_request_items_same_site on public.epp_purchase_request_items;
create trigger epp_request_items_same_site before insert or update on public.epp_purchase_request_items
for each row execute function public.epp_same_site_guard();

-- Un artículo no cambia de sede.
create or replace function public.epp_articles_site_lock()
returns trigger language plpgsql as $$
begin
  if new.site is distinct from old.site then
    raise exception 'Un artículo no se puede mover a otra sede; créalo en la sede que lo necesita.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists epp_articles_site_lock on public.epp_articles;
create trigger epp_articles_site_lock before update on public.epp_articles
for each row execute function public.epp_articles_site_lock();

-- ---------------------------------------------------------------------------
-- 3. Cada cuenta solo ve y edita los artículos de su sede
-- ---------------------------------------------------------------------------
drop policy if exists "epp_articles_select" on public.epp_articles;
drop policy if exists "epp_articles_insert" on public.epp_articles;
drop policy if exists "epp_articles_update" on public.epp_articles;
create policy "epp_articles_select" on public.epp_articles for select to authenticated
using ((public.has_app_permission('epp.view') or public.has_app_permission('epp.purchase')) and public.can_access_site(site));
create policy "epp_articles_insert" on public.epp_articles for insert to authenticated
with check (public.has_app_permission('epp.manage') and public.can_access_site(site));
create policy "epp_articles_update" on public.epp_articles for update to authenticated
using (public.has_app_permission('epp.manage') and public.can_access_site(site))
with check (public.has_app_permission('epp.manage') and public.can_access_site(site));

-- "Agregar/Quitar de la sede" ya no aplica: cada sede crea y desactiva sus propios artículos.
drop function if exists public.epp_remove_from_site(text, bigint);

commit;

-- Verificación (opcional): artículos por sede.
-- select site, count(*) from public.epp_articles group by site order by site;
