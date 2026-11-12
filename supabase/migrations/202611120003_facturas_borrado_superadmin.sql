-- Facturas cerradas: solo el Super administrador puede eliminarlas (con su PDF).
-- Nadie, ni el Super administrador, puede modificarlas.
-- Ejecutar DESPUÉS de 202611120002_facturas_cerradas.sql. Es seguro repetirla.

-- ¿La cuenta que hace la consulta tiene un rol de sistema (Super administrador)?
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.authorized_users au
    join public.roles r
      on r.id_rol = au.role_id
      or r.id_rol in (select ur.role_id from public.authorized_user_roles ur where ur.user_id = au.user_id)
    where au.user_id = auth.uid()
      and au.active = true
      and r.es_sistema = true
  );
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.invoices_lock_closed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('pagada', 'incidente') then
    if tg_op = 'DELETE' and public.is_super_admin() then
      return old;
    end if;
    raise exception 'La factura está cerrada (%) y ya no se puede %.', old.status,
      case when tg_op = 'DELETE' then 'eliminar (solo el Super administrador puede hacerlo)' else 'modificar' end
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop policy if exists "invoices_files_delete" on storage.objects;
create policy "invoices_files_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'invoices'
  and public.has_app_permission('invoices.manage')
  and (
    public.is_super_admin()
    or not exists (
      select 1 from public.invoices i
      where i.file_path = storage.objects.name and i.status in ('pagada', 'incidente')
    )
  )
);
