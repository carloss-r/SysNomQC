"use client";

import { BadgeCheck, CalendarClock, FileUp, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { formatMoney, type Invoice } from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { formatDay } from "@/features/fuels/format";
import { Field } from "@/shared/ui/field";
import { BusyLabel } from "@/shared/ui/loading";
import { invoiceFileProblem, uploadInvoiceFile } from "./files";

export type StepKind = "receipt" | "complement";

const COPY: Record<StepKind, { title: string; intro: string; button: string; busy: string }> = {
  receipt: {
    title: "Cargar contrarecibo",
    intro: "Sube el PDF del contrarecibo y captura la fecha posible de pago. Después ya no se puede cambiar.",
    button: "Guardar contrarecibo",
    busy: "Guardando contrarecibo…",
  },
  complement: {
    title: "Cargar complemento de pago",
    intro: "Sube el PDF del complemento de pago. Se revisa que mencione el UUID de la factura y la factura queda pagada y cerrada.",
    button: "Guardar complemento y cerrar",
    busy: "Verificando complemento…",
  },
};

/** Contrarecibo (con fecha posible de pago) o complemento de pago (cierra la factura). */
export function StepModal({
  kind,
  invoice,
  today,
  onClose,
  onSaved,
}: {
  kind: StepKind;
  invoice: Invoice;
  today: string;
  onClose: () => void;
  onSaved: (invoice: Invoice) => void;
}) {
  const { session } = useAuth();
  const copy = COPY[kind];
  const [file, setFile] = useState<File | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(next: File | null) {
    setError("");
    const problem = next ? invoiceFileProblem(next) : null;
    if (problem) setError(problem);
    setFile(problem ? null : next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy) return;
    if (!file) return setError(`Selecciona el PDF del ${kind === "receipt" ? "contrarecibo" : "complemento de pago"}.`);
    if (kind === "receipt" && !paymentDate) return setError("Captura la fecha posible de pago.");
    if (kind === "receipt" && paymentDate < invoice.invoice_date) return setError("La fecha de pago no puede ser anterior a la fecha de la factura.");
    setBusy(true);
    setError("");
    try {
      const path = await uploadInvoiceFile(file, kind);
      const saved = await requestApi<Invoice>(session, `/api/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: kind,
          file_path: path,
          file_name: file.name.slice(0, 200),
          ...(kind === "receipt" ? { payment_date: paymentDate } : {}),
        }),
      });
      onSaved(saved);
    } catch (err) {
      setError(describeError(err, "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo."));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form fuel-modal-small" role="dialog" aria-modal="true" aria-labelledby="invoice-step-title">
        <div className="modal-header">
          <div className="modal-heading-icon">{kind === "receipt" ? <CalendarClock size={19} /> : <BadgeCheck size={19} />}</div>
          <div>
            <h2 id="invoice-step-title">{copy.title}</h2>
            <p>
              Factura <strong>{invoice.folio}</strong> · {formatDay(invoice.invoice_date)} · {formatMoney(invoice.total)}
              {kind === "complement" && invoice.payment_date && <> · pago programado {formatDay(invoice.payment_date)}</>}
              <br />{copy.intro}
            </p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit} noValidate>
          <div className="invoice-drop">
            <label className="button button-outline file-button">
              <FileUp size={15} /> Seleccionar PDF
              <input type="file" accept="application/pdf,.pdf" onChange={(event) => pick(event.target.files?.[0] ?? null)} disabled={busy} />
            </label>
            <span className="field-hint">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "PDF de hasta 10 MB"}</span>
          </div>
          {kind === "receipt" && (
            <Field label="Fecha posible de pago" required>
              <input type="date" value={paymentDate} min={invoice.invoice_date} onChange={(event) => setPaymentDate(event.target.value)} disabled={busy} required />
              {paymentDate && paymentDate < today && <span className="field-hint">Esa fecha ya pasó: el pago aparecerá como atrasado hasta cargar el complemento.</span>}
            </Field>
          )}
          {kind === "complement" && !invoice.uuid && (
            <p className="field-hint">La factura no trae UUID (folio fiscal) en su PDF: el complemento se guardará sin poder verificarse contra ella.</p>
          )}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className={`button ${kind === "complement" ? "button-gold" : "button-primary"}`} disabled={busy || !file}>
              {busy ? <BusyLabel>{copy.busy}</BusyLabel> : copy.button}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
