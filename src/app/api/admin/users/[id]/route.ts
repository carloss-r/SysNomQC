import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BadJsonError, readJson } from "../../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../../_admin";
import { usernameSchema } from "../../_schemas";

type RouteContext = { params: Promise<{ id: string }> };

const userPatchSchema = z
  .object({
    full_name: z.string().trim().min(1).max(150),
    username: usernameSchema.nullable(),
    role_id: z.number().int().positive(),
    active: z.boolean(),
    password: z.string().min(8).max(72),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Debes enviar al menos un campo.")
  .strict();

async function superAdminRoleIds(admin: SupabaseClient): Promise<number[]> {
  const { data } = await admin.from("roles").select("id_rol").eq("es_sistema", true);
  return (data ?? []).map((row) => row.id_rol as number);
}

async function otherActiveSuperAdmins(admin: SupabaseClient, roleIds: number[], excludeUserId: string) {
  const { count } = await admin
    .from("authorized_users")
    .select("user_id", { count: "exact", head: true })
    .in("role_id", roleIds)
    .eq("active", true)
    .neq("user_id", excludeUserId);
  return count ?? 0;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) return badRequest("El identificador del usuario no es válido.");

  try {
    const input = userPatchSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest("Revisa los campos enviados (contraseña mínimo 8 caracteres).");
    const { password, ...fields } = input.data;

    const { data: target, error: readError } = await auth.admin
      .from("authorized_users")
      .select("user_id,role_id,active")
      .eq("user_id", id)
      .maybeSingle();
    if (readError) return adminDbError(readError);
    if (!target) return NextResponse.json({ error: "No se encontró el usuario." }, { status: 404 });

    if (id === auth.access.user_id && fields.active === false) {
      return badRequest("No puedes desactivar tu propia cuenta.");
    }

    const superIds = await superAdminRoleIds(auth.admin);
    const wasSuper = superIds.includes(target.role_id as number) && target.active;
    const nextRole = (fields.role_id ?? target.role_id) as number;
    const nextActive = fields.active ?? target.active;
    if (wasSuper && (!superIds.includes(nextRole) || !nextActive)) {
      if ((await otherActiveSuperAdmins(auth.admin, superIds, id)) === 0) {
        return badRequest("Debe quedar al menos un super administrador activo.");
      }
    }

    if (Object.keys(fields).length > 0) {
      const { error } = await auth.admin.from("authorized_users").update(fields).eq("user_id", id);
      if (error) return adminDbError(error);
    }
    if (password) {
      const { error } = await auth.admin.auth.admin.updateUserById(id, { password });
      if (error) return adminDbError({ message: error.message });
    }
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
    .select("role_id,active")
    .eq("user_id", id)
    .maybeSingle();
  if (readError) return adminDbError(readError);
  if (!target) return NextResponse.json({ error: "No se encontró el usuario." }, { status: 404 });

  const superIds = await superAdminRoleIds(auth.admin);
  if (superIds.includes(target.role_id as number) && target.active) {
    if ((await otherActiveSuperAdmins(auth.admin, superIds, id)) === 0) {
      return badRequest("Debe quedar al menos un super administrador activo.");
    }
  }

  const { error } = await auth.admin.from("authorized_users").delete().eq("user_id", id);
  if (error) return adminDbError(error);
  const { error: authError } = await auth.admin.auth.admin.deleteUser(id);
  if (authError) return adminDbError({ message: authError.message });
  return new NextResponse(null, { status: 204 });
}
