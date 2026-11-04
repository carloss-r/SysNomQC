-- Migra el directorio a las tablas normalizadas (empleados + catálogos) y deja listo el
-- bucket privado "employee-photos" para las fotos comprimidas.
-- Requiere haber ejecutado antes 202611030001_create_employee_directory.sql
-- (usa public.is_employee_app_user()). Es idempotente: se puede ejecutar más de una vez.

-- ---------------------------------------------------------------------------
-- 1. Código de empleado (ID visible, p. ej. QG-101) en public.empleados
-- ---------------------------------------------------------------------------
alter table public.empleados add column if not exists codigo_empleado text;

update public.empleados
set codigo_empleado = 'QG-' || (100 + id_empleado)
where codigo_empleado is null;

alter table public.empleados alter column codigo_empleado set not null;
create unique index if not exists empleados_codigo_empleado_key
  on public.empleados (codigo_empleado);
create index if not exists empleados_nombre_completo_idx
  on public.empleados (nombre_completo);

create or replace function public.set_empleado_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

drop trigger if exists empleados_actualizado_en on public.empleados;
create trigger empleados_actualizado_en
before update on public.empleados
for each row execute function public.set_empleado_actualizado_en();

-- ---------------------------------------------------------------------------
-- 2. Catálogos (solo se agregan los valores que falten)
-- ---------------------------------------------------------------------------
-- Estado y ciudad de las sedes son obligatorios en la tabla: si la sede no existía se crea
-- con "Por definir"; corrígelo en Table Editor.
insert into public.sedes (nombre, estado, ciudad)
values
  ('Campeche', 'Por definir', 'Por definir'),
  ('Lagunas', 'Por definir', 'Por definir'),
  ('Cruz Azul', 'Por definir', 'Por definir')
on conflict (nombre) do nothing;

insert into public.catalogos_generos (nombre)
values ('Masculino'), ('Femenino'), ('Otro'), ('Prefiero no especificar')
on conflict (nombre) do nothing;

insert into public.catalogos_estados_civiles (nombre)
values ('Soltero(a)'), ('Casado(a)'), ('Divorciado(a)'), ('Unión Libre'), ('Viudo(a)')
on conflict (nombre) do nothing;

insert into public.catalogos_tipos_credito (nombre)
values ('Fonacot'), ('Infonavit')
on conflict (nombre) do nothing;

insert into public.areas (nombre)
values
  ('Operaciones'), ('Mantenimiento'), ('Logística'), ('Seguridad Industrial'),
  ('Administración'), ('Recursos Humanos'), ('Calidad')
on conflict (nombre) do nothing;

insert into public.puestos (id_area, nombre)
select a.id_area, v.puesto
from (values
  ('Operaciones', 'Operador Especializado'),
  ('Mantenimiento', 'Técnico Mecánico'),
  ('Logística', 'Coordinador de Transportes'),
  ('Seguridad Industrial', 'Supervisor EHS'),
  ('Administración', 'Contador General'),
  ('Recursos Humanos', 'Generalista'),
  ('Calidad', 'Analista de Procesos')
) as v(area, puesto)
join public.areas a on a.nombre = v.area
where not exists (
  select 1 from public.puestos p where p.id_area = a.id_area and p.nombre = v.puesto
);

-- ---------------------------------------------------------------------------
-- 3. Copia los expedientes que estuvieran en la tabla anterior public.employees
--    (no se borra nada de public.employees).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.employees') is null then
    return;
  end if;

  -- "Área - Puesto" -> área y puesto de catálogo (sin guion, el área es "General").
  create temporary table _employee_positions on commit drop as
  select distinct
    position as raw,
    case when position like '% - %' then trim(split_part(position, ' - ', 1)) else 'General' end as area,
    case when position like '% - %' then trim(substr(position, strpos(position, ' - ') + 3)) else trim(position) end as puesto
  from public.employees;

  insert into public.areas (nombre)
  select distinct area from _employee_positions
  on conflict (nombre) do nothing;

  insert into public.puestos (id_area, nombre)
  select distinct a.id_area, tp.puesto
  from _employee_positions tp
  join public.areas a on a.nombre = tp.area
  where not exists (
    select 1 from public.puestos p where p.id_area = a.id_area and p.nombre = tp.puesto
  );

  -- foto_perfil_url guarda la ruta del archivo dentro del bucket employee-photos.
  insert into public.empleados (
    codigo_empleado, id_sede, id_puesto, id_genero, id_estado_civil, nombre_completo,
    fecha_contratacion, tipo_contrato, salario_actual, num_cuenta_bancaria, activo, nss, curp,
    rfc, fecha_nacimiento, email, telefono, estado_residencia, direccion_calle, foto_perfil_url,
    creado_en, actualizado_en
  )
  select
    e.employee_code, s.id_sede, p.id_puesto, g.id_genero, ec.id_estado_civil, e.full_name,
    e.hire_date, e.contract_type, e.salary, e.bank_account, e.active, e.nss, e.curp,
    e.rfc, e.birth_date, e.email, e.phone, e.residence_state, e.address, e.photo_path,
    e.created_at, e.updated_at
  from public.employees e
  join public.sedes s on s.nombre = e.site
  join _employee_positions tp on tp.raw = e.position
  join public.areas a on a.nombre = tp.area
  join lateral (
    select p.id_puesto
    from public.puestos p
    where p.id_area = a.id_area and p.nombre = tp.puesto
    order by p.id_puesto
    limit 1
  ) p on true
  left join public.catalogos_generos g on g.nombre = e.gender
  left join public.catalogos_estados_civiles ec on ec.nombre = e.marital_status
  on conflict do nothing;

  insert into public.empleados_creditos (id_empleado, id_tipo_credito, numero_credito)
  select emp.id_empleado, t.id_tipo_credito, 'S/N'
  from public.employees e
  cross join lateral unnest(e.credits) as c(nombre)
  join public.empleados emp on emp.codigo_empleado = e.employee_code
  join public.catalogos_tipos_credito t on lower(t.nombre) = lower(c.nombre)
  where not exists (
    select 1
    from public.empleados_creditos x
    where x.id_empleado = emp.id_empleado and x.id_tipo_credito = t.id_tipo_credito
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Seguridad: RLS + permisos solo para cuentas autorizadas (authorized_users)
-- ---------------------------------------------------------------------------
do $$
declare
  catalog_table text;
begin
  foreach catalog_table in array array[
    'sedes', 'areas', 'puestos', 'catalogos_generos',
    'catalogos_estados_civiles', 'catalogos_tipos_credito'
  ]
  loop
    execute format('alter table public.%I enable row level security', catalog_table);
    execute format('revoke all on public.%I from public, anon, authenticated', catalog_table);
    execute format('grant select on public.%I to authenticated', catalog_table);
    execute format('drop policy if exists "Authorized users can read" on public.%I', catalog_table);
    execute format(
      'create policy "Authorized users can read" on public.%I for select to authenticated using (public.is_employee_app_user())',
      catalog_table
    );
  end loop;
end;
$$;

do $$
declare
  data_table text;
begin
  foreach data_table in array array['empleados', 'empleados_creditos']
  loop
    execute format('alter table public.%I enable row level security', data_table);
    execute format('revoke all on public.%I from public, anon, authenticated', data_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', data_table);

    execute format('drop policy if exists "Authorized users can read" on public.%I', data_table);
    execute format('drop policy if exists "Authorized users can insert" on public.%I', data_table);
    execute format('drop policy if exists "Authorized users can update" on public.%I', data_table);
    execute format('drop policy if exists "Authorized users can delete" on public.%I', data_table);

    execute format(
      'create policy "Authorized users can read" on public.%I for select to authenticated using (public.is_employee_app_user())',
      data_table
    );
    execute format(
      'create policy "Authorized users can insert" on public.%I for insert to authenticated with check (public.is_employee_app_user())',
      data_table
    );
    execute format(
      'create policy "Authorized users can update" on public.%I for update to authenticated using (public.is_employee_app_user()) with check (public.is_employee_app_user())',
      data_table
    );
    execute format(
      'create policy "Authorized users can delete" on public.%I for delete to authenticated using (public.is_employee_app_user())',
      data_table
    );
  end loop;
end;
$$;

grant usage, select on sequence public.empleados_id_empleado_seq to authenticated;
grant usage, select on sequence public.empleados_creditos_id_empleado_credito_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Bucket privado de fotos (imágenes ya comprimidas desde el navegador)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-photos',
  'employee-photos',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can view employee photos" on storage.objects;
create policy "Authenticated users can view employee photos"
on storage.objects for select to authenticated
using (bucket_id = 'employee-photos' and public.is_employee_app_user());

drop policy if exists "Authenticated users can upload employee photos" on storage.objects;
create policy "Authenticated users can upload employee photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'employee-photos' and public.is_employee_app_user());

drop policy if exists "Authenticated users can update employee photos" on storage.objects;
create policy "Authenticated users can update employee photos"
on storage.objects for update to authenticated
using (bucket_id = 'employee-photos' and public.is_employee_app_user())
with check (bucket_id = 'employee-photos' and public.is_employee_app_user());

drop policy if exists "Authenticated users can delete employee photos" on storage.objects;
create policy "Authenticated users can delete employee photos"
on storage.objects for delete to authenticated
using (bucket_id = 'employee-photos' and public.is_employee_app_user());
