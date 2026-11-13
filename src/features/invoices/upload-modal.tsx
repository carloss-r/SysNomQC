"use client";

import { FileUp, ScanText, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import type { Invoice } from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { invoiceFileProblem, uploadInvoiceFile } from "./files";
import { BusyLabel } from "@/shared/ui/loading";

export type Detected = { invoice_date: boolean; total: boolean; supplier: boolean };

/** Carga de una factura: sube el PDF, el servidor lo digitaliza y la registra como pendiente de pago. */
export function UploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: (invoice: Invoice, detected: Detected) => void }) {
  const { session } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "upload" | "scan">("idle");
  const busy = step !== "idle";

  function pick(next: File | null) {
    setError("");
    if (!next) return setFile(null);
    const problem = invoiceFileProblem(next);
    if (problem) {
      setFile(null);
      return setError(problem);
    }
    setFile(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || busy) return;
    if (!file) return setError("Selecciona el PDF de la factura.");
    setError("");
    try {
      setStep("upload");
      const path = await uploadInvoiceFile(file);
      setStep("scan");
      const result = await requestApi<{ invoice: Invoice; detected: Detected }>(session, "/api/invoices", {
        method: "POST",
        body: JSON.stringify({ file_path: path, file_name: file.name.slice(0, 200) }),
      });
      onUploaded(result.invoice, result.detected);
    } catch (err) {
      setError(describeError(err, "No se pudo cargar la factura. Revisa tu conexión e inténtalo de nuevo."));
      setStep("idle");
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form fuel-modal-small" role="dialog" aria-modal="true" aria-labelledby="invoice-upload-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><FileUp size={19} /></div>
          <div>
            <h2 id="invoice-upload-title">Cargar factura</h2>
            <p>Sube el PDF; se digitaliza su texto, se detectan fecha, folio, emisor y total, y queda como <strong>pendiente de pago</strong>.</p>
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
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy || !file}>
              <ScanText size={17} /> {step === "upload" ? <BusyLabel>Subiendo PDF…</BusyLabel> : step === "scan" ? <BusyLabel>Digitalizando…</BusyLabel> : "Cargar y digitalizar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
