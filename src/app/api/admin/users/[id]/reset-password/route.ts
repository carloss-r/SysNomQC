import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clearAccessCache } from "@/lib/access-cache";
import { recordAudit } from "@/lib/audit";
import { adminDbError, badRequest, requireAdmin } from "../../../_admin";

type RouteContext = { params: Promise<{ id: string }> };

// Sin letras ni números que se confundan al dictarla o copiarla (0/O, 1/l/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Contraseña temporal de 14 caracteres en tres bloques: "Xk7m-Pq2r-Ws9t". */
function temporaryPassword() {
  const block = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

/**
 * El administrador restablece la contraseña de otra cuenta (p. ej. si la olvidó). Se genera una temporal
 * que solo se muestra una vez; al entrar con ella, la cuenta debe ponerse una propia.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const id = (await context.params).id;
  if (!z.uuid().safeParse(id).success) return badRequest("El identificador del usuario no es válido.");
  if (id === auth.access.user_id) return badRequest("Para cambiar tu propia contraseña usa \"Mi cuenta\".");

  const { data: target, error: readError } = await auth.admin
    .from("authorized_users")
    .select("user_id,email")
    .eq("user_id", id)
    .maybeSingle();
  if (readError) return adminDbError(readError);
  if (!target) return NextResponse.json({ error: "No se encontró el usuario." }, { status: 404 });

  const password = temporaryPassword();
  const { error } = await auth.admin.auth.admin.updateUserById(id, { password });
  if (error) return adminDbError({ message: error.message });

  // Obliga a cambiarla al entrar (si la migración 202611180001 aún no se corre, solo queda la temporal).
  const flag = await auth.admin.from("authorized_users").update({ must_change_password: true }).eq("user_id", id);
  const forced = !flag.error;
  if (flag.error && flag.error.code !== "42703" && flag.error.code !== "PGRST204") return adminDbError(flag.error);

  clearAccessCache();
  // La contraseña nunca va a la bitácora.
  await recordAudit(request, auth.access, "user.password_reset", id, { forced });
  return NextResponse.json({ password, forced }, { headers: { "Cache-Control": "no-store" } });
}
