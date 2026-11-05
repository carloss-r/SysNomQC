"use client";

import { Check, ClipboardCheck, PackagePlus, Plus, Scale, Search, Trash2, X } from "lucide-react";
import { useDeferredValue, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { EppArticle, EppEmployee, EppMovement } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { SiteBadge } from "@/shared/ui/badges";
import { useNotify } from "@/shared/ui/notice-provider";
import { formatDay, todayLocal } from "./format";

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
/** Minúsculas y sin acentos, para que "jose" encuentre "José". */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

let lineCounter = 0;
const newLine = (articleId = ""): Line => ({ key: ++lineCounter, article_id: articleId, quantity: "1" });

export function MovementModal({
  kind,
  articles,
  employees,
  movements,
  presetArticleId,
  onClose,
  onDone,
}: {
  kind: MovementKind;
  articles: EppArticle[];
  employees: EppEmployee[];
  movements: EppMovement[];
  presetArticleId?: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const copy = COPY[kind];
  const Icon = copy.icon;
  const [lines, setLines] = useState<Line[]>([newLine(presetArticleId ? String(presetArticleId) : "")]);
  const [employee, setEmployee] = useState<EppEmployee | null>(null);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectable = useMemo(
    () => articles.filter((item) => (kind === "ajuste" ? true : item.active) && (kind !== "entrega" || item.stock > 0)),
    [articles, kind],
  );
  const byId = useMemo(() => new Map(articles.map((item) => [item.id, item])), [articles]);
  const [highlight, setHighlight] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const indexed = useMemo(
    () => employees.map((item) => ({ item, name: normalize(item.full_name), code: normalize(item.employee_code) })),
    [employees],
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
    return movements.find((m) => m.kind === "entrega" && m.employee_id === employee.id && m.article_id === articleId) ?? null;
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError("");

    if (kind === "entrega" && !employee) return setError("Selecciona al trabajador que recibe el EPP.");
    const items = lines.map((line) => ({ article_id: Number(line.article_id), quantity: Math.trunc(Number(line.quantity)) }));
    if (items.some((item) => !item.article_id)) return setError("Elige el artículo en cada renglón.");
    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity === 0)) return setError("Escribe una cantidad válida.");
    if (kind !== "ajuste" && items.some((item) => item.quantity < 0)) return setError("Las cantidades deben ser mayores a cero.");
    if (new Set(items.map((item) => item.article_id)).size !== items.length) return setError("Un artículo está repetido; únelo en un solo renglón.");
    if (kind === "entrega") {
      const short = items.find((item) => item.quantity > (byId.get(item.article_id)?.stock ?? 0));
      if (short) return setError(`Solo hay ${byId.get(short.article_id)?.stock ?? 0} de ${byId.get(short.article_id)?.name}.`);
    }
    if (kind === "ajuste" && !notes.trim()) return setError("Explica el motivo del ajuste.");

    setBusy(true);
    try {
      await requestApi(session, "/api/epp/movements", {
        method: "POST",
        body: JSON.stringify({ kind, items, employee_id: employee?.id ?? null, moved_on: date, notes: notes.trim() || undefined }),
      });
      const units = items.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
      const names = items.map((item) => byId.get(item.article_id)?.name).filter(Boolean).join(", ");
      if (kind === "entrega") notify("success", "Entrega registrada", `${units} pieza(s) entregadas a ${employee?.full_name}: ${names}.`);
      else if (kind === "ingreso") notify("success", "Ingreso registrado", `Se sumaron ${units} pieza(s) al inventario: ${names}.`);
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
            <h2 id="epp-move-title">{copy.title}</h2>
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
                    <strong>{employee.full_name}</strong>
                    <small>{employee.employee_code} · {employee.position}</small>
                  </div>
                  <SiteBadge site={employee.site} />
                  <button type="button" className="text-button" onClick={() => { setEmployee(null); setQuery(""); }}>Cambiar</button>
                </div>
              ) : (
                <>
                  <div className="search-box epp-search">
                    <Search size={15} />
                    <input value={query} onChange={(e) => { setQuery(e.target.value); setHighlight(0); }} onKeyDown={onSearchKey} placeholder="Escribe nombre o ID del trabajador" autoFocus />
                  </div>
                  {query.trim() && (
                    <ul className="epp-results">
                      {matches.length === 0 && <li className="epp-empty">{employees.length === 0 ? "Cargando trabajadores…" : "Sin coincidencias entre los trabajadores activos."}</li>}
                      {matches.map((item, index) => (
                        <li key={item.id}>
                          <button type="button" className={index === highlight ? "active" : ""} onMouseEnter={() => setHighlight(index)} onClick={() => pick(item)}>
                            <strong>{item.full_name}</strong>
                            <small>{item.employee_code} · {item.position} · {item.site}</small>
                          </button>
                        </li>
                      ))}
                      {extra > 0 && <li className="epp-more">{extra} más… sigue escribiendo para acotar</li>}
                    </ul>
                  )}
                </>
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
                      <select value={line.article_id} onChange={(e) => updateLine(line.key, { article_id: e.target.value })}>
                        <option value="">Selecciona…</option>
                        {selectable.map((item) => (
                          <option key={item.id} value={item.id}>{item.name} (hay {item.stock})</option>
                        ))}
                      </select>
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
            <Field label={kind === "entrega" ? "Fecha de entrega" : "Fecha"} required>
              <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} required />
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
