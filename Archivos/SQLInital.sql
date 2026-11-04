-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.catalogos_generos (
  id_genero integer NOT NULL DEFAULT nextval('catalogos_generos_id_genero_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  CONSTRAINT catalogos_generos_pkey PRIMARY KEY (id_genero)
);
CREATE TABLE public.catalogos_estados_civiles (
  id_estado_civil integer NOT NULL DEFAULT nextval('catalogos_estados_civiles_id_estado_civil_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  CONSTRAINT catalogos_estados_civiles_pkey PRIMARY KEY (id_estado_civil)
);
CREATE TABLE public.catalogos_tipos_credito (
  id_tipo_credito integer NOT NULL DEFAULT nextval('catalogos_tipos_credito_id_tipo_credito_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  institucion character varying,
  descripcion text,
  activo boolean DEFAULT true,
  CONSTRAINT catalogos_tipos_credito_pkey PRIMARY KEY (id_tipo_credito)
);
CREATE TABLE public.sedes (
  id_sede integer NOT NULL DEFAULT nextval('sedes_id_sede_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  estado character varying NOT NULL,
  ciudad character varying NOT NULL,
  activo boolean DEFAULT true,
  CONSTRAINT sedes_pkey PRIMARY KEY (id_sede)
);
CREATE TABLE public.areas (
  id_area integer NOT NULL DEFAULT nextval('areas_id_area_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  CONSTRAINT areas_pkey PRIMARY KEY (id_area)
);
CREATE TABLE public.puestos (
  id_puesto integer NOT NULL DEFAULT nextval('puestos_id_puesto_seq'::regclass),
  id_area integer NOT NULL,
  nombre character varying NOT NULL,
  descripcion text,
  CONSTRAINT puestos_pkey PRIMARY KEY (id_puesto),
  CONSTRAINT puestos_id_area_fkey FOREIGN KEY (id_area) REFERENCES public.areas(id_area)
);
CREATE TABLE public.empleados (
  id_empleado integer NOT NULL DEFAULT nextval('empleados_id_empleado_seq'::regclass),
  codigo_empleado text NOT NULL UNIQUE,
  id_sede integer NOT NULL,
  id_puesto integer NOT NULL,
  id_genero integer,
  id_estado_civil integer,
  nombre_completo character varying NOT NULL,
  fecha_contratacion date NOT NULL,
  tipo_contrato character varying NOT NULL,
  salario_actual numeric NOT NULL DEFAULT 0.00,
  num_cuenta_bancaria character varying,
  clabe_interbancaria character varying,
  activo boolean DEFAULT true,
  nss character varying UNIQUE,
  curp character varying UNIQUE,
  rfc character varying UNIQUE,
  fecha_nacimiento date,
  email character varying,
  telefono character varying,
  estado_residencia character varying,
  ciudad_residencia character varying,
  codigo_postal character varying,
  direccion_calle text,
  foto_perfil_url text,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  actualizado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empleados_pkey PRIMARY KEY (id_empleado),
  CONSTRAINT empleados_id_sede_fkey FOREIGN KEY (id_sede) REFERENCES public.sedes(id_sede),
  CONSTRAINT empleados_id_puesto_fkey FOREIGN KEY (id_puesto) REFERENCES public.puestos(id_puesto),
  CONSTRAINT empleados_id_genero_fkey FOREIGN KEY (id_genero) REFERENCES public.catalogos_generos(id_genero),
  CONSTRAINT empleados_id_estado_civil_fkey FOREIGN KEY (id_estado_civil) REFERENCES public.catalogos_estados_civiles(id_estado_civil)
);
CREATE TABLE public.empleados_creditos (
  id_empleado_credito integer NOT NULL DEFAULT nextval('empleados_creditos_id_empleado_credito_seq'::regclass),
  id_empleado integer NOT NULL,
  id_tipo_credito integer NOT NULL,
  numero_credito character varying NOT NULL,
  descuento_mensual numeric DEFAULT 0.00,
  fecha_inicio date,
  fecha_termino date,
  estatus character varying DEFAULT 'ACTIVO'::character varying CHECK (estatus::text = ANY (ARRAY['ACTIVO'::character varying, 'LIQUIDADO'::character varying, 'SUSPENDIDO'::character varying]::text[])),
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT empleados_creditos_pkey PRIMARY KEY (id_empleado_credito),
  CONSTRAINT empleados_creditos_id_empleado_fkey FOREIGN KEY (id_empleado) REFERENCES public.empleados(id_empleado),
  CONSTRAINT empleados_creditos_id_tipo_credito_fkey FOREIGN KEY (id_tipo_credito) REFERENCES public.catalogos_tipos_credito(id_tipo_credito)
);
CREATE TABLE public.roles (
  id_rol integer NOT NULL DEFAULT nextval('roles_id_rol_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  descripcion text,
  CONSTRAINT roles_pkey PRIMARY KEY (id_rol)
);
CREATE TABLE public.usuarios (
  id_usuario uuid NOT NULL DEFAULT uuid_generate_v4(),
  id_empleado integer UNIQUE,
  id_rol integer NOT NULL,
  id_sede_asignada integer,
  username character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  email_corporativo character varying NOT NULL UNIQUE,
  ultimo_acceso timestamp without time zone,
  activo boolean DEFAULT true,
  creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT usuarios_pkey PRIMARY KEY (id_usuario),
  CONSTRAINT usuarios_id_empleado_fkey FOREIGN KEY (id_empleado) REFERENCES public.empleados(id_empleado),
  CONSTRAINT usuarios_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.roles(id_rol),
  CONSTRAINT usuarios_id_sede_asignada_fkey FOREIGN KEY (id_sede_asignada) REFERENCES public.sedes(id_sede)
);
CREATE TABLE public.categorias_epp (
  id_categoria integer NOT NULL DEFAULT nextval('categorias_epp_id_categoria_seq'::regclass),
  nombre character varying NOT NULL,
  CONSTRAINT categorias_epp_pkey PRIMARY KEY (id_categoria)
);
CREATE TABLE public.inventario_epp (
  id_articulo integer NOT NULL DEFAULT nextval('inventario_epp_id_articulo_seq'::regclass),
  id_categoria integer,
  codigo_sku character varying UNIQUE,
  nombre_articulo character varying NOT NULL,
  talla_medida character varying,
  existencia_total integer NOT NULL DEFAULT 0,
  stock_minimo integer DEFAULT 10,
  unidad_medida character varying DEFAULT 'PIEZAS'::character varying,
  CONSTRAINT inventario_epp_pkey PRIMARY KEY (id_articulo),
  CONSTRAINT inventario_epp_id_categoria_fkey FOREIGN KEY (id_categoria) REFERENCES public.categorias_epp(id_categoria)
);
CREATE TABLE public.asignaciones_epp (
  id_entrega integer NOT NULL DEFAULT nextval('asignaciones_epp_id_entrega_seq'::regclass),
  id_empleado integer NOT NULL,
  id_articulo integer NOT NULL,
  id_sede integer NOT NULL,
  id_usuario_entrega integer,
  cantidad integer NOT NULL DEFAULT 1,
  fecha_entrega date NOT NULL,
  ciclo_periodo character varying,
  observaciones text,
  CONSTRAINT asignaciones_epp_pkey PRIMARY KEY (id_entrega),
  CONSTRAINT asignaciones_epp_id_empleado_fkey FOREIGN KEY (id_empleado) REFERENCES public.empleados(id_empleado),
  CONSTRAINT asignaciones_epp_id_articulo_fkey FOREIGN KEY (id_articulo) REFERENCES public.inventario_epp(id_articulo),
  CONSTRAINT asignaciones_epp_id_sede_fkey FOREIGN KEY (id_sede) REFERENCES public.sedes(id_sede),
  CONSTRAINT asignaciones_epp_id_usuario_entrega_fkey FOREIGN KEY (id_usuario_entrega) REFERENCES public.empleados(id_empleado)
);
CREATE TABLE public.authorized_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  email text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT authorized_users_pkey PRIMARY KEY (id),
  CONSTRAINT authorized_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  site text NOT NULL CHECK (site = ANY (ARRAY['Campeche'::text, 'Lagunas'::text, 'Cruz Azul'::text])),
  hire_date date NOT NULL,
  position text NOT NULL,
  contract_type text NOT NULL,
  salary numeric NOT NULL DEFAULT 0 CHECK (salary >= 0::numeric),
  bank_account text,
  active boolean NOT NULL DEFAULT true,
  gender text,
  nss text UNIQUE,
  curp text UNIQUE,
  rfc text UNIQUE,
  marital_status text,
  birth_date date,
  credits ARRAY NOT NULL DEFAULT '{}'::text[],
  email text,
  phone text,
  residence_state text,
  address text,
  photo_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT employees_pkey PRIMARY KEY (id)
);