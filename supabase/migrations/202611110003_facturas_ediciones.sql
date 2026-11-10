-- Bitácora de correcciones de facturas: quién editó qué dato y cuál era el valor anterior.
-- Ejecutar DESPUÉS de 202611110002_facturas.sql. Es seguro repetirla.

create table if not exists public.invoice_edits (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  edited_at timestamptz not null default now(),
  edited_by uuid not null default auth.uid(),
  edited_by_name text not null,
  -- { "total": { "from": 100, "to": 116 }, ... }
  changes jsonb not null check (jsonb_typeof(changes) = 'object')
);
create index if not exists invoice_edits_invoice_idx on public.invoice_edits (invoice_id, edited_at desc);

alter table public.invoice_edits enable row level security;
drop policy if exists "invoice_edits_select" on public.invoice_edits;
drop policy if exists "invoice_edits_insert" on public.invoice_edits;
create policy "invoice_edits_select" on public.invoice_edits for select to authenticated
using (public.has_app_permission('invoices.view'));
-- Solo se agregan registros a nombre de la propia cuenta; nunca se modifican ni se borran.
create policy "invoice_edits_insert" on public.invoice_edits for insert to authenticated
with check (public.has_app_permission('invoices.manage') and edited_by = auth.uid());

revoke all on public.invoice_edits from public, anon, authenticated;
grant select, insert on public.invoice_edits to authenticated;
