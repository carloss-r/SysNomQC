import type { SupabaseClient } from "@supabase/supabase-js";

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
type DbError = { code?: string; message: string };

/** Error que se le muestra tal cual a quien administra (no es una falla del sistema). */
export const MIGRATION_MISSING: DbError = {
  code: "SYSNOM_MIGRATION",
  message: "Para dar varios roles a una cuenta, ejecuta en Supabase la migración 202611080001_varios_roles.sql.",
};

/** Roles de cada cuenta: el principal (authorized_users.role_id) más los de authorized_user_roles. */
export async function readUserRoleIds(admin: SupabaseClient, userIds?: string[]) {
  let base = admin.from("authorized_users").select("user_id,role_id");
  if (userIds) base = base.in("user_id", userIds);
  let extra = admin.from("authorized_user_roles").select("user_id,role_id");
  if (userIds) extra = extra.in("user_id", userIds);
  const [primary, others] = await Promise.all([base, extra]);
  if (primary.error) return { error: primary.error as DbError, map: new Map<string, number[]>() };
  if (others.error && !MISSING_TABLE.has(others.error.code ?? "")) return { error: others.error as DbError, map: new Map<string, number[]>() };

  const map = new Map<string, number[]>();
  const add = (userId: string, roleId: number | null) => {
    if (!userId || !roleId) return;
    const list = map.get(userId) ?? [];
    if (!list.includes(roleId)) list.push(roleId);
    map.set(userId, list);
  };
  for (const row of primary.data ?? []) add(row.user_id as string, row.role_id as number | null);
  for (const row of others.data ?? []) add(row.user_id as string, row.role_id as number);
  return { error: null, map };
}

/** Reemplaza los roles de una cuenta. El primero queda como rol principal. */
export async function saveUserRoles(admin: SupabaseClient, userId: string, roleIds: number[]): Promise<DbError | null> {
  const { error: primaryError } = await admin.from("authorized_users").update({ role_id: roleIds[0] }).eq("user_id", userId);
  if (primaryError) return primaryError;

  const { error: deleteError } = await admin.from("authorized_user_roles").delete().eq("user_id", userId);
  if (deleteError) {
    if (MISSING_TABLE.has(deleteError.code ?? "")) {
      return roleIds.length > 1 ? MIGRATION_MISSING : null;
    }
    return deleteError;
  }
  const { error } = await admin.from("authorized_user_roles").insert(roleIds.map((roleId) => ({ user_id: userId, role_id: roleId })));
  return error;
}

export async function superAdminRoleIds(admin: SupabaseClient): Promise<number[]> {
  const { data } = await admin.from("roles").select("id_rol").eq("es_sistema", true);
  return (data ?? []).map((row) => row.id_rol as number);
}

/** Cuántas otras cuentas activas tienen algún rol de sistema (para no quedarse sin SuperAdmin). */
export async function otherActiveSuperAdmins(admin: SupabaseClient, superIds: number[], excludeUserId: string) {
  const { data: active } = await admin.from("authorized_users").select("user_id").eq("active", true).neq("user_id", excludeUserId);
  const ids = (active ?? []).map((row) => row.user_id as string);
  if (ids.length === 0) return 0;
  const { map } = await readUserRoleIds(admin, ids);
  return ids.filter((id) => (map.get(id) ?? []).some((roleId) => superIds.includes(roleId))).length;
}
