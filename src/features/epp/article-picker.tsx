"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { eppArticleLabel, type EppArticle } from "@/lib/permissions";
import { searchArticles } from "@/lib/epp-search";

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
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const selected = articles.find((item) => String(item.id) === value) ?? null;
  const { matches, extra } = useMemo(() => {
    const found = searchArticles(articles.filter((item) => !taken.includes(String(item.id))), query);
    return { matches: found.slice(0, MAX_RESULTS), extra: Math.max(0, found.length - MAX_RESULTS) };
  }, [articles, query, taken]);

  function choose(item: EppArticle) {
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
      const chosen = matches[highlight] ?? matches[0];
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
          {matches.length === 0 && <li className="epp-empty">{articles.length === 0 ? "No hay artículos disponibles en esta sede." : "Sin coincidencias."}</li>}
          {matches.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={index === highlight ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(item)}
              >
                <span className="epp-result-title">
                  <strong title={label(item)}>{item.name}</strong>
                  {item.size && <span className="epp-size epp-size-strong">Talla {item.size}</span>}
                </span>
                <small>{detail(item)}</small>
              </button>
            </li>
          ))}
          {extra > 0 && <li className="epp-more">{extra} más… sigue escribiendo para acotar</li>}
        </ul>
      )}
    </div>
  );
}
