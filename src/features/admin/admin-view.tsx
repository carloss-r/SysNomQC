"use client";

import { Check, Eye, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { describeError, requestApi } from "@/lib/api-client";
import { SITES } from "@/lib/employees";
import { PERMISSIONS, READ_ONLY_AREAS, READ_ONLY_PERMISSIONS, type AdminRole, type AdminUser, type Permission } from "@/lib/permissions";
import { roleLabel, roleLabels } from "@/lib/roles";
import { useDialog } from "@/shared/ui/dialog-provider";
import { RequirePermission } from "@/shared/layout/require-permission";
import { Field } from "@/shared/ui/field";
import { PageHeader } from "@/shared/ui/page-header";

type Tab = "users" | "roles";
type UserForm = { email: string; username: string; full_name: string; password: string; role_ids: number[]; active: boolean; site: string };
type RoleForm = { name: string; description: string; permissions: Permission[]; read_only: boolean };

const EMPTY_USER: UserForm = { email: "", username: "", full_name: "", password: "", role_ids: [], active: true, site: "" };
const EMPTY_ROLE: RoleForm = { name: "", description: "", permissions: [], read_only: false };
export const MIN_PASSWORD_LENGTH = 12;

// Pantalla de usuarios y roles (solo cuentas con el permiso "users.manage").
export function AdminView() {
  return (
    <RequirePermission permission="users.manage">
      <AdminDashboard />
    </RequirePermission>
  );
}

function AdminDashboard() {
  const { session } = useAuth();
  const systemDialog = useDialog();
  const sessionRef = useRef(session);
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
    sessionRef.current = session;
  }, [session]);

  const load = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    setLoading(true);
    try {
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

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [userId, load]);

  function openUserModal(user: AdminUser | null) {
    setUserForm(
      user
        ? { email: user.email, username: user.username ?? "", full_name: user.full_name ?? "", password: "", role_ids: user.role_ids, active: user.active, site: user.site ?? "" }
        : { ...EMPTY_USER, role_ids: [] },
    );
    setFormError("");
    setUserModal({ editing: user });
  }

  function openRoleModal(role: AdminRole | null) {
    setRoleForm(
      role
        ? { name: roleLabel(role.name), description: role.description ?? "", permissions: role.permissions, read_only: role.read_only }
        : EMPTY_ROLE,
    );
    setFormError("");
    setRoleModal({ editing: role });
  }

  async function runSave(action: () => Promise<unknown>, success: string, close: () => void) {
    setBusy(true);
    setFormError("");
    try {
      await action();
      close();
      setMessage({ tone: "success", text: success });
      await load();
    } catch (error) {
      setFormError(describeError(error, "No se pudo guardar."));
    } finally {
      setBusy(false);
    }
  }

  function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !userModal) return;
    if (userForm.role_ids.length === 0) {
      setFormError("Marca al menos un rol.");
      return;
    }
    const editing = userModal.editing;
    void runSave(
      () =>
        editing
          ? requestApi(session, `/api/admin/users/${editing.user_id}`, {
              method: "PATCH",
              body: JSON.stringify({
                full_name: userForm.full_name.trim(),
                // Solo se envía si cambió, para no tocar la columna cuando no hace falta.
                ...(userForm.username.trim() !== (editing.username ?? "")
                  ? { username: userForm.username.trim() || null }
                  : {}),
                role_ids: userForm.role_ids,
                active: userForm.active,
                site: userForm.site || null,
                ...(userForm.password ? { password: userForm.password } : {}),
              }),
            })
          : requestApi(session, "/api/admin/users", {
              method: "POST",
              body: JSON.stringify({
                email: userForm.email.trim(),
                ...(userForm.username.trim() ? { username: userForm.username.trim() } : {}),
                full_name: userForm.full_name.trim(),
                password: userForm.password,
                role_ids: userForm.role_ids,
                active: userForm.active,
                site: userForm.site || null,
              }),
            }),
      editing ? "Usuario actualizado." : "Usuario creado.",
      () => setUserModal(null),
    );
  }

  function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !roleModal) return;
    if (roleForm.read_only && roleForm.permissions.length === 0) {
      setFormError("Elige al menos un área que pueda ver.");
      return;
    }
    const editing = roleModal.editing;
    const body = JSON.stringify({
      name: roleForm.name.trim(),
      description: roleForm.description.trim() || null,
      permissions: roleForm.permissions,
      read_only: roleForm.read_only,
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
    if (!session) return;
    const ok = await systemDialog.confirm({
      title: kind === "users" ? "Eliminar usuario" : "Eliminar rol",
      message: `¿Eliminar "${label}"? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await requestApi<void>(session, `/api/admin/${kind}/${id}`, { method: "DELETE" });
      setMessage({ tone: "success", text: "Eliminado correctamente." });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: describeError(error, "No se pudo eliminar.") });
    }
  }

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="SUPER ADMINISTRADOR"
        title="Usuarios y roles"
        description="Crea cuentas, asigna roles y define qué puede hacer cada rol."
        actions={
          <button className="button button-gold" onClick={() => (tab === "users" ? openUserModal(null) : openRoleModal(null))}>
            <Plus size={18} /> {tab === "users" ? "Nuevo usuario" : "Nuevo rol"}
          </button>
        }
      />

      {message && (
        <div className={message.tone === "error" ? "error-banner" : "inline-error admin-success"} role="alert">
          {message.text}
          <button className="text-button" onClick={() => setMessage(null)}>Cerrar</button>
        </div>
      )}

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
                <tr><th>Nombre</th><th className="hide-tablet">Usuario</th><th className="hide-tablet">Correo</th><th className="hide-phone">Roles</th><th className="hide-tablet">Sede</th><th className="hide-phone">Estatus</th><th><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id}>
                    <td>{user.full_name || "—"}<small className="epp-muted show-phone">{roleLabels(user.role_names)} · {user.site ?? "Todas las sedes"}{user.active ? "" : " · Inactivo"}</small><small className="epp-muted show-tablet">{user.email}</small></td>
                    <td className="hide-tablet">{user.username || "—"}</td>
                    <td className="hide-tablet">{user.email}</td>
                    <td className="hide-phone"><span className="role-list">{user.role_names.length ? user.role_names.map((name) => <span key={name} className="role-pill">{roleLabel(name)}</span>) : "Sin rol"}</span></td>
                    <td className="hide-tablet">{user.site ?? <span className="epp-muted">Todas</span>}</td>
                    <td className="hide-phone"><span className={`status-badge ${user.active ? "status-active" : "status-inactive"}`}><span />{user.active ? "Activo" : "Inactivo"}</span></td>
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
                <tr><th>Rol</th><th className="hide-phone">Descripción</th><th>Permisos</th><th className="hide-phone">Usuarios</th><th><span className="sr-only">Acciones</span></th></tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td><strong>{roleLabel(role.name)}</strong>{role.is_system && <small> · del sistema</small>}{role.read_only && <span className="role-readonly"><Eye size={12} /> Solo consulta</span>}</td>
                    <td className="hide-phone">{role.description || "—"}</td>
                    <td>{role.is_system ? "Todos" : role.read_only ? `Ve ${role.permissions.length} área(s)` : `${role.permissions.length} de ${PERMISSIONS.length}`}</td>
                    <td className="hide-phone">{role.user_count}</td>
                    <td className="row-actions">
                      {!role.is_system && (
                        <>
                          <button className="icon-button row-edit" onClick={() => openRoleModal(role)} aria-label={`Editar ${roleLabel(role.name)}`} title="Editar"><Pencil size={16} /></button>
                          <button className="icon-button row-edit" onClick={() => void remove("roles", role.id, roleLabel(role.name))} aria-label={`Eliminar ${roleLabel(role.name)}`} title="Eliminar"><Trash2 size={16} /></button>
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
                <Field label="Nombre completo" required><input value={userForm.full_name} onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })} maxLength={150} required /></Field>
                <Field label="Correo electrónico" required><input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} disabled={Boolean(userModal.editing)} required /></Field>
                <Field label="Usuario (opcional)"><input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} pattern="[A-Za-z0-9._\-]{3,30}" title="3 a 30 caracteres: letras, números, punto, guion y guion bajo" maxLength={30} autoCapitalize="none" spellCheck={false} placeholder="Para iniciar sesión sin correo" /></Field>
                <Field label={userModal.editing ? "Nueva contraseña" : `Contraseña (mín. ${MIN_PASSWORD_LENGTH})`} required={!userModal.editing}>
                  <input type="password" autoComplete="new-password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} minLength={MIN_PASSWORD_LENGTH} maxLength={72} required={!userModal.editing} />
                </Field>
                <Field label="Sede">
                  <select value={userForm.site} onChange={(event) => setUserForm({ ...userForm, site: event.target.value })}>
                    <option value="">Todas las sedes (supervisión)</option>
                    {SITES.map((site) => <option key={site} value={site}>Solo {site}</option>)}
                  </select>
                  <span className="field-hint">
                    {userForm.site
                      ? `Solo verá y operará el inventario de EPP, las solicitudes y las entregas de ${userForm.site}.`
                      : "Verá y podrá operar el inventario de las tres sedes. Úsalo solo para supervisión o administración."}
                  </span>
                </Field>
                <Field label="Estatus">
                  <select value={userForm.active ? "active" : "inactive"} onChange={(event) => setUserForm({ ...userForm, active: event.target.value === "active" })}>
                    <option value="active">Activo</option><option value="inactive">Inactivo</option>
                  </select>
                </Field>
              </div>
              <fieldset className="role-picker">
                <legend>Roles <span className="required-mark">*</span> <small>Puedes marcar varios; la cuenta tendrá los permisos de todos.</small></legend>
                {roles.map((role) => {
                  const checked = userForm.role_ids.includes(role.id);
                  return (
                    <label key={role.id} className={`role-option${checked ? " checked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setUserForm({
                            ...userForm,
                            role_ids: event.target.checked ? [...userForm.role_ids, role.id] : userForm.role_ids.filter((id) => id !== role.id),
                          })
                        }
                      />
                      <span>
                        <strong>{roleLabel(role.name)}</strong>
                        <small>{role.description || (role.is_system ? "Control total" : role.read_only ? "Solo consulta" : `${role.permissions.length} permiso(s)`)}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
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
                <h2 id="role-form-title">{roleModal.editing ? `Editar rol: ${roleLabel(roleModal.editing.name)}` : "Nuevo rol"}</h2>
                <p>Elige lo que podrán hacer los usuarios con este rol.</p>
              </div>
              <button className="icon-button close-modal" onClick={() => setRoleModal(null)} disabled={busy} aria-label="Cerrar"><X size={20} /></button>
            </div>
            <form className="employee-form" onSubmit={saveRole}>
              <div className="form-grid">
                <Field label="Nombre del rol" required><input value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} minLength={2} maxLength={60} required /></Field>
                <Field label="Descripción"><input value={roleForm.description} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} maxLength={200} /></Field>
              </div>
              <label className="checkbox-option role-readonly-toggle">
                <input
                  type="checkbox"
                  checked={roleForm.read_only}
                  onChange={(event) =>
                    setRoleForm({
                      ...roleForm,
                      read_only: event.target.checked,
                      // Al pasar a solo consulta se quitan los permisos que modifican datos.
                      permissions: event.target.checked
                        ? roleForm.permissions.filter((key) => READ_ONLY_PERMISSIONS.includes(key))
                        : roleForm.permissions,
                    })
                  }
                />
                <span>
                  <strong><Eye size={14} /> Solo consulta</strong>
                  <small>Los usuarios con este rol solo ven la información: no pueden registrar, editar ni eliminar nada. Elige qué áreas pueden ver.</small>
                </span>
              </label>
              <div className="credit-options admin-permissions">
                {(roleForm.read_only ? READ_ONLY_AREAS : PERMISSIONS).map((permission) => (
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
    </main>
  );
}
