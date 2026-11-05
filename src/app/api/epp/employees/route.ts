import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import { createServiceClient } from "@/lib/supabase-admin";
import { getAuthenticatedClient } from "../../employees/_server";

// Lista mínima (sin datos personales sensibles) para elegir a quién se entrega el EPP.
// Se usa la llave de servidor porque quien entrega EPP no necesariamente puede ver expedientes.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.deliver");
  if ("response" in auth) return auth.response;
  const admin = createServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 500 });
  }
  try {
    const { data, error } = await admin
      .from("employees")
      .select("id,employee_code,full_name,site,position")
      .eq("active", true)
      .order("full_name")
      .limit(1000);
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    reportServerIncident("api · epp · trabajadores", error);
    return NextResponse.json({ error: "No se pudo cargar la lista de trabajadores." }, { status: 500 });
  }
}
