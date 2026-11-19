"use client";

import { CalendarPlus, Fuel, Plus, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { CommercialTab } from "@/features/fuels/commercial-tab";
import { EcologyTab } from "@/features/fuels/ecology-tab";
import { ScaleTab } from "@/features/fuels/scale-tab";
import { ScheduleTab } from "@/features/fuels/schedule-tab";
import { SemaphoreCard } from "@/features/fuels/semaphore";
import { SuppliersTab } from "@/features/fuels/suppliers-tab";
import { LoadingState } from "@/shared/ui/loading";
import { useFuels } from "./fuels-data";

// ---------------------------------------------------------------------------
// Marco común de cada pantalla del SCA
// ---------------------------------------------------------------------------
function Screen({ code, title, description, actions, children }: { code: string; title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  const { loaded, error, reload } = useFuels();
  return (
    <main className="sca-screen">
      <header className="sca-screen-head">
        <div>
          <p className="sca-kicker">{code}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions && <div className="sca-screen-actions">{actions}</div>}
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button className="text-button" onClick={() => void reload()}>Reintentar</button>
        </div>
      )}
      {!loaded ? (
        <section className="sca-panel">{error ? <p className="epp-empty">No hay datos para mostrar.</p> : <LoadingState label="Cargando datos…" rows={6} />}</section>
      ) : (
        children
      )}
    </main>
  );
}

function Denied() {
  return <div className="error-banner" role="alert">Tu rol no tiene permiso para ver esta pantalla.</div>;
}

// ---------------------------------------------------------------------------
// Pantallas de cada módulo (misma lógica que las pestañas del módulo original)
// ---------------------------------------------------------------------------
export function ScaleScreen() {
  const { today, receptions, perms, open, reload, stats } = useFuels();
  return (
    <Screen
      code="M3 · Manifiestos y báscula"
      title="Báscula"
      description="Entrada con peso bruto, salida con tara y cierre irreversible del ticket. El neto alimenta el semáforo del mes."
      actions={perms.scale && <button className="button button-gold" onClick={() => open({ type: "entry" })}><Truck size={17} /> Capturar entrada{stats.inPlant ? ` · ${stats.inPlant} en planta` : ""}</button>}
    >
      <section className="sca-panel">
        <ScaleTab today={today} receptions={receptions} canOperate={perms.scale} canLab={perms.scale || perms.suppliers} onExit={(reception) => open({ type: "exit", reception })} onChanged={reload} />
      </section>
    </Screen>
  );
}

export function ScheduleScreen() {
  const { today, schedule, suppliers, products, perms, open, reload } = useFuels();
  return (
    <Screen
      code="M2 · Programación logística"
      title="Programación"
      description="Agenda de recepciones solo con proveedores aprobados y vigentes, con bloqueo predictivo del límite del 30 %."
      actions={perms.schedule && <button className="button button-gold" onClick={() => open({ type: "schedule" })}><CalendarPlus size={17} /> Programar recepción</button>}
    >
      <section className="sca-panel">
        <ScheduleTab today={today} schedule={schedule} suppliers={suppliers} products={products} canEdit={perms.schedule} onChanged={reload} />
      </section>
    </Screen>
  );
}

export function SuppliersScreen() {
  const { today, suppliers, perms, open } = useFuels();
  return (
    <Screen
      code="M1 · Proveedores y expedientes"
      title="Proveedores"
      description="Homologación con permiso SEMARNAT vigente y análisis químico dentro de los candados de calidad."
      actions={perms.suppliers && <button className="button button-gold" onClick={() => open({ type: "supplier", supplier: null })}><Plus size={17} /> Nuevo proveedor</button>}
    >
      <section className="sca-panel">
        <SuppliersTab suppliers={suppliers} today={today} canEdit={perms.suppliers} onEdit={(supplier) => open({ type: "supplier", supplier })} />
      </section>
    </Screen>
  );
}

export function CommercialScreen() {
  const { today, suppliers, receptions, perms, reload } = useFuels();
  return (
    <Screen code="M4 · Comercial y contabilidad" title="Comercial" description="Esquema (cobro, pago o valor 0) y tarifa por producto; el subtotal se congela al cerrar cada ticket.">
      {perms.commercial ? (
        <section className="sca-panel">
          <CommercialTab today={today} suppliers={suppliers} receptions={receptions} onChanged={reload} />
        </section>
      ) : (
        <Denied />
      )}
    </Screen>
  );
}

export function EcologyScreen() {
  const { today, receptions, schedule, products, coke, summary, perms, open } = useFuels();
  return (
    <Screen
      code="M5 · Ecología y sustitución térmica"
      title="Ecología"
      description="Memoria de cálculo de la sustitución térmica del horno frente al coque de petróleo y reportes para SEMARNAT."
      actions={perms.ecology && <button className="button button-gold" onClick={() => open({ type: "coke" })}><Fuel size={17} /> Consumo de coque</button>}
    >
      <SemaphoreCard summary={summary} onCaptureCoke={perms.ecology ? () => open({ type: "coke", month: today.slice(0, 7) }) : undefined} />
      <section className="sca-panel">
        <EcologyTab today={today} receptions={receptions} schedule={schedule} products={products} coke={coke} canEdit={perms.ecology} onCoke={(month) => open({ type: "coke", month })} />
      </section>
    </Screen>
  );
}
