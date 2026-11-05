import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import {
  employeeNotifications,
  eppNotifications,
  purchaseNotifications,
  sortNotifications,
  type AppNotification,
  type EmployeeCheckRow,
  type EppStockRow,
  type NotificationSourceStatus,
  type NotificationsResponse,
} from "@/lib/notifications";
import { getAuthenticatedClient } from "../employees/_server";
import { readPurchaseRequests } from "../epp/requests/_read";

const BATCH_SIZE = 1000;
const MAX_ROWS = 20_000;
// La tabla aún no existe en este entorno (p. ej. falta ejecutar una migración).
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "42703"]);

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
  const has = (key: string) => access.permissions.includes(key as never);

  const readEmployees = async (): Promise<SourceResult> => {
    if (!has("employees.view")) return { status: "no_permission", items: [] };
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

  // Faltantes por sede: solo para quien opera el inventario (no para compras, que recibe solicitudes).
  // Las políticas RLS ya devuelven únicamente las sedes a las que la cuenta tiene acceso.
  const readInventory = async (): Promise<SourceResult> => {
    const operates = has("epp.view") && (has("epp.request") || has("epp.manage") || has("epp.deliver"));
    if (!operates) return { status: "no_permission", items: [] };
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
    if (!has("epp.purchase") || access.is_super_admin) return { status: "no_permission", items: [] };
    try {
      const { error, requests } = await readPurchaseRequests(client, { open: true, limit: 500 });
      if (error) throw error;
      return { status: "ok", items: purchaseNotifications(requests.filter((row) => row.status === "pendiente")) };
    } catch (error) {
      return failedSource("solicitudes de compra", error);
    }
  };

  const [employees, inventory, purchases] = await Promise.all([readEmployees(), readInventory(), readPurchases()]);

  const body: NotificationsResponse = {
    items: sortNotifications([...purchases.items, ...inventory.items, ...employees.items]),
    sources: { employees: employees.status, inventory: inventory.status, purchases: purchases.status },
    checked_at: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
