# SysNomQC

Sistema de gestión de personal de la cooperativa. Aplicación **Next.js + React** sobre **Supabase** (Auth, Postgres y Storage). Todas las cuentas son autorizadas manualmente; no hay registro público.

## Módulos

| Módulo | Ruta | Permiso de acceso | Página |
| --- | --- | --- | --- |
| Empleados (pantalla principal) | `/` | `employees.view` | [Módulo Empleados](Modulo-Empleados) |
| EPP (Seguridad e higiene) | `/epp` | `epp.view` | [Módulo EPP](Modulo-EPP) |
| Combustibles alternos (Ecología) | `/combustibles` | `fuels.view` | [Módulo Combustibles alternos](Modulo-Combustibles-Alternos) |
| Notificaciones | `/notificaciones` | cuenta autorizada | [Notificaciones e incidencias](Notificaciones-e-incidencias) |
| Usuarios y roles | `/admin` | `users.manage` | [Roles y permisos](Roles-y-permisos) |

## Documentación

- [Instalación y entornos](Instalacion-y-entornos): requisitos, variables de entorno, local vs. nube, despliegue.
- [Arquitectura](Arquitectura): estructura del código y aislamiento por pantalla.
- [Base de datos](Base-de-datos): migraciones, tablas, funciones y buckets.
- [API](API): rutas, métodos y permisos.
- [Seguridad](Seguridad): protecciones del código y configuración pendiente en Supabase/Vercel.
- [Roles y permisos](Roles-y-permisos): catálogo de permisos, roles sugeridos y sedes.
- [Guía de desarrollo](Guia-de-desarrollo): cómo agregar pantallas, permisos y avisos.

## Stack

Next.js 16 · React 19 · TypeScript · Supabase (`@supabase/supabase-js`) · Zod · jsPDF · ExcelJS · lucide-react.

## Flujo de ramas

El trabajo se realiza en la rama `development` (se despliega como *Preview* en Vercel); `main` es *Production*.
