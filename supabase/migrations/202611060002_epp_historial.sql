-- EPP: historial de MUESTRA tomado de los Excel (octubre y noviembre 2026).
-- Ejecutar DESPUÉS de 202611060001_epp.sql. Es seguro repetirla: no duplica registros.
-- Las entregas históricas NO modifican las existencias (ya reflejan el conteo al 3-nov-2026).
-- Los Excel no indican quién entregó cada pieza: esas filas quedan como "Importación Excel".

alter table public.epp_movements
  add column if not exists historical boolean not null default false,
  add column if not exists employee_group text,
  add column if not exists employee_position text,
  add column if not exists source_key text;
alter table public.epp_movements alter column stock_after drop not null;
create unique index if not exists epp_movements_source_key on public.epp_movements (source_key) where source_key is not null;
create index if not exists epp_movements_moved_on_idx on public.epp_movements (moved_on desc);

-- Texto sin acentos y en mayúsculas para comparar nombres.
create or replace function public.epp_norm(value text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(upper(translate(coalesce(value, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '\s+', ' ', 'g');
$$;

-- Las entregas nuevas también guardan el puesto del trabajador.
create or replace function public.epp_apply(
  p_kind text, p_items jsonb, p_employee uuid default null, p_date date default current_date, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
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
    insert into public.epp_movements (article_id, kind, delta, stock_after, employee_id, employee_name, employee_code, employee_position, site, moved_on, notes, created_by, created_by_name)
    values (v_art.id, p_kind, v_delta, v_art.stock + v_delta, v_emp.id, v_emp.full_name, v_emp.employee_code, v_emp.position, v_emp.site, p_date, nullif(btrim(p_notes), ''), auth.uid(), v_actor);
    v_count := v_count + 1; v_units := v_units + abs(v_delta);
  end loop;
  return jsonb_build_object('lines', v_count, 'units', v_units);
end;
$fn$;

-- Artículos que solo existen en el historial (inactivos, sin existencia).
do $arts$
begin
  perform set_config('epp.internal', '1', true);
  insert into public.epp_articles (name, category, stock, active, updated_by_name)
  select v.name, v.category, 0, false, 'Importación Excel'
  from (values ('MASCARILLA M15', 'Protección respiratoria'), ('CAMISOLA (SIN TALLA)', 'Ropa de trabajo')) as v(name, category)
  where not exists (select 1 from public.epp_articles a where public.epp_norm(a.name) = public.epp_norm(v.name));
end
$arts$;

-- MUESTRA: solo 28 entregas de 4 trabajadores para validar la pantalla (el historial completo se carga después).
with p(id, name, grp, pos) as (values
  (33,'EDUARDO JOSUE PACHECO MATU','PERSONAL CYM','OFICIAL SOLDADOR'),
  (59,'JESUS ALEJANDRO PUGA MAY','PERSONAL CYM','OFICIAL ELECTRICO'),
  (65,'JESUS SEBASTIAN RUZ PIMIENTA','PERSONAL CYM','AUXILIAR ELECTRICO'),
  (70,'JOSE CANDELARIO MAY TUN','PERSONAL CYM','OFICIAL ELECTRICO')
), a(id, name) as (values
  (1,'BARBIQUEJOS'),
  (2,'BOTAS DE CASQUILLO'),
  (3,'CAMISOLA (SIN TALLA)'),
  (13,'GAFAS OSCURAS'),
  (16,'GUANTES DE CARNAZA'),
  (17,'GUANTES DE NITRILO'),
  (18,'GUANTES DE SOLDADOR'),
  (21,'MASCARILLA M15')
), r(p_id, a_id, day, qty, note) as (values
  (70,3,'2025-06-27',1,null),
  (70,2,'2025-07-05',1,'Talla #5'),
  (70,3,'2026-05-02',1,null),
  (70,2,'2026-06-02',1,'Talla #5'),
  (70,17,'2026-10-07',1,null),
  (70,17,'2026-10-24',1,null),
  (70,21,'2026-10-24',1,null),
  (59,2,'2025-07-05',1,'Talla #6'),
  (59,3,'2025-07-15',1,null),
  (59,3,'2025-10-21',1,null),
  (59,3,'2026-04-30',1,null),
  (59,2,'2026-06-01',1,'Talla #6'),
  (59,16,'2026-10-07',1,null),
  (59,17,'2026-10-24',1,null),
  (33,3,'2026-03-06',1,null),
  (33,2,'2026-06-09',1,null),
  (33,2,'2026-09-17',1,null),
  (33,17,'2026-10-08',1,null),
  (33,18,'2026-10-08',1,null),
  (33,18,'2026-10-17',1,null),
  (33,16,'2026-10-22',1,null),
  (65,3,'2026-05-04',1,null),
  (65,2,'2026-07-27',1,'Talla #7'),
  (65,13,'2026-10-09',1,null),
  (65,21,'2026-10-15',1,null),
  (65,21,'2026-10-19',1,null),
  (65,18,'2026-10-24',1,null),
  (65,1,'2026-10-27',1,null)
)
insert into public.epp_movements
  (article_id, kind, delta, stock_after, employee_id, employee_name, employee_code, site, employee_group, employee_position,
   moved_on, notes, created_by_name, historical, source_key)
select art.id, 'entrega', -r.qty, null, emp.id, p.name, emp.employee_code, emp.site, p.grp, coalesce(p.pos, emp.position),
       r.day::date, r.note, 'Importación Excel', true,
       'excel:' || public.epp_norm(p.name) || ':' || art.id || ':' || r.day
from r
join p on p.id = r.p_id
join a on a.id = r.a_id
join public.epp_articles art on public.epp_norm(art.name) = public.epp_norm(a.name)
left join lateral (
  select e.id, e.employee_code, e.site, e."position" from public.employees e
  where public.epp_norm(e.full_name) = public.epp_norm(p.name) limit 1
) emp on true
on conflict do nothing;

-- Si después das de alta a un trabajador del Excel, esto enlaza sus entregas históricas con su expediente.
create or replace function public.epp_relink_employees()
returns integer language sql security definer set search_path = public as $$
  with upd as (
    update public.epp_movements m set employee_id = e.id, employee_code = e.employee_code, site = e.site
    from public.employees e
    where m.employee_id is null and m.employee_name is not null and public.epp_norm(e.full_name) = public.epp_norm(m.employee_name)
    returning 1
  ) select count(*)::integer from upd;
$$;
revoke all on function public.epp_relink_employees() from public, anon, authenticated;
