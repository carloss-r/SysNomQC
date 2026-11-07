-- Controles contra malas prácticas en EPP. Ejecutar DESPUÉS de 202611080001_varios_roles.sql. Es seguro repetirla.
--
-- * Los ajustes de inventario solo los puede hacer un SuperAdmin (rol de sistema).
-- * La fecha de cada movimiento la pone el servidor (hoy, hora de Campeche); no se acepta la del navegador.
-- * Una entrega solo puede ser para un trabajador activo de la misma sede del inventario.

-- ¿La cuenta actual tiene algún rol de sistema (SuperAdmin)?
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.authorized_users au
    join public.roles r
      on r.id_rol = au.role_id
      or r.id_rol in (select ur.role_id from public.authorized_user_roles ur where ur.user_id = au.user_id)
    where au.user_id = auth.uid()
      and au.active = true
      and r.es_sistema = true
  );
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Misma firma que antes (la app no cambia de llamada); p_date se ignora.
create or replace function public.epp_apply_site(
  p_site text, p_kind text, p_items jsonb, p_employee uuid default null, p_date date default current_date, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  item jsonb; v_art public.epp_articles; v_row public.epp_stock; v_qty integer; v_delta integer; v_emp public.employees;
  v_actor text := public.epp_actor_name(); v_count integer := 0; v_units integer := 0;
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
    raise exception 'Solo un SuperAdmin puede ajustar el inventario.' using errcode = '42501';
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
