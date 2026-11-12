"use client";

import { Lock, Scale, Truck, X } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import {
  compensationCandidates,
  fmt,
  QUALITY_LIMITS,
  weightedChlorine,
  type FuelMonthSummary,
  type FuelProduct,
  type FuelReception,
  type FuelSchedule,
  type FuelSupplier,
} from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { addDays, formatDateTime, formatDay, parseNumber } from "./format";

const DEFAULT_DESTINATION = "Horno de clínker (coprocesamiento)";

function Backdrop({ busy, onClose, children }: { busy: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      {children}
    </div>
  );
}

/** [Capturar entrada (bruto)]: tres bloques (generador, transportista, vehículo) y bloque central de pesos. */
export function EntryModal({
  today,
  schedule,
  suppliers,
  products,
  onClose,
  onSaved,
}: {
  today: string;
  schedule: FuelSchedule[];
  suppliers: FuelSupplier[];
  products: Map<number, FuelProduct>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  // Agenda disponible para báscula: programado hoy o con hasta 7 días de atraso.
  const agenda = useMemo(
    () => schedule.filter((row) => row.status === "programado" && row.scheduled_on <= today && row.scheduled_on >= addDays(today, -7)).sort((a, b) => a.scheduled_on.localeCompare(b.scheduled_on)),
    [schedule, today],
  );
  const supplierById = useMemo(() => new Map(suppliers.map((item) => [item.id, item])), [suppliers]);
  const [scheduleId, setScheduleId] = useState(agenda.length === 1 ? String(agenda[0]!.id) : "");
  const selected = agenda.find((row) => String(row.id) === scheduleId) ?? null;
  const supplier = selected ? supplierById.get(selected.supplier_id) : undefined;
  const product = selected ? products.get(selected.product_id) : undefined;
  const [form, setForm] = useState({ manifest_folio: "", carrier: selected?.carrier ?? "", driver: "", plates: "", vehicle: "", destination: DEFAULT_DESTINATION, gross_kg: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gross = parseNumber(form.gross_kg);

  function pick(id: string) {
    setScheduleId(id);
    const row = agenda.find((item) => String(item.id) === id);
    if (row) setForm((current) => ({ ...current, carrier: row.carrier }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !selected) {
      setError("Elige la recepción de la agenda.");
      return;
    }
    if (!gross || gross <= 0) {
      setError("Captura el peso bruto en kg.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { id } = await requestApi<{ id: number }>(session, "/api/fuels/receptions", {
        method: "POST",
        body: JSON.stringify({ schedule_id: selected.id, ...form, gross_kg: gross, vehicle: form.vehicle || undefined, notes: form.notes || undefined }),
      });
      notify("success", `Entrada registrada · ticket ${id}`, `${supplier?.business_name ?? ""} · ${fmt(gross, 0)} kg brutos. Captura la tara a la salida.`);
      await onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo registrar la entrada."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Backdrop busy={busy} onClose={onClose}>
      <section className="modal modal-form fuel-modal-wide" role="dialog" aria-modal="true" aria-labelledby="fuel-entry-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Truck size={19} /></div>
          <div>
            <h2 id="fuel-entry-title">Capturar entrada (bruto)</h2>
            <p>El folio del manifiesto queda amarrado a este ticket de báscula.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <div className="fuel-blocks">
            <fieldset className="fuel-block">
              <legend>Generador</legend>
              <Field label="Recepción de la agenda" required>
                <select value={scheduleId} onChange={(e) => pick(e.target.value)} required>
                  <option value="">{agenda.length ? "Elige…" : "No hay recepciones programadas para hoy"}</option>
                  {agenda.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.scheduled_on < today ? `(${formatDay(row.scheduled_on)}) ` : ""}{supplierById.get(row.supplier_id)?.business_name} · {products.get(row.product_id)?.name} · {fmt(row.estimated_tons, 1)} t
                    </option>
                  ))}
                </select>
              </Field>
              {supplier && product && (
                <p className="fuel-block-info">
                  <strong>{supplier.business_name}</strong><br />RFC {supplier.rfc}<br />{product.name} · {fmt(product.calorific_value, 0)} cal/g
                </p>
              )}
            </fieldset>
            <fieldset className="fuel-block">
              <legend>Transportista</legend>
              <Field label="Empresa transportista" required><input value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} maxLength={120} required /></Field>
              <Field label="Chofer" required><input value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} maxLength={120} required /></Field>
            </fieldset>
            <fieldset className="fuel-block">
              <legend>Datos del vehículo</legend>
              <Field label="Placas" required><input value={form.plates} onChange={(e) => setForm({ ...form, plates: e.target.value.toUpperCase() })} maxLength={20} required /></Field>
              <Field label="Vehículo"><input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} maxLength={120} placeholder="Tractocamión con caja seca" /></Field>
            </fieldset>
          </div>

          <div className="fuel-weights">
            <Field label="Folio del manifiesto" required><input value={form.manifest_folio} onChange={(e) => setForm({ ...form, manifest_folio: e.target.value.toUpperCase() })} maxLength={40} placeholder="04/2026" required /></Field>
            <Field label="Peso bruto (kg)" required><input className="fuel-weight-input" inputMode="decimal" value={form.gross_kg} onChange={(e) => setForm({ ...form, gross_kg: e.target.value })} placeholder="0" required /></Field>
            <Field label="Destino"><input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} maxLength={120} /></Field>
            <Field label="Observaciones"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={300} /></Field>
          </div>

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy || !selected}><Scale size={17} /> {busy ? "Registrando…" : "Capturar entrada (bruto)"}</button>
          </div>
        </form>
      </section>
    </Backdrop>
  );
}

/** [Capturar salida (tara)]: calcula el neto y cierra el ticket de forma irreversible. */
export function ExitModal({
  reception,
  receptions,
  today,
  onClose,
  onClosed,
}: {
  reception: FuelReception;
  receptions: FuelReception[];
  today: string;
  onClose: () => void;
  onClosed: (closed: FuelReception, summary: FuelMonthSummary | null) => Promise<void>;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const [tare, setTare] = useState("");
  const [chlorine, setChlorine] = useState("");
  const [compensates, setCompensates] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tareKg = parseNumber(tare);
  const net = tareKg !== null ? reception.gross_kg - tareKg : null;
  const chlorinePct = parseNumber(chlorine);
  const { used, candidates } = useMemo(() => compensationCandidates(reception.supplier_id, receptions, today), [reception.supplier_id, receptions, today]);
  const target = candidates.find((row) => String(row.id) === compensates) ?? null;
  const average = target && net && chlorinePct !== null ? weightedChlorine([target, { net_kg: net, chlorine_pct: chlorinePct }]) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    if (!tareKg || tareKg <= 0 || net === null || net <= 0) {
      setError("La tara debe ser mayor que cero y menor que el peso bruto.");
      return;
    }
    if (target && (chlorinePct === null || chlorinePct > QUALITY_LIMITS.maxChlorine)) {
      setError(`Para compensar, esta carga necesita un análisis de cloro de ${QUALITY_LIMITS.maxChlorine} % o menos.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await requestApi<{ id: number; net_kg: number; summary: FuelMonthSummary }>(session, `/api/fuels/receptions/${reception.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "exit", tare_kg: tareKg, chlorine_pct: chlorinePct, compensates_id: target?.id ?? null }),
      });
      const closed: FuelReception = {
        ...reception,
        status: "cerrado",
        tare_kg: tareKg,
        net_kg: result.net_kg,
        tare_at: new Date().toISOString(),
        received_on: today,
        chlorine_pct: chlorinePct,
        compensates_id: target?.id ?? null,
      };
      notify("success", `Ticket ${reception.id} cerrado`, `Neto ${fmt(result.net_kg, 0)} kg (${fmt(result.net_kg / 1000, 3)} t). Ya puedes imprimir el certificado.`);
      if (result.summary?.level === "rojo") notify("error", "Semáforo SEMARNAT en rojo", `La sustitución del mes llegó a ${fmt(result.summary.pct, 1)} %. Se avisó a Ecología.`);
      else if (result.summary?.level === "amarillo") notify("warning", "Semáforo SEMARNAT en amarillo", `La sustitución del mes va en ${fmt(result.summary.pct, 1)} %.`);
      await onClosed(closed, result.summary ?? null);
    } catch (err) {
      setError(describeError(err, "No se pudo cerrar el ticket."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Backdrop busy={busy} onClose={onClose}>
      <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="fuel-exit-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Lock size={19} /></div>
          <div>
            <h2 id="fuel-exit-title">Capturar salida (tara) · ticket {reception.id}</h2>
            <p>{reception.generator_name} · manifiesto {reception.manifest_folio} · {reception.plates}</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <div className="fuel-scale-display">
            <div><span>Bruto</span><strong>{fmt(reception.gross_kg, 0)} kg</strong><small>{formatDateTime(reception.gross_at)}</small></div>
            <div><span>Tara</span><strong>{tareKg ? `${fmt(tareKg, 0)} kg` : "—"}</strong><small>ahora</small></div>
            <div className={net !== null && net <= 0 ? "bad" : "net"}><span>Neto</span><strong>{net !== null ? `${fmt(net, 0)} kg` : "—"}</strong><small>{net !== null && net > 0 ? `${fmt(net / 1000, 3)} t` : ""}</small></div>
          </div>
          <div className="form-grid">
            <Field label="Peso tara (kg)" required><input className="fuel-weight-input" inputMode="decimal" value={tare} onChange={(e) => setTare(e.target.value)} autoFocus required /></Field>
            <Field label="Cloro del embarque (%)"><input inputMode="decimal" value={chlorine} onChange={(e) => setChlorine(e.target.value)} placeholder="Opcional (laboratorio)" /></Field>
            {candidates.length > 0 && (
              <Field label="Compensa el embarque">
                <select value={compensates} onChange={(e) => setCompensates(e.target.value)} disabled={used}>
                  <option value="">No es compensación</option>
                  {candidates.map((row) => (
                    <option key={row.id} value={row.id}>Ticket {row.id} · {row.manifest_folio} · {fmt(row.chlorine_pct, 2)} % Cl · {formatDay(row.received_on)}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {chlorinePct !== null && chlorinePct > QUALITY_LIMITS.maxChlorine && (
            <p className="fuel-warn">Cloro fuera de especificación (máximo {QUALITY_LIMITS.maxChlorine} %). El proveedor tiene 2 días para corregirlo con un segundo embarque; si no, queda penalizado.</p>
          )}
          {candidates.length > 0 && used && <p className="fuel-warn">Este proveedor ya usó su corrección cruzada del mes; el embarque fuera de especificación quedará penalizado.</p>}
          {average !== null && target && (
            <p className="fuel-note">
              Promedio ponderado de los manifiestos {target.manifest_folio} y {reception.manifest_folio}: {fmt(((target.net_kg ?? 0) + (net ?? 0)) / 1000, 3)} t con {fmt(average, 2)} % de cloro. Al cerrar, el embarque queda corregido sin penalización.
            </p>
          )}
          <label className="checkbox-option fuel-confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Entiendo que el cierre es irreversible: el ticket y su manifiesto ya no se podrán modificar.
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy || !confirmed || !net || net <= 0}><Lock size={17} /> {busy ? "Cerrando…" : "Capturar salida (tara)"}</button>
          </div>
        </form>
      </section>
    </Backdrop>
  );
}
