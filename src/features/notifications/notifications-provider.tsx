"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import type { AppNotification, NotificationsResponse } from "@/lib/notifications";
import { reportClientIncident } from "@/lib/report-incident";

/** Tiempo que una alerta descartada queda oculta; si el problema sigue, vuelve a mostrarse. */
export const SNOOZE_MS = 24 * 60 * 60_000;
const REFRESH_MS = 5 * 60_000;
const MIN_FOCUS_GAP_MS = 60_000;
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
  refresh: () => Promise<void>;
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

// Solo se monta con la sesión ya iniciada, por eso puede leer localStorage al crearse.
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? "";
  const storageKey = `sysnomqc.notifications.snoozed.${userId}`;

  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snoozes, setSnoozes] = useState<SnoozeMap>(() => readSnoozes(storageKey));
  const [now, setNow] = useState(() => Date.now());

  const sessionRef = useRef(session);
  const lastRefresh = useRef(0);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snoozes));
    } catch {
      // Navegador sin almacenamiento: lo descartado vale solo mientras la página siga abierta.
    }
  }, [storageKey, snoozes]);

  const refresh = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    lastRefresh.current = Date.now();
    setLoading(true);
    try {
      const result = await requestApi<NotificationsResponse>(current, "/api/notifications");
      const checkedAt = Date.now();
      setData(result);
      setError("");
      setNow(checkedAt);

      // Olvida lo vencido y lo ya resuelto, para que un problema que regrese avise de inmediato.
      // Si una fuente no se pudo revisar, sus alertas siguen contando como vigentes.
      const complete = result.sources.employees !== "unavailable" && result.sources.inventory !== "unavailable";
      const present = new Set(result.items.map((item) => item.id));
      setSnoozes((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id, until]) => until > checkedAt && (!complete || present.has(id))),
        ),
      );
    } catch (requestError) {
      console.error("No se pudieron cargar las notificaciones:", requestError);
      setError(describeError(requestError, "No se pudieron cargar las notificaciones."));
      if (!(requestError instanceof ApiError)) reportClientIncident("notificaciones · carga", requestError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    const onFocus = () => {
      if (Date.now() - lastRefresh.current >= MIN_FOCUS_GAP_MS) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.clearInterval(clock);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

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
