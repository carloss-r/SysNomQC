# Base de datos

Postgres de Supabase. Todo el esquema vive en `supabase/migrations/` y las migraciones son idempotentes (se pueden repetir).

## Migraciones (ejecutar en este orden)

| # | Archivo | Contenido |
| --- | --- | --- |
| 1 | `202611030001_create_employee_directory.sql` | `employees`, `authorized_users`, bucket `employee-photos` |
| 2 | `202611040002_roles_y_usuarios.sql` | `roles` con `permisos` y `es_sistema`; usuarios administrables |
| 3 | `202611050001_seguridad.sql` | `has_app_permission`, políticas RLS por permiso, `audit_log` |
| 4 | `202611060001_epp.sql` | `epp_articles`, `epp_movements`, `epp_apply` |
| 5 | `202611060002_epp_historial.sql` | Historial de muestra (28 entregas de 4 trabajadores), sin alterar existencias |
| 6 | `202611070001_epp_por_sede.sql` | `epp_stock`, solicitudes de compra, rol `Encargado de compras`, `epp_apply_site` |
| 7 | `202611080001_varios_roles.sql` | `authorized_user_roles` (varios roles por cuenta) |
| 8 | `202611090001_epp_controles.sql` | Controles de EPP, `is_super_admin`, `epp_apply_site` actualizada |
| 9 | `202611100001_combustibles_alternos.sql` | Tablas `fuel_*`, funciones con candados, bucket `fuel-permits`, roles de combustibles |
| 10 | `202611110001_normalizar_roles.sql` | Renombra los roles a nombres legibles (`EncargadoCompras` → `Encargado de compras`) |
| 11 | `202611110002_facturas.sql` | Tabla `invoices`, bucket privado `invoices`, permisos `invoices.*`, rol `Cuentas por pagar` |
| 12 | `202611110003_facturas_ediciones.sql` | `invoice_edits`: bitácora de correcciones de facturas (quién, cuándo, antes → después) |

## Tablas

**Núcleo**

| Tabla | Descripción |
| --- | --- |
| `employees` | Expedientes. Sedes válidas: `Campeche`, `Lagunas`, `Cruz Azul`. `nss`, `curp` y `rfc` únicos |
| `authorized_users` | Cuentas autorizadas (`user_id` → `auth.users`), con `active`, `full_name`, `role_id` (rol principal) y `site` |
| `authorized_user_roles` | Roles adicionales por cuenta; los permisos son la suma de todos |
| `roles` | `nombre`, `descripcion`, `permisos text[]`, `es_sistema` |
| `audit_log` | Bitácora (solo accesible con la llave de servidor) |

**EPP**: `epp_articles` (catálogo común), `epp_stock` (existencia y mínimo por sede), `epp_movements` (ingresos, entregas y ajustes; no editables), `epp_purchase_requests`, `epp_purchase_request_items`.

**Combustibles alternos**: `fuel_suppliers`, `fuel_products`, `fuel_schedule`, `fuel_receptions`, `fuel_coke_consumption`, `fuel_alerts_sent`.

**Facturas**: `invoices` (PDF en el bucket privado `invoices`, texto digitalizado en `text_content`, estatus `pendiente`/`pagada`).

## Funciones principales

| Función | Propósito |
| --- | --- |
| `has_app_permission`, `can_access_site`, `is_super_admin`, `is_employee_app_user` | Base de las políticas RLS |
| `epp_apply_site` | Único camino para cambiar existencias (atómica; valida permiso, sede y existencia) |
| `epp_set_min_stock`, `epp_request_purchase`, `epp_update_purchase` | Mínimos y solicitudes de compra |
| `fuel_save_supplier`, `fuel_set_commercial` | Homologación y tarifas |
| `fuel_schedule_add`, `fuel_schedule_cancel` | Programación (con bloqueo predictivo) |
| `fuel_scale_entry`, `fuel_scale_exit`, `fuel_scale_cancel`, `fuel_set_chlorine` | Báscula y cloro por embarque |
| `fuel_set_coke` | Consumo mensual de coque |
| `fuel_month_summary_raw`, `fuel_month_summary`, `fuel_level`, `fuel_today` | Semáforo SEMARNAT |
| `fuel_claim_alert` | Garantiza un solo correo por nivel y mes |
| `fuel_receptions_lock` | Trigger que cierra los tickets de forma irreversible |

## Almacenamiento (Storage)

| Bucket | Privado | Contenido | Límite |
| --- | --- | --- | --- |
| `employee-photos` | Sí | Fotos de expediente (JPG, PNG, WebP) | 3 MB |
| `fuel-permits` | Sí | Permisos SEMARNAT (PDF) | 10 MB |

Las fotos se piden con enlaces firmados temporales.

## Convenciones

- RLS activado en todas las tablas de `public` y cerrado para `anon`.
- Los cambios de datos sensibles se hacen solo mediante funciones (`epp_*`, `fuel_*`) que validan permiso y reglas; las tablas se leen con el permiso `*.view` correspondiente.
- Para nuevas migraciones: nombre `AAAAMMDDNNNN_descripcion.sql`, idempotente, y regístrala en el README.
