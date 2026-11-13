"use client";

import { AlertTriangle, Ban, Check, ChevronDown, ClipboardList, FileDown, ShoppingCart, Truck, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { EppPurchaseRequest, PurchaseStatus } from "@/lib/permissions";
import { purchaseShortItems } from "@/lib/notifications";
import { SiteBadge } from "@/shared/ui/badges";
import { formatDateTime } from "./format";
import { PURCHASE_STATUS_LABELS } from "./purchase-pdf";
import { LoadingState, RowBusy } from "@/shared/ui/loading";

const FILTERS: { key: "open" | "all" | PurchaseStatus; label: string }[] = [
  { key: "open", label: "Abiertas" },
  { key: "pendiente", label: "Pendientes" },
  { key: "en_compra", label: "Por contar" },
  { key: "recibida", label: "Recibidas" },
  { key: "cancelada", label: "Canceladas" },
  { key: "all", label: "Todas" },
];

const isOpen = (status: PurchaseStatus) => status === "pendiente" || status === "en_compra";

export function RequestsTab({
  site,
  requests,
  loading,
  buyer,
  canManage,
  canRequest,
  superAdmin,
  busyId,
  onCancel,
  onBuy,
  onCount,
  onAck,
  onPdf,
  onNew,
}: {
  /** Sede elegida arriba: solo se listan sus solicitudes. */
  site: string;
  requests: EppPurchaseRequest[];
  loading: boolean;
  buyer: boolean;
  canManage: boolean;
  canRequest: boolean;
  superAdmin: boolean;
  busyId: number | null;
  onCancel: (request: EppPurchaseRequest) => void;
  /** Compras: registrar (o corregir antes del conteo) la cantidad comprada. */
  onBuy: (request: EppPurchaseRequest) => void;
  /** Seguridad: conteo ciego de lo que llegó. */
  onCount: (request: EppPurchaseRequest) => void;
  /** Compras: enterado del faltante. */
  onAck: (request: EppPurchaseRequest) => void;
  onPdf: (requests: EppPurchaseRequest[]) => void;
  onNew?: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("open");

  const rows = useMemo(
    () =>
      requests.filter((row) => {
        if (row.site !== site) return false;
        if (filter === "all") return true;
        if (filter === "open") return isOpen(row.status);
        return row.status === filter;
      }),
    [requests, filter, site],
  );
  const openRows = rows.filter((row) => isOpen(row.status));
  const countFor = (key: (typeof FILTERS)[number]["key"]) =>
    requests.filter((row) => row.site === site && (key === "all" || (key === "open" ? isOpen(row.status) : row.status === key))).length;

  return (
    <>
      <div className="directory-toolbar">
        <div className="site-tabs" role="group" aria-label="Estado de la solicitud">
          {FILTERS.map((item) => (
            <button key={item.key} type="button" aria-pressed={filter === item.key} className={`site-tab${filter === item.key ? " active" : ""}`} onClick={() => setFilter(item.key)}>
              {item.label} ({countFor(item.key)})
            </button>
          ))}
        </div>
        <span className="epp-scope">Solicitudes de <strong>{site}</strong></span>
        <div className="epp-push epp-toolbar-actions">
          {canRequest && onNew && <button type="button" className="button button-outline" onClick={onNew}><ShoppingCart size={15} /> Pedir material</button>}
          {openRows.length > 0 && (
            <button type="button" className="button button-gold" onClick={() => onPdf(openRows)}>
              <FileDown size={15} /> PDF de {openRows.length === 1 ? "la abierta" : `las ${openRows.length} abiertas`} de {site}
            </button>
          )}
        </div>
      </div>

      {loading && <LoadingState label="Cargando solicitudes…" rows={3} />}
      {!loading && rows.length === 0 && (
        <p className="epp-empty">{filter === "open" ? `No hay solicitudes abiertas en ${site}. Cuando falte material, pídelo desde el inventario.` : `No hay solicitudes de ${site} con ese filtro.`}</p>
      )}

      <ul className="epp-requests">
        {rows.map((row) => {
          const pieces = row.items.reduce((sum, item) => sum + item.quantity, 0);
          const busy = busyId === row.id;
          const purchased = row.status !== "pendiente" && row.status !== "cancelada";
          const uncounted = row.items.filter((item) => item.received_qty === null).length;
          const counting = row.items.length - uncounted > 0;
          const short = buyer ? purchaseShortItems(row.items) : [];
          const canBuy = buyer && isOpen(row.status) && !counting;
          const canCount = canManage && row.status === "en_compra" && uncounted > 0;
          // Lo pendiente lo cancela Compras o quien pide; una compra registrada, solo el SuperAdmin (sin conteos).
          const canCancel = isOpen(row.status) && !counting && (superAdmin || (row.status === "pendiente" && (buyer || canRequest)));
          return (
            <li key={row.id} className={`epp-request epp-request-${row.status}`}>
              <details open={rows.length === 1}>
                <summary>
                  <span className="epp-request-folio">Folio {row.id}</span>
                  <SiteBadge site={row.site} />
                  <span className={`epp-status epp-status-${row.status}`}>{PURCHASE_STATUS_LABELS[row.status]}</span>
                  {short.length > 0 && !row.shortage_ack_at && <span className="epp-status epp-status-faltante">Llegó menos</span>}
                  <span className="epp-requester" title="Quién hizo la solicitud"><UserRound size={14} /> Solicitó: <strong>{row.requested_by_name ?? "Sin nombre"}</strong></span>
                  <span className="epp-request-meta">
                    {row.items.length} artículo(s) · {pieces} pza · {formatDateTime(row.created_at)}
                  </span>
                  <ChevronDown size={16} className="epp-request-chevron" />
                </summary>

                <div className="epp-request-body">
                  <p className="epp-request-note epp-request-who">Solicitada por <strong>{row.requested_by_name ?? "Sin nombre"}</strong> para <strong>{row.site}</strong> · {formatDateTime(row.created_at)}</p>
                  <div className="table-scroll">
                    <table className="employee-table">
                      <thead>
                        <tr>
                          <th>Artículo</th>
                          <th>Solicitado</th>
                          {buyer && purchased && <th>Comprado</th>}
                          {purchased && <th>Contado</th>}
                          {!purchased && <th className="hide-phone">Había al pedir</th>}
                          {!purchased && <th className="hide-phone">Mínimo</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {row.items.map((item) => {
                          const isShort = short.includes(item);
                          return (
                            <tr key={item.article_id} className={isShort ? "epp-short-row" : ""}>
                              <td><strong>{item.article_name}</strong>{!purchased && <small className="epp-muted show-phone">Había {item.stock_at_request} · mín. {item.min_stock}</small>}</td>
                              <td><strong>{item.quantity}</strong> <span className="epp-muted">{item.unit.toLowerCase()}</span></td>
                              {buyer && purchased && <td>{item.purchased_qty ?? "—"}</td>}
                              {purchased && (
                                <td>
                                  {item.received_qty === null ? (
                                    <span className="epp-requested">Por contar</span>
                                  ) : (
                                    <>
                                      <strong>{item.received_qty}</strong>
                                      {isShort && <span className="epp-short"> faltan {(item.purchased_qty ?? 0) - item.received_qty}</span>}
                                      <small className="epp-muted hide-phone"><br />{item.counted_by_name ?? "—"} · {item.counted_at ? formatDateTime(item.counted_at) : ""}</small>
                                    </>
                                  )}
                                </td>
                              )}
                              {!purchased && <td className="hide-phone">{item.stock_at_request}</td>}
                              {!purchased && <td className="hide-phone">{item.min_stock}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {row.notes && <p className="epp-request-note"><strong>Observaciones:</strong> {row.notes}</p>}
                  {row.purchased_by_name && (
                    <p className="epp-muted epp-request-note">Compra registrada por {row.purchased_by_name}{row.purchased_at ? ` · ${formatDateTime(row.purchased_at)}` : ""}</p>
                  )}
                  {row.handled_by_name && (
                    <p className="epp-muted epp-request-note">Último cambio: {row.handled_by_name} · {formatDateTime(row.updated_at)}{row.status_note ? ` · ${row.status_note}` : ""}</p>
                  )}
                  {buyer && short.length > 0 && (
                    <p className="epp-shortage" role="status">
                      <AlertTriangle size={15} />
                      <span>
                        Llegó menos de lo comprado en {short.length} artículo(s).
                        {row.shortage_ack_at ? ` Enterado: ${row.shortage_ack_by_name ?? "—"} · ${formatDateTime(row.shortage_ack_at)}.` : " Revisa con el proveedor."}
                      </span>
                    </p>
                  )}
                  {canCount && (
                    <p className="epp-request-note epp-count-hint"><ClipboardList size={15} /> {uncounted} artículo(s) por contar. No se pueden entregar ni mover hasta contarlos.</p>
                  )}

                  <div className="epp-request-actions">
                    {busy && <RowBusy />}
                    <button type="button" className="button button-outline" onClick={() => onPdf([row])}><FileDown size={15} /> Descargar PDF</button>
                    {canBuy && (
                      <button type="button" className="button button-primary" disabled={busy} onClick={() => onBuy(row)}>
                        <Truck size={15} /> {row.status === "pendiente" ? "Registrar compra" : "Corregir compra"}
                      </button>
                    )}
                    {canCount && (
                      <button type="button" className="button button-gold" disabled={busy} onClick={() => onCount(row)}><ClipboardList size={15} /> Contar lo que llegó</button>
                    )}
                    {buyer && short.length > 0 && !row.shortage_ack_at && (
                      <button type="button" className="button button-outline" disabled={busy} onClick={() => onAck(row)}><Check size={15} /> Enterado del faltante</button>
                    )}
                    {canCancel && (
                      <button type="button" className="button button-danger-outline" disabled={busy} onClick={() => onCancel(row)}><Ban size={15} /> Cancelar</button>
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
