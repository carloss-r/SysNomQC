"use client";

import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { EppMovement } from "@/lib/permissions";
import { SiteBadge } from "@/shared/ui/badges";
import { formatDateTime, formatDay, KIND_LABELS } from "./format";

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
            <tr><th>Fecha</th><th>Movimiento</th><th>Artículo</th><th>Cantidad</th><th>Trabajador</th><th>Registró</th><th>Notas</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDay(row.moved_on)}</td>
                <td><span className={`epp-kind epp-kind-${row.kind}`}>{KIND_LABELS[row.kind]}</span></td>
                <td><strong>{row.article_name}</strong><br /><small className="epp-muted">Quedó en {row.stock_after}</small></td>
                <td className={row.delta < 0 ? "epp-out" : "epp-in"}>{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
                <td>
                  {row.employee_name ? (
                    <>
                      <strong>{row.employee_name}</strong><br />
                      <small className="epp-muted">{row.employee_code} </small>{row.site && <SiteBadge site={row.site} />}
                    </>
                  ) : "—"}
                </td>
                <td>{row.created_by_name ?? "—"}<br /><small className="epp-muted">{formatDateTime(row.created_at)}</small></td>
                <td>{row.notes ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="epp-empty">No hay movimientos con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
