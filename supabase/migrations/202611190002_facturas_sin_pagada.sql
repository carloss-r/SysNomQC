-- Facturas: se elimina el estatus "pagada". Quedan "pendiente" e "incidente".
-- Ejecutar DESPUÉS de 202611190001_facturas_etapas.sql. Es seguro repetirla.
--
-- Las facturas que ya estaban pagadas regresan a "pendiente" y se borran su fecha de pago y quién la marcó.
-- (No se puede deshacer.) Las columnas paid_on y paid_by_name se conservan vacías y ya no se pueden escribir.

-- El trigger de bloqueo impide tocar facturas cerradas: se desactiva solo durante la corrección.
alter table public.invoices disable trigger invoices_lock_closed;
update public.invoices set status = 'pendiente', paid_on = null, paid_by_name = null where status = 'pagada';
alter table public.invoices enable trigger invoices_lock_closed;

alter table public.invoices drop constraint if exists invoices_paid_consistent;
alter table public.invoices drop constraint if exists invoices_no_paid;
alter table public.invoices add constraint invoices_no_paid check (paid_on is null and paid_by_name is null);

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check check (status in ('pendiente', 'incidente'));

revoke update (paid_on, paid_by_name) on public.invoices from authenticated;

-- Cerrada = con incidente o cargada.
create or replace function public.invoices_lock_closed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stage_cols text[] := array['stage', 'signed_at', 'signed_by_name', 'loaded_at', 'loaded_by_name', 'updated_at', 'updated_by_name'];
  stage_order text[] := array['enviada', 'firmada', 'cargada'];
begin
  -- Cargada: bloqueo total (solo el Super administrador puede eliminarla).
  if old.stage = 'cargada' then
    if tg_op = 'DELETE' and public.is_super_admin() then
      return old;
    end if;
    raise exception 'La factura está cerrada (cargada) y ya no se puede %.',
      case when tg_op = 'DELETE' then 'eliminar (solo el Super administrador puede hacerlo)' else 'modificar' end
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.stage is distinct from old.stage
     and coalesce(array_position(stage_order, new.stage), 0) <= array_position(stage_order, old.stage) then
    raise exception 'El estado de la factura solo avanza: enviada → firmada → cargada.' using errcode = '23514';
  end if;

  if old.status = 'incidente' then
    if tg_op = 'DELETE' and public.is_super_admin() then
      return old;
    end if;
    -- Con incidente: solo puede avanzar su estado del documento.
    if tg_op = 'UPDATE' and (to_jsonb(new) - stage_cols) = (to_jsonb(old) - stage_cols) then
      return new;
    end if;
    raise exception 'La factura está cerrada (incidente) y ya no se puede %.',
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
      where i.file_path = storage.objects.name and (i.status = 'incidente' or i.stage = 'cargada')
    )
  )
);
