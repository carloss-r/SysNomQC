-- Compras de EPP con conteo ciego. Ejecutar DESPUÉS de 202611120003_facturas_borrado_superadmin.sql. Es seguro repetirla.
--
-- Flujo:
--   1. Seguridad (almacén) pide material                       -> solicitud "pendiente".
--   2. Compras registra la compra con la cantidad comprada      -> "en_compra". Esa cantidad solo la ven
--      quienes tienen epp.purchase (tabla epp_purchase_buys); quien recibe NO la ve.
--   3. Mientras un artículo de la compra no se cuente, en esa sede no se puede entregar, ingresar ni ajustar.
--   4. Seguridad cuenta lo que llegó (sin ver lo comprado). El conteo suma la existencia y libera el artículo.
--      Contados todos los artículos, la solicitud queda "recibida".
--   5. Si se contó menos de lo comprado, Compras recibe un aviso hasta que lo marca como enterado.
--
-- Roles: "Almacenista de EPP" pasa a llamarse "Seguridad" (entrega, pide, administra y cuenta);
-- "Encargado de compras" queda solo con ver EPP y registrar compras.

-- ---------------------------------------------------------------------------
-- 1. Datos del conteo y de la compra
-- ---------------------------------------------------------------------------
alter table public.epp_purchase_request_items add column if not exists received_qty integer;
alter table public.epp_purchase_request_items add column if not exists counted_at timestamptz;
alter table public.epp_purchase_request_items add column if not exists counted_by uuid;
alter table public.epp_purchase_request_items add column if not exists counted_by_name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'epp_purchase_request_items_received_check') then
    alter table public.epp_purchase_request_items
      add constraint epp_purchase_request_items_received_check check (received_qty is null or received_qty >= 0);
  end if;
end;
$$;

alter table public.epp_purchase_requests add column if not exists purchased_at timestamptz;
alter table public.epp_purchase_requests add column if not exists purchased_by_name text;
alter table public.epp_purchase_requests add column if not exists shortage_ack_at timestamptz;
alter table public.epp_purchase_requests add column if not exists shortage_ack_by_name text;

-- Cantidad comprada: tabla aparte para que la política la oculte a quien recibe.
create table if not exists public.epp_purchase_buys (
  request_id bigint not null references public.epp_purchase_requests(id) on delete cascade,
  article_id bigint not null references public.epp_articles(id),
  purchased_qty integer not null check (purchased_qty >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  primary key (request_id, article_id)
);
alter table public.epp_purchase_buys enable row level security;
drop policy if exists "epp_purchase_buys_select" on public.epp_purchase_buys;
create policy "epp_purchase_buys_select" on public.epp_purchase_buys for select to authenticated
using (public.has_app_permission('epp.purchase'));
revoke all on public.epp_purchase_buys from anon;
revoke insert, update, delete on public.epp_purchase_buys from authenticated;
grant select on public.epp_purchase_buys to authenticated;

create index if not exists epp_purchase_request_items_article_idx on public.epp_purchase_request_items (article_id);

-- ¿El artículo tiene en esta sede una compra registrada que aún no se cuenta? Devuelve el folio.
create or replace function public.epp_pending_count(p_site text, p_article bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select r.id
  from public.epp_purchase_requests r
  join public.epp_purchase_request_items i on i.request_id = r.id
  where r.site = p_site and r.status = 'en_compra' and i.article_id = p_article and i.received_qty is null
  order by r.id
  limit 1;
$$;
revoke all on function public.epp_pending_count(text, bigint) from public, anon;
grant execute on function public.epp_pending_count(text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Movimientos: un artículo con conteo pendiente queda bloqueado en esa sede
-- ---------------------------------------------------------------------------
create or replace function public.epp_apply_site(
  p_site text, p_kind text, p_items jsonb, p_employee uuid default null, p_date date default current_date, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  item jsonb; v_art public.epp_articles; v_row public.epp_stock; v_qty integer; v_delta integer; v_emp public.employees;
  v_actor text := public.epp_actor_name(); v_count integer := 0; v_units integer := 0; v_lock bigint;
  v_today date := (now() at time zone 'America/Merida')::date;
begin
  if p_site is null or p_site not in ('Campeche', 'Lagunas', 'Cruz Azul') then raise exception 'Sede no válida.'; end if;
  if not public.can_access_site(p_site) then
    raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501';
  end if;
  if p_kind not in ('ingreso','entrega','ajuste') then raise exception 'Tipo de movimiento no válido.'; end if;
  if not public.has_app_permission(case when p_kind = 'entrega' then 'epp.deliver' else 'epp.manage' end) then
    raise exception 'Tu rol no tiene permiso para esta operación.' using errcode = '42501';
  end if;
  if p_kind = 'ajuste' and not public.is_super_admin() then
    raise exception 'Solo un Super administrador puede ajustar el inventario.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un artículo.'; end if;
  if p_kind = 'entrega' then
    select * into v_emp from public.employees where id = p_employee;
    if not found then raise exception 'Selecciona al trabajador que recibe el EPP.'; end if;
    if not coalesce(v_emp.active, false) then raise exception 'El trabajador % no está activo.', v_emp.full_name; end if;
    if v_emp.site is distinct from p_site then
      raise exception '% pertenece a %; solo se le puede entregar EPP del inventario de su sede.', v_emp.full_name, coalesce(v_emp.site, 'otra sede')
        using errcode = 'P0001';
    end if;
  end if;
  if p_kind = 'ajuste' and coalesce(btrim(p_notes), '') = '' then raise exception 'Explica el motivo del ajuste.'; end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty = 0 or (p_kind <> 'ajuste' and v_qty < 0) then raise exception 'Las cantidades deben ser mayores a cero.'; end if;
    v_delta := case when p_kind = 'entrega' then -v_qty else v_qty end;
    select * into v_art from public.epp_articles where id = (item->>'article_id')::bigint;
    if not found then raise exception 'Uno de los artículos ya no existe.'; end if;
    if not v_art.active and p_kind <> 'ajuste' then raise exception 'El artículo % está desactivado.', v_art.name; end if;

    v_lock := public.epp_pending_count(p_site, v_art.id);
    if v_lock is not null then
      raise exception '% tiene pendiente el conteo de la compra folio % en %. Haz el conteo antes de moverlo.', v_art.name, v_lock, p_site
        using errcode = 'P0001';
    end if;

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
    values (v_art.id, p_kind, v_delta, v_row.stock + v_delta, v_emp.id, v_emp.full_name, v_emp.employee_code, v_emp.position, p_site, v_today, nullif(btrim(p_notes), ''), auth.uid(), v_actor);
    v_count := v_count + 1; v_units := v_units + abs(v_delta);
  end loop;
  return jsonb_build_object('lines', v_count, 'units', v_units, 'date', v_today);
end;
$fn$;
revoke all on function public.epp_apply_site(text, text, jsonb, uuid, date, text) from public, anon;
grant execute on function public.epp_apply_site(text, text, jsonb, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Compras registra lo que compró. p_items: [{"article_id": 1, "quantity": 10}, ...] (todos los artículos)
-- ---------------------------------------------------------------------------
create or replace function public.epp_register_purchase(p_id bigint, p_items jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.epp_purchase_requests; item jsonb; v_qty integer; v_total integer := 0; v_lines integer; v_given integer := 0;
  v_actor text := public.epp_actor_name();
begin
  if not public.has_app_permission('epp.purchase') then
    raise exception 'Solo Compras puede registrar la compra.' using errcode = '42501';
  end if;
  select * into v_req from public.epp_purchase_requests where id = p_id for update;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  if v_req.status not in ('pendiente', 'en_compra') then raise exception 'La solicitud ya está cerrada.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.epp_purchase_request_items where request_id = p_id and received_qty is not null) then
    raise exception 'Ya se empezó a contar lo que llegó; la compra no se puede cambiar.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Captura la cantidad comprada de cada artículo.'; end if;
  select count(*) into v_lines from public.epp_purchase_request_items where request_id = p_id;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty < 0 or v_qty > 100000 then raise exception 'Las cantidades compradas deben ser cero o mayores.'; end if;
    if not exists (select 1 from public.epp_purchase_request_items where request_id = p_id and article_id = (item->>'article_id')::bigint) then
      raise exception 'Uno de los artículos no pertenece a la solicitud.';
    end if;
    insert into public.epp_purchase_buys (request_id, article_id, purchased_qty, updated_at, updated_by, updated_by_name)
    values (p_id, (item->>'article_id')::bigint, v_qty, now(), auth.uid(), v_actor)
    on conflict (request_id, article_id) do update
      set purchased_qty = excluded.purchased_qty, updated_at = now(), updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
    v_total := v_total + v_qty; v_given := v_given + 1;
  end loop;
  if v_given <> v_lines or (select count(*) from public.epp_purchase_buys where request_id = p_id) <> v_lines then
    raise exception 'Captura la cantidad comprada de todos los artículos de la solicitud.' using errcode = 'P0001';
  end if;
  if v_total = 0 then raise exception 'Si no se compró nada, cancela la solicitud.' using errcode = 'P0001'; end if;

  update public.epp_purchase_requests
  set status = 'en_compra', purchased_at = now(), purchased_by_name = v_actor, updated_at = now(),
      handled_by = auth.uid(), handled_by_name = v_actor, status_note = coalesce(nullif(btrim(p_note), ''), status_note)
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'en_compra');
end;
$fn$;
revoke all on function public.epp_register_purchase(bigint, jsonb, text) from public, anon;
grant execute on function public.epp_register_purchase(bigint, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Conteo ciego de lo que llegó. p_items: [{"article_id": 1, "quantity": 9}, ...] (uno o varios artículos)
--    No devuelve ni compara contra lo comprado: quien cuenta no se entera de la cantidad esperada.
-- ---------------------------------------------------------------------------
create or replace function public.epp_count_purchase(p_id bigint, p_items jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.epp_purchase_requests; v_item public.epp_purchase_request_items; v_row public.epp_stock; v_art public.epp_articles;
  item jsonb; v_qty integer; v_count integer := 0; v_units integer := 0; v_left integer;
  v_actor text := public.epp_actor_name(); v_today date := (now() at time zone 'America/Merida')::date;
begin
  if not public.has_app_permission('epp.manage') then
    raise exception 'Solo quien recibe en almacén (Seguridad) puede hacer el conteo.' using errcode = '42501';
  end if;
  select * into v_req from public.epp_purchase_requests where id = p_id for update;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  if not public.can_access_site(v_req.site) then
    raise exception 'Tu cuenta no tiene acceso al inventario de %.', v_req.site using errcode = '42501';
  end if;
  if v_req.status <> 'en_compra' then
    raise exception 'Solo se cuenta una compra ya registrada por Compras y aún abierta.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Captura el conteo de al menos un artículo.'; end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty < 0 or v_qty > 100000 then raise exception 'El conteo debe ser cero o mayor.'; end if;
    select * into v_item from public.epp_purchase_request_items
    where request_id = p_id and article_id = (item->>'article_id')::bigint for update;
    if not found then raise exception 'Uno de los artículos no pertenece a la solicitud.'; end if;
    if v_item.received_qty is not null then
      raise exception 'El conteo de % ya se registró y no se puede cambiar.', v_item.article_name using errcode = 'P0001';
    end if;

    update public.epp_purchase_request_items
    set received_qty = v_qty, counted_at = now(), counted_by = auth.uid(), counted_by_name = v_actor
    where request_id = p_id and article_id = v_item.article_id;

    if v_qty > 0 then
      select * into v_art from public.epp_articles where id = v_item.article_id;
      insert into public.epp_stock (article_id, site, stock, min_stock) values (v_item.article_id, v_req.site, 0, coalesce(v_art.min_stock, 5))
      on conflict (article_id, site) do nothing;
      select * into v_row from public.epp_stock where article_id = v_item.article_id and site = v_req.site for update;
      update public.epp_stock
      set stock = stock + v_qty, updated_at = now(), updated_by = auth.uid(), updated_by_name = v_actor
      where article_id = v_item.article_id and site = v_req.site;
      insert into public.epp_movements (article_id, kind, delta, stock_after, site, moved_on, notes, created_by, created_by_name)
      values (v_item.article_id, 'ingreso', v_qty, v_row.stock + v_qty, v_req.site, v_today,
              left(concat_ws(' · ', 'Conteo de la compra folio ' || p_id, nullif(btrim(p_note), '')), 500), auth.uid(), v_actor);
    end if;
    v_count := v_count + 1; v_units := v_units + v_qty;
  end loop;

  select count(*) into v_left from public.epp_purchase_request_items where request_id = p_id and received_qty is null;
  update public.epp_purchase_requests
  set status = case when v_left = 0 then 'recibida' else status end, updated_at = now(), handled_by = auth.uid(), handled_by_name = v_actor
  where id = p_id;
  return jsonb_build_object('id', p_id, 'counted', v_count, 'units', v_units, 'pending', v_left, 'complete', v_left = 0);
end;
$fn$;
revoke all on function public.epp_count_purchase(bigint, jsonb, text) from public, anon;
grant execute on function public.epp_count_purchase(bigint, jsonb, text) to authenticated;

-- Compras marca como enterado el aviso de "llegó menos de lo comprado".
create or replace function public.epp_ack_shortage(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.has_app_permission('epp.purchase') then raise exception 'Solo Compras puede marcar este aviso.' using errcode = '42501'; end if;
  update public.epp_purchase_requests
  set shortage_ack_at = now(), shortage_ack_by_name = public.epp_actor_name()
  where id = p_id and shortage_ack_at is null;
end;
$fn$;
revoke all on function public.epp_ack_shortage(bigint) from public, anon;
grant execute on function public.epp_ack_shortage(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cambios de estado: solo cancelar. "En compra" sale de registrar la compra y "Recibida" del conteo.
--    Cancelar: lo pendiente lo cancela Compras o quien pide en la sede; una compra ya registrada solo el SuperAdmin.
-- ---------------------------------------------------------------------------
create or replace function public.epp_update_purchase(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.epp_purchase_requests;
  v_ok boolean := false;
begin
  select * into v_req from public.epp_purchase_requests where id = p_id for update;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  if v_req.status in ('recibida', 'cancelada') then raise exception 'La solicitud ya está cerrada.' using errcode = 'P0001'; end if;
  if p_status = 'en_compra' then
    raise exception 'Para pasarla a compra, registra la cantidad comprada.' using errcode = 'P0001';
  elsif p_status = 'recibida' then
    raise exception 'La solicitud se recibe con el conteo de lo que llegó.' using errcode = 'P0001';
  elsif p_status <> 'cancelada' then
    raise exception 'Estado no válido.';
  end if;

  if public.is_super_admin() then
    v_ok := true;
  elsif v_req.status = 'pendiente' then
    v_ok := public.has_app_permission('epp.purchase')
      or (public.has_app_permission('epp.request') and public.can_access_site(v_req.site));
  end if;
  if not v_ok then
    raise exception 'Una compra ya registrada solo la puede cancelar un Super administrador.' using errcode = '42501';
  end if;
  if exists (select 1 from public.epp_purchase_request_items where request_id = p_id and received_qty is not null) then
    raise exception 'Ya se contó parte de lo que llegó; termina el conteo en lugar de cancelar.' using errcode = 'P0001';
  end if;

  update public.epp_purchase_requests
  set status = 'cancelada', status_note = coalesce(nullif(btrim(p_note), ''), status_note), updated_at = now(),
      handled_by = auth.uid(), handled_by_name = public.epp_actor_name()
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'cancelada');
end;
$fn$;
revoke all on function public.epp_update_purchase(bigint, text, text) from public, anon;
grant execute on function public.epp_update_purchase(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Roles
-- ---------------------------------------------------------------------------
do $$
declare
  old_id integer;
  new_id integer;
begin
  select id_rol into old_id from public.roles where nombre = 'Almacenista de EPP';
  select id_rol into new_id from public.roles where nombre = 'Seguridad';
  if old_id is not null and new_id is null then
    update public.roles set nombre = 'Seguridad' where id_rol = old_id;
  elsif old_id is not null and new_id is not null then
    -- Ya existe "Seguridad": se mueven las cuentas y se elimina el nombre anterior.
    update public.authorized_users set role_id = new_id where role_id = old_id;
    insert into public.authorized_user_roles (user_id, role_id)
    select user_id, new_id from public.authorized_user_roles where role_id = old_id
    on conflict do nothing;
    delete from public.authorized_user_roles where role_id = old_id;
    delete from public.roles where id_rol = old_id;
  end if;
end;
$$;

insert into public.roles (nombre, descripcion, permisos)
values ('Seguridad', 'Almacén de EPP: entrega, pide material y cuenta lo que llega de compras', array['epp.view', 'epp.deliver', 'epp.manage', 'epp.request'])
on conflict (nombre) do nothing;
update public.roles
set permisos = array(select distinct unnest(coalesce(permisos, '{}') || array['epp.view', 'epp.deliver', 'epp.manage', 'epp.request'])),
    descripcion = 'Almacén de EPP: entrega, pide material y cuenta lo que llega de compras'
where nombre = 'Seguridad';

-- Compras solo consulta y registra compras: sin entregar, pedir ni mover inventario.
update public.roles
set permisos = array(
      select distinct p from unnest(coalesce(permisos, '{}') || array['epp.view', 'epp.purchase']) as p
      where p not in ('epp.deliver', 'epp.manage', 'epp.request')
    ),
    descripcion = 'Registra lo comprado de las solicitudes de EPP; solo consulta el inventario'
where nombre = 'Encargado de compras';
