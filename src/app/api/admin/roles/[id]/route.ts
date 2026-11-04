import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BadJsonError, readJson } from "../../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../../_admin";
import { roleSchema } from "../../_schemas";

type RouteContext = { params: Promise<{ id: string }> };

async function loadRole(auth: { admin: import("@supabase/supabase-js").SupabaseClient }, id: string) {
  return auth.admin.from("app_roles").select("id,is_system").eq("id", id).maybeSingle();
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) return badRequest("El identificador del rol no es válido.");

  try {
    const input = roleSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest("Revisa el nombre y los permisos del rol.");

    const { data: role, error: readError } = await loadRole(auth, id);
    if (readError) return adminDbError(readError);
    if (!role) return NextResponse.json({ error: "No se encontró el rol." }, { status: 404 });
    if (role.is_system) return badRequest("El rol de super administrador no se puede modificar.");

    const { error } = await auth.admin
      .from("app_roles")
      .update({ ...input.data, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return adminDbError(error);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) return badRequest("El identificador del rol no es válido.");

  const { data: role, error: readError } = await loadRole(auth, id);
  if (readError) return adminDbError(readError);
  if (!role) return NextResponse.json({ error: "No se encontró el rol." }, { status: 404 });
  if (role.is_system) return badRequest("El rol de super administrador no se puede eliminar.");

  const { count, error: countError } = await auth.admin
    .from("authorized_users")
    .select("user_id", { count: "exact", head: true })
    .eq("role_id", id);
  if (countError) return adminDbError(countError);
  if ((count ?? 0) > 0) return badRequest("Reasigna primero a los usuarios que tienen este rol.");

  const { error } = await auth.admin.from("app_roles").delete().eq("id", id);
  if (error) return adminDbError(error);
  return new NextResponse(null, { status: 204 });
}
