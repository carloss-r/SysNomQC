"use client";

import { CalendarRange, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  EMPTY_QUERY,
  QUICK_PERIODS,
  quickPeriod,
  rangePeriod,
  STATE_LABELS,
  type DateField,
  type InvoiceQuery,
  type QuickPeriod,
  type SearchState,
} from "@/lib/invoice-search";

/** Lo que se elige en el menú de filtros. */
export type InvoiceFilters = {
  state: SearchState | "";
  /** Rango del calendario (YYYY-MM-DD; vacío = sin límite). */
  from: string;
  to: string;
  dateField: DateField;
  min: string;
  max: string;
};

export const EMPTY_FILTERS: InvoiceFilters = { state: "", from: "", to: "", dateField: "upload", min: "", max: "" };

const STATE_OPTIONS: SearchState[] = ["firmar", "cargar", "contrarecibo", "complemento", "abierta", "cerrada", "incidente"];

const QUICK_LABELS: Record<QuickPeriod, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "esta semana": "Esta semana",
  "semana pasada": "Semana pasada",
  "este mes": "Este mes",
  "mes pasado": "Mes pasado",
};

const toAmount = (value: string) => {
  const number = Number(value.replace(/[$,\s]/g, ""));
  return value.trim() && Number.isFinite(number) && number >= 0 ? number : null;
};

/** Los filtros del menú como búsqueda (se combinan con lo escrito en el buscador). */
export function filtersToQuery(filters: InvoiceFilters): InvoiceQuery {
  return {
    ...EMPTY_QUERY,
    states: filters.state ? [filters.state] : [],
    period: rangePeriod(filters.from, filters.to),
    dateField: filters.dateField,
    minAmount: toAmount(filters.min),
    maxAmount: toAmount(filters.max),
  };
}

export const activeFilterCount = (filters: InvoiceFilters) =>
  [filters.state, filters.from || filters.to, filters.min, filters.max].filter(Boolean).length;

/** Botón «Filtros» con su menú: estado, periodo rápido, rango de fechas con calendario y rango de total. */
export function FiltersDropdown({
  filters,
  today,
  onChange,
}: {
  filters: InvoiceFilters;
  today: string;
  onChange: (filters: InvoiceFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const count = activeFilterCount(filters);

  // Se cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const set = <K extends keyof InvoiceFilters>(key: K, value: InvoiceFilters[K]) => onChange({ ...filters, [key]: value });

  // Un periodo rápido llena el calendario (desde / hasta); después se puede ajustar a mano.
  const quick = QUICK_PERIODS.find((word) => {
    const period = quickPeriod(word, today);
    return period && period.from === filters.from && period.to === filters.to;
  }) ?? "";
  function pickQuick(word: QuickPeriod | "") {
    const period = word ? quickPeriod(word, today) : null;
    onChange({ ...filters, from: period?.from ?? "", to: period?.to ?? "" });
  }

  return (
    <div className="invoice-filters-dropdown" ref={wrapper}>
      <button
        type="button"
        className={`button button-outline invoice-filters-toggle${count ? " has-filters" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SlidersHorizontal size={15} /> Filtros{count ? <span className="site-count">{count}</span> : null} <ChevronDown size={14} />
      </button>

      {open && (
        <div className="invoice-filters-panel" role="dialog" aria-label="Filtros de facturas">
          <label className="invoice-filter-field">
            <span>Estado</span>
            <select value={filters.state} onChange={(event) => set("state", event.target.value as SearchState | "")}>
              <option value="">Todos</option>
              {STATE_OPTIONS.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
            </select>
          </label>

          <div className="invoice-filter-group">
            <div className="invoice-filter-group-title"><CalendarRange size={14} /> Fechas</div>
            <div className="invoice-filter-grid">
              <label className="invoice-filter-field">
                <span>Periodo rápido</span>
                <select value={quick} onChange={(event) => pickQuick(event.target.value as QuickPeriod | "")}>
                  <option value="">{filters.from || filters.to ? "Rango personalizado" : "Cualquier fecha"}</option>
                  {QUICK_PERIODS.map((word) => <option key={word} value={word}>{QUICK_LABELS[word]}</option>)}
                </select>
              </label>
              <label className="invoice-filter-field">
                <span>Fecha de</span>
                <select value={filters.dateField} onChange={(event) => set("dateField", event.target.value as DateField)}>
                  <option value="upload">Carga al sistema</option>
                  <option value="invoice">La factura</option>
                </select>
              </label>
              <label className="invoice-filter-field">
                <span>Desde</span>
                <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set("from", event.target.value)} />
              </label>
              <label className="invoice-filter-field">
                <span>Hasta</span>
                <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set("to", event.target.value)} />
              </label>
            </div>
          </div>

          <div className="invoice-filter-group">
            <div className="invoice-filter-group-title">Total de la factura (MXN)</div>
            <div className="invoice-filter-grid">
              <label className="invoice-filter-field">
                <span>Mínimo</span>
                <input inputMode="decimal" placeholder="$0.00" value={filters.min} onChange={(event) => set("min", event.target.value)} />
              </label>
              <label className="invoice-filter-field">
                <span>Máximo</span>
                <input inputMode="decimal" placeholder="Sin límite" value={filters.max} onChange={(event) => set("max", event.target.value)} />
              </label>
            </div>
          </div>

          <div className="invoice-filters-actions">
            <button type="button" className="button button-neutral" onClick={() => onChange(EMPTY_FILTERS)} disabled={!count}>
              <X size={14} /> Limpiar filtros
            </button>
            <button type="button" className="button button-primary" onClick={() => setOpen(false)}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}
