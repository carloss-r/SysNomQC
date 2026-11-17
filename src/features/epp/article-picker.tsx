"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { eppArticleLabel, type EppArticle } from "@/lib/permissions";
import { normalize } from "./people";

const MAX_RESULTS = 5;

const label = (item: EppArticle) => eppArticleLabel(item.name, item.size);

/**
 * Buscador de artículos: se escribe parte del nombre (o talla o categoría) y van apareciendo las
 * coincidencias (máximo 5). Flechas para moverse, Enter para elegir, Esc para cerrar.
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
  const indexed = useMemo(
    () => articles.map((item) => ({ item, text: normalize(`${item.name} ${item.size ?? ""} ${item.category}`) })),
    [articles],
  );
  const { matches, extra } = useMemo(() => {
    const tokens = normalize(query).split(" ").filter(Boolean);
    const found = indexed
      .filter((entry) => !taken.includes(String(entry.item.id)))
      .filter((entry) => tokens.every((token) => entry.text.includes(token)))
      .map((entry) => entry.item)
      .sort((a, b) => {
        const first = tokens[0] ?? "";
        const rank = (item: EppArticle) => (normalize(item.name).startsWith(first) ? 0 : 1);
        return rank(a) - rank(b) || a.name.localeCompare(b.name, "es");
      });
    return { matches: found.slice(0, MAX_RESULTS), extra: Math.max(0, found.length - MAX_RESULTS) };
  }, [indexed, query, taken]);

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
          placeholder={selected ? label(selected) : "Escribe el nombre del artículo"}
          title={selected ? label(selected) : undefined}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
        />
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
                <strong title={label(item)}>{label(item)}</strong>
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
