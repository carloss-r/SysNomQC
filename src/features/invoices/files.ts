import { supabase } from "@/lib/supabase";

// PDF de facturas: bucket privado "invoices". En la base solo se guarda la ruta y el texto extraído.
export const INVOICE_BUCKET = "invoices";
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

const newId = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function invoiceFileProblem(file: File): string | null {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "La factura debe ser un archivo PDF.";
  if (file.size > MAX_INVOICE_BYTES) return "El PDF pesa más de 10 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}

/** Sube el PDF y devuelve su ruta dentro del bucket. */
export async function uploadInvoiceFile(file: File): Promise<string> {
  const path = `${newId()}.pdf`;
  const { error } = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw error;
  return path;
}

/** Abre el PDF con un enlace temporal (el bucket es privado). */
export async function openInvoiceFile(path: string): Promise<boolean> {
  // La pestaña se abre antes de pedir el enlace para que el navegador no la bloquee.
  const tab = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(INVOICE_BUCKET).createSignedUrl(path, 10 * 60);
  if (error || !data) {
    tab?.close();
    return false;
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.assign(data.signedUrl);
  return true;
}

/** Descarga el PDF y devuelve una URL local (blob:) para mostrarlo dentro de la pantalla. Revocarla al cerrar. */
export async function loadInvoicePreview(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(INVOICE_BUCKET).download(path);
  if (error || !data) throw error ?? new Error("Sin archivo");
  return URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
}

/** Descarga el texto digitalizado como .txt. */
export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
