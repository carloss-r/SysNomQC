"use client";

import { ArrowLeft, Check, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { describeError, requestApi } from "@/lib/api-client";
import {
  PERMISSIONS,
  type Access,
  type AdminRole,
  type AdminUser,
  type Permission,
} from "@/lib/permissions";
import { supabase } from "@/lib/supabase";

type Tab = "users" | "roles";
type UserForm = { email: string; full_name: string; password: string; role_id: string; active: boolean };
type RoleForm = { name: string; description: string; permissions: Permission[] };

const EMPTY_USER: UserForm = { email: "", full_name: "", password: "", role_id: "", active: true };
const EMPTY_ROLE: RoleForm = { name: "", description: "", permissions: [] };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [access, setAccess] = useState<Access | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const [userModal, setUserModal] = useState<{ editing: AdminUser | null } | null>(null);
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_USER);
  const [roleModal, setRoleModal] = useState<{ editing: AdminRole | null } | null>(null);
  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async (activeSession: Session) => {
    setLoading(true);
    try {
      const me = await requestApi<Access>(activeSession, "/api/me");
      setAccess(me);
      if (!me.permissions.includes("users.manage")) return;
      const [userList, roleList] = await Promise.all([
        requestApi<AdminUser[]>(activeSession, "/api/admin/users"),
        requestApi<AdminRole[]>(activeSession, "/api/admin/roles"),
      ]);
      setUsers(userList);
      setRoles(roleList);
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error, "No se pudo cargar la información.") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => void load(session), 0);
    return () => window.clearTimeout(timer);
  }, [session, load]);

  function openUserModal(user: AdminUser | null) {
    setUserForm(
      user
        ? { email: user.email, full_name: user.full_name ?? "", password: "", role_id: user.role_id ? String(user.role_id) : "", active: user.active }
        : { ...EMPTY_USER, role_id: String(roles.find((role) => !role.is_system)?.id ?? roles[0]?.id ?? "") },
    );
    setFormError("");
    setUserModal({ editing: user });
  }

  function openRoleModal(role: AdminRole | null) {
    setRoleForm(
      role
        ? { name: role.name, description: role.description ?? "", permissions: role.permissions }
        : EMPTY_ROLE,
    );
    setFormError("");
    setRoleModal({ editing: role });
  }

  async function runSave(action: () => Promise<unknown>, success: string, close: () => void) {
    if (!session) return;
    setBusy(true);
    setFormError("");
    try {
      await action();
      close();
      setMessage({ tone: "success", text: success });
      await load(session);
    } catch (error) {
      setFormError(describeError(error, "No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  }

  function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !userModal) return;
    const editing = userModal.editing;
    void runSave(
      () =>
        editing
          ? requestApi(session, `/api/admin/users/${editing.user_id}`, {
              method: "PATCH",
              body: JSON.stringify({
                full_name: userForm.full_name.trim(),
                role_id: Number(userForm.role_id),
                active: userForm.active,
                ...(userForm.password ? { password: userForm.password } : {}),
              }),
            })
          : requestApi(session, "/api/admin/users", {
              method: "POST",
              body: JSON.stringify({
                email: userForm.email.trim(),
                full_name: userForm.full_name.trim(),
                password: userForm.password,
                role_id: Number(userForm.role_id),
                active: userForm.active,
              }),
            }),
      editing ? "Usuario actualizado." : "Usuario creado.",
      () => setUserModal(null),
    );
  }

  function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !roleModal) return;
    const editing = roleModal.editing;
    const body = JSON.stringify({
      name: roleForm.name.trim(),
      description: roleForm.description.trim() || null,
      permissions: roleForm.permissions,
    });
    void runSave(
      () =>
        editing
          ? requestApi(session, `/api/admin/roles/${editing.id}`, { method: "PATCH", body })
          : requestApi(session, "/api/admin/roles", { method: "POST", body }),
      editing ? "Rol actualizado." : "Rol creado.",
      () => setRoleModal(null),
    );
  }

  async function remove(kind: "users" | "roles", id: string | number, label: string) {
    if (!session || !window.confirm(`¿Eliminar "${label}"? Esta acción no se puede deshacer.`)) return;
    try {
      await requestApi<void>(session, `/api/admin/${kind}/${id}`, { method: "DELETE" });
      setMessage({ tone: "success", text: "Eliminado correctamente." });
      await load(session);
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error, "No se pudo eliminar.") });
    }
  }

  if (checking) {
    return <main className="screen-center"><p>Cargando…</p></main>;
  }

  if (!session) {
    return (
      <main className="screen-center">
        <p>Inicia sesión para continuar.</p>
        <Link className="button button-primary" href="/">Ir al inicio de sesión</Link>
      </main>
    );
  }

  const canManage = access?.permissions.includes("users.manage") ?? false;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="Volver al directorio">
            <Image src="/logo-cooperativa.jpg" alt="" width={52} height={52} priority />
            <span className="brand-copy">
              <strong>COOPERATIVA QUINTA GENERACIÓN</strong>
              <small>ADMINISTRACIÓN DE USUARIOS Y ROLES</small>
            </span>
          </Link>
          <div className="topbar-actions">
            <Link className="button button-outline" href="/"><ArrowLeft size={16} /> Directorio</Link>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="welcome-card">
          <div className="welcome-heading">
            <div>
              <p className="eyebrow">SUPER ADMINISTRADOR</p>
              <h1>Usuarios y roles</h1>
              <p className="subheading">Crea cuentas, asigna roles y define qué puede hacer cada rol.</p>
            </div>
            {canManage && (
              <button className="button button-gold" onClick={() => (tab === "users" ? openUserModal(null) : openRoleModal(null))}>
                <Plus size={18} /> {tab === "users" ? "Nuevo usuario" : "Nuevo rol"}
              </button>
            )}
          </div>
        </section>

        {message && (
          <div className={message.tone === "error" ? "error-banner" : "inline-error admin-success"} role="alert">
            {message.text}
            <button className="text-button" onClick={() => setMessage(null)}>Cerrar</button>
          </div>
        )}

        {!canManage && access && (
          <div className="error-banner" role="alert">Tu rol no tiene permiso para administrar usuarios y roles.</div>
        )}

        {canManage && (
          <section className="directory-card">
            <div className="directory-toolbar">
              <div className="site-tabs" role="tablist">
                <button role="tab" aria-selected={tab === "users"} className={`site-tab${tab === "users" ? " active" : ""}`} onClick={() => setTab("users")}>
                  <UsersRound size={14} /> Usuarios ({users.length})
                </button>
                <button role="tab" aria-selected={tab === "roles"} className={`site-tab${tab === "roles" ? " active" : ""}`} onClick={() => setTab("roles")}>
                  <ShieldCheck size={14} /> Roles ({roles.length})
                </button>
              </div>
            </div>

            <div className="table-scroll">
              {tab === "users" ? (
                <table className="employee-table">
                  <thead>
                    <tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estatus</th><th><span className="sr-only">Acciones</span></th></tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.user_id}>
                        <td>{user.full_name || "—"}</td>
                        <td>{user.email}</td>
                        <td>{user.role_name ?? "Sin rol"}</td>
                        <td><span className={`status-badge ${user.active ? "status-active" : "status-inactive"}`}><span />{user.active ? "Activo" : "Inactivo"}</span></td>
                        <td className="row-actions">
                          <button className="icon-button row-edit" onClick={() => openUserModal(user)} aria-label={`Editar ${user.email}`} title="Editar"><Pencil size={16} /></button>
                          <button className="icon-button row-edit" onClick={() => void remove("users", user.user_id, user.email)} aria-label={`Eliminar ${user.email}`} title="Eliminar"><Trash2 size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="employee-table">
                  <thead>
                    <tr><th>Rol</th><th>Descripción</th><th>Permisos</th><th>Usuarios</th><th><span className="sr-only">Acciones</span></th></tr>
                  </thead>
                  <tbody>
                    {roles.map((role) => (
                      <tr key={role.id}>
                        <td><strong>{role.name}</strong>{role.is_system && <small> · del sistema</small>}</td>
                        <td>{role.description || "—"}</td>
                        <td>{role.is_system ? "Todos" : `${role.permissions.length} de ${PERMISSIONS.length}`}</td>
                        <td>{role.user_count}</td>
                        <td className="row-actions">
                          {!role.is_system && (
                            <>
                              <button className="icon-button row-edit" onClick={() => openRoleModal(role)} aria-label={`Editar ${role.name}`} title="Editar"><Pencil size={16} /></button>
                              <button className="icon-button row-edit" onClick={() => void remove("roles", role.id, role.name)} aria-label={`Eliminar ${role.name}`} title="Eliminar"><Trash2 size={16} /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {loading && <div className="table-state"><span className="spinner" /> Cargando…</div>}
            </div>
          </section>
        )}
      </main>

      {userModal && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setUserModal(null); }}>
          <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="user-form-title">
            <div className="modal-header">
              <div className="modal-heading-icon"><KeyRound size={19} /></div>
              <div>
                <h2 id="user-form-title">{userModal.editing ? "Editar usuario" : "Nuevo usuario"}</h2>
                <p>{userModal.editing ? "Deja la contraseña vacía para no cambiarla." : "La cuenta podrá iniciar sesión de inmediato."}</p>
              </div>
              <button className="icon-button close-modal" onClick={() => setUserModal(null)} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
            </div>
            <form className="employee-form" onSubmit={saveUser}>
              <div className="form-grid">
                <Field label="Nombre completo *"><input value={userForm.full_name} onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })} maxLength={150} required /></Field>
                <Field label="Correo electrónico *"><input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} disabled={Boolean(userModal.editing)} required /></Field>
                <Field label={userModal.editing ? "Nueva contraseña" : "Contraseña * (mín. 8)"}>
                  <input type="password" autoComplete="new-password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} minLength={8} maxLength={72} required={!userModal.editing} />
                </Field>
                <Field label="Rol *">
                  <select value={userForm.role_id} onChange={(event) => setUserForm({ ...userForm, role_id: event.target.value })} required>
                    <option value="" disabled>Selecciona un rol</option>
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </Field>
                <Field label="Estatus">
                  <select value={userForm.active ? "active" : "inactive"} onChange={(event) => setUserForm({ ...userForm, active: event.target.value === "active" })}>
                    <option value="active">Activo</option><option value="inactive">Inactivo</option>
                  </select>
                </Field>
              </div>
              {formError && <p className="inline-error form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-neutral" onClick={() => setUserModal(null)} disabled={busy}>Cancelar</button>
                <button type="submit" className="button button-gold" disabled={busy}><Check size={17} /> {busy ? "Guardando…" : "Guardar"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {roleModal && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRoleModal(null); }}>
          <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="role-form-title">
            <div className="modal-header">
              <div className="modal-heading-icon"><ShieldCheck size={19} /></div>
              <div>
                <h2 id="role-form-title">{roleModal.editing ? "Editar rol" : "Nuevo rol"}</h2>
                <p>Elige lo que podrán hacer los usuarios con este rol.</p>
              </div>
              <button className="icon-button close-modal" onClick={() => setRoleModal(null)} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
            </div>
            <form className="employee-form" onSubmit={saveRole}>
              <div className="form-grid">
                <Field label="Nombre del rol *"><input value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} minLength={2} maxLength={60} required /></Field>
                <Field label="Descripción"><input value={roleForm.description} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} maxLength={200} /></Field>
              </div>
              <div className="credit-options admin-permissions">
                {PERMISSIONS.map((permission) => (
                  <label className="checkbox-option" key={permission.key}>
                    <input
                      type="checkbox"
                      checked={roleForm.permissions.includes(permission.key)}
                      onChange={(event) =>
                        setRoleForm({
                          ...roleForm,
                          permissions: event.target.checked
                            ? [...roleForm.permissions, permission.key]
                            : roleForm.permissions.filter((item) => item !== permission.key),
                        })
                      }
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
              {formError && <p className="inline-error form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-neutral" onClick={() => setRoleModal(null)} disabled={busy}>Cancelar</button>
                <button type="submit" className="button button-gold" disabled={busy}><Check size={17} /> {busy ? "Guardando…" : "Guardar"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
