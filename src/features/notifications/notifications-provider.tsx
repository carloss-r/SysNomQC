"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import { EPP_CHANGED_EVENT, type AppNotification, type NotificationsResponse } from "@/lib/notifications";
import { reportClientIncident } from "@/lib/report-incident";
import { supabase } from "@/lib/supabase";
import { useNotify } from "@/shared/ui/notice-provider";

const STOCK_TOAST_FLAG = "sysnomqc.notifications.stock-toast";

/** Tiempo que una alerta descartada queda oculta; si el problema sigue, vuelve a mostrarse. */
export const SNOOZE_MS = 24 * 60 * 60_000;
const REFRESH_MS = 5 * 60_000;
const MIN_FOCUS_GAP_MS = 2 * 60_000;
const CLOCK_TICK_MS = 60_000;

type SnoozeMap = Record<string, number>;

type NotificationsContextValue = {
  active: AppNotification[];
  snoozed: AppNotification[];
  sources: NotificationsResponse["sources"] | null;
  checkedAt: string | null;
  loading: boolean;
  error: string;
  now: number;
  snoozedUntil: (id: string) => number;
  /** Por omisión pide datos al día; con false acepta la respuesta reciente del servidor (hasta 1 min). */
  refresh: (fresh?: boolean) => Promise<void>;
  snooze: (ids: string[]) => void;
  restore: (ids: string[]) => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications debe usarse dentro de <NotificationsProvider>.");
  return value;
}

function readSnoozes(key: string): SnoozeMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
}

/**
 * Token vigente al momento de la consulta. Se pide a Supabase (no al estado de React) porque,
 * tras suspender la pestaña o cerrar sesión, el token guardado en el estado puede estar vencido o revocado.
 */
async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Solo se monta con la sesión ya iniciada, por eso puede leer localStorage al crearse.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const notify = useNotify();
  const userId = session?.user.id ?? "";
  const storageKey = `sysnomqc.notifications.snoozed.${userId}`;

  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snoozes, setSnoozes] = useState<SnoozeMap>(() => readSnoozes(storageKey));
  const [now, setNow] = useState(() => Date.now());

  const lastRefresh = useRef(0);
  // Una sola consulta a la vez: el inicio, el foco de la ventana, el intervalo y los cambios de EPP
  // pueden coincidir, y dos respuestas simultáneas mostraban los mismos avisos dos veces.
  const inFlight = useRef<Promise<void> | null>(null);
  // Avisos emergentes ya mostrados en esta sesión (respaldo por si falla el almacenamiento).
  const shownToasts = useRef(new Set<string>());

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snoozes));
    } catch {
      // Navegador sin almacenamiento: lo descartado vale solo mientras la página siga abierta.
    }
  }, [storageKey, snoozes]);

  // fresh = true pide al servidor que no use su respuesta reciente (botón "Actualizar", cambios de EPP).
  const load = useCallback(async (fresh: boolean) => {
    const path = fresh ? "/api/notifications?fresh=1" : "/api/notifications";
    const current = await currentSession();
    // Sin sesión (p. ej. justo al cerrar sesión): no hay nada que consultar.
    if (!current || current.user.id !== userId) return;
    lastRefresh.current = Date.now();
    setLoading(true);
    try {
      let result: NotificationsResponse;
      try {
        result = await requestApi<NotificationsResponse>(current, path);
      } catch (firstError) {
        // Token vencido: se renueva una vez y se reintenta antes de dar el error.
        if (!(firstError instanceof ApiError) || firstError.status !== 401) throw firstError;
        const { data: renewed } = await supabase.auth.refreshSession();
        if (!renewed.session || renewed.session.user.id !== userId) return;
        result = await requestApi<NotificationsResponse>(renewed.session, path);
      }
      const checkedAt = Date.now();
      setData(result);
      setError("");
      setNow(checkedAt);

      // Olvida lo vencido y lo ya resuelto, para que un problema que regrese avise de inmediato.
      // Si una fuente no se pudo revisar, sus alertas siguen contando como vigentes.
      const complete = Object.values(result.sources).every((status) => status !== "unavailable");
      const present = new Set(result.items.map((item) => item.id));
      setSnoozes((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id, until]) => until > checkedAt && (!complete || present.has(id))),
        ),
      );

      // Aviso emergente una sola vez por sesión del navegador; respeta lo que ya se descartó.
      const saved = readSnoozes(storageKey);
      const pending = result.items.filter((item) => (saved[item.id] ?? 0) <= checkedAt);

      // Encargado de compras: aviso especial cada vez que llega una solicitud que no había visto.
      // También cuando un conteo en almacén quedó por debajo de lo comprado.
      const isBuyerNotice = (item: AppNotification) => item.kind === "purchase_request" || item.kind === "purchase_shortage";
      const purchases = pending.filter(isBuyerNotice);
      if (result.sources.purchases === "ok") {
        const seenKey = `sysnomqc.notifications.seen-purchases.${userId}`;
        let seen: string[] = [];
        try {
          seen = JSON.parse(window.localStorage.getItem(seenKey) ?? "[]") as string[];
        } catch {
          seen = [];
        }
        const fresh = purchases.filter((item) => !seen.includes(item.id) && !shownToasts.current.has(item.id));
        fresh.forEach((item) => shownToasts.current.add(item.id));
        const first = fresh[0];
        if (fresh.length === 1 && first) {
          notify(
            first.kind === "purchase_shortage" ? "warning" : "info",
            first.kind === "purchase_shortage" ? "Llegó menos de lo comprado" : "Nueva solicitud de compra de EPP",
            `${first.title}. ${first.detail}`,
          );
        } else if (fresh.length > 1) notify("info", "Nuevos avisos de compras de EPP", `Tienes ${fresh.length} avisos nuevos por atender. Revisa la campana.`);
        try {
          window.localStorage.setItem(seenKey, JSON.stringify(result.items.filter(isBuyerNotice).map((item) => item.id)));
        } catch {
          // Sin almacenamiento: puede repetirse el aviso al recargar.
        }
      }

      const urgentStock = pending.filter((item) => item.severity !== "minor");
      const out = urgentStock.filter((item) => item.kind === "out_of_stock").length;
      const low = urgentStock.filter((item) => item.kind === "low_stock").length;
      if (out + low > 0) {
        const flag = `${STOCK_TOAST_FLAG}.${userId}`;
        let alreadyShown = shownToasts.current.has(flag);
        shownToasts.current.add(flag);
        try {
          alreadyShown ||= window.sessionStorage.getItem(flag) !== null;
          window.sessionStorage.setItem(flag, "1");
        } catch {
          // Sin sessionStorage: basta con el registro en memoria.
        }
        if (!alreadyShown) {
          notify("warning", "Alertas de inventario de EPP", `${out} agotado(s) y ${low} por reponer. Revisa la campana.`);
        }
      }
    } catch (requestError) {
      // Sesión inválida aun después de renovarla: el inicio de sesión se encarga; no es un fallo del sistema.
      if (requestError instanceof ApiError && requestError.status === 401) {
        setError(requestError.message);
        return;
      }
      console.error("No se pudieron cargar las notificaciones:", requestError);
      setError(describeError(requestError, "No se pudieron cargar las notificaciones."));
      if (!(requestError instanceof ApiError)) reportClientIncident("notificaciones · carga", requestError);
    } finally {
      setLoading(false);
    }
  }, [notify, storageKey, userId]);

  const run = useCallback((fresh: boolean) => {
    inFlight.current ??= load(fresh).finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [load]);
  const refresh = useCallback((fresh = true) => run(fresh), [run]);

  useEffect(() => {
    // Con la pestaña oculta (minimizada, otra pestaña al frente) no se consulta: nadie ve la campana.
    // Al volver, se actualiza si ya pasó un rato desde la última consulta.
    const hidden = () => document.visibilityState === "hidden";
    const first = window.setTimeout(() => void run(false), 0);
    const interval = window.setInterval(() => {
      if (!hidden()) void run(false);
    }, REFRESH_MS);
    const clock = window.setInterval(() => {
      if (!hidden()) setNow(Date.now());
    }, CLOCK_TICK_MS);
    const onReturn = () => {
      if (!hidden() && Date.now() - lastRefresh.current >= MIN_FOCUS_GAP_MS) void run(false);
    };
    const onEppChanged = () => void run(true);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener(EPP_CHANGED_EVENT, onEppChanged);
    return () => {
      window.removeEventListener(EPP_CHANGED_EVENT, onEppChanged);
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.clearInterval(clock);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [run]);

  const snooze = useCallback((ids: string[]) => {
    const until = Date.now() + SNOOZE_MS;
    setNow(Date.now());
    setSnoozes((previous) => ({ ...previous, ...Object.fromEntries(ids.map((id) => [id, until])) }));
  }, []);

  const restore = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    setSnoozes((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !removed.has(id))));
  }, []);

  const value = useMemo<NotificationsContextValue>(() => {
    const items = data?.items ?? [];
    const isSnoozed = (item: AppNotification) => (snoozes[item.id] ?? 0) > now;
    return {
      active: items.filter((item) => !isSnoozed(item)),
      snoozed: items.filter(isSnoozed),
      sources: data?.sources ?? null,
      checkedAt: data?.checked_at ?? null,
      loading,
      error,
      now,
      snoozedUntil: (id) => snoozes[id] ?? 0,
      refresh,
      snooze,
      restore,
    };
  }, [data, snoozes, now, loading, error, refresh, snooze, restore]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
