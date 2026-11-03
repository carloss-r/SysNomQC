# SysNomQC - Gestión de personal

Aplicación con Next.js y React para administrar el directorio de empleados usando Supabase Auth y Postgres para los datos y Firebase Storage para las fotografías.

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

## Preparación de Firebase Storage (fotos)

1. En Firebase Console (proyecto `sysnomqc-31c0a`) abre **Build > Storage** y crea el bucket si aún no existe.
2. En **Build > Authentication > Sign-in method** habilita el proveedor **Anónimo**. La app lo usa solo para que las reglas de Storage exijan una sesión; el acceso real al directorio sigue protegido por Supabase.
3. En **Storage > Reglas** pega el contenido de `firebase/storage.rules` y publica.
4. Las fotos nuevas se guardan en `employee-photos/` y en la base de datos se guarda esa ruta. Las fotos antiguas guardadas en Supabase se siguen mostrando.

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
