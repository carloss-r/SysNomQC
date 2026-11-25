"use client";

import { Copy, Download, ExternalLink, History, Lock, Receipt, Save, ScanText, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { formatMoney, INVOICE_EVENT_LABELS, type Invoice, type InvoiceEvent } from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { formatDateTime, formatDay } from "@/features/fuels/format";
import { fileSafe } from "@/shared/reports/report-export";
import { useNotify } from "@/shared/ui/notice-provider";
import { LoadingState } from "@/shared/ui/loading";
import { downloadText, openInvoiceFile } from "./files";
import { PdfPages } from "./pdf-pages";
import { PaymentBadge, StageSquares } from "./stage-badge";
import type { Detected } from "./upload-modal";

type Doc = "invoice" | "receipt" | "complement";

const DOC_LABELS: Record<Doc, string> = { invoice: "Factura", receipt: "Contrarecibo", complement: "Complemento" };

function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="invoice-value">
      <span>{label}</span>
      <strong>{children ?? "—"}</strong>
    </div>
  );
}

function eventDetail(event: InvoiceEvent): string {
  const detail = event.detail ?? {};
  const parts: string[] = [];
  if (typeof detail.archivo === "string") parts.push(detail.archivo);
  if (typeof detail.fecha_pago === "string") parts.push(`cobro previsto ${formatDay(detail.fecha_pago)}`);
  if (detail.verificado === true) parts.push("UUID verificado");
  if (detail.verificado === false) parts.push("no menciona el UUID de la factura");
  return parts.join(" · ");
}

/**
 * Consulta de una factura (solo lectura): los PDF (factura, contrarecibo y complemento), los datos que se
 * detectaron al cargarla, su texto y su historial. Nada se modifica aquí.
 */
export function InvoiceModal({
  invoice,
  detected,
  onClose,
  onSave,
  onDiscard,
}: {
  invoice: Invoice;
  /** Solo al acabar de cargarla: qué datos se encontraron en el PDF. */
  detected?: Detected;
  onClose: () => void;
  /** Recién cargada: confirma que se guarda tal como se leyó del PDF. */
  onSave?: () => void;
  /** Recién cargada: la elimina para volver a cargar el PDF correcto (pide confirmación). */
  onDiscard?: () => void;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const [full, setFull] = useState<Invoice | null>(null);
  const [fullError, setFullError] = useState("");
  const [tab, setTab] = useState<"data" | "text" | "history">("data");
  const [doc, setDoc] = useState<Doc>("invoice");

  const paths: Record<Doc, string | null> = { invoice: invoice.file_path, receipt: invoice.receipt_path, complement: invoice.complement_path };
  const docPath = paths[doc];

  // Texto digitalizado e historial.
  const loadFull = useCallback(async () => {
    if (!session) return;
    try {
      setFull(await requestApi<Invoice>(session, `/api/invoices/${invoice.id}`));
      setFullError("");
    } catch (err) {
      setFullError(describeError(err, "No se pudo leer el detalle de la factura."));
    }
  }, [session, invoice.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFull(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFull]);

  function showDoc(next: Doc) {
    if (next !== doc) setDoc(next);
  }

  const text = full?.text_content ?? null;
  const events = full?.events ?? [];
  const missing = detected ? [!detected.invoice_date && "fecha", !detected.total && "total", !detected.uuid && "UUID"].filter(Boolean) : [];

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text ?? "");
      notify("success", "Texto copiado");
    } catch {
      notify("error", "No se pudo copiar el texto");
    }
  }

  async function openTab() {
    if (docPath && !(await openInvoiceFile(docPath))) notify("error", "No se pudo abrir el PDF");
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal modal-form invoice-review-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Receipt size={19} /></div>
          <div>
            <h2 id="invoice-title">{onSave ? `Revisa y guarda la factura ${invoice.folio}` : `Factura ${invoice.folio}`}</h2>
            <p>
              <StageSquares invoice={invoice} /> · <PaymentBadge invoice={invoice} />
              <br />
              <Lock size={12} />{" "}
              {onSave
                ? "Compara el PDF con los datos leídos. Al guardarla queda como enviada y ya no se modifica."
                : "Solo consulta: lo cargado del PDF no se modifica."}
            </p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>

        <div className="invoice-review">
          <div className="invoice-review-pdf">
            <div className="invoice-review-pdf-bar">
              <div className="site-tabs" role="tablist" aria-label="Documento">
                {(Object.keys(DOC_LABELS) as Doc[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={doc === key}
                    className={`site-tab${doc === key ? " active" : ""}`}
                    onClick={() => showDoc(key)}
                    disabled={!paths[key]}
                    title={paths[key] ? undefined : "Aún no se carga"}
                  >
                    {DOC_LABELS[key]}
                  </button>
                ))}
              </div>
              <button type="button" className="text-button" onClick={() => void openTab()} disabled={!docPath}><ExternalLink size={13} /> Abrir en otra pestaña</button>
            </div>
            {docPath ? (
              <PdfPages key={docPath} path={docPath} title={`${DOC_LABELS[doc]} de la factura ${invoice.folio}`} />
            ) : (
              <p className="epp-empty">Aún no se carga este documento.</p>
            )}
          </div>

          <div className="employee-form invoice-review-data">
            <div className="site-tabs fuel-form-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "data"} className={`site-tab${tab === "data" ? " active" : ""}`} onClick={() => setTab("data")}>
                <Receipt size={14} /> Datos
              </button>
              <button type="button" role="tab" aria-selected={tab === "text"} className={`site-tab${tab === "text" ? " active" : ""}`} onClick={() => setTab("text")}>
                <ScanText size={14} /> Texto {invoice.has_text ? `(${invoice.text_pages} pág.)` : "(sin texto)"}
              </button>
              <button type="button" role="tab" aria-selected={tab === "history"} className={`site-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
                <History size={14} /> Historial{full ? ` (${events.length})` : ""}
              </button>
            </div>

            {tab === "data" && (
              <>
                {detected && (
                  <p className={missing.length || !invoice.has_text ? "inline-error" : "field-hint"} role="status">
                    {!invoice.has_text
                      ? "El PDF no trae texto (parece escaneado como imagen): no se pudieron leer sus datos."
                      : missing.length
                        ? `No se encontró en el PDF: ${missing.join(", ")}. Si el archivo es incorrecto, elimínala y vuelve a cargarla.`
                        : "Datos leídos del PDF. Compáralos; si el archivo es incorrecto, elimínala y vuelve a cargarla antes de firmarla."}
                  </p>
                )}
                <div className="invoice-values">
                  <Value label="Folio del sistema">{invoice.folio}</Value>
                  <Value label="Folio en el PDF">{invoice.pdf_folio}</Value>
                  <Value label="Fecha de la factura">{formatDay(invoice.invoice_date)}</Value>
                  <Value label="Vencimiento (PDF)">{invoice.due_date ? formatDay(invoice.due_date) : null}</Value>
                  <Value label="Folio fiscal (UUID)">{invoice.uuid}</Value>
                  <Value label="Moneda">MXN · moneda nacional</Value>
                  <Value label="Subtotal">{formatMoney(invoice.subtotal)}</Value>
                  <Value label="IVA / impuestos">{formatMoney(invoice.tax)}</Value>
                  <Value label="Total">{formatMoney(invoice.total)}</Value>
                  <Value label="Cargada">{formatDateTime(invoice.created_at)} · {invoice.created_by_name ?? "—"}</Value>
                </div>
                <h3 className="invoice-subtitle">Contrarecibo y cierre</h3>
                <div className="invoice-values">
                  <Value label="Contrarecibo">{invoice.receipt_name ? `${invoice.receipt_name} · ${invoice.receipt_by_name ?? "—"}` : "Pendiente"}</Value>
                  <Value label="Fecha posible de cobro">{invoice.payment_date ? formatDay(invoice.payment_date) : null}</Value>
                  <Value label="Complemento de pago">{invoice.complement_name ? `${invoice.complement_name} · ${invoice.complement_by_name ?? "—"}` : "Pendiente"}</Value>
                  <Value label="Verificación">
                    {!invoice.complement_path
                      ? null
                      : invoice.complement_verified === true
                        ? "El complemento menciona el UUID de la factura"
                        : invoice.complement_verified === false
                          ? "El complemento NO menciona el UUID: revisar"
                          : "No se pudo verificar (sin UUID o sin texto)"}
                  </Value>
                </div>
                {invoice.status === "incidente" && invoice.incident_description && (
                  <p className="inline-error"><strong>Incidente (registro anterior):</strong> {invoice.incident_description}</p>
                )}
              </>
            )}

            {tab === "text" && (
              <div className="invoice-text">
                <div className="epp-actions">
                  <button type="button" className="button button-outline" onClick={() => void copyText()} disabled={!text}><Copy size={14} /> Copiar</button>
                  <button type="button" className="button button-outline" onClick={() => downloadText(`Factura_${fileSafe(invoice.folio)}.txt`, text ?? "")} disabled={!text}>
                    <Download size={14} /> Descargar .txt
                  </button>
                </div>
                {fullError ? (
                  <p className="inline-error" role="alert">{fullError}</p>
                ) : text === null ? (
                  <LoadingState label="Cargando texto…" compact />
                ) : text ? (
                  <pre className="invoice-text-content">{text}</pre>
                ) : (
                  <p className="epp-empty">Este PDF no trae texto (es una imagen escaneada).</p>
                )}
              </div>
            )}

            {tab === "history" && (
              fullError ? (
                <p className="inline-error" role="alert">{fullError}</p>
              ) : !full ? (
                <LoadingState label="Cargando historial…" rows={2} compact />
              ) : events.length === 0 ? (
                <p className="epp-empty">Sin pasos registrados.</p>
              ) : (
                <ol className="invoice-edits">
                  {events.map((event) => (
                    <li key={event.id}>
                      <p><strong>{INVOICE_EVENT_LABELS[event.event]}</strong> <small className="epp-muted">· {formatDateTime(event.at)}{event.by_name ? ` · ${event.by_name}` : ""}</small></p>
                      {eventDetail(event) && <small className="epp-muted">{eventDetail(event)}</small>}
                    </li>
                  ))}
                </ol>
              )
            )}

            {onSave ? (
              <div className="modal-actions">
                {onDiscard && (
                  <button type="button" className="button button-neutral" onClick={onDiscard} title="Si el PDF no es el correcto, elimínala y vuelve a cargarla">
                    <Trash2 size={15} /> Descartar y volver a cargar
                  </button>
                )}
                <button type="button" className="button button-gold" onClick={onSave}>
                  <Save size={16} /> Guardar factura
                </button>
              </div>
            ) : (
              <div className="modal-actions">
                <button type="button" className="button button-neutral" onClick={onClose}>Cerrar</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
