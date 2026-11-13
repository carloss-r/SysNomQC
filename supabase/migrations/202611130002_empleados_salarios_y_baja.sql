-- Dos salarios por trabajador y registro de baja. Ejecutar DESPUÉS de 202611130001_compras_conteo_ciego.sql. Es seguro repetirla.
--
-- * Salario base: es la columna "salary" que ya existía; los trabajadores conservan ahí su salario.
-- * Salario de cotización: columna nueva "contribution_salary", vacía para todos.
-- * Baja: fecha de baja (la captura el usuario), motivo opcional, y fecha de registro en el sistema
--   (la pone la base con now(); nadie la puede escribir). Una baja deja al trabajador inactivo.

comment on column public.employees.salary is 'Salario base (MXN).';

alter table public.employees add column if not exists contribution_salary numeric(12, 2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_contribution_salary_check') then
    alter table public.employees
      add constraint employees_contribution_salary_check check (contribution_salary is null or contribution_salary >= 0);
  end if;
end;
$$;
comment on column public.employees.contribution_salary is 'Salario de cotización (MXN). Vacío hasta que se capture.';

alter table public.employees add column if not exists termination_date date;
alter table public.employees add column if not exists termination_reason text;
alter table public.employees add column if not exists terminated_at timestamptz;
alter table public.employees add column if not exists terminated_by_name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_termination_reason_check') then
    alter table public.employees
      add constraint employees_termination_reason_check check (termination_reason is null or char_length(termination_reason) <= 500);
  end if;
end;
$$;
comment on column public.employees.termination_date is 'Día de baja capturado por el usuario.';
comment on column public.employees.terminated_at is 'Fecha y hora en que la baja se registró en el sistema (la pone la base).';

-- La fecha de registro de la baja la sella la base: no se acepta la del navegador ni se puede editar.
create or replace function public.employees_termination_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.termination_date is null then
    new.termination_reason := null;
    new.terminated_at := null;
    new.terminated_by_name := null;
  else
    new.active := false;
    new.termination_reason := nullif(btrim(new.termination_reason), '');
    if tg_op = 'INSERT' or old.termination_date is null then
      new.terminated_at := now();
      new.terminated_by_name := public.epp_actor_name();
    else
      new.terminated_at := old.terminated_at;
      new.terminated_by_name := old.terminated_by_name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_termination_guard on public.employees;
create trigger employees_termination_guard
before insert or update on public.employees
for each row execute function public.employees_termination_guard();

create index if not exists employees_termination_date_idx on public.employees (termination_date) where termination_date is not null;
