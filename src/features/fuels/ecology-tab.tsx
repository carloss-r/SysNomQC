"use client";

import { Fuel, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import {
  CHLORINE_LABELS,
  chlorineState,
  COKE_CALORIFIC,
  computeMonth,
  fmt,
  LEVEL_LABELS,
  netTons,
  QUALITY_LIMITS,
  receptionGcal,
  SEMARNAT_LIMIT,
  semaphoreLevel,
  type FuelCoke,
  type FuelMonthSummary,
  type FuelProduct,
  type FuelReception,
  type FuelSchedule,
} from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { ExportButtons } from "@/shared/reports/export-buttons";
import type { Report } from "@/shared/reports/report-export";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { formatDay, monthLabel, parseNumber } from "./format";
import { LevelBadge } from "./semaphore";
import { FUELS_SUBTITLE } from "./suppliers-tab";

export function CokeModal({ today, coke, presetMonth, onClose, onSaved }: { today: string; coke: FuelCoke[]; presetMonth?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { session } = useAuth();
  const notify = useNotify();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(presetMonth ?? current);
  const existing = coke.find((row) => row.month.slice(0, 7) === month);
  const [tons, setTons] = useState(existing ? String(existing.coke_tons) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function changeMonth(value: string) {
    setMonth(value);
    const row = coke.find((item) => item.month.slice(0, 7) === value);
    setTons(row ? String(row.coke_tons) : "");
    setNotes(row?.notes ?? "");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseNumber(tons);
    if (!session || value === null || value < 0) {
      setError("Captura las toneladas de coque consumidas.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const summary = await requestApi<FuelMonthSummary>(session, "/api/fuels/coke", { method: "PUT", body: JSON.stringify({ month, coke_tons: value, notes: notes || undefined }) });
      notify(
        summary.level === "rojo" ? "error" : summary.level === "amarillo" ? "warning" : "success",
        `Coque de ${monthLabel(month)} guardado`,
        `Sustitución del mes: ${summary.pct === null ? "sin datos" : `${fmt(summary.pct, 1)} %`} (${LEVEL_LABELS[summary.level]}).`,
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo guardar el consumo de coque."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form fuel-modal-small" role="dialog" aria-modal="true" aria-labelledby="fuel-coke-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Fuel size={19} /></div>
          <div>
            <h2 id="fuel-coke-title">Consumo mensual de coque de petróleo</h2>
            <p>Línea base: {COKE_CALORIFIC.toLocaleString("es-MX")} cal/g. Recalcula el semáforo del mes.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <div className="form-grid fuel-grid-2">
            <Field label="Mes" required><input type="month" value={month} max={current} onChange={(e) => changeMonth(e.target.value || current)} required /></Field>
            <Field label="Coque consumido (t)" required><input inputMode="decimal" value={tons} onChange={(e) => setTons(e.target.value)} autoFocus required /></Field>
            <div className="fuel-span-3"><Field label="Notas"><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field></div>
          </div>
          {existing && <p className="epp-muted">Ya capturado: {fmt(existing.coke_tons, 2)} t por {existing.updated_by_name ?? "—"}. Guardar lo reemplaza.</p>}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><Fuel size={17} /> {busy ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

type Totals = { key: string; label: string; detail: string; trips: number; tons: number; gcal: number };

/** Masa y energía acumuladas por producto o por generador (para la COA). */
function accumulate(rows: FuelReception[], keyOf: (row: FuelReception) => string, labelOf: (row: FuelReception) => [string, string]): Totals[] {
  const map = new Map<string, Totals>();
  for (const row of rows) {
    const key = keyOf(row);
    const [label, detail] = labelOf(row);
    const entry = map.get(key) ?? { key, label, detail, trips: 0, tons: 0, gcal: 0 };
    entry.trips += 1;
    entry.tons += netTons(row);
    entry.gcal += receptionGcal(row);
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.gcal - a.gcal);
}

export function EcologyTab({
  today,
  receptions,
  schedule,
  products,
  coke,
  canEdit,
  onCoke,
}: {
  today: string;
  receptions: FuelReception[];
  schedule: FuelSchedule[];
  products: Map<number, FuelProduct>;
  coke: FuelCoke[];
  canEdit: boolean;
  onCoke: (month?: string) => void;
}) {
  const currentYear = Number(today.slice(0, 4));
  const [semester, setSemester] = useState(`${currentYear}-${Number(today.slice(5, 7)) <= 6 ? 1 : 2}`);
  const [year, half] = semester.split("-").map(Number) as [number, number];
  const months = useMemo(
    () => Array.from({ length: 6 }, (_, index) => `${year}-${String((half === 1 ? 1 : 7) + index).padStart(2, "0")}`),
    [year, half],
  );
  const options = [currentYear, currentYear - 1].flatMap((y) => [`${y}-2`, `${y}-1`]).filter((key) => `${key.slice(0, 4)}-${key.endsWith("1") ? "01" : "07"}` <= today.slice(0, 7));

  const rows = useMemo(
    () =>
      months.map((month) => {
        const summary = computeMonth(month, receptions, schedule, products, coke);
        const own = coke.some((row) => row.month.slice(0, 7) === month);
        // En el reporte oficial solo cuenta el coque capturado del mes (no la estimación).
        const pct = own ? summary.pct : null;
        return { month, summary, own, pct, level: semaphoreLevel(pct), future: month > today.slice(0, 7) };
      }),
    [months, receptions, schedule, products, coke, today],
  );

  const inSemester = useMemo(
    () => receptions.filter((row) => row.status === "cerrado" && row.received_on && months.includes(row.received_on.slice(0, 7))),
    [receptions, months],
  );
  const totals = useMemo(() => {
    const alt = rows.reduce((sum, row) => sum + row.summary.alt_gcal, 0);
    const altTons = rows.reduce((sum, row) => sum + row.summary.alt_tons, 0);
    const cokeRows = rows.filter((row) => row.own);
    const cokeTons = cokeRows.reduce((sum, row) => sum + (row.summary.coke_tons ?? 0), 0);
    const cokeGcal = cokeRows.reduce((sum, row) => sum + (row.summary.coke_gcal ?? 0), 0);
    const pct = cokeGcal + alt > 0 && cokeRows.length ? (alt / (alt + cokeGcal)) * 100 : null;
    return { alt, altTons, cokeTons, cokeGcal, pct, missing: rows.filter((row) => !row.own && !row.future).length };
  }, [rows]);

  const byProduct = useMemo(() => accumulate(inSemester, (row) => `${row.product_id}`, (row) => [row.product_name, row.generator_name]), [inSemester]);
  const byGenerator = useMemo(() => accumulate(inSemester, (row) => `${row.supplier_id}`, (row) => [row.generator_name, row.generator_rfc]), [inSemester]);
  const chlorineIssues = useMemo(
    () => inSemester.filter((row) => row.chlorine_pct !== null && row.chlorine_pct > QUALITY_LIMITS.maxChlorine).map((row) => ({ row, state: chlorineState(row, receptions, today) })),
    [inSemester, receptions, today],
  );
  const audit = useMemo(() => inSemester.filter((row) => semaphoreLevel(row.month_pct_after) === "rojo"), [inSemester]);
  const label = `${half === 1 ? "1er" : "2.º"} semestre ${year} (${monthLabel(months[0]!)} – ${monthLabel(months[5]!)})`;

  function buildReport(generatedBy: string): Report {
    return {
      subtitle: FUELS_SUBTITLE,
      title: "Reporte semestral SEMARNAT · sustitución térmica",
      info: [["Periodo", label], ["Límite autorizado", `${SEMARNAT_LIMIT} %`], ["Coque", `${COKE_CALORIFIC.toLocaleString("es-MX")} cal/g`]],
      summary: [
        ["Alternos (t)", fmt(totals.altTons, 3)],
        ["Alternos (Gcal)", fmt(totals.alt, 2)],
        ["Coque (Gcal)", fmt(totals.cokeGcal, 2)],
        ["Sustitución del semestre", totals.pct === null ? "Sin datos" : `${fmt(totals.pct, 2)} %`],
      ],
      sections: [
        {
          title: "Memoria de cálculo mensual",
          columns: [
            { header: "Mes", width: 18 },
            { header: "Alternos (t)", width: 12, align: "right" },
            { header: "Alternos (Gcal)", width: 13, align: "right" },
            { header: "Coque (t)", width: 12, align: "right" },
            { header: "Coque (Gcal)", width: 12, align: "right" },
            { header: "Sustitución (%)", width: 12, align: "right" },
            { header: "Semáforo", width: 14 },
          ],
          rows: rows.map((row) => [
            monthLabel(row.month), fmt(row.summary.alt_tons, 3), fmt(row.summary.alt_gcal, 2),
            row.own ? fmt(row.summary.coke_tons, 2) : "Sin capturar", row.own ? fmt(row.summary.coke_gcal, 2) : "—",
            row.pct === null ? "—" : fmt(row.pct, 2), row.level === "rojo" ? "ROJO · marca de auditoría" : LEVEL_LABELS[row.level],
          ]),
        },
        {
          title: "Acumulado por producto (COA)",
          columns: [
            { header: "Producto", width: 30 },
            { header: "Generador", width: 30 },
            { header: "Viajes", width: 8, align: "right" },
            { header: "Masa (t)", width: 12, align: "right" },
            { header: "Energía (Gcal)", width: 12, align: "right" },
            { header: "Poder calorífico prom. (cal/g)", width: 16, align: "right" },
          ],
          rows: byProduct.map((item) => [item.label, item.detail, item.trips, fmt(item.tons, 3), fmt(item.gcal, 2), item.tons ? fmt((item.gcal * 1000) / item.tons, 0) : "—"]),
          empty: "Sin recepciones en el semestre.",
        },
        {
          title: "Acumulado por generador (COA)",
          columns: [
            { header: "Generador", width: 34 },
            { header: "RFC", width: 16 },
            { header: "Viajes", width: 8, align: "right" },
            { header: "Masa (t)", width: 12, align: "right" },
            { header: "Energía (Gcal)", width: 12, align: "right" },
          ],
          rows: byGenerator.map((item) => [item.label, item.detail, item.trips, fmt(item.tons, 3), fmt(item.gcal, 2)]),
          empty: "Sin recepciones en el semestre.",
        },
        {
          title: "Cloro fuera de especificación",
          columns: [
            { header: "Ticket", width: 8 },
            { header: "Fecha", width: 10 },
            { header: "Manifiesto", width: 12 },
            { header: "Generador", width: 28 },
            { header: "Neto (t)", width: 10, align: "right" },
            { header: "Cloro (%)", width: 9, align: "right" },
            { header: "Resultado", width: 30 },
          ],
          rows: chlorineIssues.map(({ row, state }) => {
            const fix = receptions.find((item) => item.compensates_id === row.id && item.status === "cerrado");
            return [row.id, formatDay(row.received_on), row.manifest_folio, row.generator_name, fmt(netTons(row), 3), fmt(row.chlorine_pct, 2),
              fix ? `${CHLORINE_LABELS[state]} con ${fix.manifest_folio} (${fmt(fix.chlorine_pct, 2)} %)` : CHLORINE_LABELS[state]];
          }),
          empty: "Ningún embarque fuera de especificación.",
        },
        {
          title: "Marca de auditoría roja",
          columns: [
            { header: "Ticket", width: 8 },
            { header: "Fecha", width: 10 },
            { header: "Manifiesto", width: 12 },
            { header: "Generador", width: 30 },
            { header: "Neto (t)", width: 10, align: "right" },
            { header: "% del mes al cerrar", width: 14, align: "right" },
          ],
          rows: audit.map((row) => [row.id, formatDay(row.received_on), row.manifest_folio, row.generator_name, fmt(netTons(row), 3), fmt(row.month_pct_after, 2)]),
          empty: `Ningún ticket cerrado con la sustitución del mes en ${SEMARNAT_LIMIT} % o más.`,
        },
      ],
      generatedBy,
      fileName: `SEMARNAT_sustitucion_${year}_S${half}`,
    };
  }

  return (
    <div className="fuel-ecology">
      <div className="directory-toolbar">
        <label className="epp-check">Semestre
          <select className="epp-select" value={semester} onChange={(e) => setSemester(e.target.value)}>
            {options.map((key) => <option key={key} value={key}>{key.endsWith("1") ? "1er" : "2.º"} semestre {key.slice(0, 4)}</option>)}
          </select>
        </label>
        <span className="epp-muted">
          Sustitución del semestre: <strong>{totals.pct === null ? "sin datos" : `${fmt(totals.pct, 2)} %`}</strong>
          {totals.missing > 0 && ` · ${totals.missing} mes(es) sin coque capturado`}
        </span>
        {canEdit && <button className="button button-outline" onClick={() => onCoke()}><Fuel size={15} /> Capturar coque</button>}
        <ExportButtons className="epp-push" build={buildReport} />
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Mes</th><th>Alternos (t)</th><th className="hide-phone">Alternos (Gcal)</th><th className="hide-tablet">Coque (t)</th><th className="hide-phone">Coque (Gcal)</th><th>Sustitución</th><th className="hide-phone">Semáforo</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className={row.future ? "epp-inactive" : ""}>
                <td><strong>{monthLabel(row.month)}</strong></td>
                <td>{fmt(row.summary.alt_tons, 2)}</td>
                <td className="hide-phone">{fmt(row.summary.alt_gcal, 1)}</td>
                <td className="hide-tablet">{row.own ? fmt(row.summary.coke_tons, 1) : <span className="epp-muted">Sin capturar</span>}</td>
                <td className="hide-phone">{row.own ? fmt(row.summary.coke_gcal, 1) : "—"}</td>
                <td><strong>{row.pct === null ? "—" : `${fmt(row.pct, 1)} %`}</strong></td>
                <td className="hide-phone"><LevelBadge level={row.level} /></td>
                {canEdit && <td className="row-actions">{!row.future && <button className="text-button" onClick={() => onCoke(row.month)}>{row.own ? "Editar coque" : "Capturar coque"}</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="epp-two">
        <div>
          <h3 className="epp-sub">Acumulado por producto (masa y energía)</h3>
          <div className="table-scroll">
            <table className="employee-table">
              <thead><tr><th>Producto</th><th>Masa (t)</th><th>Energía (Gcal)</th></tr></thead>
              <tbody>
                {byProduct.map((item) => <tr key={item.key}><td><strong>{item.label}</strong><br /><small className="epp-muted">{item.detail} · {item.trips} viaje(s)</small></td><td>{fmt(item.tons, 2)}</td><td>{fmt(item.gcal, 1)}</td></tr>)}
                {byProduct.length === 0 && <tr><td colSpan={3} className="epp-empty">Sin recepciones en el semestre.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="epp-sub">Cloro fuera de especificación</h3>
          <div className="table-scroll">
            <table className="employee-table">
              <thead><tr><th>Ticket</th><th>Cloro</th><th>Resultado</th></tr></thead>
              <tbody>
                {chlorineIssues.map(({ row, state }) => (
                  <tr key={row.id}>
                    <td><strong>{row.id}</strong> · {row.manifest_folio}<br /><small className="epp-muted">{row.generator_name} · {formatDay(row.received_on)}</small></td>
                    <td>{fmt(row.chlorine_pct, 2)} %</td>
                    <td><span className={`fuel-cl fuel-cl-${state}`}>{CHLORINE_LABELS[state]}</span></td>
                  </tr>
                ))}
                {chlorineIssues.length === 0 && <tr><td colSpan={3} className="epp-empty">Ningún embarque fuera de especificación.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
