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

1. En **SQL Editor** ejecuta, **en orden**, las migraciones de `supabase/migrations/` (ver [Base de datos](Base-de-datos)).
2. En **Authentication → Users** crea las cuentas. El sistema no ofrece registro público.
3. Autoriza cada cuenta:

   ```sql
   insert into public.authorized_users (user_id, email)
   values ('UUID-DE-LA-CUENTA', 'usuario@cooperativa.com');
   ```

4. En **Authentication → URL Configuration** deja las URL de desarrollo y producción.
5. Deshabilita el registro público (ver [Seguridad](Seguridad)).

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
| `NEXT_PUBLIC_FIREBASE_*` | Público | Declaradas en `.env.example`; ver nota en [Arquitectura](Arquitectura) |

## Local vs. nube

La aplicación no usa cadena de conexión a Postgres: habla con Supabase por URL y llaves, leídas desde variables de entorno (`src/lib/supabase.ts`, `src/lib/database.ts`, `src/lib/supabase-admin.ts`).

- **Local:** `supabase start` y `supabase status` entregan URL y llaves; `supabase db reset` aplica las migraciones.
- **Nube (producción):** las mismas tres variables en **Vercel → Settings → Environment Variables**. Para llevar cambios de BD, ejecuta las migraciones nuevas en el SQL Editor o con `supabase db push`.
- Las variables **no** se leen del panel de Supabase. Los cambios en Vercel solo aplican a despliegues nuevos: vuelve a desplegar.
- `development` se despliega como **Preview**; `main` como **Production**.
- Crea al menos un usuario en Authentication de cada entorno y autorízalo en `authorized_users`.

## Despliegue

Aplicación Next.js estándar (por ejemplo, Vercel). Ejecuta `npm run build` antes de publicar y configura las variables por entorno.
