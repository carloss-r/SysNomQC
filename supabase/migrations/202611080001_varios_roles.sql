-- Varios roles por usuario. Ejecutar DESPUÉS de 202611070001_epp_por_sede.sql. Es seguro repetirla.
-- Los permisos de una cuenta son la suma de los de todos sus roles. authorized_users.role_id se
-- conserva como rol principal (el primero de la lista), así lo anterior sigue funcionando.

create table if not exists public.authorized_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id integer not null references public.roles(id_rol) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index if not exists authorized_user_roles_role_idx on public.authorized_user_roles (role_id);

-- Cada cuenta conserva el rol que ya tenía.
insert into public.authorized_user_roles (user_id, role_id)
select au.user_id, au.role_id
from public.authorized_users au
where au.user_id is not null and au.role_id is not null
on conflict do nothing;

-- Cada cuenta puede leer sus propios roles (la app los consulta con la sesión); los cambios, solo el servidor.
alter table public.authorized_user_roles enable row level security;
drop policy if exists "authorized_user_roles_select_own" on public.authorized_user_roles;
create policy "authorized_user_roles_select_own" on public.authorized_user_roles for select to authenticated
using (user_id = auth.uid());
revoke all on public.authorized_user_roles from public, anon, authenticated;
grant select on public.authorized_user_roles to authenticated;

-- Permiso = cualquiera de los roles de la cuenta (el principal o los de la tabla nueva).
create or replace function public.has_app_permission(permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.authorized_users au
    join public.roles r
      on r.id_rol = au.role_id
      or r.id_rol in (select ur.role_id from public.authorized_user_roles ur where ur.user_id = au.user_id)
    where au.user_id = auth.uid()
      and au.active = true
      and (r.es_sistema = true or permission = any (r.permisos))
  );
$$;
revoke all on function public.has_app_permission(text) from public, anon;
grant execute on function public.has_app_permission(text) to authenticated;

-- Sede: cuentas sin sede o con algún rol de sistema (SuperAdmin) ven todas.
create or replace function public.can_access_site(p_site text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.authorized_users au
    where au.user_id = auth.uid()
      and au.active = true
      and (
        au.site is null
        or au.site = p_site
        or exists (
          select 1 from public.roles r
          where r.es_sistema = true
            and (r.id_rol = au.role_id
                 or r.id_rol in (select ur.role_id from public.authorized_user_roles ur where ur.user_id = au.user_id))
        )
      )
  );
$$;
revoke all on function public.can_access_site(text) from public, anon;
grant execute on function public.can_access_site(text) to authenticated;
