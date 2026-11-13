-- Roles de solo consulta. Ejecutar DESPUÉS de 202611130002_empleados_salarios_y_baja.sql. Es seguro repetirla.
--
-- Un rol marcado como solo_consulta únicamente puede ver Empleados y/o EPP.
-- Al crearlo se elige cuál de las dos áreas ve (o ambas).
-- La base rechaza cualquier permiso que modifique datos en un rol de solo consulta.

alter table public.roles add column if not exists solo_consulta boolean not null default false;

-- Se vuelve a crear siempre, para que repetir la migración aplique la lista vigente de áreas.
-- Un rol de solo consulta que tuviera otras áreas se queda solo con Empleados y EPP.
update public.roles
set permisos = array(select p from unnest(permisos) as p where p in ('employees.view', 'epp.view'))
where solo_consulta;
alter table public.roles drop constraint if exists roles_solo_consulta_check;
alter table public.roles add constraint roles_solo_consulta_check check (
  not solo_consulta
  or (
    coalesce(es_sistema, false) = false
    and permisos <@ array['employees.view', 'epp.view']::text[]
  )
);

comment on column public.roles.solo_consulta is 'Rol que solo visualiza: sus permisos se limitan a ver las áreas elegidas.';

-- Rol listo para usar: ve Empleados y EPP. Se pueden crear otros de solo consulta con una sola área.
insert into public.roles (nombre, descripcion, permisos, solo_consulta)
values ('Solo consulta', 'Solo visualiza; no puede crear, editar ni eliminar nada',
        array['employees.view', 'epp.view'], true)
on conflict (nombre) do nothing;
