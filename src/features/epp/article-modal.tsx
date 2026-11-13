"use client";

import { Check, HardHat, MapPinOff, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { eppArticleLabel, type EppArticle } from "@/lib/permissions";
import { describeError, requestApi } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-provider";
import { Field } from "@/shared/ui/field";
import { useDialog } from "@/shared/ui/dialog-provider";
import { useNotify } from "@/shared/ui/notice-provider";

export const EPP_CATEGORIES = [
  "Protección de cabeza",
  "Protección visual y facial",
  "Protección auditiva",
  "Protección respiratoria",
  "Protección de manos",
  "Ropa de trabajo",
  "Calzado",
  "Trabajo en altura",
  "Herramientas y otros",
];

export function ArticleModal({
  site,
  article,
  categories,
  onClose,
  onSaved,
}: {
  site: string;
  article: EppArticle | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { session, access } = useAuth();
  const notify = useNotify();
  const dialog = useDialog();
  // El catálogo es común a las tres sedes: una cuenta de sede solo cambia el mínimo de la suya.
  const catalogLocked = Boolean(article) && Boolean(access?.site) && !access?.is_super_admin;
  const canRemove = Boolean(article?.tracked) && article?.stock === 0 && !article?.pending_count;
  const [form, setForm] = useState({
    name: article?.name ?? "",
    category: article?.category ?? EPP_CATEGORIES[0],
    size: article?.size ?? "",
    unit: article?.unit ?? "PIEZAS",
    min_stock: String(article?.min_stock ?? 5),
    active: article?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = Array.from(new Set([...EPP_CATEGORIES, ...categories]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({
        name: form.name,
        category: form.category,
        size: form.size.trim() || null,
        unit: form.unit,
        min_stock: Number(form.min_stock) || 0,
        active: form.active,
        site,
      });
      await requestApi(session, article ? `/api/epp/articles/${article.id}` : "/api/epp/articles", {
        method: article ? "PATCH" : "POST",
        body,
      });
      notify(
        "success",
        article ? "Artículo actualizado" : "Artículo creado",
        article ? `Se guardaron los cambios de ${form.name.trim()}.` : `${form.name.trim()} ya está en el catálogo. Registra su primer ingreso para tener existencias.`,
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo guardar el artículo."));
    } finally {
      setBusy(false);
    }
  }

  async function removeFromSite() {
    if (!session || !article) return;
    const ok = await dialog.confirm({
      title: `Quitar de ${site}`,
      message: `${eppArticleLabel(article.name, article.size)} dejará de aparecer en el inventario de ${site}. Las otras sedes no cambian y se puede volver a agregar cuando se necesite.`,
      confirmLabel: "Quitar de la sede",
      cancelLabel: "Volver",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await requestApi(session, `/api/epp/articles/${article.id}/site?site=${encodeURIComponent(site)}`, { method: "DELETE" });
      notify("success", "Artículo quitado de la sede", `${eppArticleLabel(article.name, article.size)} ya no forma parte del inventario de ${site}.`);
      await onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, "No se pudo quitar el artículo de la sede."));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="epp-article-title">
        <div className="modal-header">
          <div className="modal-heading-icon"><HardHat size={19} /></div>
          <div>
            <h2 id="epp-article-title">{article ? "Editar artículo" : "Nuevo artículo de EPP"}</h2>
            <p>{article ? "La existencia cambia solo con ingresos, entregas o ajustes." : "Después de crearlo, registra su ingreso para cargar existencias."}</p>
          </div>
          <button className="icon-button close-modal" onClick={onClose} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <form className="employee-form" onSubmit={submit}>
          {catalogLocked && (
            <p className="epp-blind-note">El nombre, la categoría, la talla y el estatus son comunes a las tres sedes; solo los cambia Administración. Aquí ajustas el mínimo de {site}.</p>
          )}
          <fieldset className="epp-catalog-fields" disabled={catalogLocked}>
          <div className="form-grid">
            <Field label="Nombre del artículo" required><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} maxLength={120} required /></Field>
            <Field label="Categoría" required>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {options.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Talla (opcional)"><input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} maxLength={20} placeholder="M, XL, 27…" /></Field>
            <Field label="Unidad"><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value.toUpperCase() })} maxLength={20} required /></Field>
            <Field label="Estatus">
              <select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                <option value="1">Activo</option>
                <option value="0">Desactivado (no se puede entregar)</option>
              </select>
            </Field>
          </div>
          </fieldset>
          <div className="form-grid">
            <Field label={`Mínimo en ${site} antes de reponer`} required><input type="number" min={0} max={100000} value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} required /></Field>
          </div>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            {canRemove && (
              <button type="button" className="button button-danger-outline" onClick={() => void removeFromSite()} disabled={busy}><MapPinOff size={16} /> Quitar de {site}</button>
            )}
            <span className="actions-spacer" />
            <button type="button" className="button button-neutral" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" className="button button-gold" disabled={busy}><Check size={17} /> {busy ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
