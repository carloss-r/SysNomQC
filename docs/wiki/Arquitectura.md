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
4. **Base de datos**: RLS por permiso y funciones `SECURITY DEFINER` que son la última barrera (ver [Base de datos](Base-de-datos)).

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
