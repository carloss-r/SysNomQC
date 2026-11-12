const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Reportes descargables (EPP, combustibles alternos…) en PDF o Excel (.xlsx), con el mismo membrete:
 * logotipo, nombre de la cooperativa, título del reporte y datos (sede, periodo, trabajador…).
 * jsPDF y ExcelJS se cargan solo al pulsar el botón, para no hacer más pesada la pantalla.
 */

export type ReportCell = string | number;
export type ReportColumn = { header: string; width: number; align?: "left" | "right" | "center" };
export type ReportSection = { title: string; columns: ReportColumn[]; rows: ReportCell[][]; empty?: string };
export type Report = {
  /** Área bajo el nombre de la cooperativa; por omisión, la de EPP. */
  subtitle?: string;
  /** Título grande, p. ej. "Control mensual de EPP". */
  title: string;
  /** Datos que identifican el reporte: [["Sede", "Lagunas"], ["Periodo", "noviembre 2026"]]. */
  info: [string, string][];
  /** Totales que se muestran en recuadros debajo del membrete. */
  summary?: [string, string | number][];
  sections: ReportSection[];
  generatedBy: string;
  /** Nombre del archivo sin extensión. */
  fileName: string;
};

const ORG = "COOPERATIVA QUINTA GENERACIÓN";
const ORG_SUB = "S.C. DE R.L. DE C.V.  ·  Seguridad e higiene · Equipo de protección personal";
const orgSub = (report: Report) => (report.subtitle ? `S.C. DE R.L. DE C.V.  ·  ${report.subtitle}` : ORG_SUB);

const GREEN: [number, number, number] = [11, 93, 42];
const GOLD: [number, number, number] = [197, 155, 39];
const INK: [number, number, number] = [28, 41, 33];
const MUTED: [number, number, number] = [95, 108, 100];
const ZEBRA: [number, number, number] = [243, 247, 244];
const SOFT: [number, number, number] = [232, 242, 235];
const hex = (rgb: [number, number, number]) => rgb.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();

/** Texto apto para nombre de archivo: sin acentos ni símbolos. */
export function fileSafe(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function loadLogo(): Promise<string | null> {
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

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
export async function downloadReportPdf(report: Report) {
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), loadLogo()]);
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const usable = pageW - margin * 2;
  const bottom = pageH - 16;
  const generatedAt = formatDateTime(new Date().toISOString());
  let y = margin;

  const text = (value: string, x: number, size: number, style: "normal" | "bold" = "normal", color = INK, align: "left" | "right" | "center" = "left") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(value, x, y, { align });
  };

  // Membrete completo en la primera página.
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 4, "F");
  y = margin + 2;
  if (logo) doc.addImage(logo, "JPEG", margin, y - 2, 22, 22);
  const left = margin + (logo ? 27 : 0);
  y += 5;
  text(ORG, left, 13, "bold", GREEN);
  y += 4.5;
  text(orgSub(report), left, 8, "bold", GOLD);
  y += 8;
  text(report.title.toUpperCase(), left, 16, "bold", INK);
  text(`Generado: ${generatedAt}`, pageW - margin, 8, "normal", MUTED, "right");
  y += 6;

  // Datos que identifican el reporte (sede, periodo, trabajador…)
  const infoH = 8;
  doc.setFillColor(...SOFT);
  doc.roundedRect(margin, y - 1, usable, infoH, 1.5, 1.5, "F");
  let x = margin + 4;
  y += 4.3;
  for (const [label, value] of report.info) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text(`${label}:`, x, y);
    const labelW = doc.getTextWidth(`${label}: `);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(value, x + labelW, y);
    x += labelW + doc.getTextWidth(value) + 10;
  }
  y += 5.5;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Recuadros de totales
  if (report.summary?.length) {
    const gap = 4;
    const boxW = (usable - gap * (report.summary.length - 1)) / report.summary.length;
    report.summary.forEach(([label, value], index) => {
      const bx = margin + index * (boxW + gap);
      doc.setDrawColor(...GREEN);
      doc.setLineWidth(0.3);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(bx, y - 1, boxW, 13, 1.5, 1.5, "FD");
      doc.setFillColor(...GREEN);
      doc.rect(bx, y - 1, 1.6, 13, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...GREEN);
      doc.text(String(value), bx + 5, y + 5.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(label.toUpperCase(), bx + 5, y + 10);
    });
    y += 19;
  }

  // Encabezado corto en las páginas siguientes, para que cada hoja diga de qué es.
  const continuationHeader = () => {
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, pageW, 4, "F");
    y = margin + 3;
    text(`${report.title} · ${report.info.map(([, value]) => value).join(" · ")}`, margin, 9, "bold", GREEN);
    text(ORG, pageW - margin, 8, "bold", GOLD, "right");
    y += 3;
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 7;
  };

  for (const section of report.sections) {
    const totalWeight = section.columns.reduce((sum, column) => sum + column.width, 0);
    const widths = section.columns.map((column) => (column.width / totalWeight) * usable);
    const cellX = (index: number) => margin + widths.slice(0, index).reduce((sum, w) => sum + w, 0);

    const drawHead = () => {
      doc.setFillColor(...GREEN);
      doc.rect(margin, y - 4.6, usable, 7, "F");
      section.columns.forEach((column, index) => {
        const align = column.align ?? "left";
        const cx = align === "right" ? cellX(index) + widths[index]! - 2 : align === "center" ? cellX(index) + widths[index]! / 2 : cellX(index) + 2;
        text(column.header, cx, 8, "bold", [255, 255, 255], align);
      });
      y += 6;
    };
    const newPage = () => {
      doc.addPage();
      continuationHeader();
    };

    if (y + 22 > bottom) newPage();
    text(section.title, margin, 11, "bold", GREEN);
    doc.setFillColor(...GOLD);
    doc.rect(margin, y + 1.2, 18, 0.8, "F");
    y += 7;
    drawHead();

    if (section.rows.length === 0) {
      text(section.empty ?? "Sin registros.", margin + 2, 9, "normal", MUTED);
      y += 8;
      continue;
    }

    section.rows.forEach((row, rowIndex) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      const lines = row.map((cell, index) => doc.splitTextToSize(String(cell ?? ""), widths[index]! - 3) as string[]);
      const height = Math.max(1, ...lines.map((cell) => cell.length)) * 3.8 + 2.4;
      if (y + height > bottom) {
        newPage();
        drawHead();
      }
      if (rowIndex % 2 === 1) {
        doc.setFillColor(...ZEBRA);
        doc.rect(margin, y - 3.8, usable, height, "F");
      }
      section.columns.forEach((column, index) => {
        const align = column.align ?? "left";
        const cx = align === "right" ? cellX(index) + widths[index]! - 2 : align === "center" ? cellX(index) + widths[index]! / 2 : cellX(index) + 2;
        doc.setFont("helvetica", index === 0 ? "bold" : "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...INK);
        doc.text(lines[index] ?? [""], cx, y, { align });
      });
      doc.setDrawColor(221, 229, 223);
      doc.setLineWidth(0.15);
      doc.line(margin, y - 3.8 + height, pageW - margin, y - 3.8 + height);
      y += height;
    });
    y += 8;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`${report.title} · Generado el ${generatedAt} por ${report.generatedBy} · SysNomQC`, margin, pageH - 8);
    doc.text(`Página ${page} de ${pages}`, pageW - margin, pageH - 8, { align: "right" });
  }
  doc.save(`${report.fileName}.pdf`);
}

// ---------------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------------
export async function downloadReportXlsx(report: Report) {
  const [ExcelModule, logo] = await Promise.all([import("exceljs"), loadLogo()]);
  const ExcelJS = (ExcelModule as unknown as { default?: typeof import("exceljs") }).default ?? ExcelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.generatedBy;
  workbook.created = new Date();
  workbook.title = report.title;
  workbook.company = ORG;
  const generatedAt = formatDateTime(new Date().toISOString());
  const logoId = logo ? workbook.addImage({ base64: logo, extension: "jpeg" }) : null;

  const thin = { style: "thin" as const, color: { argb: "FFD5DED7" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const usedNames = new Set<string>();

  for (const section of report.sections) {
    // Nombre de hoja: máximo 31 caracteres, sin símbolos prohibidos y sin repetir.
    let name = section.title.replace(/[\\/*?:[\]]/g, " ").slice(0, 31).trim() || "Hoja";
    for (let n = 2; usedNames.has(name); n += 1) name = `${name.slice(0, 27)} (${n})`;
    usedNames.add(name);

    const sheet = workbook.addWorksheet(name, {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      headerFooter: { oddFooter: `&L${report.title} · ${report.info.map(([, v]) => v).join(" · ")}&RPágina &P de &N` },
    });
    const count = Math.max(section.columns.length, 4);
    sheet.columns = Array.from({ length: count }, (_, index) => ({ width: Math.max(10, (section.columns[index]?.width ?? 12) * 1.15) }));
    const lastCol = sheet.getColumn(count).letter;
    const startCol = logoId !== null ? "B" : "A";

    // --- Membrete ---
    const band = (row: number, value: string, size: number, color: string, bold = true) => {
      sheet.mergeCells(`${startCol}${row}:${lastCol}${row}`);
      const cell = sheet.getCell(`${startCol}${row}`);
      cell.value = value;
      cell.font = { name: "Calibri", size, bold, color: { argb: `FF${color}` } };
      cell.alignment = { vertical: "middle" };
    };
    band(1, ORG, 15, hex(GREEN));
    band(2, orgSub(report), 9, hex(GOLD));
    band(3, report.title.toUpperCase(), 16, hex(INK));
    band(4, `${section.title}  ·  Generado el ${generatedAt} por ${report.generatedBy}`, 9, hex(MUTED), false);
    sheet.getRow(1).height = 22;
    sheet.getRow(3).height = 24;
    if (logoId !== null) {
      sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width ?? 10, 12);
      sheet.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 70, height: 70 } });
    }

    // Datos de identificación
    let row = 6;
    for (const [label, value] of report.info) {
      sheet.getCell(`A${row}`).value = label;
      sheet.getCell(`A${row}`).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getCell(`A${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex(GREEN)}` } };
      sheet.mergeCells(`B${row}:${lastCol}${row}`);
      sheet.getCell(`B${row}`).value = value;
      sheet.getCell(`B${row}`).font = { bold: true, color: { argb: `FF${hex(INK)}` } };
      sheet.getCell(`B${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex(SOFT)}` } };
      row += 1;
    }
    if (report.summary?.length) {
      for (const [label, value] of report.summary) {
        sheet.getCell(`A${row}`).value = label;
        sheet.getCell(`A${row}`).font = { color: { argb: `FF${hex(MUTED)}` } };
        sheet.getCell(`B${row}`).value = value;
        sheet.getCell(`B${row}`).font = { bold: true, color: { argb: `FF${hex(GREEN)}` } };
        row += 1;
      }
    }
    // Línea dorada que separa el membrete de la tabla
    for (let col = 1; col <= count; col += 1) {
      sheet.getRow(row).getCell(col).border = { bottom: { style: "medium", color: { argb: `FF${hex(GOLD)}` } } };
    }
    row += 2;

    // --- Tabla ---
    const headRow = sheet.getRow(row);
    section.columns.forEach((column, index) => {
      const cell = headRow.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex(GREEN)}` } };
      cell.alignment = { vertical: "middle", horizontal: column.align ?? "left", wrapText: true };
      cell.border = { ...border, bottom: { style: "medium", color: { argb: `FF${hex(GOLD)}` } } };
    });
    headRow.height = 20;
    const headIndex = row;

    if (section.rows.length === 0) {
      sheet.getCell(`A${row + 1}`).value = section.empty ?? "Sin registros.";
      sheet.getCell(`A${row + 1}`).font = { italic: true, color: { argb: `FF${hex(MUTED)}` } };
    }
    section.rows.forEach((values, rowIndex) => {
      const excelRow = sheet.getRow(headIndex + 1 + rowIndex);
      values.forEach((value, index) => {
        const cell = excelRow.getCell(index + 1);
        cell.value = value;
        cell.border = border;
        cell.alignment = { vertical: "top", horizontal: section.columns[index]?.align ?? "left", wrapText: true };
        if (index === 0) cell.font = { bold: true };
        if (rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex(ZEBRA)}` } };
      });
    });

    if (section.rows.length > 0) {
      sheet.autoFilter = { from: { row: headIndex, column: 1 }, to: { row: headIndex + section.rows.length, column: section.columns.length } };
    }
    sheet.views = [{ state: "frozen", ySplit: headIndex }];
    sheet.pageSetup.printTitlesRow = `${headIndex}:${headIndex}`;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${report.fileName}.xlsx`,
  );
}
