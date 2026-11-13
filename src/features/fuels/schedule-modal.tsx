"use client";

import { CalendarPlus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import {
  computeMonth,
  energyGcal,
  fmt,
  monthOf,
  SEMARNAT_LIMIT,
  supplierApproved,
  type FuelCoke,
  type FuelMonthSummary,
  type FuelProduct,
  type FuelReception,
  type FuelSchedule,
  type FuelSupplier,
} from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { addDays, formatDay, monthLabel, parseNumber } from "./format";
import { LevelBadge } from "./semaphore";
import { BusyLabel } from "@/shared/ui/loading";

export function ScheduleModal({
  today,
  suppliers,
  schedule,
  receptions,
  coke,
  products,
  onClose,
  onSaved,
}: {
  today: string;
  suppliers: FuelSupplier[];
  schedule: FuelSchedule[];
  receptions: FuelReception[];
  coke: FuelCoke[];
  products: Map<number, FuelProduct>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const [form, setForm] = useState({ scheduled_on: today, supplier_id: "", product_id: "", carrier: "", tons: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Filtro exclusivo de M2: solo proveedores aprobados con permiso vigente en la fecha y con productos activos.
  const eligible = useMemo(
    () => suppliers.filter((item) => supplierApproved(item, form.scheduled_on || today) && item.products.some((product) => product.active)),
    [suppliers, form.scheduled_on, today],
  );
  const supplier = eligible.find((item) => String(item.id) === form.supplier_id) ?? null;
  const product = supplier?.products.find((item) => item.active && String(item.id) === form.product_id) ?? null;
  const tons = parseNumber(form.tons);
  const extra = product && tons ? energyGcal(tons, product.calorific_value) : 0;
  const projection: FuelMonthSummary | null = form.scheduled_on
    ? computeMonth(monthOf(form.scheduled_on), receptions, schedule, products, coke, extra)
    : null;
  const blocked = projection?.projected_level === "rojo" && Boolean(product && tons);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !product || !tons) {
      setError("Elige proveedor, producto y peso estimado.");
      return;
    }
    if (blocked) {
      setError(`Bloqueo SEMARNAT: la proyección del mes llegaría a ${fmt(projection?.projected_pct, 1)} %.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await requestApi<{ id: number; summary: FuelMonthSummary }>(session, "/api/fuels/schedule", {
        method: "POST",
        body: JSON.stringify({ scheduled_on: form.scheduled_on, product_id: product.id, carrier: form.carrier, estimated_tons: tons, notes: form.notes || undefined }),
      });
      const level = result.summary?.projected_level;
      notify(
        level === "amarillo" ? "warning" : "success",
        "Recepción programada",
        `${supplier?.business_name} · ${formatDay(form.scheduled_on)} · ${fmt(tons, 2)} t.${level === "amarillo" ? " El mes está en amarillo: dosifica las siguientes cargas." : ""}`,
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo programar la recepción."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="fuel-schedule-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><CalendarPlus size={19} /></div>
          <div>
            <h2 id="fuel-schedule-title">Programar recepción</h2>
            <p>Solo aparecen proveedores aprobados con permiso SEMARNAT vigente en la fecha elegida.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Fecha" required>
              <input type="date" value={form.scheduled_on} min={today} max={addDays(today, 120)} onChange={(e) => setForm({ ...form, scheduled_on: e.target.value })} required />
            </Field>
            <Field label="Proveedor (generador)" required>
              <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value, product_id: "" })} required>
                <option value="">{eligible.length ? "Elige…" : "No hay proveedores aprobados y vigentes"}</option>
                {eligible.map((item) => <option key={item.id} value={item.id}>{item.business_name}</option>)}
              </select>
            </Field>
            <Field label="Producto autorizado" required>
              <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} disabled={!supplier} required>
                <option value="">Elige…</option>
                {supplier?.products.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {fmt(item.calorific_value, 0)} cal/g</option>)}
              </select>
            </Field>
            <Field label="Transportista" required><input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} minLength={2} maxLength={120} required /></Field>
            <Field label="Peso estimado (t)" required><input inputMode="decimal" value={form.tons} onChange={(e) => setForm({ ...form, tons: e.target.value })} placeholder="20" required /></Field>
            <Field label="Notas"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} /></Field>
          </div>

          {projection && (
            <div className={`fuel-projection fuel-projection-${blocked ? "rojo" : projection.projected_level}`}>
              <strong>Proyección de {monthLabel(projection.month)} con esta carga: {projection.projected_pct === null ? "sin datos de coque" : `${fmt(projection.projected_pct, 1)} %`}</strong>{" "}
              <LevelBadge level={projection.projected_level} />
              <p>
                Recibido {fmt(projection.alt_gcal, 1)} Gcal + programado {fmt(projection.pending_gcal, 1)} Gcal
                {product && tons ? ` + esta carga ${fmt(energyGcal(tons, product.calorific_value), 1)} Gcal` : ""} frente a coque {fmt(projection.coke_gcal, 1)} Gcal
                {projection.coke_estimated && projection.coke_month ? ` (estimado con ${monthLabel(projection.coke_month)})` : ""}.
                {blocked && ` Rebasa el ${SEMARNAT_LIMIT} % autorizado: la agenda no acepta esta carga.`}
                {projection.projected_level === "sin_datos" && " Sin consumo de coque capturado no se puede proyectar; Ecología debe capturarlo."}
              </p>
            </div>
          )}

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy || blocked}><CalendarPlus size={17} /> {busy ? <BusyLabel>Programando…</BusyLabel> : blocked ? "Bloqueado (30 %)" : "Programar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
