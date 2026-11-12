import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import type { AdminRole, Permission } from "@/lib/permissions";
import { BadJsonError, readJson } from "../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../_admin";
import { roleSchema } from "../_schemas";
import { readUserRoleIds } from "../_user-roles";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const [roles, users] = await Promise.all([
    auth.admin.from("roles").select("id_rol,nombre,descripcion,permisos,es_sistema").order("nombre"),
    readUserRoleIds(auth.admin),
  ]);
  if (roles.error) return adminDbError(roles.error);
  if (users.error) return adminDbError(users.error);

  // Una cuenta con varios roles cuenta en cada uno.
  const counts = new Map<number, number>();
  for (const roleIds of users.map.values()) {
    for (const roleId of roleIds) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
  }

  const result: AdminRole[] = (roles.data ?? []).map((role) => ({
    id: role.id_rol as number,
    name: role.nombre as string,
    description: (role.descripcion as string | null) ?? null,
    permissions: ((role.permisos as string[] | null) ?? []) as Permission[],
    is_system: Boolean(role.es_sistema),
    user_count: counts.get(role.id_rol as number) ?? 0,
  }));
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    const input = roleSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest("Revisa el nombre y los permisos del rol.");

    const { data, error } = await auth.admin
      .from("roles")
      .insert({
        nombre: input.data.name,
        descripcion: input.data.description,
        permisos: input.data.permissions,
      })
      .select("id_rol")
      .single();
    if (error) return adminDbError(error);
    await recordAudit(request, auth.access, "role.create", data.id_rol, { name: input.data.name, permissions: input.data.permissions });
    return NextResponse.json({ id: data.id_rol }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}
