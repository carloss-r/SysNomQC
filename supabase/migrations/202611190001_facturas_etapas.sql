-- Facturas: estado del documento (Enviada → Firmada → Cargada), aparte del estatus de pago.
-- Ejecutar DESPUÉS de 202611120003_facturas_borrado_superadmin.sql. Es seguro repetirla.
--
-- Toda factura nace "enviada". Avanza solo hacia adelante: enviada → firmada → cargada.
-- "cargada" bloquea por completo la factura: ya no se cambia su estado, su estatus de pago ni sus datos.
-- (Igual que las facturas cerradas, solo el Super administrador puede eliminarla.)
-- El estado del documento sí puede avanzar aunque la factura ya esté pagada o con incidente.

alter table public.invoices add column if not exists stage text not null default 'enviada';
alter table public.invoices add column if not exists signed_at timestamptz;
alter table public.invoices add column if not exists signed_by_name text;
alter table public.invoices add column if not exists loaded_at timestamptz;
alter table public.invoices add column if not exists loaded_by_name text;

alter table public.invoices drop constraint if exists invoices_stage_check;
alter table public.invoices add constraint invoices_stage_check check (stage in ('enviada', 'firmada', 'cargada'));

-- Cada etapa alcanzada guarda cuándo se marcó.
alter table public.invoices drop constraint if exists invoices_stage_consistent;
alter table public.invoices add constraint invoices_stage_consistent check (
  (stage = 'enviada' or signed_at is not null)
  and (stage = 'cargada') = (loaded_at is not null)
);
create index if not exists invoices_stage_idx on public.invoices (stage);

-- Al cargarla siempre nace enviada.
drop policy if exists "invoices_insert" on public.invoices;
create policy "invoices_insert" on public.invoices for insert to authenticated
with check (
  public.has_app_permission('invoices.manage')
  and status = 'pendiente' and paid_on is null
  and stage = 'enviada' and signed_at is null and loaded_at is null
);

grant update (stage, signed_at, signed_by_name, loaded_at, loaded_by_name) on public.invoices to authenticated;

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

  if old.status in ('pagada', 'incidente') then
    if tg_op = 'DELETE' and public.is_super_admin() then
      return old;
    end if;
    -- Pagada o con incidente: solo puede avanzar su estado del documento.
    if tg_op = 'UPDATE' and (to_jsonb(new) - stage_cols) = (to_jsonb(old) - stage_cols) then
      return new;
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

-- El PDF de una factura cerrada (pagada, con incidente o cargada) solo lo borra el Super administrador.
drop policy if exists "invoices_files_delete" on storage.objects;
create policy "invoices_files_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'invoices'
  and public.has_app_permission('invoices.manage')
  and (
    public.is_super_admin()
    or not exists (
      select 1 from public.invoices i
      where i.file_path = storage.objects.name and (i.status in ('pagada', 'incidente') or i.stage = 'cargada')
    )
  )
);
