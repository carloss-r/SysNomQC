-- Campo "Asignación" del expediente. Ejecutar DESPUÉS de 202611130004_empleados_observaciones.sql. Es seguro repetirla.
-- Texto libre y opcional; los trabajadores actuales quedan en null (vacío).

alter table public.employees add column if not exists assignment text;

alter table public.employees drop constraint if exists employees_assignment_check;
alter table public.employees add constraint employees_assignment_check
  check (assignment is null or char_length(assignment) <= 150);

comment on column public.employees.assignment is 'Asignación del trabajador (texto libre, opcional).';
