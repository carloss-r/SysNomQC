"use client";

import {
  BadgeCheck, CalendarClock, CalendarDays, CalendarRange, CheckCircle2, Clock, FileCheck2, FileText, FileUp, Lock, PenLine,
  Receipt, Search, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { plantToday } from "@/lib/fuels";
import {
  canDeleteInvoice,
  formatMoney,
  groupSummaries,
  INVOICE_STAGE_LABELS,
  invoiceStep,
  PAYMENT_STATE_LABELS,
  paymentState,
  summarize,
  uploadedOn,
  weekStart,
  type Invoice,
  type InvoiceStep,
  type InvoiceSummary,
} from "@/lib/invoices";
import { useAuth } from "@/features/auth/auth-provider";
import { addDays, formatDay, monthLabel } from "@/features/fuels/format";
import { RequirePermission } from "@/shared/layout/require-permission";
import { ExportButtons } from "@/shared/reports/export-buttons";
import type { Report } from "@/shared/reports/report-export";
import { StatCard } from "@/shared/ui/badges";
import { useNotify } from "@/shared/ui/notice-provider";
import { useDialog } from "@/shared/ui/dialog-provider";
import { PageHeader } from "@/shared/ui/page-header";
import { LoadingState, RowBusy, Spinner } from "@/shared/ui/loading";
import { openInvoiceFile } from "./files";
import { InvoiceModal } from "./invoice-modal";
import { PaymentBadge, StageSquares } from "./stage-badge";
import { StepModal, type StepKind } from "./step-modal";
import { UploadModal, type Detected } from "./upload-modal";

const SUBTITLE = "Finanzas · Facturas";

type Data = { today: string; invoices: Invoice[] };
type Tab = "list" | "weekly" | "monthly";
/** Filtro de la lista: por lo que le toca a cada factura. */
type Filter = "all" | "firmar" | "cargar" | "contrarecibo" | "por_cobrar" | "cobrada";
type Dialog =
  | { type: "upload" }
  | { type: "detail"; invoice: Invoice; detected?: Detected }
  | { type: "step"; kind: StepKind; invoice: Invoice }
  | null;

const FILTERS: [Filter, string][] = [
  ["all", "Todas"],
  ["firmar", "Por firmar"],
  ["cargar", "Por cargar al sistema"],
  ["contrarecibo", "Falta contrarecibo"],
  ["por_cobrar", "Por cobrar"],
  ["cobrada", "Cobradas"],
];

const STEP_TEXT: Record<InvoiceStep, string> = {
  firmar: "Por firmar",
  cargar: "Por cargar al sistema",
  contrarecibo: "Falta contrarecibo",
  complemento: "Falta complemento de pago",
  cerrada: "Cerrada",
};

export function InvoicesView() {
  return (
    <RequirePermission permission="invoices.view">
      <InvoicesScreen />
    </RequirePermission>
  );
}

const weekLabel = (monday: string) => `${formatDay(monday)} al ${formatDay(addDays(monday, 6))}`;

function matchesFilter(invoice: Invoice, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "firmar" || filter === "cargar" || filter === "contrarecibo") return invoiceStep(invoice) === filter;
  return invoice.status !== "incidente" && paymentState(invoice) === filter;
}

function InvoicesScreen() {
  const { session, can, access } = useAuth();
  const notify = useNotify();
  const systemDialog = useDialog();
  const sessionRef = useRef(session);
  const canManage = can("invoices.manage");
  const isSuperAdmin = access?.is_super_admin === true;

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [month, setMonth] = useState("");
  const [week, setWeek] = useState("");
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
  const currentWeek = weekStart(today);
  const invoices = useMemo(() => data?.invoices ?? [], [data]);

  const stats = useMemo(() => {
    const open = invoices.filter((row) => invoiceStep(row) !== "cerrada");
    const toCollect = open.filter((row) => paymentState(row) === "por_cobrar");
    const thisWeek = summarize(currentWeek, invoices.filter((row) => weekStart(uploadedOn(row)) === currentWeek));
    return {
      open: open.length,
      missingReceipt: open.filter((row) => invoiceStep(row) === "contrarecibo").length,
      toCollect: toCollect.length,
      toCollectAmount: toCollect.reduce((sum, row) => sum + (row.total ?? 0), 0),
      collectedThisMonth: invoices.filter((row) => row.complement_at && row.complement_at.slice(0, 7) === currentMonth).length,
      thisWeek,
    };
  }, [invoices, currentWeek, currentMonth]);

  const months = useMemo(() => Array.from(new Set(invoices.map((row) => uploadedOn(row).slice(0, 7)))).sort().reverse(), [invoices]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return invoices.filter((row) => {
      const day = uploadedOn(row);
      if (month && !day.startsWith(month)) return false;
      if (week && weekStart(day) !== week) return false;
      if (!matchesFilter(row, filter)) return false;
      if (!term) return true;
      return [row.folio, row.pdf_folio, row.uuid, row.file_name, row.receipt_name, row.complement_name].join(" ").toLowerCase().includes(term);
    });
  }, [invoices, query, month, week, filter]);

  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(([key]) => [key, invoices.filter((row) => matchesFilter(row, key)).length])) as Record<Filter, number>,
    [invoices],
  );

  const weekly = useMemo(() => groupSummaries(invoices, weekStart), [invoices]);
  const monthly = useMemo(() => groupSummaries(invoices, (day) => day.slice(0, 7)), [invoices]);

  // Cuadritos 2 y 3: firmada / autorizada y cargada al sistema. No se pueden deshacer.
  async function advanceStage(invoice: Invoice) {
    if (!session) return;
    const stage = invoice.stage === "enviada" ? "firmada" : "cargada";
    const ok = await systemDialog.confirm({
      title: stage === "firmada" ? "Marcar factura como firmada / autorizada" : "Marcar factura como cargada al sistema",
      message: (
        <>
          Factura <strong>{invoice.folio}</strong> · {formatDay(invoice.invoice_date)} · {formatMoney(invoice.total)}
          <br />
          {stage === "firmada"
            ? "Se pone en verde el cuadro 2. Después ya no se podrá eliminar la factura."
            : "Se pone en verde el cuadro 3. Después se pedirá el contrarecibo con la fecha posible de cobro."}
          <br />El paso queda registrado a tu nombre y no se puede deshacer.
        </>
      ),
      confirmLabel: stage === "firmada" ? "Marcar firmada" : "Marcar cargada al sistema",
    });
    if (!ok) return;
    setBusyId(invoice.id);
    try {
      await requestApi(session, `/api/invoices/${invoice.id}`, { method: "PATCH", body: JSON.stringify({ action: "stage", stage }) });
      notify("success", stage === "firmada" ? "Factura firmada / autorizada" : "Factura cargada al sistema", stage === "cargada" ? "Ahora carga su contrarecibo." : undefined);
      await load();
    } catch (err) {
      notify("error", "No se pudo registrar el paso", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(invoice: Invoice) {
    if (!session) return;
    const ok = await systemDialog.confirm({
      title: "Eliminar factura",
      message: `¿Eliminar la factura ${invoice.folio} (${invoice.file_name})? Se borran sus PDF y no se puede deshacer; en el historial queda registrado que se eliminó.`,
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

  function stepButton(row: Invoice): ReactNode {
    const step = invoiceStep(row);
    const busy = busyId === row.id;
    if (step === "firmar") return <button className="button button-outline" onClick={() => void advanceStage(row)} disabled={busy}><PenLine size={14} /> Firmada</button>;
    if (step === "cargar") return <button className="button button-outline" onClick={() => void advanceStage(row)} disabled={busy}><FileCheck2 size={14} /> Cargada al sistema</button>;
    if (step === "contrarecibo") return <button className="button button-outline" onClick={() => setDialog({ type: "step", kind: "receipt", invoice: row })} disabled={busy}><CalendarClock size={14} /> Contrarecibo</button>;
    if (step === "complemento") return <button className="button button-outline" onClick={() => setDialog({ type: "step", kind: "complement", invoice: row })} disabled={busy}><BadgeCheck size={14} /> Complemento</button>;
    return null;
  }

  const periodText = [month && monthLabel(month), week && `semana del ${weekLabel(week)}`].filter(Boolean).join(" · ") || "Todas";

  function listReport(generatedBy: string): Report {
    const summary = summarize("lista", rows);
    return {
      subtitle: SUBTITLE,
      title: "Relación de facturas",
      info: [["Cargadas", periodText], ["Filtro", FILTERS.find(([key]) => key === filter)?.[1] ?? "Todas"], ["Moneda", "MXN · moneda nacional"]],
      summary: [["Facturas", summary.count], ["Total", formatMoney(summary.total)], ["Por cobrar", formatMoney(summary.toCollect)], ["Cobradas", summary.collected]],
      sections: [{
        title: "Facturas",
        columns: [
          { header: "Folio", width: 12 }, { header: "Cargada", width: 12 }, { header: "Fecha factura", width: 12 }, { header: "UUID", width: 38 },
          { header: "Total", width: 16, align: "right" }, { header: "Estado", width: 20 }, { header: "Cobro previsto", width: 13 },
          { header: "Cobro", width: 18 },
        ],
        rows: rows.map((row) => [
          row.folio, formatDay(uploadedOn(row)), formatDay(row.invoice_date), row.uuid ?? "—", formatMoney(row.total), INVOICE_STAGE_LABELS[row.stage],
          row.payment_date ? formatDay(row.payment_date) : "—",
          PAYMENT_STATE_LABELS[paymentState(row)],
        ]),
        empty: "Sin facturas.",
      }],
      generatedBy,
      fileName: `Facturas_${month || week || "todas"}`,
    };
  }

  function summaryReport(kind: "weekly" | "monthly", list: InvoiceSummary[], generatedBy: string): Report {
    const label = (key: string) => (kind === "weekly" ? weekLabel(key) : monthLabel(key));
    return {
      subtitle: SUBTITLE,
      title: kind === "weekly" ? "Facturas por semana" : "Facturas por mes",
      info: [["Corte", formatDay(today)], ["Moneda", "MXN · moneda nacional"]],
      sections: [{
        title: kind === "weekly" ? "Por semana (lunes a domingo)" : "Por mes",
        columns: [
          { header: kind === "weekly" ? "Semana" : "Mes", width: 26 }, { header: "Cargadas", width: 10, align: "right" },
          { header: "Total cargado", width: 18, align: "right" }, { header: "Firmadas", width: 10, align: "right" },
          { header: "Al sistema", width: 10, align: "right" }, { header: "Contrarecibo", width: 12, align: "right" },
          { header: "Por cobrar", width: 18, align: "right" }, { header: "Cobradas", width: 10, align: "right" },
          { header: "Cobrado", width: 18, align: "right" },
        ],
        rows: list.map((item) => [
          label(item.key), item.count, formatMoney(item.total), item.signed, item.loaded, item.receipts,
          `${formatMoney(item.toCollect)} (${item.toCollectCount})`, item.collected, formatMoney(item.collectedAmount),
        ]),
        empty: "Sin facturas.",
      }],
      generatedBy,
      fileName: kind === "weekly" ? "Facturas_por_semana" : "Facturas_por_mes",
    };
  }

  const tabs: { key: Tab; label: string; icon: typeof Receipt }[] = [
    { key: "list", label: `Facturas (${invoices.length})`, icon: Receipt },
    { key: "weekly", label: "Por semana", icon: CalendarRange },
    { key: "monthly", label: "Por mes", icon: CalendarDays },
  ];

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="Finanzas"
        title="Facturas"
        description="Carga la factura en PDF y síguela paso a paso: firmada, cargada al sistema, contrarecibo (pasa a por cobrar) y complemento de pago (cobrada). Lo cargado no se modifica y cada paso queda en el historial."
        actions={canManage ? <button className="button button-gold" onClick={() => setDialog({ type: "upload" })}><FileUp size={17} /> Cargar factura</button> : undefined}
      >
        <div className="stats-grid">
          <StatCard label="En proceso" count={stats.open} tone="gold" icon={<Clock size={16} />} />
          <StatCard label="Falta contrarecibo" count={stats.missingReceipt} tone={stats.missingReceipt ? "gold" : "green"} icon={<CalendarClock size={16} />} />
          <StatCard label="Por cobrar" count={stats.toCollect} tone="blue" icon={<BadgeCheck size={16} />} />
          <StatCard label={`Cobradas en ${monthLabel(currentMonth)}`} count={stats.collectedThisMonth} tone="green" icon={<CheckCircle2 size={16} />} />
        </div>
        {data && (
          <p className="epp-muted fuel-today">
            Por cobrar: <strong>{formatMoney(stats.toCollectAmount)}</strong> ·
            Cargadas esta semana: {stats.thisWeek.count} ({formatMoney(stats.thisWeek.total)}) · Moneda nacional (MXN)
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
          <span className="invoice-legend-squares epp-muted">
            <span className="invoice-square invoice-square-done">✓</span> paso hecho · <span className="invoice-square invoice-square-todo">·</span> pendiente ·
            1 enviada · 2 firmada · 3 cargada al sistema
          </span>
        </div>

        {!data ? (
          error ? <p className="epp-empty">No hay datos para mostrar.</p> : <LoadingState label="Cargando facturas…" rows={6} />
        ) : tab === "list" ? (
          <>
            <div className="directory-toolbar invoice-filters">
              <div className="site-tabs" role="tablist">
                {FILTERS.map(([key, label]) => (
                  <button key={key} role="tab" aria-selected={filter === key} className={`site-tab${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>
                    {label}{key !== "all" && filterCounts[key] > 0 && <span className="site-count site-count-muted">{filterCounts[key]}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="directory-toolbar">
              <select className="invoice-month" value={month} onChange={(event) => { setMonth(event.target.value); setWeek(""); }} aria-label="Mes de carga">
                <option value="">Todos los meses</option>
                {months.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
              </select>
              {week && (
                <button type="button" className="site-tab active" onClick={() => setWeek("")} title="Quitar filtro de semana">
                  Semana del {weekLabel(week)} <X size={13} />
                </button>
              )}
              <label className="search-box">
                <Search size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar folio, UUID o archivo" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
              </label>
              <ExportButtons build={listReport} disabled={rows.length === 0} />
            </div>
            <div className="table-scroll">
              <table className="employee-table">
                <thead>
                  <tr><th>Folio</th><th className="hide-tablet">Fecha factura</th><th className="hide-phone">Total</th><th>Estado</th><th>Cobro</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const step = invoiceStep(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.folio}</strong><br />
                          <small className="epp-muted">Cargada {formatDay(uploadedOn(row))}{row.pdf_folio ? ` · PDF ${row.pdf_folio}` : ""}{row.has_text ? "" : " · PDF sin texto"}</small>
                          <small className="epp-muted show-phone">{formatMoney(row.total)}</small>
                        </td>
                        <td className="hide-tablet">{formatDay(row.invoice_date)}</td>
                        <td className="hide-phone"><strong>{formatMoney(row.total)}</strong></td>
                        <td><StageSquares invoice={row} /></td>
                        <td>
                          <div className="invoice-badges">
                            <PaymentBadge invoice={row} />
                            {step !== "cerrada" && <small className="epp-muted">{STEP_TEXT[step]}</small>}
                          </div>
                        </td>
                        <td className="row-actions invoice-row-actions">
                          <div className="invoice-actions">
                            {canManage && step !== "cerrada" && <div className="invoice-actions-main">{stepButton(row)}</div>}
                            <div className="invoice-actions-tools">
                              {busyId === row.id && <RowBusy />}
                              {step === "cerrada" && <span className="epp-muted invoice-lock" title="Cobrada y cerrada"><Lock size={14} /></span>}
                              <button className="icon-button" onClick={() => setDialog({ type: "detail", invoice: row })} aria-label="Ver factura" title="Ver factura, contrarecibo, complemento e historial"><Receipt size={16} /></button>
                              <button className="icon-button" onClick={() => void viewPdf(row)} aria-label="Abrir PDF" title="Abrir PDF de la factura"><FileText size={16} /></button>
                              {canManage && canDeleteInvoice(row, isSuperAdmin) && (
                                <button className="icon-button row-edit" onClick={() => void remove(row)} disabled={busyId === row.id} aria-label="Eliminar factura" title={row.stage === "enviada" ? "Eliminar (solo antes de firmarla)" : "Eliminar (Super administrador)"}>
                                  {busyId === row.id ? <Spinner /> : <Trash2 size={16} />}
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
            current={tab === "weekly" ? currentWeek : currentMonth}
            label={(key) => (tab === "weekly" ? weekLabel(key) : monthLabel(key))}
            exportButtons={<ExportButtons build={(by) => summaryReport(tab, tab === "weekly" ? weekly : monthly, by)} disabled={invoices.length === 0} />}
            onOpen={(key) => {
              // Abre la lista con las facturas cargadas en esa semana o ese mes.
              if (tab === "weekly") {
                setWeek(key);
                setMonth("");
              } else {
                setMonth(key);
                setWeek("");
              }
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
            notify("success", `Factura ${invoice.folio} cargada`, "Quedó como enviada. Revisa los datos leídos del PDF.");
            setDialog({ type: "detail", invoice, detected });
            void load();
          }}
        />
      )}
      {dialog?.type === "detail" && (
        <InvoiceModal invoice={dialog.invoice} detected={dialog.detected} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "step" && (
        <StepModal
          kind={dialog.kind}
          invoice={dialog.invoice}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            if (dialog.kind === "receipt") {
              notify("success", `Factura ${saved.folio} por cobrar`, `Contrarecibo guardado · cobro previsto el ${formatDay(saved.payment_date)}.`);
            } else if (saved.complement_verified === false) {
              notify("error", `Factura ${saved.folio} cobrada y cerrada`, "Ojo: el complemento no menciona el UUID de la factura. Revísalo.");
            } else {
              notify("success", `Factura ${saved.folio} cobrada y cerrada`, saved.complement_verified ? "El complemento coincide con el UUID de la factura." : "No se pudo verificar el UUID (la factura o el complemento no lo traen).");
            }
            void load();
          }}
        />
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
          {kind === "weekly" ? "Semanas de lunes a domingo." : "Meses."} Cuenta las facturas por el día en que se cargaron al sistema y muestra
          cuánto de ellas está por cobrar (ya con contrarecibo) y cuánto ya se cobró (con complemento).
        </p>
        {exportButtons}
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr>
              <th>{kind === "weekly" ? "Semana" : "Mes"}</th>
              <th>Cargadas</th>
              <th className="hide-tablet">Avance</th>
              <th>Por cobrar</th>
              <th className="hide-phone">Cobrado</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={item.key} className={item.key === current ? "invoice-current" : undefined}>
                <td>
                  <button type="button" className="text-button" onClick={() => onOpen(item.key)} title="Ver las facturas cargadas en este periodo" disabled={item.count === 0}>{label(item.key)}</button>
                  {item.key === current && <small className="epp-muted"> · {kind === "weekly" ? "semana actual" : "mes actual"}</small>}
                </td>
                <td><strong>{item.count}</strong><br /><small className="epp-muted">{formatMoney(item.total)}</small></td>
                <td className="hide-tablet">
                  <small className="invoice-progress">
                    {item.signed} firmadas · {item.loaded} al sistema · {item.receipts} con contrarecibo · {item.collected} cobradas
                  </small>
                </td>
                <td>{item.toCollectCount ? <>{formatMoney(item.toCollect)} <small className="epp-muted">({item.toCollectCount})</small></> : "—"}</td>
                <td className="hide-phone">{item.collected ? <>{formatMoney(item.collectedAmount)} <small className="epp-muted">({item.collected})</small></> : "—"}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="epp-empty">Aún no hay facturas para resumir.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
