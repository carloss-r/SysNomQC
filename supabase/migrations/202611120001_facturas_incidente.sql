-- Facturas: estatus "incidente" con descripción capturada a mano.
-- Ejecutar DESPUÉS de 202611110003_facturas_ediciones.sql. Es seguro repetirla.
--
-- Una factura nace "pendiente" y puede pasar a "pagada" o a "incidente" (y regresar).
-- Mientras está en incidente guarda qué pasó, cuándo y quién lo marcó.

alter table public.invoices add column if not exists incident_description text;
alter table public.invoices add column if not exists incident_on date;
alter table public.invoices add column if not exists incident_by_name text;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('pendiente', 'pagada', 'incidente'));

-- En incidente la descripción es obligatoria; en cualquier otro estatus queda vacía.
alter table public.invoices drop constraint if exists invoices_incident_consistent;
alter table public.invoices add constraint invoices_incident_consistent check (
  (status = 'incidente') = (incident_description is not null and length(btrim(incident_description)) > 0)
  and (incident_description is null or length(incident_description) <= 1000)
);

grant update (incident_description, incident_on, incident_by_name) on public.invoices to authenticated;
