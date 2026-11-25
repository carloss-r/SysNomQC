// Buscador de facturas: una sola caja de texto que entiende folios, estados, fechas y montos.
// Sin dependencias de servidor ni de navegador (se prueba con node).
//
// Ejemplos:
//   "FAC-00012"                  folio del sistema, folio del PDF, UUID, archivos o quién la cargó
//   "falta complemento"          estado (por firmar, por cargar, falta contrarecibo, falta complemento,
//                                cerradas, abiertas, incidente)
//   "esta semana" · "semana pasada" · "este mes" · "mes pasado" · "hoy" · "ayer"
//   "noviembre" · "nov 2026" · "2026-11" · "11/2026"            un mes
//   "24/11/2026" · "24/11" · "2026-11-24"                      un día
//   "semana 24/11"                                             la semana (lunes a domingo) de ese día
//   "$1,160" · ">5000" · "<1000" · "1160.00"                   monto total
// Las palabras se combinan: "falta complemento semana pasada" → las dos condiciones.
// Las fechas se aplican al día en que la factura se cargó al sistema (así se mide cada semana).

import { invoiceStep, isInvoiceClosed, uploadedOn, weekStart, type Invoice } from "./invoices";

export type SearchState = "firmar" | "cargar" | "contrarecibo" | "complemento" | "cerrada" | "abierta" | "incidente";

export type SearchPeriod = { kind: "day" | "week" | "month"; from: string; to: string; label: string };

/** A qué fecha se aplica el periodo: el día en que se cargó al sistema o la fecha de la factura. */
export type DateField = "upload" | "invoice";

export type InvoiceQuery = {
  states: SearchState[];
  period: SearchPeriod | null;
  /** Por omisión, el día de carga al sistema (así se mide cada semana). */
  dateField?: DateField;
  amount: { op: "=" | ">" | "<"; value: number } | null;
  /** Rango de total (filtros del menú). */
  minAmount?: number | null;
  maxAmount?: number | null;
  terms: string[];
};

export const EMPTY_QUERY: InvoiceQuery = { states: [], period: null, amount: null, terms: [] };

/** Periodos rápidos del menú de filtros (mismas palabras que entiende el buscador). */
export const QUICK_PERIODS = ["hoy", "ayer", "esta semana", "semana pasada", "este mes", "mes pasado"] as const;
export type QuickPeriod = (typeof QUICK_PERIODS)[number];

/** Rango de fechas elegido en el calendario (desde / hasta, cualquiera puede ir vacío). */
export function rangePeriod(from: string, to: string): SearchPeriod | null {
  if (!from && !to) return null;
  const start = from || "2000-01-01";
  const end = to || "2100-12-31";
  const [a, b] = start <= end ? [start, end] : [end, start];
  const label = from && to ? `del ${fmt(a)} al ${fmt(b)}` : from ? `desde el ${fmt(from)}` : `hasta el ${fmt(to)}`;
  return { kind: "day", from: a, to: b, label };
}

/** Periodo de una palabra rápida ("esta semana", "mes pasado"…). */
export function quickPeriod(word: QuickPeriod, today: string): SearchPeriod | null {
  return parseInvoiceQuery(word, today).period;
}

export const STATE_LABELS: Record<SearchState, string> = {
  firmar: "Por firmar",
  cargar: "Por cargar al sistema",
  contrarecibo: "Falta contrarecibo",
  complemento: "Falta complemento",
  cerrada: "Cerradas",
  abierta: "Abiertas (sin cerrar)",
  incidente: "Con incidente",
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_LABELS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const pad = (value: number) => String(value).padStart(2, "0");
const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function addDays(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
function validDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
const fmt = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const dayPeriod = (day: string): SearchPeriod => ({ kind: "day", from: day, to: day, label: `el ${fmt(day)}` });
const weekPeriod = (day: string, label?: string): SearchPeriod => {
  const monday = weekStart(day);
  const sunday = addDays(monday, 6);
  return { kind: "week", from: monday, to: sunday, label: label ?? `la semana del ${fmt(monday)} al ${fmt(sunday)}` };
};
const monthPeriod = (y: number, m: number, label?: string): SearchPeriod => ({
  kind: "month",
  from: `${y}-${pad(m)}-01`,
  to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`,
  label: label ?? `${MONTH_LABELS[m - 1]} ${y}`,
});

// Frases de estado y de periodo (de la más larga a la más corta, para que "falta complemento" gane a "complemento").
const STATE_PHRASES: [string, SearchState][] = [
  ["por cargar al sistema", "cargar"], ["cargar al sistema", "cargar"], ["por cargar", "cargar"],
  ["falta contrarecibo", "contrarecibo"], ["sin contrarecibo", "contrarecibo"], ["contrarecibo", "contrarecibo"],
  ["falta complemento", "complemento"], ["sin complemento", "complemento"], ["complemento", "complemento"],
  ["por firmar", "firmar"], ["sin firmar", "firmar"], ["enviadas", "firmar"], ["enviada", "firmar"],
  ["firmadas", "cargar"], ["firmada", "cargar"],
  ["en proceso", "abierta"], ["sin cerrar", "abierta"], ["pendientes", "abierta"], ["pendiente", "abierta"], ["abiertas", "abierta"], ["abierta", "abierta"],
  ["cerradas", "cerrada"], ["cerrada", "cerrada"], ["cerrados", "cerrada"], ["cobradas", "cerrada"], ["cobrada", "cerrada"],
  ["incidentes", "incidente"], ["incidente", "incidente"],
];

/** Interpreta lo que se escribió en el buscador. */
export function parseInvoiceQuery(raw: string, today: string): InvoiceQuery {
  const query: InvoiceQuery = { states: [], period: null, amount: null, terms: [] };
  let text = ` ${normalize(raw)} `;
  const take = (pattern: RegExp, use: (match: RegExpMatchArray) => boolean) => {
    text = text.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpMatchArray;
      return use(match) ? " " : match[0];
    });
  };
  const [ty, tm] = today.split("-").map(Number) as [number, number];

  // Periodos con nombre.
  const named: [RegExp, () => SearchPeriod][] = [
    [/ (esta semana|semana actual) /g, () => weekPeriod(today, "esta semana")],
    [/ (semana pasada|la semana pasada|semana anterior) /g, () => weekPeriod(addDays(today, -7), "la semana pasada")],
    [/ (este mes|mes actual) /g, () => monthPeriod(ty, tm, "este mes")],
    [/ (mes pasado|mes anterior) /g, () => (tm === 1 ? monthPeriod(ty - 1, 12, "el mes pasado") : monthPeriod(ty, tm - 1, "el mes pasado"))],
    [/ hoy /g, () => dayPeriod(today)],
    [/ ayer /g, () => dayPeriod(addDays(today, -1))],
  ];
  for (const [pattern, build] of named) take(pattern, () => ((query.period = build()), true));

  // "semana 24/11[/2026]" o "semana 2026-11-24".
  take(/ semana (?:del )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))? /g, (m) => {
    const day = validDay(Number(m[3] ?? ty), Number(m[2]), Number(m[1]));
    if (day) query.period = weekPeriod(day);
    return day !== null;
  });
  take(/ semana (?:del )?(\d{4})-(\d{2})-(\d{2}) /g, (m) => {
    const day = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (day) query.period = weekPeriod(day);
    return day !== null;
  });

  // Días: 2026-11-24 · 24/11/2026 · 24/11.
  take(/ (\d{4})-(\d{2})-(\d{2}) /g, (m) => {
    const day = validDay(Number(m[1]), Number(m[2]), Number(m[3]));
    if (day) query.period = dayPeriod(day);
    return day !== null;
  });
  take(/ (\d{1,2})\/(\d{1,2})\/(\d{4}) /g, (m) => {
    const day = validDay(Number(m[3]), Number(m[2]), Number(m[1]));
    if (day) query.period = dayPeriod(day);
    return day !== null;
  });
  // Meses: 2026-11 · 11/2026.
  take(/ (\d{4})-(\d{2}) /g, (m) => {
    const ok = Number(m[2]) >= 1 && Number(m[2]) <= 12;
    if (ok) query.period = monthPeriod(Number(m[1]), Number(m[2]));
    return ok;
  });
  take(/ (\d{1,2})\/(\d{4}) /g, (m) => {
    const ok = Number(m[1]) >= 1 && Number(m[1]) <= 12;
    if (ok) query.period = monthPeriod(Number(m[2]), Number(m[1]));
    return ok;
  });
  take(/ (\d{1,2})\/(\d{1,2}) /g, (m) => {
    const day = validDay(ty, Number(m[2]), Number(m[1]));
    if (day) query.period = dayPeriod(day);
    return day !== null;
  });
  // Nombre del mes (completo o de 3 letras), con año opcional; sin año, el más reciente que no sea futuro.
  take(/ (?:de )?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)(?: (?:de |del )?(\d{4}))? /g, (m) => {
    const word = m[1] === "setiembre" ? "septiembre" : m[1]!;
    const month = MONTHS.findIndex((name) => name.startsWith(word.slice(0, 3))) + 1;
    if (month < 1) return false;
    const year = m[2] ? Number(m[2]) : month > tm ? ty - 1 : ty;
    query.period = monthPeriod(year, month);
    return true;
  });

  // Estados.
  for (const [phrase, state] of STATE_PHRASES) {
    take(new RegExp(` ${phrase} `, "g"), () => {
      if (!query.states.includes(state)) query.states.push(state);
      return true;
    });
  }

  // Montos: $1,160 · >5000 · <1000 · 1160.50 (con decimales).
  take(/ ([<>])\s*\$?\s*([\d,]+(?:\.\d{1,2})?) /g, (m) => {
    query.amount = { op: m[1] as ">" | "<", value: Number(m[2]!.replace(/,/g, "")) };
    return true;
  });
  take(/ \$\s*([\d,]+(?:\.\d{1,2})?) /g, (m) => ((query.amount = { op: "=", value: Number(m[1]!.replace(/,/g, "")) }), true));
  take(/ (\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}) /g, (m) => ((query.amount = { op: "=", value: Number(m[1]!.replace(/,/g, "")) }), true));

  query.terms = text.split(" ").map((word) => word.trim()).filter((word) => word.length > 0 && !["de", "del", "la", "las", "el", "los", "y"].includes(word));
  return query;
}

function matchesState(invoice: Invoice, state: SearchState) {
  if (state === "incidente") return invoice.status === "incidente";
  if (state === "cerrada") return invoiceStep(invoice) === "cerrada" && invoice.status !== "incidente";
  if (state === "abierta") return !isInvoiceClosed(invoice);
  return invoiceStep(invoice) === state;
}

/** ¿La factura cumple todo lo que se escribió? Varios estados se suman (uno u otro); lo demás se combina (y). */
export function matchesInvoiceQuery(invoice: Invoice, query: InvoiceQuery): boolean {
  if (query.states.length && !query.states.some((state) => matchesState(invoice, state))) return false;
  if (query.period) {
    const day = query.dateField === "invoice" ? invoice.invoice_date : uploadedOn(invoice);
    if (day < query.period.from || day > query.period.to) return false;
  }
  if (query.amount) {
    const total = invoice.total;
    if (total === null) return false;
    if (query.amount.op === "=" && Math.abs(total - query.amount.value) > 0.005) return false;
    if (query.amount.op === ">" && !(total > query.amount.value)) return false;
    if (query.amount.op === "<" && !(total < query.amount.value)) return false;
  }
  if (query.minAmount != null || query.maxAmount != null) {
    const total = invoice.total;
    if (total === null) return false;
    if (query.minAmount != null && total < query.minAmount) return false;
    if (query.maxAmount != null && total > query.maxAmount) return false;
  }
  if (query.terms.length) {
    const haystack = normalize(
      [invoice.folio, invoice.pdf_folio, invoice.uuid, invoice.file_name, invoice.receipt_name, invoice.complement_name,
        invoice.created_by_name, invoice.signed_by_name, invoice.loaded_by_name, invoice.receipt_by_name, invoice.complement_by_name]
        .filter(Boolean)
        .join(" "),
    );
    // El folio se encuentra también sin ceros ni guion: "fac12", "12" o "fac-00012".
    const folioDigits = invoice.folio.replace(/\D/g, "").replace(/^0+/, "");
    for (const term of query.terms) {
      const digits = term.replace(/^fac-?/, "").replace(/^0+/, "");
      const isFolio = /^(fac-?)?\d+$/.test(term) && digits === folioDigits;
      if (!isFolio && !haystack.includes(term)) return false;
    }
  }
  return true;
}

/** Resumen legible de lo que entendió el buscador (para mostrarlo debajo de la caja). */
export function describeQuery(query: InvoiceQuery): string[] {
  const parts: string[] = [];
  if (query.states.length) parts.push(query.states.map((state) => STATE_LABELS[state]).join(" o "));
  if (query.period) parts.push(`${query.dateField === "invoice" ? "con fecha de factura" : "cargadas"} ${query.period.label}`);
  if (query.amount) {
    const value = query.amount.value.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
    parts.push(query.amount.op === "=" ? `total de ${value}` : `total ${query.amount.op === ">" ? "mayor" : "menor"} a ${value}`);
  }
  const money = (value: number) => value.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  if (query.minAmount != null && query.maxAmount != null) parts.push(`total entre ${money(query.minAmount)} y ${money(query.maxAmount)}`);
  else if (query.minAmount != null) parts.push(`total desde ${money(query.minAmount)}`);
  else if (query.maxAmount != null) parts.push(`total hasta ${money(query.maxAmount)}`);
  if (query.terms.length) parts.push(`que contengan «${query.terms.join(" ")}»`);
  return parts;
}
