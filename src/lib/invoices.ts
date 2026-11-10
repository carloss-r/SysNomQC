// Facturas: tipos, lectura de datos del texto del PDF y resúmenes semanales y mensuales.
// Sin dependencias de servidor ni de navegador: lo usan la API y la pantalla.

export type InvoiceStatus = "pendiente" | "pagada";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  pendiente: "Pendiente de pago",
  pagada: "Pagada",
};

export type Invoice = {
  id: number;
  file_path: string;
  file_name: string;
  file_size: number;
  invoice_date: string;
  due_date: string | null;
  folio: string | null;
  uuid: string | null;
  supplier_name: string | null;
  supplier_rfc: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;
  notes: string | null;
  status: InvoiceStatus;
  paid_on: string | null;
  paid_by_name: string | null;
  text_pages: number;
  /** Solo viene al pedir una factura (no en la lista). */
  text_content?: string;
  has_text: boolean;
  created_at: string;
  created_by_name: string | null;
  updated_at: string;
  updated_by_name: string | null;
};

/** Datos que se detectan del texto de la factura. */
export type InvoiceFields = {
  invoice_date: string | null;
  due_date: string | null;
  folio: string | null;
  uuid: string | null;
  supplier_name: string | null;
  supplier_rfc: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;
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

const RFC = /\b([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})\b/g;

/** Detecta los datos principales de la factura a partir de su texto. Lo no encontrado queda en null. */
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

  const rfcLabeled = labeled(text, /RFC(?:\s+(?:del\s+)?emisor)?(?:\s*\/\s*NIF)?/, /([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})/);
  const rfcs = Array.from(text.toUpperCase().matchAll(RFC), (match) => match[1]!);
  const supplier_rfc = rfcLabeled?.toUpperCase() ?? rfcs[0] ?? null;

  const supplier_name =
    labeled(text, /(?:nombre\s+(?:del\s+)?emisor|raz[oó]n\s+social(?:\s+del\s+emisor)?|emisor)/, /([^:|]{3,90}?)(?=\s+(?:RFC|R\.F\.C|R[eé]gimen|Domicilio|Lugar|Folio|C\.?P\.?)\b)/) ??
    text.match(/^(.{3,90}?)\s+(?:RFC|R\.F\.C)\b/i)?.[1]?.trim() ??
    null;

  const explicitCurrency = labeled(text, /moneda/, /([A-Z]{3})/)?.toUpperCase() ?? null;
  const totals = amountsAfter(text, /(?<!sub)total(?:\s+a\s+pagar|\s+factura|\s+neto|\s+general)?/);
  const total = pick(totals, explicitCurrency ?? "MXN");
  const currency = (total && currencyOf(total.raw)) ?? (explicitCurrency && /^[A-Z]{3}$/.test(explicitCurrency) ? explicitCurrency : "MXN");
  const subtotal = pick(amountsAfter(text, /sub\s*-?\s*total/), currency);
  const tax = pick(amountsAfter(text, /(?:I\.?V\.?A\.?|impuestos?\s+trasladados?)(?:\s+trasladado)?(?:\s+\d{1,2}(?:[.,]\d+)?\s*%)?/), currency);

  return {
    invoice_date,
    due_date,
    folio,
    uuid,
    supplier_name: supplier_name ? supplier_name.slice(0, 160) : null,
    supplier_rfc,
    subtotal: subtotal?.value ?? null,
    tax: tax?.value ?? null,
    total: total?.value ?? null,
    currency,
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

export type Totals = Record<string, number>;

export type InvoiceSummary = {
  key: string;
  count: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  total: Totals;
  paid: Totals;
  pending: Totals;
};

const add = (totals: Totals, currency: string, value: number | null) => {
  if (value === null) return;
  totals[currency] = Math.round(((totals[currency] ?? 0) + value) * 100) / 100;
};

export function summarize(key: string, invoices: Invoice[], today: string): InvoiceSummary {
  const summary: InvoiceSummary = { key, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0, total: {}, paid: {}, pending: {} };
  for (const invoice of invoices) {
    summary.count += 1;
    add(summary.total, invoice.currency, invoice.total);
    if (invoice.status === "pagada") {
      summary.paidCount += 1;
      add(summary.paid, invoice.currency, invoice.total);
    } else {
      summary.pendingCount += 1;
      add(summary.pending, invoice.currency, invoice.total);
      if (invoice.due_date && invoice.due_date < today) summary.overdueCount += 1;
    }
  }
  return summary;
}

/** Agrupa por una llave (mes "YYYY-MM" o lunes de la semana) y devuelve los grupos del más reciente al más antiguo. */
export function groupSummaries(invoices: Invoice[], keyOf: (invoice: Invoice) => string, today: string): InvoiceSummary[] {
  const groups = new Map<string, Invoice[]>();
  for (const invoice of invoices) {
    const key = keyOf(invoice);
    groups.set(key, [...(groups.get(key) ?? []), invoice]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, rows]) => summarize(key, rows, today));
}

export function formatMoney(value: number | null | undefined, currency = "MXN"): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** { MXN: 100, USD: 5 } → "$100.00 · US$5.00" (pesos primero). */
export function formatTotals(totals: Totals): string {
  const entries = Object.entries(totals).sort(([a], [b]) => (a === "MXN" ? -1 : b === "MXN" ? 1 : a.localeCompare(b)));
  return entries.length ? entries.map(([currency, value]) => formatMoney(value, currency)).join(" · ") : formatMoney(0);
}
