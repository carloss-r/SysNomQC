-- Nombres de rol legibles: "EncargadoCompras" -> "Encargado de compras", etc.
-- Ejecutar DESPUÉS de 202611100001_combustibles_alternos.sql. Es seguro repetirla.
--
-- La app no busca roles por nombre (el SuperAdmin se reconoce por roles.es_sistema y los permisos por
-- roles.permisos), así que renombrar no cambia ningún acceso. Si por repetir una migración anterior
-- existieran los dos nombres, las cuentas del nombre viejo pasan al nuevo y el viejo se elimina.

do $$
declare
  pair record;
  old_id integer;
  new_id integer;
begin
  for pair in
    select * from (values
      ('SuperAdmin', 'Super administrador'),
      ('AdminSede', 'Administrador de sede'),
      ('RecursosHumanos', 'Recursos humanos'),
      ('AlmacenistaEPP', 'Almacenista de EPP'),
      ('EncargadoCompras', 'Encargado de compras'),
      ('CombustiblesAlternos', 'Combustibles alternos'),
      ('OperadorBascula', 'Operador de báscula'),
      ('Ecologia', 'Ecología'),
      ('ContabilidadCombustibles', 'Contabilidad de combustibles')
    ) as t(old_name, new_name)
  loop
    select id_rol into old_id from public.roles where nombre = pair.old_name;
    if old_id is null then
      continue;
    end if;
    select id_rol into new_id from public.roles where nombre = pair.new_name;

    if new_id is null then
      update public.roles set nombre = pair.new_name where id_rol = old_id;
    else
      -- Ya existe el nombre nuevo: se conservan permisos de ambos y se mueven las cuentas.
      update public.roles r
      set permisos = array(select distinct unnest(coalesce(r.permisos, '{}') || coalesce(o.permisos, '{}'))),
          es_sistema = r.es_sistema or o.es_sistema
      from public.roles o
      where r.id_rol = new_id and o.id_rol = old_id;

      update public.authorized_users set role_id = new_id where role_id = old_id;
      if to_regclass('public.authorized_user_roles') is not null then
        insert into public.authorized_user_roles (user_id, role_id)
        select user_id, new_id from public.authorized_user_roles where role_id = old_id
        on conflict do nothing;
        delete from public.authorized_user_roles where role_id = old_id;
      end if;
      delete from public.roles where id_rol = old_id;
    end if;
  end loop;
end;
$$;
