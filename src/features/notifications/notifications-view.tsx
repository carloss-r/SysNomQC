"use client";

import { BellOff, CircleAlert, ClipboardList, Info, PackageX, RefreshCw, ShoppingCart, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  KIND_LABELS,
  SEVERITY_LABELS,
  type AppNotification,
  type NotificationKind,
  type NotificationSeverity,
} from "@/lib/notifications";
import { StatCard } from "@/shared/ui/badges";
import { PageHeader } from "@/shared/ui/page-header";
import { SNOOZE_MS, useNotifications } from "./notifications-provider";

const PAGE_SIZE = 50;
const SNOOZE_HOURS = SNOOZE_MS / 3_600_000;

const SEVERITY_ICONS: Record<NotificationSeverity, LucideIcon> = {
  critical: CircleAlert,
  important: TriangleAlert,
  minor: Info,
};

const SEVERITIES = Object.keys(SEVERITY_LABELS) as NotificationSeverity[];
const KINDS = Object.keys(KIND_LABELS) as NotificationKind[];

type Tab = "active" | "snoozed";

function formatRemaining(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

function countBy<T extends string>(items: AppNotification[], read: (item: AppNotification) => T, value: T) {
  return items.filter((item) => read(item) === value).length;
}

export function NotificationsView() {
  const { active, snoozed, sources, checkedAt, loading, error, now, snoozedUntil, refresh, snooze, restore } = useNotifications();
  const [tab, setTab] = useState<Tab>("active");
  const [severity, setSeverity] = useState<NotificationSeverity | "all">("all");
  const [kind, setKind] = useState<NotificationKind | "all">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Al abrir la pantalla se revisa de nuevo, por si acaban de corregir algo.
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const source = tab === "active" ? active : snoozed;
  const filtered = useMemo(
    () =>
      source.filter(
        (item) => (severity === "all" || item.severity === severity) && (kind === "all" || item.kind === kind),
      ),
    [source, severity, kind],
  );
  const shown = filtered.slice(0, limit);
  const isFiltered = severity !== "all" || kind !== "all";

  function changeTab(next: Tab) {
    setTab(next);
    setLimit(PAGE_SIZE);
  }

  function changeSeverity(next: NotificationSeverity | "all") {
    setSeverity(next);
    setLimit(PAGE_SIZE);
  }

  function changeKind(next: NotificationKind | "all") {
    setKind(next);
    setLimit(PAGE_SIZE);
  }

  const filteredIds = filtered.map((item) => item.id);

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="CENTRO DE AVISOS"
        title="Notificaciones"
        description={`Lo resuelto desaparece solo. Lo que descartes vuelve en ${SNOOZE_HOURS} horas si el problema sigue.`}
        actions={
          <button type="button" className="button button-outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} /> {loading ? "Revisando…" : "Revisar ahora"}
          </button>
        }
      >
        <div className="stats-grid hide-phone">
          <StatCard label="Graves" count={countBy(active, (item) => item.severity, "critical")} tone="red" icon={<CircleAlert size={18} />} />
          <StatCard label="Importantes" count={countBy(active, (item) => item.severity, "important")} tone="gold" icon={<TriangleAlert size={18} />} />
          <StatCard label="Menor importancia" count={countBy(active, (item) => item.severity, "minor")} tone="blue" icon={<Info size={18} />} />
          <StatCard label="Descartadas" count={snoozed.length} tone="purple" icon={<BellOff size={18} />} />
        </div>
      </PageHeader>

      <section className="directory-card">
        <div className="directory-toolbar notification-toolbar">
          <div className="site-tabs" role="group" aria-label="Estado">
            <button type="button" aria-pressed={tab === "active"} className={`site-tab${tab === "active" ? " active" : ""}`} onClick={() => changeTab("active")}>
              Activas ({active.length})
            </button>
            <button type="button" aria-pressed={tab === "snoozed"} className={`site-tab${tab === "snoozed" ? " active" : ""}`} onClick={() => changeTab("snoozed")}>
              Descartadas ({snoozed.length})
            </button>
          </div>

          <div className="notification-filters">
            <label className="filter-select">
              <span>Gravedad</span>
              <select value={severity} onChange={(event) => changeSeverity(event.target.value as NotificationSeverity | "all")}>
                <option value="all">Todas</option>
                {SEVERITIES.map((value) => (
                  <option key={value} value={value}>{SEVERITY_LABELS[value]} ({countBy(source, (item) => item.severity, value)})</option>
                ))}
              </select>
            </label>
            <label className="filter-select">
              <span>Tipo</span>
              <select value={kind} onChange={(event) => changeKind(event.target.value as NotificationKind | "all")}>
                <option value="all">Todos</option>
                {KINDS.map((value) => (
                  <option key={value} value={value}>{KIND_LABELS[value]} ({countBy(source, (item) => item.kind, value)})</option>
                ))}
              </select>
            </label>
          </div>

          {filtered.length > 0 && (
            <button
              type="button"
              className="button button-neutral notification-bulk"
              onClick={() => (tab === "active" ? snooze(filteredIds) : restore(filteredIds))}
            >
              {tab === "active" ? `Descartar ${filtered.length === 1 ? "esta" : `estas ${filtered.length}`}` : `Restaurar ${filtered.length === 1 ? "esta" : `estas ${filtered.length}`}`}
            </button>
          )}
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {sources?.inventory === "unavailable" && (
          <div className="error-banner" role="status">No se pudo revisar el inventario de EPP, así que aquí pueden faltar avisos de existencias. Revisa que se hayan ejecutado las migraciones de EPP en Supabase.</div>
        )}
        {sources?.employees === "unavailable" && (
          <div className="error-banner" role="status">No se pudieron revisar los expedientes, así que aquí pueden faltar avisos.</div>
        )}

        {shown.length > 0 && (
          <ul className="notification-list">
            {shown.map((item) => {
              const Icon = item.kind === "purchase_request" ? ShoppingCart : SEVERITY_ICONS[item.severity];
              return (
                <li className={`notification-item notification-${item.severity}${item.kind === "purchase_request" ? " notification-purchase" : ""}`} key={item.id}>
                  <span className="notification-icon"><Icon size={18} /></span>
                  <div className="notification-body">
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <div className="notification-tags">
                      <span className="notification-tag">{SEVERITY_LABELS[item.severity]}</span>
                      <span className="notification-tag notification-tag-kind">{KIND_LABELS[item.kind]}</span>
                      {tab === "snoozed" && <span className="notification-return">Vuelve en {formatRemaining(snoozedUntil(item.id) - now)}</span>}
                    </div>
                  </div>
                  <div className="notification-actions">
                    {item.href && <Link className="text-button" href={item.href}>Revisar</Link>}
                    {tab === "active"
                      ? <button type="button" className="text-button text-button-muted" onClick={() => snooze([item.id])}>Descartar</button>
                      : <button type="button" className="text-button" onClick={() => restore([item.id])}>Restaurar</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > shown.length && (
          <div className="notification-more">
            <button type="button" className="button button-outline" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              Mostrar más ({filtered.length - shown.length} restantes)
            </button>
          </div>
        )}

        {filtered.length === 0 && loading && !checkedAt && (
          <div className="table-state"><span className="spinner" /> Revisando avisos…</div>
        )}
        {filtered.length === 0 && checkedAt && (
          <div className="empty-state">
            <div className="empty-icon">{tab === "active" ? <ClipboardList size={25} /> : <PackageX size={25} />}</div>
            <h2>
              {isFiltered
                ? "Ningún aviso coincide con este filtro"
                : tab === "active" ? "No hay avisos activos" : "No hay avisos descartados"}
            </h2>
            <p>{isFiltered ? "Prueba con otra gravedad o tipo." : tab === "active" ? "Todo lo revisado está en orden." : "Lo que descartes aparecerá aquí hasta que vuelva a mostrarse."}</p>
          </div>
        )}

        <div className="table-footer">
          <span>{filtered.length} {filtered.length === 1 ? "aviso" : "avisos"}</span>
          {checkedAt && <span>Última revisión: {new Date(checkedAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
      </section>
    </main>
  );
}
