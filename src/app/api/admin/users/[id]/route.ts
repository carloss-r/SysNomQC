import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { BadJsonError, readJson } from "../../../employees/_server";
import { roleIdsSchema, userSiteSchema, usernameSchema } from "../../_schemas";
import { adminDbError, badRequest, requireAdmin } from "../../_admin";
import { MIGRATION_MISSING, otherActiveSuperAdmins, readUserRoleIds, saveUserRoles, superAdminRoleIds } from "../../_user-roles";

type RouteContext = { params: Promise<{ id: string }> };

const userPatchSchema = z
  .object({
    full_name: z.string().trim().min(1).max(150),
    username: usernameSchema.nullable(),
    role_ids: roleIdsSchema,
    active: z.boolean(),
    password: z.string().min(12).max(72),
    site: userSiteSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Debes enviar al menos un campo.")
  .strict();

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) return badRequest("El identificador del usuario no es válido.");

  try {
    const input = userPatchSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest("Revisa los campos enviados (al menos un rol; contraseña mínimo 12 caracteres).");
    const { password, role_ids, ...fields } = input.data;

    const { data: target, error: readError } = await auth.admin
      .from("authorized_users")
      .select("user_id,active")
      .eq("user_id", id)
      .maybeSingle();
    if (readError) return adminDbError(readError);
    if (!target) return NextResponse.json({ error: "No se encontró el usuario." }, { status: 404 });

    if (id === auth.access.user_id && fields.active === false) {
      return badRequest("No puedes desactivar tu propia cuenta.");
    }

    // Nunca debe quedarse el sistema sin un super administrador activo.
    const superIds = await superAdminRoleIds(auth.admin);
    const current = await readUserRoleIds(auth.admin, [id]);
    if (current.error) return adminDbError(current.error);
    const currentRoles = current.map.get(id) ?? [];
    const wasSuper = currentRoles.some((roleId) => superIds.includes(roleId)) && target.active;
    const nextRoles = role_ids ?? currentRoles;
    const nextActive = fields.active ?? target.active;
    if (wasSuper && (!nextRoles.some((roleId) => superIds.includes(roleId)) || !nextActive)) {
      if ((await otherActiveSuperAdmins(auth.admin, superIds, id)) === 0) {
        return badRequest("Debe quedar al menos un super administrador activo.");
      }
    }

    if (Object.keys(fields).length > 0) {
      const { error } = await auth.admin.from("authorized_users").update(fields).eq("user_id", id);
      if (error) return adminDbError(error);
    }
    if (role_ids) {
      const error = await saveUserRoles(auth.admin, id, role_ids);
      if (error && error.code === MIGRATION_MISSING.code) return badRequest(error.message);
      if (error) return adminDbError(error);
    }
    if (password) {
      const { error } = await auth.admin.auth.admin.updateUserById(id, { password });
      if (error) return adminDbError({ message: error.message });
    }
    await recordAudit(request, auth.access, "user.update", id, {
      fields: [...Object.keys(fields), ...(role_ids ? ["role_ids"] : [])],
      password_changed: Boolean(password),
    });
    return NextResponse.json({ user_id: id });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) return badRequest("El identificador del usuario no es válido.");
  if (id === auth.access.user_id) return badRequest("No puedes eliminar tu propia cuenta.");

  const { data: target, error: readError } = await auth.admin
    .from("authorized_users")
    .select("active")
    .eq("user_id", id)
    .maybeSingle();
  if (readError) return adminDbError(readError);
  if (!target) return NextResponse.json({ error: "No se encontró el usuario." }, { status: 404 });

  const superIds = await superAdminRoleIds(auth.admin);
  const current = await readUserRoleIds(auth.admin, [id]);
  if (current.error) return adminDbError(current.error);
  if ((current.map.get(id) ?? []).some((roleId) => superIds.includes(roleId)) && target.active) {
    if ((await otherActiveSuperAdmins(auth.admin, superIds, id)) === 0) {
      return badRequest("Debe quedar al menos un super administrador activo.");
    }
  }

  const { error } = await auth.admin.from("authorized_users").delete().eq("user_id", id);
  if (error) return adminDbError(error);
  const { error: authError } = await auth.admin.auth.admin.deleteUser(id);
  if (authError) return adminDbError({ message: authError.message });
  await recordAudit(request, auth.access, "user.delete", id);
  return new NextResponse(null, { status: 204 });
}
