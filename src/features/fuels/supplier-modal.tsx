"use client";

import { Building2, FileUp, FlaskConical, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError, requestApi } from "@/lib/api-client";
import { QUALITY_LIMITS, qualityProblems, RFC_PATTERN, type FuelSupplier } from "@/lib/fuels";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useNotify } from "@/shared/ui/notice-provider";
import { parseNumber } from "./format";
import { permitFileProblem, removePermit, uploadPermit } from "./permits";

type ProductDraft = { key: string; id: number | null; name: string; calorific_value: string; chlorine_pct: string; water_pct: string; sulfur_pct: string };

let counter = 0;
const draftKey = () => `p${(counter += 1)}`;
const emptyProduct = (): ProductDraft => ({ key: draftKey(), id: null, name: "", calorific_value: "", chlorine_pct: "", water_pct: "", sulfur_pct: "" });
const toQuality = (row: ProductDraft) => ({
  name: row.name,
  calorific_value: parseNumber(row.calorific_value),
  chlorine_pct: parseNumber(row.chlorine_pct),
  water_pct: parseNumber(row.water_pct),
  sulfur_pct: parseNumber(row.sulfur_pct),
});

export function SupplierModal({ supplier, onClose, onSaved }: { supplier: FuelSupplier | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { session } = useAuth();
  const notify = useNotify();
  const [tab, setTab] = useState<"corporate" | "quality">("corporate");
  const [form, setForm] = useState({
    business_name: supplier?.business_name ?? "",
    rfc: supplier?.rfc ?? "",
    address: supplier?.address ?? "",
    contact_name: supplier?.contact_name ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    permit_number: supplier?.permit_number ?? "",
    permit_valid_until: supplier?.permit_valid_until ?? "",
    status: supplier?.status ?? ("aprobado" as const),
    status_note: supplier?.status_note ?? "",
  });
  const [products, setProducts] = useState<ProductDraft[]>(() =>
    supplier?.products.filter((item) => item.active).length
      ? supplier.products
          .filter((item) => item.active)
          .map((item) => ({
            key: draftKey(),
            id: item.id,
            name: item.name,
            calorific_value: String(item.calorific_value),
            chlorine_pct: String(item.chlorine_pct),
            water_pct: String(item.water_pct),
            sulfur_pct: String(item.sulfur_pct),
          }))
      : [emptyProduct()],
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const setProduct = (key: string, field: keyof ProductDraft, value: string) =>
    setProducts((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  function pickFile(next: File | null) {
    if (!next) return;
    const problem = permitFileProblem(next);
    if (problem) {
      notify("error", "Archivo no válido", problem);
      return;
    }
    setFile(next);
  }

  /** [Validar y Guardar]: si el análisis no pasa, alerta emergente y no guarda. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError("");
    const rfc = form.rfc.trim().toUpperCase();
    if (form.business_name.trim().length < 3 || !RFC_PATTERN.test(rfc) || !form.permit_valid_until) {
      setTab("corporate");
      setError(!RFC_PATTERN.test(rfc) ? "El RFC no es válido (p. ej. PAA010101AB1)." : "Completa razón social, RFC y vigencia del permiso SEMARNAT.");
      return;
    }
    if (!supplier?.permit_path && !file) {
      setTab("corporate");
      setError("Adjunta el PDF del permiso SEMARNAT.");
      return;
    }
    const found = products.flatMap((row) => qualityProblems(toQuality(row)));
    setProblems(found);
    if (found.length > 0) {
      setTab("quality");
      notify("error", "No pasa el análisis químico", "El proveedor no se guardó. Revisa los parámetros marcados en rojo.");
      return;
    }

    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadPermit(file);
      await requestApi(session, supplier ? `/api/fuels/suppliers/${supplier.id}` : "/api/fuels/suppliers", {
        method: supplier ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          rfc,
          permit_path: uploaded ?? supplier?.permit_path ?? null,
          products: products.map((row) => ({ id: row.id, ...toQuality(row) })),
        }),
      });
      if (uploaded && supplier?.permit_path) void removePermit(supplier.permit_path);
      notify("success", supplier ? "Proveedor actualizado" : "Proveedor homologado", `${form.business_name.trim()} pasó el análisis y quedó guardado.`);
      await onSaved();
      onClose();
    } catch (err) {
      if (uploaded) void removePermit(uploaded);
      setError(describeError(err, "No se pudo guardar el proveedor."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form fuel-modal-wide" role="dialog" aria-modal="true" aria-labelledby="fuel-supplier-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><ShieldCheck size={19} /></div>
          <div>
            <h2 id="fuel-supplier-title">{supplier ? "Editar proveedor" : "Alta y homologación de proveedor"}</h2>
            <p>El análisis químico se valida al guardar: lo que no pasa los límites no se guarda.</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit} noValidate>
          <div className="site-tabs fuel-form-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "corporate"} className={`site-tab${tab === "corporate" ? " active" : ""}`} onClick={() => setTab("corporate")}>
              <Building2 size={14} /> Datos corporativos
            </button>
            <button type="button" role="tab" aria-selected={tab === "quality"} className={`site-tab${tab === "quality" ? " active" : ""}`} onClick={() => setTab("quality")}>
              <FlaskConical size={14} /> Parámetros de calidad ({products.length})
            </button>
          </div>

          {tab === "corporate" ? (
            <div className="form-grid">
              <Field label="Razón social" required><input value={form.business_name} onChange={(e) => set("business_name")(e.target.value)} maxLength={160} /></Field>
              <Field label="RFC" required><input value={form.rfc} onChange={(e) => set("rfc")(e.target.value.toUpperCase())} maxLength={13} placeholder="PAA010101AB1" /></Field>
              <Field label="Contacto"><input value={form.contact_name} onChange={(e) => set("contact_name")(e.target.value)} maxLength={120} /></Field>
              <div className="fuel-span-3"><Field label="Dirección"><input value={form.address} onChange={(e) => set("address")(e.target.value)} maxLength={300} /></Field></div>
              <Field label="Teléfono"><input value={form.phone} onChange={(e) => set("phone")(e.target.value)} maxLength={30} inputMode="tel" /></Field>
              <Field label="Correo"><input type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} maxLength={160} /></Field>
              <Field label="No. de permiso SEMARNAT"><input value={form.permit_number} onChange={(e) => set("permit_number")(e.target.value)} maxLength={80} /></Field>
              <Field label="Vigencia del permiso" required><input type="date" value={form.permit_valid_until} onChange={(e) => set("permit_valid_until")(e.target.value)} /></Field>
              <Field label="Permiso SEMARNAT (PDF)" required>
                <div className="photo-input-area">
                  <label className="button button-outline file-button">
                    <FileUp size={15} /> Adjuntar permiso
                    <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <span className="field-hint">{file ? file.name : supplier?.permit_path ? "PDF ya adjunto" : "Sin archivo"}</span>
                </div>
              </Field>
              <Field label="Estatus técnico">
                <select value={form.status} onChange={(e) => set("status")(e.target.value)}>
                  <option value="aprobado">Aprobado</option>
                  <option value="rechazado">Rechazado / suspendido</option>
                </select>
              </Field>
              {form.status === "rechazado" && (
                <div className="fuel-span-3"><Field label="Motivo del rechazo"><input value={form.status_note} onChange={(e) => set("status_note")(e.target.value)} maxLength={300} /></Field></div>
              )}
            </div>
          ) : (
            <div className="fuel-quality">
              <p className="field-hint">
                Límites: poder calorífico ≥ {QUALITY_LIMITS.minCalorific.toLocaleString("es-MX")} cal/g · cloro ≤ {QUALITY_LIMITS.maxChlorine.toFixed(2)} % ·
                agua ≤ {QUALITY_LIMITS.maxWater.toFixed(1)} % · azufre ≤ {QUALITY_LIMITS.maxSulfur.toFixed(1)} %.
              </p>
              {products.map((row) => {
                const rowProblems = qualityProblems(toQuality(row));
                const filled = [row.calorific_value, row.chlorine_pct, row.water_pct, row.sulfur_pct].every((value) => value.trim() !== "");
                const bad = (value: number | null, fails: (n: number) => boolean) => value !== null && fails(value);
                const q = toQuality(row);
                return (
                  <div key={row.key} className={`fuel-product${filled && rowProblems.length ? " fuel-product-bad" : filled ? " fuel-product-ok" : ""}`}>
                    <Field label="Producto" required><input value={row.name} onChange={(e) => setProduct(row.key, "name", e.target.value)} maxLength={120} placeholder="Basura industrial no peligrosa" /></Field>
                    <Field label="Poder calorífico (cal/g)" required>
                      <input inputMode="decimal" className={bad(q.calorific_value, (n) => n < QUALITY_LIMITS.minCalorific) ? "fuel-input-bad" : ""} value={row.calorific_value} onChange={(e) => setProduct(row.key, "calorific_value", e.target.value)} />
                    </Field>
                    <Field label="Cloro (%)" required>
                      <input inputMode="decimal" className={bad(q.chlorine_pct, (n) => n > QUALITY_LIMITS.maxChlorine) ? "fuel-input-bad" : ""} value={row.chlorine_pct} onChange={(e) => setProduct(row.key, "chlorine_pct", e.target.value)} />
                    </Field>
                    <Field label="Agua (%)" required>
                      <input inputMode="decimal" className={bad(q.water_pct, (n) => n > QUALITY_LIMITS.maxWater) ? "fuel-input-bad" : ""} value={row.water_pct} onChange={(e) => setProduct(row.key, "water_pct", e.target.value)} />
                    </Field>
                    <Field label="Azufre (%)" required>
                      <input inputMode="decimal" className={bad(q.sulfur_pct, (n) => n > QUALITY_LIMITS.maxSulfur) ? "fuel-input-bad" : ""} value={row.sulfur_pct} onChange={(e) => setProduct(row.key, "sulfur_pct", e.target.value)} />
                    </Field>
                    <button type="button" className="icon-button fuel-product-remove" onClick={() => setProducts((current) => current.filter((item) => item.key !== row.key))} disabled={products.length === 1} aria-label={`Quitar ${row.name || "producto"}`}>
                      <Trash2 size={16} />
                    </button>
                    {filled && <span className="fuel-product-state">{rowProblems.length ? `No pasa: ${rowProblems.map((item) => item.replace(/^[^:]+: /, "")).join(" ")}` : "Pasa el análisis"}</span>}
                  </div>
                );
              })}
              <button type="button" className="button button-outline" onClick={() => setProducts((current) => [...current, emptyProduct()])} disabled={products.length >= 30}>
                <Plus size={16} /> Agregar producto
              </button>
            </div>
          )}

          {problems.length > 0 && (
            <div className="inline-error fuel-problems" role="alert">
              <strong>No pasa el análisis; no se guardó:</strong>
              <ul>{problems.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><FlaskConical size={17} /> {busy ? "Validando…" : "Validar y guardar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
