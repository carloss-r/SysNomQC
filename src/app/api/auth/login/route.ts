import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

/**
 * Inicio de sesión con "usuario o correo". El usuario se convierte en correo solo en el servidor
 * (el navegador nunca recibe el correo de otra cuenta) y la respuesta es la misma tanto si el
 * usuario no existe como si la contraseña es incorrecta.
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return NextResponse.json({ error: "El servidor no está configurado." }, { status: 500, headers: noStore });
  }

  try {
    const input = loginSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json({ error: "Escribe tu usuario o correo y tu contraseña." }, { status: 400, headers: noStore });
    }
    const { identifier, password } = input.data;

    let email: string | null = null;
    if (identifier.includes("@")) {
      email = identifier.toLowerCase();
    } else {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) {
        return NextResponse.json(
          { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor." },
          { status: 500, headers: noStore },
        );
      }
      const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
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
      return invalidCredentials();
    }

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
