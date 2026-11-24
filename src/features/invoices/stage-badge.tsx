import { formatDay } from "@/features/fuels/format";
import { INVOICE_STAGE_LABELS, INVOICE_STAGES, paymentState, type Invoice } from "@/lib/invoices";

const when = (iso: string | null, by: string | null) => (iso ? ` · ${formatDay(iso.slice(0, 10))}${by ? ` · ${by}` : ""}` : "");

/**
 * Los tres cuadritos del documento: 1 enviada · 2 firmada / autorizada · 3 cargada al sistema.
 * Rojo mientras el paso no se ha dado; verde cuando ya se marcó.
 */
export function StageSquares({ invoice, showLabel = true }: { invoice: Invoice; showLabel?: boolean }) {
  const reached = INVOICE_STAGES.indexOf(invoice.stage);
  const detail = [
    when(invoice.created_at, invoice.created_by_name),
    when(invoice.signed_at, invoice.signed_by_name),
    when(invoice.loaded_at, invoice.loaded_by_name),
  ];
  return (
    <span className="invoice-squares" aria-label={`Estado: ${INVOICE_STAGE_LABELS[invoice.stage]}`}>
      {INVOICE_STAGES.map((stage, index) => (
        <span
          key={stage}
          className={`invoice-square ${index <= reached ? "invoice-square-done" : "invoice-square-todo"}`}
          title={`${index + 1}. ${INVOICE_STAGE_LABELS[stage]}${index <= reached ? detail[index] : " · pendiente"}`}
        >
          {index + 1}
        </span>
      ))}
      {showLabel && <small>{INVOICE_STAGE_LABELS[invoice.stage]}</small>}
    </span>
  );
}

/** Pago: falta contrarecibo · pago programado · pago atrasado · pagada (con complemento). */
export function PaymentBadge({ invoice, today }: { invoice: Invoice; today: string }) {
  if (invoice.status === "incidente") return <span className="fuel-status fuel-status-bad">Incidente</span>;
  const state = paymentState(invoice, today);
  if (state === "pagada") {
    return (
      <span className="fuel-status fuel-status-ok" title={invoice.complement_verified === false ? "El complemento no menciona el UUID de la factura" : undefined}>
        Pagada{invoice.complement_verified === false ? " · revisar" : ""}
      </span>
    );
  }
  if (state === "sin_contrarecibo") {
    return invoice.stage === "cargada"
      ? <span className="fuel-status fuel-status-warn">Falta contrarecibo</span>
      : <span className="fuel-status fuel-status-neutral">En trámite</span>;
  }
  return state === "atrasado"
    ? <span className="fuel-status fuel-status-bad">Pago atrasado · {formatDay(invoice.payment_date)}</span>
    : <span className="fuel-status fuel-status-info">Pago {formatDay(invoice.payment_date)}</span>;
}
