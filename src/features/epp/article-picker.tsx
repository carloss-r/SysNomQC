"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { eppArticleLabel, type EppArticle } from "@/lib/permissions";
import { searchArticlesDetailed } from "@/lib/epp-search";

// Alcanza para ver todas las tallas de una prenda (S a XXXXL) sin seguir escribiendo.
const MAX_RESULTS = 8;

const label = (item: EppArticle) => eppArticleLabel(item.name, item.size);

/**
 * Buscador de artículos: basta con el inicio del nombre y la talla ("camisola l", "camisola talla l",
 * "botas 27"); ver lib/epp-search. Muestra hasta 8 coincidencias. Flechas para moverse, Enter para
 * elegir, Esc para cerrar.
 */
export function ArticlePicker({
  articles,
  value,
  taken = [],
  onChange,
  detail = (item) => `${item.category} · hay ${item.stock}`,
  selectedText = (item) => `${label(item)} (hay ${item.stock})`,
  blocked = () => null,
}: {
  articles: EppArticle[];
  value: string;
  /** Artículos ya elegidos en otros renglones: no se ofrecen otra vez. */
  taken?: string[];
  onChange: (id: string) => void;
  /** Segunda línea de cada resultado. */
  detail?: (item: EppArticle) => string;
  /** Texto del campo con el artículo ya elegido. */
  selectedText?: (item: EppArticle) => string;
  /**
   * Por qué un artículo no se puede elegir aquí (sin existencia, compra sin contar, ya pedido…), o null.
   * Esos artículos SÍ aparecen en la búsqueda, en gris y con la razón, para que nunca parezca que no existen.
   */
  blocked?: (item: EppArticle) => string | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const selected = articles.find((item) => String(item.id) === value) ?? null;
  const reasonOf = (item: EppArticle) =>
    taken.includes(String(item.id)) ? "Ya está en otro renglón de esta lista" : blocked(item);
  const { matches, extra, notice } = useMemo(() => {
    const result = searchArticlesDetailed(articles, query);
    // Primero lo que se puede elegir; lo bloqueado después, en el mismo orden de búsqueda.
    const found = [
      ...result.items.filter((item) => !reasonOf(item)),
      ...result.items.filter((item) => reasonOf(item)),
    ];
    const notice = result.missingSize
      ? `No hay talla ${result.missingSize} aquí. Estas son las demás opciones:`
      : result.loose
        ? "Sin coincidencia exacta. Opciones parecidas:"
        : "";
    // Si no hubo coincidencia exacta se muestran todas las opciones (pocas) para elegir sin volver a escribir.
    const limit = notice ? Math.max(MAX_RESULTS, 12) : MAX_RESULTS;
    return { matches: found.slice(0, limit), extra: Math.max(0, found.length - limit), notice };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, query, taken, blocked]);

  function choose(item: EppArticle) {
    if (reasonOf(item)) return;
    onChange(String(item.id));
    setQuery("");
    setOpen(false);
    setHighlight(0);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") return setOpen(false);
    if (!open || matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = matches[highlight] ?? matches.find((item) => !reasonOf(item));
      if (chosen) choose(chosen);
    }
  }

  return (
    <div className="epp-combo">
      <div className="search-box epp-search">
        <Search size={15} />
        <input
          value={open ? query : selected ? selectedText(selected) : ""}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={selected ? label(selected) : "Ej. camisola l, botas 27, guantes"}
          title={selected ? label(selected) : undefined}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
        />
        {!open && selected?.size && <span className="epp-size epp-size-strong">Talla {selected.size}</span>}
      </div>
      {open && (
        <ul id={listId} className="epp-results epp-dropdown" role="listbox">
          {notice && matches.length > 0 && <li className="epp-notice">{notice}</li>}
          {matches.length === 0 && <li className="epp-empty">{articles.length === 0 ? "No hay artículos disponibles en esta sede." : "Sin coincidencias."}</li>}
          {matches.map((item, index) => {
            const reason = reasonOf(item);
            return (
            <li key={item.id}>
              <button
                type="button"
                className={`${index === highlight ? "active" : ""}${reason ? " epp-blocked" : ""}`}
                aria-disabled={reason ? true : undefined}
                title={reason ?? undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(item)}
              >
                <span className="epp-result-title">
                  <strong title={label(item)}>{item.name}</strong>
                  {item.size && <span className="epp-size epp-size-strong">Talla {item.size}</span>}
                </span>
                <small>{detail(item)}</small>
                {reason && <small className="epp-blocked-reason">No se puede elegir: {reason}</small>}
              </button>
            </li>
            );
          })}
          {extra > 0 && <li className="epp-more">{extra} más… sigue escribiendo para acotar</li>}
        </ul>
      )}
    </div>
  );
}
