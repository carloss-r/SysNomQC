import { supabase } from "@/lib/supabase";

// Permisos SEMARNAT en PDF: bucket privado "fuel-permits". En la base solo se guarda la ruta.
export const PERMIT_BUCKET = "fuel-permits";
export const MAX_PERMIT_BYTES = 10 * 1024 * 1024;

const newId = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function permitFileProblem(file: File): string | null {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "El permiso debe ser un archivo PDF.";
  if (file.size > MAX_PERMIT_BYTES) return "El PDF pesa más de 10 MB.";
  return null;
}

/** Sube el PDF y devuelve su ruta dentro del bucket. */
export async function uploadPermit(file: File): Promise<string> {
  const path = `${newId()}.pdf`;
  const { error } = await supabase.storage.from(PERMIT_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw error;
  return path;
}

/** Abre el PDF con un enlace temporal (el bucket es privado). */
export async function openPermit(path: string): Promise<boolean> {
  // La pestaña se abre antes de pedir el enlace para que el navegador no la bloquee.
  const tab = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(PERMIT_BUCKET).createSignedUrl(path, 10 * 60);
  if (error || !data) {
    tab?.close();
    return false;
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.assign(data.signedUrl);
  return true;
}

export async function removePermit(path: string) {
  try {
    await supabase.storage.from(PERMIT_BUCKET).remove([path]);
  } catch (error) {
    console.error("No se pudo eliminar el PDF anterior:", error);
  }
}
