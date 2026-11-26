"use client";

import { Building2, ClipboardList, Filter, Layers, Pencil, Plus, Search, UserMinus, UserRound, UsersRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiError, describeError, requestApi } from "@/lib/api-client";
import {
  EMPTY_CATALOG,
  formatDate,
  formatDateTime,
  SITES,
  type CatalogItem,
  type Employee,
  type EmployeeCatalog,
  type EmployeeGroupCount,
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
import { LoadingState } from "@/shared/ui/loading";

// Empleados por página: el directorio nunca se descarga completo, solo una página a la vez.
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

type EmployeeStats = { total: number; bySite: Record<string, number>; followUp?: number };

/** directory: activos · terminated: bajas · followup: expedientes con observaciones. */
type View = "directory" | "terminated" | "followup";

/** Asignación elegida en el filtro: id del catálogo, "sin" (sin asignación) o "" (todas). */
type AssignmentFilter = string;

const ALL_SITES = "Todas";

/** Suma de trabajadores de las filas de conteo que cumplen la condición. */
const sumCounts = (rows: EmployeeGroupCount[], match: (row: EmployeeGroupCount) => boolean) =>
  rows.reduce((sum, row) => (match(row) ? sum + row.total : sum), 0);

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
  const [filterSite, setFilterSite] = useState(ALL_SITES);
  // Filtros por área global (CYM / CAL), puesto y asignación: ids del catálogo ("" = todos).
  const [filterArea, setFilterArea] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [filterAssignment, setFilterAssignment] = useState<AssignmentFilter>("");
  const [catalog, setCatalog] = useState<EmployeeCatalog>(EMPTY_CATALOG);
  const [view, setView] = useState<View>("directory");
  // Los avisos enlazan aquí con ?buscar=<ID>. Esta pantalla solo se monta en el navegador, ya con sesión.
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("buscar") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => search.trim());
  const [formState, setFormState] = useState<FormState>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const sessionRef = useRef(session);
  // Total ya contado para estos filtros: al cambiar solo de página no se vuelve a contar en la base.
  const countedRef = useRef<{ key: string; total: number } | null>(null);

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
      const filtersKey = `${filterSite}|${filterArea}|${filterPosition}|${filterAssignment}|${debouncedSearch}|${view}`;
      const known = countedRef.current?.key === filtersKey ? countedRef.current : null;
      const params = new URLSearchParams({
        offset: String(page * PAGE_SIZE),
        limit: String(PAGE_SIZE),
      });
      if (!known) params.set("count", "1");
      if (filterSite !== ALL_SITES) params.set("site", filterSite);
      if (filterArea) params.set("area", filterArea);
      if (filterPosition) params.set("puesto", filterPosition);
      if (filterAssignment) params.set("asignacion", filterAssignment);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (view === "followup") params.set("seguimiento", "1");
      if (view === "directory") params.set("estatus", "activos");
      if (view === "terminated") params.set("estatus", "bajas");

      const response = await requestApi<{ data: EmployeeSummary[]; total: number } | EmployeeSummary[]>(
        activeSession,
        `/api/employees?${params.toString()}`,
      );
      const result = Array.isArray(response) ? { data: response, total: known?.total ?? response.length } : response;
      if (!known) countedRef.current = { key: filtersKey, total: result.total };

      // Si se borró el último registro de la última página, se retrocede (y se vuelve a contar).
      if (result.data.length === 0 && page > 0) {
        if (known) {
          countedRef.current = null;
          setPage((current) => Math.max(0, current - 1));
        } else if (result.total > 0) {
          setPage(Math.ceil(result.total / PAGE_SIZE) - 1);
        }
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
  }, [notify, page, filterSite, filterArea, filterPosition, filterAssignment, debouncedSearch, view]);

  // Contadores por sede: solo conteos en el servidor (sin traer filas). Junto con ellos se piden los
  // catálogos (áreas, puestos, asignaciones) y cuántos trabajadores hay en cada uno: son pocas filas y
  // con ellas los filtros muestran su número sin volver a consultar.
  const loadStats = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    const [statsResult, catalogResult] = await Promise.allSettled([
      requestApi<EmployeeStats>(activeSession, "/api/employees?stats=1"),
      requestApi<EmployeeCatalog>(activeSession, "/api/employees/catalog"),
    ]);
    if (statsResult.status === "fulfilled") setStats(statsResult.value);
    else console.error("No se pudieron cargar los contadores:", statsResult.reason);
    if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
    else console.error("No se pudieron cargar las áreas y puestos:", catalogResult.reason);
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
  const hasCatalogFilters = filterArea !== "" || filterPosition !== "" || filterAssignment !== "";
  const hasFilters = filterSite !== ALL_SITES || debouncedSearch !== "" || hasCatalogFilters;

  // ---- Filtros por área global, puesto y asignación (con su número de trabajadores) ----
  const areaById = useMemo(() => new Map(catalog.areas.map((area) => [area.id, area])), [catalog.areas]);
  // Áreas que aplican a la sede elegida (con "Todas las sedes", las de cualquier sede).
  const scopeAreas = useMemo(
    () => catalog.areas.filter((area) => filterSite === ALL_SITES || area.site === filterSite),
    [catalog.areas, filterSite],
  );
  // Filas de conteo de la vista actual (activos o bajas; seguimiento usa todas) y de la sede elegida.
  const scopeCounts = useMemo(
    () =>
      catalog.counts.filter(
        (row) =>
          (view === "directory" ? row.active : view === "terminated" ? !row.active : true) &&
          (filterSite === ALL_SITES || row.site === filterSite),
      ),
    [catalog.counts, view, filterSite],
  );
  const areaCount = (areaId: number) => sumCounts(scopeCounts, (row) => row.area_id === areaId);
  const inArea = useCallback((row: EmployeeGroupCount) => !filterArea || row.area_id === Number(filterArea), [filterArea]);
  const matchesAssignment = useCallback(
    (row: EmployeeGroupCount) =>
      !filterAssignment || (filterAssignment === "sin" ? row.assignment_id === null : row.assignment_id === Number(filterAssignment)),
    [filterAssignment],
  );

  // Puestos y asignaciones de la sede/área elegidas, con cuántos trabajadores tiene cada uno (según el otro filtro).
  // Se ocultan los que no tienen a nadie en esta vista, salvo el que esté elegido.
  const positionOptions = useMemo(() => {
    const totals = new Map<number, number>();
    for (const row of scopeCounts) if (inArea(row) && matchesAssignment(row)) totals.set(row.position_id, (totals.get(row.position_id) ?? 0) + row.total);
    return catalog.positions
      .filter((item) => (filterSite === ALL_SITES || item.site === filterSite) && (!filterArea || item.area_id === Number(filterArea)))
      .map((item) => ({ item, count: totals.get(item.id) ?? 0 }))
      .filter(({ item, count }) => count > 0 || String(item.id) === filterPosition);
  }, [catalog.positions, scopeCounts, inArea, matchesAssignment, filterSite, filterArea, filterPosition]);

  const assignmentOptions = useMemo(() => {
    const totals = new Map<number | null, number>();
    for (const row of scopeCounts) {
      if (!inArea(row) || (filterPosition && row.position_id !== Number(filterPosition))) continue;
      totals.set(row.assignment_id, (totals.get(row.assignment_id) ?? 0) + row.total);
    }
    const items = catalog.assignments
      .filter((item) => (filterSite === ALL_SITES || item.site === filterSite) && (!filterArea || item.area_id === Number(filterArea)))
      .map((item) => ({ item, count: totals.get(item.id) ?? 0 }))
      .filter(({ item, count }) => count > 0 || String(item.id) === filterAssignment);
    return { items, without: totals.get(null) ?? 0 };
  }, [catalog.assignments, scopeCounts, inArea, filterSite, filterArea, filterPosition, filterAssignment]);

  // Con varias sedes o áreas a la vez, las opciones se agrupan por "Sede · Área" (un mismo nombre puede existir en varias).
  const groupLabel = useCallback(
    (item: CatalogItem) => {
      const area = item.area_id === null ? null : areaById.get(item.area_id);
      return area ? `${item.site} · ${area.code}` : item.site;
    },
    [areaById],
  );

  const terminatedTotal = useMemo(() => sumCounts(catalog.counts, (row) => !row.active), [catalog.counts]);

  function changeSite(site: string) {
    setFilterSite(site);
    // El área, el puesto y la asignación pertenecen a una sede: al cambiarla se limpian.
    setFilterArea("");
    setFilterPosition("");
    setFilterAssignment("");
    setPage(0);
  }

  function changeArea(areaId: string) {
    setFilterArea(areaId);
    setFilterPosition("");
    setFilterAssignment("");
    setPage(0);
  }

  function clearCatalogFilters() {
    changeArea("");
  }

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

  function changeView(next: View) {
    if (next === view) return;
    setEmployees([]);
    setView(next);
    setPage(0);
  }

  function handleSaved() {
    // Con paginación el orden y la página dependen del servidor: se vuelve a pedir solo la página actual.
    countedRef.current = null;
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
      countedRef.current = null;
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
        <div className="stats-grid stats-grid-5">
          <StatCard label="Empleados activos" count={stats?.total ?? 0} tone="green" icon={<UsersRound size={18} />} />
          <StatCard label="Campeche" count={stats?.bySite["Campeche"] ?? 0} tone="blue" icon={<Building2 size={18} />} />
          <StatCard label="Lagunas" count={stats?.bySite["Lagunas"] ?? 0} tone="gold" icon={<Building2 size={18} />} />
          <StatCard label="Cruz Azul" count={stats?.bySite["Cruz Azul"] ?? 0} tone="purple" icon={<Building2 size={18} />} />
          <StatCard label="El Carmen" count={stats?.bySite["El Carmen"] ?? 0} tone="teal" icon={<Building2 size={18} />} />
        </div>
      </PageHeader>

      <section className="directory-card">
        <div className="directory-toolbar directory-views">
          <div className="site-tabs" role="tablist" aria-label="Vista del directorio">
            <button type="button" role="tab" aria-selected={view === "directory"} className={`site-tab${view === "directory" ? " active" : ""}`} onClick={() => changeView("directory")}>
              <UsersRound size={14} /> Activos
            </button>
            <button type="button" role="tab" aria-selected={view === "terminated"} className={`site-tab${view === "terminated" ? " active" : ""}`} onClick={() => changeView("terminated")}>
              <UserMinus size={14} /> Bajas
              {terminatedTotal > 0 && <span className="site-count site-count-muted">{terminatedTotal}</span>}
            </button>
            <button type="button" role="tab" aria-selected={view === "followup"} className={`site-tab${view === "followup" ? " active" : ""}`} onClick={() => changeView("followup")}>
              <ClipboardList size={14} /> Seguimiento de expedientes
              {(stats?.followUp ?? 0) > 0 && <span className="site-count">{stats?.followUp}</span>}
            </button>
          </div>
          {view === "followup" && <span className="epp-scope">Trabajadores con observaciones pendientes en su expediente</span>}
          {view === "terminated" && <span className="epp-scope">Trabajadores dados de baja · los más recientes primero</span>}
        </div>
        <div className="directory-toolbar">
          <div className="filter-label"><Filter size={16} /><span>Filtrar por sede</span></div>
          <div className="site-tabs" role="tablist" aria-label="Filtrar por sede">
            {[ALL_SITES, ...SITES].map((site) => (
              <button
                type="button"
                role="tab"
                aria-selected={filterSite === site}
                className={`site-tab${filterSite === site ? " active" : ""}`}
                key={site}
                onClick={() => changeSite(site)}
              >
                {site === ALL_SITES ? "Todas las sedes" : site}
              </button>
            ))}
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar ID, nombre, puesto o asignación…"
              aria-label="Buscar empleado"
            />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda"><X size={15} /></button>}
          </label>
        </div>

        <div className="directory-toolbar directory-filters">
          {scopeAreas.length > 0 && (
            <div className="site-tabs" role="tablist" aria-label="Filtrar por área global">
              <button type="button" role="tab" aria-selected={filterArea === ""} className={`site-tab${filterArea === "" ? " active" : ""}`} onClick={() => changeArea("")}>
                <Layers size={14} /> Todas las áreas
              </button>
              {scopeAreas.map((area) => (
                <button
                  type="button"
                  role="tab"
                  key={area.id}
                  aria-selected={filterArea === String(area.id)}
                  className={`site-tab${filterArea === String(area.id) ? " active" : ""}`}
                  onClick={() => changeArea(String(area.id))}
                  title={area.responsible ? `Responsable: ${area.responsible}` : undefined}
                >
                  {filterSite === ALL_SITES ? `${area.site} · ${area.code}` : area.code}
                  <span className="site-count site-count-muted">{areaCount(area.id)}</span>
                </button>
              ))}
            </div>
          )}
          <label className="filter-select">
            Puesto
            <select value={filterPosition} onChange={(event) => { setFilterPosition(event.target.value); setPage(0); }} aria-label="Filtrar por puesto">
              <option value="">Todos los puestos</option>
              <CatalogOptions options={positionOptions} groupLabel={groupLabel} />
            </select>
          </label>
          <label className="filter-select">
            Asignación
            <select value={filterAssignment} onChange={(event) => { setFilterAssignment(event.target.value); setPage(0); }} aria-label="Filtrar por asignación">
              <option value="">Todas las asignaciones</option>
              {(assignmentOptions.without > 0 || filterAssignment === "sin") && <option value="sin">Sin asignación ({assignmentOptions.without})</option>}
              <CatalogOptions options={assignmentOptions.items} groupLabel={groupLabel} />
            </select>
          </label>
          {hasCatalogFilters && (
            <button type="button" className="text-button" onClick={clearCatalogFilters}><X size={14} /> Limpiar filtros</button>
          )}
        </div>

        {pageError && <div className="error-banner" role="alert">{pageError}</div>}
        <div className="table-scroll">
          <table className="employee-table">
            <thead>
              <tr>
                <th className="hide-phone">ID empleado</th>
                <th>Nombre completo</th>
                <th className="hide-phone">Sede</th>
                {view === "followup" ? (
                  <>
                    <th>Observaciones</th>
                    <th className="hide-tablet">Última actualización</th>
                  </>
                ) : view === "terminated" ? (
                  <>
                    <th className="hide-tablet">Puesto / asignación</th>
                    <th>Fecha de baja</th>
                    <th className="hide-tablet">Motivo</th>
                  </>
                ) : (
                  <>
                    <th className="hide-tablet">Puesto / asignación</th>
                    <th className="hide-tablet">Tipo de contrato</th>
                    <th>Estatus</th>
                  </>
                )}
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
                  <td className="hide-phone">
                    <span className="site-area">
                      <SiteBadge site={employee.site} />
                      {employee.area_id !== null && areaById.get(employee.area_id) && <span className="area-badge">{areaById.get(employee.area_id)?.code}</span>}
                    </span>
                  </td>
                  {view === "followup" ? (
                    <>
                      <td className="observation-cell"><p title={employee.observations ?? ""}>{employee.observations}</p></td>
                      <td className="hide-tablet">
                        {employee.observations_updated_by_name ?? "—"}
                        <br />
                        <small className="epp-muted">{employee.observations_updated_at ? formatDateTime(employee.observations_updated_at) : ""}</small>
                      </td>
                    </>
                  ) : view === "terminated" ? (
                    <>
                      <td className="position-cell hide-tablet">{employee.position}<small className="assignment-line">{employee.assignment ?? "Sin asignación"}</small></td>
                      <td className="contract-cell">{employee.termination_date ? formatDate(employee.termination_date) : "Sin fecha"}</td>
                      <td className="observation-cell hide-tablet"><p title={employee.termination_reason ?? ""}>{employee.termination_reason || "—"}</p></td>
                    </>
                  ) : (
                    <>
                      <td className="position-cell hide-tablet">{employee.position}<small className="assignment-line">{employee.assignment ?? "Sin asignación"}</small></td>
                      <td className="contract-cell hide-tablet">{employee.contract_type}</td>
                      <td><StatusBadge active={employee.active} /></td>
                    </>
                  )}
                  <td className="row-actions">
                    <button className="text-button hide-tablet" onClick={() => void openProfile(employee)} disabled={detailLoadingId === employee.id}>{detailLoadingId === employee.id ? "Abriendo…" : "Ver expediente"}</button>
                    {can("employees.edit") && <button className="icon-button row-edit" onClick={() => void openEditFromRow(employee)} disabled={detailLoadingId === employee.id} aria-label={`Editar ${employee.full_name}`} title="Editar"><Pencil size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <LoadingState label="Cargando empleados…" rows={employees.length === 0 ? 6 : 0} />}
          {!loading && employees.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon"><UserRound size={25} /></div>
              <h2>
                {view === "followup"
                  ? hasFilters ? "Ningún expediente en seguimiento coincide" : "No hay expedientes en seguimiento"
                  : view === "terminated"
                    ? hasFilters ? "Ninguna baja coincide" : "No hay trabajadores dados de baja"
                    : !hasFilters ? "Aún no hay empleados registrados" : "No se encontraron empleados"}
              </h2>
              <p>
                {view === "followup"
                  ? "Aquí aparecen los trabajadores con observaciones en su expediente. Escríbelas al editar el expediente."
                  : view === "terminated"
                    ? "Aquí aparecen los trabajadores dados de baja desde su expediente."
                    : !hasFilters ? "Agrega el primer expediente para empezar a usar el directorio." : "Prueba con otro nombre, ID, sede, puesto o asignación."}
              </p>
              {view === "directory" && !hasFilters && can("employees.create") && <button className="button button-primary" onClick={() => void openCreateForm()}><Plus size={17} /> Registrar empleado</button>}
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
          catalog={catalog}
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
          onChanged={(employee) => {
            setSelectedEmployee(employee);
            countedRef.current = null;
            void refreshEmployees();
            // Baja o reactivación: los contadores (solo activos) cambian.
            void loadStats();
          }}
        />
      )}
    </main>
  );
}

/** Opciones de puesto / asignación con su número de trabajadores; agrupadas por sede y área si hay varias. */
function CatalogOptions({
  options,
  groupLabel,
}: {
  options: { item: CatalogItem; count: number }[];
  groupLabel: (item: CatalogItem) => string;
}) {
  const groups = new Map<string, { item: CatalogItem; count: number }[]>();
  for (const option of options) {
    const label = groupLabel(option.item);
    groups.set(label, [...(groups.get(label) ?? []), option]);
  }
  const render = (list: { item: CatalogItem; count: number }[]) =>
    [...list]
      .sort((a, b) => a.item.name.localeCompare(b.item.name, "es-MX"))
      .map(({ item, count }) => <option key={item.id} value={String(item.id)}>{item.name} ({count})</option>);
  if (groups.size <= 1) return <>{render(options)}</>;
  return (
    <>
      {[...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "es-MX"))
        .map(([label, list]) => <optgroup key={label} label={label}>{render(list)}</optgroup>)}
    </>
  );
}
