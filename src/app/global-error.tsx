"use client";

// Último recurso: solo se muestra si falla el diseño raíz de la aplicación.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "Arial, sans-serif", display: "grid", minHeight: "100vh", placeItems: "center", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1>Algo salió mal</h1>
          <p>Recarga la página para continuar.</p>
          <button type="button" onClick={reset}>Reintentar</button>
        </div>
      </body>
    </html>
  );
}
