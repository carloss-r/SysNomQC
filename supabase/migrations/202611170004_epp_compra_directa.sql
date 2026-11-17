-- EPP: compra directa y fin del "Ingreso de material" manual. Ejecutar DESPUÉS de 202611170003. Es seguro repetirla.
--
-- 1. Compra directa: Compras (o el Super administrador) registra una compra SIN solicitud previa, con la
--    cantidad de la factura. Queda "en compra" (por contar) y los artículos se bloquean en la sede igual que
--    una compra normal. Seguridad la cuenta a ciegas; solo lo contado entra al inventario y, si llega menos,
--    Compras recibe el aviso de faltante.
--    En una compra directa la "cantidad solicitada" queda vacía (null): así quien cuenta no ve ningún número.
--
-- 2. Ingreso de material: ya nadie suma existencias "a mano". El único camino es compra (con solicitud o
--    directa) + conteo ciego. Solo el Super administrador conserva el ingreso en la base (para correcciones);
--    en la pantalla el botón ya no aparece para nadie.

begin;

-- ---------------------------------------------------------------------------
-- 1. Datos
-- ---------------------------------------------------------------------------
alter table public.epp_purchase_requests add column if not exists direct boolean not null default false;
comment on column public.epp_purchase_requests.direct is
  'true = compra directa registrada por Compras sin solicitud previa (no hay cantidad solicitada).';

-- La cantidad solicitada puede quedar vacía en las compras directas (la restricción quantity > 0 sigue para las demás).
alter table public.epp_purchase_request_items alter column quantity drop not null;

-- ---------------------------------------------------------------------------
-- 2. Registrar compra directa. p_items: [{"article_id": 1, "quantity": 10}, ...] (cantidad comprada)
-- ---------------------------------------------------------------------------
create or replace function public.epp_direct_purchase(p_site text, p_items jsonb, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  item jsonb; v_art public.epp_articles; v_qty integer; v_id bigint; v_stock integer; v_min integer; v_open bigint;
  v_actor text := public.epp_actor_name();
begin
  if not (public.has_app_permission('epp.purchase') or public.is_super_admin()) then
    raise exception 'Solo Compras o un Super administrador pueden registrar una compra directa.' using errcode = '42501';
  end if;
  if p_site is null or p_site not in ('Campeche', 'Lagunas', 'Cruz Azul', 'El Carmen') then raise exception 'Sede no válida.'; end if;
  if not public.can_access_site(p_site) then
    raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un artículo.'; end if;
  if jsonb_array_length(p_items) > 80 then raise exception 'Una compra admite hasta 80 artículos.'; end if;

  insert into public.epp_purchase_requests
    (site, status, direct, notes, requested_by, requested_by_name, purchased_at, purchased_by_name, handled_by, handled_by_name)
  values
    (p_site, 'en_compra', true, nullif(btrim(p_note), ''), auth.uid(), v_actor, now(), v_actor, auth.uid(), v_actor)
  returning id into v_id;

  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'Las cantidades compradas deben ser mayores a cero.'; end if;
    select * into v_art from public.epp_articles where id = (item->>'article_id')::bigint;
    if not found then raise exception 'Uno de los artículos ya no existe.'; end if;
    if v_art.site is distinct from p_site then
      raise exception '% pertenece al inventario de %, no al de %.', v_art.name, v_art.site, p_site using errcode = 'P0001';
    end if;
    if not v_art.active then raise exception 'El artículo % está desactivado.', v_art.name using errcode = 'P0001'; end if;
    if exists (select 1 from public.epp_purchase_request_items where request_id = v_id and article_id = v_art.id) then
      raise exception 'El artículo % está repetido; únelo en un solo renglón.', v_art.name using errcode = 'P0001';
    end if;

    select r.id into v_open
    from public.epp_purchase_requests r
    join public.epp_purchase_request_items i on i.request_id = r.id
    where r.site = p_site and r.status in ('pendiente', 'en_compra') and i.article_id = v_art.id and r.id <> v_id
    limit 1;
    if v_open is not null then
      raise exception 'Ya hay una solicitud abierta de % en % (folio %). Regístrala ahí o cancélala.', v_art.name, p_site, v_open
        using errcode = 'P0001';
    end if;

    select s.stock, s.min_stock into v_stock, v_min from public.epp_stock s where s.article_id = v_art.id and s.site = p_site;
    insert into public.epp_purchase_request_items (request_id, article_id, article_name, unit, quantity, stock_at_request, min_stock)
    values (v_id, v_art.id, v_art.name, v_art.unit, null, coalesce(v_stock, 0), coalesce(v_min, v_art.min_stock));

    insert into public.epp_purchase_buys (request_id, article_id, purchased_qty, updated_at, updated_by, updated_by_name)
    values (v_id, v_art.id, v_qty, now(), auth.uid(), v_actor);
  end loop;
  return v_id;
end;
$fn$;
revoke all on function public.epp_direct_purchase(text, jsonb, text) from public, anon;
grant execute on function public.epp_direct_purchase(text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Movimientos: el ingreso manual queda solo para el Super administrador
--    (misma función que 202611130001 + El Carmen; cambia solo la regla del ingreso).
-- ---------------------------------------------------------------------------
create or replace function public.epp_apply_site(
  p_site text, p_kind text, p_items jsonb, p_employee uuid default null, p_date date default current_date, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  item jsonb; v_art public.epp_articles; v_row public.epp_stock; v_qty integer; v_delta integer; v_emp public.employees;
  v_actor text := public.epp_actor_name(); v_count integer := 0; v_units integer := 0; v_lock bigint;
  v_today date := (now() at time zone 'America/Merida')::date;
begin
  if p_site is null or p_site not in ('Campeche', 'Lagunas', 'Cruz Azul', 'El Carmen') then raise exception 'Sede no válida.'; end if;
  if not public.can_access_site(p_site) then
    raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501';
  end if;
  if p_kind not in ('ingreso','entrega','ajuste') then raise exception 'Tipo de movimiento no válido.'; end if;
  if not public.has_app_permission(case when p_kind = 'entrega' then 'epp.deliver' else 'epp.manage' end) then
    raise exception 'Tu rol no tiene permiso para esta operación.' using errcode = '42501';
  end if;
  if p_kind = 'ingreso' and not public.is_super_admin() then
    raise exception 'El material entra al inventario solo con una compra y su conteo. Pide a Compras que la registre.' using errcode = '42501';
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

commit;

notify pgrst, 'reload schema';
