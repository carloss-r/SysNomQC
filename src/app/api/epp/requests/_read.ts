import type { SupabaseClient } from "@supabase/supabase-js";
import type { EppPurchaseRequest } from "@/lib/permissions";

const COLUMNS =
  "id,site,status,notes,requested_by_name,created_at,updated_at,handled_by_name,status_note,items:epp_purchase_request_items(article_id,article_name,unit,quantity,stock_at_request,min_stock)";

/** Solicitudes visibles para la cuenta (las políticas RLS limitan por sede y por permiso). */
export async function readPurchaseRequests(
  client: SupabaseClient,
  filters: { site?: string | null; open?: boolean; limit?: number } = {},
) {
  let query = client.from("epp_purchase_requests").select(COLUMNS).order("created_at", { ascending: false }).limit(filters.limit ?? 300);
  if (filters.site) query = query.eq("site", filters.site);
  if (filters.open) query = query.in("status", ["pendiente", "en_compra"]);
  const { data, error } = await query;
  if (error) return { error, requests: [] as EppPurchaseRequest[] };
  const requests = (data as unknown as EppPurchaseRequest[]).map((row) => ({
    ...row,
    items: [...(row.items ?? [])].sort((a, b) => a.article_name.localeCompare(b.article_name, "es")),
  }));
  return { error: null, requests };
}
