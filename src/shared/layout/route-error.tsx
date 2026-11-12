"use client";

import { useEffect } from "react";
import { reportClientIncident } from "@/lib/report-incident";

// Contenido de error de una pantalla. Se muestra dentro del marco (menú lateral y barra superior
// siguen disponibles), de modo que un fallo se queda en esa pantalla.
export function RouteError({
  area,
  error,
  reset,
}: {
  area: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientIncident(`pantalla · ${area}`, error, { digest: error.digest });
  }, [area, error]);

  return (
    <main className="main-content">
      <div className="empty-state route-error" role="alert">
        <h2>Esta pantalla tuvo un problema</h2>
        <p>El resto del sistema sigue funcionando. La incidencia se reportó automáticamente.</p>
        <button type="button" className="button button-primary" onClick={reset}>Reintentar</button>
      </div>
    </main>
  );
}
