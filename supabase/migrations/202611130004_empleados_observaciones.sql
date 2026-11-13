-- Observaciones del expediente. Ejecutar DESPUÉS de 202611130003_rol_solo_consulta.sql. Es seguro repetirla.
--
-- Texto libre por trabajador: lo que le falta al expediente o cualquier detalle a dar seguimiento.
-- Los trabajadores con observaciones se listan en la pestaña "Seguimiento de expedientes" de Recursos humanos.
-- Quién y cuándo escribió la última observación lo sella la base.

alter table public.employees add column if not exists observations text;
alter table public.employees add column if not exists observations_updated_at timestamptz;
alter table public.employees add column if not exists observations_updated_by_name text;

alter table public.employees drop constraint if exists employees_observations_check;
alter table public.employees add constraint employees_observations_check
  check (observations is null or char_length(observations) <= 1000);

comment on column public.employees.observations is 'Observaciones del expediente (faltantes o detalles a dar seguimiento).';

create or replace function public.employees_observations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.observations := nullif(btrim(new.observations), '');
  if tg_op = 'INSERT' or new.observations is distinct from old.observations then
    if new.observations is null then
      new.observations_updated_at := null;
      new.observations_updated_by_name := null;
    else
      new.observations_updated_at := now();
      new.observations_updated_by_name := public.epp_actor_name();
    end if;
  else
    new.observations_updated_at := old.observations_updated_at;
    new.observations_updated_by_name := old.observations_updated_by_name;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_observations_guard on public.employees;
create trigger employees_observations_guard
before insert or update on public.employees
for each row execute function public.employees_observations_guard();

create index if not exists employees_observations_idx on public.employees (observations_updated_at desc) where observations is not null;
