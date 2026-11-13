"use client";

import { CalendarDays, Check, UserMinus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { describeError, requestApi } from "@/lib/api-client";
import { formatDate, type Employee } from "@/lib/employees";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { BusyLabel } from "@/shared/ui/loading";

/** Hoy en hora de Campeche (YYYY-MM-DD), como valor inicial del día de baja. */
function todayPlant() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Merida" }).format(new Date());
}

/**
 * Dar de baja: el día de baja lo captura el usuario (puede ser hoy u otro día) y el motivo es opcional.
 * La fecha de registro en el sistema la pone la base al guardar; ambas pueden coincidir.
 */
export function TerminationModal({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee;
  onClose: () => void;
  onDone: (updated: Employee) => void;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const today = todayPlant();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    if (!date) return setError("Escribe el día de baja.");
    if (date < employee.hire_date) return setError(`El día de baja no puede ser anterior a la contratación (${formatDate(employee.hire_date)}).`);
    setBusy(true);
    setError("");
    try {
      const updated = await requestApi<Employee>(session, `/api/employees/${employee.id}/baja`, {
        method: "POST",
        body: JSON.stringify({ termination_date: date, termination_reason: reason.trim() || undefined }),
      });
      notify("success", "Baja registrada", `${employee.full_name} quedó dado de baja con fecha ${formatDate(date)}.`);
      onDone(updated);
    } catch (err) {
      setError(describeError(err, "No se pudo registrar la baja."));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="termination-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><UserMinus size={19} /></div>
          <div>
            <h2 id="termination-title">Dar de baja · {employee.full_name}</h2>
            <p>{employee.employee_code} · {employee.site}. El trabajador quedará inactivo; se puede reactivar después.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Día de baja" required>
              <input type="date" value={date} min={employee.hire_date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label="Fecha de registro en el sistema">
              <div className="epp-fixed-date" title="La pone el sistema al guardar y no se puede cambiar.">
                <CalendarDays size={15} /> {formatDate(today)} <small>(al guardar)</small>
              </div>
            </Field>
            <Field label="Motivo de la baja (opcional)">
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} placeholder="Renuncia voluntaria, término de contrato…" />
            </Field>
          </div>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-danger-outline" disabled={busy}>
              <Check size={17} /> {busy ? <BusyLabel>Guardando…</BusyLabel> : "Registrar baja"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
