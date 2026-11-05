"use client";

import { AlertTriangle, Boxes, CalendarDays, ClipboardCheck, HardHat, History, Package, PackagePlus, Plus, Scale, UserSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EppArticle, EppEmployee, EppMovement } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { RequirePermission } from "@/shared/layout/require-permission";
import { StatCard } from "@/shared/ui/badges";
import { PageHeader } from "@/shared/ui/page-header";
import { ArticleModal } from "./article-modal";
import { EPP_CHANGED_EVENT } from "@/lib/notifications";
import { HistoryTab } from "./history-tab";
import { InventoryTab, stockState } from "./inventory-tab";
import { MonthlyTab } from "./monthly-tab";
import { MovementModal, type MovementKind } from "./movement-modal";
import { WorkersTab } from "./workers-tab";

type Dialog =
  | { type: "movement"; kind: MovementKind; articleId?: number; employee?: EppEmployee | null }
  | { type: "article"; article: EppArticle | null }
  | null;

export function EppView() {
  return (
    <RequirePermission permission="epp.view">
      <EppScreen />
    </RequirePermission>
  );
}

function EppScreen() {
  const { session, can } = useAuth();
  const sessionRef = useRef(session);
  const [articles, setArticles] = useState<EppArticle[]>([]);
  const [movements, setMovements] = useState<EppMovement[]>([]);
  const [employees, setEmployees] = useState<EppEmployee[]>([]);
  const [tab, setTab] = useState<"inventory" | "workers" | "monthly" | "history">("inventory");
  const [workerKey, setWorkerKey] = useState<string | null>(null);
  const [workerMonth, setWorkerMonth] = useState("");
  const [reportMonth, setReportMonth] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canDeliver = can("epp.deliver");
  const canManage = can("epp.manage");

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      const [items, moves] = await Promise.all([
        requestApi<EppArticle[]>(active, "/api/epp/articles"),
        requestApi<EppMovement[]>(active, "/api/epp/ledger"),
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // La lista de trabajadores solo se pide a quien puede entregar EPP.
  useEffect(() => {
    const active = sessionRef.current;
    if (!active || !canDeliver) return;
    requestApi<EppEmployee[]>(active, "/api/epp/employees")
      .then(setEmployees)
      .catch((err) => setError(describeError(err, "No se pudo cargar la lista de trabajadores.")));
  }, [canDeliver, session?.user.id]);

  const stats = useMemo(() => {
    const active = articles.filter((item) => item.active);
    const month = new Date().toISOString().slice(0, 7);
    return {
      articles: active.length,
      pieces: active.reduce((sum, item) => sum + item.stock, 0),
      low: active.filter((item) => stockState(item) !== "ok").length,
      delivered: movements
        .filter((row) => row.kind === "entrega" && row.moved_on.startsWith(month))
        .reduce((sum, row) => sum + Math.abs(row.delta), 0),
    };
  }, [articles, movements]);

  const categories = useMemo(() => Array.from(new Set(articles.map((item) => item.category))), [articles]);

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="Seguridad e higiene"
        title="Equipo de protección personal"
        description="Existencias, ingresos de material y entregas a trabajadores, con registro de quién y cuándo."
        actions={
          <div className="epp-header-actions">
            {canDeliver && <button className="button button-gold" onClick={() => setDialog({ type: "movement", kind: "entrega" })}><ClipboardCheck size={17} /> Entregar EPP</button>}
            {canManage && <button className="button button-outline" onClick={() => setDialog({ type: "movement", kind: "ingreso" })}><PackagePlus size={17} /> Ingreso de material</button>}
            {canManage && <button className="button button-outline" onClick={() => setDialog({ type: "movement", kind: "ajuste" })}><Scale size={17} /> Ajuste</button>}
            {canManage && <button className="button button-outline" onClick={() => setDialog({ type: "article", article: null })}><Plus size={17} /> Nuevo artículo</button>}
          </div>
        }
      >
        <div className="stats-grid">
          <StatCard label="Artículos activos" count={stats.articles} tone="green" icon={<HardHat size={16} />} />
          <StatCard label="Piezas en almacén" count={stats.pieces} tone="blue" icon={<Boxes size={16} />} />
          <StatCard label="Por reponer" count={stats.low} tone="gold" icon={<AlertTriangle size={16} />} />
          <StatCard label="Entregadas este mes" count={stats.delivered} tone="purple" icon={<Package size={16} />} />
        </div>
      </PageHeader>

      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button className="text-button" onClick={() => { setLoading(true); void load(); }}>Reintentar</button>
        </div>
      )}

      <section className="directory-card">
        <div className="directory-toolbar">
          <div className="site-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "inventory"} className={`site-tab${tab === "inventory" ? " active" : ""}`} onClick={() => setTab("inventory")}>
              <Boxes size={14} /> Inventario ({articles.length})
            </button>
            <button role="tab" aria-selected={tab === "workers"} className={`site-tab${tab === "workers" ? " active" : ""}`} onClick={() => setTab("workers")}>
              <UserSearch size={14} /> Por trabajador
            </button>
            <button role="tab" aria-selected={tab === "monthly"} className={`site-tab${tab === "monthly" ? " active" : ""}`} onClick={() => setTab("monthly")}>
              <CalendarDays size={14} /> Control mensual
            </button>
            <button role="tab" aria-selected={tab === "history"} className={`site-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
              <History size={14} /> Historial ({movements.length})
            </button>
          </div>
        </div>
        {loading ? (
          <p className="epp-empty">Cargando inventario…</p>
        ) : tab === "inventory" ? (
          <InventoryTab
            articles={articles}
            canDeliver={canDeliver}
            canManage={canManage}
            onDeliver={(articleId) => setDialog({ type: "movement", kind: "entrega", articleId })}
            onEntry={(articleId) => setDialog({ type: "movement", kind: "ingreso", articleId })}
            onEdit={(article) => setDialog({ type: "article", article })}
          />
        ) : tab === "workers" ? (
          <WorkersTab
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
            movements={movements}
            month={reportMonth}
            onMonth={setReportMonth}
            onOpenWorker={(key, month) => { setWorkerKey(key); setWorkerMonth(month); setTab("workers"); }}
          />
        ) : (
          <HistoryTab movements={movements} />
        )}
      </section>

      {dialog?.type === "movement" && (
        <MovementModal
          kind={dialog.kind}
          articles={articles}
          employees={employees}
          movements={movements}
          presetArticleId={dialog.articleId}
          presetEmployee={dialog.employee}
          onClose={() => setDialog(null)}
          onDone={load}
        />
      )}
      {dialog?.type === "article" && (
        <ArticleModal article={dialog.article} categories={categories} onClose={() => setDialog(null)} onSaved={load} />
      )}
    </main>
  );
}
