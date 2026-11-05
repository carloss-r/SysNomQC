"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { EppMovement } from "@/lib/permissions";
import { SiteBadge } from "@/shared/ui/badges";
import { formatDateTime, formatDay, KIND_LABELS } from "./format";

const MAX_ROWS = 300;

const FILTERS = [
  { key: "all", label: "Todo" },
  { key: "entrega", label: "Entregas" },
  { key: "ingreso", label: "Ingresos" },
  { key: "ajuste", label: "Ajustes" },
] as const;

export function HistoryTab({ movements }: { movements: EppMovement[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return movements.filter((row) => {
      if (filter !== "all" && row.kind !== filter) return false;
      if (!term) return true;
      return [row.article_name, row.employee_name, row.employee_code, row.created_by_name, row.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [movements, filter, query]);

  return (
    <>
      <div className="directory-toolbar">
        <div className="site-tabs" role="tablist">
          {FILTERS.map((item) => (
            <button key={item.key} role="tab" aria-selected={filter === item.key} className={`site-tab${filter === item.key ? " active" : ""}`} onClick={() => setFilter(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar artículo, trabajador o quién registró" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Fecha</th><th className="hide-phone">Movimiento</th><th>Artículo</th><th>Cantidad</th><th className="hide-phone">Trabajador</th><th className="hide-tablet">Registró</th><th className="hide-tablet">Notas</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((row) => (
              <tr key={row.id}>
                <td>{formatDay(row.moved_on)}</td>
                <td className="hide-phone"><span className={`epp-kind epp-kind-${row.kind}`}>{KIND_LABELS[row.kind]}</span></td>
                <td><strong>{row.article_name}</strong><br />{row.stock_after !== null && <small className="epp-muted hide-phone">Quedó en {row.stock_after}</small>}<small className="epp-muted show-phone">{row.employee_name ?? KIND_LABELS[row.kind]}</small></td>
                <td className={row.delta < 0 ? "epp-out" : "epp-in"}>{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
                <td className="hide-phone">
                  {row.employee_name ? (
                    <>
                      <strong>{row.employee_name}</strong><br />
                      <small className="epp-muted">{row.employee_code} </small>{row.site && <SiteBadge site={row.site} />}
                    </>
                  ) : "—"}
                </td>
                <td className="hide-tablet">{row.historical ? <span className="epp-muted">Importación Excel</span> : <>{row.created_by_name ?? "—"}<br /><small className="epp-muted">{formatDateTime(row.created_at)}</small></>}</td>
                <td className="hide-tablet">{row.notes ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="epp-empty">No hay movimientos con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && <p className="epp-more">Mostrando {MAX_ROWS} de {rows.length}. Usa la búsqueda o el Control mensual para acotar.</p>}
    </>
  );
}
