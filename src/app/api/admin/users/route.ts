import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import type { AdminUser } from "@/lib/permissions";
import { BadJsonError, readJson } from "../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../_admin";
import { userCreateSchema } from "../_schemas";
import { MIGRATION_MISSING, readUserRoleIds, saveUserRoles } from "../_user-roles";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  // Si la migración de "usuario" aún no se aplicó (columna inexistente), se lista sin ese campo.
  const columns = "user_id,email,full_name,active,site,created_at";
  const listUsers = (select: string) => auth.admin.from("authorized_users").select(select).order("email");
  const [first, roleList, userRoles] = await Promise.all([
    listUsers(`${columns},username`),
    auth.admin.from("roles").select("id_rol,nombre"),
    readUserRoleIds(auth.admin),
  ]);
  let result = first;
  if (result.error?.code === "42703") result = await listUsers(columns);
  const { data, error } = result;
  if (error) return adminDbError(error);
  if (roleList.error) return adminDbError(roleList.error);
  if (userRoles.error) return adminDbError(userRoles.error);

  const names = new Map((roleList.data ?? []).map((row) => [row.id_rol as number, row.nombre as string]));
  const users: AdminUser[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const roleIds = userRoles.map.get(row.user_id as string) ?? [];
    return {
      user_id: row.user_id as string,
      email: row.email as string,
      username: (row.username as string | null | undefined) ?? null,
      full_name: row.full_name as string | null,
      active: row.active as boolean,
      site: (row.site as string | null) ?? null,
      role_ids: roleIds,
      role_names: roleIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
      created_at: row.created_at as string | null,
    };
  });
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    const input = userCreateSchema.safeParse(await readJson(request));
    if (!input.success) {
      return badRequest("Revisa nombre, correo, roles y contraseña (mínimo 12 caracteres).");
    }
    const { email, username, full_name, password, role_ids, active, site } = input.data;

    const { data: created, error: createError } = await auth.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      if (createError?.status === 422 || /already|registered/i.test(createError?.message ?? "")) {
        return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
      }
      console.error("No se pudo crear la cuenta:", createError);
      reportServerIncident("api · admin crear cuenta", createError ?? new Error("sin usuario"));
      return NextResponse.json({ error: "No se pudo crear la cuenta." }, { status: 500 });
    }

    const { error } = await auth.admin
      .from("authorized_users")
      .insert({ user_id: created.user.id, email, full_name, role_id: role_ids[0], active, site: site ?? null, ...(username ? { username } : {}) });
    const rolesError = error ? null : await saveUserRoles(auth.admin, created.user.id, role_ids);
    if (error || rolesError) {
      // Sin transacciones: se elimina la cuenta para no dejarla a medias.
      await auth.admin.from("authorized_users").delete().eq("user_id", created.user.id);
      await auth.admin.auth.admin.deleteUser(created.user.id);
      if (rolesError && rolesError.code === MIGRATION_MISSING.code) return badRequest(rolesError.message);
      return adminDbError((error ?? rolesError) as { code?: string; message: string });
    }
    await recordAudit(request, auth.access, "user.create", created.user.id, { email, role_ids, site: site ?? null });
    return NextResponse.json({ user_id: created.user.id }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}
