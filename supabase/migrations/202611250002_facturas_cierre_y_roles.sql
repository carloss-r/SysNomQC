-- Facturas: cierre con el complemento de pago y roles para operar y supervisar el módulo.
-- Ejecutar DESPUÉS de 202611250001_facturas_por_cobrar.sql. Es seguro repetirla.
--
--   * Ya no hay estado "por cobrar": después del contrarecibo falta el complemento de pago, y con él la
--     factura queda CERRADA. Cada semana se cierran las facturas que se cargaron en ella. (Solo cambia la
--     redacción del candado; las reglas siguen igual.)
--   * Roles nuevos (se asignan en Usuarios y roles):
--       Cuentas por cobrar        invoices.view + invoices.manage  · carga facturas y avanza todos los pasos
--       Supervisión de facturas   invoices.view                    · revisa el avance y el cierre semanal, sin modificar

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
      case when old.complement_path is not null then 'cerrada (con complemento de pago)' else old.stage end
      using errcode = '42501';
  end if;

  if old.complement_path is not null then
    raise exception 'La factura ya está cerrada (tiene su complemento de pago): no se puede modificar.' using errcode = '42501';
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

comment on column public.invoices.payment_date is 'Fecha posible de cobro capturada con el contrarecibo (dato del contrarecibo, sin estado propio).';
comment on column public.invoices.complement_path is 'Complemento de pago: con él la factura queda cerrada.';

insert into public.roles (nombre, descripcion, permisos)
values
  ('Cuentas por cobrar', 'Facturas: carga del PDF, firma, carga al sistema, contrarecibo y complemento de pago (cierre)',
    array['invoices.view', 'invoices.manage']),
  ('Supervisión de facturas', 'Facturas: consulta del avance y del cierre semanal, sin modificar nada',
    array['invoices.view'])
on conflict (nombre) do update
  set descripcion = excluded.descripcion, permisos = excluded.permisos
  where coalesce(public.roles.es_sistema, false) = false;

update public.roles
set descripcion = 'Facturas: carga del PDF, firma, carga al sistema, contrarecibo y complemento de pago (cierre)'
where nombre = 'Cuentas por pagar';
