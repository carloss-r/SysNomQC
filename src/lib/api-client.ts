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

/** Sin internet: la solicitud NO salió del navegador, así que no se guardó nada. */
export class OfflineError extends Error {
  constructor() {
    super("Sin conexión a internet. No se envió nada: tus datos siguen aquí, inténtalo cuando regrese la conexión.");
    this.name = "OfflineError";
  }
}

/**
 * Se cortó la conexión (o tardó demasiado) DESPUÉS de enviar un registro: puede que el servidor sí lo
 * haya guardado. Se avisa para revisar antes de volver a enviarlo y no duplicarlo.
 */
export class UncertainSaveError extends Error {
  constructor() {
    super("Se perdió la conexión mientras se guardaba. Es posible que sí se haya registrado: actualiza la lista y revisa antes de volver a enviarlo.");
    this.name = "UncertainSaveError";
  }
}

// ---------------------------------------------------------------------------
// Actividad de red: cuántas solicitudes van en curso (lecturas y envíos). La barra superior de la
// aplicación se suscribe para mostrar que algo está cargando o guardando.
// ---------------------------------------------------------------------------
export type NetworkActivity = { loading: number; saving: number };
let activity: NetworkActivity = { loading: 0, saving: 0 };
const listeners = new Set<() => void>();

function track(kind: keyof NetworkActivity, delta: 1 | -1) {
  activity = { ...activity, [kind]: Math.max(0, activity[kind] + delta) };
  listeners.forEach((listener) => listener());
}

export function subscribeNetworkActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNetworkActivity(): NetworkActivity {
  return activity;
}

const IDLE: NetworkActivity = { loading: 0, saving: 0 };
export function getServerNetworkActivity(): NetworkActivity {
  return IDLE;
}

// Envíos idénticos en curso (mismo método, ruta y contenido): un doble clic o un segundo envío
// reutiliza la misma solicitud en lugar de mandar el registro dos veces.
const inFlight = new Map<string, Promise<unknown>>();

const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 180_000;

export async function requestApi<T>(
  session: Session,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new OfflineError();

  const key = isWrite && (typeof options.body === "string" || options.body == null)
    ? `${method} ${path} ${options.body ?? ""}`
    : null;
  if (key) {
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const run = send<T>(session, path, options, method, isWrite);
  if (!key) return run;
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

async function send<T>(session: Session, path: string, options: RequestInit, method: string, isWrite: boolean): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const kind = isWrite ? "saving" : "loading";
  const timeout = options.body instanceof FormData ? UPLOAD_TIMEOUT_MS : isWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  // Respeta la cancelación de quien llama (p. ej. al cambiar de pantalla).
  const outer = options.signal;
  const forwardAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", forwardAbort, { once: true });
  }

  track(kind, 1);
  try {
    let response: Response;
    try {
      response = await fetch(path, { ...options, method, headers, signal: controller.signal });
    } catch (error) {
      if (outer?.aborted && !timedOut) throw error;
      if (typeof navigator !== "undefined" && navigator.onLine === false && !isWrite) throw new OfflineError();
      // El envío pudo llegar al servidor aunque la respuesta no regresó.
      if (isWrite) throw new UncertainSaveError();
      throw new TypeError(timedOut ? "timeout" : "network");
    }
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
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forwardAbort);
    track(kind, -1);
  }
}

/** Convierte cualquier error en un mensaje claro para mostrar al usuario. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof OfflineError || error instanceof UncertainSaveError) return error.message;
  if (error instanceof TypeError) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return new OfflineError().message;
    return error.message === "timeout"
      ? "El servidor tardó demasiado en responder. Revisa tu internet e inténtalo de nuevo."
      : "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  }
  return fallback;
}
