"use client";

import { Ban, FlaskConical, Lock, Printer, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import {
  CHLORINE_LABELS,
  chlorineState,
  fmt,
  netTons,
  RECEPTION_STATUS_LABELS,
  semaphoreLevel,
  type FuelReception,
} from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { ExportButtons } from "@/shared/reports/export-buttons";
import type { Report } from "@/shared/reports/report-export";
import { useNotify } from "@/shared/ui/notice-provider";
import { downloadCertificatePdf } from "./certificate-pdf";
import { formatDay, formatTime, parseNumber } from "./format";
import { FUELS_SUBTITLE } from "./suppliers-tab";

export function ScaleTab({
  today,
  receptions,
  canOperate,
  canLab,
  onExit,
  onChanged,
}: {
  today: string;
  receptions: FuelReception[];
  canOperate: boolean;
  canLab: boolean;
  onExit: (reception: FuelReception) => void;
  onChanged: () => Promise<void>;
}) {
  const { session, access } = useAuth();
  const notify = useNotify();
  const [day, setDay] = useState(today);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const inPlant = useMemo(() => receptions.filter((row) => row.status === "en_planta").sort((a, b) => a.id - b.id), [receptions]);
  // Bitácora del día: tickets cerrados ese día, cancelados ese día y (hoy) los que siguen en planta.
  const log = useMemo(() => {
    const term = query.trim().toLowerCase();
    return receptions
      .filter((row) =>
        row.status === "cerrado" ? row.received_on === day : row.status === "cancelado" ? (row.tare_at ?? row.gross_at).slice(0, 10) === day : day === today,
      )
      .filter((row) => !term || [row.id, row.manifest_folio, row.generator_name, row.product_name, row.plates, row.driver].join(" ").toLowerCase().includes(term))
      .sort((a, b) => b.id - a.id);
  }, [receptions, day, today, query]);
  const closed = log.filter((row) => row.status === "cerrado");
  const tons = closed.reduce((sum, row) => sum + netTons(row), 0);

  async function certificate(row: FuelReception) {
    try {
      await downloadCertificatePdf(row, chlorineState(row, receptions, today), access?.full_name || access?.email || "SysNomQC");
    } catch (err) {
      console.error("No se pudo generar el certificado:", err);
      notify("error", "No se pudo generar el certificado", "Inténtalo de nuevo.");
    }
  }

  async function patch(row: FuelReception, body: object, success: string) {
    if (!session) return;
    setBusy(row.id);
    try {
      await requestApi(session, `/api/fuels/receptions/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
      notify("success", success, `Ticket ${row.id} · ${row.manifest_folio}.`);
      await onChanged();
    } catch (err) {
      notify("error", "No se pudo actualizar el ticket", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusy(null);
    }
  }

  function cancel(row: FuelReception) {
    const reason = window.prompt(`Motivo para cancelar el ticket ${row.id} (la unidad sale sin descargar):`);
    if (reason?.trim()) void patch(row, { action: "cancel", reason }, "Ticket cancelado");
  }

  function lab(row: FuelReception) {
    const value = window.prompt(`Cloro del embarque del ticket ${row.id} (%), según laboratorio. Solo se captura una vez:`);
    if (value === null) return;
    const pct = parseNumber(value);
    if (pct === null || pct < 0 || pct > 100) {
      notify("error", "Valor no válido", "Escribe el porcentaje de cloro, por ejemplo 0.57.");
      return;
    }
    void patch(row, { action: "chlorine", chlorine_pct: pct }, "Análisis de cloro capturado");
  }

  function buildReport(generatedBy: string): Report {
    return {
      subtitle: FUELS_SUBTITLE,
      title: "Bitácora de báscula",
      info: [["Día", formatDay(day)]],
      summary: [["Tickets cerrados", closed.length], ["Toneladas recibidas", fmt(tons, 3)], ["En planta", log.filter((row) => row.status === "en_planta").length]],
      sections: [
        {
          title: "Bitácora",
          columns: [
            { header: "Ticket", width: 9 },
            { header: "Folio manifiesto", width: 14 },
            { header: "Empresa generadora", width: 30 },
            { header: "Producto", width: 24 },
            { header: "Placas", width: 11 },
            { header: "Peso neto (t)", width: 12, align: "right" },
            { header: "Cloro (%)", width: 9, align: "right" },
            { header: "Hora cierre", width: 10 },
            { header: "Estatus", width: 11 },
          ],
          rows: log.map((row) => [
            row.id, row.manifest_folio, row.generator_name, row.product_name, row.plates, row.net_kg ? fmt(netTons(row), 3) : "—",
            row.chlorine_pct === null ? "—" : fmt(row.chlorine_pct, 2), row.status === "cerrado" ? formatTime(row.tare_at) : "—", RECEPTION_STATUS_LABELS[row.status],
          ]),
          empty: "Sin movimientos ese día.",
        },
      ],
      generatedBy,
      fileName: `Bitacora_bascula_${day}`,
    };
  }

  return (
    <>
      {inPlant.length > 0 && (
        <div className="fuel-inplant">
          <h3 className="epp-sub">Unidades en planta ({inPlant.length})</h3>
          <ul>
            {inPlant.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>Ticket {row.id} · {row.plates}</strong>
                  <small>{row.generator_name} · {row.product_name} · manifiesto {row.manifest_folio}</small>
                  <small>Bruto {fmt(row.gross_kg, 0)} kg · entró {formatTime(row.gross_at)}{row.gross_at.slice(0, 10) !== today ? ` del ${formatDay(row.gross_at)}` : ""}</small>
                </div>
                {canOperate && (
                  <div className="epp-actions">
                    <button className="button button-gold" onClick={() => onExit(row)} disabled={busy === row.id}><Lock size={14} /> Capturar salida (tara)</button>
                    <button className="button button-danger-outline" onClick={() => cancel(row)} disabled={busy === row.id}><Ban size={14} /> Cancelar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="directory-toolbar">
        <strong className="fuel-toolbar-title">Bitácora del día</strong>
        <input type="date" className="epp-select" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} aria-label="Día de la bitácora" />
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ticket, manifiesto, generador o placas" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
        <span className="epp-muted">{closed.length} cerrados · {fmt(tons, 3)} t</span>
        <ExportButtons className="epp-push" build={buildReport} disabled={log.length === 0} />
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Ticket báscula</th><th className="hide-phone">Folio manifiesto</th><th>Empresa generadora</th><th className="hide-tablet">Producto</th><th>Peso neto (t)</th><th className="hide-phone">Hora cierre</th><th className="hide-phone">Estatus</th><th /></tr>
          </thead>
          <tbody>
            {log.map((row) => {
              const cl = row.status === "cerrado" ? chlorineState(row, receptions, today) : null;
              const audit = semaphoreLevel(row.month_pct_after) === "rojo";
              return (
                <tr key={row.id} className={row.status === "cancelado" ? "epp-inactive" : ""}>
                  <td>
                    <strong>{row.id}</strong>
                    {audit && <span className="fuel-audit" title={`Sustitución del mes al cerrar: ${fmt(row.month_pct_after, 1)} %`}>Auditoría</span>}
                    <br /><small className="epp-muted show-phone">{row.manifest_folio}</small>
                  </td>
                  <td className="hide-phone">{row.manifest_folio}{row.compensates_id && <><br /><small className="epp-muted">Compensa ticket {row.compensates_id}</small></>}</td>
                  <td><strong>{row.generator_name}</strong><br /><small className="epp-muted">{row.plates} · {row.driver}</small></td>
                  <td className="hide-tablet">
                    {row.product_name}
                    {cl && cl !== "ok" && <><br /><span className={`fuel-cl fuel-cl-${cl}`}>{cl === "sin_analisis" ? CHLORINE_LABELS[cl] : `Cl ${fmt(row.chlorine_pct, 2)} % · ${CHLORINE_LABELS[cl]}`}</span></>}
                  </td>
                  <td>{row.net_kg ? <strong>{fmt(netTons(row), 3)}</strong> : `Bruto ${fmt(row.gross_kg / 1000, 3)}`}</td>
                  <td className="hide-phone">{row.status === "cerrado" ? formatTime(row.tare_at) : "—"}</td>
                  <td className="hide-phone">
                    <span className={`fuel-sched fuel-sched-${row.status === "cerrado" ? "recibido" : row.status}`}>{RECEPTION_STATUS_LABELS[row.status]}</span>
                    {row.cancel_reason && <><br /><small className="epp-muted">{row.cancel_reason}</small></>}
                  </td>
                  <td className="row-actions">
                    <div className="epp-actions">
                      {row.status === "en_planta" && canOperate && <button className="button button-gold" onClick={() => onExit(row)}><Lock size={14} /> Tara</button>}
                      {cl === "sin_analisis" && canLab && <button className="button button-outline" onClick={() => lab(row)} disabled={busy === row.id} title="Capturar cloro de laboratorio"><FlaskConical size={14} /> Cloro</button>}
                      <button className="button button-outline" onClick={() => void certificate(row)} disabled={row.status !== "cerrado"} title={row.status === "cerrado" ? "Imprimir certificado de recepción" : "Se habilita al cerrar la tara"}>
                        <Printer size={14} /> Certificado PDF
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {log.length === 0 && <tr><td colSpan={8} className="epp-empty">Sin movimientos de báscula ese día.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
