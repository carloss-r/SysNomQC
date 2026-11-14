-- Empleados: consultas rápidas.
--
--   * Políticas RLS con (select …): el permiso se evalúa una vez por consulta, no por fila.
--   * employee_site_counts: los contadores de la pantalla en una sola consulta (antes eran 6 conteos).
--   * employee_next_code(): siguiente ID QG-n calculado en la base (antes se descargaban todos los códigos).
--   * employee_gaps: avisos de expediente incompleto sin sacar NSS, CURP, RFC ni cuenta bancaria de la base
--     (antes la campana descargaba esos datos de todos los empleados activos en cada actualización).
--   * Índices para ordenar por nombre, filtrar por sede y buscar texto (pg_trgm).
--
-- Es seguro ejecutarla más de una vez. Requiere las migraciones de empleados anteriores (hasta 202611130005).

-- ---------------------------------------------------------------------------
-- 1. Políticas: mismas reglas, evaluadas una sola vez por consulta.
-- ---------------------------------------------------------------------------
drop policy if exists "employees_select" on public.employees;
create policy "employees_select" on public.employees for select to authenticated
using ((select public.has_app_permission('employees.view')));

drop policy if exists "employees_insert" on public.employees;
create policy "employees_insert" on public.employees for insert to authenticated
with check ((select public.has_app_permission('employees.create')));

drop policy if exists "employees_update" on public.employees;
create policy "employees_update" on public.employees for update to authenticated
using ((select public.has_app_permission('employees.edit')))
with check ((select public.has_app_permission('employees.edit')));

drop policy if exists "employees_delete" on public.employees;
create policy "employees_delete" on public.employees for delete to authenticated
using ((select public.has_app_permission('employees.delete')));

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create index if not exists employees_name_order_idx on public.employees (full_name, id);
create index if not exists employees_site_name_idx on public.employees (site, full_name, id);
create index if not exists employees_active_site_idx on public.employees (site, full_name) where active = true;
create index if not exists employees_followup_idx on public.employees (observations_updated_at desc nulls last, id)
  where observations is not null;

-- Búsqueda por texto (ilike '%…%') en las cuatro columnas que usa el directorio.
create index if not exists employees_full_name_trgm on public.employees using gin (full_name extensions.gin_trgm_ops);
create index if not exists employees_code_trgm on public.employees using gin (employee_code extensions.gin_trgm_ops);
create index if not exists employees_position_trgm on public.employees using gin (position extensions.gin_trgm_ops);
create index if not exists employees_email_trgm on public.employees using gin (email extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Contadores por sede (activos y en seguimiento). security_invoker: respeta RLS.
-- ---------------------------------------------------------------------------
create or replace view public.employee_site_counts with (security_invoker = true) as
select
  e.site,
  count(*) filter (where e.active)::int as active,
  count(*) filter (where e.observations is not null)::int as follow_up
from public.employees e
group by e.site;

revoke all on public.employee_site_counts from public, anon;
grant select on public.employee_site_counts to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Siguiente ID sugerido (QG-n): el número más alto al final de los códigos + 1, mínimo QG-101.
--    security invoker: solo funciona para quien puede ver empleados (RLS).
-- ---------------------------------------------------------------------------
create or replace function public.employee_next_code()
returns text language sql stable security invoker set search_path = public as $$
  select 'QG-' || (greatest(100, coalesce(max(substring(e.employee_code from '(\d+)$')::bigint), 0)) + 1)::text
  from public.employees e;
$$;
revoke all on function public.employee_next_code() from public, anon;
grant execute on function public.employee_next_code() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Expedientes incompletos: solo qué falta (verdadero/falso), nunca el dato.
--    Mismas reglas que antes en src/lib/notifications.ts (vacío cuenta como faltante; salario > 0).
-- ---------------------------------------------------------------------------
create or replace view public.employee_gaps with (security_invoker = true) as
select *
from (
  select
    e.id,
    e.employee_code,
    e.full_name,
    nullif(btrim(e.nss), '') is not null as has_nss,
    nullif(btrim(e.curp), '') is not null as has_curp,
    nullif(btrim(e.rfc), '') is not null as has_rfc,
    nullif(btrim(e.bank_account), '') is not null as has_bank_account,
    coalesce(e.salary, 0) > 0 as has_salary,
    nullif(btrim(e.email), '') is not null as has_email,
    nullif(btrim(e.phone), '') is not null as has_phone
  from public.employees e
  where e.active = true
) g
where not (g.has_nss and g.has_curp and g.has_rfc and g.has_bank_account and g.has_salary and g.has_email and g.has_phone);

revoke all on public.employee_gaps from public, anon;
grant select on public.employee_gaps to authenticated;

notify pgrst, 'reload schema';
