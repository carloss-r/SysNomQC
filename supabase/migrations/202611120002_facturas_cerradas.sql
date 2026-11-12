-- Facturas cerradas: una factura "pagada" o con "incidente" queda cerrada para siempre.
-- Ya no se puede cambiar su estatus, corregir sus datos ni eliminarla (ni su PDF).
-- Ejecutar DESPUÉS de 202611120001_facturas_incidente.sql. Es seguro repetirla.

create or replace function public.invoices_lock_closed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('pagada', 'incidente') then
    raise exception 'La factura está cerrada (%) y ya no se puede modificar ni eliminar.', old.status
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_lock_closed on public.invoices;
create trigger invoices_lock_closed
before update or delete on public.invoices
for each row execute function public.invoices_lock_closed();

-- El PDF de una factura cerrada tampoco se puede borrar del almacenamiento.
drop policy if exists "invoices_files_delete" on storage.objects;
create policy "invoices_files_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'invoices'
  and public.has_app_permission('invoices.manage')
  and not exists (
    select 1 from public.invoices i
    where i.file_path = storage.objects.name and i.status in ('pagada', 'incidente')
  )
);
