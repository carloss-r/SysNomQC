import type { SupabaseClient } from "@supabase/supabase-js";
import type { EppPurchaseRequest } from "@/lib/permissions";

const COLUMNS =
  "id,site,status,notes,requested_by_name,created_at,updated_at,handled_by_name,status_note,purchased_at,purchased_by_name,shortage_ack_at,shortage_ack_by_name," +
  "items:epp_purchase_request_items(article_id,article_name,unit,quantity,stock_at_request,min_stock,received_qty,counted_at,counted_by_name)";

type BuyRow = { request_id: number; article_id: number; purchased_qty: number };

/**
 * Solicitudes visibles para la cuenta (las políticas RLS limitan por sede y por permiso).
 * withPurchased: agrega la cantidad comprada; solo para cuentas de compras. A quien cuenta lo que llega
 * nunca se le envía (conteo ciego), y la política de epp_purchase_buys tampoco se la devolvería.
 */
export async function readPurchaseRequests(
  client: SupabaseClient,
  filters: { site?: string | null; open?: boolean; status?: string[]; limit?: number; withPurchased?: boolean; unacknowledged?: boolean } = {},
) {
  let query = client.from("epp_purchase_requests").select(COLUMNS).order("created_at", { ascending: false }).limit(filters.limit ?? 300);
  if (filters.site) query = query.eq("site", filters.site);
  if (filters.open) query = query.in("status", ["pendiente", "en_compra"]);
  else if (filters.status) query = query.in("status", filters.status);
  if (filters.unacknowledged) query = query.is("shortage_ack_at", null);
  const { data, error } = await query;
  if (error) return { error, requests: [] as EppPurchaseRequest[] };
  const rows = data as unknown as EppPurchaseRequest[];

  const bought = new Map<string, number>();
  const ids = rows.filter((row) => row.status !== "pendiente").map((row) => row.id);
  if (filters.withPurchased && ids.length > 0) {
    const buys = await client.from("epp_purchase_buys").select("request_id,article_id,purchased_qty").in("request_id", ids).limit(5000);
    if (buys.error) return { error: buys.error, requests: [] as EppPurchaseRequest[] };
    for (const row of buys.data as BuyRow[]) bought.set(`${row.request_id}:${row.article_id}`, row.purchased_qty);
  }

  const requests = rows.map((row) => ({
    ...row,
    items: [...(row.items ?? [])]
      .map((item) => {
        if (!filters.withPurchased) return item;
        return { ...item, purchased_qty: bought.get(`${row.id}:${item.article_id}`) ?? null };
      })
      .sort((a, b) => a.article_name.localeCompare(b.article_name, "es")),
  }));
  return { error: null, requests };
}
