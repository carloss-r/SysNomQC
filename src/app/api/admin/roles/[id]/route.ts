import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BadJsonError, readJson } from "../../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../../_admin";
import { roleSchema } from "../../_schemas";

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.coerce.number().int().positive();

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return badRequest("El identificador del rol no es válido.");

  try {
    const input = roleSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest("Revisa el nombre y los permisos del rol.");

    const { data: role, error: readError } = await auth.admin
      .from("roles")
      .select("id_rol,es_sistema")
      .eq("id_rol", id.data)
      .maybeSingle();
    if (readError) return adminDbError(readError);
    if (!role) return NextResponse.json({ error: "No se encontró el rol." }, { status: 404 });
    if (role.es_sistema) return badRequest("El rol SuperAdmin no se puede modificar.");

    const { error } = await auth.admin
      .from("roles")
      .update({
        nombre: input.data.name,
        descripcion: input.data.description,
        permisos: input.data.permissions,
      })
      .eq("id_rol", id.data);
    if (error) return adminDbError(error);
    return NextResponse.json({ id: id.data });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return badRequest("El identificador del rol no es válido.");

  const { data: role, error: readError } = await auth.admin
    .from("roles")
    .select("id_rol,es_sistema")
    .eq("id_rol", id.data)
    .maybeSingle();
  if (readError) return adminDbError(readError);
  if (!role) return NextResponse.json({ error: "No se encontró el rol." }, { status: 404 });
  if (role.es_sistema) return badRequest("El rol SuperAdmin no se puede eliminar.");

  const { count, error: countError } = await auth.admin
    .from("authorized_users")
    .select("user_id", { count: "exact", head: true })
    .eq("role_id", id.data);
  if (countError) return adminDbError(countError);
  if ((count ?? 0) > 0) return badRequest("Reasigna primero a los usuarios que tienen este rol.");

  const { error } = await auth.admin.from("roles").delete().eq("id_rol", id.data);
  if (error) return adminDbError(error);
  return new NextResponse(null, { status: 204 });
}
