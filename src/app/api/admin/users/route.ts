import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import type { AdminUser } from "@/lib/permissions";
import { BadJsonError, readJson } from "../../employees/_server";
import { adminDbError, badRequest, requireAdmin } from "../_admin";
import { userCreateSchema } from "../_schemas";


export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  // Si la migración de "usuario" aún no se aplicó (columna inexistente), se lista sin ese campo.
  const columns = "user_id,email,full_name,active,role_id,created_at,role:roles(nombre)";
  const listUsers = (select: string) => auth.admin.from("authorized_users").select(select).order("email");
  let result = await listUsers(`${columns},username`);
  if (result.error?.code === "42703") {
    result = await listUsers(columns);
  }
  const { data, error } = result;
  if (error) return adminDbError(error);

  const users: AdminUser[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    user_id: row.user_id as string,
    email: row.email as string,
    username: (row.username as string | null | undefined) ?? null,
    full_name: row.full_name as string | null,
    active: row.active as boolean,
    role_id: row.role_id as number | null,
    role_name: (row.role as { nombre: string } | null)?.nombre ?? null,
    created_at: row.created_at as string | null,
  }));
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    const input = userCreateSchema.safeParse(await readJson(request));
    if (!input.success) {
      return badRequest("Revisa nombre, correo, rol y contraseña (mínimo 8 caracteres).");
    }
    const { email, username, full_name, password, role_id, active } = input.data;

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
      .insert({ user_id: created.user.id, email, full_name, role_id, active, ...(username ? { username } : {}) });
    if (error) {
      // Sin transacciones: se elimina la cuenta de Auth para no dejarla sin rol.
      await auth.admin.auth.admin.deleteUser(created.user.id);
      return adminDbError(error);
    }
    return NextResponse.json({ user_id: created.user.id }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return badRequest(error.message);
    return adminDbError({ message: String(error) });
  }
}
