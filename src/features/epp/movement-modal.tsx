"use client";

import { CalendarDays, Check, ClipboardCheck, PackagePlus, Plus, Scale, Search, Trash2, X } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { EppArticle, EppEmployee, EppMovement } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { SiteBadge } from "@/shared/ui/badges";
import { useNotify } from "@/shared/ui/notice-provider";
import { formatDay, todayLocal } from "./format";
import { normalize } from "./people";

export type MovementKind = "entrega" | "ingreso" | "ajuste";
type Line = { key: number; article_id: string; quantity: string };

const COPY = {
  entrega: {
    title: "Entregar EPP a un trabajador",
    hint: "Elige a quién se entrega y qué artículos recibe. La existencia se descuenta al confirmar.",
    icon: ClipboardCheck,
    button: "Confirmar entrega",
  },
  ingreso: {
    title: "Ingreso de material",
    hint: "Registra el material que llegó al almacén. Se suma a la existencia.",
    icon: PackagePlus,
    button: "Registrar ingreso",
  },
  ajuste: {
    title: "Ajuste de inventario",
    hint: "Corrige la existencia tras un conteo físico. Usa cantidades negativas para restar. El motivo es obligatorio.",
    icon: Scale,
    button: "Guardar ajuste",
  },
} as const;

const MAX_RESULTS = 5;
let lineCounter = 0;
const newLine = (articleId = ""): Line => ({ key: ++lineCounter, article_id: articleId, quantity: "1" });

export function MovementModal({
  site,
  kind,
  articles,
  employees,
  movements,
  presetArticleId,
  presetEmployee,
  onClose,
  onDone,
}: {
  site: string;
  kind: MovementKind;
  articles: EppArticle[];
  employees: EppEmployee[];
  movements: EppMovement[];
  presetArticleId?: number;
  presetEmployee?: EppEmployee | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { session, access } = useAuth();
  const notify = useNotify();
  const copy = COPY[kind];
  const Icon = copy.icon;
  const [lines, setLines] = useState<Line[]>(() => [newLine(presetArticleId ? String(presetArticleId) : "")]);
  const [employee, setEmployee] = useState<EppEmployee | null>(presetEmployee ?? null);
  const [query, setQuery] = useState("");
  // La fecha no se puede elegir: el servidor registra el día de hoy.
  const today = todayLocal();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectable = useMemo(
    // Un artículo con una compra sin contar no se mueve hasta el conteo (la base también lo bloquea).
    () =>
      articles.filter(
        (item) => item.pending_count === null && (kind === "ajuste" ? true : item.active) && (kind !== "entrega" || item.stock > 0),
      ),
    [articles, kind],
  );
  // Solo trabajadores de la sede del inventario (el servidor ya los filtra; esto es una segunda barrera).
  const siteEmployees = useMemo(() => employees.filter((item) => item.site === site), [employees, site]);
  const byId = useMemo(() => new Map(articles.map((item) => [item.id, item])), [articles]);
  const [highlight, setHighlight] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const indexed = useMemo(
    () => siteEmployees.map((item) => ({ item, name: normalize(item.full_name), code: normalize(item.employee_code) })),
    [siteEmployees],
  );
  const { matches, extra } = useMemo(() => {
    const tokens = normalize(deferredQuery).split(" ").filter(Boolean);
    if (tokens.length === 0) return { matches: [] as EppEmployee[], extra: 0 };
    const scored = indexed
      .filter((entry) => tokens.every((token) => entry.name.includes(token) || entry.code.includes(token)))
      .map((entry) => ({
        item: entry.item,
        // Primero los que empiezan con lo escrito, luego los que coinciden al inicio de alguna palabra.
        score: entry.name.startsWith(tokens[0] ?? "") || entry.code.startsWith(tokens[0] ?? "") ? 0 : entry.name.includes(` ${tokens[0]}`) ? 1 : 2,
      }))
      .sort((a, b) => a.score - b.score || a.item.full_name.localeCompare(b.item.full_name, "es"));
    return { matches: scored.slice(0, MAX_RESULTS).map((entry) => entry.item), extra: Math.max(0, scored.length - MAX_RESULTS) };
  }, [indexed, deferredQuery]);

  function pick(item: EppEmployee) {
    setEmployee(item);
    setQuery("");
    setHighlight(0);
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((value) => Math.min(value + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = matches[highlight] ?? matches[0];
      if (chosen) pick(chosen);
    }
  }

  function lastDelivery(articleId: number) {
    if (!employee) return null;
    return movements.find((m) => m.kind === "entrega" && m.article_id === articleId && (m.employee_id === employee.id || (m.employee_name ? normalize(m.employee_name) === normalize(employee.full_name) : false))) ?? null;
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError("");

    if (kind === "ajuste" && !access?.is_super_admin) return setError("Solo un Super administrador puede ajustar el inventario.");
    if (kind === "entrega" && !employee) return setError("Selecciona al trabajador que recibe el EPP.");
    if (kind === "entrega" && employee && employee.site !== site) return setError(`${employee.full_name} es de ${employee.site}; solo se le puede entregar EPP del inventario de su sede.`);
    const items = lines.map((line) => ({ article_id: Number(line.article_id), quantity: Math.trunc(Number(line.quantity)) }));
    if (items.some((item) => !item.article_id)) return setError("Elige el artículo en cada renglón.");
    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity === 0)) return setError("Escribe una cantidad válida.");
    if (kind !== "ajuste" && items.some((item) => item.quantity < 0)) return setError("Las cantidades deben ser mayores a cero.");
    if (new Set(items.map((item) => item.article_id)).size !== items.length) return setError("Un artículo está repetido; únelo en un solo renglón.");
    const locked = items.map((item) => byId.get(item.article_id)).find((item) => item?.pending_count);
    if (locked) return setError(`${locked.name} tiene pendiente el conteo de la compra folio ${locked.pending_count}. Haz el conteo antes de moverlo.`);
    if (kind === "entrega") {
      const short = items.find((item) => item.quantity > (byId.get(item.article_id)?.stock ?? 0));
      if (short) return setError(`Solo hay ${byId.get(short.article_id)?.stock ?? 0} de ${byId.get(short.article_id)?.name}.`);
    }
    if (kind === "ajuste" && !notes.trim()) return setError("Explica el motivo del ajuste.");

    setBusy(true);
    try {
      await requestApi(session, "/api/epp/movements", {
        method: "POST",
        body: JSON.stringify({ site, kind, items, employee_id: employee?.id ?? null, notes: notes.trim() || undefined }),
      });
      const units = items.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
      const names = items.map((item) => byId.get(item.article_id)?.name).filter(Boolean).join(", ");
      if (kind === "entrega") notify("success", "Entrega registrada", `${units} pieza(s) entregadas a ${employee?.full_name}: ${names}.`);
      else if (kind === "ingreso") notify("success", "Ingreso registrado", `Se sumaron ${units} pieza(s) al inventario de ${site}: ${names}.`);
      else notify("success", "Ajuste guardado", `Se corrigió la existencia de: ${names}.`);
      await onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo registrar el movimiento."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form epp-modal" role="dialog" aria-modal="true" aria-labelledby="epp-move-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Icon size={19} /></div>
          <div>
            <h2 id="epp-move-title">{copy.title} · {site}</h2>
            <p>{copy.hint}</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          {kind === "entrega" && (
            <div className="form-section">
              <h3>1. ¿A quién se entrega?</h3>
              {employee ? (
                <div className="epp-selected">
                  <div>
                    <strong title={employee.full_name}>{employee.full_name}</strong>
                    <small>{employee.employee_code} · {employee.position}</small>
                  </div>
                  <SiteBadge site={employee.site} />
                  <button type="button" className="text-button" onClick={() => { setEmployee(null); setQuery(""); }}>Cambiar</button>
                </div>
              ) : (
                <div className="epp-combo">
                  <div className="search-box epp-search">
                    <Search size={15} />
                    <input value={query} onChange={(e) => { setQuery(e.target.value); setHighlight(0); }} onKeyDown={onSearchKey} placeholder={`Escribe nombre o ID de un trabajador de ${site}`} autoFocus />
                    {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
                  </div>
                  {query.trim() && (
                    <ul className="epp-results epp-dropdown" role="listbox">
                      {matches.length === 0 && <li className="epp-empty">{employees.length === 0 ? "Cargando trabajadores…" : `Sin coincidencias entre los trabajadores activos de ${site}.`}</li>}
                      {matches.map((item, index) => (
                        <li key={item.id}>
                          <button type="button" className={index === highlight ? "active" : ""} onMouseEnter={() => setHighlight(index)} onClick={() => pick(item)}>
                            <strong title={item.full_name}>{item.full_name}</strong>
                            <small>{item.employee_code} · {item.position}</small>
                          </button>
                        </li>
                      ))}
                      {extra > 0 && <li className="epp-more">{extra} más… sigue escribiendo para acotar</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-section">
            <h3>{kind === "entrega" ? "2. ¿Qué recibe?" : "Artículos"}</h3>
            <div className="epp-lines">
              {lines.map((line) => {
                const article = byId.get(Number(line.article_id));
                const last = article ? lastDelivery(article.id) : null;
                return (
                  <div key={line.key} className="epp-line">
                    <Field label="Artículo">
                      <ArticlePicker
                        articles={selectable}
                        value={line.article_id}
                        taken={lines.filter((other) => other.key !== line.key).map((other) => other.article_id)}
                        onChange={(id) => updateLine(line.key, { article_id: id })}
                      />
                    </Field>
                    <Field label={kind === "ajuste" ? "Cantidad (+/−)" : "Cantidad"}>
                      <input type="number" step={1} min={kind === "ajuste" ? -100000 : 1} max={kind === "entrega" ? article?.stock : 100000} value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                    </Field>
                    <button type="button" className="icon-button row-edit" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={lines.length === 1} aria-label="Quitar renglón" title="Quitar"><Trash2 size={16} /></button>
                    {last && <small className="epp-hint">Última entrega de este artículo a {employee?.full_name.split(" ")[0]}: {formatDay(last.moved_on)} ({Math.abs(last.delta)} pza).</small>}
                  </div>
                );
              })}
            </div>
            <button type="button" className="button button-outline" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={15} /> Agregar otro artículo</button>
          </div>

          <div className="form-grid epp-meta">
            <Field label={kind === "entrega" ? "Fecha de entrega" : "Fecha"}>
              <div className="epp-fixed-date" title="La fecha la registra el sistema y no se puede cambiar.">
                <CalendarDays size={15} /> {formatDay(today)} <small>(hoy, del sistema)</small>
              </div>
            </Field>
            <Field label={kind === "ajuste" ? "Motivo del ajuste" : "Observaciones (opcional)"} required={kind === "ajuste"}>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder={kind === "ajuste" ? "Conteo físico, merma, corrección…" : kind === "ingreso" ? "Proveedor, factura…" : "Motivo de reposición, cambio por desgaste…"} />
            </Field>
          </div>

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><Check size={17} /> {busy ? "Guardando…" : copy.button}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** Buscador de artículos: escribe parte del nombre y elige entre máximo 5 coincidencias. */
function ArticlePicker({
  articles,
  value,
  taken,
  onChange,
}: {
  articles: EppArticle[];
  value: string;
  taken: string[];
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const selected = articles.find((item) => String(item.id) === value) ?? null;
  const indexed = useMemo(
    () => articles.map((item) => ({ item, text: normalize(`${item.name} ${item.size ?? ""} ${item.category}`) })),
    [articles],
  );
  const { matches, extra } = useMemo(() => {
    const tokens = normalize(query).split(" ").filter(Boolean);
    const found = indexed
      .filter((entry) => !taken.includes(String(entry.item.id)))
      .filter((entry) => tokens.every((token) => entry.text.includes(token)))
      .map((entry) => entry.item)
      .sort((a, b) => {
        const first = tokens[0] ?? "";
        const rank = (item: EppArticle) => (normalize(item.name).startsWith(first) ? 0 : 1);
        return rank(a) - rank(b) || a.name.localeCompare(b.name, "es");
      });
    return { matches: found.slice(0, MAX_RESULTS), extra: Math.max(0, found.length - MAX_RESULTS) };
  }, [indexed, query, taken]);

  const label = (item: EppArticle) => `${item.name}${item.size ? ` · ${item.size}` : ""}`;

  function choose(item: EppArticle) {
    onChange(String(item.id));
    setQuery("");
    setOpen(false);
    setHighlight(0);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") return setOpen(false);
    if (!open || matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = matches[highlight] ?? matches[0];
      if (chosen) choose(chosen);
    }
  }

  return (
    <div className="epp-combo">
      <div className="search-box epp-search">
        <Search size={15} />
        <input
          value={open ? query : selected ? `${label(selected)} (hay ${selected.stock})` : ""}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={selected ? label(selected) : "Escribe el nombre del artículo"}
          title={selected ? label(selected) : undefined}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
        />
      </div>
      {open && (
        <ul id={listId} className="epp-results epp-dropdown" role="listbox">
          {matches.length === 0 && <li className="epp-empty">{articles.length === 0 ? "No hay artículos disponibles en esta sede." : "Sin coincidencias."}</li>}
          {matches.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={index === highlight ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(item)}
              >
                <strong title={label(item)}>{label(item)}</strong>
                <small>{item.category} · hay {item.stock}</small>
              </button>
            </li>
          ))}
          {extra > 0 && <li className="epp-more">{extra} más… sigue escribiendo para acotar</li>}
        </ul>
      )}
    </div>
  );
}
