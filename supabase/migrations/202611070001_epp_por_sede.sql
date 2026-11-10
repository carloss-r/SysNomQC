-- EPP por sede y solicitudes de compra.
-- Ejecutar DESPUÉS de 202611060002_epp_historial.sql. Es seguro repetirla.
--
-- * Cada cuenta puede quedar asignada a una sede (authorized_users.site). Sin sede = todas las sedes.
-- * El catálogo (epp_articles) es común; la existencia y el mínimo son por sede (epp_stock).
--   La existencia actual pasa completa a Campeche; Lagunas y Cruz Azul empiezan sin registro.
-- * Solicitudes de compra (epp_purchase_requests) que atiende el rol EncargadoCompras.
-- Permisos nuevos: epp.request (pedir material) y epp.purchase (atender compras).

-- ---------------------------------------------------------------------------
-- 1. Sede de cada cuenta
-- ---------------------------------------------------------------------------
alter table public.authorized_users add column if not exists site text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'authorized_users_site_check') then
    alter table public.authorized_users
      add constraint authorized_users_site_check check (site is null or site in ('Campeche', 'Lagunas', 'Cruz Azul'));
  end if;
end;
$$;

-- ¿La cuenta actual puede ver/operar esta sede? (SuperAdmin y cuentas sin sede: todas)
create or replace function public.can_access_site(p_site text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.authorized_users au
    left join public.roles r on r.id_rol = au.role_id
    where au.user_id = auth.uid()
      and au.active = true
      and (au.site is null or au.site = p_site or r.es_sistema = true)
  );
$$;
revoke all on function public.can_access_site(text) from public, anon;
grant execute on function public.can_access_site(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Existencias por sede
-- ---------------------------------------------------------------------------
create table if not exists public.epp_stock (
  article_id bigint not null references public.epp_articles(id),
  site text not null check (site in ('Campeche', 'Lagunas', 'Cruz Azul')),
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 5 check (min_stock >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  primary key (article_id, site)
);

-- La existencia que había (un solo almacén) queda en Campeche.
insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by_name)
select a.id, 'Campeche', a.stock, a.min_stock, a.updated_at, a.updated_by_name
from public.epp_articles a
where a.stock > 0 or a.active
on conflict (article_id, site) do nothing;

comment on column public.epp_articles.stock is 'Obsoleto desde 202611070001: la existencia vive en epp_stock (por sede).';
comment on column public.epp_articles.min_stock is 'Mínimo sugerido al empezar a manejar el artículo en una sede; el real está en epp_stock.';

alter table public.epp_stock enable row level security;
drop policy if exists "epp_stock_select" on public.epp_stock;
create policy "epp_stock_select" on public.epp_stock for select to authenticated
using (public.has_app_permission('epp.view') and public.can_access_site(site));
revoke all on public.epp_stock from anon;
revoke insert, update, delete on public.epp_stock from authenticated;
grant select on public.epp_stock to authenticated;

-- Movimientos: "site" ahora es la sede del inventario. Los anteriores eran del almacén único (Campeche).
update public.epp_movements set site = 'Campeche' where site is null;
create index if not exists epp_movements_site_idx on public.epp_movements (site, moved_on desc);

drop policy if exists "epp_movements_select" on public.epp_movements;
create policy "epp_movements_select" on public.epp_movements for select to authenticated
using (public.has_app_permission('epp.view') and (site is null or public.can_access_site(site)));

-- ---------------------------------------------------------------------------
-- 3. Movimientos por sede (reemplaza a epp_apply, que usaba el almacén único)
-- ---------------------------------------------------------------------------
drop function if exists public.epp_apply(text, jsonb, uuid, date, text);

create or replace function public.epp_apply_site(
  p_site text, p_kind text, p_items jsonb, p_employee uuid default null, p_date date default current_date, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  item jsonb; v_art public.epp_articles; v_row public.epp_stock; v_qty integer; v_delta integer; v_emp public.employees;
  v_actor text := public.epp_actor_name(); v_count integer := 0; v_units integer := 0;
begin
  if p_site is null or p_site not in ('Campeche', 'Lagunas', 'Cruz Azul') then raise exception 'Sede no válida.'; end if;
  if not public.can_access_site(p_site) then
    raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501';
  end if;
  if p_kind not in ('ingreso','entrega','ajuste') then raise exception 'Tipo de movimiento no válido.'; end if;
  if not public.has_app_permission(case when p_kind = 'entrega' then 'epp.deliver' else 'epp.manage' end) then
    raise exception 'Tu rol no tiene permiso para esta operación.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un artículo.'; end if;
  if p_date > current_date + 1 then raise exception 'La fecha no puede ser futura.'; end if;
  if p_kind = 'entrega' then
    select * into v_emp from public.employees where id = p_employee;
    if not found then raise exception 'Selecciona al trabajador que recibe el EPP.'; end if;
  end if;
  if p_kind = 'ajuste' and coalesce(btrim(p_notes), '') = '' then raise exception 'Explica el motivo del ajuste.'; end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty = 0 or (p_kind <> 'ajuste' and v_qty < 0) then raise exception 'Las cantidades deben ser mayores a cero.'; end if;
    v_delta := case when p_kind = 'entrega' then -v_qty else v_qty end;
    select * into v_art from public.epp_articles where id = (item->>'article_id')::bigint;
    if not found then raise exception 'Uno de los artículos ya no existe.'; end if;
    if not v_art.active and p_kind <> 'ajuste' then raise exception 'El artículo % está desactivado.', v_art.name; end if;

    insert into public.epp_stock (article_id, site, stock, min_stock) values (v_art.id, p_site, 0, v_art.min_stock)
    on conflict (article_id, site) do nothing;
    select * into v_row from public.epp_stock where article_id = v_art.id and site = p_site for update;
    if v_row.stock + v_delta < 0 then
      raise exception 'Existencia insuficiente de % en % (hay %, se piden %).', v_art.name, p_site, v_row.stock, abs(v_delta) using errcode = 'P0001';
    end if;

    update public.epp_stock
    set stock = stock + v_delta, updated_at = now(), updated_by = auth.uid(), updated_by_name = v_actor
    where article_id = v_art.id and site = p_site;
    insert into public.epp_movements (article_id, kind, delta, stock_after, employee_id, employee_name, employee_code, employee_position, site, moved_on, notes, created_by, created_by_name)
    values (v_art.id, p_kind, v_delta, v_row.stock + v_delta, v_emp.id, v_emp.full_name, v_emp.employee_code, v_emp.position, p_site, p_date, nullif(btrim(p_notes), ''), auth.uid(), v_actor);
    v_count := v_count + 1; v_units := v_units + abs(v_delta);
  end loop;
  return jsonb_build_object('lines', v_count, 'units', v_units);
end;
$fn$;
revoke all on function public.epp_apply_site(text, text, jsonb, uuid, date, text) from public, anon;
grant execute on function public.epp_apply_site(text, text, jsonb, uuid, date, text) to authenticated;

-- Mínimo de un artículo en una sede (la existencia no cambia).
create or replace function public.epp_set_min_stock(p_site text, p_article bigint, p_min integer)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.has_app_permission('epp.manage') then raise exception 'Tu rol no tiene permiso para esta operación.' using errcode = '42501'; end if;
  if not public.can_access_site(p_site) then raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501'; end if;
  if p_min is null or p_min < 0 then raise exception 'El mínimo debe ser cero o mayor.'; end if;
  insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by, updated_by_name)
  values (p_article, p_site, 0, p_min, now(), auth.uid(), public.epp_actor_name())
  on conflict (article_id, site) do update
    set min_stock = excluded.min_stock, updated_at = now(), updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
end;
$fn$;
revoke all on function public.epp_set_min_stock(text, bigint, integer) from public, anon;
grant execute on function public.epp_set_min_stock(text, bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Solicitudes de compra
-- ---------------------------------------------------------------------------
create table if not exists public.epp_purchase_requests (
  id bigint generated always as identity primary key,
  site text not null check (site in ('Campeche', 'Lagunas', 'Cruz Azul')),
  status text not null default 'pendiente' check (status in ('pendiente', 'en_compra', 'recibida', 'cancelada')),
  notes text,
  requested_by uuid,
  requested_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_by uuid,
  handled_by_name text,
  status_note text
);
create index if not exists epp_purchase_requests_status_idx on public.epp_purchase_requests (status, created_at desc);
create index if not exists epp_purchase_requests_site_idx on public.epp_purchase_requests (site, created_at desc);

create table if not exists public.epp_purchase_request_items (
  request_id bigint not null references public.epp_purchase_requests(id) on delete cascade,
  article_id bigint not null references public.epp_articles(id),
  article_name text not null,
  unit text not null,
  quantity integer not null check (quantity > 0),
  stock_at_request integer not null,
  min_stock integer not null,
  primary key (request_id, article_id)
);

alter table public.epp_purchase_requests enable row level security;
alter table public.epp_purchase_request_items enable row level security;
drop policy if exists "epp_purchase_requests_select" on public.epp_purchase_requests;
create policy "epp_purchase_requests_select" on public.epp_purchase_requests for select to authenticated
using (
  public.has_app_permission('epp.purchase')
  or (public.has_app_permission('epp.view') and public.can_access_site(site))
);
drop policy if exists "epp_purchase_request_items_select" on public.epp_purchase_request_items;
create policy "epp_purchase_request_items_select" on public.epp_purchase_request_items for select to authenticated
using (exists (select 1 from public.epp_purchase_requests r where r.id = request_id));
revoke all on public.epp_purchase_requests, public.epp_purchase_request_items from anon;
revoke insert, update, delete on public.epp_purchase_requests, public.epp_purchase_request_items from authenticated;
grant select on public.epp_purchase_requests, public.epp_purchase_request_items to authenticated;

-- Crea una solicitud. p_items: [{"article_id": 1, "quantity": 20}, ...]
create or replace function public.epp_request_purchase(p_site text, p_items jsonb, p_notes text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  item jsonb; v_art public.epp_articles; v_qty integer; v_id bigint; v_stock integer; v_min integer; v_open bigint;
begin
  if not public.has_app_permission('epp.request') then raise exception 'Tu rol no puede solicitar material.' using errcode = '42501'; end if;
  if p_site is null or p_site not in ('Campeche', 'Lagunas', 'Cruz Azul') then raise exception 'Sede no válida.'; end if;
  if not public.can_access_site(p_site) then raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un artículo.'; end if;
  if jsonb_array_length(p_items) > 80 then raise exception 'Una solicitud admite hasta 80 artículos.'; end if;

  insert into public.epp_purchase_requests (site, notes, requested_by, requested_by_name)
  values (p_site, nullif(btrim(p_notes), ''), auth.uid(), public.epp_actor_name())
  returning id into v_id;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'Las cantidades deben ser mayores a cero.'; end if;
    select * into v_art from public.epp_articles where id = (item->>'article_id')::bigint;
    if not found then raise exception 'Uno de los artículos ya no existe.'; end if;

    select r.id into v_open
    from public.epp_purchase_requests r
    join public.epp_purchase_request_items i on i.request_id = r.id
    where r.site = p_site and r.status in ('pendiente', 'en_compra') and i.article_id = v_art.id and r.id <> v_id
    limit 1;
    if v_open is not null then
      raise exception 'Ya hay una solicitud abierta de % en % (folio %).', v_art.name, p_site, v_open using errcode = 'P0001';
    end if;

    select s.stock, s.min_stock into v_stock, v_min from public.epp_stock s where s.article_id = v_art.id and s.site = p_site;
    insert into public.epp_purchase_request_items (request_id, article_id, article_name, unit, quantity, stock_at_request, min_stock)
    values (v_id, v_art.id, v_art.name, v_art.unit, v_qty, coalesce(v_stock, 0), coalesce(v_min, v_art.min_stock));
  end loop;
  return v_id;
end;
$fn$;
revoke all on function public.epp_request_purchase(text, jsonb, text) from public, anon;
grant execute on function public.epp_request_purchase(text, jsonb, text) to authenticated;

-- Cambia el estado. Compras: en_compra, recibida o cancelada. La sede: cancelar lo pendiente
-- (quien puede pedir) o marcar recibida al registrar el ingreso (quien administra el inventario).
create or replace function public.epp_update_purchase(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.epp_purchase_requests;
  v_buyer boolean := public.has_app_permission('epp.purchase');
  v_ok boolean := false;
begin
  select * into v_req from public.epp_purchase_requests where id = p_id for update;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  if p_status not in ('en_compra', 'recibida', 'cancelada') then raise exception 'Estado no válido.'; end if;
  if v_req.status in ('recibida', 'cancelada') then raise exception 'La solicitud ya está cerrada.' using errcode = 'P0001'; end if;

  if p_status = 'en_compra' then
    v_ok := v_buyer and v_req.status = 'pendiente';
  elsif p_status = 'recibida' then
    v_ok := v_buyer or (public.has_app_permission('epp.manage') and public.can_access_site(v_req.site));
  elsif p_status = 'cancelada' then
    v_ok := v_buyer or (v_req.status = 'pendiente' and public.has_app_permission('epp.request') and public.can_access_site(v_req.site));
  end if;
  if not v_ok then raise exception 'Tu rol no puede hacer este cambio en la solicitud.' using errcode = '42501'; end if;

  update public.epp_purchase_requests
  set status = p_status, status_note = coalesce(nullif(btrim(p_note), ''), status_note), updated_at = now(),
      handled_by = auth.uid(), handled_by_name = public.epp_actor_name()
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$fn$;
revoke all on function public.epp_update_purchase(bigint, text, text) from public, anon;
grant execute on function public.epp_update_purchase(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Roles: quien lleva el inventario de EPP y el encargado de compras
-- ---------------------------------------------------------------------------
update public.roles
set permisos = array(select distinct unnest(coalesce(permisos, '{}') || array['epp.view', 'epp.deliver', 'epp.manage', 'epp.request']))
where nombre = 'Almacenista de EPP';

insert into public.roles (nombre, descripcion, permisos)
values ('Encargado de compras', 'Recibe las solicitudes de compra de EPP de todas las sedes', array['epp.view', 'epp.purchase'])
on conflict (nombre) do nothing;
