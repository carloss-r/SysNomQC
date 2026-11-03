-- =============================================================================
-- BASE DE DATOS CORPORATIVA: COOPERATIVA QUINTA GENERACIÓN S.C. DE R.L. DE C.V.
-- MOTOR: PostgreSQL (Diseñado para Supabase)
-- =============================================================================

-- Habilitar extensión para identificadores únicos globales (UUIDs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- MÓDULO 1: CATÁLOGOS DEL SISTEMA (COMBOS)
-- =============================================================================

CREATE TABLE catalogos_generos (
    id_genero SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE catalogos_estados_civiles (
    id_estado_civil SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE catalogos_tipos_credito (
    id_tipo_credito SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE, -- FONACOT, INFONAVIT, Préstamo Interno, etc.
    institucion VARCHAR(100),
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE sedes (
    id_sede SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE, -- Campeche, Lagunas, Cruz Azul
    estado VARCHAR(50) NOT NULL,
    ciudad VARCHAR(50) NOT NULL,
    activo BOOLEAN DEFAULT TRUE
);

CREATE TABLE areas (
    id_area SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE puestos (
    id_puesto SERIAL PRIMARY KEY,
    id_area INT NOT NULL REFERENCES areas(id_area) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT
);

-- =============================================================================
-- MÓDULO 2: EXPEDIENTE DE EMPLEADOS Y FOTO DE PERFIL
-- =============================================================================

CREATE TABLE empleados (
    id_empleado SERIAL PRIMARY KEY,
    id_sede INT NOT NULL REFERENCES sedes(id_sede),
    id_puesto INT NOT NULL REFERENCES puestos(id_puesto),
    
    -- Combos normalizados
    id_genero INT REFERENCES catalogos_generos(id_genero),
    id_estado_civil INT REFERENCES catalogos_estados_civiles(id_estado_civil),

    -- Datos Laborales
    nombre_completo VARCHAR(150) NOT NULL,
    fecha_contratacion DATE NOT NULL,
    tipo_contrato VARCHAR(50) NOT NULL, -- Determinado, Indeterminado, etc.
    salario_actual DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    num_cuenta_bancaria VARCHAR(20),
    clabe_interbancaria VARCHAR(18),
    activo BOOLEAN DEFAULT TRUE,
    
    -- Datos Personales y Fiscales
    nss VARCHAR(11) UNIQUE,
    curp VARCHAR(18) UNIQUE,
    rfc VARCHAR(13) UNIQUE,
    fecha_nacimiento DATE,
    
    -- Contacto y Ubicación
    email VARCHAR(100),
    telefono VARCHAR(15),
    estado_residencia VARCHAR(50),
    ciudad_residencia VARCHAR(50),
    codigo_postal VARCHAR(10),
    direccion_calle TEXT,
    
    -- Almacenamiento de Imagen (Apuntando a la URL pública de Firebase Storage)
    foto_perfil_url TEXT DEFAULT NULL,
    
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- MÓDULO 3: CRÉDITOS MÚLTIPLES POR EMPLEADO
-- =============================================================================

CREATE TABLE empleados_creditos (
    id_empleado_credito SERIAL PRIMARY KEY,
    id_empleado INT NOT NULL REFERENCES empleados(id_empleado) ON DELETE CASCADE,
    id_tipo_credito INT NOT NULL REFERENCES catalogos_tipos_credito(id_tipo_credito),
    numero_credito VARCHAR(50) NOT NULL,
    descuento_mensual DECIMAL(10, 2) DEFAULT 0.00,
    fecha_inicio DATE,
    fecha_termino DATE,
    estatus VARCHAR(20) DEFAULT 'ACTIVO' CHECK (estatus IN ('ACTIVO', 'LIQUIDADO', 'SUSPENDIDO')),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- MÓDULO 4: USUARIOS Y ROLES DEL SISTEMA WEB
-- =============================================================================

CREATE TABLE roles (
    id_rol SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE, -- SuperAdmin, AdminSede, RecursosHumanos, Almacenista
    descripcion TEXT
);

CREATE TABLE usuarios (
    id_usuario UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_empleado INT UNIQUE REFERENCES empleados(id_empleado) ON DELETE SET NULL,
    id_rol INT NOT NULL REFERENCES roles(id_rol),
    id_sede_asignada INT REFERENCES sedes(id_sede), -- Restricción por sede
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_corporativo VARCHAR(100) NOT NULL UNIQUE,
    ultimo_acceso TIMESTAMP,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- MÓDULO 5: INVENTARIO DE EPP Y CONTROL DE ENTREGAS
-- =============================================================================

CREATE TABLE categorias_epp (
    id_categoria SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE inventario_epp (
    id_articulo SERIAL PRIMARY KEY,
    id_categoria INT REFERENCES categorias_epp(id_categoria),
    codigo_sku VARCHAR(50) UNIQUE,
    nombre_articulo VARCHAR(150) NOT NULL,
    talla_medida VARCHAR(20),
    existencia_total INT NOT NULL DEFAULT 0,
    stock_minimo INT DEFAULT 10,
    unidad_medida VARCHAR(20) DEFAULT 'PIEZAS'
);

CREATE TABLE asignaciones_epp (
    id_entrega SERIAL PRIMARY KEY,
    id_empleado INT NOT NULL REFERENCES empleados(id_empleado),
    id_articulo INT NOT NULL REFERENCES inventario_epp(id_articulo),
    id_sede INT NOT NULL REFERENCES sedes(id_sede),
    id_usuario_entrega INT REFERENCES empleados(id_empleado),
    cantidad INT NOT NULL DEFAULT 1,
    fecha_entrega DATE NOT NULL,
    ciclo_periodo VARCHAR(30), -- CICLO 2026, 1° ENTREGA, etc.
    observaciones TEXT
);

-- =============================================================================
-- ÍNDICES DE RENDIMIENTO Y VISTAS OPTIMIZADAS
-- =============================================================================

CREATE INDEX idx_empleados_sede ON empleados(id_sede);
CREATE INDEX idx_empleados_activo ON empleados(activo);
CREATE INDEX idx_empleados_nombre ON empleados(nombre_completo);

CREATE VIEW vw_empleados_resumen AS
SELECT 
    e.id_empleado,
    e.nombre_completo,
    s.nombre AS sede,
    a.nombre AS area,
    p.nombre AS puesto,
    g.nombre AS genero,
    ec.nombre AS estado_civil,
    e.fecha_contratacion,
    e.tipo_contrato,
    e.salario_actual,
    e.foto_perfil_url,
    e.activo
FROM empleados e
INNER JOIN sedes s ON e.id_sede = s.id_sede
INNER JOIN puestos p ON e.id_puesto = p.id_puesto
INNER JOIN areas a ON p.id_area = a.id_area
LEFT JOIN catalogos_generos g ON e.id_genero = g.id_genero
LEFT JOIN catalogos_estados_civiles ec ON e.id_estado_civil = ec.id_estado_civil;

-- =============================================================================
-- DATOS INICIALES (SEED DATA) PARA COMBOS Y SEDES
-- =============================================================================

INSERT INTO catalogos_generos (nombre) VALUES 
('Masculino'), ('Femenino'), ('No Binario'), ('Prefiero no especificar');

INSERT INTO catalogos_estados_civiles (nombre) VALUES 
('Soltero/a'), ('Casado/a'), ('Unión Libre'), ('Divorciado/a'), ('Viudo/a');

INSERT INTO catalogos_tipos_credito (nombre, institucion, descripcion) VALUES
('FONACOT', 'Instituto FONACOT', 'Crédito de nómina para bienes y servicios'),
('INFONAVIT (Vivienda)', 'INFONAVIT', 'Crédito hipotecario habitacional'),
('FOVISSSTE', 'FOVISSSTE', 'Crédito para trabajadores del estado'),
('Préstamo Interno Cooperativa', 'Cooperativa QG', 'Préstamo directo institucional'),
('Caja de Ahorro Coopera', 'Caja de Ahorro QG', 'Crédito de fondo de ahorro interno');

INSERT INTO sedes (nombre, estado, ciudad) VALUES
('Campeche', 'Campeche', 'San Francisco de Campeche'),
('Lagunas', 'Oaxaca', 'Lagunas'),
('Cruz Azul', 'Hidalgo', 'Ciudad Cooperativa Cruz Azul');

INSERT INTO roles (nombre, descripcion) VALUES
('SuperAdmin', 'Control total y global de todas las sedes'),
('AdminSede', 'Administración específica para su sede asignada'),
('RecursosHumanos', 'Altas, bajas y gestión de expedientes'),
('AlmacenistaEPP', 'Control de stock y entregas de equipo de protección');