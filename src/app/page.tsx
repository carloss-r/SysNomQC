"use client";

import {
  BriefcaseBusiness,
  Building2,
  Check,
  CircleAlert,
  CircleCheck,
  CircleUserRound,
  FileText,
  Filter,
  Info,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import {
  CONTRACT_TYPES,
  EMPTY_EMPLOYEE_FORM,
  Employee,
  EmployeeFormValues,
  EmployeeInput,
  EmployeeSummary,
  GENDERS,
  MARITAL_STATUSES,
  POSITIONS,
  SITES,
  employeeToForm,
  formToEmployeeInput,
  formatCurrency,
  formatDate,
  sortEmployees,
  toEmployeeSummary,
} from "@/lib/employees";
import { reportClientIncident } from "@/lib/report-incident";
import { supabase } from "@/lib/supabase";

// FOTOS DESHABILITADAS: la carga/lectura de fotos con Firebase Storage está comentada en
// src/lib/firebase.ts y no se usa en esta pantalla. Los expedientes conservan su photo_path.

const PAGE_SIZE = 500;

type NoticeTone = "success" | "error" | "warning" | "info";
type Notice = { id: number; tone: NoticeTone; title: string; message?: string };

// Los errores duran más en pantalla para que dé tiempo de leerlos.
const NOTICE_DURATION: Record<NoticeTone, number> = {
  success: 4500,
  info: 4500,
  warning: 7000,
  error: 10000,
};

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
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [pageError, setPageError] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);
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
  const sessionRef = useRef<Session | null>(null);
  const noticeCounter = useRef(0);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback(
    (tone: NoticeTone, title: string, message?: string) => {
      noticeCounter.current += 1;
      const id = noticeCounter.current;
      setNotices((current) => [...current.slice(-3), { id, tone, title, message }]);
      window.setTimeout(() => dismissNotice(id), NOTICE_DURATION[tone]);
    },
    [dismissNotice],
  );

  useEffect(() => {
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setCheckingSession(false);
        if (!nextSession) {
          setEmployees([]);
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
          setPageError("");
        }
      })
      .catch((error: unknown) => {
        console.error("No se pudo recuperar la sesión:", error);
        reportClientIncident("auth.sesión", error);
        if (!active) return;
        setAuthError("No se pudo conectar con Supabase. Verifica la configuración.");
        setCheckingSession(false);
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Se lee siempre la sesión más reciente desde la referencia: así renovar el token o volver
  // a la pestaña no dispara una descarga nueva de todo el directorio (menos lecturas y costo).
  const refreshEmployees = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    setLoadingEmployees(true);
    setPageError("");
    try {
      const allEmployees: EmployeeSummary[] = [];
      let offset = 0;
      let page: EmployeeSummary[];

      do {
        page = await requestApi<EmployeeSummary[]>(
          activeSession,
          `/api/employees?offset=${offset}&limit=${PAGE_SIZE}`,
        );
        allEmployees.push(...page);
        offset += page.length;
      } while (page.length === PAGE_SIZE);

      setEmployees(allEmployees);
    } catch (error) {
      console.error("No se pudo cargar el directorio:", error);
      const message = describeError(error, "No se pudo cargar el directorio de empleados.");
      setPageError(message);
      notify("error", "No se pudo cargar el directorio", message);
      if (!(error instanceof ApiError)) reportClientIncident("directorio · carga", error);
    } finally {
      setLoadingEmployees(false);
    }
  }, [notify]);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => void refreshEmployees(), 0);
    return () => window.clearTimeout(timer);
  }, [userId, refreshEmployees]);

  const deferredSearch = useDeferredValue(search);
  const filteredEmployees = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase("es-MX");
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
  }, [employees, filterSite, deferredSearch]);

  const positionSuggestions = useMemo(
    () => Array.from(new Set([...POSITIONS, ...employees.map((employee) => employee.position)])).sort((a, b) => a.localeCompare(b, "es-MX")),
    [employees],
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setAuthError("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        console.error("No se pudo iniciar sesión:", error);
        const unreachable = error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500;
        const message = unreachable
          ? "No se pudo conectar para iniciar sesión. Inténtalo de nuevo."
          : "No se pudo iniciar sesión. Revisa tu correo y contraseña.";
        setAuthError(message);
        notify("error", unreachable ? "Sin conexión" : "No se pudo iniciar sesión", message);
        if (unreachable) reportClientIncident("auth.login", error);
      } else if (data.session) {
        try {
          await requestApi<EmployeeSummary[]>(data.session, `/api/employees?limit=1`);
          notify("success", "Sesión iniciada", "Bienvenido al sistema de gestión de personal.");
        } catch (accessError) {
          await supabase.auth.signOut();
          const message = describeError(accessError, "Tu cuenta no está autorizada.");
          setAuthError(message);
          notify("error", "Cuenta sin acceso", message);
        }
      }
    } catch (error) {
      console.error("No se pudo completar el inicio de sesión:", error);
      const message = "No se pudo conectar para iniciar sesión. Inténtalo de nuevo.";
      setAuthError(message);
      notify("error", "Sin conexión", message);
      reportClientIncident("auth.login", error);
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
        notify("error", "No se pudo cerrar la sesión", "Inténtalo de nuevo.");
      } else {
        notify("info", "Sesión cerrada", "Hasta pronto.");
      }
    } catch (error) {
      console.error("No se pudo completar el cierre de sesión:", error);
      notify("error", "No se pudo cerrar la sesión", "Inténtalo de nuevo.");
      reportClientIncident("auth.logout", error);
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
    setFormError("");
    setIsFormOpen(true);
  }

  function openEditForm(employee: Employee) {
    setEditing(employee);
    setForm(employeeToForm(employee));
    setFormError("");
    setSelectedEmployee(null);
    setIsFormOpen(true);
  }

  function closeForm(force = false) {
    if (formBusy && !force) return;
    setIsFormOpen(false);
    setEditing(null);
    setFormError("");
  }

  function updateForm<K extends keyof EmployeeFormValues>(
    key: K,
    value: EmployeeFormValues[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // La lista solo trae columnas básicas; el expediente completo se pide al abrirlo.
  async function loadEmployeeDetail(summary: EmployeeSummary): Promise<Employee | null> {
    if (!session) return null;
    setDetailLoadingId(summary.id);
    try {
      return await requestApi<Employee>(session, `/api/employees/${summary.id}`);
    } catch (error) {
      console.error("No se pudo cargar el expediente:", error);
      notify("error", "No se pudo abrir el expediente", describeError(error, "Inténtalo de nuevo."));
      if (!(error instanceof ApiError)) reportClientIncident("expediente · carga", error);
      return null;
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function openProfile(summary: EmployeeSummary) {
    const employee = await loadEmployeeDetail(summary);
    if (employee) setSelectedEmployee(employee);
  }

  async function openEditFromRow(summary: EmployeeSummary) {
    const employee = await loadEmployeeDetail(summary);
    if (employee) openEditForm(employee);
  }

  async function handleSaveEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setFormBusy(true);
    setFormError("");
    const isEdit = editing !== null;

    try {
      // FOTOS DESHABILITADAS: se conserva sin cambios el photo_path que ya tuviera el expediente.
      const payload: EmployeeInput = formToEmployeeInput(form, editing?.photo_path ?? null);
      const saved = isEdit
        ? await requestApi<Employee>(session, `/api/employees/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await requestApi<Employee>(session, "/api/employees", {
            method: "POST",
            body: JSON.stringify(payload),
          });

      // Se actualiza la lista en memoria con la respuesta: no hace falta volver a descargarla.
      const summary = toEmployeeSummary(saved);
      setEmployees((current) =>
        sortEmployees(
          isEdit
            ? current.map((item) => (item.id === summary.id ? summary : item))
            : [...current, summary],
        ),
      );

      closeForm(true);
      notify(
        "success",
        isEdit ? "Empleado actualizado" : "Empleado registrado",
        `${saved.full_name} (${saved.employee_code}) se guardó correctamente.`,
      );
    } catch (error) {
      console.error("No se pudo guardar el empleado:", error);
      const message = describeError(error, "No se pudo guardar el empleado.");
      setFormError(message);
      notify("error", "No se pudo guardar el empleado", message);
      if (!(error instanceof ApiError)) reportClientIncident("empleado · guardar", error);
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
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
      notify("success", "Empleado eliminado", `Se eliminó el expediente de ${employee.full_name}.`);
    } catch (error) {
      console.error("No se pudo eliminar el empleado:", error);
      notify("error", "No se pudo eliminar el empleado", describeError(error, "Inténtalo de nuevo."));
      if (!(error instanceof ApiError)) reportClientIncident("empleado · eliminar", error);
    }
  }

  const noticeStack = <NoticeStack notices={notices} onDismiss={dismissNotice} />;

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
        {noticeStack}
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
                  <th>Área / departamento</th>
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
                      <button className="employee-name-button" onClick={() => void openProfile(employee)} disabled={detailLoadingId === employee.id}>
                        <Avatar name={employee.full_name} />
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
                      <button className="text-button" onClick={() => void openProfile(employee)} disabled={detailLoadingId === employee.id}>{detailLoadingId === employee.id ? "Abriendo…" : "Ver expediente"}</button>
                      <button className="icon-button row-edit" onClick={() => void openEditFromRow(employee)} disabled={detailLoadingId === employee.id} aria-label={`Editar ${employee.full_name}`} title="Editar"><Pencil size={16} /></button>
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

              {/* FOTOS DESHABILITADAS (ver src/lib/firebase.ts). Para reactivar, restaura la lógica de fotos y descomenta:
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
              */}

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
              <Avatar name={selectedEmployee.full_name} large />
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

      {noticeStack}
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

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`avatar${large ? " avatar-large" : ""}`}>{initials(name)}</span>;
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

const NOTICE_ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

function NoticeStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {notices.map((notice) => {
        const Icon = NOTICE_ICONS[notice.tone];
        return (
          <div key={notice.id} className={`toast toast-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            <Icon size={20} className="toast-icon" />
            <div className="toast-body">
              <strong>{notice.title}</strong>
              {notice.message && <p>{notice.message}</p>}
            </div>
            <button type="button" className="toast-close" onClick={() => onDismiss(notice.id)} aria-label="Cerrar aviso"><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
