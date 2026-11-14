"use client";

import { useEffect, useRef, useState } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";

/**
 * Pide a la API solo cuando la pestaña se muestra y cuando cambian la ruta o `version`
 * (se incrementa tras registrar un movimiento). Con path = null no pide nada.
 * Por omisión conserva los datos anteriores mientras llega la respuesta nueva (cambio de página sin parpadeo);
 * con keepPrevious: false los oculta (p. ej. al cambiar de trabajador, para no mostrar los del anterior).
 */
export function useEppQuery<T>(path: string | null, version = 0, { keepPrevious = true }: { keepPrevious?: boolean } = {}) {
  const { session } = useAuth();
  const sessionRef = useRef(session);
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean; path: string | null }>({
    data: null,
    error: "",
    loading: path !== null,
    path: null,
  });

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const active = sessionRef.current;
    if (!path || !active) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      requestApi<T>(active, path)
        .then((data) => { if (!cancelled) setState({ data, error: "", loading: false, path }); })
        .catch((err) => { if (!cancelled) setState((current) => ({ ...current, error: describeError(err, "No se pudo cargar la información."), loading: false, path })); });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [path, version, session?.user.id]);

  const current = state.path === path;
  return {
    data: path && (current || keepPrevious) ? state.data : null,
    error: current ? state.error : "",
    loading: path !== null && (state.loading || !current),
  };
}

/** Valor que se actualiza un momento después de dejar de escribir (evita una consulta por tecla). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
