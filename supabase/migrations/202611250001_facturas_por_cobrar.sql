-- Facturas: las facturas son nuestras (nosotros las cobramos). Ejecutar DESPUÉS de 202611240002_facturas_flujo_pago.sql.
-- Es seguro repetirla. No cambia datos ni reglas, solo la redacción:
--   * Ya no hay "pago programado" ni "pago atrasado": al cargar el contrarecibo la factura pasa a POR COBRAR
--     (payment_date se conserva solo como fecha posible de cobro, informativa).
--   * Con el complemento de pago la factura queda COBRADA y cerrada (antes decía "pagada").

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
      case when old.complement_path is not null then 'cobrada y cerrada' else old.stage end
      using errcode = '42501';
  end if;

  if old.complement_path is not null then
    raise exception 'La factura ya está cobrada y cerrada: no se puede modificar.' using errcode = '42501';
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

comment on column public.invoices.payment_date is 'Fecha posible de cobro (del contrarecibo). Informativa: con el contrarecibo la factura queda por cobrar.';
comment on column public.invoices.complement_path is 'Complemento de pago: la factura queda cobrada y cerrada.';

update public.roles
set descripcion = 'Carga de facturas en PDF, firma, carga al sistema, contrarecibos (por cobrar) y complementos (cobradas)'
where nombre = 'Cuentas por pagar';
