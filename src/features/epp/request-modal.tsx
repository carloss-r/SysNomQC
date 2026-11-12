"use client";

import { Plus, Send, ShoppingCart, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { EppArticle } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";

type Line = { key: number; article_id: string; quantity: string };
let lineCounter = 0;

/** Cantidad sugerida: lo necesario para llegar al doble del mínimo. */
export function suggestedQuantity(article: EppArticle) {
  return Math.max(1, article.min_stock * 2 - article.stock);
}

export function RequestModal({
  site,
  articles,
  presetIds,
  openRequests,
  onClose,
  onDone,
}: {
  site: string;
  articles: EppArticle[];
  presetIds: number[];
  /** Artículo → folio de una solicitud abierta en esta sede (no se pueden volver a pedir). */
  openRequests: Map<number, number>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const byId = useMemo(() => new Map(articles.map((item) => [item.id, item])), [articles]);
  const selectable = useMemo(() => articles.filter((item) => item.active && !openRequests.has(item.id)), [articles, openRequests]);
  const [lines, setLines] = useState<Line[]>(() => {
    const preset = presetIds.map((id) => byId.get(id)).filter((item): item is EppArticle => Boolean(item) && !openRequests.has(item!.id));
    if (preset.length === 0) return [{ key: ++lineCounter, article_id: "", quantity: "1" }];
    return preset.map((item) => ({ key: ++lineCounter, article_id: String(item.id), quantity: String(suggestedQuantity(item)) }));
  });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError("");
    const items = lines.map((line) => ({ article_id: Number(line.article_id), quantity: Math.trunc(Number(line.quantity)) }));
    if (items.some((item) => !item.article_id)) return setError("Elige el artículo en cada renglón.");
    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity < 1)) return setError("Las cantidades deben ser 1 o más.");
    if (new Set(items.map((item) => item.article_id)).size !== items.length) return setError("Un artículo está repetido; únelo en un solo renglón.");

    setBusy(true);
    try {
      const result = await requestApi<{ id: number }>(session, "/api/epp/requests", {
        method: "POST",
        body: JSON.stringify({ site, items, notes: notes.trim() || undefined }),
      });
      notify("success", "Solicitud enviada a compras", `Folio ${result.id}: ${items.length} artículo(s) para ${site}. Compras ya puede verla.`);
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo enviar la solicitud."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form epp-modal" role="dialog" aria-modal="true" aria-labelledby="epp-request-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><ShoppingCart size={19} /></div>
          <div>
            <h2 id="epp-request-title">Pedir material · {site}</h2>
            <p>La solicitud le llega al encargado de compras, que puede descargarla en PDF.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <div className="form-section">
            <h3>¿Qué hace falta?</h3>
            <div className="epp-lines">
              {lines.map((line) => {
                const article = byId.get(Number(line.article_id));
                return (
                  <div key={line.key} className="epp-line">
                    <Field label="Artículo">
                      <select value={line.article_id} onChange={(e) => {
                        const next = byId.get(Number(e.target.value));
                        updateLine(line.key, { article_id: e.target.value, quantity: next ? String(suggestedQuantity(next)) : line.quantity });
                      }}>
                        <option value="">Selecciona…</option>
                        {(article && !selectable.includes(article) ? [article, ...selectable] : selectable).map((item) => (
                          <option key={item.id} value={item.id}>{item.name} (hay {item.stock}, mín. {item.min_stock})</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Cantidad">
                      <input type="number" step={1} min={1} max={100000} value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                    </Field>
                    <button type="button" className="icon-button row-edit" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={lines.length === 1} aria-label="Quitar renglón" title="Quitar"><Trash2 size={16} /></button>
                    {article && <small className="epp-hint">Hay {article.stock} {article.unit.toLowerCase()} en {site}; el mínimo es {article.min_stock}. Sugerido: {suggestedQuantity(article)}.</small>}
                  </div>
                );
              })}
            </div>
            <button type="button" className="button button-outline" onClick={() => setLines((current) => [...current, { key: ++lineCounter, article_id: "", quantity: "1" }])} disabled={lines.length >= 80}>
              <Plus size={15} /> Agregar otro artículo
            </button>
            {openRequests.size > 0 && <p className="epp-muted epp-note">{openRequests.size} artículo(s) ya tienen una solicitud abierta y no aparecen en la lista.</p>}
          </div>

          <div className="form-grid epp-meta-wide">
            <Field label="Observaciones para compras (opcional)">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Urgencia, marca preferida, tallas…" />
            </Field>
          </div>

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><Send size={16} /> {busy ? "Enviando…" : "Enviar a compras"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
