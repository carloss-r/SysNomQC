export const PERMISSIONS = [
  { key: "employees.view", label: "Ver directorio y expedientes" },
  { key: "employees.create", label: "Registrar empleados" },
  { key: "employees.edit", label: "Editar expedientes" },
  { key: "employees.delete", label: "Eliminar expedientes" },
  { key: "employees.download", label: "Descargar expedientes" },
  { key: "epp.view", label: "Ver inventario y entregas de EPP" },
  { key: "epp.deliver", label: "Registrar entregas de EPP" },
  { key: "epp.manage", label: "Administrar catálogo e ingresos de EPP y contar lo que llega de compras" },
  { key: "epp.request", label: "Solicitar compra de EPP cuando falta material" },
  { key: "epp.purchase", label: "Registrar las compras de EPP y ver lo comprado (encargado de compras)" },
  { key: "fuels.view", label: "Ver combustibles alternos y semáforo SEMARNAT" },
  { key: "fuels.suppliers", label: "Homologar proveedores de combustibles alternos (M1)" },
  { key: "fuels.schedule", label: "Programar recepciones de combustibles alternos (M2)" },
  { key: "fuels.scale", label: "Operar báscula y manifiestos (M3)" },
  { key: "fuels.commercial", label: "Tarifas y reportes contables de combustibles (M4)" },
  { key: "fuels.ecology", label: "Capturar consumo de coque y reporte SEMARNAT (M5)" },
  { key: "invoices.view", label: "Ver facturas, su PDF y los resúmenes" },
  { key: "invoices.manage", label: "Cargar facturas, corregir sus datos y cambiar su estado o marcar incidentes" },
  { key: "users.manage", label: "Administrar usuarios y roles" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

/**
 * Áreas que puede ver un rol de solo consulta. Son los únicos permisos que admite
 * (la base lo vuelve a validar con roles_solo_consulta_check).
 */
export const READ_ONLY_AREAS: { key: Permission; label: string }[] = [
  { key: "employees.view", label: "Empleados: directorio y expedientes" },
  { key: "epp.view", label: "EPP: inventario, entregas, historial y solicitudes" },
];
export const READ_ONLY_PERMISSIONS: Permission[] = READ_ONLY_AREAS.map((area) => area.key);
export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((permission) => permission.key);

/** Acceso de la cuenta que inició sesión (lo devuelve /api/me). */
/** Largo mínimo de una contraseña (alta de usuario, restablecer y "Mi cuenta"). */
export const MIN_PASSWORD_LENGTH = 12;

export type Access = {
  user_id: string;
  email: string;
  full_name: string | null;
  /** Rol principal (nombre técnico; en pantalla usa roleLabel). */
  role_name: string;
  /** Todos los roles de la cuenta; los permisos son la suma de todos. */
  role_names: string[];
  is_super_admin: boolean;
  permissions: Permission[];
  /** Sede asignada. null = todas las sedes (también SuperAdmin). */
  site: string | null;
  /** Contraseña temporal puesta por el administrador: debe cambiarla antes de usar el sistema. */
  must_change_password?: boolean;
};

export type AdminRole = {
  id: number;
  name: string;
  description: string | null;
  permissions: Permission[];
  is_system: boolean;
  /** Solo visualiza: sus permisos se limitan a READ_ONLY_PERMISSIONS. */
  read_only: boolean;
  user_count: number;
};

export type AdminUser = {
  user_id: string;
  email: string;
  username?: string | null;
  full_name: string | null;
  active: boolean;
  /** El primero es el rol principal. */
  role_ids: number[];
  role_names: string[];
  site: string | null;
  created_at: string | null;
  /** Tiene una contraseña temporal pendiente de cambiar. */
  must_change_password?: boolean;
};

/** Datos que cada cuenta ve y edita en "Mi cuenta". */
export type MyProfile = {
  email: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  role_names: string[];
  site: string | null;
  must_change_password: boolean;
};

/** Nombre visible de un artículo con su talla: "CAMISOLA · M". Cada talla es un artículo propio. */
export function eppArticleLabel(name: string | null | undefined, size?: string | null) {
  const base = (name ?? "").trim() || "Artículo";
  const talla = (size ?? "").trim();
  return talla ? `${base} · ${talla}` : base;
}

/** Artículo del catálogo con la existencia y el mínimo de UNA sede. */
export type EppArticle = {
  id: number;
  name: string;
  category: string;
  size: string | null;
  unit: string;
  stock: number;
  min_stock: number;
  active: boolean;
  site: string;
  /** false si la sede nunca ha manejado el artículo (sin ingresos ni mínimo propio). */
  tracked: boolean;
  updated_at: string;
  updated_by_name: string | null;
  /** Folio de una compra registrada que aún no se cuenta: el artículo queda bloqueado en la sede. */
  pending_count: number | null;
};

export type PurchaseStatus = "pendiente" | "en_compra" | "recibida" | "cancelada";

export type EppPurchaseItem = {
  article_id: number;
  article_name: string;
  unit: string;
  /** Cantidad solicitada; null en una compra directa (no hubo solicitud). */
  quantity: number | null;
  stock_at_request: number;
  min_stock: number;
  /** Conteo de lo que llegó (null = aún sin contar). */
  received_qty: number | null;
  counted_at: string | null;
  counted_by_name: string | null;
  /** Cantidad comprada: solo llega a cuentas con epp.purchase (quien cuenta no la ve). */
  purchased_qty?: number | null;
};

export type EppPurchaseRequest = {
  id: number;
  site: string;
  status: PurchaseStatus;
  /** Compra directa: Compras la registró sin solicitud previa. */
  direct: boolean;
  notes: string | null;
  requested_by_name: string | null;
  created_at: string;
  updated_at: string;
  handled_by_name: string | null;
  status_note: string | null;
  purchased_at: string | null;
  purchased_by_name: string | null;
  shortage_ack_at: string | null;
  shortage_ack_by_name: string | null;
  items: EppPurchaseItem[];
};

export type EppMovement = {
  id: number;
  article_id: number;
  article_name: string;
  kind: "ingreso" | "entrega" | "ajuste";
  delta: number;
  stock_after: number | null;
  employee_id: string | null;
  employee_name: string | null;
  employee_code: string | null;
  employee_group: string | null;
  employee_position: string | null;
  site: string | null;
  moved_on: string;
  notes: string | null;
  created_at: string;
  created_by_name: string | null;
  historical: boolean;
  /** Nombre normalizado (epp_norm en la base): identifica al trabajador aunque no tenga employee_id. */
  employee_key: string | null;
};

/** Página del historial de movimientos. */
export type EppLedgerPage = { rows: EppMovement[]; total: number };

/** Trabajador con entregas, ya agrupado en la base (vista epp_people). */
export type EppPerson = {
  key: string;
  name: string;
  employeeId: string | null;
  group: string | null;
  position: string | null;
  pieces: number;
  deliveries: number;
  lastDate: string;
};

/** Totales de una sede en un mes (vista epp_month_summary). */
export type EppMonthSummary = { month: string; delivered: number; received: number; workers: number; movements: number };

/**
 * Mismo criterio que public.epp_norm() de la base (sin acentos, mayúsculas, espacios simples),
 * para buscar por employee_key. No recorta los extremos, igual que la función SQL.
 */
export function eppKey(value: string): string {
  const from = "áéíóúüñÁÉÍÓÚÜÑ";
  const to = "aeiouunAEIOUUN";
  let out = "";
  for (const char of value) {
    const index = from.indexOf(char);
    out += index >= 0 ? to[index] : char;
  }
  return out.toUpperCase().replace(/\s+/g, " ");
}

export type EppEmployee ={ id: string; employee_code: string; full_name: string; site: string; position: string };
