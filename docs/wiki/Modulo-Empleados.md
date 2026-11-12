# Módulo Empleados

Pantalla principal (`/`, menú **Personal → Empleados**). Código en `src/features/employees/` y API en `/api/employees`.

## Funciones

- Directorio con búsqueda y tabla ligera (8 columnas por empleado); el expediente completo se pide al abrirlo.
- Alta, edición y baja de expedientes (`employees.create`, `employees.edit`, `employees.delete`).
- Expediente con datos personales, laborales y bancarios, créditos y fotografía.
- **Descargar expediente** (`employees.download`): abre la impresión con una hoja A4 con todos los datos y la foto, con el logotipo como único membrete; se imprime o se guarda como PDF.

## Datos del expediente

Clave de empleado, nombre, sede (`Campeche`, `Lagunas`, `Cruz Azul`), fecha de ingreso, puesto, tipo de contrato, salario, cuenta bancaria, estado activo, género, NSS, CURP, RFC, estado civil, fecha de nacimiento, créditos, correo, teléfono, estado de residencia, domicilio y foto. NSS, CURP y RFC son únicos.

## Fotografías

- Bucket privado `employee-photos` (JPG, PNG o WebP, máximo 3 MB).
- El navegador comprime la foto (máx. 800 px por lado, JPEG; normalmente menos de 150 KB) y elimina los metadatos EXIF.
- `employees.photo_path` guarda la ruta; para mostrarla se pide un enlace firmado temporal de 1 hora.
- Al reemplazar o quitar una foto, o al eliminar un empleado, se borra el archivo anterior.
- Las fotos se piden solo al abrir o editar un expediente.

## Rendimiento

- Guardar o eliminar actualiza la lista en memoria sin volver a descargarla.
- Cambiar de pestaña o renovarse el token de sesión no recarga el directorio.

## Auditoría

Las altas, cambios y bajas, y la consulta de expedientes completos, quedan en `audit_log` (ver [Seguridad](Seguridad)).
