"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import type { EppLedgerPage } from "@/lib/permissions";
import { SiteBadge } from "@/shared/ui/badges";
import { LoadingState } from "@/shared/ui/loading";
import { formatDateTime, formatDay, KIND_LABELS } from "./format";
import { Pager } from "./pager";
import { useDebounced, useEppQuery } from "./use-epp-query";

/** Movimientos por página: el servidor solo manda esta cantidad (antes llegaba el libro completo). */
const PAGE_SIZE = 50;

const FILTERS = [
  { key: "all", label: "Todo" },
  { key: "entrega", label: "Entregas" },
  { key: "ingreso", label: "Ingresos" },
  { key: "ajuste", label: "Ajustes" },
] as const;

export function HistoryTab({ site, version }: { site: string; version: number }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(query.trim());

  const params = new URLSearchParams({ site, page: String(page), size: String(PAGE_SIZE) });
  if (filter !== "all") params.set("kind", filter);
  if (term) params.set("q", term);
  const { data, loading, error } = useEppQuery<EppLedgerPage>(`/api/epp/ledger?${params}`, version);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  // La página quedó fuera de rango (se borraron filtros o cambió la sede): se regresa a la primera.
  if (data && !loading && rows.length === 0 && page > 0) setPage(0);

  return (
    <>
      <div className="directory-toolbar">
        <div className="site-tabs" role="tablist">
          {FILTERS.map((item) => (
            <button key={item.key} role="tab" aria-selected={filter === item.key} className={`site-tab${filter === item.key ? " active" : ""}`} onClick={() => { setFilter(item.key); setPage(0); }}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Buscar artículo, trabajador o quién registró" />
          {query && <button type="button" onClick={() => { setQuery(""); setPage(0); }} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {!data && loading ? (
        <LoadingState label="Cargando historial…" rows={6} />
      ) : (
        <>
          <div className="table-scroll">
            <table className="employee-table">
              <thead>
                <tr><th>Fecha</th><th className="hide-phone">Movimiento</th><th>Artículo</th><th>Cantidad</th><th className="hide-phone">Trabajador</th><th className="hide-tablet">Registró</th><th className="hide-tablet">Notas</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                {rows.length === 0 && !loading && <tr><td colSpan={7} className="epp-empty">No hay movimientos con ese filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={page} size={PAGE_SIZE} shown={rows.length} total={total} noun={["movimiento", "movimientos"]} loading={loading} onPage={setPage} />
        </>
      )}
    </>
  );
}
