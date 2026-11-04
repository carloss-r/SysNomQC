-- Roles y usuarios administrables desde la pantalla /admin.
-- Requiere 202611030001_create_employee_directory.sql (authorized_users, is_employee_app_user).
-- Idempotente.

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null unique,
  description text,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.authorized_users add column if not exists full_name text;
alter table public.authorized_users
  add column if not exists role_id uuid references public.app_roles (id) on delete restrict;

insert into public.app_roles (slug, name, description, permissions, is_system)
values
  ('super_admin', 'Super administrador', 'Acceso total, incluye usuarios y roles.',
   array['employees.view','employees.create','employees.edit','employees.delete','employees.download','users.manage'], true),
  ('rh', 'Recursos Humanos', 'Administra expedientes de personal.',
   array['employees.view','employees.create','employees.edit','employees.delete','employees.download'], false),
  ('consulta', 'Consulta', 'Solo consulta y descarga expedientes.',
   array['employees.view','employees.download'], false)
on conflict (slug) do nothing;

-- Las cuentas ya autorizadas antes de esta migración quedan como super administrador.
update public.authorized_users
set role_id = (select id from public.app_roles where slug = 'super_admin')
where role_id is null;

alter table public.app_roles enable row level security;
revoke all on public.app_roles from public, anon, authenticated;
grant select on public.app_roles to authenticated;

drop policy if exists "Authorized users can read roles" on public.app_roles;
create policy "Authorized users can read roles"
on public.app_roles for select to authenticated
using (public.is_employee_app_user());

-- Altas, cambios y bajas de roles/usuarios se hacen solo desde el servidor (service role).
