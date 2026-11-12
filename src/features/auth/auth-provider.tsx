"use client";

import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import { clearPhotoUrlCache } from "@/lib/photos";
import type { Access, Permission } from "@/lib/permissions";
import { reportClientIncident } from "@/lib/report-incident";
import { supabase } from "@/lib/supabase";
import { useNotify } from "@/shared/ui/notice-provider";

type Status = "loading" | "signedOut" | "signedIn" | "error";

type AuthContextValue = {
  status: Status;
  session: Session | null;
  access: Access | null;
  authError: string;
  signingIn: boolean;
  can: (permission: Permission) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  return value;
}

/** Sesión inactiva: se cierra sola (los expedientes son datos personales). */
const IDLE_LIMIT_MS = 30 * 60_000;
/** Tras 5 contraseñas incorrectas seguidas, el formulario se bloquea un minuto (además del límite de Supabase). */
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const notify = useNotify();
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const failures = useRef({ count: 0, lockedUntil: 0 });

  useEffect(() => {
    let active = true;

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (nextSession) {
        setStatus((previous) => (previous === "signedIn" ? previous : "loading"));
      } else {
        setAccess(null);
        setStatus("signedOut");
        clearPhotoUrlCache();
      }
    });

    supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (!active) return;
        if (error) setAuthError("No se pudo recuperar la sesión. Inicia sesión de nuevo.");
        setSession(sessionData.session);
        if (!sessionData.session) setStatus("signedOut");
      })
      .catch((error: unknown) => {
        console.error("No se pudo recuperar la sesión:", error);
        reportClientIncident("auth.sesión", error);
        if (!active) return;
        setAuthError("No se pudo conectar con Supabase. Verifica la configuración.");
        setStatus("signedOut");
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Rol y permisos: se piden una vez por cuenta (no en cada renovación del token).
  const userId = session?.user.id ?? null;
  useEffect(() => {
    const current = sessionRef.current;
    if (!userId || !current) return;
    let active = true;

    requestApi<Access>(current, "/api/me")
      .then((result) => {
        if (!active) return;
        setAccess(result);
        setAuthError("");
        setStatus("signedIn");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setAuthError(describeError(error, "Tu cuenta no está autorizada."));
          void supabase.auth.signOut();
          return;
        }
        console.error("No se pudo verificar la cuenta:", error);
        setAuthError(describeError(error, "No se pudo verificar tu cuenta."));
        setStatus("error");
        if (!(error instanceof ApiError)) reportClientIncident("auth.acceso", error);
      });

    return () => {
      active = false;
    };
  }, [userId, attempt]);

  // Cierre automático por inactividad.
  useEffect(() => {
    if (status !== "signedIn") return;
    let timer = 0;
    let lastActivity = Date.now();

    const expire = () => {
      notify("warning", "Sesión cerrada por inactividad", "Vuelve a iniciar sesión para continuar.");
      void supabase.auth.signOut();
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(expire, IDLE_LIMIT_MS);
    };
    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivity < 1000) return;
      lastActivity = now;
      arm();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity > IDLE_LIMIT_MS) expire();
    };

    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    arm();

    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, notify]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const lockedFor = failures.current.lockedUntil - Date.now();
      if (lockedFor > 0) {
        setAuthError(`Demasiados intentos. Espera ${Math.ceil(lockedFor / 1000)} segundos.`);
        return;
      }

      setSigningIn(true);
      setAuthError("");
      try {
        const identifier = email.trim();
        let error: { name?: string; status?: number } | null = null;
        if (identifier.includes("@")) {
          ({ error } = await supabase.auth.signInWithPassword({ email: identifier, password }));
        } else {
          // Con nombre de usuario, el servidor lo resuelve y devuelve la sesión.
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password }),
          });
          const result = (await response.json().catch(() => null)) as
            | { access_token?: string; refresh_token?: string }
            | null;
          if (response.ok && result?.access_token && result.refresh_token) {
            ({ error } = await supabase.auth.setSession({
              access_token: result.access_token,
              refresh_token: result.refresh_token,
            }));
          } else {
            error = { name: response.status >= 500 ? "AuthRetryableFetchError" : "AuthApiError", status: response.status };
          }
        }
        if (error) {
          console.error("No se pudo iniciar sesión:", error);
          const unreachable = error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500;
          if (!unreachable) {
            failures.current.count += 1;
            if (failures.current.count >= MAX_FAILED_LOGINS) {
              failures.current = { count: 0, lockedUntil: Date.now() + LOCK_MS };
            }
          }
          const message = unreachable
            ? "No se pudo conectar para iniciar sesión. Inténtalo de nuevo."
            : "No se pudo iniciar sesión. Revisa tu usuario o correo y tu contraseña.";
          setAuthError(message);
          notify("error", unreachable ? "Sin conexión" : "No se pudo iniciar sesión", message);
          if (unreachable) reportClientIncident("auth.login", error);
        } else {
          failures.current = { count: 0, lockedUntil: 0 };
          notify("success", "Sesión iniciada", "Bienvenido al sistema de gestión de personal.");
        }
      } catch (error) {
        console.error("No se pudo completar el inicio de sesión:", error);
        const message = "No se pudo conectar para iniciar sesión. Inténtalo de nuevo.";
        setAuthError(message);
        notify("error", "Sin conexión", message);
        reportClientIncident("auth.login", error);
      } finally {
        setSigningIn(false);
      }
    },
    [notify],
  );

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("No se pudo cerrar sesión:", error);
        notify("error", "No se pudo cerrar la sesión", "Inténtalo de nuevo.");
      } else {
        notify("info", "Sesión cerrada", "Hasta pronto.");
      }
    } catch (error) {
      console.error("No se pudo completar el cierre de sesión:", error);
      notify("error", "No se pudo cerrar la sesión", "Inténtalo de nuevo.");
      reportClientIncident("auth.logout", error);
    }
  }, [notify]);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  const can = useCallback(
    (permission: Permission) => access?.permissions.includes(permission) ?? false,
    [access],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, access, authError, signingIn, can, signIn, signOut, retry }),
    [status, session, access, authError, signingIn, can, signIn, signOut, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
