# API

Rutas Next.js en `src/app/api/`. Toda petición exige `Authorization: Bearer <token de Supabase>`.

## Validaciones comunes (`getAuthenticatedClient`)

1. Límite de **240 peticiones por minuto por IP** (HTTP 429).
2. Origen: las peticiones que modifican datos solo se aceptan desde la misma aplicación (HTTP 403).
3. Token válido (HTTP 401) y cuenta activa en `authorized_users` (HTTP 403).
4. Permiso del rol, que es la suma de los roles de la cuenta (HTTP 403).
5. Cuerpos de máximo 100 KB, validados con Zod. Respuestas con `Cache-Control: no-store`.

Las rutas de `/api/admin` usan además `requireAdmin` (límite de 60 peticiones por minuto y llave `service_role`).

## Rutas

### Sesión y avisos

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/me` | GET | Cuenta autorizada (devuelve rol, permisos y sede) |
| `/api/notifications` | GET | Cuenta autorizada (cada fuente exige su permiso) |
| `/api/incidents` | POST | Reporte de errores del navegador |

### Empleados

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/employees` | GET / POST | `employees.view` / `employees.create` |
| `/api/employees/[id]` | GET / PATCH / DELETE | `employees.view` / `employees.edit` / `employees.delete` |

### EPP

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/epp/articles` | GET / POST | `epp.view` / `epp.manage` |
| `/api/epp/articles/[id]` | PATCH | `epp.manage` |
| `/api/epp/employees` | GET | `epp.deliver` |
| `/api/epp/movements` | GET / POST | `epp.view` / validado en `epp_apply_site` según el tipo |
| `/api/epp/ledger` | GET | `epp.view` |
| `/api/epp/requests` | GET / POST | Cuenta autorizada / `epp.request` |
| `/api/epp/requests/[id]` | PATCH | Validado en `epp_update_purchase` |

### Combustibles alternos

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/fuels/data` | GET | `fuels.view` |
| `/api/fuels/suppliers` · `/suppliers/[id]` | POST · PATCH | `fuels.suppliers` |
| `/api/fuels/products/[id]` | PATCH | `fuels.commercial` |
| `/api/fuels/schedule` · `/schedule/[id]` | POST · PATCH | `fuels.schedule` |
| `/api/fuels/receptions` | POST | `fuels.scale` |
| `/api/fuels/receptions/[id]` | PATCH (salida/tara, cancelar, cloro) | `fuels.view` + validación en la función de base |
| `/api/fuels/coke` | PUT | `fuels.ecology` |

### Administración

| Ruta | Métodos | Permiso |
| --- | --- | --- |
| `/api/admin/users` | GET / POST | `users.manage` |
| `/api/admin/users/[id]` | PATCH / DELETE | `users.manage` |
| `/api/admin/roles` | GET / POST | `users.manage` |
| `/api/admin/roles/[id]` | PATCH / DELETE | `users.manage` |

## Errores

Respuesta JSON `{ "error": "mensaje" }`. Los errores del servidor (500) se reportan por correo; los esperados (datos inválidos, contraseña incorrecta) no. Detalles en [Notificaciones e incidencias](Notificaciones-e-incidencias).
