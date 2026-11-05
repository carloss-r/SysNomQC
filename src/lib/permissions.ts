export const PERMISSIONS = [
  { key: "employees.view", label: "Ver directorio y expedientes" },
  { key: "employees.create", label: "Registrar empleados" },
  { key: "employees.edit", label: "Editar expedientes" },
  { key: "employees.delete", label: "Eliminar expedientes" },
  { key: "employees.download", label: "Descargar expedientes" },
  { key: "epp.view", label: "Ver inventario y entregas de EPP" },
  { key: "epp.deliver", label: "Registrar entregas de EPP" },
  { key: "epp.manage", label: "Administrar catálogo, ingresos y ajustes de EPP" },
  { key: "epp.request", label: "Solicitar compra de EPP cuando falta material" },
  { key: "epp.purchase", label: "Atender solicitudes de compra de EPP (encargado de compras)" },
  { key: "users.manage", label: "Administrar usuarios y roles" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];
export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((permission) => permission.key);

/** Acceso de la cuenta que inició sesión (lo devuelve /api/me). */
export type Access = {
  user_id: string;
  email: string;
  full_name: string | null;
  role_name: string;
  is_super_admin: boolean;
  permissions: Permission[];
  /** Sede asignada. null = todas las sedes (también SuperAdmin). */
  site: string | null;
};

export type AdminRole = {
  id: number;
  name: string;
  description: string | null;
  permissions: Permission[];
  is_system: boolean;
  user_count: number;
};

export type AdminUser = {
  user_id: string;
  email: string;
  full_name: string | null;
  active: boolean;
  role_id: number | null;
  role_name: string | null;
  site: string | null;
  created_at: string | null;
};

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
};

export type PurchaseStatus = "pendiente" | "en_compra" | "recibida" | "cancelada";

export type EppPurchaseItem = {
  article_id: number;
  article_name: string;
  unit: string;
  quantity: number;
  stock_at_request: number;
  min_stock: number;
};

export type EppPurchaseRequest = {
  id: number;
  site: string;
  status: PurchaseStatus;
  notes: string | null;
  requested_by_name: string | null;
  created_at: string;
  updated_at: string;
  handled_by_name: string | null;
  status_note: string | null;
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
};

export type EppEmployee = { id: string; employee_code: string; full_name: string; site: string; position: string };
