import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import {
  employeeNotifications,
  eppNotifications,
  fuelNotifications,
  purchaseNotifications,
  sortNotifications,
  type AppNotification,
  type EmployeeCheckRow,
  type EppStockRow,
  type FuelPermitRow,
  type FuelSemaphoreRow,
  type NotificationSourceStatus,
  type NotificationsResponse,
} from "@/lib/notifications";
import { daysBetween, PERMIT_WARNING_DAYS, plantToday } from "@/lib/fuels";
import { getAuthenticatedClient } from "../employees/_server";
import { readPurchaseRequests } from "../epp/requests/_read";

const BATCH_SIZE = 1000;
const MAX_ROWS = 20_000;
// La tabla aún no existe en este entorno (p. ej. falta ejecutar una migración).
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST202", "42883"]);

type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };

async function readAll<T>(readPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = [];
  while (rows.length < MAX_ROWS) {
    const { data, error } = await readPage(rows.length, rows.length + BATCH_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < BATCH_SIZE) break;
  }
  return rows;
}

type SourceResult = { status: NotificationSourceStatus; items: AppNotification[] };

function failedSource(area: string, error: unknown): SourceResult {
  const code = (error as { code?: string } | null)?.code;
  if (!code || !MISSING_TABLE_CODES.has(code)) {
    console.error(`No se pudo revisar ${area}:`, error);
    reportServerIncident(`api · notificaciones (${area})`, error);
  }
  return { status: "unavailable", items: [] };
}

type ArticleRef = { name: string; unit: string; active: boolean };
type StockJoin = { article_id: number; site: string; stock: number; min_stock: number; article: ArticleRef | ArticleRef[] | null };
const articleOf = (row: StockJoin) => (Array.isArray(row.article) ? (row.article[0] ?? null) : row.article);

// Cada fuente se revisa por separado: si una falla, las alertas de las otras siguen llegando.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  const { client, access } = auth;
  // Cada aviso va al rol que lo atiende. El Super administrador tiene todos los permisos, por eso
  // se excluye explícitamente de las alertas operativas y solo recibe las de expedientes.
  const has = (key: string) => access.permissions.includes(key as never);
  const operator = (key: string) => !access.is_super_admin && has(key);

  const readEmployees = async (): Promise<SourceResult> => {
    // Avisos de expedientes incompletos: solo para el Super administrador.
    if (!access.is_super_admin || !has("employees.view")) return { status: "no_permission", items: [] };
    try {
      const rows = await readAll<EmployeeCheckRow>((from, to) =>
        client
          .from("employees")
          .select("id,employee_code,full_name,salary,bank_account,nss,curp,rfc,email,phone")
          .eq("active", true)
          .order("id")
          .range(from, to),
      );
      return { status: "ok", items: employeeNotifications(rows) };
    } catch (error) {
      return failedSource("expedientes", error);
    }
  };

  // Faltantes por sede: solo para quien administra el inventario de EPP (no para compras, que recibe solicitudes).
  // Las políticas RLS ya devuelven únicamente las sedes a las que la cuenta tiene acceso.
  const readInventory = async (): Promise<SourceResult> => {
    if (!operator("epp.view") || !operator("epp.manage")) return { status: "no_permission", items: [] };
    try {
      const [stock, open] = await Promise.all([
        readAll<StockJoin>((from, to) =>
          client
            .from("epp_stock")
            .select("article_id,site,stock,min_stock,article:epp_articles(name,unit,active)")
            .order("site")
            .order("article_id")
            .range(from, to),
        ),
        readPurchaseRequests(client, { open: true, limit: 1000 }),
      ]);
      if (open.error) throw open.error;
      const requested = new Map<string, number>();
      for (const req of open.requests) for (const item of req.items) requested.set(`${req.site}:${item.article_id}`, req.id);

      const rows: EppStockRow[] = stock
        .filter((row) => articleOf(row)?.active)
        .map((row) => ({
          article_id: row.article_id,
          site: row.site,
          name: articleOf(row)?.name ?? "Artículo",
          unit: articleOf(row)?.unit ?? "PIEZAS",
          stock: row.stock,
          min_stock: row.min_stock,
          open_request: requested.get(`${row.site}:${row.article_id}`) ?? null,
        }));
      return { status: "ok", items: eppNotifications(rows) };
    } catch (error) {
      return failedSource("inventario", error);
    }
  };

  // Aviso especial: solo el rol que atiende compras (SuperAdmin las consulta en la pantalla de EPP).
  const readPurchases = async (): Promise<SourceResult> => {
    if (!operator("epp.purchase")) return { status: "no_permission", items: [] };
    try {
      // Con sede asignada, solo las solicitudes de esa sede.
      const { error, requests } = await readPurchaseRequests(client, { open: true, limit: 500, site: access.site });
      if (error) throw error;
      return { status: "ok", items: purchaseNotifications(requests.filter((row) => row.status === "pendiente")) };
    } catch (error) {
      return failedSource("solicitudes de compra", error);
    }
  };

  // Combustibles alternos: semáforo para quien programa, opera la báscula o es de Ecología;
  // permisos SEMARNAT por vencer para quien homologa proveedores o programa.
  const readFuels = async (): Promise<SourceResult> => {
    const watchesSemaphore = operator("fuels.schedule") || operator("fuels.ecology") || operator("fuels.scale");
    const watchesPermits = operator("fuels.suppliers") || operator("fuels.schedule");
    if (!operator("fuels.view") || (!watchesSemaphore && !watchesPermits)) return { status: "no_permission", items: [] };
    try {
      const today = plantToday();
      let semaphore: FuelSemaphoreRow | null = null;
      if (watchesSemaphore) {
        const { data, error } = await client.rpc("fuel_month_summary", { p_month: today });
        if (error) throw error;
        semaphore = data as FuelSemaphoreRow;
      }
      let permits: FuelPermitRow[] = [];
      if (watchesPermits) {
        const limit = new Date(Date.parse(`${today}T00:00:00Z`) + PERMIT_WARNING_DAYS * 86_400_000).toISOString().slice(0, 10);
        const { data, error } = await client
          .from("fuel_suppliers")
          .select("id,business_name,permit_valid_until")
          .eq("status", "aprobado")
          .lte("permit_valid_until", limit)
          .limit(500);
        if (error) throw error;
        permits = (data as Omit<FuelPermitRow, "days">[]).map((row) => ({ ...row, days: daysBetween(today, row.permit_valid_until) }));
      }
      return { status: "ok", items: fuelNotifications(semaphore, permits) };
    } catch (error) {
      return failedSource("combustibles alternos", error);
    }
  };

  const [employees, inventory, purchases, fuels] = await Promise.all([readEmployees(), readInventory(), readPurchases(), readFuels()]);

  const body: NotificationsResponse = {
    items: sortNotifications([...purchases.items, ...fuels.items, ...inventory.items, ...employees.items]),
    sources: { employees: employees.status, inventory: inventory.status, purchases: purchases.status, fuels: fuels.status },
    checked_at: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
