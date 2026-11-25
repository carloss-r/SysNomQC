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

/** Cobro: en trámite · falta contrarecibo · por cobrar (con contrarecibo) · cobrada (con complemento). */
export function PaymentBadge({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "incidente") return <span className="fuel-status fuel-status-bad">Incidente</span>;
  const state = paymentState(invoice);
  if (state === "cobrada") {
    return (
      <span className="fuel-status fuel-status-ok" title={invoice.complement_verified === false ? "El complemento no menciona el UUID de la factura" : undefined}>
        Cobrada{invoice.complement_verified === false ? " · revisar" : ""}
      </span>
    );
  }
  if (state === "por_cobrar") {
    return (
      <span className="fuel-status fuel-status-info" title={invoice.payment_date ? `Fecha posible de cobro: ${formatDay(invoice.payment_date)}` : undefined}>
        Por cobrar
      </span>
    );
  }
  return invoice.stage === "cargada"
    ? <span className="fuel-status fuel-status-warn">Falta contrarecibo</span>
    : <span className="fuel-status fuel-status-neutral">En trámite</span>;
}
