import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, readJson } from "../../employees/_server";

const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(150),
    password: z.string().min(1).max(72),
  })
  .strict();

const INVALID = "Usuario o contraseña incorrectos.";
const noStore = { "Cache-Control": "no-store" };

function invalidCredentials() {
  return NextResponse.json({ error: INVALID }, { status: 401, headers: noStore });
}

function tooManyAttempts(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return NextResponse.json(
    { error: `Demasiados intentos fallidos. Espera ${minutes} minuto${minutes === 1 ? "" : "s"} e inténtalo de nuevo.` },
    { status: 429, headers: { ...noStore, "Retry-After": String(Math.max(1, seconds)) } },
  );
}

/** Lo escrito en "usuario o correo", en minúsculas y como SHA-256 (no se guarda en claro). */
const identifierHash = (identifier: string) => createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");

/**
 * Bloqueo de intentos (migración 202611250003): 5 fallos con el mismo usuario o 30 desde la misma IP en
 * 15 minutos bloquean por 15 minutos. Se guarda en la base, así vale para todas las instancias del servidor.
 */
async function waitSeconds(admin: SupabaseClient, hash: string, ip: string): Promise<number> {
  const { data, error } = await admin.rpc("auth_login_wait", { p_identifier_hash: hash, p_ip: ip });
  if (error) {
    // Sin la migración no hay bloqueo persistente: se sigue con el límite en memoria.
    if (!["42883", "PGRST202"].includes(error.code ?? "")) reportServerIncident("api · login bloqueo", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

async function recordAttempt(admin: SupabaseClient, hash: string, ip: string, success: boolean) {
  const { error } = await admin.rpc("auth_login_record", { p_identifier_hash: hash, p_ip: ip, p_success: success });
  if (error && !["42883", "PGRST202"].includes(error.code ?? "")) reportServerIncident("api · login registro", error);
}

/**
 * Inicio de sesión con "usuario o correo". El usuario se convierte en correo solo en el servidor
 * (el navegador nunca recibe el correo de otra cuenta) y la respuesta es la misma tanto si el
 * usuario no existe como si la contraseña es incorrecta.
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceKey) {
    return NextResponse.json({ error: "El servidor no está configurado." }, { status: 500, headers: noStore });
  }

  // Ráfagas desde una misma IP: se frenan antes de tocar la base.
  const ip = clientIp(request.headers);
  if (!rateLimit(`login:${ip}`, 10, 60_000)) return tooManyAttempts(60);

  // Solo desde esta misma aplicación (un formulario de otro sitio no puede intentar contraseñas).
  const origin = request.headers.get("origin");
  if (origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers: noStore });
  }

  try {
    const input = loginSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json({ error: "Escribe tu usuario o correo y tu contraseña." }, { status: 400, headers: noStore });
    }
    const { identifier, password } = input.data;
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const hash = identifierHash(identifier);

    // Usuario o IP bloqueados por intentos fallidos (misma respuesta exista o no el usuario).
    const wait = await waitSeconds(admin, hash, ip);
    if (wait > 0) return tooManyAttempts(wait);

    let email: string | null = null;
    if (identifier.includes("@")) {
      email = identifier.toLowerCase();
    } else {
      const { data, error } = await admin
        .from("authorized_users")
        .select("email")
        .ilike("username", identifier.replace(/[\\%_]/g, "\\$&"))
        .maybeSingle();
      if (error) {
        console.error("No se pudo resolver el usuario:", error);
        reportServerIncident("api · login usuario", error);
        return NextResponse.json({ error: "No se pudo iniciar sesión. Inténtalo de nuevo." }, { status: 500, headers: noStore });
      }
      email = (data?.email as string | undefined) ?? null;
    }

    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    // Si el usuario no existe se intenta igualmente un inicio con un correo inexistente para
    // que el tiempo y la respuesta no delaten qué usuarios existen.
    const { data, error } = await client.auth.signInWithPassword({
      email: email ?? "usuario-inexistente@invalid.local",
      password,
    });

    if (error || !data.session || !email) {
      if (error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500)) {
        reportServerIncident("api · login", error);
        return NextResponse.json(
          { error: "No se pudo conectar para iniciar sesión. Inténtalo de nuevo." },
          { status: 503, headers: noStore },
        );
      }
      await recordAttempt(admin, hash, ip, false);
      return invalidCredentials();
    }

    await recordAttempt(admin, hash, ip, true);

    return NextResponse.json(
      { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof BadJsonError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
    }
    console.error("Error en el inicio de sesión:", error);
    reportServerIncident("api · login", error);
    return NextResponse.json({ error: "No se pudo iniciar sesión. Inténtalo de nuevo." }, { status: 500, headers: noStore });
  }
}
