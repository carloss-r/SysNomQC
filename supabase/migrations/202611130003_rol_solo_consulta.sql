-- Roles de solo consulta. Ejecutar DESPUÉS de 202611130002_empleados_salarios_y_baja.sql. Es seguro repetirla.
--
-- Un rol marcado como solo_consulta únicamente puede tener permisos de ver (y descargar expedientes).
-- Al crearlo se elige qué áreas ve: empleados, EPP, combustibles alternos y/o facturas.
-- La base rechaza cualquier permiso que modifique datos en un rol de solo consulta.

alter table public.roles add column if not exists solo_consulta boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'roles_solo_consulta_check') then
    alter table public.roles add constraint roles_solo_consulta_check check (
      not solo_consulta
      or (
        coalesce(es_sistema, false) = false
        and permisos <@ array['employees.view', 'employees.download', 'epp.view', 'fuels.view', 'invoices.view']::text[]
      )
    );
  end if;
end;
$$;

comment on column public.roles.solo_consulta is 'Rol que solo visualiza: sus permisos se limitan a ver las áreas elegidas.';

-- Rol listo para usar: ve todas las áreas. Se pueden crear otros de solo consulta con menos áreas.
insert into public.roles (nombre, descripcion, permisos, solo_consulta)
values ('Solo consulta', 'Solo visualiza; no puede crear, editar ni eliminar nada',
        array['employees.view', 'epp.view', 'fuels.view', 'invoices.view'], true)
on conflict (nombre) do nothing;
