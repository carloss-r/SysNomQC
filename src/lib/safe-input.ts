import { z } from "zod";

/**
 * Defensas contra inyección (SQL / filtros de PostgREST) y datos basura.
 *
 * La app nunca arma SQL con texto: todas las consultas van por supabase-js (PostgREST), que envía los
 * valores como parámetros, y las funciones de la base reciben parámetros tipados. El único punto donde
 * el texto del usuario se mete dentro de una expresión es en los filtros `.or("col.ilike.*texto*")`,
 * cuyo formato usa comas, paréntesis, puntos y comillas como separadores. Por eso:
 *   1. `searchTerm()` deja en una búsqueda solo letras, números, espacios y guiones.
 *   2. `safeText()` rechaza caracteres de control y marcas de HTML en los datos que se guardan.
 */

// Caracteres de control (excepto salto de línea y tabulador, que se permiten en textos largos).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const CONTROL_SINGLE_LINE = /[\u0000-\u001F\u007F]/;
const MARKUP = /[<>]/;

/**
 * Texto de búsqueda seguro para filtros de PostgREST (`ilike`, `.or()`): solo letras (con acentos),
 * números, espacios, guion y guion bajo convertido en espacio. Todo lo demás se vuelve espacio.
 */
export function searchTerm(raw: string | null | undefined, max = 60): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Texto libre que se guarda: sin caracteres de control ni `<` `>`. */
export function safeText(max: number, options: { min?: number; multiline?: boolean } = {}) {
  const control = options.multiline ? CONTROL : CONTROL_SINGLE_LINE;
  return z
    .string()
    .trim()
    .min(options.min ?? 0)
    .max(max)
    .refine((value) => !control.test(value), "Contiene caracteres no permitidos.")
    .refine((value) => !MARKUP.test(value), "No uses los signos < ni >.");
}

/** Ruta de un archivo en Storage: sin `..`, sin barras al inicio y solo caracteres seguros. */
export const storagePathSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9/_.-]*$/, "Ruta de archivo no válida.")
  .refine((value) => !value.includes(".."), "Ruta de archivo no válida.");
