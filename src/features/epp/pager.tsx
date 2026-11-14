"use client";

/** Pie de tabla con "1–25 de 140" y Anterior / Siguiente (mismo estilo que Empleados). */
export function Pager({
  page,
  size,
  shown,
  total,
  noun,
  loading = false,
  onPage,
}: {
  page: number;
  size: number;
  shown: number;
  total: number;
  noun: [singular: string, plural: string];
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="table-footer">
      <span>
        {total === 0 ? `0 ${noun[1]}` : `${page * size + 1}–${page * size + shown} de ${total} ${total === 1 ? noun[0] : noun[1]}`}
        {loading && " · Cargando…"}
      </span>
      {pages > 1 && (
        <span className="epp-pager">
          <button type="button" className="text-button" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0 || loading}>← Anterior</button>
          <span>Página {page + 1} de {pages}</span>
          <button type="button" className="text-button" onClick={() => onPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1 || loading}>Siguiente →</button>
        </span>
      )}
    </div>
  );
}
