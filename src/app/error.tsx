"use client";

import { useEffect } from "react";
import { reportClientIncident } from "@/lib/report-incident";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientIncident("fallo al mostrar la página", error, { digest: error.digest });
  }, [error]);

  return (
    <main className="screen-center">
      <h1>Algo salió mal</h1>
      <p>La incidencia se reportó automáticamente. Puedes intentar cargar la página de nuevo.</p>
      <button type="button" className="button button-primary" onClick={reset}>
        Reintentar
      </button>
    </main>
  );
}
