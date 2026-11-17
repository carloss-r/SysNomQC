-- El ID de empleado (employee_code) no se puede cambiar una vez dado de alta.
-- Ejecutar DESPUÉS de 202611180001_mi_cuenta.sql. Es seguro repetirla.
--
-- La pantalla ya no deja editarlo y la API rechaza el campo al editar; este candado lo garantiza también
-- para cualquier acceso directo a la base (incluida la llave pública de Supabase con una sesión válida).

create or replace function public.employees_code_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.employee_code is distinct from old.employee_code then
    raise exception 'El ID de empleado no se puede cambiar.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_code_lock on public.employees;
create trigger employees_code_lock
before update of employee_code on public.employees
for each row execute function public.employees_code_lock();
