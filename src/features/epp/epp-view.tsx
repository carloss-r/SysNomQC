"use client";

import { AlertTriangle, Boxes, CalendarDays, ClipboardCheck, HardHat, History, MapPin, Package, PackagePlus, Plus, Scale, ShoppingCart, UserSearch } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EppArticle, EppEmployee, EppMovement, EppPurchaseRequest } from "@/lib/permissions";
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
import { downloadPurchasePdf } from "./purchase-pdf";
import { RequestModal } from "./request-modal";
import { RequestsTab } from "./requests-tab";
import { WorkersTab } from "./workers-tab";

type Tab = "inventory" | "workers" | "monthly" | "history" | "requests";

type Dialog =
  | { type: "movement"; kind: MovementKind; articleId?: number; employee?: EppEmployee | null; fromRequest?: EppPurchaseRequest }
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
  const canSeeRequests = canRequest || buyer || canManage;
  // Cuenta con sede asignada: solo su sede. SuperAdmin y cuentas sin sede eligen.
  const fixedSite = access?.is_super_admin ? null : (access?.site ?? null);
  const validRequested = (SITES as readonly string[]).includes(requestedSite ?? "") ? (requestedSite as string) : null;

  const [site, setSite] = useState<string>(fixedSite ?? validRequested ?? SITES[0]);
  const [articles, setArticles] = useState<EppArticle[]>([]);
  const [movements, setMovements] = useState<EppMovement[]>([]);
  const [employees, setEmployees] = useState<EppEmployee[]>([]);
  const [requests, setRequests] = useState<EppPurchaseRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(canSeeRequests);
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
      const [items, moves] = await Promise.all([
        requestApi<EppArticle[]>(active, `/api/epp/articles${query}`),
        requestApi<EppMovement[]>(active, `/api/epp/ledger${query}`),
      ]);
      setArticles(items);
      setMovements(moves);
      setError("");
      window.dispatchEvent(new Event(EPP_CHANGED_EVENT));
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
      setRequests(await requestApi<EppPurchaseRequest[]>(active, "/api/epp/requests"));
    } catch (err) {
      setError(describeError(err, "No se pudieron cargar las solicitudes de compra."));
    } finally {
      setRequestsLoading(false);
    }
  }, [canSeeRequests]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRequests(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRequests]);

  // La lista de trabajadores solo se pide a quien puede entregar EPP, y solo los de la sede elegida.
  useEffect(() => {
    const active = sessionRef.current;
    if (!active || !canDeliver) return;
    let cancelled = false;
    requestApi<EppEmployee[]>(active, `/api/epp/employees?site=${encodeURIComponent(site)}`)
      .then((rows) => { if (!cancelled) setEmployees(rows.filter((item) => item.site === site)); })
      .catch((err) => { if (!cancelled) setError(describeError(err, "No se pudo cargar la lista de trabajadores.")); });
    return () => { cancelled = true; };
  }, [canDeliver, session?.user.id, site]);

  function changeSite(next: string) {
    if (next === site) return;
    setLoading(true);
    setWorkerKey(null);
    setEmployees([]);
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
    const month = new Date().toISOString().slice(0, 7);
    return {
      articles: active.filter((item) => item.tracked).length,
      pieces: active.reduce((sum, item) => sum + item.stock, 0),
      low: active.filter((item) => stockState(item) === "out" || stockState(item) === "low").length,
      delivered: movements
        .filter((row) => row.kind === "entrega" && row.moved_on.startsWith(month))
        .reduce((sum, row) => sum + Math.abs(row.delta), 0),
    };
  }, [articles, movements]);

  const categories = useMemo(() => Array.from(new Set(articles.map((item) => item.category))), [articles]);

  async function changeStatus(request: EppPurchaseRequest, status: "en_compra" | "recibida" | "cancelada") {
    if (!session) return;
    if (
      status === "cancelada" &&
      !(await systemDialog.confirm({
        title: "Cancelar solicitud de compra",
        message: `¿Cancelar la solicitud folio ${request.id} de ${request.site}?`,
        confirmLabel: "Cancelar solicitud",
        cancelLabel: "Volver",
        tone: "danger",
      }))
    ) return;
    setBusyRequest(request.id);
    try {
      await requestApi(session, `/api/epp/requests/${request.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      const labels = { en_compra: "en compra", recibida: "recibida", cancelada: "cancelada" } as const;
      notify("success", `Solicitud ${labels[status]}`, `Folio ${request.id} · ${request.site}.`);
      await loadRequests();
      window.dispatchEvent(new Event(EPP_CHANGED_EVENT));
    } catch (err) {
      notify("error", "No se pudo actualizar la solicitud", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusyRequest(null);
    }
  }

  async function downloadPdf(list: EppPurchaseRequest[]) {
    try {
      await downloadPurchasePdf(list, access?.full_name || access?.email || "SysNomQC");
    } catch (err) {
      console.error("No se pudo generar el PDF:", err);
      notify("error", "No se pudo generar el PDF", "Inténtalo de nuevo.");
    }
  }

  function receive(request: EppPurchaseRequest) {
    if (request.site !== site) changeSite(request.site);
    setDialog({ type: "movement", kind: "ingreso", fromRequest: request });
  }

  const tabs: { key: Tab; label: string; icon: typeof Boxes; show: boolean }[] = [
    { key: "inventory", label: `Inventario (${articles.length})`, icon: Boxes, show: true },
    { key: "requests", label: `Solicitudes${openCount ? ` (${openCount})` : ""}`, icon: ShoppingCart, show: canSeeRequests },
    { key: "workers", label: "Por trabajador", icon: UserSearch, show: true },
    { key: "monthly", label: "Control mensual", icon: CalendarDays, show: true },
    { key: "history", label: `Historial (${movements.length})`, icon: History, show: true },
  ];

  const fromRequest = dialog?.type === "movement" ? dialog.fromRequest : undefined;

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
            requests={requests}
            loading={requestsLoading}
            buyer={buyer}
            canManage={canManage}
            canRequest={canRequest}
            busyId={busyRequest}
            onStatus={(request, status) => void changeStatus(request, status)}
            onReceive={receive}
            onPdf={(list) => void downloadPdf(list)}
            onNew={() => setDialog({ type: "request", articleIds: [] })}
          />
        ) : loading ? (
          <p className="epp-empty">Cargando inventario de {site}…</p>
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
            site={site}
            movements={movements}
            employees={employees}
            canDeliver={canDeliver}
            selectedKey={workerKey}
            month={workerMonth}
            onSelect={(key) => { setWorkerKey(key); setWorkerMonth(""); }}
            onMonth={setWorkerMonth}
            onDeliver={(employee) => setDialog({ type: "movement", kind: "entrega", employee })}
          />
        ) : tab === "monthly" ? (
          <MonthlyTab
            site={site}
            movements={movements}
            month={reportMonth}
            onMonth={setReportMonth}
            onOpenWorker={(key, month) => { setWorkerKey(key); setWorkerMonth(month); setTab("workers"); }}
          />
        ) : (
          <HistoryTab movements={movements} />
        )}
      </section>

      {dialog?.type === "movement" && !(fromRequest && (loading || fromRequest.site !== site)) && (
        <MovementModal
          key={fromRequest?.id ?? "manual"}
          site={site}
          kind={dialog.kind}
          articles={articles}
          employees={employees}
          movements={movements}
          presetArticleId={dialog.articleId}
          presetEmployee={dialog.employee}
          presetItems={fromRequest?.items.map((item) => ({ article_id: item.article_id, quantity: item.quantity }))}
          presetNotes={fromRequest ? `Llegada de la solicitud de compra folio ${fromRequest.id}` : undefined}
          onClose={() => setDialog(null)}
          onDone={async () => {
            if (fromRequest && session) {
              try {
                await requestApi(session, `/api/epp/requests/${fromRequest.id}`, { method: "PATCH", body: JSON.stringify({ status: "recibida" }) });
              } catch (err) {
                notify("warning", "El ingreso se guardó, pero la solicitud sigue abierta", describeError(err, "Márcala como recibida desde Solicitudes."));
              }
              await loadRequests();
            }
            await load();
          }}
        />
      )}
      {dialog?.type === "article" && (
        <ArticleModal site={site} article={dialog.article} categories={categories} onClose={() => setDialog(null)} onSaved={load} />
      )}
      {dialog?.type === "request" && (
        <RequestModal
          site={site}
          articles={articles}
          presetIds={dialog.articleIds}
          openRequests={openRequests}
          onClose={() => setDialog(null)}
          onDone={() => {
            void loadRequests();
            window.dispatchEvent(new Event(EPP_CHANGED_EVENT));
          }}
        />
      )}
    </main>
  );
}
