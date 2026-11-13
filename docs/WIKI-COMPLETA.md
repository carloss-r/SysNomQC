# SysNomQC

Sistema de gestión de personal de la cooperativa. Aplicación **Next.js + React** sobre **Supabase** (Auth, Postgres y Storage). Todas las cuentas son autorizadas manualmente; no hay registro público.

## Módulos

| Módulo | Ruta | Permiso de acceso | Página |
| --- | --- | --- | --- |
| Empleados (pantalla principal) | `/` | `employees.view` | Módulo Empleados |
| EPP (Seguridad e higiene) | `/epp` | `epp.view` | Módulo EPP |
| Combustibles alternos (Ecología) | `/combustibles` | `fuels.view` | Módulo Combustibles alternos |
| Notificaciones | `/notificaciones` | cuenta autorizada | Notificaciones e incidencias |
| Usuarios y roles | `/admin` | `users.manage` | Roles y permisos |

## Documentación

- Instalación y entornos: requisitos, variables de entorno, local vs. nube, despliegue.
- Arquitectura: estructura del código y aislamiento por pantalla.
- Base de datos: migraciones, tablas, funciones y buckets.
- API: rutas, métodos y permisos.
- Seguridad: protecciones del código y configuración pendiente en Supabase/Vercel.
- Roles y permisos: catálogo de permisos, roles sugeridos y sedes.
- Guía de desarrollo: cómo agregar pantallas, permisos y avisos.

## Stack

Next.js 16 · React 19 · TypeScript · Supabase (`@supabase/supabase-js`) · Zod · jsPDF · ExcelJS · lucide-react.

## Flujo de ramas

El trabajo se realiza en la rama `development` (se despliega como *Preview* en Vercel); `main` es *Production*.


---

# Instalación y entornos

## Requisitos

- Node.js 20.9 o posterior
- Proyecto de Supabase (local con `supabase start` o en la nube)

## Puesta en marcha local

```bash
npm install
npm run dev      # http://localhost:3000
```

Otros scripts: `npm run build`, `npm run start`, `npm run lint`.

## Preparar Supabase

1. En **SQL Editor** ejecuta, **en orden**, las migraciones de `supabase/migrations/` (ver Base de datos).
2. En **Authentication → Users** crea las cuentas. El sistema no ofrece registro público.
3. Autoriza cada cuenta:

   ```sql
   insert into public.authorized_users (user_id, email)
   values ('UUID-DE-LA-CUENTA', 'usuario@cooperativa.com');
   ```

4. En **Authentication → URL Configuration** deja las URL de desarrollo y producción.
5. Deshabilita el registro público (ver Seguridad).

## Variables de entorno

Se definen en `.env.local` (no se sube a Git) o en Vercel. Usa `.env.example` como referencia.

| Variable | Ámbito | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Público | URL del proyecto de Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Público | Llave publicable (anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Solo servidor** | Administración de usuarios/roles y bitácora. Nunca con prefijo `NEXT_PUBLIC_` |
| `RESEND_API_KEY` | Solo servidor | Envío de correos de incidencias y avisos |
| `INCIDENT_EMAIL_TO` | Solo servidor | Destino de incidencias |
| `INCIDENT_EMAIL_FROM` | Solo servidor | Remitente (por defecto `onboarding@resend.dev`) |
| `ECOLOGY_EMAIL_TO` | Solo servidor | Correos (separados por coma) del semáforo SEMARNAT amarillo/rojo |
| `NEXT_PUBLIC_FIREBASE_*` | Público | Declaradas en `.env.example`; ver nota en Arquitectura |

## Local vs. nube

La aplicación no usa cadena de conexión a Postgres: habla con Supabase por URL y llaves, leídas desde variables de entorno (`src/lib/supabase.ts`, `src/lib/database.ts`, `src/lib/supabase-admin.ts`).

- **Local:** `supabase start` y `supabase status` entregan URL y llaves; `supabase db reset` aplica las migraciones.
- **Nube (producción):** las mismas tres variables en **Vercel → Settings → Environment Variables**. Para llevar cambios de BD, ejecuta las migraciones nuevas en el SQL Editor o con `supabase db push`.
- Las variables **no** se leen del panel de Supabase. Los cambios en Vercel solo aplican a despliegues nuevos: vuelve a desplegar.
- `development` se despliega como **Preview**; `main` como **Production**.
- Crea al menos un usuario en Authentication de cada entorno y autorízalo en `authorized_users`.

## Despliegue

Aplicación Next.js estándar (por ejemplo, Vercel). Ejecuta `npm run build` antes de publicar y configura las variables por entorno.


---

# Arquitectura

## Estructura del código

```
src/
  app/                      Rutas (solo enrutamiento; cada pantalla es una carpeta)
    layout.tsx              Raíz: notificaciones + sesión
    (app)/layout.tsx        Marco con menú lateral (exige sesión)
    (app)/page.tsx          Empleados            ->  /
    (app)/admin/            Usuarios y roles     ->  /admin
    (app)/epp/              EPP                  ->  /epp
    (app)/combustibles/     Combustibles         ->  /combustibles
    (app)/notificaciones/   Notificaciones       ->  /notificaciones
    api/                    API del servidor (valida sesión, permisos y datos)
  features/                 Un módulo por carpeta, con su lógica y componentes
    auth/  employees/  admin/  epp/  fuels/  notifications/
  shared/                   Piezas reutilizables
    ui/  layout/  reports/ (PDF y Excel con membrete)  config/navigation.ts
  lib/                      Utilidades sin interfaz
supabase/migrations/        Esquema, RLS y funciones de la base
Archivos/                   Material de referencia (SQL inicial, especificación de coque)
```

## Capas

1. **Pantalla** (`src/app/(app)/…`): solo enrutamiento y `error.tsx`.
2. **Módulo** (`src/features/<modulo>/`): componentes y lógica de la pantalla, protegidos con `RequirePermission`.
3. **API** (`src/app/api/<modulo>/`): cada ruta llama a `getAuthenticatedClient(request, "<permiso>")` (sesión, permiso, origen y límite por IP) y valida el cuerpo con Zod.
4. **Base de datos**: RLS por permiso y funciones `SECURITY DEFINER` que son la última barrera (ver Base de datos).

## Utilidades en `src/lib`

| Archivo | Función |
| --- | --- |
| `permissions.ts` | Catálogo de permisos y tipos compartidos (`Access`, EPP, etc.) |
| `roles.ts` | Nombres técnicos de rol → nombre legible |
| `supabase.ts` / `database.ts` / `supabase-admin.ts` | Cliente de navegador, cliente con token del usuario y cliente `service_role` |
| `api-client.ts` | Llamadas a la API desde el navegador |
| `rate-limit.ts` | Límite de peticiones por IP en memoria |
| `audit.ts` | Escritura en `audit_log` |
| `incidents.ts` / `report-incident.ts` / `email.ts` | Reporte de incidencias por correo (servidor y navegador) |
| `notifications.ts` | Tipos y reglas de avisos |
| `fuels.ts` | Memoria de cálculo de sustitución térmica |
| `photos.ts` | Compresión y manejo de fotos |

## Aislamiento por pantalla

Cada pantalla tiene su propio `error.tsx`. Si una falla, solo se reemplaza su contenido por un aviso con **Reintentar**; el menú y las demás pantallas siguen funcionando, y la incidencia se reporta por correo.

## Diseño responsivo

Computadora muestra todo; hasta 1060 px se ocultan columnas secundarias y hasta 700 px queda lo indispensable. Se controla con las clases `hide-tablet`, `hide-phone`, `show-tablet` y `show-phone` (en `globals.css`); en una tabla nueva se ponen en el `th` y en su `td`.

## Notas

- `firebase` aparece en `package.json` y `.env.example`, pero no hay código en `src/` que lo use; las fotos se guardan en Supabase Storage.
- `Archivos/SQLInital.sql` es un esquema histórico solo de referencia (no ejecutar).


---

# Guía de desarrollo

## Principios

- Cada pantalla es **individual**: carpeta propia, `error.tsx` propio y lógica en `src/features/<modulo>/`, de modo que si una falla no afecte a las demás.
- La seguridad se valida en tres capas: interfaz (`RequirePermission`), API (`getAuthenticatedClient`) y base de datos (RLS y funciones).
- Todo el trabajo se hace en la rama `development`.

## Agregar una pantalla nueva

1. Crea `src/app/(app)/<ruta>/page.tsx` y `error.tsx` (copia el de `admin/`).
2. Pon la lógica en `src/features/<modulo>/` y envuélvela en `<RequirePermission permission="...">`.
3. Agrega la entrada en `src/shared/config/navigation.ts`; el menú la muestra solo a quien tenga el permiso.
4. Si necesita un permiso nuevo, agrégalo en `src/lib/permissions.ts`; aparece solo en el editor de roles.
5. Crea su API en `src/app/api/<modulo>/` con `getAuthenticatedClient(request, "<permiso>")` y valida el cuerpo con Zod.
6. Si cambia la base, crea una migración nueva en `supabase/migrations/` (idempotente) con RLS activado.

## Agregar un rol visible

Agrega su nombre técnico en `src/lib/roles.ts`. No lo renombres en la base.

## Agregar un aviso

Tipo y regla en `src/lib/notifications.ts`; lectura en `src/app/api/notifications/route.ts`.

## Tablas responsivas

En una tabla nueva, pon `hide-tablet`, `hide-phone`, `show-tablet` o `show-phone` en el `th` y en su `td`.

## Reportes

PDF y Excel con membrete en `src/shared/reports/` (jsPDF y ExcelJS).

## Calidad

```bash
npm run lint
npm run build
```

## Convenciones de ramas y commits

- Trabaja y sube cambios a `development`; `main` es producción.
- Los cambios de variables de entorno en Vercel requieren un nuevo despliegue.
- Nunca subas `.env.local` ni llaves `service_role`.


---

# Módulo Empleados

Pantalla principal (`/`, menú **Personal → Empleados**). Código en `src/features/employees/` y API en `/api/employees`.

## Funciones

- Directorio con búsqueda y tabla ligera (8 columnas por empleado); el expediente completo se pide al abrirlo.
- Alta, edición y baja de expedientes (`employees.create`, `employees.edit`, `employees.delete`).
- Expediente con datos personales, laborales y bancarios, créditos y fotografía.
- **Descargar expediente** (`employees.download`): abre la impresión con una hoja A4 con todos los datos y la foto, con el logotipo como único membrete; se imprime o se guarda como PDF.

## Datos del expediente

Clave de empleado, nombre, sede (`Campeche`, `Lagunas`, `Cruz Azul`, `El Carmen`), fecha de ingreso, puesto, tipo de contrato, salario, cuenta bancaria, estado activo, género, NSS, CURP, RFC, estado civil, fecha de nacimiento, créditos, correo, teléfono, estado de residencia, domicilio y foto. NSS, CURP y RFC son únicos.

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

Las altas, cambios y bajas, y la consulta de expedientes completos, quedan en `audit_log` (ver Seguridad).


---

# Módulo EPP

Equipo de protección personal. Pantalla `/epp` (menú **Seguridad e higiene → EPP**). Código en `src/features/epp/` y API en `/api/epp`.

## Pestañas y acciones

| Función | Descripción |
| --- | --- |
| **Entregar EPP** | Busca al trabajador, agrega uno o varios artículos y confirma; descuenta existencia y guarda quién entregó y cuándo |
| **Ingreso de material** y **Ajuste** | El ajuste es un conteo físico con motivo obligatorio |
| **Nuevo artículo** / edición | Catálogo común a todas las sedes |
| **Por trabajador** | Todo el EPP recibido: resumen por artículo, control diario del mes, detalle con quién registró; descarga en CSV |
| **Control mensual** | Entregas, ingresos y ajustes del mes por artículo y por trabajador, con reporte descargable |
| **Historial** | Todos los movimientos con fecha, trabajador, quién los registró y notas |
| **Solicitudes** | Solicitudes de compra y su estado |

## Reglas de negocio

- La existencia solo cambia con la función `epp_apply_site()` (transacción atómica; valida permiso, sede y existencia).
- Los movimientos **no se pueden editar ni borrar**.
- **Inventario por sede**: el catálogo es común; existencia y mínimo son de cada sede (`epp_stock`). Una cuenta con sede asignada solo opera su sede (la base lo impone aunque se llame directo a Supabase).
- La existencia previa a la migración por sede pasó completa a **Campeche**; Lagunas y Cruz Azul cargan la suya con **Ingreso** o **Ajuste**.

## Solicitudes de compra

1. En el inventario, lo agotado o bajo el mínimo muestra **Pedir más**; **Pedir faltantes** junta todo en una solicitud con cantidad sugerida (hasta el doble del mínimo).
2. Un artículo con una solicitud abierta no se puede volver a pedir hasta que se cierre.
3. El `EncargadoCompras` recibe el aviso especial (campana morada y aviso emergente) y desde **EPP → Solicitudes** las marca *En compra*, *Recibida* o *Cancelada*.
4. Puede descargar el **PDF** de una solicitud o de todas las abiertas, con resumen por artículo para una sola compra.
5. **Registrar llegada** abre el ingreso con los artículos ya capturados; al guardarlo la solicitud queda *Recibida*.
6. Una cuenta de compras con sede solo ve las solicitudes de su sede; con *Todas las sedes* ve todas.

Estados: `pendiente` → `en_compra` → `recibida` (o `cancelada`).

## Permisos

`epp.view`, `epp.deliver`, `epp.manage`, `epp.request` y `epp.purchase` (ver Roles y permisos).

## Migraciones

`202611060001_epp.sql`, `202611060002_epp_historial.sql`, `202611070001_epp_por_sede.sql` y `202611090001_epp_controles.sql`.


---

# Módulo Combustibles alternos

Pantalla `/combustibles` (menú **Ecología → Combustibles alternos**). Código en `src/features/fuels/`, API en `/api/fuels`, cálculo en `src/lib/fuels.ts`. Especificación original: `Archivos/ModuloCoque.txt`.

## Semáforo SEMARNAT

Visible sobre todas las pestañas, calculado por mes con la proyección de lo programado.

| Color | Sustitución térmica |
| --- | --- |
| Verde | hasta 25.0 % |
| Amarillo | 25.1 % a 29.9 % |
| Rojo | desde 30.0 % |

El horno tiene autorizado un máximo de **30.0 %** de sustitución con combustibles alternos.

## Memoria de cálculo

```
Energía alternos (Gcal) = Σ [ neto (t) × poder calorífico (cal/g) ] / 1000
Energía coque (Gcal)    = [ coque (t) × 7500 ] / 1000
% sustitución           = alternos / (alternos + coque) × 100
```

Se implementa en `src/lib/fuels.ts` (pantalla y reportes) y en `fuel_month_summary_raw()` (la base, que es la que bloquea).

## Pestañas

| Pestaña | Permiso | Qué hace | Candados (los exige la base) |
| --- | --- | --- | --- |
| **M1 · Proveedores** | `fuels.suppliers` | Alta y homologación (*Datos corporativos* y *Parámetros de calidad* por producto), adjuntar permiso PDF, ficha de proveedor autorizado en PDF o Excel | No guarda si cal/g < 5,000, cloro > 1.80 %, agua > 12.0 % o azufre > 1.0 %. Permiso vencido → *Rechazado*. Aviso 30 días antes del vencimiento |
| **M2 · Programación** | `fuels.schedule` | Agenda por día o próximas; descarga de la agenda de recepción para báscula | Solo proveedores aprobados con permiso vigente en la fecha y productos activos. **Bloqueo predictivo** si el mes llegaría al 30 % |
| **M3 · Báscula** | `fuels.scale` | Entrada (bruto) con bloques Generador, Transportista y Vehículo; salida (tara); certificado PDF; bitácora del día | Solo unidades de la agenda. Folio de manifiesto único por ticket. Al capturar la tara el neto se calcula y el ticket se **cierra de forma irreversible** |
| **M4 · Comercial** | `fuels.commercial` | Esquema (Cobro / Pago / Valor 0) y tarifa por tonelada; reportes diario, quincenal y mensual por producto y generador (PDF o Excel) | Subtotal = neto (t) × tarifa, sin IVA. La tarifa se congela en el ticket al cerrarlo |
| **M5 · Ecología** | `fuels.ecology` | Consumo mensual de coque, memoria de cálculo por mes y reporte semestral SEMARNAT (COA) | El reporte oficial usa solo el coque capturado de cada mes; la proyección diaria usa el último capturado si falta |

## Cloro por embarque y corrección cruzada

- El cloro de cada carga se captura una sola vez, al cerrar la tara o después.
- Si pasa de 1.80 %, el proveedor tiene **2 días** para enviar un embarque de compensación con 1.80 % o menos; al cerrarlo se elige *Compensa el embarque* y se muestra el promedio ponderado.
- Corregido = sin penalización; si vence el plazo queda *penalizado*.
- Solo **una corrección cruzada por proveedor al mes**.

## Avisos

- Semáforo amarillo o rojo, y permisos por vencer o vencidos, aparecen en la campana.
- La primera vez en el mes que el semáforo pasa a amarillo y a rojo se envía un correo a Ecología (`ECOLOGY_EMAIL_TO` + `RESEND_API_KEY`); `fuel_claim_alert` evita duplicados.

## Roles sugeridos

`CombustiblesAlternos`, `OperadorBascula`, `Ecologia` y `ContabilidadCombustibles` (los crea la migración `202611100001_combustibles_alternos.sql`).

## Almacenamiento

Bucket privado `fuel-permits` (PDF de hasta 10 MB).


---

# Notificaciones e incidencias

## Notificaciones

La campana de la barra superior abre un panel con lo más urgente; **Ver todas** lleva a `/notificaciones`. Los avisos **no se guardan**: se calculan con los datos reales (`/api/notifications`), así que desaparecen al corregir el problema. Tipos y reglas en `src/lib/notifications.ts`.

| Gravedad | Aviso | Condición |
| --- | --- | --- |
| Grave | Sin existencias | Artículo activo de EPP con existencia en cero |
| Importante | Stock bajo | Existencia igual o menor que `min_stock` |
| Importante | Expediente incompleto | Empleado activo sin NSS, CURP, RFC, cuenta bancaria o salario |
| Menor importancia | Compra anticipada | Existencia hasta 1.5 veces `min_stock` |
| Menor importancia | Datos de contacto | Empleado activo sin correo o teléfono |
| — | Solicitud de compra | Solicitudes nuevas (solo `EncargadoCompras`) |
| — | Semáforo SEMARNAT / permisos | Amarillo o rojo; permisos por vencer o vencidos |

- **Descartar** oculta un aviso 24 horas (`SNOOZE_MS`); si el problema sigue, vuelve a mostrarse, y si un artículo empeora avisa de inmediato. Lo descartado se guarda en el navegador de cada cuenta.
- Avisos de expedientes: requieren `employees.view`. De inventario: `epp.view`. De combustibles: `fuels.view`.
- La respuesta indica el estado de cada fuente (`ok`, `no_permission`, `unavailable`).
- Para agregar un aviso: define su tipo y regla en `src/lib/notifications.ts` y léelo en `src/app/api/notifications/route.ts`.

## Incidencias por correo

Los errores del servidor (base de datos, API) y del navegador (red caída, error de JavaScript) se envían por correo con [Resend](https://resend.com).

**Configuración**

1. Crea una cuenta en Resend y genera una API key.
2. Defínela como `RESEND_API_KEY` (`.env.local` y panel del proveedor; solo servidor).
3. Opcional: `INCIDENT_EMAIL_TO` e `INCIDENT_EMAIL_FROM`. Con el remitente por defecto (`onboarding@resend.dev`) Resend solo entrega al correo de la cuenta; para otro destino verifica un dominio propio.

**Control de spam y privacidad**

- El mismo error se envía una vez cada 10 minutos, con máximo de 20 correos por hora.
- Se eliminan correos, tokens y números largos (NSS, CLABE, CURP, RFC) antes de enviar.
- Los errores esperados (contraseña incorrecta, datos inválidos) no generan correo.
- Sin `RESEND_API_KEY`, los errores solo se escriben en el log del servidor.

Código: `src/lib/incidents.ts` (servidor), `src/lib/report-incident.ts` (navegador) y `src/lib/email.ts`.


---

# Base de datos

Postgres de Supabase. Todo el esquema vive en `supabase/migrations/` y las migraciones son idempotentes (se pueden repetir).

## Migraciones (ejecutar en este orden)

| # | Archivo | Contenido |
| --- | --- | --- |
| 1 | `202611030001_create_employee_directory.sql` | `employees`, `authorized_users`, bucket `employee-photos` |
| 2 | `202611040002_roles_y_usuarios.sql` | `roles` con `permisos` y `es_sistema`; usuarios administrables |
| 3 | `202611050001_seguridad.sql` | `has_app_permission`, políticas RLS por permiso, `audit_log` |
| 4 | `202611060001_epp.sql` | `epp_articles`, `epp_movements`, `epp_apply` |
| 5 | `202611060002_epp_historial.sql` | Historial de muestra (28 entregas de 4 trabajadores), sin alterar existencias |
| 6 | `202611070001_epp_por_sede.sql` | `epp_stock`, solicitudes de compra, rol `EncargadoCompras`, `epp_apply_site` |
| 7 | `202611080001_varios_roles.sql` | `authorized_user_roles` (varios roles por cuenta) |
| 8 | `202611090001_epp_controles.sql` | Controles de EPP, `is_super_admin`, `epp_apply_site` actualizada |
| 9 | `202611100001_combustibles_alternos.sql` | Tablas `fuel_*`, funciones con candados, bucket `fuel-permits`, roles de combustibles |

## Tablas

**Núcleo**

| Tabla | Descripción |
| --- | --- |
| `employees` | Expedientes. Sedes válidas: `Campeche`, `Lagunas`, `Cruz Azul`, `El Carmen`. `nss`, `curp` y `rfc` únicos |
| `authorized_users` | Cuentas autorizadas (`user_id` → `auth.users`), con `active`, `full_name`, `role_id` (rol principal) y `site` |
| `authorized_user_roles` | Roles adicionales por cuenta; los permisos son la suma de todos |
| `roles` | `nombre`, `descripcion`, `permisos text[]`, `es_sistema` |
| `audit_log` | Bitácora (solo accesible con la llave de servidor) |

**EPP**: `epp_articles` (catálogo común), `epp_stock` (existencia y mínimo por sede), `epp_movements` (ingresos, entregas y ajustes; no editables), `epp_purchase_requests`, `epp_purchase_request_items`.

**Combustibles alternos**: `fuel_suppliers`, `fuel_products`, `fuel_schedule`, `fuel_receptions`, `fuel_coke_consumption`, `fuel_alerts_sent`.

## Funciones principales

| Función | Propósito |
| --- | --- |
| `has_app_permission`, `can_access_site`, `is_super_admin`, `is_employee_app_user` | Base de las políticas RLS |
| `epp_apply_site` | Único camino para cambiar existencias (atómica; valida permiso, sede y existencia) |
| `epp_set_min_stock`, `epp_request_purchase`, `epp_update_purchase` | Mínimos y solicitudes de compra |
| `fuel_save_supplier`, `fuel_set_commercial` | Homologación y tarifas |
| `fuel_schedule_add`, `fuel_schedule_cancel` | Programación (con bloqueo predictivo) |
| `fuel_scale_entry`, `fuel_scale_exit`, `fuel_scale_cancel`, `fuel_set_chlorine` | Báscula y cloro por embarque |
| `fuel_set_coke` | Consumo mensual de coque |
| `fuel_month_summary_raw`, `fuel_month_summary`, `fuel_level`, `fuel_today` | Semáforo SEMARNAT |
| `fuel_claim_alert` | Garantiza un solo correo por nivel y mes |
| `fuel_receptions_lock` | Trigger que cierra los tickets de forma irreversible |

## Almacenamiento (Storage)

| Bucket | Privado | Contenido | Límite |
| --- | --- | --- | --- |
| `employee-photos` | Sí | Fotos de expediente (JPG, PNG, WebP) | 3 MB |
| `fuel-permits` | Sí | Permisos SEMARNAT (PDF) | 10 MB |

Las fotos se piden con enlaces firmados temporales.

## Convenciones

- RLS activado en todas las tablas de `public` y cerrado para `anon`.
- Los cambios de datos sensibles se hacen solo mediante funciones (`epp_*`, `fuel_*`) que validan permiso y reglas; las tablas se leen con el permiso `*.view` correspondiente.
- Para nuevas migraciones: nombre `AAAAMMDDNNNN_descripcion.sql`, idempotente, y regístrala en el README.


---

# API

Rutas Next.js en `src/app/api/`. Toda petición exige `Authorization: Bearer <token de Supabase>`.

## Validaciones comunes (`getAuthenticatedClient`)

1. Límite de **240 peticiones por minuto por IP** (HTTP 429).
2. Origen: las peticiones que modifican datos solo se aceptan desde la misma aplicación (HTTP 403).
3. Token válido (HTTP 401) y cuenta activa en `authorized_users` (HTTP 403).
4. Permiso del rol, que es la suma de los roles de la cuenta (HTTP 403).
5. Cuerpos de máximo 100 KB, validados con Zod. Respuestas con `Cache-Control: no-store`.

Las rutas de `/api/admin` usan además `requireAdmin` (límite de 60 peticiones por minuto y llave `service_role`).

## Rutas

### Sesión y avisos

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/me` | GET | Cuenta autorizada (devuelve rol, permisos y sede) |
| `/api/notifications` | GET | Cuenta autorizada (cada fuente exige su permiso) |
| `/api/incidents` | POST | Reporte de errores del navegador |

### Empleados

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/employees` | GET / POST | `employees.view` / `employees.create` |
| `/api/employees/[id]` | GET / PATCH / DELETE | `employees.view` / `employees.edit` / `employees.delete` |

### EPP

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/epp/articles` | GET / POST | `epp.view` / `epp.manage` |
| `/api/epp/articles/[id]` | PATCH | `epp.manage` |
| `/api/epp/employees` | GET | `epp.deliver` |
| `/api/epp/movements` | GET / POST | `epp.view` / validado en `epp_apply_site` según el tipo |
| `/api/epp/ledger` | GET | `epp.view` |
| `/api/epp/requests` | GET / POST | Cuenta autorizada / `epp.request` |
| `/api/epp/requests/[id]` | PATCH | Validado en `epp_update_purchase` |

### Combustibles alternos

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/fuels/data` | GET | `fuels.view` |
| `/api/fuels/suppliers` · `/suppliers/[id]` | POST · PATCH | `fuels.suppliers` |
| `/api/fuels/products/[id]` | PATCH | `fuels.commercial` |
| `/api/fuels/schedule` · `/schedule/[id]` | POST · PATCH | `fuels.schedule` |
| `/api/fuels/receptions` | POST | `fuels.scale` |
| `/api/fuels/receptions/[id]` | PATCH (salida/tara, cancelar, cloro) | `fuels.view` + validación en la función de base |
| `/api/fuels/coke` | PUT | `fuels.ecology` |

### Administración

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/admin/users` | GET / POST | `users.manage` |
| `/api/admin/users/[id]` | PATCH / DELETE | `users.manage` |
| `/api/admin/roles` | GET / POST | `users.manage` |
| `/api/admin/roles/[id]` | PATCH / DELETE | `users.manage` |

## Errores

Respuesta JSON `{ "error": "mensaje" }`. Los errores del servidor (500) se reportan por correo; los esperados (datos inválidos, contraseña incorrecta) no. Detalles en Notificaciones e incidencias.


---

# Roles y permisos

Se administran en la pantalla **Usuarios y roles** (`/admin`, permiso `users.manage`).

## Catálogo de permisos (`src/lib/permissions.ts`)

| Permiso | Descripción |
| --- | --- |
| `employees.view` | Ver directorio y expedientes |
| `employees.create` | Registrar empleados |
| `employees.edit` | Editar expedientes |
| `employees.delete` | Eliminar expedientes |
| `employees.download` | Descargar expedientes |
| `epp.view` | Ver inventario y entregas de EPP |
| `epp.deliver` | Registrar entregas de EPP |
| `epp.manage` | Administrar catálogo, ingresos y ajustes |
| `epp.request` | Solicitar compra cuando falta material |
| `epp.purchase` | Atender solicitudes de compra (encargado de compras) |
| `fuels.view` | Ver combustibles alternos y semáforo SEMARNAT |
| `fuels.suppliers` | Homologar proveedores (M1) |
| `fuels.schedule` | Programar recepciones (M2) |
| `fuels.scale` | Operar báscula y manifiestos (M3) |
| `fuels.commercial` | Tarifas y reportes contables (M4) |
| `fuels.ecology` | Capturar consumo de coque y reporte SEMARNAT (M5) |
| `users.manage` | Administrar usuarios y roles |

## Roles

La base guarda nombres técnicos y la app los muestra legibles (`src/lib/roles.ts`). **No renombres un rol en la base**: las migraciones lo buscan por ese nombre. Para cambiar cómo se ve, agrégalo en `roles.ts`.

| Rol (técnico) | En pantalla | Origen |
| --- | --- | --- |
| `SuperAdmin` | Super administrador | Rol de sistema (`es_sistema`): todos los permisos y todas las sedes |
| `AdminSede` | Administrador de sede | Migración de roles |
| `RecursosHumanos` | Recursos humanos | Migración de roles (altas, bajas y expedientes) |
| `AlmacenistaEPP` | Almacenista de EPP | Permisos de inventario: `epp.view`, `epp.deliver`, `epp.manage`, `epp.request` |
| `EncargadoCompras` | Encargado de compras | Migración de EPP por sede; recibe el aviso de solicitudes nuevas |
| `CombustiblesAlternos` | Combustibles alternos | Migración de combustibles |
| `OperadorBascula` | Operador de báscula | Migración de combustibles |
| `Ecologia` | Ecología | Migración de combustibles |
| `ContabilidadCombustibles` | Contabilidad de combustibles | Migración de combustibles |

## Reglas

- **Varios roles por cuenta**: los permisos son la suma de todos; el primero marcado es el rol principal (`authorized_users.role_id`). Requiere `202611080001_varios_roles.sql`.
- **Sede**: cada cuenta puede tener una sede asignada (`Campeche`, `Lagunas`, `Cruz Azul`, `El Carmen`). Con sede, solo ve y mueve el inventario de esa sede; sin sede (*Todas las sedes*) y el SuperAdmin eligen la sede en pantalla.
- **Pantalla de inicio**: si la cuenta abre una pantalla sin permiso, la app la lleva a la primera pantalla del menú que sí puede usar.
- **Protecciones**: no puedes borrar ni desactivar tu cuenta y siempre queda un SuperAdmin activo.
- Un permiso nuevo agregado en `permissions.ts` aparece solo en el editor de roles.


---

# Seguridad

## Ya incluido en el código

- **Cabeceras HTTP** (`next.config.ts`): CSP (solo este dominio y Supabase), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, sin indexación y sin caché en `/api`.
- **API**: sesión verificada con Supabase, permiso del rol, verificación de origen en cambios, límite por IP, cuerpos de máx. 100 KB y validación con Zod.
- **Permisos también en la base**: `has_app_permission` en las políticas RLS; una cuenta no puede saltarse la API llamando directo a Supabase.
- **RLS** activado y cerrado para `anon` en todas las tablas de `public`; `audit_log` y la administración de cuentas solo con la llave de servidor.
- **Bitácora `audit_log`**: altas, cambios y bajas de empleados, consulta de expedientes completos, y cambios de usuarios y roles. Guarda identificadores y nombres de campos, nunca datos personales.
- **Sesión**: cierre tras 30 minutos de inactividad; bloqueo de 1 minuto tras 5 contraseñas incorrectas; contraseñas nuevas de mínimo 12 caracteres.
- **Fotos**: bucket privado, enlaces firmados de 1 hora y metadatos EXIF eliminados al comprimir.
- **Administración**: no puedes borrar ni desactivar tu propia cuenta y siempre queda un SuperAdmin activo.
- **Inventario por sede**: una cuenta con sede asignada solo opera su sede, y la base lo impone.
- **Candados de negocio en base** (combustibles): tickets cerrados irreversibles, folio de manifiesto único, bloqueo predictivo al 30 %.

## Pendiente de configurar (Supabase y Vercel)

1. Deshabilitar el registro público (**Sign In / Providers → Allow new users to sign up: off**).
2. Activar **Prevent use of leaked passwords** y subir la longitud mínima a 12.
3. Activar **MFA (TOTP)** y exigirlo a los SuperAdmin cuando se decida.
4. En **URL Configuration**, solo las URL reales de producción (y localhost en desarrollo).
5. Activar **CAPTCHA** (Turnstile/hCaptcha) si hay intentos de fuerza bruta.
6. Reducir la duración del JWT (p. ej. 1 hora) y revisar los **Rate Limits**.
7. Activar **backups diarios / PITR** y restringir el acceso al panel.
8. En Vercel: `SUPABASE_SERVICE_ROLE_KEY` solo en entornos de servidor y habilitar el Firewall / protección contra bots.

## Límites conocidos

- El límite de peticiones es en memoria por instancia; para uno global usa el Firewall de Vercel o Upstash.
- El CSP permite scripts en línea porque Next.js los usa (se puede endurecer con nonces).
- Los expedientes contienen datos personales (NSS, CURP, RFC, cuenta bancaria, salario): no los compartas fuera del sistema y asigna `employees.view` solo a quien lo necesite.


---

