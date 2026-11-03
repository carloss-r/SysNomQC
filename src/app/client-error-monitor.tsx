"use client";

import { useEffect } from "react";
import { reportClientIncident } from "@/lib/report-incident";

// Detecta errores de JavaScript no controlados en el navegador y los reporta por correo.
export function ClientErrorMonitor() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (event.message?.includes("ResizeObserver loop")) return;
      reportClientIncident("error de JavaScript", event.error ?? event.message, {
        archivo: event.filename,
        linea: event.lineno,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientIncident("promesa rechazada", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
