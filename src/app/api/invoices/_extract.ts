import { extractText, getDocumentProxy } from "unpdf";

const MAX_TEXT_CHARS = 200_000;

export class InvalidPdfError extends Error {}

/**
 * Digitaliza el PDF: devuelve su texto página por página. Un PDF escaneado (solo imagen) no trae
 * texto y regresa vacío; en ese caso los datos se capturan a mano.
 */
export async function pdfToText(bytes: Uint8Array): Promise<{ text: string; plain: string; pages: number }> {
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new InvalidPdfError("El archivo no es un PDF válido.");
  }
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new InvalidPdfError("El PDF está dañado o protegido con contraseña.");
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((page, index) => `--- Página ${index + 1} ---\n${page.trim()}`);
    const hasText = (text as string[]).some((page) => page.trim().length > 0);
    return {
      // Texto que se guarda (con separador por página) y texto continuo para detectar los datos.
      text: hasText ? pages.join("\n\n").slice(0, MAX_TEXT_CHARS) : "",
      plain: hasText ? (text as string[]).join(" ") : "",
      pages: totalPages,
    };
  } finally {
    void pdf.destroy();
  }
}
