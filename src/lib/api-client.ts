import type { Session } from "@supabase/supabase-js";

/** Error devuelto por nuestra API (ya fue validado/registrado en el servidor). */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function requestApi<T>(
  session: Session,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return undefined as T;

  let result: unknown = null;
  try {
    result = await response.json();
  } catch {
    // Respuesta sin JSON: se informa con el mensaje genérico de abajo.
  }

  if (!response.ok) {
    const message = (result as { error?: string } | null)?.error;
    throw new ApiError(message || "La solicitud no pudo completarse.", response.status);
  }

  return result as T;
}

/** Convierte cualquier error en un mensaje claro para mostrar al usuario. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) {
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  }
  return fallback;
}
