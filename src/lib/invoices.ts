// Facturas: tipos, lectura de datos del texto del PDF, flujo de pago y resúmenes semanales y mensuales.
// Sin dependencias de servidor ni de navegador: lo usan la API y la pantalla.
//
// Flujo (migración 202611240002_facturas_flujo_pago.sql). Lo cargado del PDF ya no se modifica:
//   1. Enviada (al cargar el PDF; la base le pone el folio FAC-00001)
//   2. Firmada / autorizada
//   3. Cargada al sistema
//   → Contrarecibo (PDF) con la fecha posible de cobro: la factura pasa a "por cobrar"
//   → Complemento de pago (PDF): se verifica contra el UUID y la factura queda cobrada y cerrada.
// Las facturas son nuestras: nosotros las cobramos (nos depositan).

/** Estatus heredado: "incidente" solo existe en facturas anteriores al flujo nuevo. */
export type InvoiceStatus = "pendiente" | "incidente";

/** Estado del documento (los tres cuadritos): solo avanza. */
export type InvoiceStage = "enviada" | "firmada" | "cargada";

export const INVOICE_STAGES: InvoiceStage[] = ["enviada", "firmada", "cargada"];

export const INVOICE_STAGE_LABELS: Record<InvoiceStage, string> = {
  enviada: "Enviada",
  firmada: "Firmada / autorizada",
  cargada: "Cargada al sistema",
};

/** Siguiente estado del documento (null si ya está cargada al sistema). */
export const nextInvoiceStage = (stage: InvoiceStage): InvoiceStage | null =>
  stage === "enviada" ? "firmada" : stage === "firmada" ? "cargada" : null;

export type Invoice = {
  id: number;
  /** Folio del sistema (FAC-00001), lo asigna la base al cargarla. */
  folio: string;
  /** Folio que trae el PDF (si se encontró). */
  pdf_folio: string | null;
  file_path: string;
  file_name: string;
  file_size: number;
  invoice_date: string;
  due_date: string | null;
  uuid: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  /** Siempre MXN en las facturas nuevas. */
  currency: string;
  status: InvoiceStatus;
  incident_description: string | null;
  stage: InvoiceStage;
  signed_at: string | null;
  signed_by_name: string | null;
  loaded_at: string | null;
  loaded_by_name: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  /** Fecha posible de cobro (del contrarecibo). Solo informativa. */
  payment_date: string | null;
  receipt_at: string | null;
  receipt_by_name: string | null;
  complement_path: string | null;
  complement_name: string | null;
  complement_at: string | null;
  complement_by_name: string | null;
  /** true: el complemento menciona el UUID de la factura · false: no · null: no se pudo revisar. */
  complement_verified: boolean | null;
  text_pages: number;
  has_text: boolean;
  /** Solo vienen al pedir una factura (no en la lista). */
  text_content?: string;
  events?: InvoiceEvent[];
  created_at: string;
  created_by_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
};

export type InvoiceEventKind = "enviada" | "firmada" | "cargada" | "contrarecibo" | "complemento" | "eliminada";

/** Paso del historial: lo escribe la base y nadie lo modifica. */
export type InvoiceEvent = {
  id: number;
  event: InvoiceEventKind;
  detail: Record<string, string | number | boolean | null>;
  at: string;
  by_name: string | null;
};

export const INVOICE_EVENT_LABELS: Record<InvoiceEventKind, string> = {
  enviada: "Factura cargada (enviada)",
  firmada: "Firmada / autorizada",
  cargada: "Cargada al sistema",
  contrarecibo: "Contrarecibo cargado",
  complemento: "Complemento de pago · cobrada y cerrada",
  eliminada: "Factura eliminada",
};

/** Cobrada y cerrada: ya tiene complemento de pago. */
export const isInvoicePaid = (invoice: Pick<Invoice, "complement_path">) => invoice.complement_path !== null;

/** Cerrada: cobrada o con incidente (heredado). Ya no admite ningún paso. */
export const isInvoiceClosed = (invoice: Pick<Invoice, "complement_path" | "status">) =>
  isInvoicePaid(invoice) || invoice.status === "incidente";

/** Lo que sigue en el flujo de la factura. */
export type InvoiceStep = "firmar" | "cargar" | "contrarecibo" | "complemento" | "cerrada";

export function invoiceStep(invoice: Pick<Invoice, "stage" | "receipt_path" | "complement_path" | "status">): InvoiceStep {
  if (isInvoiceClosed(invoice)) return "cerrada";
  if (invoice.stage === "enviada") return "firmar";
  if (invoice.stage === "firmada") return "cargar";
  return invoice.receipt_path === null ? "contrarecibo" : "complemento";
}

/** Cobro: sin contrarecibo aún, por cobrar (ya tiene contrarecibo) o cobrada (con complemento). */
export type PaymentState = "sin_contrarecibo" | "por_cobrar" | "cobrada";

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  sin_contrarecibo: "Sin contrarecibo",
  por_cobrar: "Por cobrar",
  cobrada: "Cobrada",
};

export function paymentState(invoice: Pick<Invoice, "receipt_path" | "complement_path">): PaymentState {
  if (invoice.complement_path !== null) return "cobrada";
  return invoice.receipt_path === null ? "sin_contrarecibo" : "por_cobrar";
}

/** Solo se elimina mientras está enviada (para volver a cargarla); después solo el Super administrador. */
export const canDeleteInvoice = (invoice: Pick<Invoice, "stage" | "status">, isSuperAdmin: boolean) =>
  isSuperAdmin || (invoice.stage === "enviada" && invoice.status === "pendiente");

/** Día (YYYY-MM-DD, hora de la planta) en que se cargó la factura al sistema. */
export function uploadedOn(invoice: Pick<Invoice, "created_at">): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(invoice.created_at),
  );
}

/** ¿El complemento menciona el UUID de la factura? null si la factura no tiene UUID o el PDF no trae texto. */
export function complementMatches(uuid: string | null, complementText: string): boolean | null {
  if (!uuid || !complementText.trim()) return null;
  const clean = (value: string) => value.toUpperCase().replace(/[^0-9A-F]/g, "");
  return clean(complementText).includes(clean(uuid));
}

/** Datos que se detectan del texto de la factura. */
export type InvoiceFields = {
  invoice_date: string | null;
  due_date: string | null;
  folio: string | null;
  uuid: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
};

// ---------------------------------------------------------------------------
// Lectura del texto (facturas CFDI del SAT y formatos comerciales comunes)
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, apr: 4, may: 5, mayo: 5,
  jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, aug: 8, sep: 9, sept: 9, septiembre: 9, set: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12, dec: 12,
};

const pad = (value: number) => String(value).padStart(2, "0");

function validDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Primera fecha que aparece en el texto: 2026-11-10, 10/11/2026 (día primero), 10 de noviembre de 2026, 10-nov-2026. */
export function findDate(text: string): string | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/(\d{4})-(\d{2})-(\d{2})/, (m) => validDate(+m[1]!, +m[2]!, +m[3]!)],
    [/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/, (m) => validDate(+m[3]!, +m[2]!, +m[1]!)],
    [
      /(\d{1,2})(?:\s+de)?[\s/.-]+([a-záéíóú]{3,10})\.?(?:\s+de(?:l)?)?[\s/.-]+(\d{4})/i,
      (m) => {
        const month = MONTHS[m[2]!.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];
        return month ? validDate(+m[3]!, month, +m[1]!) : null;
      },
    ],
  ];
  let best: { index: number; value: string } | null = null;
  for (const [pattern, build] of patterns) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      const value = build(match);
      if (value && (!best || (match.index ?? 0) < best.index)) best = { index: match.index ?? 0, value };
      if (value) break;
    }
  }
  return best?.value ?? null;
}

/** "$38,570.00" → 38570; "1.978,35 €" → 1978.35. */
export function parseAmount(raw: string): number | null {
  const clean = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(clean)) return null;
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  let normalized = clean;
  if (lastComma > lastDot && clean.length - lastComma - 1 === 2) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = clean.replace(/,/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

const AMOUNT = String.raw`((?:[$€]|MXN|USD|EUR)?\s*-?\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?\s*(?:[$€]|MXN|USD|EUR|M\.N\.)?)`;

type AmountHit = { value: number; raw: string; index: number };

function amountsAfter(text: string, label: RegExp): AmountHit[] {
  const pattern = new RegExp(`${label.source}\\s*(?:\\([^)]{0,20}\\))?\\s*[:=]?\\s*${AMOUNT}`, "gi");
  const hits: AmountHit[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[match.length - 1] ?? "";
    const value = parseAmount(raw);
    if (value !== null) hits.push({ value, raw, index: match.index ?? 0 });
  }
  return hits;
}

const currencyOf = (raw: string): string | null =>
  /USD|US\$|D[oó]lar/i.test(raw) ? "USD" : /EUR|€/.test(raw) ? "EUR" : /MXN|M\.N\.|\$/.test(raw) ? "MXN" : null;

/** Si hay varios montos, se prefiere el que está en pesos y, después, el último del documento. */
function pick(hits: AmountHit[], currency: string | null): AmountHit | null {
  if (hits.length === 0) return null;
  const same = currency ? hits.filter((hit) => currencyOf(hit.raw) === currency) : [];
  const list = same.length ? same : hits;
  return list[list.length - 1] ?? null;
}

function labeled(text: string, label: RegExp, value: RegExp): string | null {
  const match = text.match(new RegExp(`${label.source}\\s*[:#.]?\\s*${value.source}`, "i"));
  return match?.[1]?.trim() ?? null;
}

/** Detecta los datos principales de la factura a partir de su texto (moneda nacional). Lo no encontrado queda en null. */
export function parseInvoiceText(source: string): InvoiceFields {
  const text = source.replace(/\s+/g, " ").trim();

  const uuid = text.match(/\b([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\b/i)?.[1]?.toUpperCase() ?? null;

  const dateLabel = /(?:fecha\s+(?:y\s+hora\s+)?(?:de\s+)?(?:emisi[oó]n|expedici[oó]n|factura(?:ci[oó]n)?)|fecha)/;
  const dateText = labeled(text, dateLabel, /(.{0,40})/);
  const invoice_date = (dateText && findDate(dateText)) ?? findDate(text);
  const dueText = labeled(text, /(?:fecha\s+(?:de\s+)?)?(?:vencimiento|vence|fecha\s+l[ií]mite(?:\s+de\s+pago)?)/, /(.{0,40})/);
  const due_date = dueText ? findDate(dueText) : null;

  const folio =
    labeled(text, /(?:n[º°o.]?\s*(?:de\s+)?factura|folio(?!\s+fiscal)|factura\s+n[º°o.]?)/, /([A-Z0-9][A-Z0-9-]{0,30}[0-9])/) ?? null;

  const totals = amountsAfter(text, /(?<!sub)total(?:\s+a\s+pagar|\s+factura|\s+neto|\s+general)?/);
  // Moneda nacional: si hay montos en varias monedas, se toman los que están en pesos.
  const total = pick(totals, "MXN");
  const subtotal = pick(amountsAfter(text, /sub\s*-?\s*total/), "MXN");
  const tax = pick(amountsAfter(text, /(?:I\.?V\.?A\.?|impuestos?\s+trasladados?)(?:\s+trasladado)?(?:\s+\d{1,2}(?:[.,]\d+)?\s*%)?/), "MXN");

  return {
    invoice_date,
    due_date,
    folio,
    uuid,
    subtotal: subtotal?.value ?? null,
    tax: tax?.value ?? null,
    total: total?.value ?? null,
  };
}

// ---------------------------------------------------------------------------
// Resúmenes
// ---------------------------------------------------------------------------

/** Lunes de la semana de una fecha YYYY-MM-DD. */
export function weekStart(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, date!));
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

/** Lo de un periodo (semana o mes): facturas cargadas en él y su avance hasta cobrarse. */
export type InvoiceSummary = {
  key: string;
  /** Facturas cargadas al sistema en el periodo (por fecha de carga). */
  count: number;
  total: number;
  /** De esas: cuántas ya se firmaron, se cargaron al sistema, tienen contrarecibo y están cobradas. */
  signed: number;
  loaded: number;
  receipts: number;
  collected: number;
  /** Por cobrar: con contrarecibo y sin complemento (cuántas y monto). */
  toCollectCount: number;
  toCollect: number;
  /** Monto ya cobrado (con complemento). */
  collectedAmount: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

const emptySummary = (key: string): InvoiceSummary => ({
  key, count: 0, total: 0, signed: 0, loaded: 0, receipts: 0, collected: 0, toCollectCount: 0, toCollect: 0, collectedAmount: 0,
});

/** Agrupa por el periodo en que se cargó cada factura. Devuelve los periodos del más reciente al más antiguo. */
export function groupSummaries(invoices: Invoice[], period: (day: string) => string): InvoiceSummary[] {
  const groups = new Map<string, InvoiceSummary>();
  for (const invoice of invoices) {
    const key = period(uploadedOn(invoice));
    const item = groups.get(key) ?? groups.set(key, emptySummary(key)).get(key)!;
    const amount = invoice.total ?? 0;
    item.count += 1;
    item.total = round(item.total + amount);
    if (invoice.stage !== "enviada") item.signed += 1;
    if (invoice.stage === "cargada") item.loaded += 1;
    if (invoice.receipt_path) item.receipts += 1;
    const state = paymentState(invoice);
    if (state === "cobrada") {
      item.collected += 1;
      item.collectedAmount = round(item.collectedAmount + amount);
    } else if (state === "por_cobrar" && invoice.status !== "incidente") {
      item.toCollectCount += 1;
      item.toCollect = round(item.toCollect + amount);
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
}

/** Mismo resumen para una lista completa (una sola llave). */
export const summarize = (key: string, invoices: Invoice[]) => groupSummaries(invoices, () => key)[0] ?? emptySummary(key);

/** Pesos mexicanos ("$1,234.50"). */
export function formatMoney(value: number | null | undefined, currency = "MXN"): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}
