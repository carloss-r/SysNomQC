"use client";

import { Building2, Filter, Pencil, Plus, Search, UserRound, UsersRound, X } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import {
  POSITIONS,
  SITES,
  sortEmployees,
  toEmployeeSummary,
  type Employee,
  type EmployeeSummary,
} from "@/lib/employees";
import { reportClientIncident } from "@/lib/report-incident";
import { deleteEmployeePhoto } from "@/lib/photos";
import { RequirePermission } from "@/shared/layout/require-permission";
import { Avatar, SiteBadge, StatCard, StatusBadge } from "@/shared/ui/badges";
import { useNotify } from "@/shared/ui/notice-provider";
import { PageHeader } from "@/shared/ui/page-header";
import { EmployeeFormModal } from "./components/employee-form-modal";
import { EmployeeProfileModal } from "./components/employee-profile-modal";

const PAGE_SIZE = 500;

type FormState = { editing: Employee | null } | null;

// Dashboard de empleados: directorio general, alta/edición, expediente y descarga.
// "/" es la entrada de todos; quien no ve expedientes lo redirige RequirePermission a su pantalla.
export function EmployeesView() {
  return (
    <RequirePermission permission="employees.view">
      <EmployeesDashboard />
    </RequirePermission>
  );
}

function EmployeesDashboard() {
  const { session, can } = useAuth();
  const notify = useNotify();
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [filterSite, setFilterSite] = useState("Todas");
  // Los avisos enlazan aquí con ?buscar=<ID>. Esta pantalla solo se monta en el navegador, ya con sesión.
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("buscar") ?? "");
  const [formState, setFormState] = useState<FormState>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Se lee siempre la sesión más reciente desde la referencia: así renovar el token o volver
  // a la pestaña no dispara una descarga nueva de todo el directorio (menos lecturas y costo).
  const refreshEmployees = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    setLoading(true);
    setPageError("");
    try {
      const all: EmployeeSummary[] = [];
      let offset = 0;
      let page: EmployeeSummary[];

      do {
        page = await requestApi<EmployeeSummary[]>(
          activeSession,
          `/api/employees?offset=${offset}&limit=${PAGE_SIZE}`,
        );
        all.push(...page);
        offset += page.length;
      } while (page.length === PAGE_SIZE);

      setEmployees(all);
    } catch (error) {
      console.error("No se pudo cargar el directorio:", error);
      const message = describeError(error, "No se pudo cargar el directorio de empleados.");
      setPageError(message);
      notify("error", "No se pudo cargar el directorio", message);
      if (!(error instanceof ApiError)) reportClientIncident("directorio · carga", error);
    } finally {
      setLoading(false);
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
      const searchable = [employee.employee_code, employee.full_name, employee.position, employee.email ?? ""]
        .join(" ")
        .toLocaleLowerCase("es-MX");
      return matchesSite && (!query || searchable.includes(query));
    });
  }, [employees, filterSite, deferredSearch]);

  const positionSuggestions = useMemo(
    () =>
      Array.from(new Set([...POSITIONS, ...employees.map((employee) => employee.position)])).sort((a, b) =>
        a.localeCompare(b, "es-MX"),
      ),
    [employees],
  );

  const suggestedCode = useMemo(() => {
    const highest = employees.reduce((max, employee) => {
      const number = Number(employee.employee_code.match(/(\d+)$/)?.[1] ?? 0);
      return Math.max(max, number);
    }, 100);
    return `QG-${highest + 1}`;
  }, [employees]);

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
    if (employee) setFormState({ editing: employee });
  }

  function handleSaved(saved: Employee, isEdit: boolean) {
    // Se actualiza la lista en memoria con la respuesta: no hace falta volver a descargarla.
    const summary = toEmployeeSummary(saved);
    setEmployees((current) =>
      sortEmployees(
        isEdit ? current.map((item) => (item.id === summary.id ? summary : item)) : [...current, summary],
      ),
    );
    setFormState(null);
  }

  async function handleDelete(employee: Employee) {
    if (!session || !window.confirm(`¿Eliminar el expediente de ${employee.full_name}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await requestApi<void>(session, `/api/employees/${employee.id}`, { method: "DELETE" });
      if (employee.photo_path) void deleteEmployeePhoto(employee.photo_path);
      setSelectedEmployee(null);
      setEmployees((current) => current.filter((item) => item.id !== employee.id));
      notify("success", "Empleado eliminado", `Se eliminó el expediente de ${employee.full_name}.`);
    } catch (error) {
      console.error("No se pudo eliminar el empleado:", error);
      notify("error", "No se pudo eliminar el empleado", describeError(error, "Inténtalo de nuevo."));
      if (!(error instanceof ApiError)) reportClientIncident("empleado · eliminar", error);
    }
  }

  return (
    <main className="main-content">
      <PageHeader
        eyebrow="DIRECTORIO Y EXPEDIENTES"
        title="Directorio General de Personal"
        description="Consulta y administra los expedientes por sede operacional."
        actions={
          can("employees.create") && (
            <button className="button button-gold" onClick={() => setFormState({ editing: null })}>
              <Plus size={18} /> Registrar empleado
            </button>
          )
        }
      >
        <div className="stats-grid">
          <StatCard label="Total empleados" count={employees.length} tone="green" icon={<UsersRound size={18} />} />
          <StatCard label="Campeche" count={employees.filter((item) => item.site === "Campeche").length} tone="blue" icon={<Building2 size={18} />} />
          <StatCard label="Lagunas" count={employees.filter((item) => item.site === "Lagunas").length} tone="gold" icon={<Building2 size={18} />} />
          <StatCard label="Cruz Azul" count={employees.filter((item) => item.site === "Cruz Azul").length} tone="purple" icon={<Building2 size={18} />} />
        </div>
      </PageHeader>

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
                <th className="hide-phone">ID empleado</th>
                <th>Nombre completo</th>
                <th className="hide-phone">Sede</th>
                <th className="hide-tablet">Área / departamento</th>
                <th className="hide-tablet">Tipo de contrato</th>
                <th>Estatus</th>
                <th><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td className="employee-code hide-phone">{employee.employee_code}</td>
                  <td>
                    <button className="employee-name-button" onClick={() => void openProfile(employee)} disabled={detailLoadingId === employee.id}>
                      <Avatar name={employee.full_name} />
                      <span>
                        <strong>{employee.full_name}</strong>
                        <small className="hide-phone">{employee.email || "Sin correo registrado"}</small>
                        <small className="show-phone">{employee.employee_code} · {employee.site}</small>
                      </span>
                    </button>
                  </td>
                  <td className="hide-phone"><SiteBadge site={employee.site} /></td>
                  <td className="position-cell hide-tablet">{employee.position}</td>
                  <td className="contract-cell hide-tablet">{employee.contract_type}</td>
                  <td><StatusBadge active={employee.active} /></td>
                  <td className="row-actions">
                    <button className="text-button hide-tablet" onClick={() => void openProfile(employee)} disabled={detailLoadingId === employee.id}>{detailLoadingId === employee.id ? "Abriendo…" : "Ver expediente"}</button>
                    {can("employees.edit") && <button className="icon-button row-edit" onClick={() => void openEditFromRow(employee)} disabled={detailLoadingId === employee.id} aria-label={`Editar ${employee.full_name}`} title="Editar"><Pencil size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="table-state"><span className="spinner" /> Cargando empleados…</div>}
          {!loading && filteredEmployees.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon"><UserRound size={25} /></div>
              <h2>{employees.length === 0 ? "Aún no hay empleados registrados" : "No se encontraron empleados"}</h2>
              <p>{employees.length === 0 ? "Agrega el primer expediente para empezar a usar el directorio." : "Prueba con otro nombre, ID o sede."}</p>
              {employees.length === 0 && can("employees.create") && <button className="button button-primary" onClick={() => setFormState({ editing: null })}><Plus size={17} /> Registrar empleado</button>}
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>{filteredEmployees.length} {filteredEmployees.length === 1 ? "empleado" : "empleados"}</span>
          {loading && <span>Sincronizando datos</span>}
        </div>
      </section>

      {formState && (
        <EmployeeFormModal
          editing={formState.editing}
          suggestedCode={suggestedCode}
          positionSuggestions={positionSuggestions}
          onClose={() => setFormState(null)}
          onSaved={handleSaved}
        />
      )}

      {selectedEmployee && (
        <EmployeeProfileModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          onEdit={(employee) => {
            setSelectedEmployee(null);
            setFormState({ editing: employee });
          }}
          onDelete={(employee) => void handleDelete(employee)}
        />
      )}
    </main>
  );
}
