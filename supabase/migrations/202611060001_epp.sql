-- Módulo de EPP: catálogo con existencias, movimientos (ingresos, entregas, ajustes) y trazabilidad.
-- Ejecutar DESPUÉS de 202611050001_seguridad.sql.
-- Permisos nuevos (se asignan a cada rol desde Usuarios y roles; SuperAdmin ya los tiene todos):
--   epp.view (consultar), epp.deliver (registrar entregas), epp.manage (catálogo, ingresos y ajustes).

create table if not exists public.epp_articles (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null default 'Herramientas y otros',
  size text,
  unit text not null default 'PIEZAS',
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 5 check (min_stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists epp_articles_name_key on public.epp_articles (upper(name));

create table if not exists public.epp_movements (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.epp_articles(id),
  kind text not null check (kind in ('ingreso','entrega','ajuste')),
  delta integer not null check (delta <> 0),
  stock_after integer not null,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,
  employee_code text,
  site text,
  moved_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text
);
create index if not exists epp_movements_article_idx on public.epp_movements (article_id, created_at desc);
create index if not exists epp_movements_employee_idx on public.epp_movements (employee_id, created_at desc);
create index if not exists epp_movements_date_idx on public.epp_movements (created_at desc);

-- Nombre de quien opera, tomado de la cuenta autenticada (nunca del navegador).
create or replace function public.epp_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(au.full_name, ''), au.email) from public.authorized_users au where au.user_id = auth.uid() limit 1;
$$;

-- Sella quién y cuándo modificó un artículo; la existencia solo cambia desde epp_apply().
create or replace function public.epp_articles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare internal boolean := coalesce(current_setting('epp.internal', true), '') = '1';
begin
  if not internal then
    if tg_op = 'INSERT' and new.stock <> 0 then
      raise exception 'La existencia inicial se registra como ingreso o ajuste.';
    end if;
    if tg_op = 'UPDATE' and new.stock <> old.stock then
      raise exception 'La existencia solo cambia registrando un movimiento.';
    end if;
  end if;
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    new.updated_by_name := public.epp_actor_name();
  end if;
  return new;
end;
$$;
drop trigger if exists epp_articles_guard on public.epp_articles;
create trigger epp_articles_guard before insert or update on public.epp_articles
for each row execute function public.epp_articles_guard();

-- Registra ingresos, entregas o ajustes de varios artículos en una sola transacción.
-- p_items: [{"article_id": 1, "quantity": 2}, ...] (en ajustes, quantity puede ser negativa).
create or replace function public.epp_apply(
  p_kind text, p_items jsonb, p_employee uuid default null, p_date date default current_date, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb; v_art public.epp_articles; v_qty integer; v_delta integer; v_emp public.employees;
  v_actor text := public.epp_actor_name(); v_count integer := 0; v_units integer := 0;
begin
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

  perform set_config('epp.internal', '1', true);
  for item in select * from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::integer;
    if v_qty is null or v_qty = 0 or (p_kind <> 'ajuste' and v_qty < 0) then raise exception 'Las cantidades deben ser mayores a cero.'; end if;
    v_delta := case when p_kind = 'entrega' then -v_qty else v_qty end;
    select * into v_art from public.epp_articles where id = (item->>'article_id')::bigint for update;
    if not found then raise exception 'Uno de los artículos ya no existe.'; end if;
    if not v_art.active and p_kind <> 'ajuste' then raise exception 'El artículo % está desactivado.', v_art.name; end if;
    if v_art.stock + v_delta < 0 then
      raise exception 'Existencia insuficiente de % (hay %, se piden %).', v_art.name, v_art.stock, abs(v_delta) using errcode = 'P0001';
    end if;
    update public.epp_articles set stock = stock + v_delta where id = v_art.id;
    insert into public.epp_movements (article_id, kind, delta, stock_after, employee_id, employee_name, employee_code, site, moved_on, notes, created_by, created_by_name)
    values (v_art.id, p_kind, v_delta, v_art.stock + v_delta, v_emp.id, v_emp.full_name, v_emp.employee_code, v_emp.site, p_date, nullif(btrim(p_notes), ''), auth.uid(), v_actor);
    v_count := v_count + 1; v_units := v_units + abs(v_delta);
  end loop;
  return jsonb_build_object('lines', v_count, 'units', v_units);
end;
$$;
revoke all on function public.epp_apply(text, jsonb, uuid, date, text) from public, anon;
grant execute on function public.epp_apply(text, jsonb, uuid, date, text) to authenticated;
revoke all on function public.epp_actor_name() from public, anon;
grant execute on function public.epp_actor_name() to authenticated;

-- RLS: lectura con epp.view; el catálogo se edita con epp.manage; los movimientos solo nacen en epp_apply().
alter table public.epp_articles enable row level security;
alter table public.epp_movements enable row level security;
drop policy if exists "epp_articles_select" on public.epp_articles;
drop policy if exists "epp_articles_insert" on public.epp_articles;
drop policy if exists "epp_articles_update" on public.epp_articles;
drop policy if exists "epp_movements_select" on public.epp_movements;
create policy "epp_articles_select" on public.epp_articles for select to authenticated using (public.has_app_permission('epp.view'));
create policy "epp_articles_insert" on public.epp_articles for insert to authenticated with check (public.has_app_permission('epp.manage'));
create policy "epp_articles_update" on public.epp_articles for update to authenticated using (public.has_app_permission('epp.manage')) with check (public.has_app_permission('epp.manage'));
create policy "epp_movements_select" on public.epp_movements for select to authenticated using (public.has_app_permission('epp.view'));
revoke all on public.epp_articles, public.epp_movements from anon;
revoke insert, update, delete on public.epp_movements from authenticated;
revoke delete on public.epp_articles from authenticated;

-- Catálogo inicial tomado de los Excel de inventario (existencias al 3-nov-2026).
do $seed$
declare r record;
begin
  perform set_config('epp.internal', '1', true);
  for r in select * from (values
  ('TAPONES AUDITIVOS','Protección auditiva',null,120),
  ('GUANTES DE NITRILO','Protección de manos',null,99),
  ('RESPIRADOR N95 C/A','Protección respiratoria',null,26),
  ('RESPIRADOR N95','Protección respiratoria',null,182),
  ('GUANTES DE CARNAZA','Protección de manos',null,22),
  ('FILTRO P100 (PARES)','Protección respiratoria',null,100),
  ('RODILLERAS','Ropa de trabajo',null,1),
  ('GAFAS OSCURAS','Protección visual y facial',null,6),
  ('GAFAS TRANSPARENTES','Protección visual y facial',null,33),
  ('CAMISOLA TALLA S','Ropa de trabajo','S',1),
  ('CAMISOLA TALLA M','Ropa de trabajo','M',0),
  ('CAMISOLA TALLA L','Ropa de trabajo','L',0),
  ('CAMISOLA TALLA 3XL','Ropa de trabajo','3XL',2),
  ('CAMISOLA TALLA 2XL','Ropa de trabajo','2XL',2),
  ('CAMISOLA TALLA XL','Ropa de trabajo','XL',0),
  ('CAMISOLA TALLA 4XL','Ropa de trabajo','4XL',0),
  ('GUANTES DE SOLDADOR','Protección de manos',null,7),
  ('MANGAS','Ropa de trabajo',null,8),
  ('PETO MEZCILLA','Ropa de trabajo',null,9),
  ('PETOS','Ropa de trabajo',null,1),
  ('POLAINAS','Ropa de trabajo',null,5),
  ('OVEROLES','Ropa de trabajo',null,3),
  ('BARBIQUEJOS','Protección de cabeza',null,22),
  ('HIPERMEABLE','Ropa de trabajo',null,3),
  ('CAPUCHAS','Protección de cabeza',null,9),
  ('BOTAS DE CASQUILLO','Calzado',null,1),
  ('BOTAS DIALECTRICOS','Calzado',null,3),
  ('CASCOS','Protección de cabeza',null,4),
  ('CARETAS FACIALES','Protección visual y facial',null,2),
  ('MICAS PARA CARETAS','Protección visual y facial',null,10),
  ('POLAINAS DECARNAZA (SOLDADOR)','Ropa de trabajo',null,1),
  ('LIMAS','Herramientas y otros',null,0),
  ('MACHETES','Herramientas y otros',null,5),
  ('BALACLAVA(PASAMONTAÑAS)','Protección de cabeza',null,8),
  ('GOOGLES','Protección visual y facial',null,3),
  ('CINTAS','Herramientas y otros',null,0),
  ('LAMPARAS','Herramientas y otros',null,2),
  ('GUANTES NITRILO AZUL','Protección de manos',null,7),
  ('BANDERA','Herramientas y otros',null,0),
  ('MASCARILLA MEDIA CARA','Protección respiratoria',null,0),
  ('ARNES','Trabajo en altura',null,1),
  ('PETOS CARNAZA','Ropa de trabajo',null,1),
  ('ROLLO DE CABLE 3X12 (30) METROS','Herramientas y otros',null,1),
  ('INVERSORA','Herramientas y otros',null,1),
  ('CARETA ELECTRONICA INDUSTRIAL','Protección visual y facial',null,0),
  ('CAJA CONEXIONES','Herramientas y otros',null,2),
  ('CANDADOS C/LLAVES','Herramientas y otros',null,3)
  ) as t(name, category, size, stock)
  loop
    if not exists (select 1 from public.epp_articles where upper(name) = upper(r.name)) then
      insert into public.epp_articles (name, category, size, stock, updated_by_name) values (r.name, r.category, r.size, r.stock, 'Importación Excel');
      if r.stock > 0 then
        insert into public.epp_movements (article_id, kind, delta, stock_after, moved_on, notes, created_by_name)
        select id, 'ajuste', r.stock, r.stock, date '2026-11-03', 'Existencia inicial (Excel de inventario)', 'Importación Excel'
        from public.epp_articles where upper(name) = upper(r.name);
      end if;
    end if;
  end loop;
end
$seed$;
