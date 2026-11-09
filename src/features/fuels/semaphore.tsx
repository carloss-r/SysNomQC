"use client";

import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { fmt, GREEN_UNTIL, LEVEL_LABELS, SEMARNAT_LIMIT, type FuelMonthSummary, type SemaphoreLevel } from "@/lib/fuels";
import { monthLabel } from "./format";

const MESSAGES: Record<SemaphoreLevel, string> = {
  verde: "Operación normal y holgada.",
  amarillo: "Alerta preventiva: dosifica la logística semanal. Se avisó por correo a Ecología.",
  rojo: "Alerta crítica: se alcanzó el límite autorizado. La agenda bloquea nuevas cargas del mes y los reportes llevan marca de auditoría.",
  sin_datos: "Falta capturar el consumo de coque de petróleo para calcular la sustitución.",
};

const ICONS = { verde: CheckCircle2, amarillo: AlertTriangle, rojo: AlertOctagon, sin_datos: CircleHelp } as const;

export function LevelBadge({ level }: { level: SemaphoreLevel }) {
  return <span className={`fuel-level fuel-level-${level}`}>{LEVEL_LABELS[level]}</span>;
}

/** Barra 0–40 % con marcas en 25 % (amarillo) y 30 % (límite SEMARNAT). */
function Gauge({ pct, projected }: { pct: number | null; projected: number | null }) {
  const scale = 40;
  const pos = (value: number) => `${Math.min(100, Math.max(0, (value / scale) * 100))}%`;
  return (
    <div className="fuel-gauge" aria-hidden="true">
      <div className="fuel-gauge-track">
        <span className="fuel-gauge-zone fuel-zone-verde" style={{ width: pos(GREEN_UNTIL) }} />
        <span className="fuel-gauge-zone fuel-zone-amarillo" style={{ left: pos(GREEN_UNTIL), width: `calc(${pos(SEMARNAT_LIMIT)} - ${pos(GREEN_UNTIL)})` }} />
        <span className="fuel-gauge-zone fuel-zone-rojo" style={{ left: pos(SEMARNAT_LIMIT), right: 0 }} />
        {projected !== null && projected !== pct && <span className="fuel-gauge-projected" style={{ left: pos(projected) }} title="Proyección" />}
        {pct !== null && <span className="fuel-gauge-needle" style={{ left: pos(pct) }} />}
      </div>
      <div className="fuel-gauge-scale">
        <span>0 %</span>
        <span style={{ left: pos(GREEN_UNTIL) }}>{GREEN_UNTIL} %</span>
        <span style={{ left: pos(SEMARNAT_LIMIT) }}>{SEMARNAT_LIMIT} %</span>
        <span className="end">{scale} %</span>
      </div>
    </div>
  );
}

export function SemaphoreCard({ summary, onCaptureCoke }: { summary: FuelMonthSummary; onCaptureCoke?: () => void }) {
  const Icon = ICONS[summary.level];
  return (
    <section className={`fuel-semaphore fuel-semaphore-${summary.level}`} aria-label="Semáforo de sustitución térmica">
      <div className="fuel-lights" aria-hidden="true">
        {(["rojo", "amarillo", "verde"] as const).map((light) => (
          <span key={light} className={`fuel-light fuel-light-${light}${summary.level === light ? " on" : ""}`} />
        ))}
      </div>
      <div className="fuel-semaphore-main">
        <p className="fuel-semaphore-title">
          <Icon size={16} /> Sustitución térmica · {monthLabel(summary.month)} <LevelBadge level={summary.level} />
        </p>
        <p className="fuel-semaphore-pct">
          <strong>{summary.pct === null ? "—" : `${fmt(summary.pct, 1)} %`}</strong>
          <span>de {SEMARNAT_LIMIT} % autorizado por SEMARNAT</span>
        </p>
        <Gauge pct={summary.pct} projected={summary.projected_pct} />
        <p className="fuel-semaphore-msg">{MESSAGES[summary.level]}</p>
      </div>
      <dl className="fuel-semaphore-facts">
        <div><dt>Alternos recibidos</dt><dd>{fmt(summary.alt_tons, 2)} t · {fmt(summary.alt_gcal, 1)} Gcal</dd></div>
        <div>
          <dt>Coque de petróleo</dt>
          <dd>
            {summary.coke_tons === null ? "Sin capturar" : `${fmt(summary.coke_tons, 1)} t · ${fmt(summary.coke_gcal, 1)} Gcal`}
            {summary.coke_estimated && summary.coke_month && <small> (estimado con {monthLabel(summary.coke_month)})</small>}
          </dd>
        </div>
        <div>
          <dt>Proyección con lo programado</dt>
          <dd>
            {summary.projected_pct === null ? "—" : `${fmt(summary.projected_pct, 1)} %`} <LevelBadge level={summary.projected_level} />
            <small> {fmt(summary.pending_tons, 1)} t pendientes</small>
          </dd>
        </div>
        {onCaptureCoke && (summary.coke_tons === null || summary.coke_estimated) && (
          <div><button type="button" className="text-button" onClick={onCaptureCoke}>Capturar coque del mes</button></div>
        )}
      </dl>
    </section>
  );
}
