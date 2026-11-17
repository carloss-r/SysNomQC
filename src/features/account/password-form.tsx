"use client";

import { Check, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { describeError, requestApi } from "@/lib/api-client";
import { MIN_PASSWORD_LENGTH } from "@/lib/permissions";
import { Field } from "@/shared/ui/field";
import { BusyLabel } from "@/shared/ui/loading";
import { useNotify } from "@/shared/ui/notice-provider";

/**
 * Cambiar la contraseña de la propia cuenta: la nueva y su confirmación. La actual es opcional
 * (si se escribe se verifica; si no se recuerda se deja vacía).
 */
export function PasswordForm({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { session, refreshAccess } = useAuth();
  const notify = useNotify();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const longEnough = next.length >= MIN_PASSWORD_LENGTH;
  const matches = next.length > 0 && next === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError("");
    if (!longEnough) return setError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (!matches) return setError("La confirmación no coincide con la nueva contraseña.");
    if (current && next === current) return setError("La nueva contraseña debe ser distinta de la actual.");
    setBusy(true);
    try {
      await requestApi(session, "/api/me/password", {
        method: "POST",
        body: JSON.stringify({ ...(current ? { current_password: current } : {}), new_password: next }),
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      notify("success", "Contraseña actualizada", "La próxima vez entra con tu nueva contraseña.");
      await refreshAccess({ must_change_password: false }).catch(() => undefined);
      onDone?.();
    } catch (err) {
      setError(describeError(err, "No se pudo cambiar la contraseña."));
    } finally {
      setBusy(false);
    }
  }

  const type = show ? "text" : "password";
  return (
    <form className="employee-form account-form" onSubmit={submit}>
      <Field label={forced ? "Contraseña temporal (opcional)" : "Contraseña actual (opcional)"}>
        <input type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={72} placeholder="Déjala vacía si no la recuerdas" />
      </Field>
      <div className="form-grid">
        <Field label={`Nueva contraseña (mín. ${MIN_PASSWORD_LENGTH})`} required>
          <input type={type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={MIN_PASSWORD_LENGTH} maxLength={72} required />
        </Field>
        <Field label="Confirmar nueva contraseña" required>
          <input type={type} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={72} required />
        </Field>
      </div>
      <ul className="password-checks" aria-live="polite">
        <li className={longEnough ? "ok" : ""}><Check size={13} /> Al menos {MIN_PASSWORD_LENGTH} caracteres</li>
        <li className={matches ? "ok" : ""}><Check size={13} /> La confirmación coincide</li>
      </ul>
      <button type="button" className="text-button account-show" onClick={() => setShow((value) => !value)}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />} {show ? "Ocultar contraseñas" : "Mostrar contraseñas"}
      </button>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="submit" className="button button-gold" disabled={busy}>
          <KeyRound size={16} /> {busy ? <BusyLabel>Guardando…</BusyLabel> : "Cambiar contraseña"}
        </button>
      </div>
    </form>
  );
}
