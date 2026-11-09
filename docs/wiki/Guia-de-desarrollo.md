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
