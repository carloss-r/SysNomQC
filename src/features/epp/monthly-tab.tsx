"use client";

import { useMemo } from "react";
import type { EppLedgerPage, EppMovement } from "@/lib/permissions";
import { KIND_LABELS, formatDay, todayLocal } from "./format";
import { ExportButtons } from "@/shared/reports/export-buttons";
import { LoadingState } from "@/shared/ui/loading";
import { monthKey, monthLabel } from "./people";
import { fileSafe, type Report } from "@/shared/reports/report-export";
import { useEppQuery } from "./use-epp-query";

const EMPTY: EppMovement[] = [];

export function MonthlyTab({
  site,
  version,
  monthsWithData,
  month,
  onMonth,
  onOpenWorker,
}: {
  site: string;
  version: number;
  /** Meses con movimientos (del resumen de la sede). */
  monthsWithData: string[];
  month: string;
  onMonth: (month: string) => void;
  onOpenWorker: (key: string, month: string) => void;
}) {
  const months = useMemo(() => {
    const set = new Set(monthsWithData);
    set.add(monthKey(todayLocal()));
    return Array.from(set).sort().reverse();
  }, [monthsWithData]);
  const current = month || months[0] || "";
  // Solo los movimientos del mes elegido (antes se filtraba el libro completo en el navegador).
  const { data, loading, error } = useEppQuery<EppLedgerPage>(
    current ? `/api/epp/ledger?site=${encodeURIComponent(site)}&month=${current}` : null,
    version,
  );
  const rows = data?.rows ?? EMPTY;

  const totals = useMemo(() => {
    const deliveries = rows.filter((row) => row.kind === "entrega");
    return {
      pieces: deliveries.reduce((sum, row) => sum + Math.abs(row.delta), 0),
      workers: new Set(deliveries.map((row) => row.employee_key ?? "")).size,
      entries: rows.filter((row) => row.kind === "ingreso").reduce((sum, row) => sum + row.delta, 0),
    };
  }, [rows]);

  const byArticle = useMemo(() => {
    const map = new Map<string, { name: string; out: number; in: number; adjust: number }>();
    for (const row of rows) {
      const entry = map.get(row.article_name) ?? { name: row.article_name, out: 0, in: 0, adjust: 0 };
      if (row.kind === "entrega") entry.out += Math.abs(row.delta);
      else if (row.kind === "ingreso") entry.in += row.delta;
      else entry.adjust += row.delta;
      map.set(row.article_name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.out - a.out || a.name.localeCompare(b.name, "es"));
  }, [rows]);

  const byWorker = useMemo(() => {
    const map = new Map<string, { key: string; name: string; group: string | null; pieces: number; items: Map<string, number> }>();
    for (const row of rows) {
      if (row.kind !== "entrega" || !row.employee_name) continue;
      const key = row.employee_key ?? row.employee_name;
      const entry = map.get(key) ?? { key, name: row.employee_name, group: row.employee_group, pieces: 0, items: new Map() };
      entry.pieces += Math.abs(row.delta);
      entry.items.set(row.article_name, (entry.items.get(row.article_name) ?? 0) + Math.abs(row.delta));
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.pieces - a.pieces || a.name.localeCompare(b.name, "es"));
  }, [rows]);

  function buildReport(generatedBy: string): Report {
    const period = monthLabel(current);
    return {
      title: "Control mensual de EPP",
      info: [["Sede", site], ["Periodo", period]],
      summary: [
        ["Piezas entregadas", totals.pieces],
        ["Trabajadores atendidos", totals.workers],
        ["Piezas ingresadas", totals.entries],
        ["Movimientos", rows.length],
      ],
      sections: [
        {
          title: "Por artículo",
          columns: [
            { header: "Material", width: 40 },
            { header: "Entregas", width: 12, align: "right" },
            { header: "Ingresos", width: 12, align: "right" },
            { header: "Ajustes", width: 12, align: "right" },
          ],
          rows: byArticle.map((item) => [item.name, item.out, item.in, item.adjust]),
          empty: "Sin movimientos en este mes.",
        },
        {
          title: "Por trabajador",
          columns: [
            { header: "Trabajador", width: 32 },
            { header: "Grupo", width: 16 },
            { header: "Piezas", width: 10, align: "right" },
            { header: "Qué recibió", width: 60 },
          ],
          rows: byWorker.map((item) => [item.name, item.group ?? "", item.pieces, Array.from(item.items, ([name, qty]) => `${name} (${qty})`).join(", ")]),
          empty: "Sin entregas en este mes.",
        },
        {
          title: "Detalle de movimientos",
          columns: [
            { header: "Fecha", width: 12 },
            { header: "Movimiento", width: 12 },
            { header: "Trabajador", width: 28 },
            { header: "Grupo", width: 12 },
            { header: "Puesto", width: 18 },
            { header: "Artículo", width: 30 },
            { header: "Piezas", width: 9, align: "right" },
            { header: "Registró", width: 20 },
            { header: "Notas", width: 26 },
          ],
          rows: [...rows].reverse().map((row) => [
            formatDay(row.moved_on), KIND_LABELS[row.kind], row.employee_name ?? "", row.employee_group ?? "", row.employee_position ?? "",
            row.article_name, row.delta, row.historical ? "Importación Excel" : row.created_by_name ?? "", row.notes ?? "",
          ]),
          empty: "Sin movimientos en este mes.",
        },
      ],
      generatedBy,
      fileName: `EPP_Control_mensual_${fileSafe(site)}_${fileSafe(period)}`,
    };
  }

  return (
    <div className="epp-monthly">
      <div className="directory-toolbar">
        <label className="epp-check">Mes
          <select className="epp-select" value={current} onChange={(e) => onMonth(e.target.value)}>
            {months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}
          </select>
        </label>
        <span className="epp-muted">{totals.pieces} piezas entregadas a {totals.workers} trabajadores · {totals.entries} piezas ingresadas</span>
        <ExportButtons className="epp-push" build={buildReport} disabled={rows.length === 0 || loading} />
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading && !data ? <LoadingState label={`Cargando ${monthLabel(current)}…`} rows={5} /> : (

      <div className="epp-two">
        <div>
          <h3 className="epp-sub">Por artículo</h3>
          <div className="table-scroll">
            <table className="employee-table">
              <thead><tr><th>Material</th><th>Entregas</th><th className="hide-phone">Ingresos</th><th className="hide-phone">Ajustes</th></tr></thead>
              <tbody>
                {byArticle.map((item) => (
                  <tr key={item.name}><td><strong>{item.name}</strong></td><td className="epp-out">{item.out ? `−${item.out}` : "—"}</td><td className="epp-in hide-phone">{item.in ? `+${item.in}` : "—"}</td><td className="hide-phone">{item.adjust ? (item.adjust > 0 ? `+${item.adjust}` : item.adjust) : "—"}</td></tr>
                ))}
                {byArticle.length === 0 && <tr><td colSpan={4} className="epp-empty">Sin movimientos en este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="epp-sub">Por trabajador</h3>
          <div className="table-scroll">
            <table className="employee-table">
              <thead><tr><th>Trabajador</th><th>Piezas</th><th className="hide-phone">Qué recibió</th></tr></thead>
              <tbody>
                {byWorker.map((item) => (
                  <tr key={item.key}>
                    <td><button className="epp-link" onClick={() => onOpenWorker(item.key, current)}>{item.name}</button><br /><small className="epp-muted">{item.group ?? ""}</small></td>
                    <td>{item.pieces}</td>
                    <td className="epp-muted hide-phone">{Array.from(item.items, ([name, qty]) => `${name} (${qty})`).join(", ")}</td>
                  </tr>
                ))}
                {byWorker.length === 0 && <tr><td colSpan={3} className="epp-empty">Sin entregas en este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
