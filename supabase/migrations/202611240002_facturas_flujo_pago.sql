-- Facturas: flujo completo de pago, sin modificaciones.
-- Ejecutar DESPUÉS de 202611240001_empleados_areas_puestos_asignaciones.sql. Es seguro repetirla.
--
--   1. La factura se carga (PDF → texto → datos) y ASÍ SE QUEDA: ya no se corrige ningún dato.
--   2. Folio del sistema consecutivo (FAC-00001) que pone la base al cargarla. El folio que trae el PDF
--      se conserva aparte (pdf_folio).
--   3. Moneda siempre nacional (MXN). Ya no se captura emisor ni moneda.
--   4. Estado del documento (los tres cuadritos): enviada → firmada (autorizada) → cargada al sistema.
--   5. Ya cargada al sistema: contrarecibo (PDF) con la fecha posible de pago.
--   6. Con contrarecibo: complemento de pago (PDF). Se verifica contra el UUID de la factura y la
--      factura queda pagada y cerrada.
--   7. invoice_events: historial de cada paso (quién y cuándo). Lo escribe la base; nadie lo modifica y
--      se conserva aunque se elimine la factura.
--
-- Solo se puede eliminar una factura mientras está "enviada" (para volver a cargarla si se subió mal);
-- después solo el Super administrador.

-- El candado anterior se reemplaza por invoices_guard (más abajo).
drop trigger if exists invoices_lock_closed on public.invoices;

-- ---------------------------------------------------------------------------
-- 1. Folio del sistema (y el del PDF aparte)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'invoices' and column_name = 'pdf_folio') then
    alter table public.invoices rename column folio to pdf_folio;
  end if;
end $$;
alter table public.invoices add column if not exists folio text;

create sequence if not exists public.invoice_folio_seq;

do $$
declare r record;
begin
  for r in select id from public.invoices where folio is null order by id loop
    update public.invoices set folio = 'FAC-' || lpad(nextval('public.invoice_folio_seq')::text, 5, '0') where id = r.id;
  end loop;
end $$;

alter table public.invoices alter column folio set not null;
create unique index if not exists invoices_folio_key on public.invoices (folio);

create or replace function public.invoices_assign_folio()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.folio := 'FAC-' || lpad(nextval('public.invoice_folio_seq')::text, 5, '0');
  new.currency := 'MXN';
  return new;
end;
$$;
revoke all on function public.invoices_assign_folio() from public, anon, authenticated;

drop trigger if exists invoices_assign_folio on public.invoices;
create trigger invoices_assign_folio before insert on public.invoices
for each row execute function public.invoices_assign_folio();

-- Moneda nacional (las facturas anteriores conservan la suya).
alter table public.invoices drop constraint if exists invoices_currency_mxn;
alter table public.invoices add constraint invoices_currency_mxn check (currency = 'MXN') not valid;

-- ---------------------------------------------------------------------------
-- 2. Contrarecibo (fecha posible de pago) y complemento de pago
-- ---------------------------------------------------------------------------
alter table public.invoices add column if not exists receipt_path text;
alter table public.invoices add column if not exists receipt_name text;
alter table public.invoices add column if not exists receipt_text text not null default '';
alter table public.invoices add column if not exists payment_date date;
alter table public.invoices add column if not exists receipt_at timestamptz;
alter table public.invoices add column if not exists receipt_by_name text;
alter table public.invoices add column if not exists complement_path text;
alter table public.invoices add column if not exists complement_name text;
alter table public.invoices add column if not exists complement_text text not null default '';
alter table public.invoices add column if not exists complement_at timestamptz;
alter table public.invoices add column if not exists complement_by_name text;
-- true: el complemento menciona el UUID de la factura · false: no lo menciona · null: no se pudo revisar.
alter table public.invoices add column if not exists complement_verified boolean;

create unique index if not exists invoices_receipt_path_key on public.invoices (receipt_path) where receipt_path is not null;
create unique index if not exists invoices_complement_path_key on public.invoices (complement_path) where complement_path is not null;

alter table public.invoices drop constraint if exists invoices_receipt_consistent;
alter table public.invoices add constraint invoices_receipt_consistent check (
  (receipt_path is null) = (receipt_at is null)
  and (receipt_path is null) = (payment_date is null)
  and (receipt_path is null or stage = 'cargada')
);
alter table public.invoices drop constraint if exists invoices_complement_consistent;
alter table public.invoices add constraint invoices_complement_consistent check (
  (complement_path is null) = (complement_at is null)
  and (complement_path is null or receipt_path is not null)
);

create index if not exists invoices_payment_date_idx on public.invoices (payment_date) where complement_path is null;
create index if not exists invoices_created_idx on public.invoices (created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 3. Candado: nada se modifica; cada paso se marca una sola vez y en orden.
-- ---------------------------------------------------------------------------
create or replace function public.invoices_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  step_cols text[] := array[
    'stage', 'signed_at', 'signed_by_name', 'loaded_at', 'loaded_by_name',
    'receipt_path', 'receipt_name', 'receipt_text', 'payment_date', 'receipt_at', 'receipt_by_name',
    'complement_path', 'complement_name', 'complement_text', 'complement_at', 'complement_by_name', 'complement_verified',
    'updated_at', 'updated_by_name',
    -- Columna calculada: en un trigger BEFORE todavía no tiene valor.
    'has_text'];
  stage_order text[] := array['enviada', 'firmada', 'cargada'];
begin
  if tg_op = 'DELETE' then
    if public.is_super_admin() or (old.stage = 'enviada' and old.status = 'pendiente') then
      return old;
    end if;
    raise exception 'La factura ya está %: solo el Super administrador puede eliminarla.',
      case when old.complement_path is not null then 'pagada y cerrada' else old.stage end
      using errcode = '42501';
  end if;

  if old.complement_path is not null then
    raise exception 'La factura ya está pagada y cerrada: no se puede modificar.' using errcode = '42501';
  end if;
  if old.status = 'incidente' then
    raise exception 'La factura está cerrada (incidente) y ya no se puede modificar.' using errcode = '42501';
  end if;

  -- Los datos de la factura quedan como se cargaron.
  if (to_jsonb(new) - step_cols) is distinct from (to_jsonb(old) - step_cols) then
    raise exception 'Los datos de la factura no se pueden modificar: quedan como se cargaron.' using errcode = '42501';
  end if;

  -- El estado solo avanza de uno en uno.
  if new.stage is distinct from old.stage
     and coalesce(array_position(stage_order, new.stage), 0) <> array_position(stage_order, old.stage) + 1 then
    raise exception 'El estado de la factura solo avanza: enviada → firmada → cargada al sistema.' using errcode = '23514';
  end if;

  -- Lo ya marcado (firma, carga, contrarecibo) no se cambia.
  if (old.signed_at is not null and (new.signed_at, new.signed_by_name) is distinct from (old.signed_at, old.signed_by_name))
     or (old.loaded_at is not null and (new.loaded_at, new.loaded_by_name) is distinct from (old.loaded_at, old.loaded_by_name))
     or (old.receipt_path is not null and (new.receipt_path, new.receipt_name, new.receipt_text, new.payment_date, new.receipt_at, new.receipt_by_name)
         is distinct from (old.receipt_path, old.receipt_name, old.receipt_text, old.payment_date, old.receipt_at, old.receipt_by_name)) then
    raise exception 'Ese paso ya está registrado y no se puede cambiar.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard before update or delete on public.invoices
for each row execute function public.invoices_guard();

-- Permisos de columna: solo los pasos del flujo.
revoke update on public.invoices from authenticated;
grant update (stage, signed_at, signed_by_name, loaded_at, loaded_by_name,
  receipt_path, receipt_name, receipt_text, payment_date, receipt_at, receipt_by_name,
  complement_path, complement_name, complement_text, complement_at, complement_by_name, complement_verified,
  updated_at, updated_by_name) on public.invoices to authenticated;

drop policy if exists "invoices_insert" on public.invoices;
create policy "invoices_insert" on public.invoices for insert to authenticated
with check (
  public.has_app_permission('invoices.manage')
  and status = 'pendiente' and paid_on is null
  and stage = 'enviada' and signed_at is null and loaded_at is null
  and receipt_path is null and complement_path is null
);

-- ---------------------------------------------------------------------------
-- 4. Historial de cada factura (se conserva aunque la factura se elimine)
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_events (
  id bigint generated always as identity primary key,
  invoice_id bigint not null,
  folio text not null,
  event text not null check (event in ('enviada', 'firmada', 'cargada', 'contrarecibo', 'complemento', 'eliminada')),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  by_user uuid default auth.uid(),
  by_name text
);
create index if not exists invoice_events_invoice_idx on public.invoice_events (invoice_id, at, id);

alter table public.invoice_events enable row level security;
drop policy if exists "invoice_events_select" on public.invoice_events;
create policy "invoice_events_select" on public.invoice_events for select to authenticated
using ((select public.has_app_permission('invoices.view')));
revoke all on public.invoice_events from public, anon, authenticated;
grant select on public.invoice_events to authenticated;

create or replace function public.invoices_log_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.invoice_events (invoice_id, folio, event, detail, at, by_name)
    values (new.id, new.folio, 'enviada', jsonb_build_object('archivo', new.file_name, 'total', new.total), new.created_at, new.created_by_name);
    return new;
  end if;
  if tg_op = 'DELETE' then
    insert into public.invoice_events (invoice_id, folio, event, detail)
    values (old.id, old.folio, 'eliminada', jsonb_build_object('archivo', old.file_name, 'estado', old.stage));
    return old;
  end if;
  if new.stage = 'firmada' and old.stage = 'enviada' then
    insert into public.invoice_events (invoice_id, folio, event, at, by_name) values (new.id, new.folio, 'firmada', new.signed_at, new.signed_by_name);
  end if;
  if new.stage = 'cargada' and old.stage = 'firmada' then
    insert into public.invoice_events (invoice_id, folio, event, at, by_name) values (new.id, new.folio, 'cargada', new.loaded_at, new.loaded_by_name);
  end if;
  if new.receipt_path is not null and old.receipt_path is null then
    insert into public.invoice_events (invoice_id, folio, event, detail, at, by_name)
    values (new.id, new.folio, 'contrarecibo', jsonb_build_object('archivo', new.receipt_name, 'fecha_pago', new.payment_date), new.receipt_at, new.receipt_by_name);
  end if;
  if new.complement_path is not null and old.complement_path is null then
    insert into public.invoice_events (invoice_id, folio, event, detail, at, by_name)
    values (new.id, new.folio, 'complemento', jsonb_build_object('archivo', new.complement_name, 'verificado', new.complement_verified), new.complement_at, new.complement_by_name);
  end if;
  return new;
end;
$$;
revoke all on function public.invoices_log_event() from public, anon, authenticated;

drop trigger if exists invoices_log_event on public.invoices;
create trigger invoices_log_event after insert or update or delete on public.invoices
for each row execute function public.invoices_log_event();

-- Historial de las facturas que ya existían (solo lo que falte).
insert into public.invoice_events (invoice_id, folio, event, detail, at, by_name)
select i.id, i.folio, 'enviada', jsonb_build_object('archivo', i.file_name, 'total', i.total), i.created_at, i.created_by_name
from public.invoices i
where not exists (select 1 from public.invoice_events e where e.invoice_id = i.id and e.event = 'enviada');
insert into public.invoice_events (invoice_id, folio, event, at, by_name)
select i.id, i.folio, 'firmada', i.signed_at, i.signed_by_name
from public.invoices i
where i.signed_at is not null and not exists (select 1 from public.invoice_events e where e.invoice_id = i.id and e.event = 'firmada');
insert into public.invoice_events (invoice_id, folio, event, at, by_name)
select i.id, i.folio, 'cargada', i.loaded_at, i.loaded_by_name
from public.invoices i
where i.loaded_at is not null and not exists (select 1 from public.invoice_events e where e.invoice_id = i.id and e.event = 'cargada');

-- ---------------------------------------------------------------------------
-- 5. PDF (factura, contrarecibo y complemento): mientras una factura los use, solo el Super administrador
--    los borra. Los que no usa ninguna factura (cargas que fallaron) sí se pueden limpiar.
-- ---------------------------------------------------------------------------
drop policy if exists "invoices_files_delete" on storage.objects;
create policy "invoices_files_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'invoices'
  and public.has_app_permission('invoices.manage')
  and (
    public.is_super_admin()
    or not exists (
      select 1 from public.invoices i
      where storage.objects.name in (i.file_path, i.receipt_path, i.complement_path)
    )
  )
);

-- Descripción del permiso (el texto vive en la app; aquí solo se ajusta el rol sugerido).
update public.roles
set descripcion = 'Carga de facturas en PDF, firma, carga al sistema, contrarecibos y complementos de pago'
where nombre = 'Cuentas por pagar';

notify pgrst, 'reload schema';
