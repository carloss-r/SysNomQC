-- El catálogo inicial (202611130008) es SOLO de Campeche. Ejecutar DESPUÉS de 202611130010_epp_articulos_por_sede.sql.
-- Es seguro repetirla.
--
-- La 008 registró los 68 artículos con existencia 0 en las tres sedes y la 010 los copió como artículos
-- propios de Lagunas y Cruz Azul. Aquí se borran esas copias de Lagunas y Cruz Azul.
--
-- Solo se borra una copia si NO se ha usado: existencia 0, sin movimientos, sin solicitudes y sin compras.
-- Si alguna ya se usó, se conserva y se avisa (NOTICE) para revisarla a mano.
--
-- Revisión previa (opcional): copias que se conservarían por tener uso.
-- select a.id, a.site, a.name, a.size from public.epp_articles a
-- where a.site in ('Lagunas', 'Cruz Azul')
--   and (exists (select 1 from public.epp_stock s where s.article_id = a.id and s.stock <> 0)
--     or exists (select 1 from public.epp_movements m where m.article_id = a.id)
--     or exists (select 1 from public.epp_purchase_request_items i where i.article_id = a.id)
--     or exists (select 1 from public.epp_purchase_buys b where b.article_id = a.id));

begin;

create temporary table epp_copias_carga_inicial on commit drop as
select a.id, a.site, a.name, a.size,
  (exists (select 1 from public.epp_stock s where s.article_id = a.id and s.stock <> 0)
    or exists (select 1 from public.epp_movements m where m.article_id = a.id)
    or exists (select 1 from public.epp_purchase_request_items i where i.article_id = a.id)
    or exists (select 1 from public.epp_purchase_buys b where b.article_id = a.id)) as en_uso
from public.epp_articles a
where a.site in ('Lagunas', 'Cruz Azul')
  -- Copia de un artículo del catálogo de Campeche (mismo nombre y talla).
  and exists (
    select 1 from public.epp_articles c
    where c.site = 'Campeche'
      and upper(btrim(c.name)) = upper(btrim(a.name))
      and upper(coalesce(btrim(c.size), '')) = upper(coalesce(btrim(a.size), ''))
  );

do $$
declare r record;
begin
  for r in select * from epp_copias_carga_inicial where en_uso order by site, name, size loop
    raise notice 'Se conserva (ya tiene uso): % · % (id %)', r.site, r.name || coalesce(' ' || r.size, ''), r.id;
  end loop;
end;
$$;

delete from public.epp_stock s using epp_copias_carga_inicial c where s.article_id = c.id and not c.en_uso;
delete from public.epp_articles a using epp_copias_carga_inicial c where a.id = c.id and not c.en_uso;

commit;

-- Verificación (opcional): Campeche debe tener 68 artículos; Lagunas y Cruz Azul, 0 (más lo que ya se usó o se creó aparte).
-- select site, count(*) from public.epp_articles group by site order by site;
-- select site, count(*) from public.epp_stock group by site order by site;
