"use client";

import { Bell, PackageX, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotify } from "@/shared/ui/notice-provider";

type Alert = { id: number; name: string; stock: number; min_stock: number; unit: string; level: "out" | "low" | "soon" };

export const EPP_CHANGED_EVENT = "epp:changed";
const REFRESH_MS = 5 * 60 * 1000;
const TOAST_FLAG = "epp-alert-toast";

const TEXT = {
  out: "Agotado — compra urgente",
  low: "Bajo el mínimo — reponer",
  soon: "Cerca del mínimo — anticipa la compra",
} as const;

/** Campana de la barra superior: alertas de existencias para quien tiene permiso de ver EPP. */
export function EppAlertsBell() {
  const { session, can } = useAuth();
  const notify = useNotify();
  const sessionRef = useRef(session);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const allowed = can("epp.view");

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async (announce: boolean) => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      const data = await requestApi<Alert[]>(active, "/api/epp/alerts");
      setAlerts(data);
      const urgent = data.filter((item) => item.level !== "soon").length;
      if (announce && urgent > 0) {
        try {
          if (sessionStorage.getItem(TOAST_FLAG)) return;
          sessionStorage.setItem(TOAST_FLAG, "1");
        } catch {
          // Sin sessionStorage: se avisa igualmente.
        }
        const out = data.filter((item) => item.level === "out").length;
        notify("warning", "Alertas de inventario de EPP", `${out} agotado(s) y ${urgent - out} por reponer. Revisa la campana.`);
      }
    } catch {
      // Las alertas son informativas: un fallo no interrumpe el trabajo.
    }
  }, [notify]);

  useEffect(() => {
    if (!allowed) return;
    void load(true);
    const timer = window.setInterval(() => void load(false), REFRESH_MS);
    const refresh = () => void load(false);
    window.addEventListener(EPP_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(EPP_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [allowed, load, session?.user.id]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!allowed) return null;
  const urgent = alerts.filter((item) => item.level !== "soon").length;

  return (
    <div className="bell" ref={boxRef}>
      <button className="icon-button bell-button" onClick={() => setOpen((value) => !value)} aria-label={`Notificaciones${urgent ? `: ${urgent} urgentes` : ""}`} aria-expanded={open} title="Notificaciones">
        <Bell size={18} />
        {alerts.length > 0 && <span className={`bell-count${urgent ? "" : " bell-count-soft"}`}>{alerts.length}</span>}
      </button>
      {open && (
        <section className="bell-panel" role="dialog" aria-label="Notificaciones">
          <header>
            <strong>Notificaciones</strong>
            <button className="icon-button" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={16} /></button>
          </header>
          {alerts.length === 0 ? (
            <p className="bell-empty">Todo en orden: no hay EPP por agotarse.</p>
          ) : (
            <ul>
              {alerts.map((item) => (
                <li key={item.id} className={`bell-item bell-${item.level}`}>
                  {item.level === "out" ? <PackageX size={16} /> : <TriangleAlert size={16} />}
                  <div>
                    <strong>{item.name}</strong>
                    <small>{TEXT[item.level]}</small>
                    <small>Existencia {item.stock} · mínimo {item.min_stock}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/epp" className="bell-link" onClick={() => setOpen(false)}>Ir al inventario de EPP</Link>
        </section>
      )}
    </div>
  );
}
