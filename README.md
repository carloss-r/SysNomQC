# SysNomQC - Gestión de personal

Aplicación con Next.js y React para administrar el directorio de empleados usando Supabase Auth, Postgres y Supabase Storage (fotografías).

## Preparación de Supabase

1. En el proyecto de Supabase, abre **SQL Editor** y ejecuta `supabase/migrations/202611030001_create_employee_directory.sql`.
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

## Local vs. nube

No hay cadena de conexión a Postgres: la app habla con Supabase por URL y llaves, definidas solo en variables de entorno (leídas en `src/lib/supabase.ts`, `src/lib/database.ts` y `src/app/api/admin/_admin.ts`).

- **Local:** `.env.local` (no se sube a Git) con la URL y llaves de tu Supabase local (`supabase start`, `supabase status`). `supabase db reset` aplica las migraciones de `supabase/migrations`.
- **Producción:** las mismas tres variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) en el panel de Vercel con los valores del proyecto en la nube. Para llevar los cambios de BD a la nube, ejecuta las migraciones nuevas en su SQL Editor (o `supabase db push`).
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
