"use client";

import { AlarmClock, CalendarDays, CalendarRange, CheckCircle2, Clock, FileText, FileUp, Pencil, Receipt, RotateCcw, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { plantToday } from "@/lib/fuels";
import {
  formatMoney,
  formatTotals,
  groupSummaries,
  INVOICE_STATUS_LABELS,
  MAX_INCIDENT_LENGTH,
  summarize,
  weekStart,
  type Invoice,
  type InvoiceSummary,
} from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { addDays, formatDay, monthLabel } from "@/features/fuels/format";
import { RequirePermission } from "@/shared/layout/require-permission";
import { ExportButtons } from "@/shared/reports/export-buttons";
import type { Report } from "@/shared/reports/report-export";
import { StatCard } from "@/shared/ui/badges";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { useDialog } from "@/shared/ui/dialog-provider";
import { PageHeader } from "@/shared/ui/page-header";
import { openInvoiceFile } from "./files";
import { InvoiceModal } from "./invoice-modal";
import { UploadModal, type Detected } from "./upload-modal";

const SUBTITLE = "Finanzas · Facturas";

type Data = { today: string; invoices: Invoice[] };
type Tab = "list" | "weekly" | "monthly";
type Filter = "all" | "pendiente" | "pagada" | "incidente" | "vencida";
type StatusChange = { status: "pendiente" } | { status: "pagada"; paidOn: string } | { status: "incidente"; description: string };
type Dialog =
  | { type: "upload" }
  | { type: "detail"; invoice: Invoice; detected?: Detected }
  | { type: "pay"; invoice: Invoice }
  | null;

export function InvoicesView() {
  return (
    <RequirePermission permission="invoices.view">
      <InvoicesScreen />
    </RequirePermission>
  );
}

const isOverdue = (invoice: Invoice, today: string) => invoice.status === "pendiente" && !!invoice.due_date && invoice.due_date < today;
const weekLabel = (monday: string) => `${formatDay(monday)} al ${formatDay(addDays(monday, 6))}`;

function StatusBadge({ invoice, today }: { invoice: Invoice; today: string }) {
  if (invoice.status === "pagada") return <span className="fuel-status fuel-status-ok">Pagada</span>;
  if (invoice.status === "incidente") return <span className="fuel-status fuel-status-bad">Incidente</span>;
  return isOverdue(invoice, today) ? <span className="fuel-status fuel-status-bad">Vencida · pendiente</span> : <span className="fuel-status fuel-status-warn">Pendiente de pago</span>;
}

function InvoicesScreen() {
  const { session, can } = useAuth();
  const notify = useNotify();
  const systemDialog = useDialog();
  const sessionRef = useRef(session);
  const canManage = can("invoices.manage");

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [month, setMonth] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      setData(await requestApi<Data>(active, "/api/invoices"));
      setError("");
    } catch (err) {
      setError(describeError(err, "No se pudieron cargar las facturas."));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const today = data?.today ?? plantToday();
  const currentMonth = today.slice(0, 7);
  const invoices = useMemo(() => data?.invoices ?? [], [data]);

  const stats = useMemo(() => {
    const thisMonth = summarize(currentMonth, invoices.filter((row) => row.invoice_date.startsWith(currentMonth)), today);
    const thisWeek = summarize(weekStart(today), invoices.filter((row) => weekStart(row.invoice_date) === weekStart(today)), today);
    const pending = summarize("pendientes", invoices.filter((row) => row.status === "pendiente"), today);
    const incidents = invoices.filter((row) => row.status === "incidente").length;
    return { thisMonth, thisWeek, pending, incidents };
  }, [invoices, currentMonth, today]);

  const months = useMemo(() => Array.from(new Set(invoices.map((row) => row.invoice_date.slice(0, 7)))).sort().reverse(), [invoices]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return invoices.filter((row) => {
      if (month && !row.invoice_date.startsWith(month)) return false;
      if (filter === "vencida" && !isOverdue(row, today)) return false;
      if ((filter === "pendiente" || filter === "pagada" || filter === "incidente") && row.status !== filter) return false;
      if (!term) return true;
      return [row.folio, row.uuid, row.supplier_name, row.supplier_rfc, row.file_name, row.notes, row.incident_description].join(" ").toLowerCase().includes(term);
    });
  }, [invoices, query, month, filter, today]);

  const weekly = useMemo(() => groupSummaries(invoices, (row) => weekStart(row.invoice_date), today), [invoices, today]);
  const monthly = useMemo(() => groupSummaries(invoices, (row) => row.invoice_date.slice(0, 7), today), [invoices, today]);

  async function setStatus(invoice: Invoice, change: StatusChange) {
    if (!session) return;
    setBusyId(invoice.id);
    try {
      await requestApi(session, `/api/invoices/${invoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "status",
          status: change.status,
          paid_on: change.status === "pagada" ? change.paidOn : null,
          incident_description: change.status === "incidente" ? change.description : null,
        }),
      });
      notify(
        "success",
        change.status === "pagada" ? "Factura marcada como pagada" : change.status === "incidente" ? "Incidente registrado en la factura" : "Factura regresada a pendiente de pago",
      );
      setDialog(null);
      await load();
    } catch (err) {
      notify("error", "No se pudo cambiar el estatus", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusyId(null);
    }
  }

  // El incidente se describe a mano; si la factura ya lo tiene, se puede corregir la descripción.
  async function markIncident(invoice: Invoice) {
    const editing = invoice.status === "incidente";
    const description = await systemDialog.prompt({
      title: editing ? "Editar incidente" : "Marcar factura con incidente",
      message: `${invoice.supplier_name ?? invoice.file_name}${invoice.folio ? ` · folio ${invoice.folio}` : ""} · ${formatMoney(invoice.total, invoice.currency)}`,
      label: "Descripción del incidente",
      placeholder: "Ej. El monto no coincide con la orden de compra; se pidió nota de crédito al proveedor.",
      defaultValue: invoice.incident_description ?? "",
      required: true,
      multiline: true,
      maxLength: MAX_INCIDENT_LENGTH,
      confirmLabel: editing ? "Guardar" : "Marcar incidente",
      tone: "danger",
      validate: (value) => (value.trim().length < 5 ? "Describe el incidente (al menos 5 caracteres)." : null),
    });
    if (description === null) return;
    await setStatus(invoice, { status: "incidente", description: description.trim() });
  }

  async function remove(invoice: Invoice) {
    if (!session) return;
    const ok = await systemDialog.confirm({
      title: "Eliminar factura",
      message: `¿Eliminar la factura ${invoice.folio ?? invoice.file_name}? Se borra también el PDF y no se puede deshacer.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(invoice.id);
    try {
      await requestApi(session, `/api/invoices/${invoice.id}`, { method: "DELETE" });
      notify("success", "Factura eliminada");
      await load();
    } catch (err) {
      notify("error", "No se pudo eliminar la factura", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusyId(null);
    }
  }

  async function viewPdf(invoice: Invoice) {
    if (!(await openInvoiceFile(invoice.file_path))) notify("error", "No se pudo abrir el PDF", "Revisa tu conexión o que el archivo siga en el almacenamiento.");
  }

  function listReport(generatedBy: string): Report {
    const summary = summarize("lista", rows, today);
    return {
      subtitle: SUBTITLE,
      title: "Relación de facturas",
      info: [["Periodo", month ? monthLabel(month) : "Todas"], ["Estatus", filter === "all" ? "Todos" : filter === "vencida" ? "Vencidas" : INVOICE_STATUS_LABELS[filter]]],
      summary: [["Facturas", summary.count], ["Pagado", formatTotals(summary.paid)], ["Pendiente", formatTotals(summary.pending)], ["Con incidente", summary.incidentCount]],
      sections: [{
        title: "Facturas",
        columns: [
          { header: "Fecha", width: 12 }, { header: "Folio", width: 16 }, { header: "Emisor", width: 34 }, { header: "RFC", width: 15 },
          { header: "Total", width: 16, align: "right" }, { header: "Vence", width: 12 }, { header: "Estatus", width: 16 }, { header: "Pagada el", width: 12 },
          { header: "Incidente", width: 34 },
        ],
        rows: rows.map((row) => [
          formatDay(row.invoice_date), row.folio ?? "—", row.supplier_name ?? "—", row.supplier_rfc ?? "—", formatMoney(row.total, row.currency),
          formatDay(row.due_date), isOverdue(row, today) ? "Vencida" : INVOICE_STATUS_LABELS[row.status], formatDay(row.paid_on),
          row.incident_description ?? "—",
        ]),
        empty: "Sin facturas.",
      }],
      generatedBy,
      fileName: `Facturas_${month || "todas"}`,
    };
  }

  function summaryReport(kind: "weekly" | "monthly", list: InvoiceSummary[], generatedBy: string): Report {
    const label = (key: string) => (kind === "weekly" ? weekLabel(key) : monthLabel(key));
    return {
      subtitle: SUBTITLE,
      title: kind === "weekly" ? "Resumen semanal de facturas" : "Resumen mensual de facturas",
      info: [["Corte", formatDay(today)]],
      sections: [{
        title: kind === "weekly" ? "Por semana (lunes a domingo)" : "Por mes",
        columns: [
          { header: kind === "weekly" ? "Semana" : "Mes", width: 26 }, { header: "Facturas", width: 10, align: "right" },
          { header: "Total facturado", width: 22, align: "right" }, { header: "Pagadas", width: 10, align: "right" },
          { header: "Pagado", width: 22, align: "right" }, { header: "Pendientes", width: 11, align: "right" }, { header: "Pendiente", width: 22, align: "right" },
        ],
        rows: list.map((item) => [label(item.key), item.count, formatTotals(item.total), item.paidCount, formatTotals(item.paid), item.pendingCount, formatTotals(item.pending)]),
        empty: "Sin facturas.",
      }],
      generatedBy,
      fileName: kind === "weekly" ? "Facturas_resumen_semanal" : "Facturas_resumen_mensual",
    };
  }

  const tabs: { key: Tab; label: string; icon: typeof Receipt }[] = [
    { key: "list", label: `Facturas (${invoices.length})`, icon: Receipt },
    { key: "weekly", label: "Resumen semanal", icon: CalendarRange },
    { key: "monthly", label: "Resumen mensual", icon: CalendarDays },
  ];

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="Finanzas"
        title="Facturas"
        description="Carga las facturas en PDF, consulta su texto digitalizado y lleva el seguimiento de lo pagado y lo pendiente por semana y por mes."
        actions={canManage ? <button className="button button-gold" onClick={() => setDialog({ type: "upload" })}><FileUp size={17} /> Cargar factura</button> : undefined}
      >
        <div className="stats-grid">
          <StatCard label="Pendientes de pago" count={stats.pending.count} tone="gold" icon={<Clock size={16} />} />
          <StatCard label="Vencidas" count={stats.pending.overdueCount} tone={stats.pending.overdueCount ? "red" : "green"} icon={<AlarmClock size={16} />} />
          <StatCard label={`Facturas de ${monthLabel(currentMonth)}`} count={stats.thisMonth.count} tone="blue" icon={<CalendarDays size={16} />} />
          <StatCard label="Pagadas este mes" count={stats.thisMonth.paidCount} tone="green" icon={<CheckCircle2 size={16} />} />
        </div>
        {data && (
          <p className="epp-muted fuel-today">
            Por pagar: <strong>{formatTotals(stats.pending.pending)}</strong> · Este mes: {formatTotals(stats.thisMonth.total)} facturado, {formatTotals(stats.thisMonth.paid)} pagado ·
            Esta semana: {formatTotals(stats.thisWeek.total)} en {stats.thisWeek.count} factura(s)
            {stats.incidents > 0 && <> · <strong>{stats.incidents} con incidente</strong></>}
          </p>
        )}
      </PageHeader>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>Reintentar</button>
        </div>
      )}

      <section className="directory-card">
        <div className="directory-toolbar">
          <div className="site-tabs" role="tablist">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.key} role="tab" aria-selected={tab === item.key} className={`site-tab${tab === item.key ? " active" : ""}`} onClick={() => setTab(item.key)}>
                  <Icon size={14} /> {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {!data ? (
          <p className="epp-empty">{error ? "No hay datos para mostrar." : "Cargando facturas…"}</p>
        ) : tab === "list" ? (
          <>
            <div className="directory-toolbar">
              <div className="site-tabs" role="tablist">
                {([["all", "Todas"], ["pendiente", "Pendientes"], ["vencida", "Vencidas"], ["pagada", "Pagadas"], ["incidente", "Incidentes"]] as const).map(([key, label]) => (
                  <button key={key} role="tab" aria-selected={filter === key} className={`site-tab${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>{label}</button>
                ))}
              </div>
              <select className="invoice-month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Mes">
                <option value="">Todos los meses</option>
                {months.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
              </select>
              <label className="search-box">
                <Search size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar folio, emisor, RFC o UUID" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
              </label>
              <ExportButtons build={listReport} disabled={rows.length === 0} />
            </div>
            <div className="table-scroll">
              <table className="employee-table">
                <thead>
                  <tr><th>Fecha</th><th>Emisor / folio</th><th className="hide-phone">Total</th><th className="hide-tablet">Vence</th><th>Estatus</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDay(row.invoice_date)}<small className="epp-muted show-phone">{formatMoney(row.total, row.currency)}</small></td>
                      <td>
                        <strong>{row.supplier_name ?? row.file_name}</strong><br />
                        <small className="epp-muted">{[row.folio && `Folio ${row.folio}`, row.supplier_rfc].filter(Boolean).join(" · ") || "Sin folio"}{row.has_text ? "" : " · PDF sin texto"}</small>
                      </td>
                      <td className="hide-phone"><strong>{formatMoney(row.total, row.currency)}</strong></td>
                      <td className="hide-tablet">{formatDay(row.due_date)}</td>
                      <td>
                        <StatusBadge invoice={row} today={today} />
                        {row.status === "pagada" && row.paid_on && <><br /><small className="epp-muted">{formatDay(row.paid_on)}</small></>}
                        {row.status === "incidente" && row.incident_description && (
                          <><br /><small className="epp-muted invoice-incident" title={row.incident_description}>{row.incident_description}</small></>
                        )}
                      </td>
                      <td className="row-actions">
                        <div className="epp-actions">
                          {canManage && row.status !== "pagada" && (
                            <button className="button button-gold" onClick={() => setDialog({ type: "pay", invoice: row })} disabled={busyId === row.id}><CheckCircle2 size={14} /> Marcar pagada</button>
                          )}
                          {canManage && row.status !== "pendiente" && (
                            <button className="button button-outline" onClick={() => void setStatus(row, { status: "pendiente" })} disabled={busyId === row.id}><RotateCcw size={14} /> Pendiente</button>
                          )}
                          {canManage && (
                            <button className="button button-outline" onClick={() => void markIncident(row)} disabled={busyId === row.id}>
                              <TriangleAlert size={14} /> {row.status === "incidente" ? "Editar incidente" : "Incidente"}
                            </button>
                          )}
                          <button className="button button-outline" onClick={() => setDialog({ type: "detail", invoice: row })}>{canManage ? <Pencil size={14} /> : <Receipt size={14} />} {canManage ? "Repasar" : "Ver"}</button>
                          <button className="button button-outline" onClick={() => void viewPdf(row)}><FileText size={14} /> PDF</button>
                          {canManage && (
                            <button className="icon-button row-edit" onClick={() => void remove(row)} disabled={busyId === row.id} aria-label="Eliminar factura" title="Eliminar"><Trash2 size={16} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="epp-empty">{invoices.length ? "Ninguna factura coincide con el filtro." : canManage ? "Aún no hay facturas. Carga la primera con «Cargar factura»." : "Aún no hay facturas."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <SummaryTable
            kind={tab}
            list={tab === "weekly" ? weekly : monthly}
            current={tab === "weekly" ? weekStart(today) : currentMonth}
            label={(key) => (tab === "weekly" ? weekLabel(key) : monthLabel(key))}
            exportButtons={<ExportButtons build={(by) => summaryReport(tab, tab === "weekly" ? weekly : monthly, by)} disabled={invoices.length === 0} />}
            onOpen={(key) => {
              // Abre la lista filtrada por el mes (en el semanal, el mes en que empieza la semana).
              setMonth(key.slice(0, 7));
              setFilter("all");
              setTab("list");
            }}
          />
        )}
      </section>

      {dialog?.type === "upload" && (
        <UploadModal
          onClose={() => setDialog(null)}
          onUploaded={(invoice, detected) => {
            notify("success", "Factura cargada", "Quedó como pendiente de pago.");
            setDialog({ type: "detail", invoice, detected });
            void load();
          }}
        />
      )}
      {dialog?.type === "detail" && (
        <InvoiceModal invoice={dialog.invoice} detected={dialog.detected} canEdit={canManage} onClose={() => setDialog(null)} onSaved={load} />
      )}
      {dialog?.type === "pay" && (
        <PayModal invoice={dialog.invoice} today={today} busy={busyId === dialog.invoice.id} onClose={() => setDialog(null)} onConfirm={(paidOn) => void setStatus(dialog.invoice, { status: "pagada", paidOn })} />
      )}
    </main>
  );
}

function SummaryTable({
  kind,
  list,
  current,
  label,
  exportButtons,
  onOpen,
}: {
  kind: "weekly" | "monthly";
  list: InvoiceSummary[];
  current: string;
  label: (key: string) => string;
  exportButtons: ReactNode;
  onOpen: (key: string) => void;
}) {
  return (
    <>
      <div className="directory-toolbar">
        <p className="epp-muted">
          {kind === "weekly" ? "Semanas de lunes a domingo, por fecha de la factura." : "Meses por fecha de la factura."} Los montos se suman por moneda.
        </p>
        {exportButtons}
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr>
              <th>{kind === "weekly" ? "Semana" : "Mes"}</th><th>Facturas</th><th className="hide-phone">Total facturado</th>
              <th>Pagado</th><th>Pendiente</th><th className="hide-tablet">Vencidas</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={item.key} className={item.key === current ? "invoice-current" : undefined}>
                <td>
                  <button type="button" className="text-button" onClick={() => onOpen(item.key)} title="Ver facturas">{label(item.key)}</button>
                  {item.key === current && <small className="epp-muted"> · {kind === "weekly" ? "semana actual" : "mes actual"}</small>}
                </td>
                <td>{item.count}</td>
                <td className="hide-phone"><strong>{formatTotals(item.total)}</strong></td>
                <td>{formatTotals(item.paid)}<br /><small className="epp-muted">{item.paidCount} pagada(s)</small></td>
                <td>{formatTotals(item.pending)}<br /><small className="epp-muted">{item.pendingCount} pendiente(s)</small></td>
                <td className="hide-tablet">{item.overdueCount ? <span className="fuel-status fuel-status-bad">{item.overdueCount}</span> : "—"}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6} className="epp-empty">Aún no hay facturas para resumir.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PayModal({ invoice, today, busy, onClose, onConfirm }: { invoice: Invoice; today: string; busy: boolean; onClose: () => void; onConfirm: (paidOn: string) => void }) {
  const [paidOn, setPaidOn] = useState(today);
  const invalid = !paidOn || paidOn > today;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form fuel-modal-small" role="dialog" aria-modal="true" aria-labelledby="invoice-pay-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><CheckCircle2 size={19} /></div>
          <div>
            <h2 id="invoice-pay-title">Marcar como pagada</h2>
            <p>{invoice.supplier_name ?? invoice.file_name}{invoice.folio ? ` · folio ${invoice.folio}` : ""} · <strong>{formatMoney(invoice.total, invoice.currency)}</strong></p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={(event) => { event.preventDefault(); if (!invalid) onConfirm(paidOn); }}>
          <Field label="Fecha de pago" required><input type="date" value={paidOn} max={today} onChange={(event) => setPaidOn(event.target.value)} /></Field>
          {paidOn > today && <p className="inline-error" role="alert">La fecha de pago no puede ser futura.</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy || invalid}><CheckCircle2 size={17} /> {busy ? "Guardando…" : "Confirmar pago"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
