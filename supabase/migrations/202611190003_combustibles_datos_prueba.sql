-- Combustibles alternos: DATOS DE PRUEBA para ver funcionar el sistema SCA (/sca).
-- Ejecutar DESPUÉS de 202611100001_combustibles_alternos.sql. Es seguro repetirla: si ya se cargaron, no hace nada.
--
-- Carga, con fechas relativas a "hoy" de la planta:
--   · 5 proveedores (aprobados vigentes, uno con permiso por vencer, uno vencido y uno rechazado) con 6 productos.
--   · Consumo de coque de los últimos 6 meses (incluido el actual).
--   · Tickets de báscula cerrados de los últimos 6 meses (con su agenda "recibido"), un ticket de ayer con
--     cloro fuera de especificación (en plazo de corrección), uno penalizado y una unidad en planta hoy.
--   · Agenda programada para hoy y los próximos días, y una recepción cancelada.
--
-- Todo queda marcado con created_by_name / updated_by_name = 'Datos de prueba' y folios PRB-…
-- Para BORRARLOS (los tickets están protegidos contra borrado, por eso se desactiva el candado un momento):
--
--   begin;
--   alter table public.fuel_receptions disable trigger fuel_receptions_lock;
--   delete from public.fuel_receptions where manifest_folio like 'PRB-%';
--   alter table public.fuel_receptions enable trigger fuel_receptions_lock;
--   delete from public.fuel_schedule where created_by_name = 'Datos de prueba';
--   delete from public.fuel_suppliers where created_by_name = 'Datos de prueba';   -- borra sus productos en cascada
--   delete from public.fuel_coke_consumption where updated_by_name = 'Datos de prueba';
--   commit;

do $seed$
declare
  c_who constant text := 'Datos de prueba';
  v_today date := public.fuel_today();
  v_month date := date_trunc('month', public.fuel_today())::date;
  s1 bigint; s2 bigint; s3 bigint; s4 bigint; s5 bigint;
  p_tdf bigint; p_plas bigint; p_oil bigint; p_husk bigint; p_paint bigint; p_cdr bigint;
  v_products bigint[]; v_suppliers bigint[];
  v_carriers text[] := array['Transportes del Sureste', 'Fletes Peninsulares', 'Logística Can-Mex', 'Autotransportes Champotón'];
  v_drivers text[] := array['José Luis Canché', 'Martín Ek Chi', 'Raúl Pech Uc', 'Fernando Dzib', 'Carlos Huchín', 'Luis Alberto May'];
  v_plates text[] := array['CP-4521-A', 'YUC-882-B', 'CAM-1193', 'TAB-7720-C', 'QR-5512-K', 'CP-9033-D'];
  v_coke numeric[] := array[960, 900, 870, 940, 910, 930];  -- de hace 5 meses al actual
  v_trucks int[] := array[11, 12, 15, 10, 12, 0];          -- el mes actual se arma por días
  m int; k int; n int := 0; i int;
  v_mon date; v_day date; v_days int; v_coke_gcal numeric; v_alt numeric;
  v_prod public.fuel_products; v_sup public.fuel_suppliers;
  v_net numeric; v_tare numeric; v_cl numeric; v_sched bigint; v_rec bigint;
begin
  if exists (select 1 from public.fuel_suppliers where created_by_name = c_who) then
    raise notice 'Los datos de prueba de combustibles ya estaban cargados.';
    return;
  end if;
  perform setseed(0.42);

  -- -------------------------------------------------------------------------
  -- M1 · Proveedores y productos
  -- -------------------------------------------------------------------------
  insert into public.fuel_suppliers (business_name, rfc, address, contact_name, phone, email, permit_number, permit_valid_until, status, created_by_name, updated_by_name)
  values ('Ecoenergía del Sureste S.A. de C.V.', 'EES150312AB1', 'Carr. Campeche–Mérida km 12, Campeche, Camp.', 'Ing. Laura Cauich', '981 812 4410', 'logistica@ecoenergia-prueba.mx', 'SEMARNAT-04-2025-118', v_today + 300, 'aprobado', c_who, c_who)
  returning id into s1;
  insert into public.fuel_suppliers (business_name, rfc, address, contact_name, phone, email, permit_number, permit_valid_until, status, created_by_name, updated_by_name)
  values ('Reciclados Industriales de Campeche S.A. de C.V.', 'RIC180905XY2', 'Parque Industrial Lerma, Campeche, Camp.', 'Lic. Mario Poot', '981 816 0021', 'ventas@ricampeche-prueba.mx', 'SEMARNAT-04-2024-077', v_today + 20, 'aprobado', c_who, c_who)
  returning id into s2;
  insert into public.fuel_suppliers (business_name, rfc, address, contact_name, phone, email, permit_number, permit_valid_until, status, created_by_name, updated_by_name)
  values ('Biomasa Peninsular S.P.R. de R.L.', 'BPE200114KL3', 'Champotón, Camp.', 'Ing. Andrea Ku', '982 828 3307', null, 'SEMARNAT-04-2025-203', v_today + 200, 'aprobado', c_who, c_who)
  returning id into s3;
  insert into public.fuel_suppliers (business_name, rfc, address, contact_name, phone, email, permit_number, permit_valid_until, status, created_by_name, updated_by_name)
  values ('Solventes y Residuos del Golfo S.A. de C.V.', 'SRG170620MN4', 'Cd. del Carmen, Camp.', 'Q. Roberto Sansores', '938 112 9054', 'calidad@srgolfo-prueba.mx', 'SEMARNAT-04-2023-031', v_today - 10, 'aprobado', c_who, c_who)
  returning id into s4;
  insert into public.fuel_suppliers (business_name, rfc, address, contact_name, phone, email, permit_number, permit_valid_until, status, status_note, created_by_name, updated_by_name)
  values ('Combustibles Derivados Maya S.A. de C.V.', 'CDM210830PQ5', 'Mérida, Yuc.', 'Ing. Pedro Balam', '999 455 1290', null, 'SEMARNAT-31-2025-010', v_today + 150, 'rechazado', 'Análisis de laboratorio vencido; se pidió uno nuevo.', c_who, c_who)
  returning id into s5;

  insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, scheme, rate_per_ton, updated_by_name)
  values (s1, 'Llanta triturada (TDF)', 7800, 0.15, 1.50, 0.95, 'pago', 350, c_who) returning id into p_tdf;
  insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, scheme, rate_per_ton, updated_by_name)
  values (s1, 'Plástico no reciclable', 6800, 1.20, 5.00, 0.30, 'cobro', 450, c_who) returning id into p_plas;
  insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, scheme, rate_per_ton, updated_by_name)
  values (s2, 'Aceite lubricante gastado', 9200, 0.80, 3.00, 0.60, 'cobro', 800, c_who) returning id into p_oil;
  insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, scheme, rate_per_ton, updated_by_name)
  values (s3, 'Cascarilla de arroz', 5600, 0.10, 10.00, 0.10, 'valor_cero', 0, c_who) returning id into p_husk;
  insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, scheme, rate_per_ton, updated_by_name)
  values (s4, 'Lodos de pintura', 6200, 1.50, 11.00, 0.50, 'cobro', 1200, c_who) returning id into p_paint;
  insert into public.fuel_products (supplier_id, name, calorific_value, chlorine_pct, water_pct, sulfur_pct, scheme, rate_per_ton, updated_by_name)
  values (s5, 'Combustible derivado de residuos (CDR)', 5900, 1.00, 8.00, 0.40, 'valor_cero', 0, c_who) returning id into p_cdr;

  -- -------------------------------------------------------------------------
  -- M5 · Coque de petróleo de los últimos 6 meses
  -- -------------------------------------------------------------------------
  for m in 0..5 loop
    insert into public.fuel_coke_consumption (month, coke_tons, notes, updated_by_name)
    values ((v_month - make_interval(months => 5 - m))::date, v_coke[m + 1], 'Consumo de prueba', c_who)
    on conflict (month) do nothing;
  end loop;

  -- -------------------------------------------------------------------------
  -- M2 + M3 · Agenda recibida y tickets cerrados
  -- -------------------------------------------------------------------------
  for m in 0..5 loop
    v_mon := (v_month - make_interval(months => 5 - m))::date;
    select coke_tons * 7.5 into v_coke_gcal from public.fuel_coke_consumption where month = v_mon;
    v_alt := 0;
    -- Meses pasados: v_trucks camiones repartidos en el mes. Mes actual: uno cada ~2 días hasta ayer.
    if m < 5 then
      v_days := extract(day from (v_mon + interval '1 month' - interval '1 day'))::int;
      k := v_trucks[m + 1];
    else
      v_days := greatest(extract(day from v_today)::int - 1, 0);
      k := v_days / 2;
    end if;

    for i in 1..k loop
      if m < 5 then
        v_day := v_mon + ((i - 1) * v_days / k);
      else
        v_day := v_mon + ((i - 1) * 2);
        -- El último camión del mes actual siempre llega ayer (para el caso de cloro en plazo).
        if i = k then v_day := v_today - 1; end if;
      end if;
      exit when v_day >= v_today;
      n := n + 1;

      -- Mezcla de productos; los lodos de pintura (permiso hoy vencido) solo en meses pasados.
      v_products := case when m < 4 then array[p_tdf, p_plas, p_oil, p_husk, p_paint, p_tdf] else array[p_tdf, p_plas, p_oil, p_husk, p_tdf, p_oil] end;
      select * into v_prod from public.fuel_products where id = v_products[1 + (n % 6)];
      if m = 5 and i = k then select * into v_prod from public.fuel_products where id = p_plas; end if;
      select * into v_sup from public.fuel_suppliers where id = v_prod.supplier_id;

      v_net := round(18000 + random() * 6000);
      v_tare := round(14000 + random() * 2500);
      v_cl := round((v_prod.chlorine_pct * (0.7 + random() * 0.5))::numeric, 2);
      if m = 2 and i = 4 then v_cl := 2.05; end if;        -- penalizado (sin corrección a tiempo)
      if m = 5 and i = k then v_cl := 1.95; end if;        -- ayer: fuera de especificación, en plazo
      v_cl := least(v_cl, 2.5);
      v_alt := v_alt + v_net / 1000 * v_prod.calorific_value / 1000;

      insert into public.fuel_schedule (scheduled_on, supplier_id, product_id, carrier, estimated_tons, status, created_by_name, updated_by_name)
      values (v_day, v_sup.id, v_prod.id, v_carriers[1 + (n % 4)], round(v_net / 1000), 'recibido', c_who, c_who)
      returning id into v_sched;

      insert into public.fuel_receptions (
        manifest_folio, schedule_id, supplier_id, generator_name, generator_rfc, product_id, product_name, calorific_value,
        carrier, driver, plates, vehicle, destination, gross_kg, gross_at, tare_kg, tare_at, net_kg, received_on, chlorine_pct,
        scheme, rate_per_ton, subtotal, month_pct_after, status, created_by_name, closed_by_name)
      values (
        'PRB-' || to_char(v_day, 'YYMMDD') || '-' || lpad(n::text, 3, '0'), v_sched, v_sup.id, v_sup.business_name, v_sup.rfc,
        v_prod.id, v_prod.name, v_prod.calorific_value,
        v_carriers[1 + (n % 4)], v_drivers[1 + (n % 6)], v_plates[1 + (n % 6)], 'Tractocamión con caja seca',
        'Horno de clínker (coprocesamiento)', v_tare + v_net, (v_day + time '08:00' + make_interval(mins => (n * 37) % 300)) at time zone 'America/Mexico_City',
        v_tare, (v_day + time '09:30' + make_interval(mins => (n * 37) % 300)) at time zone 'America/Mexico_City', v_net, v_day, v_cl,
        v_prod.scheme, v_prod.rate_per_ton, round(v_net / 1000 * v_prod.rate_per_ton, 2),
        round(v_alt / (v_alt + v_coke_gcal) * 100, 2), 'cerrado', c_who, c_who);
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- Hoy: una unidad en planta (Ecoenergía, puede compensar el ticket de ayer) y agenda pendiente
  -- -------------------------------------------------------------------------
  insert into public.fuel_schedule (scheduled_on, supplier_id, product_id, carrier, estimated_tons, notes, status, created_by_name, updated_by_name)
  values (v_today, s1, p_tdf, 'Transportes del Sureste', 22, 'Carga de compensación de cloro', 'en_planta', c_who, c_who)
  returning id into v_sched;
  insert into public.fuel_receptions (manifest_folio, schedule_id, supplier_id, generator_name, generator_rfc, product_id, product_name,
    calorific_value, carrier, driver, plates, vehicle, destination, gross_kg, gross_at, status, notes, created_by_name)
  select 'PRB-' || to_char(v_today, 'YYMMDD') || '-EP1', v_sched, s.id, s.business_name, s.rfc, p.id, p.name, p.calorific_value,
    'Transportes del Sureste', 'José Luis Canché', 'CP-4521-A', 'Tractocamión con caja seca', 'Horno de clínker (coprocesamiento)',
    37850, now() - interval '40 minutes', 'en_planta', 'Unidad de prueba esperando tara', c_who
  from public.fuel_suppliers s join public.fuel_products p on p.id = p_tdf where s.id = s1;

  insert into public.fuel_schedule (scheduled_on, supplier_id, product_id, carrier, estimated_tons, notes, status, created_by_name, updated_by_name)
  values
    (v_today, s2, p_oil, 'Fletes Peninsulares', 20, 'Llega por la tarde', 'programado', c_who, c_who),
    (v_today, s3, p_husk, 'Autotransportes Champotón', 18, null, 'programado', c_who, c_who),
    (v_today + 1, s1, p_plas, 'Logística Can-Mex', 21, null, 'programado', c_who, c_who),
    (v_today + 2, s2, p_oil, 'Fletes Peninsulares', 22, null, 'programado', c_who, c_who),
    (v_today + 4, s3, p_husk, 'Autotransportes Champotón', 19, null, 'programado', c_who, c_who),
    (v_today + 6, s1, p_tdf, 'Transportes del Sureste', 23, null, 'programado', c_who, c_who),
    (v_today + 9, s1, p_plas, 'Logística Can-Mex', 20, 'Confirmar análisis de cloro', 'programado', c_who, c_who);
  insert into public.fuel_schedule (scheduled_on, supplier_id, product_id, carrier, estimated_tons, status, status_note, created_by_name, updated_by_name)
  values (v_today - 3, s2, p_oil, 'Fletes Peninsulares', 20, 'cancelado', 'El proveedor no tuvo unidad disponible.', c_who, c_who);

  raise notice 'Datos de prueba de combustibles cargados: % tickets cerrados.', n;
end;
$seed$;
