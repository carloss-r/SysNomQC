"use client";

import { Ban } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { fmt, SCHEDULE_STATUS_LABELS, type FuelProduct, type FuelSchedule, type FuelSupplier } from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { ExportButtons } from "@/shared/reports/export-buttons";
import type { Report } from "@/shared/reports/report-export";
import { useNotify } from "@/shared/ui/notice-provider";
import { formatDay } from "./format";
import { FUELS_SUBTITLE } from "./suppliers-tab";

export function ScheduleTab({
  today,
  schedule,
  suppliers,
  products,
  canEdit,
  onChanged,
}: {
  today: string;
  schedule: FuelSchedule[];
  suppliers: FuelSupplier[];
  products: Map<number, FuelProduct>;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const [day, setDay] = useState(today);
  const [upcoming, setUpcoming] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const supplierName = useMemo(() => new Map(suppliers.map((item) => [item.id, item.business_name])), [suppliers]);

  const rows = useMemo(
    () =>
      schedule
        .filter((row) => (upcoming ? row.scheduled_on >= today && row.status !== "cancelado" : row.scheduled_on === day))
        .sort((a, b) => a.scheduled_on.localeCompare(b.scheduled_on) || a.id - b.id),
    [schedule, upcoming, day, today],
  );
  const totalTons = rows.filter((row) => row.status !== "cancelado").reduce((sum, row) => sum + row.estimated_tons, 0);

  async function cancel(row: FuelSchedule) {
    if (!session) return;
    const reason = window.prompt(`Motivo para cancelar la recepción de ${supplierName.get(row.supplier_id)} del ${formatDay(row.scheduled_on)}:`);
    if (!reason?.trim()) return;
    setBusy(row.id);
    try {
      await requestApi(session, `/api/fuels/schedule/${row.id}`, { method: "PATCH", body: JSON.stringify({ action: "cancel", reason }) });
      notify("success", "Recepción cancelada", `${supplierName.get(row.supplier_id)} · ${formatDay(row.scheduled_on)}.`);
      await onChanged();
    } catch (err) {
      notify("error", "No se pudo cancelar", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusy(null);
    }
  }

  /** Agenda de recepción diaria para báscula. */
  function buildReport(generatedBy: string): Report {
    const period = upcoming ? `Desde ${formatDay(today)}` : formatDay(day);
    return {
      subtitle: FUELS_SUBTITLE,
      title: "Agenda de recepción para báscula",
      info: [["Fecha", period]],
      summary: [["Unidades", rows.filter((row) => row.status !== "cancelado").length], ["Toneladas estimadas", fmt(totalTons, 2)]],
      sections: [
        {
          title: "Agenda",
          columns: [
            { header: "Fecha", width: 12 },
            { header: "Proveedor (generador)", width: 34 },
            { header: "Producto", width: 28 },
            { header: "Transportista", width: 24 },
            { header: "Estimado (t)", width: 12, align: "right" },
            { header: "Estatus", width: 12 },
            { header: "Notas", width: 24 },
          ],
          rows: rows.map((row) => [
            formatDay(row.scheduled_on), supplierName.get(row.supplier_id) ?? "—", products.get(row.product_id)?.name ?? "—", row.carrier,
            fmt(row.estimated_tons, 2), SCHEDULE_STATUS_LABELS[row.status], row.status_note ?? row.notes ?? "",
          ]),
          empty: "Sin recepciones programadas.",
        },
      ],
      generatedBy,
      fileName: `Agenda_bascula_${upcoming ? "proximas" : day}`,
    };
  }

  return (
    <>
      <div className="directory-toolbar">
        <div className="site-tabs" role="tablist">
          <button role="tab" aria-selected={!upcoming} className={`site-tab${!upcoming ? " active" : ""}`} onClick={() => setUpcoming(false)}>Agenda del día</button>
          <button role="tab" aria-selected={upcoming} className={`site-tab${upcoming ? " active" : ""}`} onClick={() => setUpcoming(true)}>Próximas</button>
        </div>
        {!upcoming && <input type="date" className="epp-select" value={day} onChange={(e) => setDay(e.target.value || today)} aria-label="Día de la agenda" />}
        <span className="epp-muted">{rows.length} recepción(es) · {fmt(totalTons, 2)} t estimadas</span>
        <ExportButtons className="epp-push" build={buildReport} disabled={rows.length === 0} />
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Fecha</th><th>Proveedor</th><th className="hide-phone">Producto</th><th className="hide-tablet">Transportista</th><th>Estimado</th><th className="hide-phone">Estatus</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.status === "cancelado" ? "epp-inactive" : ""}>
                <td>{formatDay(row.scheduled_on)}</td>
                <td><strong>{supplierName.get(row.supplier_id) ?? "—"}</strong><br /><small className="epp-muted">{row.created_by_name ?? ""}</small></td>
                <td className="hide-phone">{products.get(row.product_id)?.name ?? "—"}</td>
                <td className="hide-tablet">{row.carrier}</td>
                <td>{fmt(row.estimated_tons, 2)} t</td>
                <td className="hide-phone">
                  <span className={`fuel-sched fuel-sched-${row.status}`}>{SCHEDULE_STATUS_LABELS[row.status]}</span>
                  {row.status_note && <><br /><small className="epp-muted">{row.status_note}</small></>}
                </td>
                {canEdit && (
                  <td className="row-actions">
                    {row.status === "programado" && (
                      <button className="button button-danger-outline" onClick={() => void cancel(row)} disabled={busy === row.id}><Ban size={14} /> Cancelar</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={canEdit ? 7 : 6} className="epp-empty">Sin recepciones programadas {upcoming ? "a partir de hoy" : "ese día"}.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
