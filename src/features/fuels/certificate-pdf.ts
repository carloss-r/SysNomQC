import { CHLORINE_LABELS, fmt, receptionGcal, type ChlorineState, type FuelReception } from "@/lib/fuels";
import { loadLogo } from "@/shared/reports/report-export";
import { formatDateTime } from "./format";

const GREEN: [number, number, number] = [11, 93, 42];
const GOLD: [number, number, number] = [197, 155, 39];
const INK: [number, number, number] = [28, 41, 33];
const MUTED: [number, number, number] = [95, 108, 100];
const SOFT: [number, number, number] = [232, 242, 235];

/**
 * M3 · Certificado de recepción oficial para el cliente (solo para tickets cerrados).
 * Datos del generador, transportista, destino y toneladas recibidas.
 */
export async function downloadCertificatePdf(reception: FuelReception, chlorine: ChlorineState, generatedBy: string) {
  if (reception.status !== "cerrado" || reception.net_kg === null) throw new Error("El ticket no está cerrado.");
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), loadLogo()]);
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const usable = pageW - margin * 2;
  let y = margin;

  const text = (value: string, x: number, size: number, style: "normal" | "bold" = "normal", color = INK, align: "left" | "right" | "center" = "left") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(value, x, y, { align });
  };

  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 4, "F");
  if (logo) doc.addImage(logo, "JPEG", margin, y, 22, 22);
  const left = margin + (logo ? 27 : 0);
  y += 6;
  text("COOPERATIVA QUINTA GENERACIÓN", left, 13, "bold", GREEN);
  y += 4.5;
  text("S.C. DE R.L. DE C.V.  ·  Ecología · Combustibles alternos", left, 8, "bold", GOLD);
  y += 8;
  text("CERTIFICADO DE RECEPCIÓN", left, 16, "bold");
  y -= 12;
  text(`Ticket de báscula`, pageW - margin, 8, "normal", MUTED, "right");
  y += 7;
  text(`No. ${String(reception.id).padStart(6, "0")}`, pageW - margin, 15, "bold", GREEN, "right");
  y += 5;
  text(`Manifiesto ${reception.manifest_folio}`, pageW - margin, 9, "bold", INK, "right");
  y += 10;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // Bloques de datos en dos columnas
  const block = (title: string, rows: [string, string][], x: number, width: number, top: number) => {
    let by = top;
    doc.setFillColor(...SOFT);
    doc.roundedRect(x, by - 5, width, 7, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text(title.toUpperCase(), x + 3, by);
    by += 7;
    for (const [label, value] of rows) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(label, x + 3, by);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(value || "—", width - 6) as string[];
      doc.text(lines, x + 3, by + 4.2);
      by += 4.2 * lines.length + 5;
    }
    return by;
  };

  const half = (usable - 6) / 2;
  const top = y;
  const leftEnd = block("Generador", [
    ["Razón social", reception.generator_name],
    ["RFC", reception.generator_rfc],
    ["Producto", reception.product_name],
    ["Poder calorífico", `${fmt(reception.calorific_value, 0)} cal/g`],
  ], margin, half, top);
  const rightEnd = block("Transportista y vehículo", [
    ["Transportista", reception.carrier],
    ["Chofer", reception.driver],
    ["Placas", reception.plates],
    ["Vehículo", reception.vehicle ?? "—"],
  ], margin + half + 6, half, top);
  y = Math.max(leftEnd, rightEnd) + 2;
  y = block("Destino y fechas", [
    ["Destino", reception.destination],
    ["Entrada (peso bruto)", formatDateTime(reception.gross_at)],
    ["Salida y cierre (tara)", formatDateTime(reception.tare_at)],
  ], margin, usable, y) + 2;

  // Pesos
  const boxes: [string, string][] = [
    ["Peso bruto", `${fmt(reception.gross_kg, 0)} kg`],
    ["Tara", `${fmt(reception.tare_kg, 0)} kg`],
    ["Peso neto", `${fmt(reception.net_kg, 0)} kg`],
    ["Toneladas recibidas", `${fmt(reception.net_kg / 1000, 3)} t`],
  ];
  const gap = 4;
  const boxW = (usable - gap * 3) / 4;
  boxes.forEach(([label, value], index) => {
    const bx = margin + index * (boxW + gap);
    const strong = index >= 2;
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.3);
    if (strong) doc.setFillColor(...GREEN);
    else doc.setFillColor(255, 255, 255);
    doc.roundedRect(bx, y, boxW, 17, 1.5, 1.5, strong ? "F" : "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...(strong ? ([255, 255, 255] as [number, number, number]) : GREEN));
    doc.text(value, bx + boxW / 2, y + 8, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...(strong ? ([230, 240, 233] as [number, number, number]) : MUTED));
    doc.text(label.toUpperCase(), bx + boxW / 2, y + 13.5, { align: "center" });
  });
  y += 25;

  text(`Energía aportada: ${fmt(receptionGcal(reception), 3)} Gcal  ·  Cloro del embarque: ${reception.chlorine_pct === null ? "sin análisis" : `${fmt(reception.chlorine_pct, 2)} %`} (${CHLORINE_LABELS[chlorine]})`, margin, 9, "normal", INK);
  y += 5;
  if (reception.compensates_id) {
    text(`Embarque de compensación del ticket No. ${String(reception.compensates_id).padStart(6, "0")} (corrección cruzada).`, margin, 9, "bold", GREEN);
    y += 5;
  }
  if (reception.notes) {
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(`Observaciones: ${reception.notes}`, usable) as string[];
    doc.setTextColor(...MUTED);
    doc.text(lines, margin, y);
    y += lines.length * 4.2;
  }

  // Firmas
  y = Math.max(y + 22, pageH - 62);
  const signW = (usable - 20) / 2;
  [["Operador de báscula", reception.closed_by_name ?? ""], ["Recibe · Control de calidad", ""]].forEach(([label, name], index) => {
    const sx = margin + index * (signW + 20);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.3);
    doc.line(sx, y, sx + signW, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(name || " ", sx + signW / 2, y + 5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label!, sx + signW / 2, y + 9.5, { align: "center" });
  });

  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Certificado generado el ${formatDateTime(new Date().toISOString())} por ${generatedBy} · SysNomQC. El ticket ${reception.id} está cerrado y amarrado al manifiesto ${reception.manifest_folio}; no admite cambios.`,
    margin,
    pageH - 10,
    { maxWidth: usable },
  );
  doc.save(`Certificado_recepcion_${reception.id}_${reception.manifest_folio.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`);
}
