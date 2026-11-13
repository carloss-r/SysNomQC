// Alertas del sistema. No se guardan en la base de datos: se calculan en cada consulta a partir de
// los datos reales, así que una alerta desaparece sola cuando el problema se corrige.

export type NotificationSeverity = "critical" | "important" | "minor";
export type NotificationKind =
  | "purchase_request"
  | "purchase_shortage"
  | "purchase_count"
  | "out_of_stock"
  | "low_stock"
  | "reorder_soon"
  | "employee_data"
  | "employee_contact"
  | "fuel_semaphore"
  | "fuel_permit";

/** Lo emite la pantalla de EPP al registrar un movimiento, para revisar los avisos sin esperar. */
export const EPP_CHANGED_EVENT = "epp:changed";
/** Cualquier pantalla que cambie datos con avisos (EPP, combustibles…) lo emite para revisar la campana. */
export const DATA_CHANGED_EVENT = EPP_CHANGED_EVENT;

export type AppNotification = {
  /** Estable mientras dure el problema; incluye el tipo para que un agravamiento vuelva a avisar. */
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  detail: string;
  href?: string;
};

/** ok: revisado · no_permission: el rol no lo incluye · unavailable: no se pudo revisar. */
export type NotificationSourceStatus = "ok" | "no_permission" | "unavailable";

export type NotificationsResponse = {
  items: AppNotification[];
  sources: {
    employees: NotificationSourceStatus;
    inventory: NotificationSourceStatus;
    purchases: NotificationSourceStatus;
    fuels: NotificationSourceStatus;
  };
  checked_at: string;
};

export const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  critical: "Grave",
  important: "Importante",
  minor: "Menor importancia",
};

export const KIND_LABELS: Record<NotificationKind, string> = {
  purchase_request: "Solicitud de compra",
  purchase_shortage: "Llegó menos de lo comprado",
  purchase_count: "Conteo pendiente",
  out_of_stock: "Sin existencias",
  low_stock: "Stock bajo",
  reorder_soon: "Compra anticipada",
  employee_data: "Expediente incompleto",
  employee_contact: "Datos de contacto",
  fuel_semaphore: "Semáforo SEMARNAT",
  fuel_permit: "Permiso SEMARNAT",
};

const SEVERITY_ORDER: Record<NotificationSeverity, number> = { critical: 0, important: 1, minor: 2 };

// Las solicitudes de compra van primero: es el aviso especial del encargado de compras.
const kindRank = (item: AppNotification) => (item.kind === "purchase_request" || item.kind === "purchase_shortage" ? 0 : 1);

export function sortNotifications(items: AppNotification[]): AppNotification[] {
  return [...items].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.title.localeCompare(b.title, "es-MX"),
  );
}

export const eppHref = (site: string, tab?: string) =>
  `/epp?sede=${encodeURIComponent(site)}${tab ? `&tab=${tab}` : ""}`;

export type EppStockRow = {
  article_id: number;
  site: string;
  name: string;
  stock: number;
  min_stock: number;
  unit: string;
  /** Folio de una solicitud de compra abierta para este artículo en esta sede. */
  open_request: number | null;
};

// Por sede: el id incluye la sede, así un faltante en Lagunas no se confunde con uno en Campeche.
export function eppNotifications(rows: EppStockRow[]): AppNotification[] {
  return rows.flatMap((row): AppNotification[] => {
    const requested = row.open_request !== null;
    const href = eppHref(row.site);
    const suffix = requested ? ` Ya se pidió (folio ${row.open_request}).` : "";
    const detail = `${row.site} · Quedan ${row.stock} ${row.unit.toLowerCase()}; el mínimo es ${row.min_stock}.${suffix}`;

    if (row.stock <= 0) {
      return [{
        id: `out_of_stock:${row.site}:${row.article_id}${requested ? ":pedido" : ""}`,
        kind: "out_of_stock",
        // Si ya se pidió, el aviso baja de nivel: solo falta que llegue.
        severity: requested ? "minor" : "critical",
        title: `Ya no hay ${row.name}`,
        detail: `${row.site} · Existencia en cero; el mínimo es ${row.min_stock}.${suffix}`,
        href,
      }];
    }
    if (row.stock <= row.min_stock) {
      return [{
        id: `low_stock:${row.site}:${row.article_id}${requested ? ":pedido" : ""}`,
        kind: "low_stock",
        severity: requested ? "minor" : "important",
        title: `Quedan pocas existencias de ${row.name}`,
        detail,
        href,
      }];
    }
    if (!requested && row.stock <= Math.ceil(row.min_stock * 1.5)) {
      return [{ id: `reorder_soon:${row.site}:${row.article_id}`, kind: "reorder_soon", severity: "minor", title: `Anticipa la compra de ${row.name}`, detail, href }];
    }
    return [];
  });
}

export type PurchaseRequestRow = {
  id: number;
  site: string;
  created_at: string;
  requested_by_name: string | null;
  items: { quantity: number }[];
};

/** Solo para el encargado de compras: cada solicitud pendiente es un aviso hasta que la atienda. */
export function purchaseNotifications(rows: PurchaseRequestRow[]): AppNotification[] {
  return rows.map((row) => {
    const pieces = row.items.reduce((sum, item) => sum + item.quantity, 0);
    const day = row.created_at.slice(0, 10).split("-").reverse().join("/");
    return {
      id: `purchase_request:${row.id}`,
      kind: "purchase_request",
      severity: "important",
      title: `Solicitud de compra · ${row.site} (folio ${row.id})`,
      detail: `${row.items.length} artículo(s), ${pieces} pieza(s) · ${row.requested_by_name ?? "Sin nombre"} · ${day}`,
      href: eppHref(row.site, "solicitudes"),
    };
  });
}

export type PurchaseItemCheck = {
  article_name: string;
  unit: string;
  received_qty: number | null;
  /** Solo en consultas de Compras. */
  purchased_qty?: number | null;
};

/** Artículos que llegaron incompletos: se contó menos de lo que Compras registró como comprado. */
export function purchaseShortItems<T extends PurchaseItemCheck>(items: T[]): T[] {
  return items.filter(
    (item) => item.received_qty !== null && typeof item.purchased_qty === "number" && item.received_qty < item.purchased_qty,
  );
}

export type PurchaseCheckRow = {
  id: number;
  site: string;
  status: string;
  updated_at: string;
  shortage_ack_at: string | null;
  items: PurchaseItemCheck[];
};

/** Para Compras: cada compra con faltante es un aviso hasta que la marque como enterada. */
export function shortageNotifications(rows: PurchaseCheckRow[]): AppNotification[] {
  return rows.flatMap((row) => {
    if (row.shortage_ack_at) return [];
    const short = purchaseShortItems(row.items);
    if (short.length === 0) return [];
    const list = short
      .slice(0, 3)
      .map((item) => `${item.article_name}: llegaron ${item.received_qty} de ${item.purchased_qty}`)
      .join(" · ");
    return [{
      id: `purchase_shortage:${row.id}:${short.length}`,
      kind: "purchase_shortage" as const,
      severity: "important" as const,
      title: `Llegó menos de lo comprado · ${row.site} (folio ${row.id})`,
      detail: `${list}${short.length > 3 ? ` y ${short.length - 3} más` : ""}.`,
      href: eppHref(row.site, "solicitudes"),
    }];
  });
}

/** Para Seguridad: compras registradas con artículos sin contar (bloqueados hasta el conteo). */
export function countNotifications(rows: PurchaseCheckRow[]): AppNotification[] {
  return rows.flatMap((row) => {
    const left = row.items.filter((item) => item.received_qty === null);
    if (row.status !== "en_compra" || left.length === 0) return [];
    return [{
      id: `purchase_count:${row.id}`,
      kind: "purchase_count" as const,
      severity: "important" as const,
      title: `Cuenta lo que llegó · ${row.site} (folio ${row.id})`,
      detail: `${left.length} artículo(s) sin contar: ${left.slice(0, 3).map((item) => item.article_name).join(", ")}${left.length > 3 ? "…" : ""}. No se pueden entregar hasta contarlos.`,
      href: eppHref(row.site, "solicitudes"),
    }];
  });
}

export type EmployeeCheckRow = {
  id: string;
  employee_code: string;
  full_name: string;
  salary: number | null;
  bank_account: string | null;
  nss: string | null;
  curp: string | null;
  rfc: string | null;
  email: string | null;
  phone: string | null;
};

const missing = (entries: [string, boolean][]) => entries.filter(([, absent]) => absent).map(([label]) => label);

/** Solo informa qué campo falta; nunca devuelve al navegador el valor de NSS, CURP, RFC, etc. */
export function employeeNotifications(rows: EmployeeCheckRow[]): AppNotification[] {
  return rows.flatMap((row) => {
    const href = `/?buscar=${encodeURIComponent(row.employee_code)}`;
    const result: AppNotification[] = [];

    const payroll = missing([
      ["NSS", !row.nss],
      ["CURP", !row.curp],
      ["RFC", !row.rfc],
      ["cuenta bancaria", !row.bank_account],
      ["salario base", !row.salary || row.salary <= 0],
    ]);
    if (payroll.length > 0) {
      result.push({
        id: `employee_data:${row.id}`,
        kind: "employee_data",
        severity: "important",
        title: `Expediente incompleto: ${row.full_name}`,
        detail: `${row.employee_code} · Falta: ${payroll.join(", ")}.`,
        href,
      });
    }

    const contact = missing([
      ["correo", !row.email],
      ["teléfono", !row.phone],
    ]);
    if (contact.length > 0) {
      result.push({
        id: `employee_contact:${row.id}`,
        kind: "employee_contact",
        severity: "minor",
        title: `Sin datos de contacto: ${row.full_name}`,
        detail: `${row.employee_code} · Falta: ${contact.join(", ")}.`,
        href,
      });
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Combustibles alternos: semáforo SEMARNAT del mes y vigencia de permisos de proveedores
// ---------------------------------------------------------------------------
export type FuelSemaphoreRow = { month: string; pct: number | null; level: string; projected_pct: number | null; projected_level: string };
export type FuelPermitRow = { id: number; business_name: string; permit_valid_until: string; days: number };

const pctText = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} %`);

export function fuelNotifications(semaphore: FuelSemaphoreRow | null, permits: FuelPermitRow[]): AppNotification[] {
  const items: AppNotification[] = [];
  if (semaphore && (semaphore.level === "rojo" || semaphore.level === "amarillo")) {
    const red = semaphore.level === "rojo";
    items.push({
      id: `fuel_semaphore:${semaphore.month}:${semaphore.level}`,
      kind: "fuel_semaphore",
      severity: red ? "critical" : "important",
      title: red ? `Sustitución térmica en rojo: ${pctText(semaphore.pct)}` : `Sustitución térmica en amarillo: ${pctText(semaphore.pct)}`,
      detail: red
        ? `${semaphore.month} · Se alcanzó el límite SEMARNAT del 30 %. La agenda bloquea nuevas cargas del mes.`
        : `${semaphore.month} · Dosifica la logística semanal. Proyección con lo programado: ${pctText(semaphore.projected_pct)}.`,
      href: "/combustibles",
    });
  } else if (semaphore && semaphore.projected_level === "rojo") {
    items.push({
      id: `fuel_semaphore:${semaphore.month}:proyeccion`,
      kind: "fuel_semaphore",
      severity: "important",
      title: `La agenda proyecta rebasar el 30 %: ${pctText(semaphore.projected_pct)}`,
      detail: `${semaphore.month} · Hoy va en ${pctText(semaphore.pct)}; revisa las recepciones programadas.`,
      href: "/combustibles",
    });
  }
  for (const row of permits) {
    const expired = row.days < 0;
    const day = row.permit_valid_until.split("-").reverse().join("/");
    items.push({
      id: `fuel_permit:${row.id}:${row.permit_valid_until}:${expired ? "vencido" : "por_vencer"}`,
      kind: "fuel_permit",
      severity: expired ? "critical" : "important",
      title: expired ? `Permiso SEMARNAT vencido: ${row.business_name}` : `Permiso SEMARNAT por vencer: ${row.business_name}`,
      detail: expired
        ? `Venció el ${day}. No se le puede programar ni recibir material hasta renovarlo.`
        : `Vence el ${day} (en ${row.days} día${row.days === 1 ? "" : "s"}). Solicita la renovación.`,
      href: "/combustibles",
    });
  }
  return items;
}
