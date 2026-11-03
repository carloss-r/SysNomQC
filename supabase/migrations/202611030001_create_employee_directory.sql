create extension if not exists pgcrypto;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  site text not null check (site in ('Campeche', 'Lagunas', 'Cruz Azul')),
  hire_date date not null,
  position text not null,
  contract_type text not null,
  salary numeric(12, 2) not null default 0 check (salary >= 0),
  bank_account text,
  active boolean not null default true,
  gender text,
  nss text unique,
  curp text unique,
  rfc text unique,
  marital_status text,
  birth_date date,
  credits text[] not null default '{}',
  email text,
  phone text,
  residence_state text,
  address text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_site_idx on public.employees (site);
create index if not exists employees_full_name_idx on public.employees (full_name);

create table if not exists public.authorized_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.authorized_users enable row level security;
revoke all on public.authorized_users from public, anon, authenticated;

drop policy if exists "Users can read their own authorization" on public.authorized_users;
create policy "Users can read their own authorization"
on public.authorized_users for select to authenticated
using (user_id = auth.uid());

grant select on public.authorized_users to authenticated;

create or replace function public.is_employee_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.authorized_users
    where user_id = auth.uid()
      and active = true
  );
$$;

revoke all on function public.is_employee_app_user() from public;
grant execute on function public.is_employee_app_user() to authenticated;

create or replace function public.set_employee_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employees_updated_at on public.employees;
create trigger employees_updated_at
before update on public.employees
for each row execute function public.set_employee_updated_at();

alter table public.employees enable row level security;
revoke all on public.employees from public, anon, authenticated;

drop policy if exists "Authenticated users can read employees" on public.employees;
create policy "Authenticated users can read employees"
on public.employees for select to authenticated
using (public.is_employee_app_user());

drop policy if exists "Authenticated users can create employees" on public.employees;
create policy "Authenticated users can create employees"
on public.employees for insert to authenticated
with check (public.is_employee_app_user());

drop policy if exists "Authenticated users can update employees" on public.employees;
create policy "Authenticated users can update employees"
on public.employees for update to authenticated
using (public.is_employee_app_user())
with check (public.is_employee_app_user());

drop policy if exists "Authenticated users can delete employees" on public.employees;
create policy "Authenticated users can delete employees"
on public.employees for delete to authenticated
using (public.is_employee_app_user());

grant select, insert, update, delete on public.employees to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-photos',
  'employee-photos',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can view employee photos" on storage.objects;
create policy "Authenticated users can view employee photos"
on storage.objects for select to authenticated
using (bucket_id = 'employee-photos' and public.is_employee_app_user());

drop policy if exists "Authenticated users can upload employee photos" on storage.objects;
create policy "Authenticated users can upload employee photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'employee-photos' and public.is_employee_app_user());

drop policy if exists "Authenticated users can update employee photos" on storage.objects;
create policy "Authenticated users can update employee photos"
on storage.objects for update to authenticated
using (bucket_id = 'employee-photos' and public.is_employee_app_user())
with check (bucket_id = 'employee-photos' and public.is_employee_app_user());

drop policy if exists "Authenticated users can delete employee photos" on storage.objects;
create policy "Authenticated users can delete employee photos"
on storage.objects for delete to authenticated
using (bucket_id = 'employee-photos' and public.is_employee_app_user());
