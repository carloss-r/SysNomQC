# SysNomQC - Gestión de personal

Aplicación con Next.js y React para administrar el directorio de empleados usando Supabase Auth, Postgres y Supabase Storage (fotografías).

## Preparación de Supabase

1. En el proyecto de Supabase, abre **SQL Editor** y ejecuta, **en este orden**, las migraciones de `supabase/migrations/`:
   1. `202611030001_create_employee_directory.sql` (empleados, `authorized_users`, bucket de fotos)
   2. `202611040002_roles_y_usuarios.sql` (roles, permisos y usuarios administrables)
   3. `202611050001_seguridad.sql` (políticas por permiso, bitácora de auditoría y cierre de tablas sin RLS)
2. En **Authentication > Users**, crea las cuentas autorizadas. El sistema no ofrece registro público.
3. Por cada cuenta, copia su UUID y correo desde Auth y autorízala ejecutando en SQL Editor:

   ```sql
   insert into public.authorized_users (user_id, email)
   values ('UUID-DE-LA-CUENTA', 'usuario@cooperativa.com');
   ```

4. En **Authentication > URL Configuration**, configura las URL de desarrollo y producción. Deshabilita el registro público de usuarios.
5. Comprueba que las políticas RLS de la migración estén habilitadas. Solo las cuentas registradas en `authorized_users` pueden consultar, crear, editar o eliminar expedientes.

La migración crea una tabla `employees` independiente de las tablas `empleados` del archivo SQL anterior. No carga los registros ficticios incluidos en el HTML.

## Fotografías (Supabase Storage)

Las fotos se guardan en el bucket privado `employee-photos` (la migración lo crea si no existe; JPG, PNG o WebP, máximo 3 MB).

- Al elegir una foto, el navegador la comprime (máximo 800 px por lado, JPEG) antes de subirla; normalmente pesa menos de 150 KB.
- En `employees.photo_path` se guarda la ruta del archivo dentro del bucket; para mostrarla se pide un enlace firmado temporal.
- Al reemplazar o quitar una foto, o al eliminar un empleado, se borra el archivo anterior.

## Descargar expediente

En el expediente de cada empleado, **Descargar expediente** abre la impresión con una hoja A4 con todos sus datos y su foto, con el logotipo como único membrete. Desde ahí se imprime o se guarda como PDF.

## Aviso de incidencias por correo

Cuando ocurre un error en el servidor (base de datos, API) o en el navegador (red caída, error de JavaScript), el sistema envía un correo a `crlos.trabajo.dev@gmail.com`.

1. Crea una cuenta en [resend.com](https://resend.com) con ese mismo correo y genera una API key.
2. Agrégala como variable de entorno `RESEND_API_KEY` (en `.env.local` y en el panel de tu proveedor). Es solo de servidor.
3. Opcional: `INCIDENT_EMAIL_TO` y `INCIDENT_EMAIL_FROM`. Con el remitente por defecto (`onboarding@resend.dev`) Resend solo entrega al correo de tu cuenta; para otro destino verifica un dominio propio.

Para evitar spam y costos: el mismo error se envía una vez cada 10 minutos, hay un máximo de 20 correos por hora y se eliminan correos, tokens y números largos (NSS, CLABE, CURP, RFC) antes de enviar. Los errores esperados (contraseña incorrecta, datos inválidos) no generan correo. Sin `RESEND_API_KEY` los errores solo se escriben en el log del servidor.

## Cargas optimizadas

- La tabla descarga solo 8 columnas por empleado; el expediente completo se pide al abrirlo.
- Guardar o eliminar actualiza la lista en memoria, sin volver a descargarla.
- Cambiar de pestaña o renovarse el token de sesión no recarga el directorio.
- Las fotos se piden solo al abrir un expediente o editarlo.

## Módulo de EPP

Pantalla `/epp` (menú **Seguridad e higiene → EPP**). Ejecuta en Supabase `supabase/migrations/202611060001_epp.sql` (después de la de seguridad) y luego `202611060002_epp_historial.sql`, que importa las entregas de octubre y noviembre 2026 y los ciclos de camisolas y botas de los Excel (sin alterar existencias): crea el catálogo con existencias, el historial de movimientos y carga los artículos de los Excel de `Archivos/`.

- **Entregar EPP**: busca al trabajador, agrega uno o varios artículos y confirma; descuenta existencia y guarda quién entregó y cuándo.
- **Ingreso de material** y **Ajuste** (conteo físico, con motivo obligatorio); **Nuevo artículo** y edición del catálogo.
- **Por trabajador**: busca a un trabajador y ve todo el EPP que ha recibido (resumen por artículo, control diario del mes como en el Excel, detalle con quién registró cada entrega) y descárgalo en CSV.
- **Control mensual**: entregas, ingresos y ajustes del mes por artículo y por trabajador, con reporte descargable.
- **Historial**: todos los movimientos con fecha, trabajador, quién los registró y notas.
- Permisos (se asignan en *Usuarios y roles*): `epp.view`, `epp.deliver`, `epp.manage`.
- La existencia solo cambia mediante la función `epp_apply()` (transacción atómica, valida permisos y existencia); los movimientos no se pueden editar ni borrar.

## Arquitectura

```
src/
  app/                      Rutas (solo enrutamiento; cada pantalla es una carpeta)
    layout.tsx              Raíz: notificaciones + sesión
    (app)/layout.tsx        Marco con menú lateral (exige sesión)
    (app)/page.tsx          Dashboard de empleados  ->  /
    (app)/admin/            Usuarios y roles        ->  /admin
    api/                    API del servidor (valida sesión, permisos y datos)
  features/                 Una carpeta por módulo, con su propia lógica y componentes
    auth/  employees/  admin/
  shared/                   Piezas reutilizables: ui/, layout/ (marco, menú), config/navigation.ts
  lib/                      Utilidades sin interfaz (Supabase, API, permisos, seguridad, fotos)
```

**Aislamiento:** cada pantalla tiene su propio `error.tsx`. Si una falla, solo se reemplaza su contenido por un aviso con "Reintentar"; el menú y las demás pantallas siguen funcionando (y la incidencia se reporta por correo).

**Agregar una pantalla nueva**
1. Crea `src/app/(app)/<ruta>/page.tsx` y `error.tsx` (copia el de `admin/`).
2. Pon su lógica en `src/features/<modulo>/` y envuélvela en `<RequirePermission permission="...">`.
3. Agrega una entrada en `src/shared/config/navigation.ts`; el menú la muestra solo a quien tenga el permiso.
4. Si necesita un permiso nuevo, agrégalo en `src/lib/permissions.ts`; aparece solo en el editor de roles.
5. Su API va en `src/app/api/<modulo>/` usando `getAuthenticatedClient(request, "<permiso>")`.

## Seguridad

**Qué ya incluye el código**
- Cabeceras HTTP en `next.config.ts`: CSP (solo este dominio y Supabase), HSTS, anti-iframe, `nosniff`, política de referrer y de permisos, sin indexación, y sin caché en `/api`.
- Cada petición a la API verifica la sesión con Supabase, el permiso del rol, el origen (cambios solo desde esta app) y un límite por IP; los cuerpos están limitados a 100 KB y validados con Zod.
- **Permisos por rol aplicados también en la base de datos** (`has_app_permission` en las políticas RLS de `employees` y de las fotos): una cuenta no puede saltarse la API llamando directo a Supabase.
- RLS activado y cerrado para `anon` en todas las tablas de `public`; `audit_log` y la administración de cuentas solo con la llave de servidor.
- Bitácora `audit_log`: altas, cambios y bajas de empleados, consulta de expedientes completos, y cambios de usuarios y roles (guarda identificadores y nombres de campos, nunca datos personales).
- Cierre de sesión tras 30 minutos de inactividad, bloqueo de 1 minuto tras 5 contraseñas incorrectas, contraseñas nuevas de mínimo 12 caracteres.
- Fotos en bucket privado con enlaces firmados de 1 hora; al comprimirlas se eliminan los metadatos EXIF.
- Protecciones de administración: no puedes borrar ni desactivar tu cuenta, y siempre queda un SuperAdmin activo.

**Qué debes configurar tú en Supabase (Authentication)**
1. Deshabilitar el registro público (**Sign In / Providers → Allow new users to sign up: off**).
2. Activar **Prevent use of leaked passwords** y subir la longitud mínima de contraseña a 12.
3. Activar **MFA (TOTP)** y, cuando quieras, exigirlo a los SuperAdmin.
4. En **URL Configuration**, dejar solo las URLs reales de producción (y localhost para desarrollo).
5. Activar **CAPTCHA** (Turnstile/hCaptcha) en el inicio de sesión si hay intentos de fuerza bruta.
6. Reducir la duración del JWT (p. ej. 1 hora) y revisar los límites de **Rate Limits**.
7. Activar **backups diarios / PITR** en el plan del proyecto y restringir quién tiene acceso al panel.
8. En Vercel: `SUPABASE_SERVICE_ROLE_KEY` solo en entornos de servidor, y habilitar el Firewall / protección contra bots.

**Límites conocidos:** el límite de peticiones es en memoria por instancia (para uno global usa el Firewall de Vercel o Upstash) y el CSP permite scripts en línea porque Next.js los usa (se puede endurecer con nonces).

## Local vs. nube

No hay cadena de conexión a Postgres: la app habla con Supabase por URL y llaves, definidas solo en variables de entorno (leídas en `src/lib/supabase.ts`, `src/lib/database.ts` y `src/app/api/admin/_admin.ts`).

- **Local:** `.env.local` (no se sube a Git) con la URL y llaves de tu Supabase local (`supabase start`, `supabase status`). `supabase db reset` aplica las migraciones de `supabase/migrations`.
- **Producción:** las mismas tres variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) en el panel de Vercel con los valores del proyecto en la nube. Para llevar los cambios de BD a la nube, ejecuta las migraciones nuevas en su SQL Editor (o `supabase db push`).
- Las variables **no se leen desde el panel de Supabase**: deben estar en `.env.local` (y reiniciar `npm run dev`) o en Vercel → Settings → Environment Variables. En Vercel marca el entorno correcto (la rama `development` se despliega como **Preview**, `main` como **Production**) y vuelve a desplegar: los cambios de variables solo aplican a despliegues nuevos.
- Crea al menos un usuario en Authentication de cada entorno y autorízalo en `authorized_users` (ver arriba).

## Ejecutar localmente

Requiere Node.js 20.9 o posterior.

```powershell
npm install
npm run dev
```

La configuración local se guarda en `.env.local` y no se incluye en el repositorio. Usa `.env.example` como referencia para configurar un entorno nuevo. Las variables necesarias son `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no configures una clave `service_role` en el navegador ni en variables `NEXT_PUBLIC_*`.

Abre `http://localhost:3000` e inicia sesión con una cuenta creada en Supabase.

## Publicación

Despliega como aplicación Next.js (por ejemplo, en Vercel) y configura las dos variables de Supabase en el panel de variables de entorno del proveedor para cada entorno. Ejecuta `npm run build` antes de publicar.

La API de Next.js exige una sesión de Supabase válida en cada operación de empleados y aplica además las políticas RLS de Postgres. Las fotos son opcionales, se almacenan en un bucket privado y se sirven mediante enlaces firmados.

> Los expedientes incluyen información personal. Todo usuario autorizado tiene acceso completo a todas las sedes y operaciones; para un despliegue con roles o restricciones por sede, adapta las políticas antes de otorgar acceso.
