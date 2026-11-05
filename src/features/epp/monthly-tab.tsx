"use client";

import { Download } from "lucide-react";
import { useMemo } from "react";
import type { EppMovement } from "@/lib/permissions";
import { KIND_LABELS, formatDay } from "./format";
import { downloadCsv, monthKey, monthLabel, normalize } from "./people";

export function MonthlyTab({
  movements,
  month,
  onMonth,
  onOpenWorker,
}: {
  movements: EppMovement[];
  month: string;
  onMonth: (month: string) => void;
  onOpenWorker: (key: string, month: string) => void;
}) {
  const months = useMemo(() => {
    const set = new Set(movements.map((row) => monthKey(row.moved_on)));
    set.add(monthKey(new Date().toISOString()));
    return Array.from(set).sort().reverse();
  }, [movements]);
  const current = month || months[0] || "";
  const rows = useMemo(() => movements.filter((row) => monthKey(row.moved_on) === current), [movements, current]);

  const totals = useMemo(() => {
    const deliveries = rows.filter((row) => row.kind === "entrega");
    return {
      pieces: deliveries.reduce((sum, row) => sum + Math.abs(row.delta), 0),
      workers: new Set(deliveries.map((row) => normalize(row.employee_name ?? ""))).size,
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
      const key = normalize(row.employee_name);
      const entry = map.get(key) ?? { key, name: row.employee_name, group: row.employee_group, pieces: 0, items: new Map() };
      entry.pieces += Math.abs(row.delta);
      entry.items.set(row.article_name, (entry.items.get(row.article_name) ?? 0) + Math.abs(row.delta));
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.pieces - a.pieces || a.name.localeCompare(b.name, "es"));
  }, [rows]);

  function exportCsv() {
    downloadCsv(`EPP-${current}.csv`, [
      ["Fecha", "Movimiento", "Trabajador", "Grupo", "Puesto", "Artículo", "Piezas", "Registró", "Notas"],
      ...[...rows].reverse().map((row) => [
        formatDay(row.moved_on), KIND_LABELS[row.kind], row.employee_name ?? "", row.employee_group ?? "", row.employee_position ?? "",
        row.article_name, row.delta, row.historical ? "Importación Excel" : row.created_by_name ?? "", row.notes ?? "",
      ]),
    ]);
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
        <button className="button button-outline epp-push" onClick={exportCsv} disabled={rows.length === 0}><Download size={16} /> Descargar reporte</button>
      </div>

      <div className="epp-two">
        <div>
          <h3 className="epp-sub">Por artículo</h3>
          <div className="table-scroll">
            <table className="employee-table">
              <thead><tr><th>Material</th><th>Entregas</th><th>Ingresos</th><th>Ajustes</th></tr></thead>
              <tbody>
                {byArticle.map((item) => (
                  <tr key={item.name}><td><strong>{item.name}</strong></td><td className="epp-out">{item.out ? `−${item.out}` : "—"}</td><td className="epp-in">{item.in ? `+${item.in}` : "—"}</td><td>{item.adjust ? (item.adjust > 0 ? `+${item.adjust}` : item.adjust) : "—"}</td></tr>
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
              <thead><tr><th>Trabajador</th><th>Piezas</th><th>Qué recibió</th></tr></thead>
              <tbody>
                {byWorker.map((item) => (
                  <tr key={item.key}>
                    <td><button className="epp-link" onClick={() => onOpenWorker(item.key, current)}>{item.name}</button><br /><small className="epp-muted">{item.group ?? ""}</small></td>
                    <td>{item.pieces}</td>
                    <td className="epp-muted">{Array.from(item.items, ([name, qty]) => `${name} (${qty})`).join(", ")}</td>
                  </tr>
                ))}
                {byWorker.length === 0 && <tr><td colSpan={3} className="epp-empty">Sin entregas en este mes.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
