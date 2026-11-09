"use client";

import { FileText, Pencil, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { fmt, permitState, SCHEME_LABELS, supplierApproved, type FuelSupplier } from "@/lib/fuels";
import { ExportButtons } from "@/shared/reports/export-buttons";
import { fileSafe, type Report } from "@/shared/reports/report-export";
import { useNotify } from "@/shared/ui/notice-provider";
import { formatDay } from "./format";
import { openPermit } from "./permits";

export const FUELS_SUBTITLE = "Ecología · Combustibles alternos";

export function PermitBadge({ validUntil, today }: { validUntil: string; today: string }) {
  const { state, days } = permitState(validUntil, today);
  const label = state === "vencido" ? `Vencido hace ${Math.abs(days)} d` : state === "por_vencer" ? `Vence en ${days} d` : "Vigente";
  return <span className={`fuel-permit fuel-permit-${state}`}>{formatDay(validUntil)} · {label}</span>;
}

/** Ficha de proveedor autorizado (PDF o Excel). */
function supplierReport(supplier: FuelSupplier, today: string, generatedBy: string): Report {
  const approved = supplierApproved(supplier, today);
  const active = supplier.products.filter((item) => item.active);
  return {
    subtitle: FUELS_SUBTITLE,
    title: approved ? "Ficha de proveedor autorizado" : "Ficha de proveedor (no autorizado)",
    info: [["Proveedor", supplier.business_name], ["RFC", supplier.rfc], ["Estatus", approved ? "Aprobado" : "Rechazado"]],
    summary: [
      ["Permiso SEMARNAT", supplier.permit_number ?? "Sin número"],
      ["Vigencia", formatDay(supplier.permit_valid_until)],
      ["Productos autorizados", active.length],
    ],
    sections: [
      {
        title: "Datos corporativos",
        columns: [{ header: "Dato", width: 22 }, { header: "Valor", width: 70 }],
        rows: [
          ["Razón social", supplier.business_name],
          ["RFC", supplier.rfc],
          ["Dirección", supplier.address ?? "—"],
          ["Contacto", supplier.contact_name ?? "—"],
          ["Teléfono", supplier.phone ?? "—"],
          ["Correo", supplier.email ?? "—"],
          ["Permiso SEMARNAT", `${supplier.permit_number ?? "Sin número"} · vigente hasta ${formatDay(supplier.permit_valid_until)}`],
          ["Estatus técnico", approved ? "Aprobado" : `Rechazado${supplier.status_note ? ` · ${supplier.status_note}` : supplier.permit_valid_until < today ? " · permiso vencido" : ""}`],
          ["Última actualización", `${formatDay(supplier.updated_at)} · ${supplier.updated_by_name ?? "—"}`],
        ],
      },
      {
        title: "Parámetros de calidad",
        columns: [
          { header: "Producto", width: 34 },
          { header: "Poder calorífico (cal/g)", width: 16, align: "right" },
          { header: "Cloro (%)", width: 10, align: "right" },
          { header: "Agua (%)", width: 10, align: "right" },
          { header: "Azufre (%)", width: 10, align: "right" },
          { header: "Esquema", width: 12 },
        ],
        rows: active.map((item) => [item.name, fmt(item.calorific_value, 0), fmt(item.chlorine_pct, 2), fmt(item.water_pct, 1), fmt(item.sulfur_pct, 2), SCHEME_LABELS[item.scheme]]),
        empty: "Sin productos autorizados.",
      },
    ],
    generatedBy,
    fileName: `Ficha_proveedor_${fileSafe(supplier.business_name)}`,
  };
}

export function SuppliersTab({
  suppliers,
  today,
  canEdit,
  onEdit,
}: {
  suppliers: FuelSupplier[];
  today: string;
  canEdit: boolean;
  onEdit: (supplier: FuelSupplier) => void;
}) {
  const notify = useNotify();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "approved" | "rejected" | "expiring">("all");

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return suppliers.filter((item) => {
      const approved = supplierApproved(item, today);
      if (filter === "approved" && !approved) return false;
      if (filter === "rejected" && approved) return false;
      if (filter === "expiring" && permitState(item.permit_valid_until, today).state === "vigente") return false;
      if (!term) return true;
      return [item.business_name, item.rfc, ...item.products.map((product) => product.name)].join(" ").toLowerCase().includes(term);
    });
  }, [suppliers, query, filter, today]);

  async function viewPdf(path: string) {
    if (!(await openPermit(path))) notify("error", "No se pudo abrir el PDF", "Revisa tu conexión o que el archivo siga en el almacenamiento.");
  }

  return (
    <>
      <div className="directory-toolbar">
        <div className="site-tabs" role="tablist">
          {([["all", "Todos"], ["approved", "Aprobados"], ["rejected", "Rechazados"], ["expiring", "Permiso por vencer o vencido"]] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} className={`site-tab${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar razón social, RFC o producto" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Razón social</th><th className="hide-phone">RFC</th><th>Estatus técnico</th><th className="hide-phone">Vigencia de permiso</th><th className="hide-tablet">Productos</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const approved = supplierApproved(item, today);
              const products = item.products.filter((product) => product.active);
              return (
                <tr key={item.id}>
                  <td><strong>{item.business_name}</strong><br /><small className="epp-muted show-phone">{item.rfc}</small><small className="epp-muted hide-phone">{item.contact_name ?? ""}</small></td>
                  <td className="hide-phone">{item.rfc}</td>
                  <td>
                    <span className={`fuel-status fuel-status-${approved ? "ok" : "bad"}`}>{approved ? "Aprobado" : "Rechazado"}</span>
                    {!approved && <><br /><small className="epp-muted">{item.status === "rechazado" ? item.status_note ?? "Rechazado" : "Permiso vencido"}</small></>}
                  </td>
                  <td className="hide-phone"><PermitBadge validUntil={item.permit_valid_until} today={today} /></td>
                  <td className="hide-tablet epp-muted">{products.map((product) => `${product.name} (${fmt(product.calorific_value, 0)} cal/g)`).join(", ") || "—"}</td>
                  <td className="row-actions">
                    <div className="epp-actions">
                      {canEdit && <button className="button button-outline" onClick={() => onEdit(item)}><Pencil size={14} /> Editar</button>}
                      {item.permit_path && <button className="button button-outline" onClick={() => void viewPdf(item.permit_path!)}><FileText size={14} /> Ver PDF</button>}
                      <ExportButtons className="fuel-inline-export" build={(by) => supplierReport(item, today, by)} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="epp-empty">{suppliers.length ? "Ningún proveedor coincide con el filtro." : "Aún no hay proveedores. Da de alta el primero con su análisis y permiso SEMARNAT."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
