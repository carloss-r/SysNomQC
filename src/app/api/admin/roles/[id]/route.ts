import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { z } from "zod";
import { BadJsonError, readJson } from "../../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../../_admin";
import { roleSchema } from "../../_schemas";
import { readUserRoleIds } from "../../_user-roles";

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.coerce.number().int().positive();

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return badRequest("El identificador del rol no es válido.");

  try {
    const input = roleSchema.safeParse(await readJson(request));
    if (!input.success) return badRequest(input.error.issues.find((issue) => issue.code === "custom")?.message ?? "Revisa el nombre y los permisos del rol.");

    const { data: role, error: readError } = await auth.admin
      .from("roles")
      .select("id_rol,es_sistema")
      .eq("id_rol", id.data)
      .maybeSingle();
    if (readError) return adminDbError(readError);
    if (!role) return NextResponse.json({ error: "No se encontró el rol." }, { status: 404 });
    if (role.es_sistema) return badRequest("El rol Super administrador no se puede modificar.");

    const { error } = await auth.admin
      .from("roles")
      .update({
        nombre: input.data.name,
        descripcion: input.data.description,
        permisos: input.data.permissions,
        solo_consulta: input.data.read_only,
      })
      .eq("id_rol", id.data);
    if (error) return adminDbError(error);
    await recordAudit(request, auth.access, "role.update", id.data, { name: input.data.name, permissions: input.data.permissions, read_only: input.data.read_only });
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
  if (role.es_sistema) return badRequest("El rol Super administrador no se puede eliminar.");

  const { error: countError, map } = await readUserRoleIds(auth.admin);
  if (countError) return adminDbError(countError);
  const inUse = Array.from(map.values()).filter((roleIds) => roleIds.includes(id.data)).length;
  if (inUse > 0) return badRequest(`Quita primero este rol a las ${inUse} cuenta(s) que lo tienen.`);

  const { error } = await auth.admin.from("roles").delete().eq("id_rol", id.data);
  if (error) return adminDbError(error);
  await recordAudit(request, auth.access, "role.delete", id.data);
  return new NextResponse(null, { status: 204 });
}
