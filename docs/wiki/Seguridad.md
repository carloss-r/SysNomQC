# Seguridad

## Ya incluido en el código

- **Cabeceras HTTP** (`next.config.ts`): CSP (solo este dominio y Supabase; sin iframes, sin plugins, sin atributos `on…`, `upgrade-insecure-requests`), HSTS de 2 años con subdominios, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara, micrófono, ubicación, USB, etc. bloqueados), `X-Permitted-Cross-Domain-Policies`, `Origin-Agent-Cluster`, COOP/CORP, sin caché en `/api` y **solo la portada indexable** (ver abajo).
- **API**: sesión verificada con Supabase, permiso del rol, verificación de origen en cambios, límite por IP, cuerpos de máx. 100 KB y validación con Zod.
- **Permisos también en la base**: `has_app_permission` en las políticas RLS; una cuenta no puede saltarse la API llamando directo a Supabase.
- **RLS** activado en todas las tablas de `public`. Desde `202611250003_seguridad_produccion.sql`, el rol `anon` (sin sesión) **no tiene ningún permiso** en tablas, vistas, secuencias ni funciones de `public`, y lo que se cree después tampoco se le da. La vista antigua `vw_empleados_resumen` (que ignoraba RLS y estaba abierta a `anon`) quedó cerrada. `audit_log` y la administración de cuentas solo con la llave de servidor.
- **Bitácora `audit_log`**: altas, cambios y bajas de empleados, consulta de expedientes completos, y cambios de usuarios y roles. Guarda identificadores y nombres de campos, nunca datos personales.
- **Sesión**: cierre tras 30 minutos de inactividad; contraseñas nuevas de mínimo 12 caracteres.
- **Inicio de sesión** (todo pasa por `/api/auth/login`, con usuario o correo): solo desde esta aplicación (origen), máx. 10 intentos por minuto por IP, y **bloqueo de 15 minutos** tras 5 fallos del mismo usuario o 30 de la misma IP (`auth_login_attempts`, guarda el usuario como SHA-256, 30 días). Misma respuesta exista o no el usuario.
- **Hook de Supabase Auth** `hook_password_verification_attempt`: bloquea la cuenta 15 minutos tras 5 contraseñas fallidas aunque llamen a Supabase directo con la llave pública (hay que activarlo, ver abajo).
- **Errores**: la pantalla nunca muestra el detalle interno de la base; ese detalle llega solo al correo de incidencias.
- **Fotos**: bucket privado, enlaces firmados de 1 hora y metadatos EXIF eliminados al comprimir.
- **Administración**: no puedes borrar ni desactivar tu propia cuenta y siempre queda un SuperAdmin activo.
- **Inventario por sede**: una cuenta con sede asignada solo opera su sede, y la base lo impone.
- **Candados de negocio en base** (combustibles): tickets cerrados irreversibles, folio de manifiesto único, bloqueo predictivo al 30 %.

## Pendiente de configurar (Supabase y Vercel)

0. **Activar el hook de contraseñas**: Supabase → Authentication → Hooks → *Password verification attempt* → Postgres → `public.hook_password_verification_attempt`.
1. Deshabilitar el registro público (**Sign In / Providers → Allow new users to sign up: off**).
2. Activar **Prevent use of leaked passwords** y subir la longitud mínima a 12.
3. Activar **MFA (TOTP)** y exigirlo a los SuperAdmin cuando se decida.
4. En **URL Configuration**: *Site URL* = el dominio nuevo con `https://`, y en *Redirect URLs* solo ese dominio (quitar el `*.vercel.app` cuando ya no se use; localhost solo en el proyecto de desarrollo).
5. Activar **CAPTCHA** (Turnstile/hCaptcha) si hay intentos de fuerza bruta.
6. Reducir la duración del JWT (p. ej. 1 hora) y revisar los **Rate Limits**.
7. Activar **backups diarios / PITR** y restringir el acceso al panel.
8. En Vercel: `SUPABASE_SERVICE_ROLE_KEY` solo en entornos de servidor y habilitar el Firewall / protección contra bots.
9. **Dominio**: redirigir `www` al dominio principal (o al revés) en Vercel; HTTPS lo pone Vercel solo. Activar **Deployment Protection** para que las vistas previas (`*.vercel.app`) pidan inicio de sesión de Vercel.
10. **Cuentas**: MFA (2 pasos) en GitHub, Vercel, Supabase y el correo de administración; quien ya no trabaje en el proyecto, fuera de los tres.

## Límites conocidos

- El límite de peticiones es en memoria por instancia; para uno global usa el Firewall de Vercel o Upstash.
- El CSP permite scripts en línea porque Next.js los usa (se puede endurecer con nonces).
- Los expedientes contienen datos personales (NSS, CURP, RFC, cuenta bancaria, salario): no los compartas fuera del sistema y asigna `employees.view` solo a quien lo necesite.

## Google (buscadores)

Solo la **portada** (`/`, que sin sesión muestra el inicio de sesión) aparece en Google, con el nombre *Cooperativa Quinta Generación*, el logo y los datos de la organización (JSON-LD). Todo lo demás lleva `X-Robots-Tag: noindex` y `<meta name="robots" content="noindex">`, y `robots.txt` solo permite `/`, `/_next/static/` y el logo, sin nombrar las rutas internas.

- `src/app/sitemap.ts` → `/sitemap.xml` (solo la portada).
- `src/app/robots.ts` → `/robots.txt` (con la dirección del sitemap).
- Dominio: variable `NEXT_PUBLIC_SITE_URL=https://tu-dominio.com` en Vercel (si falta, usa el dominio de producción de Vercel).
- Alta en **Google Search Console** (verificación por registro DNS TXT) y envío de `https://tu-dominio.com/sitemap.xml`.
- Página pública de la cooperativa: lista en `src/features/landing/` (textos en `content.ts`) pero **desactivada**. Para usarla: `src/app/page.tsx` que muestre `<LandingPage />` y mover la pantalla de empleados a otra ruta (p. ej. `/personal`).
