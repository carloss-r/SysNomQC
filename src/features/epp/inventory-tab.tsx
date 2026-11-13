"use client";

import { ClipboardCheck, MapPinPlus, PackagePlus, Pencil, Search, ShoppingCart, X } from "lucide-react";
import { useMemo, useState } from "react";
import { eppArticleLabel, type EppArticle } from "@/lib/permissions";
import { formatDateTime } from "./format";

export type StockState = "out" | "low" | "ok" | "none";

export function stockState(article: EppArticle): StockState {
  if (!article.tracked) return "none";
  if (article.stock === 0) return "out";
  return article.stock <= article.min_stock ? "low" : "ok";
}

/** Artículos que se pueden pedir: agotados o bajo el mínimo, activos y sin una solicitud abierta. */
export function needsRequest(article: EppArticle, openRequests: Map<number, number>) {
  const state = stockState(article);
  return article.active && (state === "out" || state === "low") && !openRequests.has(article.id);
}

const STATE_LABELS: Record<StockState, string> = { out: "Agotado", low: "Por reponer", ok: "Disponible", none: "Sin registro" };

export function InventoryTab({
  site,
  articles,
  openRequests,
  canDeliver,
  canManage,
  canRequest,
  onDeliver,
  onEntry,
  onEdit,
  onRequest,
  onAddToSite,
}: {
  site: string;
  articles: EppArticle[];
  openRequests: Map<number, number>;
  canDeliver: boolean;
  canManage: boolean;
  canRequest: boolean;
  onDeliver: (articleId: number) => void;
  onEntry: (articleId: number) => void;
  onEdit: (article: EppArticle) => void;
  onRequest: (articleIds: number[]) => void;
  /** Agrega al inventario de la sede un artículo del catálogo que aún no maneja. */
  onAddToSite: (article: EppArticle) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  // Cada sede ve su inventario; el resto del catálogo solo se muestra a pedido.
  const [showCatalog, setShowCatalog] = useState(false);
  const notHandled = useMemo(() => articles.filter((item) => !item.tracked && item.active).length, [articles]);

  const categories = useMemo(() => Array.from(new Set(articles.map((item) => item.category))).sort(), [articles]);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return articles.filter((item) => {
      if (!item.tracked && !showCatalog) return false;
      if (!item.tracked && !item.active) return false;
      if (category && item.category !== category) return false;
      const state = stockState(item);
      if (onlyLow && state !== "out" && state !== "low") return false;
      return !term || `${item.name} ${item.size ?? ""} ${item.category}`.toLowerCase().includes(term);
    });
  }, [articles, query, category, onlyLow, showCatalog]);
  const missing = useMemo(() => articles.filter((item) => needsRequest(item, openRequests)), [articles, openRequests]);

  return (
    <>
      <div className="directory-toolbar">
        <select className="epp-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <label className="epp-check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo por reponer</label>
        {canManage && notHandled > 0 && (
          <label className="epp-check" title={`Artículos del catálogo que ${site} todavía no maneja`}>
            <input type="checkbox" checked={showCatalog} onChange={(e) => setShowCatalog(e.target.checked)} /> Ver catálogo que {site} no maneja ({notHandled})
          </label>
        )}
        <label className="search-box">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar artículo o talla" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={14} /></button>}
        </label>
        {canRequest && missing.length > 0 && (
          <button type="button" className="button button-gold epp-request-all" onClick={() => onRequest(missing.map((item) => item.id))}>
            <ShoppingCart size={15} /> Pedir faltantes ({missing.length})
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="employee-table">
          <thead>
            <tr><th>Artículo</th><th className="hide-phone">Categoría</th><th>Existencia en {site}</th><th className="hide-phone">Mínimo</th><th className="hide-tablet">Última actualización</th><th><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const state = stockState(item);
              const folio = openRequests.get(item.id);
              return (
                <tr key={item.id} className={item.active ? "" : "epp-inactive"}>
                  <td><strong>{item.name}</strong>{item.size && <span className="epp-size">Talla {item.size}</span>}{!item.active && <small className="epp-muted"> · desactivado</small>}</td>
                  <td className="hide-phone">{item.category}</td>
                  <td>
                    <span className="epp-stock">{item.stock}</span> <span className={`epp-state epp-state-${state}`}>{STATE_LABELS[state]}</span>
                    {item.pending_count ? (
                      <span className="epp-requested epp-locked" title="Llegó una compra: hay que contarla antes de entregar o mover este artículo">Por contar · folio {item.pending_count}</span>
                    ) : folio ? (
                      <span className="epp-requested" title="Ya se pidió a compras">Pedido · folio {folio}</span>
                    ) : null}
                  </td>
                  <td className="hide-phone">{item.tracked ? item.min_stock : "—"}</td>
                  <td className="hide-tablet">{item.tracked ? <>{item.updated_by_name ?? "—"}<br /><small className="epp-muted">{formatDateTime(item.updated_at)}</small></> : <span className="epp-muted">Aún sin movimientos en {site}</span>}</td>
                  <td>
                    <div className="epp-actions">
                      {canManage && !item.tracked && (
                        <button className="button button-outline" onClick={() => onAddToSite(item)} aria-label={`Agregar ${eppArticleLabel(item.name, item.size)} a ${site}`} title={`Agregar al inventario de ${site}`}><MapPinPlus size={14} /> <span className="hide-phone">Agregar a {site}</span></button>
                      )}
                      {canRequest && needsRequest(item, openRequests) && (
                        <button className="button button-gold" onClick={() => onRequest([item.id])} aria-label={`Pedir más ${eppArticleLabel(item.name, item.size)}`} title="Pedir más a compras"><ShoppingCart size={14} /> <span className="hide-phone">Pedir más</span></button>
                      )}
                      {canDeliver && item.active && item.stock > 0 && !item.pending_count && (
                        <button className="button button-outline" onClick={() => onDeliver(item.id)} aria-label={`Entregar ${eppArticleLabel(item.name, item.size)}`} title="Entregar"><ClipboardCheck size={14} /> <span className="hide-phone">Entregar</span></button>
                      )}
                      {canManage && item.tracked && (
                        <>
                          {!item.pending_count && <button className="icon-button row-edit hide-phone" onClick={() => onEntry(item.id)} aria-label={`Registrar ingreso de ${item.name}`} title="Registrar ingreso"><PackagePlus size={16} /></button>}
                          <button className="icon-button row-edit" onClick={() => onEdit(item)} aria-label={`Editar ${eppArticleLabel(item.name, item.size)}`} title="Editar"><Pencil size={16} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="epp-empty">
                {articles.some((item) => item.tracked) ? "No hay artículos con ese filtro." : `${site} todavía no maneja ningún artículo.${canManage ? " Activa «Ver catálogo» para agregarlos." : ""}`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
