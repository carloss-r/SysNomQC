-- Inventario de EPP ligado a la sede de cada cuenta. Ejecutar DESPUÉS de 202611130008_epp_catalogo_inicial.sql.
-- Es seguro repetirla.
--
-- Cada sede (Campeche, Lagunas, Cruz Azul) tiene su propio inventario: existencias, mínimos, entregas,
-- solicitudes y conteos. Una cuenta con sede asignada solo ve y opera la suya; sin sede ("Todas las sedes")
-- y el Super administrador eligen la sede en pantalla. Esto ya se cumplía en existencias y movimientos;
-- aquí se cierra lo que faltaba en compras:
--   * Las solicitudes de compra y las cantidades compradas solo se ven en la sede de la cuenta (también Compras).
--   * Registrar compra, cancelar y "enterado del faltante" validan la sede.
--   * (Reemplazado por 202611130010: cada sede tiene sus propios artículos y quitar/agregar ya no aplica.)

-- ---------------------------------------------------------------------------
-- 1. Lectura por sede
-- ---------------------------------------------------------------------------
drop policy if exists "epp_purchase_requests_select" on public.epp_purchase_requests;
create policy "epp_purchase_requests_select" on public.epp_purchase_requests for select to authenticated
using (
  (public.has_app_permission('epp.view') or public.has_app_permission('epp.purchase'))
  and public.can_access_site(site)
);

drop policy if exists "epp_purchase_buys_select" on public.epp_purchase_buys;
create policy "epp_purchase_buys_select" on public.epp_purchase_buys for select to authenticated
using (
  public.has_app_permission('epp.purchase')
  and exists (select 1 from public.epp_purchase_requests r where r.id = request_id and public.can_access_site(r.site))
);

-- ---------------------------------------------------------------------------
-- 2. Acciones de compras solo en la sede de la cuenta
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
  if not public.can_access_site(v_req.site) then
    raise exception 'Tu cuenta solo puede atender solicitudes de su sede.' using errcode = '42501';
  end if;
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

create or replace function public.epp_update_purchase(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_req public.epp_purchase_requests;
  v_ok boolean := false;
begin
  select * into v_req from public.epp_purchase_requests where id = p_id for update;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  if not public.can_access_site(v_req.site) then
    raise exception 'Tu cuenta solo puede atender solicitudes de su sede.' using errcode = '42501';
  end if;
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

create or replace function public.epp_ack_shortage(p_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_site text;
begin
  if not public.has_app_permission('epp.purchase') then raise exception 'Solo Compras puede marcar este aviso.' using errcode = '42501'; end if;
  select site into v_site from public.epp_purchase_requests where id = p_id;
  if not found then raise exception 'No se encontró la solicitud.'; end if;
  if not public.can_access_site(v_site) then
    raise exception 'Tu cuenta solo puede atender solicitudes de su sede.' using errcode = '42501';
  end if;
  update public.epp_purchase_requests
  set shortage_ack_at = now(), shortage_ack_by_name = public.epp_actor_name()
  where id = p_id and shortage_ack_at is null;
end;
$fn$;
revoke all on function public.epp_ack_shortage(bigint) from public, anon;
grant execute on function public.epp_ack_shortage(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Una sede deja de manejar un artículo: se quita de SU inventario (sin existencia ni pendientes).
--    Para volver a manejarlo basta con "Agregar a esta sede" (epp_set_min_stock) o registrar un ingreso.
-- ---------------------------------------------------------------------------
create or replace function public.epp_remove_from_site(p_site text, p_article bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_row public.epp_stock;
begin
  if not public.has_app_permission('epp.manage') then raise exception 'Tu rol no tiene permiso para esta operación.' using errcode = '42501'; end if;
  if not public.can_access_site(p_site) then raise exception 'Tu cuenta no tiene acceso al inventario de %.', p_site using errcode = '42501'; end if;
  select * into v_row from public.epp_stock where article_id = p_article and site = p_site for update;
  if not found then return; end if;
  if v_row.stock <> 0 then
    raise exception 'Todavía hay % pieza(s) en %; entrégalas o ajústalas antes de quitar el artículo.', v_row.stock, p_site using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.epp_purchase_requests r join public.epp_purchase_request_items i on i.request_id = r.id
    where r.site = p_site and i.article_id = p_article and r.status in ('pendiente', 'en_compra')
  ) then
    raise exception 'El artículo tiene una solicitud de compra abierta en %.', p_site using errcode = 'P0001';
  end if;
  delete from public.epp_stock where article_id = p_article and site = p_site;
end;
$fn$;
revoke all on function public.epp_remove_from_site(text, bigint) from public, anon;
grant execute on function public.epp_remove_from_site(text, bigint) to authenticated;
