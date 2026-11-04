import { NextResponse, type NextRequest } from "next/server";
import type { AdminRole } from "@/lib/permissions";
import { BadJsonError, readJson } from "../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../_admin";
import { roleSchema } from "../_schemas";


export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const [roles, users] = await Promise.all([
    auth.admin.from("app_roles").select("id,slug,name,description,permissions,is_system").order("name"),
    auth.admin.from("authorized_users").select("role_id"),
  ]);
  if (roles.error) return adminDbError(roles.error);
  if (users.error) return adminDbError(users.error);

  const counts = new Map<string, number>();
  for (const row of users.data ?? []) {
    if (row.role_id) counts.set(row.role_id as string, (counts.get(row.role_id as string) ?? 0) + 1);
  }

  const result: AdminRole[] = (roles.data ?? []).map((role) => ({
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    permissions: role.permissions ?? [],
    is_system: role.is_system,
    user_count: counts.get(role.id) ?? 0,
  }));
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    const input = roleSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest("Revisa el nombre y los permisos del rol.");

    const { data, error } = await auth.admin.from("app_roles").insert(input.data).select("id").single();
    if (error) return adminDbError(error);
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}
