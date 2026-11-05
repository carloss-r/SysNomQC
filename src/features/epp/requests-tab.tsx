"use client";

import { Ban, ChevronDown, FileDown, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { SITES } from "@/lib/employees";
import type { EppPurchaseRequest, PurchaseStatus } from "@/lib/permissions";
import { SiteBadge } from "@/shared/ui/badges";
import { formatDateTime } from "./format";
import { PURCHASE_STATUS_LABELS } from "./purchase-pdf";

const FILTERS: { key: "open" | "all" | PurchaseStatus; label: string }[] = [
  { key: "open", label: "Abiertas" },
  { key: "pendiente", label: "Pendientes" },
  { key: "en_compra", label: "En compra" },
  { key: "recibida", label: "Recibidas" },
  { key: "cancelada", label: "Canceladas" },
  { key: "all", label: "Todas" },
];

const isOpen = (status: PurchaseStatus) => status === "pendiente" || status === "en_compra";

export function RequestsTab({
  requests,
  loading,
  buyer,
  canManage,
  canRequest,
  showSiteFilter,
  busyId,
  onStatus,
  onReceive,
  onPdf,
  onNew,
}: {
  requests: EppPurchaseRequest[];
  loading: boolean;
  buyer: boolean;
  canManage: boolean;
  canRequest: boolean;
  showSiteFilter: boolean;
  busyId: number | null;
  onStatus: (request: EppPurchaseRequest, status: "en_compra" | "recibida" | "cancelada") => void;
  onReceive: (request: EppPurchaseRequest) => void;
  onPdf: (requests: EppPurchaseRequest[]) => void;
  onNew?: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");
  const [site, setSite] = useState("");

  const rows = useMemo(
    () =>
      requests.filter((row) => {
        if (site && row.site !== site) return false;
        if (filter === "all") return true;
        if (filter === "open") return isOpen(row.status);
        return row.status === filter;
      }),
    [requests, filter, site],
  );
  const openRows = rows.filter((row) => isOpen(row.status));

  return (
    <>
      <div className="directory-toolbar">
        <div className="site-tabs" role="group" aria-label="Estado de la solicitud">
          {FILTERS.map((item) => (
            <button key={item.key} type="button" aria-pressed={filter === item.key} className={`site-tab${filter === item.key ? " active" : ""}`} onClick={() => setFilter(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        {showSiteFilter && (
          <select className="epp-select" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Filtrar por sede">
            <option value="">Todas las sedes</option>
            {SITES.map((item) => <option key={item}>{item}</option>)}
          </select>
        )}
        <div className="epp-push epp-toolbar-actions">
          {canRequest && onNew && <button type="button" className="button button-outline" onClick={onNew}><ShoppingCart size={15} /> Pedir material</button>}
          {openRows.length > 0 && (
            <button type="button" className="button button-gold" onClick={() => onPdf(openRows)}>
              <FileDown size={15} /> PDF de {openRows.length === 1 ? "la abierta" : `las ${openRows.length} abiertas`}
            </button>
          )}
        </div>
      </div>

      {loading && <p className="epp-empty">Cargando solicitudes…</p>}
      {!loading && rows.length === 0 && (
        <p className="epp-empty">{filter === "open" ? "No hay solicitudes abiertas. Cuando falte material, pídelo desde el inventario." : "No hay solicitudes con ese filtro."}</p>
      )}

      <ul className="epp-requests">
        {rows.map((row) => {
          const pieces = row.items.reduce((sum, item) => sum + item.quantity, 0);
          const busy = busyId === row.id;
          return (
            <li key={row.id} className={`epp-request epp-request-${row.status}`}>
              <details open={rows.length === 1}>
                <summary>
                  <span className="epp-request-folio">Folio {row.id}</span>
                  <SiteBadge site={row.site} />
                  <span className={`epp-status epp-status-${row.status}`}>{PURCHASE_STATUS_LABELS[row.status]}</span>
                  <span className="epp-request-meta">
                    {row.items.length} artículo(s) · {pieces} pza · {row.requested_by_name ?? "Sin nombre"} · {formatDateTime(row.created_at)}
                  </span>
                  <ChevronDown size={16} className="epp-request-chevron" />
                </summary>

                <div className="epp-request-body">
                  <div className="table-scroll">
                    <table className="employee-table">
                      <thead><tr><th>Artículo</th><th>Cantidad</th><th className="hide-phone">Había al pedir</th><th className="hide-phone">Mínimo</th></tr></thead>
                      <tbody>
                        {row.items.map((item) => (
                          <tr key={item.article_id}>
                            <td><strong>{item.article_name}</strong><small className="epp-muted show-phone">Había {item.stock_at_request} · mín. {item.min_stock}</small></td>
                            <td><strong>{item.quantity}</strong> <span className="epp-muted">{item.unit.toLowerCase()}</span></td>
                            <td className="hide-phone">{item.stock_at_request}</td>
                            <td className="hide-phone">{item.min_stock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {row.notes && <p className="epp-request-note"><strong>Observaciones:</strong> {row.notes}</p>}
                  {row.handled_by_name && (
                    <p className="epp-muted epp-request-note">Último cambio: {row.handled_by_name} · {formatDateTime(row.updated_at)}{row.status_note ? ` · ${row.status_note}` : ""}</p>
                  )}

                  <div className="epp-request-actions">
                    <button type="button" className="button button-outline" onClick={() => onPdf([row])}><FileDown size={15} /> Descargar PDF</button>
                    {buyer && row.status === "pendiente" && (
                      <button type="button" className="button button-primary" disabled={busy} onClick={() => onStatus(row, "en_compra")}><Truck size={15} /> Marcar en compra</button>
                    )}
                    {isOpen(row.status) && canManage && (
                      <button type="button" className="button button-gold" disabled={busy} onClick={() => onReceive(row)}><PackageCheck size={15} /> Registrar llegada</button>
                    )}
                    {isOpen(row.status) && buyer && !canManage && (
                      <button type="button" className="button button-outline" disabled={busy} onClick={() => onStatus(row, "recibida")}><PackageCheck size={15} /> Marcar recibida</button>
                    )}
                    {(buyer ? isOpen(row.status) : row.status === "pendiente" && canRequest) && (
                      <button type="button" className="button button-danger-outline" disabled={busy} onClick={() => onStatus(row, "cancelada")}><Ban size={15} /> Cancelar</button>
                    )}
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
