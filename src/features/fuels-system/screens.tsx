"use client";

import {
  AlertTriangle,
  CalendarPlus,
  Factory,
  FlaskConical,
  Fuel,
  Plus,
  Printer,
  Scale,
  ShieldAlert,
  Truck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  chlorineState,
  computeMonth,
  fmt,
  GREEN_UNTIL,
  LEVEL_LABELS,
  netTons,
  permitState,
  SCHEDULE_STATUS_LABELS,
  SEMARNAT_LIMIT,
  type FuelMonthSummary,
} from "@/lib/fuels";
import { CommercialTab } from "@/features/fuels/commercial-tab";
import { EcologyTab } from "@/features/fuels/ecology-tab";
import { formatDay, formatTime, monthLabel, previousMonth } from "@/features/fuels/format";
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
// Panel de control
// ---------------------------------------------------------------------------
const GAUGE_MAX = 40;

/** Medidor semicircular 0–40 % con zonas verde / amarillo / rojo. */
function DialGauge({ summary }: { summary: FuelMonthSummary }) {
  const cx = 120, cy = 118, r = 96;
  const point = (value: number, radius = r) => {
    const angle = Math.PI * (1 - Math.min(GAUGE_MAX, Math.max(0, value)) / GAUGE_MAX);
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const pct = summary.pct;
  const [nx, ny] = point(pct ?? 0, r - 18);
  const [px1, py1] = point(summary.projected_pct ?? 0, r - 12);
  const [px2, py2] = point(summary.projected_pct ?? 0, r + 12);

  return (
    <svg className="sca-dial" viewBox="0 0 240 140" role="img" aria-label={`Sustitución térmica ${pct === null ? "sin datos" : `${fmt(pct, 1)} %`}`}>
      <path d={arc(0, GAUGE_MAX)} className="sca-dial-track" />
      <path d={arc(0, GREEN_UNTIL)} className="sca-dial-zone verde" />
      <path d={arc(GREEN_UNTIL, SEMARNAT_LIMIT)} className="sca-dial-zone amarillo" />
      <path d={arc(SEMARNAT_LIMIT, GAUGE_MAX)} className="sca-dial-zone rojo" />
      {summary.projected_pct !== null && <line x1={px1} y1={py1} x2={px2} y2={py2} className="sca-dial-proj" />}
      {pct !== null && <line x1={cx} y1={cy} x2={nx} y2={ny} className="sca-dial-needle" />}
      <circle cx={cx} cy={cy} r={7} className="sca-dial-hub" />
      {[0, GREEN_UNTIL, SEMARNAT_LIMIT, GAUGE_MAX].map((value) => {
        const [x, y] = point(value, r + 16);
        return <text key={value} x={x} y={y} className="sca-dial-label" textAnchor="middle">{value}</text>;
      })}
    </svg>
  );
}

export function PanelScreen() {
  const { today, summary, stats, schedule, receptions, suppliers, products, coke, perms, open, printCertificate } = useFuels();
  const supplierName = useMemo(() => new Map(suppliers.map((item) => [item.id, item.business_name])), [suppliers]);

  const trend = useMemo(() => {
    const keys: string[] = [today.slice(0, 7)];
    while (keys.length < 6) keys.unshift(previousMonth(keys[0]!));
    return keys.map((key) => computeMonth(key, receptions, schedule, products, coke));
  }, [today, receptions, schedule, products, coke]);

  const agenda = schedule.filter((row) => row.scheduled_on === today && row.status !== "cancelado").sort((a, b) => a.id - b.id);
  const inPlant = receptions.filter((row) => row.status === "en_planta").sort((a, b) => a.id - b.id);
  const recent = receptions.filter((row) => row.status === "cerrado").sort((a, b) => b.id - a.id).slice(0, 6);
  const permits = suppliers
    .filter((item) => item.status === "aprobado")
    .map((item) => ({ item, permit: permitState(item.permit_valid_until, today) }))
    .filter(({ permit }) => permit.state !== "vigente")
    .sort((a, b) => a.permit.days - b.permit.days);
  const chlorine = receptions.filter((row) => row.status === "cerrado" && chlorineState(row, receptions, today) === "en_plazo");
  const monthTons = summary.alt_tons;

  return (
    <Screen
      code="Tablero"
      title="Panel de control"
      description={`Situación de ${monthLabel(today.slice(0, 7))}: semáforo SEMARNAT, unidades en planta, agenda del día y alertas.`}
      actions={
        <>
          {perms.scale && <button className="button button-gold" onClick={() => open({ type: "entry" })}><Truck size={17} /> Capturar entrada</button>}
          {perms.schedule && <button className="button button-outline" onClick={() => open({ type: "schedule" })}><CalendarPlus size={17} /> Programar</button>}
        </>
      }
    >
      <section className="sca-hero">
        <div className={`sca-card sca-gauge-card sca-level-${summary.level}`}>
          <div className="sca-card-head"><span className="sca-mono">Sustitución térmica</span><span className={`sca-pill sca-pill-${summary.level}`}>{LEVEL_LABELS[summary.level]}</span></div>
          <DialGauge summary={summary} />
          <div className="sca-gauge-value">
            <strong>{summary.pct === null ? "—" : fmt(summary.pct, 1)}</strong><span>%</span>
          </div>
          <p className="sca-gauge-note">
            Proyección con lo programado: <b>{summary.projected_pct === null ? "—" : `${fmt(summary.projected_pct, 1)} %`}</b>
            {summary.coke_tons === null && <> · <button className="text-button" onClick={() => open({ type: "coke", month: today.slice(0, 7) })}>Falta capturar coque</button></>}
          </p>
        </div>

        <div className="sca-kpis">
          <Kpi icon={<Scale size={18} />} label="Recibido hoy" value={`${fmt(stats.todayTons, 2)} t`} />
          <Kpi icon={<Truck size={18} />} label="Unidades en planta" value={String(stats.inPlant)} tone={stats.inPlant ? "accent" : undefined} />
          <Kpi icon={<CalendarPlus size={18} />} label="Programadas hoy" value={String(stats.agenda)} />
          <Kpi icon={<Fuel size={18} />} label="Alternos del mes" value={`${fmt(monthTons, 1)} t`} sub={`${fmt(summary.alt_gcal, 0)} Gcal`} />
          <Kpi icon={<Factory size={18} />} label="Proveedores aprobados" value={String(stats.approved)} />
          <Kpi icon={<ShieldAlert size={18} />} label="Permisos por vencer" value={String(stats.expiring)} tone={stats.expiring ? "danger" : undefined} />
        </div>
      </section>

      <section className="sca-grid-2">
        <div className="sca-card">
          <div className="sca-card-head"><span className="sca-mono">Tendencia · 6 meses</span><span className="sca-legend"><i className="l25" /> 25 % <i className="l30" /> 30 %</span></div>
          <div className="sca-bars">
            {trend.map((month) => (
              <div key={month.month} className="sca-bar-col" title={`${monthLabel(month.month)}: ${month.pct === null ? "sin datos" : `${fmt(month.pct, 1)} %`}`}>
                <div className="sca-bar-track">
                  <i className="l25" style={{ bottom: `${(GREEN_UNTIL / GAUGE_MAX) * 100}%` }} />
                  <i className="l30" style={{ bottom: `${(SEMARNAT_LIMIT / GAUGE_MAX) * 100}%` }} />
                  <span className={`sca-bar sca-bar-${month.level}`} style={{ height: `${Math.min(100, ((month.pct ?? 0) / GAUGE_MAX) * 100)}%` }} />
                </div>
                <b>{month.pct === null ? "—" : fmt(month.pct, 1)}</b>
                <small>{monthLabel(month.month).slice(0, 3)}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="sca-card">
          <div className="sca-card-head"><span className="sca-mono">Alertas</span><AlertTriangle size={16} /></div>
          <ul className="sca-alerts">
            {summary.level !== "verde" && summary.level !== "sin_datos" && (
              <li className={`sca-alert ${summary.level === "rojo" ? "danger" : "warn"}`}>Semáforo {LEVEL_LABELS[summary.level].toLowerCase()}: {fmt(summary.pct, 1)} % de sustitución.</li>
            )}
            {summary.projected_level !== summary.level && summary.projected_pct !== null && (
              <li className="sca-alert warn">Con lo programado, el mes cerraría en {fmt(summary.projected_pct, 1)} % ({LEVEL_LABELS[summary.projected_level].toLowerCase()}).</li>
            )}
            {chlorine.map((row) => (
              <li key={row.id} className="sca-alert warn"><FlaskConical size={14} /> Ticket {row.id} ({row.generator_name}) con {fmt(row.chlorine_pct, 2)} % de cloro: en plazo de corrección.</li>
            ))}
            {permits.map(({ item, permit }) => (
              <li key={item.id} className={`sca-alert ${permit.state === "vencido" ? "danger" : "warn"}`}>
                Permiso SEMARNAT de {item.business_name} {permit.state === "vencido" ? `venció hace ${-permit.days} días` : `vence en ${permit.days} días`}.
              </li>
            ))}
            {summary.coke_tons === null && <li className="sca-alert warn">Falta capturar el consumo de coque de petróleo.</li>}
            {!chlorine.length && !permits.length && summary.level === "verde" && summary.projected_level === "verde" && <li className="sca-alert ok">Sin alertas: operación normal.</li>}
          </ul>
        </div>
      </section>

      <section className="sca-grid-2">
        <div className="sca-card">
          <div className="sca-card-head"><span className="sca-mono">En planta</span><span className="sca-count">{inPlant.length}</span></div>
          {inPlant.length === 0 ? (
            <p className="sca-empty">No hay unidades esperando tara.</p>
          ) : (
            <ul className="sca-list">
              {inPlant.map((row) => (
                <li key={row.id}>
                  <span className="sca-ticket sca-mono">#{row.id}</span>
                  <span className="sca-list-main">
                    <strong>{row.generator_name}</strong>
                    <small>{row.product_name} · {row.plates} · bruto {fmt(row.gross_kg, 0)} kg · entró {formatTime(row.gross_at)}</small>
                  </span>
                  {perms.scale && <button className="button button-gold sca-small" onClick={() => open({ type: "exit", reception: row })}>Registrar salida</button>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sca-card">
          <div className="sca-card-head"><span className="sca-mono">Agenda de hoy</span><span className="sca-count">{agenda.length}</span></div>
          {agenda.length === 0 ? (
            <p className="sca-empty">No hay recepciones programadas para hoy.</p>
          ) : (
            <ul className="sca-list">
              {agenda.map((row) => (
                <li key={row.id}>
                  <span className={`fuel-sched fuel-sched-${row.status}`}>{SCHEDULE_STATUS_LABELS[row.status]}</span>
                  <span className="sca-list-main">
                    <strong>{supplierName.get(row.supplier_id) ?? "Proveedor"}</strong>
                    <small>{products.get(row.product_id)?.name ?? "Producto"} · {row.carrier} · {fmt(row.estimated_tons, 1)} t</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="sca-card">
        <div className="sca-card-head"><span className="sca-mono">Últimos tickets cerrados</span></div>
        {recent.length === 0 ? (
          <p className="sca-empty">Aún no hay tickets cerrados.</p>
        ) : (
          <div className="table-scroll">
            <table className="employee-table">
              <thead>
                <tr><th>Ticket</th><th>Fecha</th><th>Proveedor</th><th className="hide-phone">Producto</th><th>Neto</th><th className="hide-tablet">Cloro</th><th /></tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className="sca-mono">#{row.id}</td>
                    <td>{formatDay(row.received_on)}</td>
                    <td>{row.generator_name}</td>
                    <td className="hide-phone">{row.product_name}</td>
                    <td className="sca-mono">{fmt(netTons(row), 3)} t</td>
                    <td className="hide-tablet">{row.chlorine_pct === null ? "—" : `${fmt(row.chlorine_pct, 2)} %`}</td>
                    <td className="row-actions"><button className="icon-button" title="Certificado PDF" aria-label={`Certificado del ticket ${row.id}`} onClick={() => void printCertificate(row)}><Printer size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Screen>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub?: string; tone?: "accent" | "danger" }) {
  return (
    <div className={`sca-kpi${tone ? ` ${tone}` : ""}`}>
      <span className="sca-kpi-icon">{icon}</span>
      <span className="sca-mono">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
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
