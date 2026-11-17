-- Separar artículos del catálogo que juntaban dos productos en un solo nombre.
-- Ejecutar DESPUÉS de 202611140001_epp_consultas_rapidas.sql y ANTES de la carga inicial de inventario.
-- Es seguro repetirla.
--
--   RESPIRADOR CARBÓN ACTIVADO (CERRADO O CON VÁLVULA)
--     → RESPIRADOR CARBÓN ACTIVADO CON VÁLVULA  +  RESPIRADOR CARBÓN ACTIVADO CERRADO
--   RETENEDORES PARA RESPIRADOR (MEDIA CARA Y CARA COMPLETA)
--     → RETENEDORES PARA RESPIRADOR MEDIA CARA  +  RETENEDORES PARA RESPIRADOR CARA COMPLETA
--   FILTROS DE REPUESTO PARA RESPIRADOR (MEDIA CARA Y CARA COMPLETA)
--     → FILTROS DE REPUESTO PARA RESPIRADOR MEDIA CARA  +  FILTROS DE REPUESTO PARA RESPIRADOR CARA COMPLETA
--   CINTA DE ACORDONAMIENTO (AMARILLA O ROJA)
--     → CINTA DE ACORDONAMIENTO AMARILLA  +  CINTA DE ACORDONAMIENTO ROJA
--
-- En cada sede que tenga el artículo combinado:
--   * El artículo actual se RENOMBRA a la primera variante (conserva su id, existencia, movimientos y solicitudes).
--   * La segunda variante se crea como artículo nuevo de esa sede, con la misma categoría, unidad y mínimo,
--     y existencia 0.
-- Si el artículo combinado ya tenía existencia o movimientos, se avisa (NOTICE): esa existencia queda en la
-- primera variante y hay que revisarla (ajuste) si en realidad era de la otra.

begin;

create temporary table epp_separar (viejo text, variante_1 text, variante_2 text) on commit drop;
insert into epp_separar values
  ('RESPIRADOR CARBÓN ACTIVADO (CERRADO O CON VÁLVULA)',
   'RESPIRADOR CARBÓN ACTIVADO CON VÁLVULA',
   'RESPIRADOR CARBÓN ACTIVADO CERRADO'),
  ('RETENEDORES PARA RESPIRADOR (MEDIA CARA Y CARA COMPLETA)',
   'RETENEDORES PARA RESPIRADOR MEDIA CARA',
   'RETENEDORES PARA RESPIRADOR CARA COMPLETA'),
  ('FILTROS DE REPUESTO PARA RESPIRADOR (MEDIA CARA Y CARA COMPLETA)',
   'FILTROS DE REPUESTO PARA RESPIRADOR MEDIA CARA',
   'FILTROS DE REPUESTO PARA RESPIRADOR CARA COMPLETA'),
  ('CINTA DE ACORDONAMIENTO (AMARILLA O ROJA)',
   'CINTA DE ACORDONAMIENTO AMARILLA',
   'CINTA DE ACORDONAMIENTO ROJA');

do $$
declare
  r record; v_new bigint; v_min integer;
begin
  for r in
    select a.*, x.variante_1, x.variante_2
    from public.epp_articles a
    join epp_separar x on upper(btrim(a.name)) = upper(x.viejo)
    order by a.site, a.id
  loop
    if exists (select 1 from public.epp_stock s where s.article_id = r.id and s.stock <> 0)
       or exists (select 1 from public.epp_movements m where m.article_id = r.id) then
      raise notice 'Revisar en %: "%" ya tenía existencia o movimientos; quedan en "%".', r.site, r.name, r.variante_1;
    end if;

    -- 1. El artículo actual pasa a ser la primera variante (si no existe ya en la sede).
    if exists (
      select 1 from public.epp_articles a
      where a.site = r.site and a.id <> r.id
        and upper(btrim(a.name)) = upper(r.variante_1)
        and upper(coalesce(btrim(a.size), '')) = upper(coalesce(btrim(r.size), ''))
    ) then
      raise exception 'En % ya existe "%"; revisa a mano antes de separar "%".', r.site, r.variante_1, r.name;
    end if;
    update public.epp_articles set name = r.variante_1 where id = r.id;

    -- 2. La segunda variante, artículo nuevo de la misma sede.
    if not exists (
      select 1 from public.epp_articles a
      where a.site = r.site
        and upper(btrim(a.name)) = upper(r.variante_2)
        and upper(coalesce(btrim(a.size), '')) = upper(coalesce(btrim(r.size), ''))
    ) then
      insert into public.epp_articles (name, category, size, unit, min_stock, active, site, updated_by_name)
      values (r.variante_2, r.category, r.size, r.unit, r.min_stock, r.active, r.site, 'Separación de catálogo')
      returning id into v_new;

      select coalesce((select s.min_stock from public.epp_stock s where s.article_id = r.id and s.site = r.site), r.min_stock)
      into v_min;
      insert into public.epp_stock (article_id, site, stock, min_stock, updated_at, updated_by_name)
      values (v_new, r.site, 0, v_min, now(), 'Separación de catálogo')
      on conflict (article_id, site) do nothing;
    end if;

    raise notice 'Separado en %: "%" → "%" + "%"', r.site, r.name, r.variante_1, r.variante_2;
  end loop;
end;
$$;

commit;

-- Verificación (opcional): no debe quedar ninguno con el nombre combinado.
-- select site, name from public.epp_articles
-- where name like '%(CERRADO O CON VÁLVULA)%' or name like '%(MEDIA CARA Y CARA COMPLETA)%' or name like '%(AMARILLA O ROJA)%';
-- select site, name, unit from public.epp_articles
-- where name like 'RESPIRADOR CARBÓN%' or name like 'RETENEDORES%' or name like 'FILTROS DE REPUESTO%' or name like 'CINTA DE ACORDONAMIENTO%'
-- order by site, name;
