/**
 * Búsqueda de artículos de EPP pensada en cómo se escribe en el almacén:
 *   "camisola l", "camisola talla l", "camisola t-l", "botas 27", "guantes nitrilo", "overol 2xl"…
 *
 * - No hace falta el nombre completo: cada palabra escrita basta con que sea el inicio (o parte) de
 *   alguna palabra del nombre o de la categoría ("cami" → CAMISOLA DE MEZCLILLA CON REFLEJANTE).
 * - "talla", "de", "con", "para"… se ignoran.
 * - Una palabra que es talla (S, M, L, XL, 2XL, 27, 25.5, CH, G…) se compara contra la TALLA del
 *   artículo exacta: "camisola l" da solo la L (no la XL ni la XXL).
 * - Resultados ordenados: primero lo que empieza con lo escrito y, entre tallas, de chica a grande.
 */

export type SearchableArticle = { name: string; size?: string | null; category?: string | null };

/** Minúsculas y sin acentos. */
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palabras (letras/números; conserva decimales como 25.5). */
const words = (value: string) => fold(value).match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];

// Palabras de relleno que no ayudan a encontrar nada.
const FILLER = new Set(["de", "del", "con", "para", "la", "el", "los", "las", "y", "en", "num", "numero", "no", "n"]);
// Mientras se escribe "talla" (tal, tall, talla) o se abrevia "t" / "tll".
const isTallaWord = (token: string) => token === "t" || token === "tll" || token === "tallas" || (token.length >= 3 && "talla".startsWith(token));

// Formas en que se dice una talla → como se guarda.
const SIZE_ALIASES: Record<string, string> = {
  ch: "s", chica: "s", chico: "s", small: "s",
  med: "m", mediana: "m", mediano: "m", medium: "m",
  g: "l", gde: "l", grande: "l", large: "l",
  eg: "xl", xg: "xl",
  "2xl": "xxl", "3xl": "xxxl", "4xl": "xxxxl", "5xl": "xxxxxl",
  eeg: "xxl", xxg: "xxl",
};
const LETTER_SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "xxxxl", "xxxxxl"];

const canonicalSize = (value: string) => {
  const token = fold(value).replace(/[\s.-]/g, "").replace(/^(talla|tall|tal|t)(?=x*[sml]$|x*l$|\d)/, "");
  return SIZE_ALIASES[token] ?? token;
};
const looksLikeSize = (token: string) => LETTER_SIZES.includes(canonicalSize(token)) || /^\d+(\.\d+)?$/.test(token);

/** Orden de tallas: S < M < L < XL…; números de menor a mayor; lo demás al final. */
export function sizeOrder(size: string | null | undefined): number {
  if (!size?.trim()) return -1;
  const canon = canonicalSize(size);
  const letter = LETTER_SIZES.indexOf(canon);
  if (letter >= 0) return letter;
  const number = Number(canon);
  return Number.isFinite(number) ? 100 + number : 10_000;
}

type Query = { text: string[]; sizes: string[] };

/** Separa lo escrito en palabras del nombre y tallas. */
export function parseArticleQuery(raw: string): Query {
  const tokens = words(raw)
    // "talla l" / "t-l" / "tl" pegado → talla L
    .flatMap((token) => (/^t(x*[sml]|\d+(\.\d+)?)$/.test(token) && token !== "t" ? ["t", token.slice(1)] : [token]));
  const text: string[] = [];
  const sizes: string[] = [];
  tokens.forEach((token, index) => {
    if (isTallaWord(token) || FILLER.has(token)) return;
    const afterTalla = index > 0 && isTallaWord(tokens[index - 1]);
    // Lo que va después de "talla" siempre es talla; si no, solo si parece talla y no es la primera palabra.
    if (afterTalla || (index > 0 && looksLikeSize(token))) sizes.push(canonicalSize(token));
    else text.push(token);
  });
  return { text, sizes };
}

/**
 * Puntuación de un artículo para lo escrito: null = no coincide; menor = mejor.
 * Se usa en los buscadores (pantalla) y en el historial (servidor).
 */
export function scoreArticle(article: SearchableArticle, query: Query): number | null {
  const nameWords = words(article.name);
  const haystack = [...nameWords, ...words(article.category ?? "")];
  const size = article.size?.trim() ? canonicalSize(article.size) : "";
  let score = 0;

  for (const token of query.text) {
    if (nameWords[0]?.startsWith(token) && token === query.text[0]) continue; // empieza con lo escrito
    if (nameWords.some((word) => word.startsWith(token))) { score += 1; continue; }
    if (haystack.some((word) => word.startsWith(token))) { score += 2; continue; }
    // Una sola palabra que es la talla ("l", "27") también puede buscar solo por talla.
    if (query.text.length === 1 && query.sizes.length === 0 && size && canonicalSize(token) === size) { score += 1; continue; }
    // A media palabra ("flej" → REFLEJANTE), solo con 3 letras o más para no traer todo con una "l".
    if (token.length >= 3 && haystack.some((word) => word.includes(token))) { score += 4; continue; }
    return null;
  }

  for (const wanted of query.sizes) {
    if (size) {
      if (size !== wanted) return null;
      continue;
    }
    // Artículo sin talla: la palabra puede ser parte del nombre ("barbiquejo 4", "guantes m…").
    if (!nameWords.some((word) => word.startsWith(wanted))) return null;
    score += 1;
  }

  return score;
}

export type ArticleSearch<T> = {
  items: T[];
  /** Talla que se pidió y no hay ("L"): se muestran las demás opciones de ese artículo. */
  missingSize: string | null;
  /** No hubo coincidencia completa: se muestran los parecidos (solo con la primera palabra). */
  loose: boolean;
};

function rank<T extends SearchableArticle>(articles: T[], query: Query): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of articles) {
    const score = scoreArticle(item, query);
    if (score !== null) scored.push({ item, score });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.item.name.localeCompare(b.item.name, "es") ||
        sizeOrder(a.item.size) - sizeOrder(b.item.size),
    )
    .map((entry) => entry.item);
}

/**
 * Busca con respaldo para que nunca quede vacío sin razón:
 *   1. Nombre + talla exacta ("camisola l" → CAMISOLA · L).
 *   2. Si esa talla no está, todas las tallas del artículo ("camisola l" → CAMISOLA · S, M, XL…).
 *   3. Si aun así nada, lo que coincida con la primera palabra ("camisola azul" → camisolas).
 */
export function searchArticlesDetailed<T extends SearchableArticle>(articles: T[], raw: string): ArticleSearch<T> {
  const query = parseArticleQuery(raw);
  if (query.text.length + query.sizes.length === 0) return { items: articles, missingSize: null, loose: false };

  const exact = rank(articles, query);
  if (exact.length > 0) return { items: exact, missingSize: null, loose: false };

  if (query.sizes.length > 0 && query.text.length > 0) {
    const anySize = rank(articles, { text: query.text, sizes: [] });
    if (anySize.length > 0) return { items: anySize, missingSize: query.sizes.join(" ").toUpperCase(), loose: false };
  }

  const first = query.text[0] ?? query.sizes[0];
  if (first && query.text.length + query.sizes.length > 1) {
    const loose = rank(articles, { text: [first], sizes: [] });
    if (loose.length > 0) return { items: loose, missingSize: null, loose: true };
  }

  return { items: [], missingSize: null, loose: false };
}

/** Filtra y ordena artículos según lo escrito (con respaldo). Sin texto, devuelve la lista tal cual. */
export function searchArticles<T extends SearchableArticle>(articles: T[], raw: string): T[] {
  return searchArticlesDetailed(articles, raw).items;
}
