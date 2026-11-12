"use client";

import { Building2, Filter, Pencil, Plus, Search, UserRound, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import {
  POSITIONS,
  SITES,
  type Employee,
  type EmployeeSummary,
} from "@/lib/employees";
import { reportClientIncident } from "@/lib/report-incident";
import { deleteEmployeePhoto } from "@/lib/photos";
import { RequirePermission } from "@/shared/layout/require-permission";
import { Avatar, SiteBadge, StatCard, StatusBadge } from "@/shared/ui/badges";
import { useNotify } from "@/shared/ui/notice-provider";
import { useDialog } from "@/shared/ui/dialog-provider";
import { PageHeader } from "@/shared/ui/page-header";
import { EmployeeFormModal } from "./components/employee-form-modal";
import { EmployeeProfileModal } from "./components/employee-profile-modal";

// Empleados por página: el directorio nunca se descarga completo, solo una página a la vez.
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

type EmployeeStats = { total: number; bySite: Record<string, number> };

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
  const systemDialog = useDialog();
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<EmployeeStats | null>(null);
  const [suggestedCode, setSuggestedCode] = useState("");
  const [pageError, setPageError] = useState("");
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [filterSite, setFilterSite] = useState("Todas");
  // Los avisos enlazan aquí con ?buscar=<ID>. Esta pantalla solo se monta en el navegador, ya con sesión.
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("buscar") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => search.trim());
  const [formState, setFormState] = useState<FormState>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // La búsqueda espera a que se deje de escribir: una consulta por pausa, no por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Se lee siempre la sesión más reciente desde la referencia: así renovar el token o volver
  // a la pestaña no dispara una descarga nueva. Solo se pide la página visible (PAGE_SIZE filas).
  const refreshEmployees = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;

    setLoading(true);
    setPageError("");
    try {
      const params = new URLSearchParams({
        offset: String(page * PAGE_SIZE),
        limit: String(PAGE_SIZE),
        count: "1",
      });
      if (filterSite !== "Todas") params.set("site", filterSite);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const result = await requestApi<{ data: EmployeeSummary[]; total: number }>(
        activeSession,
        `/api/employees?${params.toString()}`,
      );

      // Si se borró el último registro de la última página, se retrocede una página.
      if (result.data.length === 0 && result.total > 0 && page > 0) {
        setPage(Math.ceil(result.total / PAGE_SIZE) - 1);
        return;
      }
      setEmployees(result.data);
      setTotal(result.total);
    } catch (error) {
      console.error("No se pudo cargar el directorio:", error);
      const message = describeError(error, "No se pudo cargar el directorio de empleados.");
      setPageError(message);
      notify("error", "No se pudo cargar el directorio", message);
      if (!(error instanceof ApiError)) reportClientIncident("directorio · carga", error);
    } finally {
      setLoading(false);
    }
  }, [notify, page, filterSite, debouncedSearch]);

  // Contadores por sede: solo conteos en el servidor (sin traer filas).
  const loadStats = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    try {
      setStats(await requestApi<EmployeeStats>(activeSession, "/api/employees?stats=1"));
    } catch (error) {
      console.error("No se pudieron cargar los contadores:", error);
    }
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => void loadStats(), 0);
    return () => window.clearTimeout(timer);
  }, [userId, loadStats]);

  // La lista se vuelve a pedir solo al cambiar de página, de sede o de búsqueda.
  useEffect(() => {
    if (!userId) return;
    const timer = window.setTimeout(() => void refreshEmployees(), 0);
    return () => window.clearTimeout(timer);
  }, [userId, refreshEmployees]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = filterSite !== "Todas" || debouncedSearch !== "";

  const positionSuggestions = useMemo(
    () =>
      Array.from(new Set([...POSITIONS, ...employees.map((employee) => employee.position)])).sort((a, b) =>
        a.localeCompare(b, "es-MX"),
      ),
    [employees],
  );

  // La lista paginada no tiene todos los IDs: el siguiente se calcula en el servidor al abrir el alta.
  async function openCreateForm() {
    let nextCode = "";
    const activeSession = sessionRef.current;
    if (activeSession) {
      try {
        nextCode = (await requestApi<{ next_code: string }>(activeSession, "/api/employees?next_code=1")).next_code;
      } catch (error) {
        console.error("No se pudo calcular el siguiente ID:", error);
      }
    }
    setSuggestedCode(nextCode);
    setFormState({ editing: null });
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
    if (employee) setFormState({ editing: employee });
  }

  function handleSaved() {
    // Con paginación el orden y la página dependen del servidor: se vuelve a pedir solo la página actual.
    void refreshEmployees();
    void loadStats();
    setFormState(null);
  }

  async function handleDelete(employee: Employee) {
    if (!session) return;
    const ok = await systemDialog.confirm({
      title: "Eliminar expediente",
      message: `¿Eliminar el expediente de ${employee.full_name}? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await requestApi<void>(session, `/api/employees/${employee.id}`, { method: "DELETE" });
      if (employee.photo_path) void deleteEmployeePhoto(employee.photo_path);
      setSelectedEmployee(null);
      void refreshEmployees();
      void loadStats();
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
            <button className="button button-gold" onClick={() => void openCreateForm()}>
              <Plus size={18} /> Registrar empleado
            </button>
          )
        }
      >
        <div className="stats-grid">
          <StatCard label="Total empleados" count={stats?.total ?? 0} tone="green" icon={<UsersRound size={18} />} />
          <StatCard label="Campeche" count={stats?.bySite["Campeche"] ?? 0} tone="blue" icon={<Building2 size={18} />} />
          <StatCard label="Lagunas" count={stats?.bySite["Lagunas"] ?? 0} tone="gold" icon={<Building2 size={18} />} />
          <StatCard label="Cruz Azul" count={stats?.bySite["Cruz Azul"] ?? 0} tone="purple" icon={<Building2 size={18} />} />
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
                onClick={() => {
                  setFilterSite(site);
                  setPage(0);
                }}
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
              {employees.map((employee) => (
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
          {!loading && employees.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon"><UserRound size={25} /></div>
              <h2>{!hasFilters ? "Aún no hay empleados registrados" : "No se encontraron empleados"}</h2>
              <p>{!hasFilters ? "Agrega el primer expediente para empezar a usar el directorio." : "Prueba con otro nombre, ID o sede."}</p>
              {!hasFilters && can("employees.create") && <button className="button button-primary" onClick={() => void openCreateForm()}><Plus size={17} /> Registrar empleado</button>}
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {total === 0
              ? "0 empleados"
              : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + employees.length} de ${total} ${total === 1 ? "empleado" : "empleados"}`}
            {loading && " · Sincronizando datos"}
          </span>
          {totalPages > 1 && (
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button type="button" className="text-button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || loading}>← Anterior</button>
              <span>Página {page + 1} de {totalPages}</span>
              <button type="button" className="text-button" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1 || loading}>Siguiente →</button>
            </span>
          )}
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
