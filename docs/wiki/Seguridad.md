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
