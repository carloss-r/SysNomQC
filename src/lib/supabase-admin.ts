import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente con la llave de servidor (service_role / "secret key"): ignora RLS, por eso SOLO se usa
// en código de servidor (rutas de /api) y nunca debe llevar el prefijo NEXT_PUBLIC_.
const KEY_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY"] as const;

function readServiceKey(): string | undefined {
  for (const name of KEY_NAMES) {
    // trim: al pegar la llave suele colarse un espacio o salto de línea al final.
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function createServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = readServiceKey();

  if (!url || !key) {
    // Solo nombres de variables, nunca valores.
    console.error(
      `[supabase-admin] Falta ${!url ? "NEXT_PUBLIC_SUPABASE_URL" : ""}${!url && !key ? " y " : ""}${
        !key ? KEY_NAMES[0] : ""
      } en las variables de entorno del servidor.`,
    );
    return null;
  }

  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
