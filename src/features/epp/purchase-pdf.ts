import type { EppPurchaseRequest, PurchaseStatus } from "@/lib/permissions";
import { formatDateTime, formatDay } from "./format";

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pendiente: "Pendiente",
  en_compra: "Comprada · por contar",
  recibida: "Recibida",
  cancelada: "Cancelada",
};

const GREEN: [number, number, number] = [11, 93, 42];
const GOLD: [number, number, number] = [197, 155, 39];
const INK: [number, number, number] = [28, 41, 33];
const MUTED: [number, number, number] = [95, 108, 100];

async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch("/logo-cooperativa.jpg");
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Descarga un PDF con una o varias solicitudes de compra, listo para enviarlo a comprar.
 * jsPDF se carga solo al pulsar el botón, para no hacer más pesada la pantalla.
 */
export async function downloadPurchasePdf(requests: EppPurchaseRequest[], generatedBy: string) {
  if (requests.length === 0) return;
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), loadLogo()]);
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const usable = pageW - margin * 2;
  const bottom = pageH - 22;
  let y = margin;

  const text = (value: string, x: number, size: number, style: "normal" | "bold" = "normal", color = INK, align: "left" | "right" = "left") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(value, x, y, { align });
  };

  // Encabezado con logotipo (solo en la primera página).
  if (logo) doc.addImage(logo, "JPEG", margin, y, 20, 20);
  const left = margin + (logo ? 25 : 0);
  y += 6;
  text("COOPERATIVA QUINTA GENERACIÓN", left, 12, "bold", GREEN);
  y += 4.5;
  text("S.C. DE R.L. DE C.V.", left, 8, "bold", GOLD);
  y += 6.5;
  text(requests.length === 1 ? "Solicitud de compra de EPP" : "Solicitudes de compra de EPP", left, 14, "bold");
  text(formatDay(new Date().toISOString()), pageW - margin, 8, "normal", MUTED, "right");
  y += 6;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  const columns = [
    { title: "#", width: 8, align: "left" as const },
    { title: "Artículo", width: 84, align: "left" as const },
    { title: "Unidad", width: 24, align: "left" as const },
    { title: "Existencia", width: 22, align: "right" as const },
    { title: "Mínimo", width: 18, align: "right" as const },
    { title: "", width: 0, align: "right" as const },
  ];
  columns[5].width = usable - columns.slice(0, 5).reduce((sum, column) => sum + column.width, 0);

  const drawHeaderRow = (lastTitle: string) => {
    doc.setFillColor(...GREEN);
    doc.rect(margin, y - 4.5, usable, 7, "F");
    let x = margin;
    columns.forEach((column, index) => {
      const label = index === 5 ? lastTitle : column.title;
      text(label, column.align === "right" ? x + column.width - 2 : x + 2, 8, "bold", [255, 255, 255], column.align);
      x += column.width;
    });
    y += 6;
  };

  const ensure = (height: number, lastTitle?: string) => {
    if (y + height <= bottom) return;
    doc.addPage();
    y = margin + 4;
    if (lastTitle) drawHeaderRow(lastTitle);
  };

  const drawRows = (rows: string[][], lastTitle: string) => {
    drawHeaderRow(lastTitle);
    rows.forEach((cells, rowIndex) => {
      doc.setFontSize(9);
      const nameLines = doc.splitTextToSize(cells[1] ?? "", columns[1].width - 3) as string[];
      const height = Math.max(1, nameLines.length) * 4.2 + 2.6;
      ensure(height, lastTitle);
      if (rowIndex % 2 === 1) {
        doc.setFillColor(243, 247, 244);
        doc.rect(margin, y - 4, usable, height, "F");
      }
      let x = margin;
      columns.forEach((column, index) => {
        const cell = index === 1 ? nameLines : [cells[index] ?? ""];
        doc.setFont("helvetica", index === 5 ? "bold" : "normal");
        doc.setFontSize(9);
        doc.setTextColor(...INK);
        doc.text(cell, column.align === "right" ? x + column.width - 2 : x + 2, y, { align: column.align });
        x += column.width;
      });
      y += height;
    });
    doc.setDrawColor(201, 211, 203);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 3, pageW - margin, y - 3);
    y += 3;
  };

  for (const request of requests) {
    ensure(34);
    text(`Folio ${request.id}  ·  Sede ${request.site}`, margin, 11, "bold", GREEN);
    text(PURCHASE_STATUS_LABELS[request.status], pageW - margin, 9, "bold", MUTED, "right");
    y += 5;
    text(`Fecha: ${formatDateTime(request.created_at)}  ·  Solicitó: ${request.requested_by_name ?? "Sin nombre"}`, margin, 9, "normal", MUTED);
    y += 4.5;
    if (request.notes) {
      doc.setFontSize(9);
      const lines = doc.splitTextToSize(`Observaciones: ${request.notes}`, usable) as string[];
      doc.setTextColor(...MUTED);
      doc.text(lines, margin, y);
      y += lines.length * 4.2;
    }
    y += 4;
    drawRows(
      request.items.map((item, index) => [
        String(index + 1),
        item.article_name,
        item.unit,
        String(item.stock_at_request),
        String(item.min_stock),
        String(item.quantity),
      ]),
      "A comprar",
    );
    const pieces = request.items.reduce((sum, item) => sum + item.quantity, 0);
    text(`Total: ${request.items.length} artículo(s), ${pieces} pieza(s)`, pageW - margin, 9, "bold", INK, "right");
    y += 10;
  }

  // Varias solicitudes: total por artículo para hacer una sola compra.
  if (requests.length > 1) {
    const totals = new Map<string, { name: string; unit: string; quantity: number; sites: Set<string> }>();
    for (const request of requests) {
      for (const item of request.items) {
        const key = `${item.article_name}|${item.unit}`;
        const entry = totals.get(key) ?? { name: item.article_name, unit: item.unit, quantity: 0, sites: new Set<string>() };
        entry.quantity += item.quantity;
        entry.sites.add(request.site);
        totals.set(key, entry);
      }
    }
    ensure(30);
    text("Resumen para compra", margin, 12, "bold", GREEN);
    y += 7;
    const sorted = Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
    columns[3].title = "Sedes";
    columns[4].title = "";
    drawRows(
      sorted.map((item, index) => [String(index + 1), item.name, item.unit, String(item.sites.size), "", String(item.quantity)]),
      "Total",
    );
  }

  // Firmas
  ensure(30);
  y += 16;
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.3);
  const signWidth = 70;
  doc.line(margin, y, margin + signWidth, y);
  doc.line(pageW - margin - signWidth, y, pageW - margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Solicitó", margin + signWidth / 2, y, { align: "center" });
  doc.text("Autorizó la compra", pageW - margin - signWidth / 2, y, { align: "center" });

  // Pie de página
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Generado el ${formatDateTime(new Date().toISOString())} por ${generatedBy}`, margin, pageH - 10);
    doc.text(`Página ${page} de ${pages}`, pageW - margin, pageH - 10, { align: "right" });
  }

  const first = requests[0];
  const name =
    requests.length === 1 && first
      ? `Solicitud-EPP-folio-${first.id}-${first.site.replace(/\s+/g, "_")}.pdf`
      : `Solicitudes-EPP-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}
