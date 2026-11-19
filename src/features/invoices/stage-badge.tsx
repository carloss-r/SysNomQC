import { INVOICE_STAGE_LABELS, type InvoiceStage } from "@/lib/invoices";

/** Estado del documento: enviada → firmada → cargada (bloqueada). */
export function StageBadge({ stage }: { stage: InvoiceStage }) {
  const tone = stage === "cargada" ? "ok" : stage === "firmada" ? "info" : "warn";
  return <span className={`fuel-status fuel-status-${tone}`}>{INVOICE_STAGE_LABELS[stage]}</span>;
}
