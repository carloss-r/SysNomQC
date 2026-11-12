import { createHash } from "node:crypto";
import type { Access } from "@/lib/permissions";

/**
 * Caché breve, en memoria, del acceso de cada sesión (usuario, rol, permisos y sede).
 *
 * Sin ella, cada llamada a la API hacía 3 consultas a Supabase antes de empezar su trabajo
 * (validar el token, leer la cuenta autorizada y leer sus roles adicionales). Una pantalla
 * que pide 4 cosas a la vez generaba 12 consultas solo para saber quién es el usuario.
 *
 * - La llave es el hash del token: un token nuevo (al renovarse la sesión) vuelve a validarse.
 * - Dura poco (ACCESS_TTL_MS): un cambio de rol o una cuenta desactivada surten efecto en ese tiempo
 *   como máximo en otras instancias; en la misma instancia, al instante (clearAccessCache).
 * - En serverless cada instancia tiene su propia caché; no se comparte ni persiste.
 */
export const ACCESS_TTL_MS = 30_000;
const MAX_ENTRIES = 1_000;

type Entry = { access: Access; expires: number };
const entries = new Map<string, Entry>();

const keyOf = (token: string) => createHash("sha256").update(token).digest("base64url");

export function getCachedAccess(token: string): Access | null {
  const key = keyOf(token);
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry.access;
}

export function setCachedAccess(token: string, access: Access): void {
  const now = Date.now();
  if (entries.size >= MAX_ENTRIES) {
    for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key);
    if (entries.size >= MAX_ENTRIES) entries.clear();
  }
  entries.set(keyOf(token), { access, expires: now + ACCESS_TTL_MS });
}

/** Se llama al cambiar usuarios o roles, para que el cambio aplique de inmediato. */
export function clearAccessCache(): void {
  entries.clear();
}
