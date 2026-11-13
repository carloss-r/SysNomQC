"use client";

import { CloudOff, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getNetworkActivity, getServerNetworkActivity, subscribeNetworkActivity } from "@/lib/api-client";

/** Círculo giratorio. `light` para usarlo sobre botones de color. */
export function Spinner({ light = false, label }: { light?: boolean; label?: string }) {
  return (
    <span className={`spinner${light ? " spinner-light" : ""}`} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}

/**
 * Texto de un botón mientras guarda: muestra el círculo giratorio en lugar del ícono del botón.
 * Uso: `{busy ? <BusyLabel>Guardando…</BusyLabel> : "Guardar"}`.
 */
export function BusyLabel({ children }: { children: ReactNode }) {
  return <span className="busy-label"><span className="spinner spinner-button" aria-hidden="true" />{children}</span>;
}

/** Aviso dentro de un renglón mientras se procesa una de sus acciones (pagar, cancelar…). */
export function RowBusy({ label = "Procesando…" }: { label?: string }) {
  return <span className="row-busy" role="status"><span className="spinner" aria-hidden="true" />{label}</span>;
}

/**
 * Bloque de "cargando" para listas, tablas y paneles: círculo, texto y renglones de esqueleto que
 * anticipan el contenido, para que se note que algo viene en camino.
 */
export function LoadingState({ label, rows = 0, compact = false }: { label: string; rows?: number; compact?: boolean }) {
  return (
    <div className={`loading-state${compact ? " loading-state-compact" : ""}`} role="status" aria-live="polite">
      <div className="loading-state-head"><span className="spinner" aria-hidden="true" />{label}</div>
      {rows > 0 && (
        <div className="skeleton-rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, index) => (
            <div className="skeleton-row" key={index}>
              <span className="skeleton skeleton-avatar" />
              <span className="skeleton" style={{ width: `${38 + ((index * 17) % 30)}%` }} />
              <span className="skeleton skeleton-short" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Si el navegador tiene conexión a internet (se actualiza solo). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener("online", listener);
      window.addEventListener("offline", listener);
      return () => {
        window.removeEventListener("online", listener);
        window.removeEventListener("offline", listener);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Indicadores globales de red:
 *  * Barra delgada arriba de la pantalla mientras se obtienen datos (verde) o se guarda algo (dorado).
 *  * Aviso fijo cuando se pierde internet y uno breve cuando regresa.
 */
export function NetworkStatus() {
  const activity = useSyncExternalStore(subscribeNetworkActivity, getNetworkActivity, getServerNetworkActivity);
  const online = useOnline();
  const [restored, setRestored] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setRestored(true);
    const timer = window.setTimeout(() => setRestored(false), 4000);
    return () => window.clearTimeout(timer);
  }, [online]);

  const saving = activity.saving > 0;
  const busy = saving || activity.loading > 0;

  return (
    <>
      <div className={`network-bar${busy ? " active" : ""}${saving ? " saving" : ""}`} role="progressbar" aria-hidden={!busy} aria-label={saving ? "Guardando" : "Cargando"}>
        <span />
      </div>
      {!online && (
        <div className="network-banner network-offline" role="alert">
          <CloudOff size={17} aria-hidden="true" />
          <span><strong>Sin conexión a internet.</strong> No se enviará nada hasta que regrese; lo que estés capturando no se pierde.</span>
        </div>
      )}
      {online && restored && (
        <div className="network-banner network-online" role="status">
          <Wifi size={17} aria-hidden="true" />
          <span><strong>Conexión restablecida.</strong> Ya puedes continuar.</span>
        </div>
      )}
    </>
  );
}
