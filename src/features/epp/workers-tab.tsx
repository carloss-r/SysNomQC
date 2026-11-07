"use client";

import { ClipboardCheck, Download, Search, UserRound, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import type { EppEmployee, EppMovement } from "@/lib/permissions";
import { formatDateTime, formatDay } from "./format";
import { buildPeople, downloadCsv, monthKey, monthLabel, normalize, type Person } from "./people";

const MAX_RESULTS = 5;

export function WorkersTab({
  movements,
  employees,
  canDeliver,
  selectedKey,
  month,
  onSelect,
  onMonth,
  onDeliver,
}: {
  movements: EppMovement[];
  employees: EppEmployee[];
  canDeliver: boolean;
  selectedKey: string | null;
  month: string;
  onSelect: (key: string | null) => void;
  onMonth: (month: string) => void;
  onDeliver: (employee: EppEmployee) => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const people = useMemo(() => buildPeople(movements), [movements]);
  const indexed = useMemo(() => people.map((person) => ({ person, text: normalize(`${person.name} ${person.position ?? ""} ${person.group ?? ""}`) })), [people]);

  const { results, extra } = useMemo(() => {
    const tokens = normalize(deferred).split(" ").filter(Boolean);
    if (tokens.length === 0) {
      const recent = [...people].sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, MAX_RESULTS);
      return { results: recent, extra: 0 };
    }
    const found = indexed
      .filter((entry) => tokens.every((token) => entry.text.includes(token)))
      .map((entry) => entry.person);
    return { results: found.slice(0, MAX_RESULTS), extra: Math.max(0, found.length - MAX_RESULTS) };
  }, [people, indexed, deferred]);

  const person = people.find((item) => item.key === selectedKey) ?? null;
  const rows = useMemo(
    () => (person ? movements.filter((row) => row.kind === "entrega" && row.employee_name && normalize(row.employee_name) === person.key) : []),
    [movements, person],
  );
  const months = useMemo(() => Array.from(new Set(rows.map((row) => monthKey(row.moved_on)))).sort().reverse(), [rows]);
  const visible = useMemo(() => (month ? rows.filter((row) => monthKey(row.moved_on) === month) : rows), [rows, month]);

  const summary = useMemo(() => {
    const map = new Map<string, { name: string; pieces: number; times: number; last: string }>();
    for (const row of visible) {
      const entry = map.get(row.article_name) ?? { name: row.article_name, pieces: 0, times: 0, last: row.moved_on };
      entry.pieces += Math.abs(row.delta);
      entry.times += 1;
      if (row.moved_on > entry.last) entry.last = row.moved_on;
      map.set(row.article_name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.pieces - a.pieces);
  }, [visible]);

  const grid = useMemo(() => {
    if (!month) return null;
    const [year, mon] = month.split("-").map(Number);
    const days = new Date(year ?? 2026, mon ?? 1, 0).getDate();
    const cells = new Map<string, Map<number, number>>();
    for (const row of visible) {
      const day = Number(row.moved_on.slice(8, 10));
      const line = cells.get(row.article_name) ?? new Map<number, number>();
      line.set(day, (line.get(day) ?? 0) + Math.abs(row.delta));
      cells.set(row.article_name, line);
    }
    return { days, cells };
  }, [visible, month]);

  function employeeFor(target: Person): EppEmployee | null {
    return employees.find((item) => item.id === target.employeeId || normalize(item.full_name) === target.key) ?? null;
  }

  function exportCsv() {
    if (!person) return;
    downloadCsv(`EPP-${person.name.replace(/\s+/g, "_")}${month ? `-${month}` : ""}.csv`, [
      ["Fecha", "Artículo", "Piezas", "Registró", "Notas"],
      ...visible.map((row) => [formatDay(row.moved_on), row.article_name, Math.abs(row.delta), row.created_by_name ?? "", row.notes ?? ""]),
    ]);
  }

  return (
    <div className="epp-workers">
      <div className="epp-workers-search">
        <label className="search-box epp-search">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca un trabajador por nombre, puesto o grupo" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
        <p className="epp-muted">{query.trim() ? "Resultados" : "Entregas más recientes"}</p>
        <ul className="epp-results epp-people">
          {results.length === 0 && <li className="epp-empty">Sin coincidencias.</li>}
          {results.map((item) => (
            <li key={item.key}>
              <button type="button" className={item.key === selectedKey ? "active" : ""} onClick={() => onSelect(item.key)}>
                <strong title={item.name}>{item.name}</strong>
                <small>{[item.position, item.group].filter(Boolean).join(" · ") || "—"} · {item.pieces} pza en {item.deliveries} entregas</small>
              </button>
            </li>
          ))}
          {extra > 0 && <li className="epp-more">{extra} más… sigue escribiendo para acotar</li>}
        </ul>
      </div>

      <div className="epp-worker-detail">
        {!person ? (
          <div className="epp-empty"><UserRound size={28} /><p>Elige un trabajador para ver todo el EPP que se le ha entregado.</p></div>
        ) : (
          <>
            <header className="epp-worker-head">
              <div>
                <h2>{person.name}</h2>
                <p>{[person.position, person.group].filter(Boolean).join(" · ") || "Sin puesto registrado"}</p>
              </div>
              <div className="epp-header-actions">
                {canDeliver && employeeFor(person) && (
                  <button className="button button-gold" onClick={() => onDeliver(employeeFor(person) as EppEmployee)}><ClipboardCheck size={16} /> Entregar EPP</button>
                )}
                <button className="button button-outline" onClick={exportCsv}><Download size={16} /> Descargar</button>
              </div>
            </header>

            <div className="epp-filters">
              <label className="epp-check">Periodo
                <select className="epp-select" value={month} onChange={(e) => onMonth(e.target.value)}>
                  <option value="">Todo el historial</option>
                  {months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}
                </select>
              </label>
              <span className="epp-muted">{visible.reduce((sum, row) => sum + Math.abs(row.delta), 0)} piezas en {visible.length} entregas</span>
            </div>

            <h3 className="epp-sub">Artículos entregados</h3>
            <div className="table-scroll">
              <table className="employee-table">
                <thead><tr><th>Artículo</th><th>Piezas</th><th className="hide-phone">Veces</th><th>Última entrega</th></tr></thead>
                <tbody>
                  {summary.map((item) => (
                    <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.pieces}</td><td className="hide-phone">{item.times}</td><td>{formatDay(item.last)}</td></tr>
                  ))}
                  {summary.length === 0 && <tr><td colSpan={4} className="epp-empty">Sin entregas en este periodo.</td></tr>}
                </tbody>
              </table>
            </div>

            {grid && summary.length > 0 && (
              <>
                <h3 className="epp-sub hide-phone">Control diario de {monthLabel(month)}</h3>
                <div className="table-scroll hide-phone">
                  <table className="epp-grid">
                    <thead>
                      <tr><th>Material</th>{Array.from({ length: grid.days }, (_, index) => <th key={index}>{index + 1}</th>)}</tr>
                    </thead>
                    <tbody>
                      {summary.map((item) => (
                        <tr key={item.name}>
                          <th>{item.name}</th>
                          {Array.from({ length: grid.days }, (_, index) => {
                            const qty = grid.cells.get(item.name)?.get(index + 1);
                            return <td key={index} className={qty ? "has" : ""}>{qty ?? ""}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3 className="epp-sub">Detalle de entregas</h3>
            <div className="table-scroll">
              <table className="employee-table">
                <thead><tr><th>Fecha</th><th>Artículo</th><th>Piezas</th><th className="hide-phone">Entregó / registró</th><th className="hide-tablet">Notas</th></tr></thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDay(row.moved_on)}</td>
                      <td>{row.article_name}</td>
                      <td>{Math.abs(row.delta)}</td>
                      <td className="hide-phone">{row.historical ? <span className="epp-muted">Importado de Excel</span> : <>{row.created_by_name ?? "—"}<br /><small className="epp-muted">{formatDateTime(row.created_at)}</small></>}</td>
                      <td className="hide-tablet">{row.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
