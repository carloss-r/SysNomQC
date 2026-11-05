"use client";

import { ClipboardCheck, PackagePlus, Pencil, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { EppArticle } from "@/lib/permissions";
import { formatDateTime } from "./format";

export function stockState(article: EppArticle): "out" | "low" | "ok" {
  if (article.stock === 0) return "out";
  return article.stock <= article.min_stock ? "low" : "ok";
}

const STATE_LABELS = { out: "Agotado", low: "Por reponer", ok: "Disponible" } as const;

export function InventoryTab({
  articles,
  canDeliver,
  canManage,
  onDeliver,
  onEntry,
  onEdit,
}: {
  articles: EppArticle[];
  canDeliver: boolean;
  canManage: boolean;
  onDeliver: (articleId: number) => void;
  onEntry: (articleId: number) => void;
  onEdit: (article: EppArticle) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  const categories = useMemo(() => Array.from(new Set(articles.map((item) => item.category))).sort(), [articles]);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return articles.filter((item) => {
      if (category && item.category !== category) return false;
      if (onlyLow && stockState(item) === "ok") return false;
      return !term || `${item.name} ${item.size ?? ""} ${item.category}`.toLowerCase().includes(term);
    });
  }, [articles, query, category, onlyLow]);

  return (
    <>
      <div className="directory-toolbar">
        <select className="epp-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <label className="epp-check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo por reponer</label>
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar artículo o talla" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Artículo</th><th className="hide-phone">Categoría</th><th>Existencia</th><th className="hide-phone">Mínimo</th><th className="hide-tablet">Última actualización</th><th><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const state = stockState(item);
              return (
                <tr key={item.id} className={item.active ? "" : "epp-inactive"}>
                  <td><strong>{item.name}</strong>{!item.active && <small className="epp-muted"> · desactivado</small>}</td>
                  <td className="hide-phone">{item.category}</td>
                  <td><span className="epp-stock">{item.stock}</span> <span className={`epp-state epp-state-${state}`}>{STATE_LABELS[state]}</span></td>
                  <td className="hide-phone">{item.min_stock}</td>
                  <td className="hide-tablet">{item.updated_by_name ?? "—"}<br /><small className="epp-muted">{formatDateTime(item.updated_at)}</small></td>
                  <td>
                    <div className="epp-actions">
                      {canDeliver && item.active && item.stock > 0 && (
                        <button className="button button-outline" onClick={() => onDeliver(item.id)} aria-label={`Entregar ${item.name}`} title="Entregar"><ClipboardCheck size={14} /> <span className="hide-phone">Entregar</span></button>
                      )}
                      {canManage && (
                        <>
                          <button className="icon-button row-edit hide-phone" onClick={() => onEntry(item.id)} aria-label={`Registrar ingreso de ${item.name}`} title="Registrar ingreso"><PackagePlus size={16} /></button>
                          <button className="icon-button row-edit" onClick={() => onEdit(item)} aria-label={`Editar ${item.name}`} title="Editar"><Pencil size={16} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="epp-empty">No hay artículos con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
