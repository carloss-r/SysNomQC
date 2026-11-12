"use client";

import { Bell, CircleAlert, Info, ShoppingCart, TriangleAlert, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotificationSeverity } from "@/lib/notifications";
import { useNotifications } from "./notifications-provider";

const MAX_ITEMS = 5;

const ICONS: Record<NotificationSeverity, LucideIcon> = {
  critical: CircleAlert,
  important: TriangleAlert,
  minor: Info,
};

const FILTERS: { key: NotificationSeverity | "all"; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "critical", label: "Graves" },
  { key: "important", label: "Importantes" },
  { key: "minor", label: "Menores" },
];

// La campana abre un panel pequeño con lo más urgente; la pantalla completa queda como opción.
export function NotificationsBell() {
  const { active, loading, refresh, snooze } = useNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationSeverity | "all">("all");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) void refresh();
    setOpen(!open);
  }

  // El número solo cuenta lo grave e importante; lo de menor importancia no debe generar ruido.
  const urgent = active.filter((item) => item.severity !== "minor");
  const hasCritical = urgent.some((item) => item.severity === "critical");
  const hasPurchase = urgent.some((item) => item.kind === "purchase_request");
  const label = urgent.length === 0 ? "Notificaciones" : `Notificaciones: ${urgent.length} por atender`;

  const filtered = filter === "all" ? active : active.filter((item) => item.severity === filter);
  const shown = filtered.slice(0, MAX_ITEMS);
  const countOf = (key: NotificationSeverity | "all") =>
    key === "all" ? active.length : active.filter((item) => item.severity === key).length;

  return (
    <div className="bell" ref={boxRef}>
      <button type="button" className="icon-button topbar-icon" onClick={toggle} aria-label={label} aria-expanded={open} title={label}>
        <Bell size={18} />
        {urgent.length > 0 && (
          <span className={`bell-count${hasPurchase ? " bell-count-purchase" : hasCritical ? " bell-count-critical" : ""}`} aria-hidden="true">
            {urgent.length > 99 ? "99+" : urgent.length}
          </span>
        )}
      </button>

      {open && (
        <section className="bell-panel" role="dialog" aria-label="Notificaciones">
          <div className="bell-chips" role="group" aria-label="Filtrar por gravedad">
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`bell-chip${filter === item.key ? " active" : ""}`}
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {item.label} {countOf(item.key)}
              </button>
            ))}
          </div>

          {shown.length > 0 ? (
            <ul className="bell-list">
              {shown.map((item) => {
                const purchase = item.kind === "purchase_request";
                const Icon = purchase ? ShoppingCart : ICONS[item.severity];
                const text = (
                  <>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </>
                );
                return (
                  <li className={`bell-item bell-${item.severity}${purchase ? " bell-purchase" : ""}`} key={item.id}>
                    <Icon size={16} />
                    {item.href
                      ? <Link className="bell-item-text" href={item.href} onClick={() => setOpen(false)}>{text}</Link>
                      : <div className="bell-item-text">{text}</div>}
                    <button type="button" className="bell-dismiss" onClick={() => snooze([item.id])} aria-label={`Descartar: ${item.title}`} title="Descartar 24 horas">
                      <X size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="bell-empty">{loading ? "Revisando…" : filter === "all" ? "Todo en orden." : "Nada en esta categoría."}</p>
          )}

          <Link className="bell-link" href="/notificaciones" onClick={() => setOpen(false)}>
            {filtered.length > shown.length ? `Ver todas (${filtered.length - shown.length} más)` : "Ver todas"}
          </Link>
        </section>
      )}
    </div>
  );
}
