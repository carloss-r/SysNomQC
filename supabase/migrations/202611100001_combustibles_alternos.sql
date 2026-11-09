-- Combustibles alternos y sustitución térmica (M1 a M5). Especificación: Archivos/ModuloCoque.txt
-- Ejecutar DESPUÉS de 202611090001_epp_controles.sql. Es seguro repetirla.
--
--   M1 Proveedores y expedientes  fuel_suppliers + fuel_products (análisis químico con candados)
--   M2 Programación logística     fuel_schedule (solo proveedores aprobados y vigentes; bloqueo predictivo del 30 %)
--   M3 Manifiestos y báscula      fuel_receptions (bruto, tara, neto; cierre irreversible)
--   M4 Comercial y contabilidad   esquema y tarifa por producto; subtotal congelado al cerrar el ticket
--   M5 Ecología y sustitución     fuel_coke_consumption (coque mensual) y fuel_month_summary()
--
-- Toda escritura pasa por funciones (security definer) que validan permiso y reglas; las tablas solo se leen.
-- Permisos nuevos: fuels.view, fuels.suppliers, fuels.schedule, fuels.scale, fuels.commercial, fuels.ecology.

-- ---------------------------------------------------------------------------
-- 0. Parámetros de la especificación (un solo lugar en la base)
-- ---------------------------------------------------------------------------
create or replace function public.fuel_today()
returns date language sql stable as $$ select (now() at time zone 'America/Mexico_City')::date $$;

-- Semáforo SEMARNAT: 0 a 25.0 verde, 25.1 a 29.9 amarillo, 30.0 o más rojo.
create or replace function public.fuel_level(p_pct numeric)
returns text language sql immutable as $$
  select case
    when p_pct is null then 'sin_datos'
    when round(p_pct, 1) <= 25.0 then 'verde'
    when round(p_pct, 1) < 30.0 then 'amarillo'
    else 'rojo'
  end
$$;

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.fuel_suppliers (
  id bigint generated always as identity primary key,
  business_name text not null,
  rfc text not null,
  address text,
  contact_name text,
  phone text,
  email text,
  permit_number text,
  permit_valid_until date not null,
  permit_path text,
  status text not null default 'aprobado' check (status in ('aprobado', 'rechazado')),
  status_note text,
  created_at timestamptz not null default now(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists fuel_suppliers_rfc_key on public.fuel_suppliers (upper(rfc));

-- Cada producto lleva su análisis. El CHECK es el candado de calidad de M1: lo que no pasa no se guarda.
create table if not exists public.fuel_products (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.fuel_suppliers(id) on delete cascade,
  name text not null,
  calorific_value numeric(8,1) not null,
  chlorine_pct numeric(5,2) not null,
  water_pct numeric(5,2) not null,
  sulfur_pct numeric(5,2) not null,
  scheme text not null default 'valor_cero' check (scheme in ('cobro', 'pago', 'valor_cero')),
  rate_per_ton numeric(12,2) not null default 0 check (rate_per_ton >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text,
  constraint fuel_products_quality check (
    calorific_value >= 5000 and calorific_value <= 15000
    and chlorine_pct >= 0 and chlorine_pct <= 1.80
    and water_pct >= 0 and water_pct <= 12.0
    and sulfur_pct >= 0 and sulfur_pct <= 1.0
  )
);
create unique index if not exists fuel_products_name_key on public.fuel_products (supplier_id, upper(name));

create table if not exists public.fuel_schedule (
  id bigint generated always as identity primary key,
  scheduled_on date not null,
  supplier_id bigint not null references public.fuel_suppliers(id),
  product_id bigint not null references public.fuel_products(id),
  carrier text not null,
  estimated_tons numeric(10,3) not null check (estimated_tons > 0),
  notes text,
  -- programado → en_planta (entró a báscula) → recibido (cerró tara); o cancelado.
  status text not null default 'programado' check (status in ('programado', 'en_planta', 'recibido', 'cancelado')),
  status_note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create index if not exists fuel_schedule_date_idx on public.fuel_schedule (scheduled_on, status);

-- El id es el número de ticket de báscula.
create table if not exists public.fuel_receptions (
  id bigint generated always as identity primary key,
  manifest_folio text not null,
  schedule_id bigint references public.fuel_schedule(id),
  supplier_id bigint not null references public.fuel_suppliers(id),
  generator_name text not null,
  generator_rfc text not null,
  product_id bigint not null references public.fuel_products(id),
  product_name text not null,
  calorific_value numeric(8,1) not null,
  carrier text not null,
  driver text not null,
  plates text not null,
  vehicle text,
  destination text not null,
  gross_kg numeric(12,1) not null check (gross_kg > 0),
  gross_at timestamptz not null default now(),
  tare_kg numeric(12,1),
  tare_at timestamptz,
  net_kg numeric(12,1),
  received_on date,
  chlorine_pct numeric(5,2) check (chlorine_pct is null or (chlorine_pct >= 0 and chlorine_pct <= 100)),
  compensates_id bigint references public.fuel_receptions(id),
  scheme text,
  rate_per_ton numeric(12,2),
  subtotal numeric(14,2),
  month_pct_after numeric(6,2),
  status text not null default 'en_planta' check (status in ('en_planta', 'cerrado', 'cancelado')),
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  closed_by uuid,
  closed_by_name text,
  constraint fuel_receptions_net check (status <> 'cerrado' or (tare_kg > 0 and net_kg > 0 and net_kg = gross_kg - tare_kg))
);
-- Amarre irreversible: un folio de manifiesto solo puede ligarse a un ticket (salvo tickets cancelados).
create unique index if not exists fuel_receptions_manifest_key on public.fuel_receptions (upper(manifest_folio)) where status <> 'cancelado';
create unique index if not exists fuel_receptions_compensates_key on public.fuel_receptions (compensates_id) where compensates_id is not null;
create index if not exists fuel_receptions_day_idx on public.fuel_receptions (received_on desc);
create index if not exists fuel_receptions_status_idx on public.fuel_receptions (status, created_at desc);

create table if not exists public.fuel_coke_consumption (
  month date primary key check (extract(day from month) = 1),
  coke_tons numeric(12,2) not null check (coke_tons >= 0),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

-- Evita repetir el correo a Ecología: uno por mes y nivel (amarillo / rojo).
create table if not exists public.fuel_alerts_sent (
  month date not null,
  level text not null check (level in ('amarillo', 'rojo')),
  sent_at timestamptz not null default now(),
  primary key (month, level)
);

-- Un ticket cerrado no se modifica. Única excepción: capturar el % de cloro del laboratorio si quedó vacío.
create or replace function public.fuel_receptions_lock()
returns trigger language plpgsql as $fn$
declare v_new public.fuel_receptions;
begin
  if tg_op = 'DELETE' then
    raise exception 'Los tickets de báscula no se pueden eliminar.';
  end if;
  if old.status = 'cerrado' then
    v_new := new;
    if old.chlorine_pct is null then v_new.chlorine_pct := null; end if;
    if v_new is distinct from old then
      raise exception 'El ticket % está cerrado y no se puede modificar.', old.id;
    end if;
  end if;
  if old.status = 'cancelado' then
    raise exception 'El ticket % está cancelado.', old.id;
  end if;
  return new;
end;
$fn$;
drop trigger if exists fuel_receptions_lock on public.fuel_receptions;
create trigger fuel_receptions_lock before update or delete on public.fuel_receptions
for each row execute function public.fuel_receptions_lock();

-- ---------------------------------------------------------------------------
-- 2. Memoria de cálculo (M5)
--    Energía alternos (Gcal) = Σ [neto (t) × poder calorífico (cal/g)] / 1000
--    Energía coque (Gcal)    = [coque (t) × 7500] / 1000
--    % sustitución           = alternos / (alternos + coque) × 100
-- Si el mes aún no tiene consumo de coque capturado, se proyecta con el último mes capturado.
-- p_extra_gcal: energía de una carga que se quiere programar (para el bloqueo predictivo).
-- ---------------------------------------------------------------------------
create or replace function public.fuel_month_summary_raw(p_month date, p_extra_gcal numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_alt_t numeric; v_alt numeric; v_pend_t numeric; v_pend numeric;
  v_coke_t numeric; v_coke_month date; v_est boolean := false; v_coke numeric;
  v_pct numeric; v_proj numeric; v_total numeric;
begin
  select coalesce(sum(net_kg) / 1000, 0), coalesce(sum(net_kg / 1000 * calorific_value) / 1000, 0)
  into v_alt_t, v_alt
  from public.fuel_receptions
  where status = 'cerrado' and received_on >= v_month and received_on < v_next;

  select coalesce(sum(s.estimated_tons), 0), coalesce(sum(s.estimated_tons * p.calorific_value) / 1000, 0)
  into v_pend_t, v_pend
  from public.fuel_schedule s join public.fuel_products p on p.id = s.product_id
  where s.status in ('programado', 'en_planta') and s.scheduled_on >= v_month and s.scheduled_on < v_next;

  select coke_tons, month into v_coke_t, v_coke_month from public.fuel_coke_consumption where month = v_month;
  if v_coke_t is null then
    select coke_tons, month into v_coke_t, v_coke_month from public.fuel_coke_consumption where month < v_month order by month desc limit 1;
    v_est := v_coke_t is not null;
  end if;
  v_coke := v_coke_t * 7500 / 1000;

  if v_coke is not null and v_alt + v_coke > 0 then
    v_pct := v_alt / (v_alt + v_coke) * 100;
  end if;
  v_total := v_alt + v_pend + coalesce(p_extra_gcal, 0);
  if v_coke is not null and v_total + v_coke > 0 then
    v_proj := v_total / (v_total + v_coke) * 100;
  end if;

  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'alt_tons', round(v_alt_t, 3), 'alt_gcal', round(v_alt, 3),
    'pending_tons', round(v_pend_t, 3), 'pending_gcal', round(v_pend, 3),
    'coke_tons', v_coke_t, 'coke_gcal', round(v_coke, 3),
    'coke_estimated', v_est, 'coke_month', to_char(v_coke_month, 'YYYY-MM'),
    'pct', round(v_pct, 2), 'level', public.fuel_level(v_pct),
    'projected_pct', round(v_proj, 2), 'projected_level', public.fuel_level(v_proj)
  );
end;
$fn$;
revoke all on function public.fuel_month_summary_raw(date, numeric) from public, anon, authenticated;

create or replace function public.fuel_month_summary(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.has_app_permission('fuels.view') then
    raise exception 'Tu rol no tiene permiso para esta consulta.' using errcode = '42501';
  end if;
  return public.fuel_month_summary_raw(p_month, 0);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. M1 · Alta y homologación de proveedores (proveedor + productos en una transacción)
-- p_supplier: {business_name, rfc, address, contact_name, phone, email, permit_number, permit_valid_until,
--              permit_path, status, status_note}
-- p_products: [{id?, name, calorific_value, chlorine_pct, water_pct, sulfur_pct}]  (los que no vengan se desactivan)
-- ---------------------------------------------------------------------------
create or replace function public.fuel_save_supplier(p_id bigint, p_supplier jsonb, p_products jsonb)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_actor text := public.epp_actor_name();
  v_id bigint := p_id;
  v_keep bigint[] := '{}';
  item jsonb; v_name text; v_cal numeric; v_cl numeric; v_h2o numeric; v_s numeric; v_pid bigint;
  v_rfc text := upper(btrim(coalesce(p_supplier->>'rfc', '')));
  v_status text := coalesce(p_supplier->>'status', 'aprobado');
begin
  if not public.has_app_permission('fuels.suppliers') then
    raise exception 'Tu rol no tiene permiso para dar de alta proveedores.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_supplier->>'business_name', ''))) < 3 then raise exception 'Escribe la razón social.'; end if;
  if v_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then raise exception 'El RFC % no es válido.', v_rfc; end if;
  if (p_supplier->>'permit_valid_until') is null then raise exception 'Captura la vigencia del permiso SEMARNAT.'; end if;
  if v_status not in ('aprobado', 'rechazado') then raise exception 'Estatus técnico no válido.'; end if;
  if jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0 then
    raise exception 'Agrega al menos un producto con su análisis en Parámetros de calidad.';
  end if;

  -- Candado de calidad con mensaje claro (el CHECK de la tabla lo vuelve a exigir).
  for item in select * from jsonb_array_elements(p_products) loop
    v_name := btrim(coalesce(item->>'name', ''));
    v_cal := (item->>'calorific_value')::numeric; v_cl := (item->>'chlorine_pct')::numeric;
    v_h2o := (item->>'water_pct')::numeric; v_s := (item->>'sulfur_pct')::numeric;
    if length(v_name) < 2 then raise exception 'Escribe el nombre de cada producto.'; end if;
    if v_cal is null or v_cl is null or v_h2o is null or v_s is null then
      raise exception 'Completa el análisis de %.', v_name;
    end if;
    if v_cal < 5000 then raise exception 'No pasa el análisis: % tiene % cal/g (mínimo 5,000).', v_name, v_cal using errcode = 'P0001'; end if;
    if v_cl > 1.80 then raise exception 'No pasa el análisis: % tiene % %% de cloro (máximo 1.80 %%).', v_name, v_cl using errcode = 'P0001'; end if;
    if v_h2o > 12.0 then raise exception 'No pasa el análisis: % tiene % %% de agua (máximo 12.0 %%).', v_name, v_h2o using errcode = 'P0001'; end if;
    if v_s > 1.0 then raise exception 'No pasa el análisis: % tiene % %% de azufre (máximo 1.0 %%).', v_name, v_s using errcode = 'P0001'; end if;
  end loop;

  if v_id is null then
    insert into public.fuel_suppliers (business_name, rfc, address, contact_name, phone, email, permit_number,
      permit_valid_until, permit_path, status, status_note, created_by_name, updated_by, updated_by_name)
    values (btrim(p_supplier->>'business_name'), v_rfc, nullif(btrim(p_supplier->>'address'), ''),
      nullif(btrim(p_supplier->>'contact_name'), ''), nullif(btrim(p_supplier->>'phone'), ''), nullif(btrim(p_supplier->>'email'), ''),
      nullif(btrim(p_supplier->>'permit_number'), ''), (p_supplier->>'permit_valid_until')::date, nullif(p_supplier->>'permit_path', ''),
      v_status, nullif(btrim(p_supplier->>'status_note'), ''), v_actor, auth.uid(), v_actor)
    returning id into v_id;
  else
    update public.fuel_suppliers set
      business_name = btrim(p_supplier->>'business_name'), rfc = v_rfc,
      address = nullif(btrim(p_supplier->>'address'), ''), contact_name = nullif(btrim(p_supplier->>'contact_name'), ''),
      phone = nullif(btrim(p_supplier->>'phone'), ''), email = nullif(btrim(p_supplier->>'email'), ''),
      permit_number = nullif(btrim(p_supplier->>'permit_number'), ''),
      permit_valid_until = (p_supplier->>'permit_valid_until')::date,
      permit_path = coalesce(nullif(p_supplier->>'permit_path', ''), permit_path),
      status = v_status, status_note = nullif(btrim(p_supplier->>'status_note'), ''),
      updated_at = now(), updated_by = auth.uid(), updated_by_name = v_actor
    where id = v_id;
    if not found then raise exception 'El proveedor ya no existe.'; end if;
  end if;

  for item in select * from jsonb_array_elements(p_products) loop
    v_pid := nullif(item->>'id', '')::bigint;
    -- Un producto que se había quitado y se vuelve a capturar con el mismo nombre se reactiva.
    if v_pid is null then
      select id into v_pid from public.fuel_products where supplier_id = v_id and upper(name) = upper(btrim(item->>'name'));
    end if;
    if v_pid is not null then
      update public.fuel_products set
        name = btrim(item->>'name'), calorific_value = (item->>'calorific_value')::numeric,
        chlorine_pct = (item->>'chlorine_pct')::numeric, water_pct = (item->>'water_pct')::numeric,
        sulfur_pct = (item->>'sulfur_pct')::numeric, active = true, updated_at = now(), updated_by_name = v_actor
      where id = v_pid and supplier_id = v_id;
      if not found then raise exception 'Uno de los productos no pertenece a este proveedor.'; end if;
    else
      insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, updated_by_name)
      values (v_id, btrim(item->>'name'), (item->>'calorific_value')::numeric, (item->>'chlorine_pct')::numeric,
        (item->>'water_pct')::numeric, (item->>'sulfur_pct')::numeric, v_actor)
      returning id into v_pid;
    end if;
    v_keep := v_keep || v_pid;
  end loop;
  -- Los productos quitados del formulario se desactivan (se conservan por el historial de báscula).
  update public.fuel_products set active = false, updated_at = now(), updated_by_name = v_actor
  where supplier_id = v_id and not (id = any (v_keep)) and active;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. M4 · Esquema comercial y tarifa por tonelada (sin IVA)
-- ---------------------------------------------------------------------------
create or replace function public.fuel_set_commercial(p_product bigint, p_scheme text, p_rate numeric)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.has_app_permission('fuels.commercial') then
    raise exception 'Tu rol no tiene permiso para cambiar tarifas.' using errcode = '42501';
  end if;
  if p_scheme not in ('cobro', 'pago', 'valor_cero') then raise exception 'Esquema no válido.'; end if;
  if p_rate is null or p_rate < 0 then raise exception 'La tarifa debe ser cero o mayor.'; end if;
  update public.fuel_products
  set scheme = p_scheme, rate_per_ton = case when p_scheme = 'valor_cero' then 0 else round(p_rate, 2) end,
      updated_at = now(), updated_by_name = public.epp_actor_name()
  where id = p_product;
  if not found then raise exception 'El producto ya no existe.'; end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. M2 · Programación logística con filtro de aprobados y bloqueo predictivo del 30 %
-- ---------------------------------------------------------------------------
create or replace function public.fuel_schedule_add(p_date date, p_product bigint, p_carrier text, p_tons numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_prod public.fuel_products; v_sup public.fuel_suppliers; v_summary jsonb; v_id bigint;
begin
  if not public.has_app_permission('fuels.schedule') then
    raise exception 'Tu rol no tiene permiso para programar recepciones.' using errcode = '42501';
  end if;
  if p_date is null or p_date < public.fuel_today() then raise exception 'La fecha debe ser hoy o posterior.'; end if;
  if p_date > public.fuel_today() + 120 then raise exception 'Solo se puede programar hasta 120 días adelante.'; end if;
  if coalesce(btrim(p_carrier), '') = '' then raise exception 'Indica el transportista.'; end if;
  if p_tons is null or p_tons <= 0 or p_tons > 80 then raise exception 'El peso estimado debe estar entre 0 y 80 t.'; end if;

  select * into v_prod from public.fuel_products where id = p_product;
  if not found or not v_prod.active then raise exception 'El producto no está autorizado.'; end if;
  select * into v_sup from public.fuel_suppliers where id = v_prod.supplier_id;
  if v_sup.status <> 'aprobado' then raise exception '% no está aprobado.', v_sup.business_name using errcode = 'P0001'; end if;
  if v_sup.permit_valid_until < p_date then
    raise exception 'El permiso SEMARNAT de % vence el % (antes de la fecha programada).', v_sup.business_name, to_char(v_sup.permit_valid_until, 'DD/MM/YYYY')
      using errcode = 'P0001';
  end if;

  v_summary := public.fuel_month_summary_raw(p_date, p_tons * v_prod.calorific_value / 1000);
  if v_summary->>'projected_level' = 'rojo' then
    raise exception 'Bloqueo SEMARNAT: con esta carga la sustitución térmica proyectada de % llegaría a % %% (máximo 30 %%). Reduce el peso o prográmala otro mes.',
      v_summary->>'month', v_summary->>'projected_pct' using errcode = 'P0001';
  end if;

  insert into public.fuel_schedule (scheduled_on, supplier_id, product_id, carrier, estimated_tons, notes, created_by, created_by_name, updated_by_name)
  values (p_date, v_sup.id, v_prod.id, btrim(p_carrier), p_tons, nullif(btrim(p_notes), ''), auth.uid(), public.epp_actor_name(), public.epp_actor_name())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'summary', v_summary);
end;
$fn$;

create or replace function public.fuel_schedule_cancel(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.has_app_permission('fuels.schedule') then
    raise exception 'Tu rol no tiene permiso para cambiar la agenda.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Explica el motivo de la cancelación.'; end if;
  update public.fuel_schedule set status = 'cancelado', status_note = btrim(p_reason), updated_at = now(), updated_by_name = public.epp_actor_name()
  where id = p_id and status = 'programado';
  if not found then raise exception 'Solo se puede cancelar una recepción que siga programada.'; end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. M3 · Báscula: entrada (bruto), salida (tara, cierre irreversible), cancelación y cloro de laboratorio
-- ---------------------------------------------------------------------------
create or replace function public.fuel_scale_entry(
  p_schedule bigint, p_manifest text, p_carrier text, p_driver text, p_plates text, p_vehicle text,
  p_destination text, p_gross_kg numeric, p_notes text default null
) returns bigint language plpgsql security definer set search_path = public as $fn$
declare
  v_sch public.fuel_schedule; v_prod public.fuel_products; v_sup public.fuel_suppliers; v_id bigint;
  v_today date := public.fuel_today();
begin
  if not public.has_app_permission('fuels.scale') then
    raise exception 'Tu rol no tiene permiso para operar la báscula.' using errcode = '42501';
  end if;
  select * into v_sch from public.fuel_schedule where id = p_schedule for update;
  if not found then raise exception 'Selecciona una recepción de la agenda.'; end if;
  if v_sch.status <> 'programado' then raise exception 'Esa recepción ya no está programada (estatus: %).', v_sch.status; end if;
  if v_sch.scheduled_on > v_today then raise exception 'La recepción está programada para el %.', to_char(v_sch.scheduled_on, 'DD/MM/YYYY'); end if;
  if v_sch.scheduled_on < v_today - 7 then raise exception 'La recepción programada tiene más de 7 días de atraso; prográmala de nuevo.'; end if;

  select * into v_prod from public.fuel_products where id = v_sch.product_id;
  select * into v_sup from public.fuel_suppliers where id = v_sch.supplier_id;
  if not v_prod.active or v_sup.status <> 'aprobado' then raise exception 'El proveedor o el producto ya no están aprobados.' using errcode = 'P0001'; end if;
  if v_sup.permit_valid_until < v_today then
    raise exception 'El permiso SEMARNAT de % venció el %; no se puede recibir.', v_sup.business_name, to_char(v_sup.permit_valid_until, 'DD/MM/YYYY')
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_manifest), '') = '' then raise exception 'Captura el folio del manifiesto.'; end if;
  if coalesce(btrim(p_driver), '') = '' or coalesce(btrim(p_plates), '') = '' or coalesce(btrim(p_carrier), '') = '' then
    raise exception 'Completa transportista, chofer y placas.';
  end if;
  if p_gross_kg is null or p_gross_kg <= 0 or p_gross_kg > 80000 then raise exception 'El peso bruto debe estar entre 0 y 80,000 kg.'; end if;

  insert into public.fuel_receptions (manifest_folio, schedule_id, supplier_id, generator_name, generator_rfc, product_id, product_name,
    calorific_value, carrier, driver, plates, vehicle, destination, gross_kg, notes, created_by, created_by_name)
  values (upper(btrim(p_manifest)), v_sch.id, v_sup.id, v_sup.business_name, v_sup.rfc, v_prod.id, v_prod.name,
    v_prod.calorific_value, btrim(p_carrier), btrim(p_driver), upper(btrim(p_plates)), nullif(btrim(p_vehicle), ''),
    coalesce(nullif(btrim(p_destination), ''), 'Horno de clínker (coprocesamiento)'), round(p_gross_kg, 1), nullif(btrim(p_notes), ''),
    auth.uid(), public.epp_actor_name())
  returning id into v_id;
  update public.fuel_schedule set status = 'en_planta', updated_at = now() where id = v_sch.id;
  return v_id;
end;
$fn$;

-- Cierre: neto = bruto - tara. p_compensates: ticket fuera de especificación (cloro > 1.80 %) que esta carga corrige;
-- debe ser del mismo proveedor, de hace 2 días como máximo, y solo una corrección cruzada por proveedor al mes.
create or replace function public.fuel_scale_exit(p_id bigint, p_tare_kg numeric, p_chlorine numeric default null, p_compensates bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_rec public.fuel_receptions; v_prod public.fuel_products; v_target public.fuel_receptions;
  v_today date := public.fuel_today(); v_net numeric; v_summary jsonb; v_used integer;
  v_alt numeric; v_coke numeric; v_pct numeric;
begin
  if not public.has_app_permission('fuels.scale') then
    raise exception 'Tu rol no tiene permiso para operar la báscula.' using errcode = '42501';
  end if;
  select * into v_rec from public.fuel_receptions where id = p_id for update;
  if not found then raise exception 'El ticket no existe.'; end if;
  if v_rec.status <> 'en_planta' then raise exception 'El ticket % ya está %.', v_rec.id, v_rec.status; end if;
  if p_tare_kg is null or p_tare_kg <= 0 then raise exception 'Captura la tara.'; end if;
  if p_tare_kg >= v_rec.gross_kg then raise exception 'La tara (% kg) debe ser menor que el bruto (% kg).', p_tare_kg, v_rec.gross_kg; end if;
  if p_chlorine is not null and (p_chlorine < 0 or p_chlorine > 100) then raise exception 'El %% de cloro no es válido.'; end if;
  v_net := v_rec.gross_kg - round(p_tare_kg, 1);

  if p_compensates is not null then
    select * into v_target from public.fuel_receptions where id = p_compensates;
    if not found or v_target.status <> 'cerrado' then raise exception 'El ticket a corregir no existe o no está cerrado.'; end if;
    if v_target.supplier_id <> v_rec.supplier_id then raise exception 'La corrección debe ser del mismo proveedor.'; end if;
    if coalesce(v_target.chlorine_pct, 0) <= 1.80 then raise exception 'El ticket % no está fuera de especificación.', v_target.id; end if;
    if v_target.received_on < v_today - 2 then raise exception 'La corrección solo se permite en un lapso no mayor a 2 días.' using errcode = 'P0001'; end if;
    if exists (select 1 from public.fuel_receptions where compensates_id = v_target.id) then raise exception 'El ticket % ya fue corregido.', v_target.id; end if;
    if p_chlorine is null or p_chlorine > 1.80 then raise exception 'La carga de compensación debe tener un análisis de cloro de 1.80 %% o menos.' using errcode = 'P0001'; end if;
    select count(*) into v_used from public.fuel_receptions
    where supplier_id = v_rec.supplier_id and compensates_id is not null and status = 'cerrado'
      and received_on >= date_trunc('month', v_today)::date;
    if v_used > 0 then raise exception 'La corrección cruzada solo se puede hacer una vez al mes por proveedor.' using errcode = 'P0001'; end if;
  end if;

  select * into v_prod from public.fuel_products where id = v_rec.product_id;

  -- Marca de auditoría: % de sustitución del mes con este ticket ya incluido (el ticket cerrado ya no se puede tocar).
  v_summary := public.fuel_month_summary_raw(v_today, 0);
  v_alt := (v_summary->>'alt_gcal')::numeric + v_net / 1000 * v_rec.calorific_value / 1000;
  v_coke := (v_summary->>'coke_gcal')::numeric;
  if v_coke is not null and v_alt + v_coke > 0 then v_pct := round(v_alt / (v_alt + v_coke) * 100, 2); end if;

  update public.fuel_receptions set
    tare_kg = round(p_tare_kg, 1), tare_at = now(), net_kg = v_net, received_on = v_today, chlorine_pct = p_chlorine,
    compensates_id = p_compensates, scheme = v_prod.scheme, rate_per_ton = v_prod.rate_per_ton,
    subtotal = round(v_net / 1000 * v_prod.rate_per_ton, 2), month_pct_after = v_pct, status = 'cerrado',
    closed_by = auth.uid(), closed_by_name = public.epp_actor_name()
  where id = v_rec.id;
  if v_rec.schedule_id is not null then
    update public.fuel_schedule set status = 'recibido', updated_at = now() where id = v_rec.schedule_id;
  end if;

  v_summary := public.fuel_month_summary_raw(v_today, 0);
  return jsonb_build_object('id', v_rec.id, 'net_kg', v_net, 'summary', v_summary);
end;
$fn$;

-- Unidad que entró y se fue sin descargar: el ticket se cancela (queda en la bitácora) y la agenda vuelve a programado.
create or replace function public.fuel_scale_cancel(p_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_rec public.fuel_receptions;
begin
  if not public.has_app_permission('fuels.scale') then
    raise exception 'Tu rol no tiene permiso para operar la báscula.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Explica el motivo de la cancelación.'; end if;
  select * into v_rec from public.fuel_receptions where id = p_id for update;
  if not found or v_rec.status <> 'en_planta' then raise exception 'Solo se cancela un ticket con la unidad en planta.'; end if;
  update public.fuel_receptions set status = 'cancelado', cancel_reason = btrim(p_reason), closed_by = auth.uid(), closed_by_name = public.epp_actor_name(), tare_at = now()
  where id = p_id;
  if v_rec.schedule_id is not null then
    update public.fuel_schedule set status = 'programado', updated_at = now() where id = v_rec.schedule_id and status = 'en_planta';
  end if;
end;
$fn$;

create or replace function public.fuel_set_chlorine(p_id bigint, p_chlorine numeric)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not public.has_app_permission('fuels.scale') and not public.has_app_permission('fuels.suppliers') then
    raise exception 'Tu rol no tiene permiso para capturar análisis.' using errcode = '42501';
  end if;
  if p_chlorine is null or p_chlorine < 0 or p_chlorine > 100 then raise exception 'El %% de cloro no es válido.'; end if;
  update public.fuel_receptions set chlorine_pct = p_chlorine where id = p_id and status = 'cerrado' and chlorine_pct is null;
  if not found then raise exception 'El análisis de ese ticket ya está capturado o el ticket no está cerrado.'; end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. M5 · Consumo mensual de coque de petróleo
-- ---------------------------------------------------------------------------
create or replace function public.fuel_set_coke(p_month date, p_tons numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_month date := date_trunc('month', p_month)::date; v_actor text := public.epp_actor_name();
begin
  if not public.has_app_permission('fuels.ecology') then
    raise exception 'Tu rol no tiene permiso para capturar el consumo de coque.' using errcode = '42501';
  end if;
  if v_month > date_trunc('month', public.fuel_today())::date then raise exception 'No se puede capturar el consumo de un mes futuro.'; end if;
  if p_tons is null or p_tons < 0 or p_tons > 1000000 then raise exception 'Las toneladas de coque no son válidas.'; end if;
  insert into public.fuel_coke_consumption (month, coke_tons, notes, updated_by, updated_by_name)
  values (v_month, round(p_tons, 2), nullif(btrim(p_notes), ''), auth.uid(), v_actor)
  on conflict (month) do update set coke_tons = excluded.coke_tons, notes = excluded.notes, updated_at = now(),
    updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
  return public.fuel_month_summary_raw(v_month, 0);
end;
$fn$;

-- Devuelve true solo la primera vez que se pide para ese mes y nivel (así el correo a Ecología sale una vez).
create or replace function public.fuel_claim_alert(p_month date, p_level text)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare v_rows integer;
begin
  if not (public.has_app_permission('fuels.scale') or public.has_app_permission('fuels.schedule') or public.has_app_permission('fuels.ecology')) then
    return false;
  end if;
  insert into public.fuel_alerts_sent (month, level) values (date_trunc('month', p_month)::date, p_level) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Permisos de ejecución y RLS (lectura con fuels.view; escritura solo por las funciones)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.fuel_month_summary(date)',
    'public.fuel_save_supplier(bigint, jsonb, jsonb)',
    'public.fuel_set_commercial(bigint, text, numeric)',
    'public.fuel_schedule_add(date, bigint, text, numeric, text)',
    'public.fuel_schedule_cancel(bigint, text)',
    'public.fuel_scale_entry(bigint, text, text, text, text, text, text, numeric, text)',
    'public.fuel_scale_exit(bigint, numeric, numeric, bigint)',
    'public.fuel_scale_cancel(bigint, text)',
    'public.fuel_set_chlorine(bigint, numeric)',
    'public.fuel_set_coke(date, numeric, text)',
    'public.fuel_claim_alert(date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

alter table public.fuel_suppliers enable row level security;
alter table public.fuel_products enable row level security;
alter table public.fuel_schedule enable row level security;
alter table public.fuel_receptions enable row level security;
alter table public.fuel_coke_consumption enable row level security;
alter table public.fuel_alerts_sent enable row level security;

drop policy if exists "fuel_suppliers_select" on public.fuel_suppliers;
drop policy if exists "fuel_products_select" on public.fuel_products;
drop policy if exists "fuel_schedule_select" on public.fuel_schedule;
drop policy if exists "fuel_receptions_select" on public.fuel_receptions;
drop policy if exists "fuel_coke_select" on public.fuel_coke_consumption;
create policy "fuel_suppliers_select" on public.fuel_suppliers for select to authenticated using (public.has_app_permission('fuels.view'));
create policy "fuel_products_select" on public.fuel_products for select to authenticated using (public.has_app_permission('fuels.view'));
create policy "fuel_schedule_select" on public.fuel_schedule for select to authenticated using (public.has_app_permission('fuels.view'));
create policy "fuel_receptions_select" on public.fuel_receptions for select to authenticated using (public.has_app_permission('fuels.view'));
create policy "fuel_coke_select" on public.fuel_coke_consumption for select to authenticated using (public.has_app_permission('fuels.view'));

revoke all on public.fuel_suppliers, public.fuel_products, public.fuel_schedule, public.fuel_receptions,
  public.fuel_coke_consumption, public.fuel_alerts_sent from public, anon, authenticated;
grant select on public.fuel_suppliers, public.fuel_products, public.fuel_schedule, public.fuel_receptions,
  public.fuel_coke_consumption to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Permisos SEMARNAT en PDF (bucket privado, máximo 10 MB)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fuel-permits', 'fuel-permits', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fuel_permits_select" on storage.objects;
drop policy if exists "fuel_permits_insert" on storage.objects;
drop policy if exists "fuel_permits_delete" on storage.objects;
create policy "fuel_permits_select" on storage.objects for select to authenticated
using (bucket_id = 'fuel-permits' and public.has_app_permission('fuels.view'));
create policy "fuel_permits_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'fuel-permits' and public.has_app_permission('fuels.suppliers'));
create policy "fuel_permits_delete" on storage.objects for delete to authenticated
using (bucket_id = 'fuel-permits' and public.has_app_permission('fuels.suppliers'));

-- ---------------------------------------------------------------------------
-- 10. Roles sugeridos (se ajustan después en Usuarios y roles)
-- ---------------------------------------------------------------------------
insert into public.roles (nombre, descripcion, permisos) values
  ('CombustiblesAlternos', 'Homologación de proveedores y programación logística de combustibles alternos', array['fuels.view','fuels.suppliers','fuels.schedule']),
  ('OperadorBascula', 'Captura de manifiestos, pesos de entrada y salida y certificados de recepción', array['fuels.view','fuels.scale']),
  ('Ecologia', 'Consumo de coque, semáforo SEMARNAT y reporte semestral', array['fuels.view','fuels.ecology']),
  ('ContabilidadCombustibles', 'Esquemas, tarifas y reportes contables de combustibles alternos', array['fuels.view','fuels.commercial'])
on conflict (nombre) do nothing;
