"use client";

import { BriefcaseBusiness, Check, CircleUserRound, ClipboardList, ImagePlus, MapPin, UserRound, X } from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import {
  CONTRACT_TYPES,
  EMPTY_EMPLOYEE_FORM,
  employeeToForm,
  formToEmployeeInput,
  GENDERS,
  MARITAL_STATUSES,
  SITES,
  type Employee,
  type EmployeeFormValues,
  type EmployeeInput,
} from "@/lib/employees";
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_ORIGINAL_PHOTO_BYTES,
  compressPhoto,
  deleteEmployeePhoto,
  formatBytes,
  uploadEmployeePhoto,
} from "@/lib/photos";
import { reportClientIncident } from "@/lib/report-incident";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { usePhotoUrl } from "../hooks/use-photo-url";

class PhotoUploadError extends Error {}

type NewPhoto = { blob: Blob; previewUrl: string; originalSize: number };

function FormSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="form-section"><h3>{icon}{title}</h3>{children}</section>;
}

export function EmployeeFormModal({
  editing,
  suggestedCode,
  positionSuggestions,
  onClose,
  onSaved,
}: {
  editing: Employee | null;
  suggestedCode: string;
  positionSuggestions: string[];
  onClose: () => void;
  onSaved: (saved: Employee, isEdit: boolean) => void;
}) {
  const { session } = useAuth();
  const notify = useNotify();
  const [form, setForm] = useState<EmployeeFormValues>(() =>
    editing ? employeeToForm(editing) : { ...EMPTY_EMPLOYEE_FORM, employee_code: suggestedCode },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newPhoto, setNewPhoto] = useState<NewPhoto | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const previewRef = useRef<string | null>(null);
  const currentPhotoUrl = usePhotoUrl(editing?.photo_path);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  function updateForm<K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function requestClose() {
    if (!busy) onClose();
  }

  function discardNewPhoto() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setNewPhoto(null);
  }

  // La foto se comprime en el navegador (máx. 800 px, JPEG, sin metadatos EXIF) antes de subirla.
  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setError("La foto debe ser JPG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_ORIGINAL_PHOTO_BYTES) {
      setError(`La foto original no debe pesar más de ${formatBytes(MAX_ORIGINAL_PHOTO_BYTES)}.`);
      return;
    }

    setPhotoProcessing(true);
    setError("");
    try {
      const blob = await compressPhoto(file);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const previewUrl = URL.createObjectURL(blob);
      previewRef.current = previewUrl;
      setNewPhoto({ blob, previewUrl, originalSize: file.size });
      setRemovePhoto(false);
    } catch (photoError) {
      console.error("No se pudo comprimir la foto:", photoError);
      setError(photoError instanceof Error ? photoError.message : "No se pudo procesar la foto.");
    } finally {
      setPhotoProcessing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    const isEdit = editing !== null;
    let uploadedPath: string | null = null;

    try {
      const previousPath = editing?.photo_path ?? null;
      let photoPath = removePhoto ? null : previousPath;

      if (newPhoto) {
        try {
          uploadedPath = await uploadEmployeePhoto(newPhoto.blob);
        } catch (uploadError) {
          console.error("No se pudo subir la foto:", uploadError);
          reportClientIncident("foto · subir", uploadError);
          throw new PhotoUploadError("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.");
        }
        photoPath = uploadedPath;
      }

      const payload: EmployeeInput = formToEmployeeInput(form, photoPath);
      const saved = isEdit
        ? await requestApi<Employee>(session, `/api/employees/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await requestApi<Employee>(session, "/api/employees", {
            method: "POST",
            body: JSON.stringify(payload),
          });

      // La foto anterior ya no se usa: se elimina del bucket.
      if (previousPath && previousPath !== photoPath) void deleteEmployeePhoto(previousPath);

      onSaved(saved, isEdit);
      notify(
        "success",
        isEdit ? "Empleado actualizado" : "Empleado registrado",
        `${saved.full_name} (${saved.employee_code}) se guardó correctamente.`,
      );
    } catch (saveError) {
      console.error("No se pudo guardar el empleado:", saveError);
      if (uploadedPath) void deleteEmployeePhoto(uploadedPath);
      const message =
        saveError instanceof PhotoUploadError
          ? saveError.message
          : describeError(saveError, "No se pudo guardar el empleado.");
      setError(message);
      notify("error", "No se pudo guardar el empleado", message);
      if (!(saveError instanceof ApiError) && !(saveError instanceof PhotoUploadError)) {
        reportClientIncident("empleado · guardar", saveError);
      }
      setBusy(false);
    }
  }

  const photoPreview = newPhoto?.previewUrl ?? (!removePhoto && editing?.photo_path ? currentPhotoUrl : undefined);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="employee-form-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><UserRound size={19} /></div>
          <div>
            <h2 id="employee-form-title">{editing ? "Editar empleado" : "Alta de nuevo empleado"}</h2>
            <p>Completa la información del expediente. Los campos con * son obligatorios.</p>
          </div>
          <button className="icon-button close-modal" onClick={requestClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>

        <form className="employee-form" onSubmit={handleSubmit}>
          <FormSection title="Datos laborales" icon={<BriefcaseBusiness size={16} />}>
            <div className="form-grid">
              <Field label="ID empleado" required><input value={form.employee_code} onChange={(event) => updateForm("employee_code", event.target.value)} maxLength={30} required /></Field>
              <Field label="Nombre completo" required><input value={form.full_name} onChange={(event) => updateForm("full_name", event.target.value)} maxLength={150} required /></Field>
              <Field label="Sede asignada" required>
                <select value={form.site} onChange={(event) => updateForm("site", event.target.value)} required>{SITES.map((site) => <option key={site}>{site}</option>)}</select>
              </Field>
              <Field label="Fecha de contratación" required><input type="date" value={form.hire_date} onChange={(event) => updateForm("hire_date", event.target.value)} required /></Field>
              <Field label="Área / departamento / puesto" required>
                <input
                  list="position-suggestions"
                  value={form.position}
                  onChange={(event) => updateForm("position", event.target.value)}
                  maxLength={150}
                  placeholder="Ej. Operaciones - Operador Especializado"
                  autoComplete="off"
                  required
                />
                <datalist id="position-suggestions">
                  {positionSuggestions.map((position) => <option key={position} value={position} />)}
                </datalist>
              </Field>
              <Field label="Tipo de contrato" required>
                <select value={form.contract_type} onChange={(event) => updateForm("contract_type", event.target.value)} required>{CONTRACT_TYPES.map((contract) => <option key={contract}>{contract}</option>)}</select>
              </Field>
              <Field label="Salario base (MXN)"><input type="number" min="0" step="0.01" value={form.salary} onChange={(event) => updateForm("salary", event.target.value)} placeholder="0.00" /></Field>
              <Field label="Salario de cotización (MXN)"><input type="number" min="0" step="0.01" value={form.contribution_salary} onChange={(event) => updateForm("contribution_salary", event.target.value)} placeholder="Sin capturar" /></Field>
              <Field label="Cuenta bancaria / CLABE"><input value={form.bank_account} onChange={(event) => updateForm("bank_account", event.target.value)} maxLength={20} placeholder="Opcional" /></Field>
              {/* El estatus ya no se elige aquí: se cambia con "Dar de baja" / "Reactivar" en el expediente. */}
              {editing && !editing.active && (
                <Field label="Estatus">
                  <div className="field-hint">{editing.termination_date ? "Dado de baja" : "Inactivo"} · se reactiva desde el expediente.</div>
                </Field>
              )}
            </div>
          </FormSection>

          <FormSection title="Información personal" icon={<CircleUserRound size={16} />}>
            <div className="form-grid">
              <Field label="Género"><select value={form.gender} onChange={(event) => updateForm("gender", event.target.value)}><option value="">No especificado</option>{GENDERS.map((gender) => <option key={gender}>{gender}</option>)}</select></Field>
              <Field label="NSS"><input value={form.nss} onChange={(event) => updateForm("nss", event.target.value.replace(/\D/g, ""))} maxLength={11} inputMode="numeric" placeholder="11 dígitos" /></Field>
              <Field label="CURP"><input value={form.curp} onChange={(event) => updateForm("curp", event.target.value.toUpperCase())} maxLength={18} /></Field>
              <Field label="RFC"><input value={form.rfc} onChange={(event) => updateForm("rfc", event.target.value.toUpperCase())} maxLength={13} /></Field>
              <Field label="Estado civil"><select value={form.marital_status} onChange={(event) => updateForm("marital_status", event.target.value)}><option value="">No especificado</option>{MARITAL_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
              <Field label="Fecha de nacimiento"><input type="date" value={form.birth_date} onChange={(event) => updateForm("birth_date", event.target.value)} /></Field>
              <Field label="Créditos activos">
                <div className="credit-options">
                  {["Fonacot", "Infonavit"].map((credit) => (
                    <label className="checkbox-option" key={credit}>
                      <input
                        type="checkbox"
                        checked={form.credits.includes(credit)}
                        onChange={(event) => updateForm("credits", event.target.checked ? [...form.credits, credit] : form.credits.filter((item) => item !== credit))}
                      />
                      {credit}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </FormSection>

          <FormSection title="Contacto y domicilio" icon={<MapPin size={16} />}>
            <div className="form-grid">
              <Field label="Correo electrónico"><input type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} maxLength={100} /></Field>
              <Field label="Teléfono"><input type="tel" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} maxLength={20} /></Field>
              <Field label="Estado de residencia"><input value={form.residence_state} onChange={(event) => updateForm("residence_state", event.target.value)} maxLength={80} /></Field>
              <Field label="Dirección"><input value={form.address} onChange={(event) => updateForm("address", event.target.value)} maxLength={500} placeholder="Calle, número, colonia y código postal" /></Field>
            </div>
          </FormSection>

          <FormSection title="Observaciones del expediente" icon={<ClipboardList size={16} />}>
            <Field label="Observaciones">
              <textarea
                value={form.observations}
                onChange={(event) => updateForm("observations", event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Documentación faltante o cualquier detalle a dar seguimiento (ej. falta acta de nacimiento, comprobante de domicilio vencido…)"
              />
            </Field>
            <span className="field-hint">
              Si escribes algo, el trabajador aparecerá en la pestaña «Seguimiento de expedientes». Deja el cuadro vacío cuando quede resuelto.
            </span>
          </FormSection>

          <FormSection title="Fotografía" icon={<ImagePlus size={16} />}>
            <div className="photo-control">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="photo-preview" src={photoPreview} alt="Vista previa de la fotografía" width={58} height={58} />
              ) : <div className="photo-placeholder"><ImagePlus size={22} /></div>}
              <div className="photo-input-area">
                <label className="button button-outline file-button">
                  <ImagePlus size={16} /> {photoProcessing ? "Comprimiendo…" : "Elegir foto"}
                  <input type="file" accept={ACCEPTED_PHOTO_TYPES.join(",")} onChange={(event) => void handlePhotoChange(event)} disabled={photoProcessing || busy} />
                </label>
                <span className="field-hint">
                  {newPhoto
                    ? `Comprimida: ${formatBytes(newPhoto.blob.size)} (original ${formatBytes(newPhoto.originalSize)})`
                    : "Opcional · JPG, PNG o WebP · Se comprime antes de subirse"}
                </span>
                {(newPhoto || (editing?.photo_path && !removePhoto)) && (
                  <button
                    type="button"
                    className="text-button remove-photo"
                    onClick={() => {
                      if (newPhoto) discardNewPhoto();
                      else setRemovePhoto(true);
                    }}
                  >
                    {newPhoto ? "Descartar foto nueva" : "Quitar foto actual"}
                  </button>
                )}
                {removePhoto && !newPhoto && <span className="field-hint remove-photo">La foto actual se eliminará al guardar.</span>}
              </div>
            </div>
          </FormSection>

          {error && <p className="inline-error form-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={requestClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}>
              {busy ? <span className="spinner spinner-light" /> : <Check size={17} />}
              {busy ? "Guardando…" : editing ? "Guardar cambios" : "Guardar empleado"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
