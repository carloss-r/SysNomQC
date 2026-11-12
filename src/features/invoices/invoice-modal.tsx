"use client";

import { Copy, Download, ExternalLink, History, Receipt, Save, ScanText, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { formatMoney, INVOICE_FIELD_LABELS, INVOICE_STATUS_LABELS, type Invoice } from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { formatDateTime, formatDay } from "@/features/fuels/format";
import { fileSafe } from "@/shared/reports/report-export";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { downloadText, loadInvoicePreview, openInvoiceFile } from "./files";
import type { Detected } from "./upload-modal";

type FormKey = "invoice_date" | "due_date" | "folio" | "uuid" | "supplier_name" | "supplier_rfc" | "subtotal" | "tax" | "total" | "currency" | "notes";
type Form = Record<FormKey, string>;

const money = (value: number | null) => (value === null ? "" : value.toFixed(2));
const toAmount = (value: string): number | null | "bad" => {
  const clean = value.replace(/[$,\s]/g, "");
  if (!clean) return null;
  const number = Number(clean);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : "bad";
};

const formOf = (invoice: Invoice): Form => ({
  invoice_date: invoice.invoice_date,
  due_date: invoice.due_date ?? "",
  folio: invoice.folio ?? "",
  uuid: invoice.uuid ?? "",
  supplier_name: invoice.supplier_name ?? "",
  supplier_rfc: invoice.supplier_rfc ?? "",
  subtotal: money(invoice.subtotal),
  tax: money(invoice.tax),
  total: money(invoice.total),
  currency: invoice.currency,
  notes: invoice.notes ?? "",
});

/** Valor de la bitácora legible: fechas dd/mm/aaaa, montos con dos decimales, vacío como "—". */
function showValue(key: string, value: string | number | null): string {
  if (value === null || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (key.endsWith("_date")) return formatDay(value);
  return value;
}

/**
 * Repaso de una factura: el PDF real a un lado y los datos capturados al otro, para comparar y corregir.
 * Cada corrección guarda quién la hizo y qué valor tenía antes (pestaña «Correcciones»).
 */
export function InvoiceModal({
  invoice: initial,
  detected,
  canEdit,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  detected?: Detected;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const [invoice, setInvoice] = useState<Invoice>(initial);
  const [full, setFull] = useState<Invoice | null>(null);
  const [fullError, setFullError] = useState("");
  const [tab, setTab] = useState<"data" | "text" | "edits">("data");
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // PDF para la vista previa (se descarga del bucket privado; la URL local se libera al cerrar).
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    loadInvoicePreview(initial.file_path)
      .then((value) => {
        if (cancelled) URL.revokeObjectURL(value);
        else setPreview((url = value));
      })
      .catch(() => { if (!cancelled) setPreviewError(true); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [initial.file_path]);

  // Texto digitalizado y bitácora de correcciones.
  const loadFull = useCallback(async () => {
    if (!session) return;
    try {
      setFull(await requestApi<Invoice>(session, `/api/invoices/${initial.id}`));
      setFullError("");
    } catch (err) {
      setFullError(describeError(err, "No se pudo leer el detalle de la factura."));
    }
  }, [session, initial.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFull(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFull]);

  const saved = formOf(invoice);
  const dirty = (Object.keys(form) as FormKey[]).filter((key) => form[key].trim() !== saved[key].trim());
  const edits = full?.edits ?? [];
  const corrected = new Set(edits.flatMap((edit) => Object.keys(edit.changes)));
  const text = full?.text_content ?? null;
  const missing = detected ? [!detected.invoice_date && "fecha", !detected.total && "total", !detected.supplier && "emisor"].filter(Boolean) : [];

  const set = (key: FormKey) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const fieldClass = (key: FormKey) => (dirty.includes(key) ? "invoice-field-dirty" : corrected.has(key) ? "invoice-field-corrected" : undefined);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy || !canEdit) return;
    if (dirty.length === 0) return setError("No hay cambios que guardar.");
    const amounts = { subtotal: toAmount(form.subtotal), tax: toAmount(form.tax), total: toAmount(form.total) };
    if (Object.values(amounts).includes("bad")) return setError("Revisa los montos: deben ser números positivos.");
    if (!form.invoice_date) return setError("Indica la fecha de la factura.");
    if (form.due_date && form.due_date < form.invoice_date) return setError("El vencimiento no puede ser anterior a la fecha de la factura.");
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) return setError("La moneda debe ser de 3 letras (MXN, USD, EUR).");
    setBusy(true);
    setError("");
    try {
      const updated = await requestApi<Invoice>(session, `/api/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "edit",
          invoice_date: form.invoice_date,
          due_date: form.due_date || null,
          folio: form.folio,
          uuid: form.uuid,
          supplier_name: form.supplier_name,
          supplier_rfc: form.supplier_rfc,
          ...amounts,
          currency: form.currency.trim().toUpperCase(),
          notes: form.notes,
        }),
      });
      setInvoice(updated);
      setForm(formOf(updated));
      notify("success", "Corrección guardada", `Quedó registrado quién la hizo (${dirty.length} dato(s)).`);
      await Promise.all([onSaved(), loadFull()]);
    } catch (err) {
      setError(describeError(err, "No se pudo guardar la factura."));
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text ?? "");
      notify("success", "Texto copiado");
    } catch {
      notify("error", "No se pudo copiar el texto");
    }
  }

  async function openTab() {
    if (!(await openInvoiceFile(invoice.file_path))) notify("error", "No se pudo abrir el PDF");
  }

  const readOnly = !canEdit;
  const input = (key: FormKey, props: Record<string, unknown> = {}) => (
    <input className={fieldClass(key)} value={form[key]} onChange={(e) => set(key)(e.target.value)} disabled={readOnly} {...props} />
  );

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form invoice-review-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Receipt size={19} /></div>
          <div>
            <h2 id="invoice-title">{detected ? "Repaso de la factura cargada" : `Factura ${invoice.folio ?? `#${invoice.id}`}`}</h2>
            <p>
              Compara el PDF con lo capturado y corrige lo que esté mal · {invoice.file_name} ·{" "}
              <span className={`fuel-status fuel-status-${invoice.status === "pagada" ? "ok" : invoice.status === "incidente" ? "bad" : "warn"}`}>{INVOICE_STATUS_LABELS[invoice.status]}</span>
              {invoice.status === "pagada" && invoice.paid_on && <> el {formatDay(invoice.paid_on)}{invoice.paid_by_name ? ` · ${invoice.paid_by_name}` : ""}</>}
              {invoice.status !== "pendiente" && <> · <strong>factura cerrada, solo consulta</strong></>}
              {invoice.status === "incidente" && (
                <>
                  {invoice.incident_on && <> desde el {formatDay(invoice.incident_on)}</>}
                  {invoice.incident_by_name && <> · {invoice.incident_by_name}</>}
                  {invoice.incident_description && <><br /><strong>Incidente:</strong> {invoice.incident_description}</>}
                </>
              )}
            </p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>

        <div className="invoice-review">
          <div className="invoice-review-pdf">
            <div className="invoice-review-pdf-bar">
              <strong>PDF original</strong>
              <button type="button" className="text-button" onClick={() => void openTab()}><ExternalLink size={13} /> Abrir en otra pestaña</button>
            </div>
            {preview ? (
              <iframe src={preview} title={`PDF de la factura ${invoice.folio ?? invoice.id}`} />
            ) : (
              <p className="epp-empty">{previewError ? "No se pudo mostrar el PDF aquí. Ábrelo en otra pestaña." : "Cargando PDF…"}</p>
            )}
          </div>

          <form className="employee-form invoice-review-data" onSubmit={submit} noValidate>
            <div className="site-tabs fuel-form-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "data"} className={`site-tab${tab === "data" ? " active" : ""}`} onClick={() => setTab("data")}>
                <Receipt size={14} /> Datos capturados
              </button>
              <button type="button" role="tab" aria-selected={tab === "text"} className={`site-tab${tab === "text" ? " active" : ""}`} onClick={() => setTab("text")}>
                <ScanText size={14} /> Texto {invoice.has_text ? `(${invoice.text_pages} pág.)` : "(sin texto)"}
              </button>
              <button type="button" role="tab" aria-selected={tab === "edits"} className={`site-tab${tab === "edits" ? " active" : ""}`} onClick={() => setTab("edits")}>
                <History size={14} /> Correcciones{full ? ` (${edits.length})` : ""}
              </button>
            </div>

            {tab === "data" && (
              <>
                {detected && (
                  <p className={missing.length || !invoice.has_text ? "inline-error" : "field-hint"} role="status">
                    {!invoice.has_text
                      ? "El PDF no trae texto (parece escaneado como imagen): captura los datos viendo el PDF."
                      : missing.length
                        ? `No se encontró en el PDF: ${missing.join(", ")}. Complétalo viendo el PDF.`
                        : "Datos detectados automáticamente. Compáralos con el PDF y corrige lo que no coincida."}
                  </p>
                )}
                <div className="form-grid invoice-review-grid">
                  <Field label="Fecha de la factura" required>{input("invoice_date", { type: "date" })}</Field>
                  <Field label="Vencimiento">{input("due_date", { type: "date" })}</Field>
                  <Field label="Folio">{input("folio", { maxLength: 60 })}</Field>
                  <Field label="Moneda">{input("currency", { maxLength: 3, onChange: (e: ChangeEvent<HTMLInputElement>) => set("currency")(e.target.value.toUpperCase()) })}</Field>
                  <div className="fuel-span-3"><Field label="Emisor (proveedor)">{input("supplier_name", { maxLength: 160 })}</Field></div>
                  <Field label="RFC del emisor">{input("supplier_rfc", { maxLength: 13, onChange: (e: ChangeEvent<HTMLInputElement>) => set("supplier_rfc")(e.target.value.toUpperCase()) })}</Field>
                  <Field label="Folio fiscal (UUID)">{input("uuid", { maxLength: 36, onChange: (e: ChangeEvent<HTMLInputElement>) => set("uuid")(e.target.value.toUpperCase()) })}</Field>
                  <Field label="Subtotal">{input("subtotal", { inputMode: "decimal" })}</Field>
                  <Field label="IVA / impuestos">{input("tax", { inputMode: "decimal" })}</Field>
                  <Field label="Total">{input("total", { inputMode: "decimal" })}</Field>
                  <div className="fuel-span-3"><Field label="Notas">{input("notes", { maxLength: 500 })}</Field></div>
                </div>
                <p className="field-hint">
                  <span className="invoice-legend invoice-legend-dirty" /> sin guardar · <span className="invoice-legend invoice-legend-corrected" /> corregido antes ·
                  Total guardado: {formatMoney(invoice.total, invoice.currency)} · Cargada el {formatDay(invoice.created_at)} por {invoice.created_by_name ?? "—"}
                  {invoice.updated_by_name && invoice.updated_at !== invoice.created_at ? ` · Último cambio: ${invoice.updated_by_name}, ${formatDateTime(invoice.updated_at)}` : ""}
                </p>
              </>
            )}

            {tab === "text" && (
              <div className="invoice-text">
                <div className="epp-actions">
                  <button type="button" className="button button-outline" onClick={() => void copyText()} disabled={!text}><Copy size={14} /> Copiar</button>
                  <button type="button" className="button button-outline" onClick={() => downloadText(`Factura_${fileSafe(invoice.folio ?? String(invoice.id))}.txt`, text ?? "")} disabled={!text}>
                    <Download size={14} /> Descargar .txt
                  </button>
                </div>
                {fullError ? (
                  <p className="inline-error" role="alert">{fullError}</p>
                ) : text === null ? (
                  <p className="epp-empty">Cargando texto…</p>
                ) : text ? (
                  <pre className="invoice-text-content">{text}</pre>
                ) : (
                  <p className="epp-empty">Este PDF no trae texto (es una imagen escaneada).</p>
                )}
              </div>
            )}

            {tab === "edits" && (
              fullError ? (
                <p className="inline-error" role="alert">{fullError}</p>
              ) : !full ? (
                <p className="epp-empty">Cargando correcciones…</p>
              ) : edits.length === 0 ? (
                <p className="epp-empty">Nadie ha corregido esta factura: los datos son los que se detectaron al cargarla.</p>
              ) : (
                <ol className="invoice-edits">
                  {edits.map((edit) => (
                    <li key={edit.id}>
                      <p><strong>{edit.edited_by_name}</strong> <small className="epp-muted">· {formatDateTime(edit.edited_at)}</small></p>
                      <ul>
                        {Object.entries(edit.changes).map(([key, change]) => (
                          <li key={key}>
                            {INVOICE_FIELD_LABELS[key] ?? key}: <del>{showValue(key, change.from)}</del> → <strong>{showValue(key, change.to)}</strong>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              )
            )}

            {error && <p className="inline-error" role="alert">{error}</p>}
            <div className="modal-actions">
              {canEdit && tab === "data" && dirty.length > 0 && (
                <button type="button" className="button button-neutral" onClick={() => { setForm(saved); setError(""); }} disabled={busy}><Undo2 size={15} /> Deshacer cambios</button>
              )}
              <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cerrar</button>
              {canEdit && tab === "data" && (
                <button type="submit" className="button button-gold" disabled={busy || dirty.length === 0}>
                  <Save size={17} /> {busy ? "Guardando…" : dirty.length ? `Guardar corrección (${dirty.length})` : "Sin cambios"}
                </button>
              )}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
