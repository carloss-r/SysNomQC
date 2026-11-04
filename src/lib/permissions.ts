export const PERMISSIONS = [
  { key: "employees.view", label: "Ver directorio y expedientes" },
  { key: "employees.create", label: "Registrar empleados" },
  { key: "employees.edit", label: "Editar expedientes" },
  { key: "employees.delete", label: "Eliminar expedientes" },
  { key: "employees.download", label: "Descargar expedientes" },
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
};

export type AdminRole = {
  id: string;
  slug: string | null;
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
  role_id: string | null;
  role_name: string | null;
  created_at: string | null;
};
