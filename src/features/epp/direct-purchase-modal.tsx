"use client";

import { Check, EyeOff, Plus, Trash2, Truck, X } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { eppArticleLabel, type EppArticle } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { BusyLabel } from "@/shared/ui/loading";
import { ArticlePicker } from "./article-picker";

type Line = { key: number; article_id: string; quantity: string };
let lineCounter = 0;

/**
 * Compra directa: Compras registra lo que compró sin que la sede lo haya pedido. La compra queda
 * "por contar": la sede cuenta a ciegas lo que llegó y solo eso entra al inventario.
 */
export function DirectPurchaseModal({
  site,
  articles,
  openRequests,
  onClose,
  onDone,
}: {
  site: string;
  articles: EppArticle[];
  /** Artículo → folio de una solicitud abierta en esta sede (se registra en esa solicitud, no aquí). */
  openRequests: Map<number, number>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  // Todos salen en el buscador; los ya pedidos o desactivados, en gris con la razón.
  const selectable = articles;
  const blockedReason = useCallback(
    (item: EppArticle) => {
      const folio = openRequests.get(item.id);
      if (folio) return `ya tiene una solicitud abierta (folio ${folio})`;
      if (!item.active) return "artículo desactivado";
      return null;
    },
    [openRequests],
  );
  const [lines, setLines] = useState<Line[]>(() => [{ key: ++lineCounter, article_id: "", quantity: "" }]);
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
    if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity < 1 || item.quantity > 100000)) {
      return setError("Escribe la cantidad comprada de cada artículo (1 o más).");
    }
    if (new Set(items.map((item) => item.article_id)).size !== items.length) return setError("Un artículo está repetido; únelo en un solo renglón.");

    setBusy(true);
    try {
      const result = await requestApi<{ id: number }>(session, "/api/epp/requests/direct", {
        method: "POST",
        body: JSON.stringify({ site, items, notes: notes.trim() || undefined }),
      });
      const units = items.reduce((sum, item) => sum + item.quantity, 0);
      notify("success", "Compra directa registrada", `Folio ${result.id} · ${units} pieza(s). ${site} debe contarlas al recibirlas.`);
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo registrar la compra directa."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form epp-modal" role="dialog" aria-modal="true" aria-labelledby="epp-direct-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><Truck size={19} /></div>
          <div>
            <h2 id="epp-direct-title">Compra directa · {site}</h2>
            <p>Registra lo que compraste sin solicitud previa. {site} tendrá que contarlo al recibirlo y solo lo contado entra al inventario.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <p className="epp-blind-note"><EyeOff size={15} /> Quien recibe no verá estas cantidades. Si cuenta menos, te llegará un aviso de faltante.</p>
          <div className="form-section">
            <h3>¿Qué se compró?</h3>
            <div className="epp-lines">
              {lines.map((line) => {
                return (
                  <div key={line.key} className="epp-line">
                    <Field label="Artículo">
                      <ArticlePicker
                        articles={selectable}
                        blocked={(item) => (String(item.id) === line.article_id ? null : blockedReason(item))}
                        value={line.article_id}
                        taken={lines.filter((other) => other.key !== line.key).map((other) => other.article_id)}
                        detail={(item) => `${item.category} · ${item.unit.toLowerCase()}`}
                        selectedText={(item) => `${eppArticleLabel(item.name, item.size)} (${item.unit.toLowerCase()})`}
                        onChange={(id) => updateLine(line.key, { article_id: id })}
                      />
                    </Field>
                    <Field label="Comprado">
                      <input type="number" step={1} min={1} max={100000} inputMode="numeric" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} />
                    </Field>
                    <button type="button" className="icon-button row-edit" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={lines.length === 1} aria-label="Quitar renglón" title="Quitar"><Trash2 size={16} /></button>
                  </div>
                );
              })}
            </div>
            <button type="button" className="button button-outline" onClick={() => setLines((current) => [...current, { key: ++lineCounter, article_id: "", quantity: "" }])} disabled={lines.length >= 80}>
              <Plus size={15} /> Agregar otro artículo
            </button>
            {openRequests.size > 0 && (
              <p className="epp-muted epp-note">{openRequests.size} artículo(s) ya tienen una solicitud abierta en {site}: registra su compra en esa solicitud.</p>
            )}
          </div>

          <div className="form-grid epp-meta-wide">
            <Field label="Observaciones (opcional)">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Proveedor, factura, fecha de llegada…" />
            </Field>
          </div>

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><Check size={16} /> {busy ? <BusyLabel>Guardando…</BusyLabel> : "Registrar compra directa"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
