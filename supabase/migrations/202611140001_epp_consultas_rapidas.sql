-- EPP: consultas rápidas.
--
-- Antes, la pantalla de EPP descargaba el libro completo de movimientos de la sede (hasta 20 000 filas,
-- en tandas de 1000) solo para mostrar el inventario. Ahora cada pestaña pide lo que muestra:
--   * epp_month_summary: totales por sede y mes (tarjetas, lista de meses).
--   * epp_people: trabajadores con entregas, ya agrupados (búsqueda de "Por trabajador").
--   * employee_key: nombre normalizado para filtrar las entregas de un trabajador con índice.
-- Además, las políticas de lectura evalúan el permiso y la sede una sola vez por consulta
-- (antes se llamaba a has_app_permission/can_access_site por cada fila).
--
-- Es seguro ejecutarla más de una vez. Requiere las migraciones de EPP anteriores.

-- ---------------------------------------------------------------------------
-- 1. Sede visible para la cuenta actual: '*' = todas, el nombre de su sede, o null si no está autorizada.
--    Misma regla que can_access_site (sin sede o con un rol de sistema: todas).
-- ---------------------------------------------------------------------------
create or replace function public.current_site_scope()
returns text language sql stable security definer set search_path = public as $$
  select case
    when au.site is null then '*'
    when exists (
      select 1 from public.roles r
      where r.es_sistema = true
        and (r.id_rol = au.role_id
             or r.id_rol in (select ur.role_id from public.authorized_user_roles ur where ur.user_id = au.user_id))
    ) then '*'
    else au.site
  end
  from public.authorized_users au
  where au.user_id = auth.uid() and au.active = true
  limit 1;
$$;
revoke all on function public.current_site_scope() from public, anon;
grant execute on function public.current_site_scope() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Políticas de lectura con (select …): Postgres las calcula una vez por consulta, no por fila.
--    Mismas reglas que antes.
-- ---------------------------------------------------------------------------
drop policy if exists "epp_movements_select" on public.epp_movements;
create policy "epp_movements_select" on public.epp_movements for select to authenticated
using (
  (select public.has_app_permission('epp.view'))
  and (site is null or (select public.current_site_scope()) = '*' or site = (select public.current_site_scope()))
);

drop policy if exists "epp_stock_select" on public.epp_stock;
create policy "epp_stock_select" on public.epp_stock for select to authenticated
using (
  (select public.has_app_permission('epp.view'))
  and ((select public.current_site_scope()) = '*' or site = (select public.current_site_scope()))
);

drop policy if exists "epp_articles_select" on public.epp_articles;
create policy "epp_articles_select" on public.epp_articles for select to authenticated
using (
  ((select public.has_app_permission('epp.view')) or (select public.has_app_permission('epp.purchase')))
  and ((select public.current_site_scope()) = '*' or site = (select public.current_site_scope()))
);

-- ---------------------------------------------------------------------------
-- 3. Nombre normalizado del trabajador (sin acentos, mayúsculas) para agrupar y filtrar con índice.
--    Mismo criterio que epp_norm(); las entregas importadas de Excel no tienen employee_id.
-- ---------------------------------------------------------------------------
alter table public.epp_movements
  add column if not exists employee_key text generated always as (public.epp_norm(employee_name)) stored;

create index if not exists epp_movements_site_kind_idx on public.epp_movements (site, kind, moved_on desc, id desc);
create index if not exists epp_movements_site_worker_idx on public.epp_movements (site, employee_key, moved_on desc)
  where kind = 'entrega';
create index if not exists epp_movements_site_order_idx on public.epp_movements (site, moved_on desc, id desc);

-- ---------------------------------------------------------------------------
-- 4. Vistas de resumen. security_invoker: respetan las políticas RLS de quien consulta.
-- ---------------------------------------------------------------------------
create or replace view public.epp_month_summary with (security_invoker = true) as
select
  m.site,
  to_char(m.moved_on, 'YYYY-MM') as month,
  coalesce(sum(-m.delta) filter (where m.kind = 'entrega'), 0)::int as delivered,
  coalesce(sum(m.delta) filter (where m.kind = 'ingreso'), 0)::int as received,
  count(distinct m.employee_key) filter (where m.kind = 'entrega' and m.employee_name is not null)::int as workers,
  count(*)::int as movements
from public.epp_movements m
where m.site is not null
group by m.site, to_char(m.moved_on, 'YYYY-MM');

create or replace view public.epp_people with (security_invoker = true) as
select
  m.site,
  m.employee_key,
  min(m.employee_name) as name,
  (array_agg(m.employee_id order by m.moved_on desc) filter (where m.employee_id is not null))[1] as employee_id,
  (array_agg(m.employee_group order by m.moved_on desc) filter (where m.employee_group is not null))[1] as employee_group,
  (array_agg(m.employee_position order by m.moved_on desc) filter (where m.employee_position is not null))[1] as employee_position,
  sum(abs(m.delta))::int as pieces,
  count(*)::int as deliveries,
  max(m.moved_on) as last_date
from public.epp_movements m
where m.kind = 'entrega' and m.employee_name is not null and m.site is not null
group by m.site, m.employee_key;

revoke all on public.epp_month_summary, public.epp_people from public, anon;
grant select on public.epp_month_summary, public.epp_people to authenticated;

notify pgrst, 'reload schema';
