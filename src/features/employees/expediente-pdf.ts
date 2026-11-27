import { formatCurrency, formatDate, formatDateTime, type Employee } from "@/lib/employees";

// "Descargar expediente": genera el PDF directamente con jsPDF y lo descarga. No usa el cuadro
// de impresión del navegador, así que ningún navegador (Chrome, Edge, Safari, Firefox, móviles)
// le agrega encabezados ni pies (título, fecha, URL, "Página 1 de 2"). Todo cabe en una hoja A4.

const GREEN: [number, number, number] = [31, 58, 42];
const GOLD: [number, number, number] = [197, 155, 39];
const INK: [number, number, number] = [28, 41, 33];
const LABEL: [number, number, number] = [91, 106, 96];
const MUTED: [number, number, number] = [106, 119, 111];
const RULE: [number, number, number] = [201, 211, 203];
const ROW_RULE: [number, number, number] = [227, 232, 228];

type Field = [label: string, value: string];

/** Convierte una imagen (logo o foto) a JPEG en data URL; null si no se puede cargar. */
async function loadImage(src: string): Promise<{ data: string; ratio: number } | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blobUrl = URL.createObjectURL(await response.blob());
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = blobUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width || !canvas.height) return null;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return { data: canvas.toDataURL("image/jpeg", 0.9), ratio: canvas.width / canvas.height };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch {
    return null;
  }
}

function sections(employee: Employee): { title: string; fields: Field[]; wide: Set<string> }[] {
  const wide = new Set(["Dirección", "Motivo de baja", "Créditos activos", "Correo electrónico", "Baja registrada en el sistema"]);
  return [
    {
      title: "Información laboral",
      wide,
      fields: [
        ["ID empleado", employee.employee_code],
        ["Sede", employee.site],
        ["Área global", employee.area?.code ?? "—"],
        ["Puesto", employee.position],
        ["Asignación", employee.assignment ?? ""],
        ["Fecha de contratación", formatDate(employee.hire_date)],
        ["Tipo de contrato", employee.contract_type],
        ["Salario base", formatCurrency(employee.salary)],
        ["Salario de cotización", employee.contribution_salary === null ? "Sin capturar" : formatCurrency(employee.contribution_salary)],
        ["Cuenta bancaria", employee.bank_account || "No especificada"],
        ["Estatus", employee.active ? "Activo" : "Baja"],
        ...(employee.termination_date
          ? ([
              ["Día de baja", formatDate(employee.termination_date)],
              ["Baja registrada en el sistema", formatDateTime(employee.terminated_at)],
              ["Motivo de baja", employee.termination_reason || "No especificado"],
            ] as Field[])
          : []),
      ],
    },
    {
      title: "Información personal",
      wide,
      fields: [
        ["Género", employee.gender || "No especificado"],
        ["Fecha de nacimiento", formatDate(employee.birth_date)],
        ["Estado civil", employee.marital_status || "No especificado"],
        ["NSS", employee.nss || "No especificado"],
        ["CURP", employee.curp || "No especificada"],
        ["RFC", employee.rfc || "No especificado"],
        ["Créditos activos", employee.credits.length ? employee.credits.join(", ") : "Ninguno"],
      ],
    },
    {
      title: "Contacto y domicilio",
      wide,
      fields: [
        ["Correo electrónico", employee.email || "No especificado"],
        ["Teléfono", employee.phone || "No especificado"],
        ["Estado de residencia", employee.residence_state || "No especificado"],
        ["Dirección", employee.address || "No especificada"],
      ],
    },
  ];
}

export async function downloadExpedientePdf(employee: Employee, photoUrl?: string) {
  const [{ jsPDF }, logo, photo] = await Promise.all([
    import("jspdf"),
    loadImage("/logo-cooperativa.jpg"),
    photoUrl ? loadImage(photoUrl) : Promise.resolve(null),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const usable = pageW - margin * 2;
  let y = margin;

  const font = (size: number, style: "normal" | "bold", color: [number, number, number]) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };

  // Membrete: logo + nombre de la cooperativa, línea dorada.
  const logoSize = 18;
  if (logo) doc.addImage(logo.data, "JPEG", margin, y, logoSize * logo.ratio, logoSize);
  const brandX = margin + (logo ? logoSize * logo.ratio + 4 : 0);
  font(12, "bold", GREEN);
  doc.text("COOPERATIVA QUINTA GENERACIÓN", brandX, y + 8);
  font(8, "normal", MUTED);
  doc.text("S.C. de R.L. de C.V.", brandX, y + 12.5);
  y += logoSize + 3;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.9);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  // Título con foto a la derecha.
  const photoW = 24;
  const photoH = 30;
  const titleTop = y;
  if (photo) {
    const x = pageW - margin - photoW;
    // Recorte "cover": se centra la foto dentro del recuadro.
    const boxRatio = photoW / photoH;
    let w = photoW;
    let h = photoH;
    if (photo.ratio > boxRatio) w = photoH * photo.ratio;
    else h = photoW / photo.ratio;
    doc.saveGraphicsState();
    doc.rect(x, titleTop, photoW, photoH, null);
    doc.clip();
    doc.discardPath();
    doc.addImage(photo.data, "JPEG", x - (w - photoW) / 2, titleTop - (h - photoH) / 2, w, h);
    doc.restoreGraphicsState();
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.rect(x, titleTop, photoW, photoH, "S");
  }
  const titleW = usable - (photo ? photoW + 6 : 0);
  font(8, "bold", MUTED);
  doc.setCharSpace(0.6);
  doc.text("EXPEDIENTE DE PERSONAL", margin, titleTop + 9);
  doc.setCharSpace(0);
  font(16, "bold", INK);
  const nameLines = doc.splitTextToSize(employee.full_name, titleW) as string[];
  doc.text(nameLines, margin, titleTop + 16);
  font(9.5, "normal", MUTED);
  doc.text(
    `${employee.employee_code} · ${employee.site} · ${employee.active ? "Activo" : "Baja"}`,
    margin,
    titleTop + 16 + nameLines.length * 6.5,
  );
  y = Math.max(titleTop + (photo ? photoH : 0), titleTop + 18 + nameLines.length * 6.5) + 5;

  // Secciones en dos columnas (etiqueta / valor); los campos largos usan todo el ancho.
  const colGap = 6;
  const colW = (usable - colGap) / 2;
  const labelW = 36;
  const pad = 1.5;
  const lineH = 3.9;
  const size = 8.8;

  for (const section of sections(employee)) {
    font(9, "bold", GREEN);
    doc.setCharSpace(0.3);
    doc.text(section.title.toUpperCase(), margin, y + 3);
    doc.setCharSpace(0);
    y += 4.5;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);

    // Agrupa los campos en renglones: dos normales por renglón, o uno ancho.
    const rows: Field[][] = [];
    let pending: Field[] = [];
    for (const field of section.fields) {
      if (section.wide.has(field[0])) {
        if (pending.length) rows.push(pending);
        pending = [];
        rows.push([field]);
      } else {
        pending.push(field);
        if (pending.length === 2) {
          rows.push(pending);
          pending = [];
        }
      }
    }
    if (pending.length) rows.push(pending);

    for (const row of rows) {
      const isWide = row.length === 1 && section.wide.has(row[0][0]);
      const cells = row.map(([label, value], index) => {
        const width = isWide ? usable : colW;
        font(size, "bold", LABEL);
        const labelLines = doc.splitTextToSize(label, labelW - 2) as string[];
        font(size, "normal", INK);
        const valueLines = doc.splitTextToSize(value || "—", width - labelW - pad * 2) as string[];
        return { x: margin + index * (colW + colGap), width, labelLines, valueLines };
      });
      const lines = Math.max(...cells.map((cell) => Math.max(cell.labelLines.length, cell.valueLines.length)));
      const rowH = lines * lineH + pad * 2 + 0.6;
      for (const cell of cells) {
        font(size, "bold", LABEL);
        doc.text(cell.labelLines, cell.x + pad, y + pad + 3, { lineHeightFactor: lineH / (size * 0.3528) });
        font(size, "normal", INK);
        doc.text(cell.valueLines, cell.x + pad + labelW, y + pad + 3, { lineHeightFactor: lineH / (size * 0.3528) });
        doc.setDrawColor(...ROW_RULE);
        doc.setLineWidth(0.25);
        doc.line(cell.x, y + rowH, cell.x + cell.width, y + rowH);
      }
      y += rowH;
    }
    y += 5;
  }

  // Pie fijo al final de la hoja.
  const footerY = pageH - 12;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
  font(7.5, "normal", MUTED);
  doc.text(`${employee.employee_code} · ${employee.full_name}`, margin, footerY);
  doc.text(
    `Generado el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(new Date())}`,
    pageW - margin,
    footerY,
    { align: "right" },
  );

  doc.setProperties({ title: `Expediente ${employee.employee_code} - ${employee.full_name}` });
  doc.save(`Expediente ${employee.employee_code} - ${employee.full_name}.pdf`);
}
