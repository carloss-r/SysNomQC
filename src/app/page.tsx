"use client";

import {
  BriefcaseBusiness,
  Building2,
  Check,
  CircleUserRound,
  FileText,
  Filter,
  ImagePlus,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  CONTRACT_TYPES,
  EMPTY_EMPLOYEE_FORM,
  Employee,
  EmployeeFormValues,
  EmployeeInput,
  GENDERS,
  MARITAL_STATUSES,
  POSITIONS,
  SITES,
  employeeToForm,
  formToEmployeeInput,
  formatCurrency,
  formatDate,
} from "@/lib/employees";
import { supabase } from "@/lib/supabase";

const PHOTO_BUCKET = "employee-photos";
const PAGE_SIZE = 500;

type Notice = { tone: "success" | "error" | "warning"; message: string };

async function requestApi<T>(
  session: Session,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return undefined as T;

  const result = (await response.json()) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(result.error || "La solicitud no pudo completarse.");
  }

  return result;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="required-mark"> *</span>}
      </span>
      {children}
    </label>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [authError, setAuthError] = useState("");
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [filterSite, setFilterSite] = useState("Todas");
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<EmployeeFormValues>(EMPTY_EMPLOYEE_FORM);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const photoPreviewUrl = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setCheckingSession(false);
        if (!nextSession) {
          setEmployees([]);
          setPhotoUrls({});
          setPageError("");
        }
      }
    });

    supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (!active) return;
        if (error) setAuthError("No se pudo recuperar la sesión. Inicia sesión de nuevo.");
        setSession(sessionData.session);
        setCheckingSession(false);
        if (!sessionData.session) {
          setEmployees([]);
          setPhotoUrls({});
          setPageError("");
        }
      })
      .catch((error: unknown) => {
        console.error("No se pudo recuperar la sesión:", error);
        if (!active) return;
        setAuthError("No se pudo conectar con Supabase. Verifica la configuración.");
        setCheckingSession(false);
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const refreshEmployees = useCallback(async (activeSession: Session) => {
    setLoadingEmployees(true);
    setPageError("");
    try {
      const allEmployees: Employee[] = [];
      let offset = 0;
      let page: Employee[];

      do {
        page = await requestApi<Employee[]>(
          activeSession,
          `/api/employees?offset=${offset}&limit=${PAGE_SIZE}`,
        );
        allEmployees.push(...page);
        offset += page.length;
      } while (page.length === PAGE_SIZE);

      const signedPhotos = await Promise.all(
        allEmployees
          .filter((employee) => employee.photo_path)
          .map(async (employee) => {
            const { data, error } = await supabase.storage
              .from(PHOTO_BUCKET)
              .createSignedUrl(employee.photo_path!, 3600);
            if (error) {
              console.error(`No se pudo cargar la foto del empleado ${employee.employee_code}:`, error);
              return null;
            }
            return [employee.id, data.signedUrl] as const;
          }),
      );

      setEmployees(allEmployees);
      setPhotoUrls(
        Object.fromEntries(
          signedPhotos.filter((entry): entry is readonly [string, string] => entry !== null),
        ),
      );
    } catch (error) {
      console.error("No se pudo cargar el directorio:", error);
      setPageError(
        error instanceof Error ? error.message : "No se pudo cargar el directorio de empleados.",
      );
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => void refreshEmployees(session), 0);
    return () => window.clearTimeout(timer);
  }, [session, refreshEmployees]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => () => {
    if (photoPreviewUrl.current) URL.revokeObjectURL(photoPreviewUrl.current);
  }, []);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es-MX");
    return employees.filter((employee) => {
      const matchesSite = filterSite === "Todas" || employee.site === filterSite;
      const searchable = [
        employee.employee_code,
        employee.full_name,
        employee.position,
        employee.email ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("es-MX");
      return matchesSite && (!query || searchable.includes(query));
    });
  }, [employees, filterSite, search]);

  const showNotice = (tone: Notice["tone"], message: string) => setNotice({ tone, message });

  function setSelectedPhoto(file: File | null) {
    if (photoPreviewUrl.current) URL.revokeObjectURL(photoPreviewUrl.current);
    photoPreviewUrl.current = file ? URL.createObjectURL(file) : null;
    setPhotoFile(file);
    setPhotoPreview(photoPreviewUrl.current ?? "");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setAuthError("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        console.error("No se pudo iniciar sesión:", error);
        setAuthError("No se pudo iniciar sesión. Revisa tu correo y contraseña.");
      } else if (data.session) {
        try {
          await requestApi<Employee[]>(data.session, `/api/employees?limit=1`);
        } catch (accessError) {
          await supabase.auth.signOut();
          setAuthError(accessError instanceof Error ? accessError.message : "Tu cuenta no está autorizada.");
        }
      }
    } catch (error) {
      console.error("No se pudo completar el inicio de sesión:", error);
      setAuthError("No se pudo conectar para iniciar sesión. Inténtalo de nuevo.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("No se pudo cerrar sesión:", error);
        showNotice("error", "No se pudo cerrar la sesión. Inténtalo de nuevo.");
      }
    } catch (error) {
      console.error("No se pudo completar el cierre de sesión:", error);
      showNotice("error", "No se pudo cerrar la sesión. Inténtalo de nuevo.");
    } finally {
      setSigningOut(false);
    }
  }

  function openCreateForm() {
    const nextNumber = employees.reduce((highest, employee) => {
      const number = Number(employee.employee_code.match(/(\d+)$/)?.[1] ?? 0);
      return Math.max(highest, number);
    }, 100) + 1;
    setEditing(null);
    setForm({ ...EMPTY_EMPLOYEE_FORM, employee_code: `QG-${nextNumber}` });
    setSelectedPhoto(null);
    setRemovePhoto(false);
    setFormError("");
    setIsFormOpen(true);
  }

  function openEditForm(employee: Employee) {
    setEditing(employee);
    setForm(employeeToForm(employee));
    setSelectedPhoto(null);
    setRemovePhoto(false);
    setFormError("");
    setSelectedEmployee(null);
    setIsFormOpen(true);
  }

  function closeForm(force = false) {
    if (formBusy && !force) return;
    setIsFormOpen(false);
    setEditing(null);
    setSelectedPhoto(null);
    setRemovePhoto(false);
    setFormError("");
  }

  function updateForm<K extends keyof EmployeeFormValues>(
    key: K,
    value: EmployeeFormValues[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function uploadPhoto(activeSession: Session) {
    if (!photoFile) return editing?.photo_path ?? null;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(photoFile.type)) {
      throw new Error("La foto debe estar en formato JPG, PNG o WebP.");
    }
    if (photoFile.size > 3 * 1024 * 1024) {
      throw new Error("La foto no debe pesar más de 3 MB.");
    }

    const extension = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type.split("/")[1];
    const path = `${activeSession.user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, photoFile, {
      contentType: photoFile.type,
      upsert: false,
    });
    if (error) {
      console.error("No se pudo guardar la foto del empleado:", error);
      throw new Error("No se pudo cargar la foto. Verifica la configuración del almacenamiento.");
    }
    return path;
  }

  async function discardUploadedPhoto(path: string | null) {
    if (!path) return;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    if (error) {
      console.error("No se pudo retirar una foto que quedó sin asociar:", error);
      throw new Error("La operación falló y no se pudo limpiar el archivo de foto.");
    }
  }

  async function handleSaveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setFormBusy(true);
    setFormError("");
    let uploadedPath: string | null = null;

    try {
      const previousPhoto = editing?.photo_path ?? null;
      const newPhoto = await uploadPhoto(session);
      uploadedPath = photoFile ? newPhoto : null;
      const photoPath = removePhoto ? null : newPhoto;
      const payload: EmployeeInput = formToEmployeeInput(form, photoPath);

      if (editing) {
        await requestApi<Employee>(session, `/api/employees/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await requestApi<Employee>(session, "/api/employees", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      let cleanupWarning = "";
      if (previousPhoto && previousPhoto !== photoPath) {
        try {
          await discardUploadedPhoto(previousPhoto);
        } catch {
          cleanupWarning = " La foto anterior permanece en el almacenamiento.";
        }
      }

      closeForm(true);
      if (cleanupWarning) showNotice("warning", `Empleado guardado.${cleanupWarning}`);
      else showNotice("success", editing ? "Empleado actualizado correctamente." : "Empleado registrado correctamente.");
      await refreshEmployees(session);
    } catch (error) {
      if (uploadedPath) {
        try {
          await discardUploadedPhoto(uploadedPath);
        } catch (cleanupError) {
          console.error("No se pudo limpiar la foto tras un error al guardar:", cleanupError);
        }
      }
      console.error("No se pudo guardar el empleado:", error);
      const message = error instanceof Error ? error.message : "No se pudo guardar el empleado.";
      setFormError(message);
      showNotice("error", message);
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDeleteEmployee(employee: Employee) {
    if (!session || !window.confirm(`¿Eliminar el expediente de ${employee.full_name}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await requestApi<void>(session, `/api/employees/${employee.id}`, { method: "DELETE" });
      setSelectedEmployee(null);
      if (employee.photo_path) {
        try {
          await discardUploadedPhoto(employee.photo_path);
        } catch {
          showNotice("warning", "Empleado eliminado; no se pudo retirar su foto del almacenamiento.");
          await refreshEmployees(session);
          return;
        }
      }
      showNotice("success", "Empleado eliminado correctamente.");
      await refreshEmployees(session);
    } catch (error) {
      console.error("No se pudo eliminar el empleado:", error);
      showNotice("error", error instanceof Error ? error.message : "No se pudo eliminar el empleado.");
    }
  }

  if (checkingSession) {
    return (
      <main className="screen-center">
        <div className="loading-mark"><span>QG</span></div>
        <p>Conectando con el sistema…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div className="login-brand">
            <Image src="/logo-cooperativa.jpg" alt="Logotipo de Cooperativa Quinta Generación" width={92} height={92} priority />
          </div>
          <p className="eyebrow">SISTEMA DE CONTROL OPERATIVO</p>
          <h1>Gestión de Personal</h1>
          <p className="login-copy">Ingresa con tu cuenta autorizada para consultar los expedientes de la cooperativa.</p>

          <form onSubmit={handleLogin} className="login-form">
            <Field label="Correo electrónico" required>
              <span className="input-icon"><Mail size={17} /></span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nombre@cooperativa.com"
                required
              />
            </Field>
            <Field label="Contraseña" required>
              <span className="input-icon"><KeyRound size={17} /></span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Tu contraseña"
                required
              />
            </Field>
            {authError && <p className="inline-error" role="alert">{authError}</p>}
            <button type="submit" className="button button-primary login-submit" disabled={loggingIn}>
              {loggingIn ? "Validando acceso…" : "Iniciar sesión"}
            </button>
          </form>

          <div className="login-security"><ShieldCheck size={16} /> Acceso privado para personal autorizado</div>
        </section>
        <footer className="login-footer">© 2026 Cooperativa Quinta Generación S.C. de R.L. de C.V.</footer>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="Cooperativa Quinta Generación, inicio">
            <Image src="/logo-cooperativa.jpg" alt="" width={52} height={52} priority />
            <span className="brand-copy">
              <strong>COOPERATIVA QUINTA GENERACIÓN</strong>
              <small>S.C. DE R.L. DE C.V.</small>
            </span>
          </Link>
          <div className="topbar-actions">
            <span className="connection-status"><span /> Sistema de Control Operativo</span>
            <span className="signed-user" title={session.user.email ?? ""}>
              <CircleUserRound size={18} />
              <span>{session.user.email}</span>
            </span>
            <button className="icon-button logout-button" onClick={handleLogout} disabled={signingOut} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="welcome-card">
          <div className="welcome-heading">
            <div>
              <p className="eyebrow">DIRECTORIO Y EXPEDIENTES</p>
              <h1>Directorio General de Personal</h1>
              <p className="subheading">Consulta y administra los expedientes por sede operacional.</p>
            </div>
            <button className="button button-gold" onClick={openCreateForm}>
              <Plus size={18} /> Registrar empleado
            </button>
          </div>

          <div className="stats-grid">
            <StatCard label="Total empleados" count={employees.length} tone="green" icon={<UsersRound size={18} />} />
            <StatCard label="Campeche" count={employees.filter((item) => item.site === "Campeche").length} tone="blue" icon={<Building2 size={18} />} />
            <StatCard label="Lagunas" count={employees.filter((item) => item.site === "Lagunas").length} tone="gold" icon={<Building2 size={18} />} />
            <StatCard label="Cruz Azul" count={employees.filter((item) => item.site === "Cruz Azul").length} tone="purple" icon={<Building2 size={18} />} />
          </div>
        </section>

        <section className="directory-card">
          <div className="directory-toolbar">
            <div className="filter-label"><Filter size={16} /><span>Filtrar por sede</span></div>
            <div className="site-tabs" role="tablist" aria-label="Filtrar por sede">
              {["Todas", ...SITES].map((site) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filterSite === site}
                  className={`site-tab${filterSite === site ? " active" : ""}`}
                  key={site}
                  onClick={() => setFilterSite(site)}
                >
                  {site === "Todas" ? "Todas las sedes" : site}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar ID, nombre o puesto…"
                aria-label="Buscar empleado"
              />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda"><X size={15} /></button>}
            </label>
          </div>

          {pageError && <div className="error-banner" role="alert">{pageError}</div>}
          <div className="table-scroll">
            <table className="employee-table">
              <thead>
                <tr>
                  <th>ID empleado</th>
                  <th>Nombre completo</th>
                  <th>Sede</th>
                  <th>Área / puesto</th>
                  <th>Tipo de contrato</th>
                  <th>Estatus</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="employee-code">{employee.employee_code}</td>
                    <td>
                      <button className="employee-name-button" onClick={() => setSelectedEmployee(employee)}>
                        <Avatar employee={employee} photoUrl={photoUrls[employee.id]} />
                        <span>
                          <strong>{employee.full_name}</strong>
                          <small>{employee.email || "Sin correo registrado"}</small>
                        </span>
                      </button>
                    </td>
                    <td><SiteBadge site={employee.site} /></td>
                    <td className="position-cell">{employee.position}</td>
                    <td className="contract-cell">{employee.contract_type}</td>
                    <td><StatusBadge active={employee.active} /></td>
                    <td className="row-actions">
                      <button className="text-button" onClick={() => setSelectedEmployee(employee)}>Ver expediente</button>
                      <button className="icon-button row-edit" onClick={() => openEditForm(employee)} aria-label={`Editar ${employee.full_name}`} title="Editar"><Pencil size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loadingEmployees && <div className="table-state"><span className="spinner" /> Cargando empleados…</div>}
            {!loadingEmployees && filteredEmployees.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon"><UserRound size={25} /></div>
                <h2>{employees.length === 0 ? "Aún no hay empleados registrados" : "No se encontraron empleados"}</h2>
                <p>{employees.length === 0 ? "Agrega el primer expediente para empezar a usar el directorio." : "Prueba con otro nombre, ID o sede."}</p>
                {employees.length === 0 && <button className="button button-primary" onClick={openCreateForm}><Plus size={17} /> Registrar empleado</button>}
              </div>
            )}
          </div>
          <div className="table-footer">
            <span>{filteredEmployees.length} {filteredEmployees.length === 1 ? "empleado" : "empleados"}</span>
            {loadingEmployees && <span>Sincronizando datos</span>}
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>© 2026 Cooperativa Quinta Generación S.C. de R.L. de C.V.</span>
        <span>Sedes: Campeche · Lagunas · Cruz Azul</span>
      </footer>

      {isFormOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
          <section className="modal modal-form" role="dialog" aria-modal="true" aria-labelledby="employee-form-title">
            <div className="modal-header">
              <div className="modal-heading-icon"><UserRound size={19} /></div>
              <div>
                <h2 id="employee-form-title">{editing ? "Editar empleado" : "Alta de nuevo empleado"}</h2>
                <p>Completa la información del expediente. Los campos con * son obligatorios.</p>
              </div>
              <button className="icon-button close-modal" onClick={() => closeForm()} disabled={formBusy} aria-label="Cerrar"><X size={20} /></button>
            </div>

            <form className="employee-form" onSubmit={handleSaveEmployee}>
              <FormSection title="Datos laborales" icon={<BriefcaseBusiness size={16} />}>
                <div className="form-grid">
                  <Field label="ID empleado" required><input value={form.employee_code} onChange={(event) => updateForm("employee_code", event.target.value)} maxLength={30} required /></Field>
                  <Field label="Nombre completo" required><input value={form.full_name} onChange={(event) => updateForm("full_name", event.target.value)} maxLength={150} required /></Field>
                  <Field label="Sede asignada" required>
                    <select value={form.site} onChange={(event) => updateForm("site", event.target.value)} required>{SITES.map((site) => <option key={site}>{site}</option>)}</select>
                  </Field>
                  <Field label="Fecha de contratación" required><input type="date" value={form.hire_date} onChange={(event) => updateForm("hire_date", event.target.value)} required /></Field>
                  <Field label="Área / puesto" required>
                    <select value={form.position} onChange={(event) => updateForm("position", event.target.value)} required>{POSITIONS.map((position) => <option key={position}>{position}</option>)}</select>
                  </Field>
                  <Field label="Tipo de contrato" required>
                    <select value={form.contract_type} onChange={(event) => updateForm("contract_type", event.target.value)} required>{CONTRACT_TYPES.map((contract) => <option key={contract}>{contract}</option>)}</select>
                  </Field>
                  <Field label="Salario actual (MXN)"><input type="number" min="0" step="0.01" value={form.salary} onChange={(event) => updateForm("salary", event.target.value)} placeholder="0.00" /></Field>
                  <Field label="Cuenta bancaria / CLABE"><input value={form.bank_account} onChange={(event) => updateForm("bank_account", event.target.value)} maxLength={20} placeholder="Opcional" /></Field>
                  <Field label="Estatus">
                    <select value={form.active ? "active" : "inactive"} onChange={(event) => updateForm("active", event.target.value === "active")}>
                      <option value="active">Activo</option><option value="inactive">Inactivo</option>
                    </select>
                  </Field>
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

              <FormSection title="Fotografía" icon={<ImagePlus size={16} />}>
                <div className="photo-control">
                  {(photoPreview || (!removePhoto && editing?.photo_path && photoUrls[editing.id])) ? (
                    <Image
                      className="photo-preview"
                      src={photoPreview || photoUrls[editing!.id]}
                      alt="Vista previa de fotografía"
                      width={58}
                      height={58}
                      unoptimized
                    />
                  ) : <div className="photo-placeholder"><ImagePlus size={22} /></div>}
                  <div className="photo-input-area">
                    <label className="button button-outline file-button">
                      <ImagePlus size={16} /> Elegir foto
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setSelectedPhoto(file);
                          if (file) setRemovePhoto(false);
                        }}
                      />
                    </label>
                    <span className="field-hint">Opcional · JPG, PNG o WebP · Máximo 3 MB</span>
                    {editing?.photo_path && !photoFile && (
                      <label className="checkbox-option remove-photo">
                        <input
                          type="checkbox"
                          checked={removePhoto}
                          onChange={(event) => {
                            setRemovePhoto(event.target.checked);
                            if (event.target.checked) setSelectedPhoto(null);
                          }}
                        />
                        Quitar foto actual
                      </label>
                    )}
                  </div>
                </div>
              </FormSection>

              {formError && <p className="inline-error form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-neutral" onClick={() => closeForm()} disabled={formBusy}>Cancelar</button>
                <button type="submit" className="button button-gold" disabled={formBusy}>
                  {formBusy ? <span className="spinner spinner-light" /> : <Check size={17} />}
                  {formBusy ? "Guardando…" : editing ? "Guardar cambios" : "Guardar empleado"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedEmployee && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEmployee(null); }}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
            <div className="profile-header">
              <button className="icon-button profile-close" onClick={() => setSelectedEmployee(null)} aria-label="Cerrar"><X size={20} /></button>
              <Avatar employee={selectedEmployee} photoUrl={photoUrls[selectedEmployee.id]} large />
              <div className="profile-identity">
                <div className="profile-title-row">
                  <h2 id="profile-title">{selectedEmployee.full_name}</h2>
                  <StatusBadge active={selectedEmployee.active} />
                </div>
                <p>{selectedEmployee.position}</p>
                <div className="profile-tags"><span><FileText size={13} /> {selectedEmployee.employee_code}</span><span><MapPin size={13} /> {selectedEmployee.site}</span></div>
              </div>
            </div>
            <div className="profile-body">
              <ProfileSection title="Información laboral" icon={<BriefcaseBusiness size={16} />}>
                <ProfileValue label="Fecha de contratación">{formatDate(selectedEmployee.hire_date)}</ProfileValue>
                <ProfileValue label="Tipo de contrato">{selectedEmployee.contract_type}</ProfileValue>
                <ProfileValue label="Salario actual">{formatCurrency(selectedEmployee.salary)}</ProfileValue>
                <ProfileValue label="Cuenta bancaria">{selectedEmployee.bank_account || "No especificada"}</ProfileValue>
                <ProfileValue label="Estatus">{selectedEmployee.active ? "Activo" : "Inactivo"}</ProfileValue>
              </ProfileSection>
              <ProfileSection title="Información personal" icon={<UserRound size={16} />}>
                <ProfileValue label="Género">{selectedEmployee.gender || "No especificado"}</ProfileValue>
                <ProfileValue label="Fecha de nacimiento">{formatDate(selectedEmployee.birth_date)}</ProfileValue>
                <ProfileValue label="Estado civil">{selectedEmployee.marital_status || "No especificado"}</ProfileValue>
                <ProfileValue label="NSS">{selectedEmployee.nss || "No especificado"}</ProfileValue>
                <ProfileValue label="CURP">{selectedEmployee.curp || "No especificada"}</ProfileValue>
                <ProfileValue label="RFC">{selectedEmployee.rfc || "No especificado"}</ProfileValue>
                <ProfileValue label="Créditos activos">{selectedEmployee.credits.length ? selectedEmployee.credits.join(", ") : "Ninguno"}</ProfileValue>
              </ProfileSection>
              <ProfileSection title="Contacto y domicilio" icon={<MapPin size={16} />}>
                <ProfileValue label="Correo electrónico">{selectedEmployee.email || "No especificado"}</ProfileValue>
                <ProfileValue label="Teléfono">{selectedEmployee.phone || "No especificado"}</ProfileValue>
                <ProfileValue label="Estado de residencia">{selectedEmployee.residence_state || "No especificado"}</ProfileValue>
                <ProfileValue label="Dirección" wide>{selectedEmployee.address || "No especificada"}</ProfileValue>
              </ProfileSection>
            </div>
            <div className="modal-actions profile-actions">
              <button className="button button-danger-outline" onClick={() => void handleDeleteEmployee(selectedEmployee)}><Trash2 size={16} /> Eliminar</button>
              <span className="actions-spacer" />
              <button className="button button-neutral" onClick={() => setSelectedEmployee(null)}>Cerrar</button>
              <button className="button button-gold" onClick={() => openEditForm(selectedEmployee)}><Pencil size={16} /> Editar expediente</button>
            </div>
          </section>
        </div>
      )}

      {notice && <div className={`toast toast-${notice.tone}`} role="status">{notice.message}</div>}
    </div>
  );
}

function StatCard({ label, count, tone, icon }: { label: string; count: number; tone: string; icon: ReactNode }) {
  return <div className={`stat-card stat-${tone}`}><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{count}</strong></div>;
}

function SiteBadge({ site }: { site: string }) {
  const tone = site === "Campeche" ? "site-blue" : site === "Lagunas" ? "site-gold" : site === "Cruz Azul" ? "site-purple" : "site-neutral";
  return <span className={`site-badge ${tone}`}>{site}</span>;
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`status-badge ${active ? "status-active" : "status-inactive"}`}><span />{active ? "Activo" : "Inactivo"}</span>;
}

function Avatar({ employee, photoUrl, large = false }: { employee: Employee; photoUrl?: string; large?: boolean }) {
  const dimension = large ? 68 : 34;
  return <span className={`avatar${large ? " avatar-large" : ""}`}>{photoUrl ? <Image src={photoUrl} alt="" width={dimension} height={dimension} unoptimized /> : initials(employee.full_name)}</span>;
}

function FormSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="form-section"><h3>{icon}{title}</h3>{children}</section>;
}

function ProfileSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="profile-section"><h3>{icon}{title}</h3><div className="profile-grid">{children}</div></section>;
}

function ProfileValue({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`profile-value${wide ? " profile-value-wide" : ""}`}><span>{label}</span><strong>{children}</strong></div>;
}
