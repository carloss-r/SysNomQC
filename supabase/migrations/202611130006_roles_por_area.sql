-- Separación de permisos por área. Ejecutar DESPUÉS de 202611130005_empleados_asignacion.sql. Es seguro repetirla.
--
-- Cada rol ve y opera solo su pantalla. Antes, "Almacenista de EPP" (hoy "Seguridad") tenía employees.view
-- desde 202611040002, y por eso una cuenta con solo ese rol veía Empleados (Recursos humanos).
-- Una cuenta con varios roles sigue teniendo la suma de los permisos de todos sus roles.
--
-- No se tocan: "Super administrador" (rol de sistema, ve todo) ni los roles de solo consulta.

-- Por si esta migración corre antes del cambio de nombre de 202611130001.
update public.roles set nombre = 'Seguridad'
where nombre = 'Almacenista de EPP' and not exists (select 1 from public.roles where nombre = 'Seguridad');

update public.roles r
set permisos = v.permisos
from (values
  -- Personal
  ('Administrador de sede',        array['employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'employees.download']),
  ('Recursos humanos',             array['employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'employees.download']),
  -- Seguridad e higiene (EPP)
  ('Seguridad',                    array['epp.view', 'epp.deliver', 'epp.manage', 'epp.request']),
  ('Almacenista de EPP',           array['epp.view', 'epp.deliver', 'epp.manage', 'epp.request']),
  ('Encargado de compras',         array['epp.view', 'epp.purchase']),
  -- Ecología (combustibles alternos)
  ('Combustibles alternos',        array['fuels.view', 'fuels.suppliers', 'fuels.schedule']),
  ('Operador de báscula',          array['fuels.view', 'fuels.scale']),
  ('Ecología',                     array['fuels.view', 'fuels.ecology']),
  ('Contabilidad de combustibles', array['fuels.view', 'fuels.commercial']),
  -- Finanzas
  ('Cuentas por pagar',            array['invoices.view', 'invoices.manage'])
) as v(nombre, permisos)
where r.nombre = v.nombre
  and coalesce(r.es_sistema, false) = false
  and not coalesce(r.solo_consulta, false);
