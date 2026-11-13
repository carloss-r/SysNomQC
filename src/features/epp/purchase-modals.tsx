"use client";

import { Check, ClipboardList, EyeOff, ShoppingCart, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { EppPurchaseRequest } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useDialog } from "@/shared/ui/dialog-provider";
import { useNotify } from "@/shared/ui/notice-provider";
import { BusyLabel } from "@/shared/ui/loading";

type Props = { request: EppPurchaseRequest; onClose: () => void; onDone: () => Promise<void> | void };

function Shell({ title, hint, icon, busy, error, submitLabel, onClose, onSubmit, children }: {
  title: string;
  hint: string;
  icon: ReactNode;
  busy: boolean;
  error: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form epp-modal" role="dialog" aria-modal="true" aria-labelledby="epp-purchase-title">
        <div className="modal-header">
          <div className="modal-heading-icon">{icon}</div>
          <div>
            <h2 id="epp-purchase-title">{title}</h2>
            <p>{hint}</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={onSubmit}>
          {children}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><Check size={17} /> {busy ? <BusyLabel>Guardando…</BusyLabel> : submitLabel}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

const parse = (value: string) => (value.trim() === "" ? null : Number(value));
const validQty = (value: number | null) => value !== null && Number.isInteger(value) && value >= 0 && value <= 100000;

/** Compras captura cuánto compró de cada artículo. Esa cantidad no la ve quien recibe. */
export function BuyModal({ request, onClose, onDone }: Props) {
  const { session } = useAuth();
  const notify = useNotify();
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(request.items.map((item) => [item.article_id, String(item.purchased_qty ?? item.quantity)])),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const items = request.items.map((item) => ({ article_id: item.article_id, quantity: parse(values[item.article_id] ?? "") }));
    if (items.some((item) => !validQty(item.quantity))) return setError("Escribe la cantidad comprada de cada artículo (0 si no se consiguió).");
    if (items.every((item) => item.quantity === 0)) return setError("Si no se compró nada, cancela la solicitud.");
    setBusy(true);
    setError("");
    try {
      await requestApi(session, `/api/epp/requests/${request.id}/purchase`, {
        method: "POST",
        body: JSON.stringify({ items, note: note.trim() || undefined }),
      });
      const units = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      notify("success", "Compra registrada", `Folio ${request.id} · ${units} pieza(s). ${request.site} debe contarlas al recibirlas.`);
      await onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo registrar la compra."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title={`Registrar compra · folio ${request.id}`}
      hint={`Captura cuánto compraste para ${request.site}. Quien recibe no verá esta cantidad: tendrá que contar lo que llegue y, si cuenta menos, te llegará un aviso.`}
      icon={<ShoppingCart size={19} />}
      busy={busy}
      error={error}
      submitLabel="Registrar compra"
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="form-section">
        <h3>Cantidad comprada</h3>
        <div className="epp-lines">
          {request.items.map((item) => (
            <div key={item.article_id} className="epp-line epp-count-line">
              <div>
                <strong>{item.article_name}</strong>
                <small className="epp-muted">Se pidieron {item.quantity} {item.unit.toLowerCase()}</small>
              </div>
              <Field label="Comprado">
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  value={values[item.article_id] ?? ""}
                  onChange={(e) => setValues((current) => ({ ...current, [item.article_id]: e.target.value }))}
                />
              </Field>
            </div>
          ))}
        </div>
      </div>
      <Field label="Observaciones (opcional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Proveedor, factura, fecha estimada de llegada…" />
      </Field>
    </Shell>
  );
}

/**
 * Conteo ciego: quien recibe captura lo que contó sin ver lo comprado. Se puede contar por artículo;
 * el que se cuenta se suma a la existencia y se libera. Un conteo guardado ya no se cambia.
 */
export function CountModal({ request, onClose, onDone }: Props) {
  const { session } = useAuth();
  const notify = useNotify();
  const dialog = useDialog();
  const pending = request.items.filter((item) => item.received_qty === null);
  const [values, setValues] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const items = pending
      .map((item) => ({ article_id: item.article_id, name: item.article_name, quantity: parse(values[item.article_id] ?? "") }))
      .filter((item) => item.quantity !== null);
    if (items.length === 0) return setError("Escribe lo que contaste de al menos un artículo (0 si no llegó).");
    if (items.some((item) => !validQty(item.quantity))) return setError("Los conteos deben ser números enteros, cero o mayores.");
    const left = pending.length - items.length;
    const ok = await dialog.confirm({
      title: "Confirmar conteo",
      message:
        `${items.map((item) => `${item.name}: ${item.quantity}`).join(" · ")}. ` +
        "El conteo no se puede cambiar después." +
        (left > 0 ? ` Quedarán ${left} artículo(s) sin contar y bloqueados.` : ""),
      confirmLabel: "Guardar conteo",
      cancelLabel: "Revisar",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestApi(session, `/api/epp/requests/${request.id}/count`, {
        method: "POST",
        body: JSON.stringify({ items: items.map(({ article_id, quantity }) => ({ article_id, quantity })), note: note.trim() || undefined }),
      });
      const units = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
      notify(
        "success",
        left > 0 ? "Conteo parcial guardado" : "Conteo completo",
        `Folio ${request.id} · se sumaron ${units} pieza(s) a ${request.site}.${left > 0 ? ` Faltan ${left} artículo(s) por contar.` : ""}`,
      );
      await onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo guardar el conteo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title={`Contar lo que llegó · folio ${request.id}`}
      hint={`Cuenta físicamente cada artículo que llegó a ${request.site} y escribe la cantidad. Hasta contarlo no se puede entregar ni mover.`}
      icon={<ClipboardList size={19} />}
      busy={busy}
      error={error}
      submitLabel="Guardar conteo"
      onClose={onClose}
      onSubmit={submit}
    >
      <p className="epp-blind-note"><EyeOff size={15} /> Conteo ciego: la cantidad comprada no se muestra. Deja en blanco lo que aún no cuentas.</p>
      <div className="form-section">
        <h3>Conteo</h3>
        <div className="epp-lines">
          {pending.map((item) => (
            <div key={item.article_id} className="epp-line epp-count-line">
              <div>
                <strong>{item.article_name}</strong>
                <small className="epp-muted">{item.unit.toLowerCase()}</small>
              </div>
              <Field label="Contado">
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step={1}
                  inputMode="numeric"
                  placeholder="Sin contar"
                  value={values[item.article_id] ?? ""}
                  onChange={(e) => setValues((current) => ({ ...current, [item.article_id]: e.target.value }))}
                />
              </Field>
            </div>
          ))}
        </div>
      </div>
      <Field label="Observaciones (opcional)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Empaque dañado, llegó en dos entregas…" />
      </Field>
    </Shell>
  );
}
