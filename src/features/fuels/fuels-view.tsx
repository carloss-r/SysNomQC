"use client";

import { Building2, CalendarDays, CalendarPlus, Factory, Fuel, Leaf, Plus, Receipt, Scale, ShieldAlert, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import {
  chlorineState,
  computeMonth,
  fmt,
  netTons,
  permitState,
  plantToday,
  supplierApproved,
  type FuelCoke,
  type FuelProduct,
  type FuelReception,
  type FuelSchedule,
  type FuelSupplier,
} from "@/lib/fuels";
import { DATA_CHANGED_EVENT } from "@/lib/notifications";
import { useAuth } from "@/features/auth/auth-provider";
import { RequirePermission } from "@/shared/layout/require-permission";
import { StatCard } from "@/shared/ui/badges";
import { PageHeader } from "@/shared/ui/page-header";
import { downloadCertificatePdf } from "./certificate-pdf";
import { CommercialTab } from "./commercial-tab";
import { CokeModal, EcologyTab } from "./ecology-tab";
import { EntryModal, ExitModal } from "./scale-modals";
import { ScaleTab } from "./scale-tab";
import { ScheduleModal } from "./schedule-modal";
import { ScheduleTab } from "./schedule-tab";
import { SemaphoreCard } from "./semaphore";
import { SupplierModal } from "./supplier-modal";
import { SuppliersTab } from "./suppliers-tab";
import { useNotify } from "@/shared/ui/notice-provider";

type Data = { today: string; suppliers: FuelSupplier[]; schedule: FuelSchedule[]; receptions: FuelReception[]; coke: FuelCoke[] };
type Tab = "suppliers" | "schedule" | "scale" | "commercial" | "ecology";
type Dialog =
  | { type: "supplier"; supplier: FuelSupplier | null }
  | { type: "schedule" }
  | { type: "entry" }
  | { type: "exit"; reception: FuelReception }
  | { type: "closed"; reception: FuelReception }
  | { type: "coke"; month?: string }
  | null;

export function FuelsView() {
  return (
    <RequirePermission permission="fuels.view">
      <FuelsScreen />
    </RequirePermission>
  );
}

function FuelsScreen() {
  const { session, can, access } = useAuth();
  const notify = useNotify();
  const sessionRef = useRef(session);
  const canSuppliers = can("fuels.suppliers");
  const canSchedule = can("fuels.schedule");
  const canScale = can("fuels.scale");
  const canCommercial = can("fuels.commercial");
  const canEcology = can("fuels.ecology");

  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>(canScale ? "scale" : canSchedule ? "schedule" : canEcology ? "ecology" : "suppliers");
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      setData(await requestApi<Data>(active, "/api/fuels/data"));
      setError("");
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    } catch (err) {
      setError(describeError(err, "No se pudo cargar el módulo de combustibles alternos."));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const today = data?.today ?? plantToday();
  const suppliers = useMemo(() => data?.suppliers ?? [], [data]);
  const schedule = useMemo(() => data?.schedule ?? [], [data]);
  const receptions = useMemo(() => data?.receptions ?? [], [data]);
  const coke = useMemo(() => data?.coke ?? [], [data]);
  const products = useMemo(() => new Map<number, FuelProduct>(suppliers.flatMap((item) => item.products.map((product) => [product.id, product] as const))), [suppliers]);
  const summary = useMemo(() => computeMonth(today.slice(0, 7), receptions, schedule, products, coke), [today, receptions, schedule, products, coke]);

  const stats = useMemo(() => {
    const approved = suppliers.filter((item) => supplierApproved(item, today));
    return {
      approved: approved.length,
      expiring: suppliers.filter((item) => item.status === "aprobado" && permitState(item.permit_valid_until, today).state !== "vigente").length,
      inPlant: receptions.filter((row) => row.status === "en_planta").length,
      todayTons: receptions.filter((row) => row.status === "cerrado" && row.received_on === today).reduce((sum, row) => sum + netTons(row), 0),
      agenda: schedule.filter((row) => row.scheduled_on === today && row.status === "programado").length,
    };
  }, [suppliers, receptions, schedule, today]);

  async function printCertificate(reception: FuelReception) {
    try {
      await downloadCertificatePdf(reception, chlorineState(reception, receptions, today), access?.full_name || access?.email || "SysNomQC");
    } catch (err) {
      console.error("No se pudo generar el certificado:", err);
      notify("error", "No se pudo generar el certificado", "Inténtalo de nuevo.");
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof Building2; show: boolean }[] = [
    { key: "suppliers", label: `M1 · Proveedores (${suppliers.length})`, icon: Building2, show: true },
    { key: "schedule", label: "M2 · Programación", icon: CalendarDays, show: true },
    { key: "scale", label: `M3 · Báscula${stats.inPlant ? ` (${stats.inPlant} en planta)` : ""}`, icon: Scale, show: true },
    { key: "commercial", label: "M4 · Comercial", icon: Receipt, show: canCommercial },
    { key: "ecology", label: "M5 · Ecología", icon: Leaf, show: true },
  ];

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="Ecología"
        title="Combustibles alternos"
        description="Homologación de proveedores, agenda, báscula, contabilidad y sustitución térmica del horno con el límite SEMARNAT del 30 %."
        actions={
          <div className="epp-header-actions">
            {canScale && <button className="button button-gold" onClick={() => setDialog({ type: "entry" })}><Truck size={17} /> Capturar entrada</button>}
            {canSchedule && <button className="button button-outline" onClick={() => setDialog({ type: "schedule" })}><CalendarPlus size={17} /> Programar recepción</button>}
            {canSuppliers && <button className="button button-outline" onClick={() => setDialog({ type: "supplier", supplier: null })}><Plus size={17} /> Nuevo proveedor</button>}
            {canEcology && <button className="button button-outline" onClick={() => setDialog({ type: "coke" })}><Fuel size={17} /> Consumo de coque</button>}
          </div>
        }
      >
        {data && <SemaphoreCard summary={summary} onCaptureCoke={canEcology ? () => setDialog({ type: "coke", month: today.slice(0, 7) }) : undefined} />}
        <div className="stats-grid">
          <StatCard label="Proveedores aprobados" count={stats.approved} tone="green" icon={<Factory size={16} />} />
          <StatCard label="Permisos por vencer o vencidos" count={stats.expiring} tone={stats.expiring ? "red" : "gold"} icon={<ShieldAlert size={16} />} />
          <StatCard label="Programadas hoy" count={stats.agenda} tone="blue" icon={<CalendarDays size={16} />} />
          <StatCard label="Unidades en planta" count={stats.inPlant} tone="purple" icon={<Truck size={16} />} />
        </div>
        {stats.todayTons > 0 && <p className="epp-muted fuel-today">Recibido hoy: {fmt(stats.todayTons, 3)} t</p>}
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
        {!data ? (
          <p className="epp-empty">{error ? "No hay datos para mostrar." : "Cargando combustibles alternos…"}</p>
        ) : tab === "suppliers" ? (
          <SuppliersTab suppliers={suppliers} today={today} canEdit={canSuppliers} onEdit={(supplier) => setDialog({ type: "supplier", supplier })} />
        ) : tab === "schedule" ? (
          <ScheduleTab today={today} schedule={schedule} suppliers={suppliers} products={products} canEdit={canSchedule} onChanged={load} />
        ) : tab === "scale" ? (
          <ScaleTab today={today} receptions={receptions} canOperate={canScale} canLab={canScale || canSuppliers} onExit={(reception) => setDialog({ type: "exit", reception })} onChanged={load} />
        ) : tab === "commercial" ? (
          <CommercialTab today={today} suppliers={suppliers} receptions={receptions} onChanged={load} />
        ) : (
          <EcologyTab today={today} receptions={receptions} schedule={schedule} products={products} coke={coke} canEdit={canEcology} onCoke={(month) => setDialog({ type: "coke", month })} />
        )}
      </section>

      {dialog?.type === "supplier" && <SupplierModal supplier={dialog.supplier} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.type === "schedule" && (
        <ScheduleModal today={today} suppliers={suppliers} schedule={schedule} receptions={receptions} coke={coke} products={products} onClose={() => setDialog(null)} onSaved={load} />
      )}
      {dialog?.type === "entry" && (
        <EntryModal today={today} schedule={schedule} suppliers={suppliers} products={products} onClose={() => setDialog(null)} onSaved={async () => { setTab("scale"); await load(); }} />
      )}
      {dialog?.type === "exit" && (
        <ExitModal
          reception={dialog.reception}
          receptions={receptions}
          today={today}
          onClose={() => setDialog(null)}
          onClosed={async (closed) => {
            setDialog({ type: "closed", reception: closed });
            await load();
          }}
        />
      )}
      {dialog?.type === "closed" && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <section className="modal fuel-modal-small fuel-closed" role="dialog" aria-modal="true" aria-labelledby="fuel-closed-title">
            <h2 id="fuel-closed-title">Ticket {dialog.reception.id} cerrado</h2>
            <p>
              {dialog.reception.generator_name} · manifiesto {dialog.reception.manifest_folio}<br />
              Neto <strong>{fmt(dialog.reception.net_kg, 0)} kg</strong> ({fmt(netTons(dialog.reception), 3)} t)
            </p>
            <div className="modal-actions">
              <button className="button button-neutral" onClick={() => setDialog(null)}>Cerrar</button>
              <button className="button button-gold" onClick={() => void printCertificate(receptions.find((row) => row.id === dialog.reception.id && row.status === "cerrado") ?? dialog.reception)}>
                Imprimir certificado PDF
              </button>
            </div>
          </section>
        </div>
      )}
      {dialog?.type === "coke" && <CokeModal today={today} coke={coke} presetMonth={dialog.month} onClose={() => setDialog(null)} onSaved={load} />}
    </main>
  );
}
