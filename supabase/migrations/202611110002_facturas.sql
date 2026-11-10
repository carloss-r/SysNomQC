-- Facturas: carga de PDF, texto digitalizado, estatus de pago y resumen semanal/mensual.
-- Ejecutar DESPUÉS de 202611110001_normalizar_roles.sql. Es seguro repetirla. No agrega datos de prueba.
--
-- Permisos nuevos:
--   invoices.view    Ver facturas, su PDF y los resúmenes
--   invoices.manage  Cargar facturas, corregir sus datos, marcarlas pagadas o pendientes y eliminarlas
--
-- El PDF vive en el bucket privado "invoices"; en la tabla se guarda su ruta y el texto extraído.

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  file_path text not null unique,
  file_name text not null,
  file_size integer not null default 0 check (file_size >= 0),
  -- Datos de la factura (se detectan del PDF y el usuario los puede corregir).
  invoice_date date not null,
  due_date date,
  folio text,
  uuid text,
  supplier_name text,
  supplier_rfc text,
  subtotal numeric(14,2) check (subtotal is null or subtotal >= 0),
  tax numeric(14,2) check (tax is null or tax >= 0),
  total numeric(14,2) check (total is null or total >= 0),
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  notes text,
  -- Estatus de pago: toda factura nace pendiente.
  status text not null default 'pendiente' check (status in ('pendiente', 'pagada')),
  paid_on date,
  paid_by_name text,
  -- Digitalización: texto del PDF (vacío si el PDF es una imagen escaneada).
  text_content text not null default '',
  text_pages integer not null default 0,
  has_text boolean generated always as (length(btrim(text_content)) > 0) stored,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by_name text,
  constraint invoices_paid_consistent check ((status = 'pagada') = (paid_on is not null))
);
create index if not exists invoices_date_idx on public.invoices (invoice_date desc, id desc);
create index if not exists invoices_status_idx on public.invoices (status);

alter table public.invoices enable row level security;
drop policy if exists "invoices_select" on public.invoices;
drop policy if exists "invoices_insert" on public.invoices;
drop policy if exists "invoices_update" on public.invoices;
drop policy if exists "invoices_delete" on public.invoices;
create policy "invoices_select" on public.invoices for select to authenticated
using (public.has_app_permission('invoices.view'));
-- Al cargarla siempre queda pendiente de pago; el cambio a pagada es una edición posterior.
create policy "invoices_insert" on public.invoices for insert to authenticated
with check (public.has_app_permission('invoices.manage') and status = 'pendiente' and paid_on is null);
create policy "invoices_update" on public.invoices for update to authenticated
using (public.has_app_permission('invoices.manage'))
with check (public.has_app_permission('invoices.manage'));
create policy "invoices_delete" on public.invoices for delete to authenticated
using (public.has_app_permission('invoices.manage'));

revoke all on public.invoices from public, anon, authenticated;
grant select, insert, delete on public.invoices to authenticated;
-- Lo que nunca cambia después de cargar (archivo, texto, quién la subió) queda fuera del UPDATE.
grant update (invoice_date, due_date, folio, uuid, supplier_name, supplier_rfc, subtotal, tax, total, currency, notes,
  status, paid_on, paid_by_name, updated_at, updated_by_name) on public.invoices to authenticated;

-- PDF de facturas (bucket privado, máximo 10 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "invoices_files_select" on storage.objects;
drop policy if exists "invoices_files_insert" on storage.objects;
drop policy if exists "invoices_files_delete" on storage.objects;
create policy "invoices_files_select" on storage.objects for select to authenticated
using (bucket_id = 'invoices' and public.has_app_permission('invoices.view'));
create policy "invoices_files_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'invoices' and public.has_app_permission('invoices.manage'));
create policy "invoices_files_delete" on storage.objects for delete to authenticated
using (bucket_id = 'invoices' and public.has_app_permission('invoices.manage'));

-- Rol sugerido (se ajusta después en Usuarios y roles)
insert into public.roles (nombre, descripcion, permisos)
values ('Cuentas por pagar', 'Carga de facturas en PDF, seguimiento de pagos y resúmenes semanales y mensuales',
  array['invoices.view', 'invoices.manage'])
on conflict (nombre) do nothing;
