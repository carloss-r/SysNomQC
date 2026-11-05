-- Permiso para ver los avisos de inventario de EPP en /notificaciones. Idempotente.
-- SuperAdmin ya lo tiene por ser rol de sistema; a otros roles se les activa desde /admin.
update public.roles
set permisos = array_append(permisos, 'inventory.view')
where nombre = 'AlmacenistaEPP'
  and not ('inventory.view' = any (permisos));
