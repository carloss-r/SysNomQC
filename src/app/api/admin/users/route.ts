import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import type { AdminUser } from "@/lib/permissions";
import { BadJsonError, readJson } from "../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../_admin";
import { userCreateSchema } from "../_schemas";


export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const { data, error } = await auth.admin
    .from("authorized_users")
    .select("user_id,email,full_name,active,role_id,created_at,role:roles(nombre)")
    .order("email");
  if (error) return adminDbError(error);

  const users: AdminUser[] = (data ?? []).map((row) => ({
    user_id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    active: row.active,
    role_id: row.role_id,
    role_name: (row.role as unknown as { nombre: string } | null)?.nombre ?? null,
    created_at: row.created_at,
  }));
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    const input = userCreateSchema.safeParse(await readJson(request));
    if (!input.success) {
      return badRequest("Revisa nombre, correo, rol y contraseña (mínimo 12 caracteres).");
    }
    const { email, full_name, password, role_id, active } = input.data;

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
      .insert({ user_id: created.user.id, email, full_name, role_id, active });
    if (error) {
      // Sin transacciones: se elimina la cuenta de Auth para no dejarla sin rol.
      await auth.admin.auth.admin.deleteUser(created.user.id);
      return adminDbError(error);
    }
    await recordAudit(request, auth.access, "user.create", created.user.id, { email, role_id });
    return NextResponse.json({ user_id: created.user.id }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}
