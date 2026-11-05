-- Seguridad en la base de datos (defensa en profundidad).
-- La API de Next.js ya valida permisos, pero cualquier cuenta autenticada podría llamar a la API REST
-- de Supabase directamente con su propio token. Estas políticas hacen que la BASE también exija el
-- permiso del rol. Requiere, en orden: 202611030001, 202611040002 (roles/permisos). Idempotente.

-- ---------------------------------------------------------------------------
-- 1. ¿La cuenta actual tiene este permiso? (según su rol en public.roles)
-- ---------------------------------------------------------------------------
create or replace function public.has_app_permission(permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.authorized_users au
    join public.roles r on r.id_rol = au.role_id
    where au.user_id = auth.uid()
      and au.active = true
      and (r.es_sistema = true or permission = any (r.permisos))
  );
$$;

revoke all on function public.has_app_permission(text) from public, anon;
grant execute on function public.has_app_permission(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Empleados: una política por operación, cada una con su permiso
-- ---------------------------------------------------------------------------
alter table public.employees enable row level security;

drop policy if exists "Authenticated users can read employees" on public.employees;
drop policy if exists "Authenticated users can create employees" on public.employees;
drop policy if exists "Authenticated users can update employees" on public.employees;
drop policy if exists "Authenticated users can delete employees" on public.employees;
drop policy if exists "employees_select" on public.employees;
drop policy if exists "employees_insert" on public.employees;
drop policy if exists "employees_update" on public.employees;
drop policy if exists "employees_delete" on public.employees;

create policy "employees_select" on public.employees for select to authenticated
using (public.has_app_permission('employees.view'));

create policy "employees_insert" on public.employees for insert to authenticated
with check (public.has_app_permission('employees.create'));

create policy "employees_update" on public.employees for update to authenticated
using (public.has_app_permission('employees.edit'))
with check (public.has_app_permission('employees.edit'));

create policy "employees_delete" on public.employees for delete to authenticated
using (public.has_app_permission('employees.delete'));

-- ---------------------------------------------------------------------------
-- 3. Fotos (bucket privado employee-photos)
-- ---------------------------------------------------------------------------
drop policy if exists "Authenticated users can view employee photos" on storage.objects;
drop policy if exists "Authenticated users can upload employee photos" on storage.objects;
drop policy if exists "Authenticated users can update employee photos" on storage.objects;
drop policy if exists "Authenticated users can delete employee photos" on storage.objects;
drop policy if exists "employee_photos_select" on storage.objects;
drop policy if exists "employee_photos_insert" on storage.objects;
drop policy if exists "employee_photos_update" on storage.objects;
drop policy if exists "employee_photos_delete" on storage.objects;

create policy "employee_photos_select" on storage.objects for select to authenticated
using (bucket_id = 'employee-photos' and public.has_app_permission('employees.view'));

create policy "employee_photos_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-photos'
  and (public.has_app_permission('employees.create') or public.has_app_permission('employees.edit'))
);

create policy "employee_photos_update" on storage.objects for update to authenticated
using (bucket_id = 'employee-photos' and public.has_app_permission('employees.edit'))
with check (bucket_id = 'employee-photos' and public.has_app_permission('employees.edit'));

-- Borrar: al reemplazar/quitar una foto, al eliminar al empleado o al descartar una subida fallida.
create policy "employee_photos_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-photos'
  and (
    public.has_app_permission('employees.create')
    or public.has_app_permission('employees.edit')
    or public.has_app_permission('employees.delete')
  )
);

-- ---------------------------------------------------------------------------
-- 4. Bitácora de auditoría: solo la escribe/lee el servidor (service_role), nunca el navegador
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  email text,
  action text not null,
  target text,
  ip text,
  user_agent text,
  meta jsonb not null default '{}'
);

create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cierra todas las demás tablas de public que no tengan RLS
--    (catálogos, empleados, usuarios con password_hash, EPP, ...). La app actual no las usa;
--    al activar RLS sin políticas, anon y authenticated no pueden leer ni escribir en ellas.
--    Cuando las uses, agrega sus políticas (con has_app_permission) en la migración de ese módulo.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('revoke all on public.%I from public, anon, authenticated', t.relname);
  end loop;
end;
$$;

-- anon nunca debe tener acceso a nada de public (la app siempre entra con sesión).
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end;
$$;
