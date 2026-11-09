// Combustibles alternos y sustitución térmica (especificación en Archivos/ModuloCoque.txt).
// Estas fórmulas y límites son los mismos que aplica la base de datos
// (supabase/migrations/202611100001_combustibles_alternos.sql); la base es la que bloquea.

/** Candados de calidad de M1: lo que no los cumple no se guarda. */
export const QUALITY_LIMITS = {
  minCalorific: 5000, // cal/g
  maxChlorine: 1.8, // %
  maxWater: 12.0, // %
  maxSulfur: 1.0, // %
} as const;

/** Línea base del coque de petróleo (cal/g). */
export const COKE_CALORIFIC = 7500;
/** Límite autorizado por SEMARNAT para el horno (% de sustitución térmica). */
export const SEMARNAT_LIMIT = 30;
/** Hasta este % el semáforo está en verde. */
export const GREEN_UNTIL = 25;
/** Días antes del vencimiento del permiso SEMARNAT en que se avisa. */
export const PERMIT_WARNING_DAYS = 30;
/** Plazo para corregir un embarque con cloro fuera de especificación. */
export const COMPENSATION_DAYS = 2;

export type SemaphoreLevel = "verde" | "amarillo" | "rojo" | "sin_datos";
export type CommercialScheme = "cobro" | "pago" | "valor_cero";
export type ScheduleStatus = "programado" | "en_planta" | "recibido" | "cancelado";
export type ReceptionStatus = "en_planta" | "cerrado" | "cancelado";

export const SCHEME_LABELS: Record<CommercialScheme, string> = { cobro: "Cobro", pago: "Pago", valor_cero: "Valor 0" };
export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  programado: "Programado",
  en_planta: "En planta",
  recibido: "Recibido",
  cancelado: "Cancelado",
};
export const RECEPTION_STATUS_LABELS: Record<ReceptionStatus, string> = { en_planta: "En planta", cerrado: "Cerrado", cancelado: "Cancelado" };
export const LEVEL_LABELS: Record<SemaphoreLevel, string> = { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo", sin_datos: "Sin datos" };

export type FuelProduct = {
  id: number;
  supplier_id: number;
  name: string;
  calorific_value: number;
  chlorine_pct: number;
  water_pct: number;
  sulfur_pct: number;
  scheme: CommercialScheme;
  rate_per_ton: number;
  active: boolean;
  updated_at: string;
  updated_by_name: string | null;
};

export type FuelSupplier = {
  id: number;
  business_name: string;
  rfc: string;
  address: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  permit_number: string | null;
  permit_valid_until: string;
  permit_path: string | null;
  status: "aprobado" | "rechazado";
  status_note: string | null;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  products: FuelProduct[];
};

export type FuelSchedule = {
  id: number;
  scheduled_on: string;
  supplier_id: number;
  product_id: number;
  carrier: string;
  estimated_tons: number;
  notes: string | null;
  status: ScheduleStatus;
  status_note: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type FuelReception = {
  id: number;
  manifest_folio: string;
  schedule_id: number | null;
  supplier_id: number;
  generator_name: string;
  generator_rfc: string;
  product_id: number;
  product_name: string;
  calorific_value: number;
  carrier: string;
  driver: string;
  plates: string;
  vehicle: string | null;
  destination: string;
  gross_kg: number;
  gross_at: string;
  tare_kg: number | null;
  tare_at: string | null;
  net_kg: number | null;
  received_on: string | null;
  chlorine_pct: number | null;
  compensates_id: number | null;
  scheme: CommercialScheme | null;
  rate_per_ton: number | null;
  subtotal: number | null;
  month_pct_after: number | null;
  status: ReceptionStatus;
  notes: string | null;
  cancel_reason: string | null;
  created_by_name: string | null;
  closed_by_name: string | null;
};

export type FuelCoke = { month: string; coke_tons: number; notes: string | null; updated_at: string; updated_by_name: string | null };

/** Resumen de un mes (mismo cálculo que fuel_month_summary en la base). */
export type FuelMonthSummary = {
  month: string; // YYYY-MM
  alt_tons: number;
  alt_gcal: number;
  pending_tons: number;
  pending_gcal: number;
  coke_tons: number | null;
  coke_gcal: number | null;
  /** El coque del mes no se ha capturado; se proyecta con el de coke_month. */
  coke_estimated: boolean;
  coke_month: string | null;
  pct: number | null;
  level: SemaphoreLevel;
  projected_pct: number | null;
  projected_level: SemaphoreLevel;
};

// ---------------------------------------------------------------------------
// Memoria de cálculo
// ---------------------------------------------------------------------------

/** Energía (Gcal) = toneladas × poder calorífico (cal/g) / 1000. */
export const energyGcal = (tons: number, calPerGram: number) => (tons * calPerGram) / 1000;
export const cokeGcal = (tons: number) => energyGcal(tons, COKE_CALORIFIC);

/** % sustitución = alternos / (alternos + coque) × 100. null si aún no hay coque. */
export function substitutionPct(altGcal: number, coke: number | null): number | null {
  if (coke === null || altGcal + coke <= 0) return null;
  return (altGcal / (altGcal + coke)) * 100;
}

export function semaphoreLevel(pct: number | null): SemaphoreLevel {
  if (pct === null || Number.isNaN(pct)) return "sin_datos";
  const rounded = Math.round(pct * 10) / 10;
  if (rounded <= GREEN_UNTIL) return "verde";
  if (rounded < SEMARNAT_LIMIT) return "amarillo";
  return "rojo";
}

export const netTons = (reception: Pick<FuelReception, "net_kg">) => (reception.net_kg ?? 0) / 1000;
export const receptionGcal = (reception: Pick<FuelReception, "net_kg" | "calorific_value">) =>
  energyGcal(netTons(reception), reception.calorific_value);

export const monthOf = (day: string) => day.slice(0, 7);

/** Mismo cálculo que la base: recibido (cerrado) + programado pendiente, con el coque del mes o el último capturado. */
export function computeMonth(
  month: string,
  receptions: FuelReception[],
  schedule: FuelSchedule[],
  products: Map<number, FuelProduct>,
  coke: FuelCoke[],
  extraGcal = 0,
): FuelMonthSummary {
  const closed = receptions.filter((row) => row.status === "cerrado" && row.received_on && monthOf(row.received_on) === month);
  const altTons = closed.reduce((sum, row) => sum + netTons(row), 0);
  const altGcal = closed.reduce((sum, row) => sum + receptionGcal(row), 0);
  const pending = schedule.filter((row) => (row.status === "programado" || row.status === "en_planta") && monthOf(row.scheduled_on) === month);
  const pendingTons = pending.reduce((sum, row) => sum + row.estimated_tons, 0);
  const pendingGcal = pending.reduce((sum, row) => sum + energyGcal(row.estimated_tons, products.get(row.product_id)?.calorific_value ?? 0), 0);

  const sorted = [...coke].sort((a, b) => b.month.localeCompare(a.month));
  const own = sorted.find((row) => monthOf(row.month) === month);
  const base = own ?? sorted.find((row) => monthOf(row.month) < month);
  const cokeTons = base ? base.coke_tons : null;
  const coke_gcal = cokeTons === null ? null : cokeGcal(cokeTons);
  const pct = substitutionPct(altGcal, coke_gcal);
  const projected = substitutionPct(altGcal + pendingGcal + extraGcal, coke_gcal);

  return {
    month,
    alt_tons: altTons,
    alt_gcal: altGcal,
    pending_tons: pendingTons,
    pending_gcal: pendingGcal,
    coke_tons: cokeTons,
    coke_gcal,
    coke_estimated: !own && Boolean(base),
    coke_month: base ? monthOf(base.month) : null,
    pct,
    level: semaphoreLevel(pct),
    projected_pct: projected,
    projected_level: semaphoreLevel(projected),
  };
}

// ---------------------------------------------------------------------------
// Candados de M1
// ---------------------------------------------------------------------------
export type QualityInput = { name: string; calorific_value: number | null; chlorine_pct: number | null; water_pct: number | null; sulfur_pct: number | null };

/** Lista de motivos por los que el análisis no pasa (vacía = aprobado). */
export function qualityProblems(product: QualityInput): string[] {
  const name = product.name.trim() || "El producto";
  const problems: string[] = [];
  const { calorific_value: cal, chlorine_pct: cl, water_pct: water, sulfur_pct: sulfur } = product;
  if ([cal, cl, water, sulfur].some((value) => value === null || Number.isNaN(value))) {
    return [`${name}: completa el análisis (poder calorífico, cloro, agua y azufre).`];
  }
  if (cal! < QUALITY_LIMITS.minCalorific) problems.push(`${name}: ${fmt(cal!, 0)} cal/g (mínimo ${fmt(QUALITY_LIMITS.minCalorific, 0)}).`);
  if (cl! > QUALITY_LIMITS.maxChlorine) problems.push(`${name}: ${fmt(cl!, 2)} % de cloro (máximo ${fmt(QUALITY_LIMITS.maxChlorine, 2)} %).`);
  if (water! > QUALITY_LIMITS.maxWater) problems.push(`${name}: ${fmt(water!, 1)} % de agua (máximo ${fmt(QUALITY_LIMITS.maxWater, 1)} %).`);
  if (sulfur! > QUALITY_LIMITS.maxSulfur) problems.push(`${name}: ${fmt(sulfur!, 2)} % de azufre (máximo ${fmt(QUALITY_LIMITS.maxSulfur, 1)} %).`);
  if (cal! > 15000 || [cl!, water!, sulfur!].some((value) => value < 0)) problems.push(`${name}: revisa los valores del análisis.`);
  return problems;
}

export const RFC_PATTERN = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Días entre dos fechas YYYY-MM-DD (b - a), sin pasar por zona horaria. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (value: string) => {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export type PermitState = { state: "vigente" | "por_vencer" | "vencido"; days: number };
export function permitState(validUntil: string, today: string): PermitState {
  const days = daysBetween(today, validUntil);
  if (days < 0) return { state: "vencido", days };
  if (days <= PERMIT_WARNING_DAYS) return { state: "por_vencer", days };
  return { state: "vigente", days };
}

/** Estatus técnico efectivo: un permiso vencido deja al proveedor como rechazado. */
export function supplierApproved(supplier: Pick<FuelSupplier, "status" | "permit_valid_until">, onDay: string): boolean {
  return supplier.status === "aprobado" && supplier.permit_valid_until >= onDay;
}

// ---------------------------------------------------------------------------
// Cloro por embarque y corrección cruzada (caso de referencia, sección 5)
// ---------------------------------------------------------------------------
export type ChlorineState = "sin_analisis" | "ok" | "en_plazo" | "corregido" | "penalizado";
export const CHLORINE_LABELS: Record<ChlorineState, string> = {
  sin_analisis: "Sin análisis",
  ok: "En especificación",
  en_plazo: "Fuera de especificación · en plazo de corrección",
  corregido: "Corregido (sin penalización)",
  penalizado: "Fuera de especificación · penalizado",
};

export function chlorineState(reception: FuelReception, all: FuelReception[], today: string): ChlorineState {
  if (reception.chlorine_pct === null) return "sin_analisis";
  if (reception.chlorine_pct <= QUALITY_LIMITS.maxChlorine) return "ok";
  if (all.some((row) => row.compensates_id === reception.id && row.status === "cerrado")) return "corregido";
  if (reception.received_on && daysBetween(reception.received_on, today) <= COMPENSATION_DAYS) return "en_plazo";
  return "penalizado";
}

/** Cloro promedio ponderado por peso de un embarque y su compensación. */
export function weightedChlorine(rows: Pick<FuelReception, "net_kg" | "chlorine_pct">[]): number | null {
  const valid = rows.filter((row) => row.chlorine_pct !== null && row.net_kg);
  const weight = valid.reduce((sum, row) => sum + row.net_kg!, 0);
  if (!weight) return null;
  return valid.reduce((sum, row) => sum + row.net_kg! * row.chlorine_pct!, 0) / weight;
}

/** Tickets que una carga del proveedor todavía puede compensar (y si ya usó su corrección del mes). */
export function compensationCandidates(supplierId: number, receptions: FuelReception[], today: string) {
  const month = monthOf(today);
  const used = receptions.some(
    (row) => row.supplier_id === supplierId && row.status === "cerrado" && row.compensates_id !== null && row.received_on && monthOf(row.received_on) === month,
  );
  const candidates = receptions.filter((row) => row.supplier_id === supplierId && chlorineState(row, receptions, today) === "en_plazo");
  return { used, candidates };
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("es-MX", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Hoy en la planta (hora del centro de México), como YYYY-MM-DD. */
export function plantToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
