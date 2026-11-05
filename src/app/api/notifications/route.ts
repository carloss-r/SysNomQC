import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import {
  employeeNotifications,
  eppNotifications,
  sortNotifications,
  type AppNotification,
  type EmployeeCheckRow,
  type EppArticleRow,
  type NotificationSourceStatus,
  type NotificationsResponse,
} from "@/lib/notifications";
import { getAuthenticatedClient } from "../employees/_server";

const BATCH_SIZE = 1000;
const MAX_ROWS = 20_000;
// La tabla aún no existe en este entorno (p. ej. una base local sin el módulo de EPP).
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

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

// Cada fuente se revisa por separado: si una falla, las alertas de la otra siguen llegando.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  const { client, access } = auth;

  const readEmployees = async (): Promise<SourceResult> => {
    if (!access.permissions.includes("employees.view")) return { status: "no_permission", items: [] };
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

  const readInventory = async (): Promise<SourceResult> => {
    if (!access.permissions.includes("epp.view")) return { status: "no_permission", items: [] };
    try {
      const rows = await readAll<EppArticleRow>((from, to) =>
        client
          .from("epp_articles")
          .select("id,name,stock,min_stock,unit")
          .eq("active", true)
          .order("id")
          .range(from, to),
      );
      return { status: "ok", items: eppNotifications(rows) };
    } catch (error) {
      return failedSource("inventario", error);
    }
  };

  const [employees, inventory] = await Promise.all([readEmployees(), readInventory()]);

  const body: NotificationsResponse = {
    items: sortNotifications([...inventory.items, ...employees.items]),
    sources: { employees: employees.status, inventory: inventory.status },
    checked_at: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
