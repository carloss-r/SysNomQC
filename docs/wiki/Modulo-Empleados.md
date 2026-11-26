# Módulo Empleados

Pantalla principal (`/personal`, menú **Personal → Empleados**). Código en `src/features/employees/` y API en `/api/employees`.

## Funciones

- Directorio con búsqueda y tabla ligera (8 columnas por empleado); el expediente completo se pide al abrirlo.
- Alta, edición y baja de expedientes (`employees.create`, `employees.edit`, `employees.delete`).
- Expediente con datos personales, laborales y bancarios, créditos y fotografía.
- **Descargar expediente** (`employees.download`): abre la impresión con una hoja A4 con todos los datos y la foto, con el logotipo como único membrete; se imprime o se guarda como PDF.

## Datos del expediente

Clave de empleado, nombre, sede (`Campeche`, `Lagunas`, `Cruz Azul`, `El Carmen`), fecha de ingreso, puesto, **asignación** (texto libre, opcional; vacío en los registros anteriores, migración `202611130005_empleados_asignacion.sql`), tipo de contrato, **salario base** (el salario que ya tenía cada trabajador), **salario de cotización** (vacío hasta capturarlo), cuenta bancaria, estado activo, género, NSS, CURP, RFC, estado civil, fecha de nacimiento, créditos, correo, teléfono, estado de residencia, domicilio y foto. NSS, CURP y RFC son únicos.

## Áreas globales, puestos y asignaciones

Migración `202611240001_empleados_areas_puestos_asignaciones.sql`.

- **Área global** (`employee_areas`): agrupa a los trabajadores de una sede. Campeche tiene **CYM** (responsable: Ing. José Luis Badillo Serrano) y **CAL**. En Campeche el área es obligatoria; las otras sedes no tienen áreas.
- **Puesto** (`employee_positions`) y **asignación** (`employee_assignments`): catálogos por sede y área. Un mismo nombre en CYM y en CAL son dos registros distintos (p. ej. «AUXILIAR GENERAL»).
- `employees.area_id`, `position_id` y `assignment_id` son llaves a esos catálogos. `position` y `assignment` se conservan como copia del nombre (las usan EPP, el buscador y los reportes) y las mantiene la base: el trigger `employees_sync_catalog` liga el nombre al catálogo de la sede y el área del trabajador y, si no existe, lo agrega. Los nombres se guardan en mayúsculas.
- La carga inicial acomodó a los 103 trabajadores de Campeche según las listas `CAMPECHE_CAL.TXT` (76) y `CAMPECHECYM.TXT` (27). En CYM la asignación es el área de trabajo (Eléctrica, Mecánica, Civil, Operador); los 5 de «sin área especificada» quedaron sin asignación.

### Pantalla

- Pestañas **Activos**, **Bajas** (las más recientes primero, con fecha y motivo) y **Seguimiento de expedientes**.
- Filtros: sede, área global (CYM / CAL, con su número de trabajadores), **puesto** y **asignación** (cada opción con cuántos trabajadores tiene en la vista actual; la asignación incluye «Sin asignación») y búsqueda por ID, nombre, puesto, asignación o correo.
- Los números de los filtros salen de `/api/employees/catalog` (catálogos + vista `employee_group_counts`) en una sola carga; la lista sigue paginada en el servidor y cada filtro usa un índice.

## Seguimiento de expedientes

- Cada expediente tiene el cuadro **Observaciones** (hasta 1000 caracteres): lo que le falta o cualquier detalle a dar seguimiento.
- Los trabajadores con observaciones aparecen en la pestaña **Seguimiento de expedientes**, con el texto, quién lo escribió y cuándo (lo sella la base). Al vaciar el cuadro salen de la lista.
- Migración: `202611130004_empleados_observaciones.sql`.

## Baja de trabajadores

- **Dar de baja** (en el expediente, permiso `employees.edit`): día de baja capturado a mano y motivo opcional. El trabajador queda inactivo.
- La **fecha de registro en el sistema** y quién la registró los pone la base (trigger `employees_termination_guard`) y no se pueden editar; puede coincidir con el día de baja.
- **Reactivar** quita la baja. El estatus ya no se elige en el formulario de edición.
- Migración: `202611130002_empleados_salarios_y_baja.sql`.

## Fotografías

- Bucket privado `employee-photos` (JPG, PNG o WebP, máximo 3 MB).
- El navegador comprime la foto (máx. 800 px por lado, JPEG; normalmente menos de 150 KB) y elimina los metadatos EXIF.
- `employees.photo_path` guarda la ruta; para mostrarla se pide un enlace firmado temporal de 1 hora.
- Al reemplazar o quitar una foto, o al eliminar un empleado, se borra el archivo anterior.
- Las fotos se piden solo al abrir o editar un expediente.

## Rendimiento

- Guardar o eliminar actualiza la lista en memoria sin volver a descargarla.
- Cambiar de pestaña o renovarse el token de sesión no recarga el directorio.
- Contadores en una sola consulta (vista `employee_site_counts`) y siguiente ID calculado en la base (`employee_next_code()`).
- El total se cuenta solo al cambiar filtros; cambiar de página pide únicamente las 20 filas.
- Búsqueda con índices de texto (`pg_trgm`) y políticas RLS evaluadas una vez por consulta.
- La campana usa `employee_gaps` (solo verdadero/falso por campo): NSS, CURP, RFC y cuenta ya no salen de la base para los avisos.
- Requiere `202611140002_empleados_consultas_rapidas.sql`.

## Auditoría

Las altas, cambios y bajas, y la consulta de expedientes completos, quedan en `audit_log` (ver [Seguridad](Seguridad)).
