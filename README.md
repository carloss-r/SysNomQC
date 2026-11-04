# SysNomQC - Gestión de personal

Aplicación con Next.js y React para administrar el directorio de empleados usando Supabase Auth, Postgres (tablas `empleados` y catálogos) y Supabase Storage para las fotografías.

## Preparación de Supabase

1. En el proyecto de Supabase, abre **SQL Editor** y ejecuta, en este orden, `supabase/migrations/202611030001_create_employee_directory.sql` y `supabase/migrations/202611040001_empleados_catalogos_fotos.sql`.
2. En **Authentication > Users**, crea las cuentas autorizadas. El sistema no ofrece registro público.
3. Por cada cuenta, copia su UUID y correo desde Auth y autorízala ejecutando en SQL Editor:

   ```sql
   insert into public.authorized_users (user_id, email)
   values ('UUID-DE-LA-CUENTA', 'usuario@cooperativa.com');
   ```

4. En **Authentication > URL Configuration**, configura las URL de desarrollo y producción. Deshabilita el registro público de usuarios.
5. Comprueba que las políticas RLS de la migración estén habilitadas. Solo las cuentas registradas en `authorized_users` pueden consultar, crear, editar o eliminar expedientes.

Los datos se guardan en `empleados` (con `sedes`, `areas`, `puestos`, `catalogos_generos`, `catalogos_estados_civiles`, `catalogos_tipos_credito` y `empleados_creditos`). La segunda migración:

- agrega `empleados.codigo_empleado` (ID visible, p. ej. `QG-101`);
- completa los catálogos con los valores que falten (las sedes nuevas quedan con estado/ciudad "Por definir": edítalos en Table Editor);
- copia a `empleados` lo que hubiera en la tabla anterior `employees` (no la borra);
- activa RLS en estas tablas y limita el acceso a las cuentas de `authorized_users`.

Para agregar sedes, áreas, puestos o tipos de crédito, inserta filas en la tabla de catálogo correspondiente; aparecen solos en el formulario.

## Fotografías (Supabase Storage)

Las fotos se guardan en el bucket privado `employee-photos` (lo crea la migración si no existe; solo JPG, PNG o WebP, máximo 3 MB).

- Al elegir una foto, el navegador la comprime (máximo 800 px por lado, JPEG) antes de subirla; normalmente pesa menos de 150 KB.
- En `empleados.foto_perfil_url` se guarda la **ruta del archivo dentro del bucket**, no una URL. Para mostrarla se pide un enlace firmado temporal.
- Al reemplazar o quitar una foto, o al eliminar un empleado, se borra el archivo anterior del bucket.
- Firebase ya no se usa para las fotos.

## Descargar expediente

En el expediente de cada empleado, el botón **Descargar expediente** abre el diálogo de impresión con una hoja A4 que incluye todos sus datos y su foto, con el logotipo de la cooperativa como único membrete. Desde ahí se imprime o se elige "Guardar como PDF".

## Aviso de incidencias por correo

Cuando ocurre un error en el servidor (base de datos, API) o en el navegador (red caída, error de JavaScript), el sistema envía un correo a `crlos.trabajo.dev@gmail.com`.

1. Crea una cuenta en [resend.com](https://resend.com) con ese mismo correo y genera una API key.
2. Agrégala como variable de entorno `RESEND_API_KEY` (en `.env.local` y en el panel de tu proveedor). Es solo de servidor.
3. Opcional: `INCIDENT_EMAIL_TO` y `INCIDENT_EMAIL_FROM`. Con el remitente por defecto (`onboarding@resend.dev`) Resend solo entrega al correo de tu cuenta; para otro destino verifica un dominio propio.

Para evitar spam y costos: el mismo error se envía una vez cada 10 minutos, hay un máximo de 20 correos por hora y se eliminan correos, tokens y números largos (NSS, CLABE, CURP, RFC) antes de enviar. Los errores esperados (contraseña incorrecta, datos inválidos) no generan correo. Sin `RESEND_API_KEY` los errores solo se escriben en el log del servidor.

## Cargas optimizadas

- La tabla descarga solo los datos básicos de cada empleado; el expediente completo (con créditos) se pide al abrirlo.
- Guardar o eliminar actualiza la lista en memoria, sin volver a descargarla.
- Cambiar de pestaña o renovarse el token de sesión no recarga el directorio.
- Los catálogos se piden una sola vez al iniciar sesión y las fotos se piden solo al abrir un expediente o editarlo.

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

La API de Next.js exige una sesión de Supabase válida en cada operación de empleados y aplica además las políticas RLS de Postgres. Las fotos son opcionales, se almacenan en un bucket privado de Supabase y se sirven mediante enlaces firmados.

> Los expedientes incluyen información personal. Todo usuario autorizado tiene acceso completo a todas las sedes y operaciones; para un despliegue con roles o restricciones por sede, adapta las políticas antes de otorgar acceso.
