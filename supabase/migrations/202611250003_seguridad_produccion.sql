-- Seguridad para producción (dominio propio). Ejecutar DESPUÉS de 202611250002_facturas_cierre_y_roles.sql.
-- Es seguro repetirla.
--
--   1. La vista antigua vw_empleados_resumen no respetaba RLS y el rol "anon" (cualquiera con la llave
--      pública de la página, SIN iniciar sesión) tenía todos los permisos sobre ella. Ahora respeta RLS y
--      nadie la puede leer desde la página (la app no la usa).
--   2. El rol "anon" pierde todo acceso a tablas, vistas, secuencias y funciones de "public". La app nunca
--      lee datos sin sesión: el inicio de sesión pasa por el servidor. Lo que se cree después tampoco se le
--      da a "anon" automáticamente.
--   3. Bloqueo de intentos de inicio de sesión: 5 fallos seguidos con el mismo usuario o 30 desde la misma
--      IP en 15 minutos bloquean por 15 minutos. Solo el servidor (service_role) usa estas tablas.

-- ---------------------------------------------------------------------------
-- 1. Vista antigua
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'vw_empleados_resumen' and c.relkind = 'v') then
    execute 'alter view public.vw_empleados_resumen set (security_invoker = true)';
    execute 'revoke all on public.vw_empleados_resumen from public, anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sin acceso para "anon"
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Funciones: quien tenía acceso por el permiso general (PUBLIC) siendo usuario con sesión lo conserva de
-- forma explícita; "anon" y PUBLIC lo pierden.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    begin
      if has_function_privilege('authenticated', f.sig, 'execute') then
        execute format('grant execute on function %s to authenticated', f.sig);
      end if;
      execute format('revoke execute on function %s from public, anon', f.sig);
    exception when insufficient_privilege then
      -- Función de otro dueño (p. ej. de Supabase): se deja como está.
      raise notice 'Sin permiso para ajustar %', f.sig;
    end;
  end loop;
end $$;

-- Lo que se cree después en "public" no se le da a "anon" (ni funciones a PUBLIC).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

-- ---------------------------------------------------------------------------
-- 3. Intentos de inicio de sesión
-- ---------------------------------------------------------------------------
create table if not exists public.auth_login_attempts (
  id bigint generated always as identity primary key,
  -- SHA-256 del usuario o correo escrito (en minúsculas): no se guarda el dato en claro.
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  ip text not null check (char_length(ip) <= 64),
  success boolean not null,
  at timestamptz not null default now()
);
create index if not exists auth_login_attempts_identifier_idx on public.auth_login_attempts (identifier_hash, at desc);
create index if not exists auth_login_attempts_ip_idx on public.auth_login_attempts (ip, at desc);
create index if not exists auth_login_attempts_at_idx on public.auth_login_attempts (at);

alter table public.auth_login_attempts enable row level security;
revoke all on public.auth_login_attempts from public, anon, authenticated;
grant select, insert, delete on public.auth_login_attempts to service_role;

-- Segundos que faltan para poder intentar de nuevo (0 = puede intentar).
create or replace function public.auth_login_wait(p_identifier_hash text, p_ip text)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  v_window interval := interval '15 minutes';
  v_last_ok timestamptz;
  v_user_fails int;
  v_user_last timestamptz;
  v_ip_fails int;
  v_ip_last timestamptz;
  v_wait numeric := 0;
begin
  select max(a.at) into v_last_ok from public.auth_login_attempts a
  where a.identifier_hash = p_identifier_hash and a.success;

  select count(*), max(a.at) into v_user_fails, v_user_last from public.auth_login_attempts a
  where a.identifier_hash = p_identifier_hash and not a.success
    and a.at > now() - v_window and (v_last_ok is null or a.at > v_last_ok);

  select count(*), max(a.at) into v_ip_fails, v_ip_last from public.auth_login_attempts a
  where a.ip = p_ip and not a.success and a.at > now() - v_window;

  if v_user_fails >= 5 then
    v_wait := greatest(v_wait, extract(epoch from (v_user_last + v_window - now())));
  end if;
  if v_ip_fails >= 30 then
    v_wait := greatest(v_wait, extract(epoch from (v_ip_last + v_window - now())));
  end if;
  return greatest(0, ceil(v_wait))::int;
end;
$$;

create or replace function public.auth_login_record(p_identifier_hash text, p_ip text, p_success boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.auth_login_attempts (identifier_hash, ip, success) values (p_identifier_hash, left(p_ip, 64), p_success);
  -- Se conserva 30 días (sirve como bitácora de accesos).
  delete from public.auth_login_attempts where at < now() - interval '30 days';
end;
$$;

revoke all on function public.auth_login_wait(text, text) from public, anon, authenticated;
revoke all on function public.auth_login_record(text, text, boolean) from public, anon, authenticated;
grant execute on function public.auth_login_wait(text, text) to service_role;
grant execute on function public.auth_login_record(text, text, boolean) to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4. Hook de Supabase Auth: bloqueo por contraseña fallida aunque se llame a Supabase directo
--    (la llave pública es visible en la página). 5 fallos de la misma cuenta en 15 minutos la bloquean
--    15 minutos, incluso si después escriben la contraseña correcta.
--    SE ACTIVA EN EL PANEL: Authentication → Hooks → "Password verification attempt" →
--    tipo Postgres → función public.hook_password_verification_attempt.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_password_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists auth_password_failures_user_idx on public.auth_password_failures (user_id, at desc);
alter table public.auth_password_failures enable row level security;
revoke all on public.auth_password_failures from public, anon, authenticated;

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_fails int;
  v_last timestamptz;
begin
  select count(*), max(f.at) into v_fails, v_last
  from public.auth_password_failures f
  where f.user_id = v_user and f.at > now() - interval '15 minutes';

  if v_fails >= 5 then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.',
      'should_logout_user', false
    );
  end if;

  if (event ->> 'valid')::boolean then
    delete from public.auth_password_failures where user_id = v_user;
  else
    insert into public.auth_password_failures (user_id) values (v_user);
    delete from public.auth_password_failures where at < now() - interval '1 day';
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin';
    execute 'grant select, insert, delete on public.auth_password_failures to supabase_auth_admin';
    execute 'grant usage, select on sequence public.auth_password_failures_id_seq to supabase_auth_admin';
  end if;
end $$;

-- El hook usa la tabla con el rol de Auth (que no tiene RLS de la app): política solo para ese rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'drop policy if exists "auth_password_failures_hook" on public.auth_password_failures';
    execute 'create policy "auth_password_failures_hook" on public.auth_password_failures for all to supabase_auth_admin using (true) with check (true)';
  end if;
end $$;

notify pgrst, 'reload schema';
