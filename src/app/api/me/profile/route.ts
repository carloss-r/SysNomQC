import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clearAccessCache } from "@/lib/access-cache";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import type { MyProfile } from "@/lib/permissions";
import { createServiceClient } from "@/lib/supabase-admin";
import { usernameSchema } from "../../admin/_schemas";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";

const noStore = { "Cache-Control": "no-store" };

/** Lo único que una cuenta puede cambiar de sí misma. Rol, sede y estatus son del administrador. */
const profileSchema = z
  .object({
    full_name: z.string().trim().min(3).max(150),
    username: usernameSchema.nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9 +()-]{7,20}$/)
      .nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Debes enviar al menos un campo.")
  .strict();

type Row = { email: string; username?: string | null; full_name: string | null; phone?: string | null; must_change_password?: boolean | null };

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  try {
    // La cuenta puede leer su propia fila (RLS). Sin la migración 202611180001 se lee sin teléfono.
    const read = (columns: string) => auth.client.from("authorized_users").select(columns).eq("user_id", auth.access.user_id).maybeSingle();
    let result = await read("email,username,full_name,phone,must_change_password");
    if (result.error?.code === "42703") result = await read("email,username,full_name");
    if (result.error) throw result.error;
    const row = (result.data ?? { email: auth.access.email, full_name: auth.access.full_name }) as unknown as Row;
    const profile: MyProfile = {
      email: row.email ?? auth.access.email,
      username: row.username ?? null,
      full_name: row.full_name ?? null,
      phone: row.phone ?? null,
      role_names: auth.access.role_names,
      site: auth.access.site,
      must_change_password: row.must_change_password === true,
    };
    return NextResponse.json(profile, { headers: noStore });
  } catch (error) {
    reportServerIncident("api · mi cuenta", error);
    return NextResponse.json({ error: "No se pudieron cargar tus datos." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  try {
    const input = profileSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json(
        { error: "Revisa tus datos: nombre de 3 a 150 letras; usuario de 3 a 30 (letras, números, punto, guion); teléfono de 7 a 20 dígitos." },
        { status: 400 },
      );
    }
    const admin = createServiceClient();
    if (!admin) return NextResponse.json({ error: "El servidor no está configurado para guardar cambios de cuenta." }, { status: 500 });

    // Solo la fila de la propia cuenta y solo estos campos.
    const { error } = await admin.from("authorized_users").update(input.data).eq("user_id", auth.access.user_id);
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Ese nombre de usuario ya lo usa otra cuenta." }, { status: 409 });
      if (error.code === "23514") return NextResponse.json({ error: "El usuario o el teléfono no tienen un formato válido." }, { status: 400 });
      if (error.code === "42703" || error.code === "PGRST204") {
        return NextResponse.json({ error: "Falta ejecutar en Supabase la migración 202611180001_mi_cuenta.sql." }, { status: 503 });
      }
      throw error;
    }
    clearAccessCache();
    await recordAudit(request, auth.access, "account.update", auth.access.user_id, { fields: Object.keys(input.data) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · mi cuenta · guardar", error);
    return NextResponse.json({ error: "No se pudieron guardar tus datos." }, { status: 500 });
  }
}
