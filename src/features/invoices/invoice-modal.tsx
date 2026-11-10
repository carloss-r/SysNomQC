"use client";

import { Copy, Download, FileText, Receipt, Save, ScanText, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { formatMoney, INVOICE_STATUS_LABELS, type Invoice } from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { formatDay } from "@/features/fuels/format";
import { fileSafe } from "@/shared/reports/report-export";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { downloadText, openInvoiceFile } from "./files";
import type { Detected } from "./upload-modal";

type Form = {
  invoice_date: string;
  due_date: string;
  folio: string;
  uuid: string;
  supplier_name: string;
  supplier_rfc: string;
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  notes: string;
};

const money = (value: number | null) => (value === null ? "" : value.toFixed(2));
const toAmount = (value: string): number | null | "bad" => {
  const clean = value.replace(/[$,\s]/g, "");
  if (!clean) return null;
  const number = Number(clean);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : "bad";
};

/**
 * Detalle de una factura: datos detectados (editables) y texto digitalizado.
 * Recién cargada (detected) pide revisar lo que no se encontró en el PDF.
 */
export function InvoiceModal({
  invoice,
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
  const [tab, setTab] = useState<"data" | "text">("data");
  const [form, setForm] = useState<Form>({
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
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tab !== "text" || text !== null || !session) return;
    let cancelled = false;
    requestApi<Invoice>(session, `/api/invoices/${invoice.id}`)
      .then((full) => { if (!cancelled) setText(full.text_content ?? ""); })
      .catch((err) => { if (!cancelled) setTextError(describeError(err, "No se pudo leer el texto de la factura.")); });
    return () => { cancelled = true; };
  }, [tab, text, session, invoice.id]);

  const set = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const missing = detected ? [!detected.invoice_date && "fecha", !detected.total && "total", !detected.supplier && "emisor"].filter(Boolean) : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy || !canEdit) return;
    const amounts = { subtotal: toAmount(form.subtotal), tax: toAmount(form.tax), total: toAmount(form.total) };
    if (Object.values(amounts).includes("bad")) return setError("Revisa los montos: deben ser números positivos.");
    if (!form.invoice_date) return setError("Indica la fecha de la factura.");
    if (form.due_date && form.due_date < form.invoice_date) return setError("El vencimiento no puede ser anterior a la fecha de la factura.");
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) return setError("La moneda debe ser de 3 letras (MXN, USD, EUR).");
    setBusy(true);
    setError("");
    try {
      await requestApi(session, `/api/invoices/${invoice.id}`, {
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
      notify("success", "Factura guardada");
      await onSaved();
      onClose();
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

  const readOnly = !canEdit;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form fuel-modal-wide" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Receipt size={19} /></div>
          <div>
            <h2 id="invoice-title">{detected ? "Revisa los datos de la factura" : `Factura ${invoice.folio ?? `#${invoice.id}`}`}</h2>
            <p>
              {invoice.file_name} · <span className={`fuel-status fuel-status-${invoice.status === "pagada" ? "ok" : "warn"}`}>{INVOICE_STATUS_LABELS[invoice.status]}</span>
              {invoice.status === "pagada" && invoice.paid_on && <> el {formatDay(invoice.paid_on)}{invoice.paid_by_name ? ` · ${invoice.paid_by_name}` : ""}</>}
            </p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit} noValidate>
          <div className="site-tabs fuel-form-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "data"} className={`site-tab${tab === "data" ? " active" : ""}`} onClick={() => setTab("data")}>
              <Receipt size={14} /> Datos de la factura
            </button>
            <button type="button" role="tab" aria-selected={tab === "text"} className={`site-tab${tab === "text" ? " active" : ""}`} onClick={() => setTab("text")}>
              <ScanText size={14} /> Texto digitalizado {invoice.has_text ? `(${invoice.text_pages} pág.)` : "(sin texto)"}
            </button>
          </div>

          {tab === "data" ? (
            <>
              {detected && (
                <p className={missing.length ? "inline-error" : "field-hint"} role="status">
                  {!invoice.has_text
                    ? "El PDF no trae texto (parece escaneado como imagen): captura los datos a mano."
                    : missing.length
                      ? `No se encontró en el PDF: ${missing.join(", ")}. Complétalo antes de guardar.`
                      : "Datos detectados en el PDF. Revísalos y guarda."}
                </p>
              )}
              <div className="form-grid">
                <Field label="Fecha de la factura" required><input type="date" value={form.invoice_date} onChange={(e) => set("invoice_date")(e.target.value)} disabled={readOnly} /></Field>
                <Field label="Vencimiento"><input type="date" value={form.due_date} onChange={(e) => set("due_date")(e.target.value)} disabled={readOnly} /></Field>
                <Field label="Folio"><input value={form.folio} onChange={(e) => set("folio")(e.target.value)} maxLength={60} disabled={readOnly} /></Field>
                <div className="fuel-span-3"><Field label="Emisor (proveedor)"><input value={form.supplier_name} onChange={(e) => set("supplier_name")(e.target.value)} maxLength={160} disabled={readOnly} /></Field></div>
                <Field label="RFC del emisor"><input value={form.supplier_rfc} onChange={(e) => set("supplier_rfc")(e.target.value.toUpperCase())} maxLength={13} disabled={readOnly} /></Field>
                <div className="invoice-span-2"><Field label="Folio fiscal (UUID)"><input value={form.uuid} onChange={(e) => set("uuid")(e.target.value.toUpperCase())} maxLength={36} disabled={readOnly} /></Field></div>
                <Field label="Subtotal"><input inputMode="decimal" value={form.subtotal} onChange={(e) => set("subtotal")(e.target.value)} disabled={readOnly} /></Field>
                <Field label="IVA / impuestos"><input inputMode="decimal" value={form.tax} onChange={(e) => set("tax")(e.target.value)} disabled={readOnly} /></Field>
                <Field label="Total"><input inputMode="decimal" value={form.total} onChange={(e) => set("total")(e.target.value)} disabled={readOnly} /></Field>
                <Field label="Moneda"><input value={form.currency} onChange={(e) => set("currency")(e.target.value.toUpperCase())} maxLength={3} disabled={readOnly} /></Field>
                <div className="invoice-span-2"><Field label="Notas"><input value={form.notes} onChange={(e) => set("notes")(e.target.value)} maxLength={500} disabled={readOnly} /></Field></div>
              </div>
              <p className="field-hint">
                Total detectado: {formatMoney(invoice.total, invoice.currency)} · Cargada el {formatDay(invoice.created_at)} por {invoice.created_by_name ?? "—"}
              </p>
            </>
          ) : (
            <div className="invoice-text">
              <div className="epp-actions">
                <button type="button" className="button button-outline" onClick={() => void openInvoiceFile(invoice.file_path).then((ok) => { if (!ok) notify("error", "No se pudo abrir el PDF"); })}>
                  <FileText size={14} /> Ver PDF
                </button>
                <button type="button" className="button button-outline" onClick={() => void copyText()} disabled={!text}><Copy size={14} /> Copiar</button>
                <button type="button" className="button button-outline" onClick={() => downloadText(`Factura_${fileSafe(invoice.folio ?? String(invoice.id))}.txt`, text ?? "")} disabled={!text}>
                  <Download size={14} /> Descargar .txt
                </button>
              </div>
              {textError ? (
                <p className="inline-error" role="alert">{textError}</p>
              ) : text === null ? (
                <p className="epp-empty">Cargando texto…</p>
              ) : text ? (
                <pre className="invoice-text-content">{text}</pre>
              ) : (
                <p className="epp-empty">Este PDF no trae texto (es una imagen escaneada). Los datos se capturan a mano en la pestaña anterior.</p>
              )}
            </div>
          )}

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>{canEdit ? "Cancelar" : "Cerrar"}</button>
            {canEdit && tab === "data" && <button type="submit" className="button button-gold" disabled={busy}><Save size={17} /> {busy ? "Guardando…" : "Guardar"}</button>}
          </div>
        </form>
      </section>
    </div>
  );
}
