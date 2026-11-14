"use client";

import { AlertTriangle, Boxes, CalendarDays, ClipboardCheck, HardHat, History, MapPin, Package, PackagePlus, Plus, Scale, ShoppingCart, UserSearch } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EppArticle, EppEmployee, EppMonthSummary, EppPurchaseRequest } from "@/lib/permissions";
import { SITES } from "@/lib/employees";
import { describeError, requestApi } from "@/lib/api-client";
import { EPP_CHANGED_EVENT } from "@/lib/notifications";
import { useAuth } from "@/features/auth/auth-provider";
import { RequirePermission } from "@/shared/layout/require-permission";
import { StatCard } from "@/shared/ui/badges";
import { useNotify } from "@/shared/ui/notice-provider";
import { useDialog } from "@/shared/ui/dialog-provider";
import { PageHeader } from "@/shared/ui/page-header";
import { ArticleModal } from "./article-modal";
import { HistoryTab } from "./history-tab";
import { InventoryTab, stockState } from "./inventory-tab";
import { MonthlyTab } from "./monthly-tab";
import { MovementModal, type MovementKind } from "./movement-modal";
import { BuyModal, CountModal } from "./purchase-modals";
import { downloadPurchasePdf } from "./purchase-pdf";
import { RequestModal } from "./request-modal";
import { RequestsTab } from "./requests-tab";
import { WorkersTab } from "./workers-tab";
import { LoadingState } from "@/shared/ui/loading";
import { todayLocal } from "./format";
import { useEppQuery } from "./use-epp-query";

const NO_EMPLOYEES: EppEmployee[] = [];

type Tab = "inventory" | "workers" | "monthly" | "history" | "requests";

type Dialog =
  | { type: "movement"; kind: MovementKind; articleId?: number; employee?: EppEmployee | null }
  | { type: "buy"; request: EppPurchaseRequest }
  | { type: "count"; request: EppPurchaseRequest }
  | { type: "article"; article: EppArticle | null }
  | { type: "request"; articleIds: number[] }
  | null;

// Los avisos enlazan con ?sede=…&tab=solicitudes; al cambiar la dirección la pantalla se vuelve a armar.
export function EppView() {
  const params = useSearchParams();
  return (
    <RequirePermission permission="epp.view">
      <EppScreen key={params.toString()} requestedSite={params.get("sede")} requestedTab={params.get("tab")} />
    </RequirePermission>
  );
}

function EppScreen({ requestedSite, requestedTab }: { requestedSite: string | null; requestedTab: string | null }) {
  const { session, can, access } = useAuth();
  const notify = useNotify();
  const systemDialog = useDialog();
  const sessionRef = useRef(session);
  const canDeliver = can("epp.deliver");
  const canManage = can("epp.manage");
  // Ajustar existencias sin respaldo físico queda reservado al SuperAdmin (la API y la base lo vuelven a validar).
  const canAdjust = canManage && access?.is_super_admin === true;
  const canRequest = can("epp.request");
  const buyer = can("epp.purchase");
  // Cualquiera que ve EPP consulta las solicitudes; las acciones dependen de cada permiso.
  const canSeeRequests = can("epp.view");
  // Cuenta con sede asignada: solo su sede. SuperAdmin y cuentas sin sede eligen.
  const fixedSite = access?.is_super_admin ? null : (access?.site ?? null);
  const validRequested = (SITES as readonly string[]).includes(requestedSite ?? "") ? (requestedSite as string) : null;

  const [site, setSite] = useState<string>(fixedSite ?? validRequested ?? SITES[0]);
  const [articles, setArticles] = useState<EppArticle[]>([]);
  // Totales por mes de la sede (calculados en la base). Ya no se descarga el libro de movimientos al entrar.
  const [summary, setSummary] = useState<EppMonthSummary[]>([]);
  const [employees, setEmployees] = useState<{ site: string; rows: EppEmployee[] } | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  // Solo solicitudes abiertas de todas las sedes (bloqueos "Pedido" y contadores); la lista completa
  // se pide al abrir la pestaña Solicitudes.
  const [requests, setRequests] = useState<EppPurchaseRequest[]>([]);
  /** Se incrementa tras cada cambio para que la pestaña abierta vuelva a pedir sus datos. */
  const [version, setVersion] = useState(0);
  const [busyRequest, setBusyRequest] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>(requestedTab === "solicitudes" && canSeeRequests ? "requests" : "inventory");
  const [workerKey, setWorkerKey] = useState<string | null>(null);
  const [workerMonth, setWorkerMonth] = useState("");
  const [reportMonth, setReportMonth] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      const query = `?site=${encodeURIComponent(site)}`;
      const [items, months] = await Promise.all([
        requestApi<EppArticle[]>(active, `/api/epp/articles${query}`),
        requestApi<EppMonthSummary[]>(active, `/api/epp/summary${query}`),
      ]);
      setArticles(items);
      setSummary(months);
      setError("");
    } catch (err) {
      setError(describeError(err, "No se pudo cargar el inventario de EPP."));
    } finally {
      setLoading(false);
    }
  }, [site]);

  const loadRequests = useCallback(async () => {
    const active = sessionRef.current;
    if (!active || !canSeeRequests) return;
    try {
      setRequests(await requestApi<EppPurchaseRequest[]>(active, "/api/epp/requests?open=1"));
    } catch (err) {
      setError(describeError(err, "No se pudieron cargar las solicitudes de compra."));
    }
  }, [canSeeRequests]);

  /** Tras registrar algo: se recarga lo visible y se avisa a la campana (solo entonces, no en cada carga). */
  const afterChange = useCallback(async (withRequests = false) => {
    setVersion((value) => value + 1);
    await Promise.all([load(), withRequests ? loadRequests() : Promise.resolve()]);
    window.dispatchEvent(new Event(EPP_CHANGED_EVENT));
  }, [load, loadRequests]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRequests(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  // La lista de trabajadores se pide solo cuando hace falta (al entregar o en "Por trabajador"),
  // una vez por sede, y solo a quien puede entregar EPP.
  const needEmployees = canDeliver && (tab === "workers" || (dialog?.type === "movement" && dialog.kind === "entrega"));
  const haveEmployees = employees?.site === site;
  useEffect(() => {
    const active = sessionRef.current;
    if (!active || !needEmployees || haveEmployees) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setEmployeesLoading(true);
      requestApi<EppEmployee[]>(active, `/api/epp/employees?site=${encodeURIComponent(site)}`)
        .then((rows) => { if (!cancelled) setEmployees({ site, rows: rows.filter((item) => item.site === site) }); })
        .catch((err) => { if (!cancelled) setError(describeError(err, "No se pudo cargar la lista de trabajadores.")); })
        .finally(() => { if (!cancelled) setEmployeesLoading(false); });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needEmployees, haveEmployees, site]);
  const siteEmployees = haveEmployees ? employees.rows : NO_EMPLOYEES;

  // Lista completa de solicitudes de la sede: solo con la pestaña Solicitudes abierta.
  const siteRequests = useEppQuery<EppPurchaseRequest[]>(
    tab === "requests" && canSeeRequests ? `/api/epp/requests?site=${encodeURIComponent(site)}` : null,
    version,
  );

  function changeSite(next: string) {
    if (next === site) return;
    setLoading(true);
    setWorkerKey(null);
    setSite(next);
  }

  const openRequests = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of requests) {
      if (row.site !== site || (row.status !== "pendiente" && row.status !== "en_compra")) continue;
      for (const item of row.items) map.set(item.article_id, row.id);
    }
    return map;
  }, [requests, site]);
  // Solicitudes abiertas por sede: la pestaña cuenta solo la sede elegida y cada sede muestra las suyas.
  const openBySite = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of requests) if (row.status === "pendiente" || row.status === "en_compra") counts[row.site] = (counts[row.site] ?? 0) + 1;
    return counts;
  }, [requests]);
  const openCount = openBySite[site] ?? 0;

  const stats = useMemo(() => {
    const active = articles.filter((item) => item.active);
    const month = todayLocal().slice(0, 7);
    return {
      articles: active.filter((item) => item.tracked).length,
      pieces: active.reduce((sum, item) => sum + item.stock, 0),
      low: active.filter((item) => stockState(item) === "out" || stockState(item) === "low").length,
      delivered: summary.find((row) => row.month === month)?.delivered ?? 0,
    };
  }, [articles, summary]);
  const monthsWithData = useMemo(() => summary.filter((row) => row.movements > 0).map((row) => row.month), [summary]);

  const categories = useMemo(() => Array.from(new Set(articles.map((item) => item.category))), [articles]);

  async function cancelRequest(request: EppPurchaseRequest) {
    if (!session) return;
    const ok = await systemDialog.confirm({
      title: "Cancelar solicitud de compra",
      message: `¿Cancelar la solicitud folio ${request.id} de ${request.site}?`,
      confirmLabel: "Cancelar solicitud",
      cancelLabel: "Volver",
      tone: "danger",
    });
    if (!ok) return;
    setBusyRequest(request.id);
    try {
      await requestApi(session, `/api/epp/requests/${request.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) });
      notify("success", "Solicitud cancelada", `Folio ${request.id} · ${request.site}.`);
      await afterChange(true);
    } catch (err) {
      notify("error", "No se pudo cancelar la solicitud", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusyRequest(null);
    }
  }

  async function ackShortage(request: EppPurchaseRequest) {
    if (!session) return;
    setBusyRequest(request.id);
    try {
      await requestApi(session, `/api/epp/requests/${request.id}/ack`, { method: "POST", body: "{}" });
      notify("success", "Faltante revisado", `Folio ${request.id} · el aviso ya no aparecerá.`);
      await afterChange(true);
    } catch (err) {
      notify("error", "No se pudo marcar el aviso", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusyRequest(null);
    }
  }

  /** Tras registrar una compra o un conteo cambian solicitudes, existencias y bloqueos. */
  async function afterPurchaseChange() {
    await afterChange(true);
  }

  async function downloadPdf(list: EppPurchaseRequest[]) {
    try {
      await downloadPurchasePdf(list, access?.full_name || access?.email || "SysNomQC");
    } catch (err) {
      console.error("No se pudo generar el PDF:", err);
      notify("error", "No se pudo generar el PDF", "Inténtalo de nuevo.");
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof Boxes; show: boolean }[] = [
    { key: "inventory", label: `Inventario (${articles.length})`, icon: Boxes, show: true },
    { key: "requests", label: `Solicitudes${openCount ? ` (${openCount})` : ""}`, icon: ShoppingCart, show: canSeeRequests },
    { key: "workers", label: "Por trabajador", icon: UserSearch, show: true },
    { key: "monthly", label: "Control mensual", icon: CalendarDays, show: true },
    { key: "history", label: "Historial", icon: History, show: true },
  ];

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="Seguridad e higiene"
        title="Equipo de protección personal"
        description="Existencias por sede, entregas a trabajadores y solicitudes de compra, con registro de quién y cuándo."
        actions={
          <div className="epp-header-actions">
            {canDeliver && <button className="button button-gold" onClick={() => setDialog({ type: "movement", kind: "entrega" })}><ClipboardCheck size={17} /> Entregar EPP</button>}
            {canRequest && <button className="button button-outline" onClick={() => setDialog({ type: "request", articleIds: [] })}><ShoppingCart size={17} /> Pedir material</button>}
            {canManage && <button className="button button-outline" onClick={() => setDialog({ type: "movement", kind: "ingreso" })}><PackagePlus size={17} /> Ingreso de material</button>}
            {canAdjust && <button className="button button-outline" onClick={() => setDialog({ type: "movement", kind: "ajuste" })}><Scale size={17} /> Ajuste</button>}
            {canManage && <button className="button button-outline" onClick={() => setDialog({ type: "article", article: null })}><Plus size={17} /> Nuevo artículo</button>}
          </div>
        }
      >
        <div className="epp-site-bar">
          <MapPin size={16} />
          {fixedSite ? (
            <span>Inventario de <strong>{fixedSite}</strong></span>
          ) : (
            <div className="site-tabs" role="group" aria-label="Sede del inventario">
              {SITES.map((item) => (
                <button key={item} type="button" aria-pressed={site === item} className={`site-tab${site === item ? " active" : ""}`} onClick={() => changeSite(item)}>
                  {item}
                  {canSeeRequests && (openBySite[item] ?? 0) > 0 && (
                    <span className="site-count" title={`${openBySite[item]} solicitud(es) de compra abiertas`}>{openBySite[item]}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="stats-grid">
          <StatCard label="Artículos en la sede" count={stats.articles} tone="green" icon={<HardHat size={16} />} />
          <StatCard label="Piezas en almacén" count={stats.pieces} tone="blue" icon={<Boxes size={16} />} />
          <StatCard label="Por reponer" count={stats.low} tone="gold" icon={<AlertTriangle size={16} />} />
          <StatCard label="Entregadas este mes" count={stats.delivered} tone="purple" icon={<Package size={16} />} />
        </div>
      </PageHeader>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button className="text-button" onClick={() => { setLoading(true); void load(); void loadRequests(); }}>Reintentar</button>
        </div>
      )}

      <section className="directory-card">
        <div className="directory-toolbar">
          <div className="site-tabs" role="tablist">
            {tabs.filter((item) => item.show).map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.key} role="tab" aria-selected={tab === item.key} className={`site-tab${tab === item.key ? " active" : ""}`} onClick={() => setTab(item.key)}>
                  <Icon size={14} /> {item.label}
                </button>
              );
            })}
          </div>
        </div>
        {tab === "requests" ? (
          <RequestsTab
            site={site}
            requests={siteRequests.data ?? []}
            loading={siteRequests.loading && !siteRequests.data}
            buyer={buyer}
            canManage={canManage}
            canRequest={canRequest}
            superAdmin={access?.is_super_admin === true}
            busyId={busyRequest}
            onCancel={(request) => void cancelRequest(request)}
            onBuy={(request) => setDialog({ type: "buy", request })}
            onCount={(request) => setDialog({ type: "count", request })}
            onAck={(request) => void ackShortage(request)}
            onPdf={(list) => void downloadPdf(list)}
            onNew={() => setDialog({ type: "request", articleIds: [] })}
          />
        ) : loading ? (
          <LoadingState label={`Cargando inventario de ${site}…`} rows={6} />
        ) : tab === "inventory" ? (
          <InventoryTab
            site={site}
            articles={articles}
            openRequests={openRequests}
            canDeliver={canDeliver}
            canManage={canManage}
            canRequest={canRequest}
            onDeliver={(articleId) => setDialog({ type: "movement", kind: "entrega", articleId })}
            onEntry={(articleId) => setDialog({ type: "movement", kind: "ingreso", articleId })}
            onEdit={(article) => setDialog({ type: "article", article })}
            onRequest={(articleIds) => setDialog({ type: "request", articleIds })}
          />
        ) : tab === "workers" ? (
          <WorkersTab
            key={site}
            site={site}
            version={version}
            employees={siteEmployees}
            canDeliver={canDeliver}
            selectedKey={workerKey}
            month={workerMonth}
            onSelect={(key) => { setWorkerKey(key); setWorkerMonth(""); }}
            onMonth={setWorkerMonth}
            onDeliver={(employee) => setDialog({ type: "movement", kind: "entrega", employee })}
          />
        ) : tab === "monthly" ? (
          <MonthlyTab
            key={site}
            site={site}
            version={version}
            monthsWithData={monthsWithData}
            month={reportMonth}
            onMonth={setReportMonth}
            onOpenWorker={(key, month) => { setWorkerKey(key); setWorkerMonth(month); setTab("workers"); }}
          />
        ) : (
          <HistoryTab key={site} site={site} version={version} />
        )}
      </section>

      {dialog?.type === "movement" && (
        <MovementModal
          site={site}
          kind={dialog.kind}
          articles={articles}
          employees={siteEmployees}
          employeesLoading={employeesLoading}
          presetArticleId={dialog.articleId}
          presetEmployee={dialog.employee}
          onClose={() => setDialog(null)}
          onDone={() => afterChange()}
        />
      )}
      {dialog?.type === "buy" && <BuyModal request={dialog.request} onClose={() => setDialog(null)} onDone={afterPurchaseChange} />}
      {dialog?.type === "count" && <CountModal request={dialog.request} onClose={() => setDialog(null)} onDone={afterPurchaseChange} />}
      {dialog?.type === "article" && (
        <ArticleModal site={site} article={dialog.article} categories={categories} onClose={() => setDialog(null)} onSaved={() => afterChange()} />
      )}
      {dialog?.type === "request" && (
        <RequestModal
          site={site}
          articles={articles}
          presetIds={dialog.articleIds}
          openRequests={openRequests}
          onClose={() => setDialog(null)}
          onDone={() => void afterChange(true)}
        />
      )}
    </main>
  );
}
