// Alertas del sistema. No se guardan en la base de datos: se calculan en cada consulta a partir de
// los datos reales, así que una alerta desaparece sola cuando el problema se corrige.

export type NotificationSeverity = "critical" | "important" | "minor";
export type NotificationKind = "out_of_stock" | "low_stock" | "employee_data" | "employee_contact";

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
  sources: { employees: NotificationSourceStatus; inventory: NotificationSourceStatus };
  checked_at: string;
};

export const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  critical: "Grave",
  important: "Importante",
  minor: "Menor importancia",
};

export const KIND_LABELS: Record<NotificationKind, string> = {
  out_of_stock: "Sin existencias",
  low_stock: "Stock bajo",
  employee_data: "Expediente incompleto",
  employee_contact: "Datos de contacto",
};

const SEVERITY_ORDER: Record<NotificationSeverity, number> = { critical: 0, important: 1, minor: 2 };

export function sortNotifications(items: AppNotification[]): AppNotification[] {
  return [...items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title, "es-MX"),
  );
}

export type InventoryRow = {
  id_articulo: number;
  codigo_sku: string | null;
  nombre_articulo: string;
  talla_medida: string | null;
  existencia_total: number;
  stock_minimo: number | null;
  unidad_medida: string | null;
};

export function inventoryNotifications(rows: InventoryRow[]): AppNotification[] {
  return rows.flatMap((row): AppNotification[] => {
    const name = [row.nombre_articulo, row.talla_medida].filter(Boolean).join(" · ");
    const sku = row.codigo_sku ? ` (SKU ${row.codigo_sku})` : "";
    const unit = (row.unidad_medida ?? "piezas").toLowerCase();

    if (row.existencia_total <= 0) {
      return [{
        id: `out_of_stock:${row.id_articulo}`,
        kind: "out_of_stock",
        severity: "critical",
        title: `Ya no hay ${name}`,
        detail: `Existencia en cero${sku}.`,
      }];
    }
    if (row.stock_minimo !== null && row.existencia_total <= row.stock_minimo) {
      return [{
        id: `low_stock:${row.id_articulo}`,
        kind: "low_stock",
        severity: "important",
        title: `Quedan pocas existencias de ${name}`,
        detail: `Quedan ${row.existencia_total} ${unit}; el mínimo es ${row.stock_minimo}${sku}.`,
      }];
    }
    return [];
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
      ["salario", !row.salary || row.salary <= 0],
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
