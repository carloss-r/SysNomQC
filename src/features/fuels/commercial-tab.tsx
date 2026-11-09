"use client";

import { Save } from "lucide-react";
import { useMemo, useState } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { fmt, money, netTons, SCHEME_LABELS, type CommercialScheme, type FuelReception, type FuelSupplier } from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { ExportButtons } from "@/shared/reports/export-buttons";
import { fileSafe, type Report, type ReportCell } from "@/shared/reports/report-export";
import { useNotify } from "@/shared/ui/notice-provider";
import { formatDay, monthLabel, parseNumber } from "./format";
import { FUELS_SUBTITLE } from "./suppliers-tab";

type Period = "diario" | "quincenal" | "mensual";

type Group = { key: string; label: string; detail: string; scheme: CommercialScheme; trips: number; tons: number; subtotal: number; rate: number | null };

function group(rows: FuelReception[], keyOf: (row: FuelReception) => string, labelOf: (row: FuelReception) => [string, string]): Group[] {
  const map = new Map<string, Group>();
  for (const row of rows) {
    const scheme = row.scheme ?? "valor_cero";
    const key = `${keyOf(row)}|${scheme}`;
    const [label, detail] = labelOf(row);
    const entry = map.get(key) ?? { key, label, detail, scheme, trips: 0, tons: 0, subtotal: 0, rate: row.rate_per_ton };
    entry.trips += 1;
    entry.tons += netTons(row);
    entry.subtotal += row.subtotal ?? 0;
    if (entry.rate !== row.rate_per_ton) entry.rate = null; // tarifas distintas en el periodo
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "es") || a.detail.localeCompare(b.detail, "es"));
}

function TariffRow({ supplier, product, onSaved }: { supplier: FuelSupplier; product: FuelSupplier["products"][number]; onSaved: () => Promise<void> }) {
  const { session } = useAuth();
  const notify = useNotify();
  const [scheme, setScheme] = useState<CommercialScheme>(product.scheme);
  const [rate, setRate] = useState(String(product.rate_per_ton));
  const [busy, setBusy] = useState(false);
  const rateValue = scheme === "valor_cero" ? 0 : parseNumber(rate);
  const dirty = scheme !== product.scheme || rateValue !== product.rate_per_ton;

  async function save() {
    if (!session || rateValue === null || rateValue < 0) return;
    setBusy(true);
    try {
      await requestApi(session, `/api/fuels/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ scheme, rate_per_ton: rateValue }) });
      notify("success", "Tarifa guardada", `${product.name}: ${SCHEME_LABELS[scheme]} ${scheme === "valor_cero" ? "" : `${money(rateValue)} por tonelada`}. Aplica a los tickets que se cierren desde ahora.`);
      await onSaved();
    } catch (err) {
      notify("error", "No se pudo guardar la tarifa", describeError(err, "Inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td><strong>{product.name}</strong><br /><small className="epp-muted">{supplier.business_name}</small></td>
      <td>
        <select className="epp-select" value={scheme} onChange={(e) => setScheme(e.target.value as CommercialScheme)} aria-label={`Esquema de ${product.name}`}>
          {(Object.keys(SCHEME_LABELS) as CommercialScheme[]).map((key) => <option key={key} value={key}>{SCHEME_LABELS[key]}</option>)}
        </select>
      </td>
      <td>
        <input className="epp-select fuel-rate" inputMode="decimal" value={scheme === "valor_cero" ? "0" : rate} disabled={scheme === "valor_cero"} onChange={(e) => setRate(e.target.value)} aria-label={`Tarifa por tonelada de ${product.name}`} />
      </td>
      <td className="row-actions">
        <button className="button button-outline" onClick={() => void save()} disabled={!dirty || busy || rateValue === null}><Save size={14} /> {busy ? "Guardando…" : "Guardar"}</button>
      </td>
    </tr>
  );
}

export function CommercialTab({ today, suppliers, receptions, onChanged }: { today: string; suppliers: FuelSupplier[]; receptions: FuelReception[]; onChanged: () => Promise<void> }) {
  const [period, setPeriod] = useState<Period>("mensual");
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [half, setHalf] = useState<1 | 2>(Number(today.slice(8, 10)) <= 15 ? 1 : 2);

  const closed = useMemo(() => receptions.filter((row) => row.status === "cerrado" && row.received_on), [receptions]);
  const months = useMemo(() => {
    const set = new Set(closed.map((row) => row.received_on!.slice(0, 7)));
    set.add(today.slice(0, 7));
    return Array.from(set).sort().reverse();
  }, [closed, today]);

  const [from, to, label] = useMemo((): [string, string, string] => {
    if (period === "diario") return [day, day, formatDay(day)];
    if (period === "quincenal") {
      const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
      return half === 1
        ? [`${month}-01`, `${month}-15`, `1.ª quincena de ${monthLabel(month)}`]
        : [`${month}-16`, `${month}-${String(last).padStart(2, "0")}`, `2.ª quincena de ${monthLabel(month)}`];
    }
    return [`${month}-01`, `${month}-31`, monthLabel(month)];
  }, [period, day, month, half]);

  const rows = useMemo(() => closed.filter((row) => row.received_on! >= from && row.received_on! <= to).sort((a, b) => a.id - b.id), [closed, from, to]);
  const byProduct = useMemo(() => group(rows, (row) => String(row.product_id), (row) => [row.product_name, row.generator_name]), [rows]);
  const byGenerator = useMemo(() => group(rows, (row) => String(row.supplier_id), (row) => [row.generator_name, row.generator_rfc]), [rows]);
  const totals = useMemo(() => {
    const sum = (scheme: CommercialScheme) => rows.filter((row) => (row.scheme ?? "valor_cero") === scheme);
    const cobro = sum("cobro");
    const pago = sum("pago");
    const zero = sum("valor_cero");
    return {
      tons: rows.reduce((acc, row) => acc + netTons(row), 0),
      cobro: cobro.reduce((acc, row) => acc + (row.subtotal ?? 0), 0),
      pago: pago.reduce((acc, row) => acc + (row.subtotal ?? 0), 0),
      zeroTons: zero.reduce((acc, row) => acc + netTons(row), 0),
    };
  }, [rows]);

  const products = useMemo(
    () => suppliers.flatMap((supplier) => supplier.products.filter((product) => product.active).map((product) => ({ supplier, product }))),
    [suppliers],
  );

  function buildReport(generatedBy: string): Report {
    const columns = (first: string, second: string) => [
      { header: first, width: 30 },
      { header: second, width: 26 },
      { header: "Esquema", width: 11 },
      { header: "Viajes", width: 8, align: "right" as const },
      { header: "Neto (t)", width: 12, align: "right" as const },
      { header: "Tarifa ($/t)", width: 12, align: "right" as const },
      { header: "Subtotal", width: 14, align: "right" as const },
    ];
    const toRows = (list: Group[]): ReportCell[][] => list.map((item) => [item.label, item.detail, SCHEME_LABELS[item.scheme], item.trips, fmt(item.tons, 3), item.rate === null ? "Varias" : money(item.rate), money(item.subtotal)]);
    return {
      subtitle: FUELS_SUBTITLE,
      title: `Reporte contable ${period}`,
      info: [["Periodo", label], ["Importes", "Sin IVA"]],
      summary: [["Toneladas", fmt(totals.tons, 3)], ["Por cobrar", money(totals.cobro)], ["Por pagar", money(totals.pago)], ["Saldo", money(totals.cobro - totals.pago)]],
      sections: [
        { title: "Por producto", columns: columns("Producto", "Generador"), rows: toRows(byProduct), empty: "Sin recepciones en el periodo." },
        { title: "Por generador", columns: columns("Generador", "RFC"), rows: toRows(byGenerator), empty: "Sin recepciones en el periodo." },
        {
          title: "Detalle por ticket",
          columns: [
            { header: "Ticket", width: 8 },
            { header: "Fecha", width: 10 },
            { header: "Manifiesto", width: 12 },
            { header: "Generador", width: 26 },
            { header: "Producto", width: 22 },
            { header: "Esquema", width: 10 },
            { header: "Neto (t)", width: 10, align: "right" },
            { header: "Tarifa ($/t)", width: 11, align: "right" },
            { header: "Subtotal", width: 12, align: "right" },
          ],
          rows: rows.map((row) => [row.id, formatDay(row.received_on), row.manifest_folio, row.generator_name, row.product_name, SCHEME_LABELS[row.scheme ?? "valor_cero"], fmt(netTons(row), 3), money(row.rate_per_ton), money(row.subtotal)]),
          empty: "Sin recepciones en el periodo.",
        },
      ],
      generatedBy,
      fileName: `Combustibles_contable_${period}_${fileSafe(label)}`,
    };
  }

  return (
    <div className="fuel-commercial">
      <div className="directory-toolbar">
        <div className="site-tabs" role="tablist">
          {(["diario", "quincenal", "mensual"] as const).map((key) => (
            <button key={key} role="tab" aria-selected={period === key} className={`site-tab${period === key ? " active" : ""}`} onClick={() => setPeriod(key)}>
              {key === "diario" ? "Diario" : key === "quincenal" ? "Quincenal" : "Mensual"}
            </button>
          ))}
        </div>
        {period === "diario" ? (
          <input type="date" className="epp-select" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} aria-label="Día" />
        ) : (
          <select className="epp-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mes">
            {months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}
          </select>
        )}
        {period === "quincenal" && (
          <select className="epp-select" value={half} onChange={(e) => setHalf(Number(e.target.value) as 1 | 2)} aria-label="Quincena">
            <option value={1}>1.ª quincena (1–15)</option>
            <option value={2}>2.ª quincena (16–fin)</option>
          </select>
        )}
        <ExportButtons className="epp-push" build={buildReport} disabled={rows.length === 0} />
      </div>

      <div className="fuel-money">
        <div><span>Toneladas</span><strong>{fmt(totals.tons, 3)}</strong></div>
        <div className="in"><span>Por cobrar</span><strong>{money(totals.cobro)}</strong></div>
        <div className="out"><span>Por pagar</span><strong>{money(totals.pago)}</strong></div>
        <div><span>Valor 0</span><strong>{fmt(totals.zeroTons, 3)} t</strong></div>
        <div><span>Saldo (sin IVA)</span><strong>{money(totals.cobro - totals.pago)}</strong></div>
      </div>

      <div className="epp-two">
        {[{ title: "Por producto", list: byProduct, first: "Producto" }, { title: "Por generador", list: byGenerator, first: "Generador" }].map((block) => (
          <div key={block.title}>
            <h3 className="epp-sub">{block.title} · {label}</h3>
            <div className="table-scroll">
              <table className="employee-table">
                <thead><tr><th>{block.first}</th><th className="hide-phone">Esquema</th><th>Neto (t)</th><th>Subtotal</th></tr></thead>
                <tbody>
                  {block.list.map((item) => (
                    <tr key={item.key}>
                      <td><strong>{item.label}</strong><br /><small className="epp-muted">{item.detail} · {item.trips} viaje(s)</small></td>
                      <td className="hide-phone"><span className={`fuel-scheme fuel-scheme-${item.scheme}`}>{SCHEME_LABELS[item.scheme]}</span></td>
                      <td>{fmt(item.tons, 3)}</td>
                      <td className={item.scheme === "cobro" ? "epp-in" : item.scheme === "pago" ? "epp-out" : ""}>{money(item.subtotal)}</td>
                    </tr>
                  ))}
                  {block.list.length === 0 && <tr><td colSpan={4} className="epp-empty">Sin recepciones en el periodo.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <h3 className="epp-sub fuel-pad">Esquema y tarifa por producto</h3>
      <p className="epp-muted fuel-pad">Subtotal = neto (t) × tarifa, sin IVA. La tarifa se congela en cada ticket al cerrar la tara; cambiarla no altera lo ya cerrado.</p>
      <div className="table-scroll">
        <table className="employee-table">
          <thead><tr><th>Producto</th><th>Esquema</th><th>Tarifa ($/t)</th><th /></tr></thead>
          <tbody>
            {products.map(({ supplier, product }) => <TariffRow key={`${product.id}:${product.scheme}:${product.rate_per_ton}`} supplier={supplier} product={product} onSaved={onChanged} />)}
            {products.length === 0 && <tr><td colSpan={4} className="epp-empty">Primero da de alta proveedores con sus productos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
