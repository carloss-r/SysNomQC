"use client";

import { BadgeCheck, CalendarClock, CheckCircle2, Clock, FileCheck2, FileText, FileUp, Lock, PenLine, Receipt, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { plantToday } from "@/lib/fuels";
import {
  canDeleteInvoice,
  formatMoney,
  groupSummaries,
  INVOICE_STAGE_LABELS,
  invoiceStep,
  isPeriodClosed,
  PAYMENT_STATE_LABELS,
  paymentState,
  summarize,
  uploadedOn,
  weekStart,
  type Invoice,
  type InvoiceStep,
} from "@/lib/invoices";
import { describeQuery, matchesInvoiceQuery, parseInvoiceQuery } from "@/lib/invoice-search";
import { useAuth } from "@/features/auth/auth-provider";
import { addDays, formatDay } from "@/features/fuels/format";
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
import { activeFilterCount, EMPTY_FILTERS, filtersToQuery, FiltersDropdown, type InvoiceFilters } from "./filters-dropdown";

const SUBTITLE = "Finanzas · Facturas";

type Data = { today: string; invoices: Invoice[] };
type Dialog =
  | { type: "upload" }
  | { type: "detail"; invoice: Invoice; detected?: Detected }
  | { type: "step"; kind: StepKind; invoice: Invoice }
  | null;

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

function InvoicesScreen() {
  const { session, can, access } = useAuth();
  const notify = useNotify();
  const systemDialog = useDialog();
  const sessionRef = useRef(session);
  const canManage = can("invoices.manage");
  const isSuperAdmin = access?.is_super_admin === true;

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<InvoiceFilters>(EMPTY_FILTERS);
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
  const currentWeek = weekStart(today);
  const invoices = useMemo(() => data?.invoices ?? [], [data]);

  const stats = useMemo(() => {
    const open = invoices.filter((row) => invoiceStep(row) !== "cerrada");
    return {
      open: open.length,
      missingReceipt: open.filter((row) => invoiceStep(row) === "contrarecibo").length,
      missingComplement: open.filter((row) => invoiceStep(row) === "complemento").length,
      thisWeek: summarize(currentWeek, invoices.filter((row) => weekStart(uploadedOn(row)) === currentWeek)),
    };
  }, [invoices, currentWeek]);

  // Lo escrito en el buscador y lo elegido en el menú de filtros: la factura debe cumplir ambos.
  const parsed = useMemo(() => parseInvoiceQuery(query, today), [query, today]);
  const fromMenu = useMemo(() => filtersToQuery(filters), [filters]);
  const understood = useMemo(() => [...describeQuery(fromMenu), ...describeQuery(parsed)], [fromMenu, parsed]);
  const rows = useMemo(
    () => invoices.filter((row) => matchesInvoiceQuery(row, fromMenu) && matchesInvoiceQuery(row, parsed)),
    [invoices, fromMenu, parsed],
  );
  const result = useMemo(() => summarize("resultado", rows), [rows]);
  // Con un periodo de carga (menú o buscador): cómo va el cierre de ese periodo (todas sus facturas).
  const closingPeriod = fromMenu.period && fromMenu.dateField !== "invoice" ? fromMenu.period : parsed.period;
  const periodSummary = useMemo(() => {
    if (!closingPeriod) return null;
    const { from, to } = closingPeriod;
    return summarize("periodo", invoices.filter((row) => uploadedOn(row) >= from && uploadedOn(row) <= to));
  }, [invoices, closingPeriod]);
  const filtering = query.trim() !== "" || activeFilterCount(filters) > 0;

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
            : "Se pone en verde el cuadro 3. Después se pedirá el contrarecibo y luego el complemento de pago para cerrarla."}
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

  function listReport(generatedBy: string): Report {
    const weeks = groupSummaries(rows, weekStart);
    return {
      subtitle: SUBTITLE,
      title: "Relación de facturas",
      info: [["Búsqueda", understood.length ? understood.join(" · ") : "Todas"], ["Moneda", "MXN · moneda nacional"]],
      summary: [["Facturas", result.count], ["Total", formatMoney(result.total)], ["Falta complemento", result.missingComplement], ["Cerradas", result.closed]],
      sections: [
        {
          title: "Facturas",
          columns: [
            { header: "Folio", width: 12 }, { header: "Cargada", width: 12 }, { header: "Fecha factura", width: 12 }, { header: "UUID", width: 38 },
            { header: "Total", width: 16, align: "right" }, { header: "Estado", width: 20 }, { header: "Cierre", width: 18 },
          ],
          rows: rows.map((row) => [
            row.folio, formatDay(uploadedOn(row)), formatDay(row.invoice_date), row.uuid ?? "—", formatMoney(row.total), INVOICE_STAGE_LABELS[row.stage],
            PAYMENT_STATE_LABELS[paymentState(row)],
          ]),
          empty: "Sin facturas.",
        },
        {
          title: "Cierre por semana (de lunes a domingo, por día de carga)",
          columns: [
            { header: "Semana", width: 26 }, { header: "Cargadas", width: 10, align: "right" }, { header: "Total", width: 18, align: "right" },
            { header: "Falta complemento", width: 12, align: "right" }, { header: "Cerradas", width: 10, align: "right" }, { header: "Cierre", width: 14 },
          ],
          rows: weeks.map((item) => [
            weekLabel(item.key), item.count, formatMoney(item.total), item.missingComplement, item.closed,
            isPeriodClosed(item) ? "Cerrada" : `Faltan ${item.count - item.closed - item.incidents}`,
          ]),
          empty: "Sin facturas.",
        },
      ],
      generatedBy,
      fileName: "Facturas",
    };
  }

  const pending = (summary: { count: number; closed: number; incidents: number }) => summary.count - summary.closed - summary.incidents;

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="Finanzas"
        title="Facturas"
        description="Carga la factura en PDF y síguela paso a paso: firmada, cargada al sistema, contrarecibo y complemento de pago, con el que se cierra. Lo cargado no se modifica y cada paso queda en el historial."
        actions={canManage ? <button className="button button-gold" onClick={() => setDialog({ type: "upload" })}><FileUp size={17} /> Cargar factura</button> : undefined}
      >
        <div className="stats-grid">
          <StatCard label="En proceso" count={stats.open} tone="gold" icon={<Clock size={16} />} />
          <StatCard label="Falta contrarecibo" count={stats.missingReceipt} tone={stats.missingReceipt ? "gold" : "green"} icon={<CalendarClock size={16} />} />
          <StatCard label="Falta complemento" count={stats.missingComplement} tone={stats.missingComplement ? "gold" : "green"} icon={<BadgeCheck size={16} />} />
          <StatCard
            label={isPeriodClosed(stats.thisWeek) ? "Semana actual cerrada" : "Cerradas esta semana"}
            count={stats.thisWeek.closed}
            tone={isPeriodClosed(stats.thisWeek) ? "green" : "blue"}
            icon={<CheckCircle2 size={16} />}
          />
        </div>
      </PageHeader>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>Reintentar</button>
        </div>
      )}

      <section className="directory-card">
        <div className="invoice-search">
          <div className="invoice-search-row">
            <label className="search-box invoice-search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar folio, UUID, archivo… (también: falta complemento, semana pasada, noviembre, >5000)"
                aria-label="Buscar facturas"
                autoComplete="off"
              />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={15} /></button>}
            </label>
            <FiltersDropdown filters={filters} today={today} onChange={setFilters} />
            <ExportButtons build={listReport} disabled={rows.length === 0} />
          </div>
          {data && (
            <p className="invoice-understood">
              {understood.length ? <>Mostrando: <strong>{understood.join(" · ")}</strong> — </> : "Todas las facturas — "}
              {result.count} factura(s) · {formatMoney(result.total)} · {result.closed} cerrada(s){pending(result) ? ` · ${pending(result)} sin cerrar` : ""}
              {filtering && <> · <button type="button" className="text-button" onClick={() => { setQuery(""); setFilters(EMPTY_FILTERS); }}>Quitar todo</button></>}
            </p>
          )}
          {periodSummary && closingPeriod && (
            <div className={`invoice-period ${isPeriodClosed(periodSummary) ? "invoice-period-closed" : ""}`}>
              {isPeriodClosed(periodSummary) ? <Lock size={15} /> : <CalendarClock size={15} />}
              <span>
                <strong>Cargadas {closingPeriod.label}</strong>: {periodSummary.count} cargada(s) ·{" "}
                {periodSummary.closed} cerrada(s){periodSummary.missingComplement ? ` · ${periodSummary.missingComplement} falta complemento` : ""}
                {" · "}
                {periodSummary.count === 0 ? "sin facturas" : isPeriodClosed(periodSummary) ? <strong>periodo cerrado</strong> : <>faltan <strong>{pending(periodSummary)}</strong> por cerrar</>}
              </span>
            </div>
          )}
        </div>

        {!data ? (
          error ? <p className="epp-empty">No hay datos para mostrar.</p> : <LoadingState label="Cargando facturas…" rows={6} />
        ) : (
          <div className="table-scroll">
            <table className="employee-table">
              <thead>
                <tr><th>Folio</th><th className="hide-tablet">Fecha factura</th><th className="hide-phone">Total</th><th title="Cuadritos: 1 enviada · 2 firmada · 3 cargada al sistema. Verde = hecho, rojo = pendiente.">Estado <small className="epp-muted">(1 enviada · 2 firmada · 3 al sistema)</small></th><th>Cierre</th><th>Acciones</th></tr>
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
                              {step === "cerrada" && <span className="epp-muted invoice-lock" title="Cerrada (con complemento de pago)"><Lock size={14} /></span>}
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
                    <tr>
                      <td colSpan={6} className="epp-empty">
                        {invoices.length
                          ? <>Ninguna factura coincide con «{query.trim()}». <button type="button" className="text-button" onClick={() => setQuery("")}>Ver todas</button></>
                          : canManage ? "Aún no hay facturas. Carga la primera con «Cargar factura»." : "Aún no hay facturas."}
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
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
              notify("success", "Contrarecibo guardado", `Factura ${saved.folio}: ahora carga su complemento de pago para cerrarla.`);
            } else if (saved.complement_verified === false) {
              notify("error", `Factura ${saved.folio} cerrada`, "Ojo: el complemento no menciona el UUID de la factura. Revísalo.");
            } else {
              notify("success", `Factura ${saved.folio} cerrada`, saved.complement_verified ? "El complemento coincide con el UUID de la factura." : "No se pudo verificar el UUID (la factura o el complemento no lo traen).");
            }
            void load();
          }}
        />
      )}
    </main>
  );
}
