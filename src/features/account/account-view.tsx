"use client";

import { KeyRound, Save, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { describeError, requestApi } from "@/lib/api-client";
import type { MyProfile } from "@/lib/permissions";
import { roleLabels } from "@/lib/roles";
import { Field } from "@/shared/ui/field";
import { BusyLabel, LoadingState } from "@/shared/ui/loading";
import { useNotify } from "@/shared/ui/notice-provider";
import { PageHeader } from "@/shared/ui/page-header";
import { PasswordForm } from "./password-form";

type Form = { full_name: string; username: string; phone: string };

/** "Mi cuenta": cada usuario edita su nombre, usuario de acceso y teléfono, y cambia su contraseña. */
export function AccountView() {
  const { session, refreshAccess } = useAuth();
  const notify = useNotify();
  const sessionRef = useRef(session);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [form, setForm] = useState<Form>({ full_name: "", username: "", phone: "" });
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    const active = sessionRef.current;
    if (!userId || !active) return;
    let cancelled = false;
    requestApi<MyProfile>(active, "/api/me/profile")
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setForm({ full_name: data.full_name ?? "", username: data.username ?? "", phone: data.phone ?? "" });
      })
      .catch((err) => { if (!cancelled) setLoadError(describeError(err, "No se pudieron cargar tus datos.")); });
    return () => { cancelled = true; };
  }, [userId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!session || !profile) return;
    setError("");
    const full_name = form.full_name.trim().replace(/\s+/g, " ");
    const username = form.username.trim();
    const phone = form.phone.trim();
    if (full_name.length < 3) return setError("Escribe tu nombre completo.");
    if (username && !/^[A-Za-z0-9._-]{3,30}$/.test(username)) return setError("El usuario lleva de 3 a 30 letras, números, punto, guion o guion bajo (sin espacios ni @).");
    if (phone && !/^[0-9 +()-]{7,20}$/.test(phone)) return setError("El teléfono lleva de 7 a 20 dígitos (puede incluir espacios, guiones o +).");

    // Solo lo que cambió.
    const changes: Record<string, string | null> = {};
    if (full_name !== (profile.full_name ?? "")) changes.full_name = full_name;
    if (username !== (profile.username ?? "")) changes.username = username || null;
    if (phone !== (profile.phone ?? "")) changes.phone = phone || null;
    if (Object.keys(changes).length === 0) return notify("info", "Sin cambios", "Tus datos ya están guardados.");

    setBusy(true);
    try {
      await requestApi(session, "/api/me/profile", { method: "PATCH", body: JSON.stringify(changes) });
      const updated = { ...profile, full_name, username: username || null, phone: phone || null };
      setProfile(updated);
      setForm({ full_name, username, phone });
      notify("success", "Datos guardados", username && changes.username !== undefined ? `Ya puedes entrar con el usuario "${username}".` : "Tu cuenta quedó actualizada.");
      await refreshAccess().catch(() => undefined);
    } catch (err) {
      setError(describeError(err, "No se pudieron guardar tus datos."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="main-content">
      <PageHeader eyebrow="Cuenta" title="Mi cuenta" description="Actualiza tus datos y cambia tu contraseña." />

      {loadError && <div className="error-banner" role="alert">{loadError}</div>}
      {!profile && !loadError && <LoadingState label="Cargando tus datos…" rows={3} />}

      {profile && (
        <div className="account-grid">
          <section className="directory-card account-card">
            <h2 className="account-title"><UserRound size={18} /> Mis datos</h2>
            <form className="employee-form account-form" onSubmit={save}>
              <Field label="Nombre completo" required>
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={150} autoComplete="name" required />
              </Field>
              <div className="form-grid">
                <Field label="Usuario para iniciar sesión">
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} maxLength={30} autoCapitalize="none" spellCheck={false} autoComplete="username" placeholder="Opcional, p. ej. jperez" />
                </Field>
                <Field label="Teléfono">
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="Opcional" />
                </Field>
              </div>
              <dl className="account-facts">
                <div><dt>Correo</dt><dd>{profile.email}</dd></div>
                <div><dt>Rol</dt><dd>{roleLabels(profile.role_names) || "Sin rol"}</dd></div>
                <div><dt>Sede</dt><dd>{profile.site ?? "Todas las sedes"}</dd></div>
              </dl>
              <p className="epp-muted account-note">El correo, el rol y la sede solo los cambia el administrador.</p>
              {error && <p className="inline-error" role="alert">{error}</p>}
              <div className="modal-actions">
                <button type="submit" className="button button-gold" disabled={busy}><Save size={16} /> {busy ? <BusyLabel>Guardando…</BusyLabel> : "Guardar datos"}</button>
              </div>
            </form>
          </section>

          <section className="directory-card account-card">
            <h2 className="account-title"><KeyRound size={18} /> Cambiar contraseña</h2>
            <PasswordForm />
          </section>
        </div>
      )}
    </main>
  );
}
