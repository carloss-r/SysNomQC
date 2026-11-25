"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingState } from "@/shared/ui/loading";
import { loadInvoiceBytes } from "./files";

const MAX_PAGES = 15;

/**
 * Muestra un PDF dibujando sus páginas en <canvas> con pdf.js (incluido en "unpdf").
 * No depende del visor de PDF del navegador: ese visor sale en blanco dentro de la app por la política de
 * seguridad (object-src 'none'), si el navegador está configurado para descargar los PDF o en iPhone.
 */
export function PdfPages({ path, title, onError }: { path: string; title: string; onError?: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; pages: number; total: number }>({ status: "loading", pages: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    const box = container.current;
    if (box) box.replaceChildren();

    (async () => {
      const bytes = await loadInvoiceBytes(path);
      if (cancelled) return;
      const { getDocumentProxy } = await import("unpdf");
      // Sin eval: la política de seguridad de la app no lo permite (pdf.js usa otro camino).
      const pdf = await getDocumentProxy(bytes, { isEvalSupported: false });
      destroy = () => void pdf.destroy();
      if (cancelled) return destroy();
      const total = pdf.numPages;
      const count = Math.min(total, MAX_PAGES);
      const width = Math.max(320, (box?.clientWidth ?? 800) - 16);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      for (let number = 1; number <= count; number += 1) {
        const page = await pdf.getPage(number);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "invoice-pdf-page";
        canvas.setAttribute("aria-label", `${title} · página ${number} de ${total}`);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Sin canvas");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (cancelled) return;
        box?.appendChild(canvas);
        setState({ status: "ready", pages: number, total });
      }
    })().catch((error) => {
      console.error("No se pudo mostrar el PDF:", error);
      if (!cancelled) {
        setState({ status: "error", pages: 0, total: 0 });
        onError?.();
      }
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [path, title, onError]);

  return (
    <div className="invoice-pdf-pages">
      {state.status === "loading" && <LoadingState label="Cargando PDF…" />}
      {state.status === "error" && <p className="epp-empty">No se pudo mostrar el PDF aquí. Ábrelo en otra pestaña.</p>}
      <div ref={container} className="invoice-pdf-canvas-list" />
      {state.status === "ready" && state.total > MAX_PAGES && (
        <p className="epp-muted invoice-pdf-more">Se muestran las primeras {MAX_PAGES} de {state.total} páginas. Ábrelo en otra pestaña para ver el resto.</p>
      )}
    </div>
  );
}
