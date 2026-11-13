# Roles y permisos

Se administran en la pantalla **Usuarios y roles** (`/admin`, permiso `users.manage`).

## Catálogo de permisos (`src/lib/permissions.ts`)

| Permiso | Descripción |
| --- | --- |
| `employees.view` | Ver directorio y expedientes |
| `employees.create` | Registrar empleados |
| `employees.edit` | Editar expedientes |
| `employees.delete` | Eliminar expedientes |
| `employees.download` | Descargar expedientes |
| `epp.view` | Ver inventario y entregas de EPP |
| `epp.deliver` | Registrar entregas de EPP |
| `epp.manage` | Administrar catálogo e ingresos y contar lo que llega de compras |
| `epp.request` | Solicitar compra cuando falta material |
| `epp.purchase` | Registrar compras de EPP y ver lo comprado (encargado de compras) |
| `fuels.view` | Ver combustibles alternos y semáforo SEMARNAT |
| `fuels.suppliers` | Homologar proveedores (M1) |
| `fuels.schedule` | Programar recepciones (M2) |
| `fuels.scale` | Operar báscula y manifiestos (M3) |
| `fuels.commercial` | Tarifas y reportes contables (M4) |
| `fuels.ecology` | Capturar consumo de coque y reporte SEMARNAT (M5) |
| `invoices.view` | Ver facturas, su PDF y los resúmenes de pago |
| `invoices.manage` | Cargar facturas, corregir sus datos y marcarlas pagadas o pendientes |
| `users.manage` | Administrar usuarios y roles |

## Roles

Los nombres se guardan legibles en la base (`202611110001_normalizar_roles.sql` renombró los nombres técnicos en camelCase). Al crear o editar un rol, un nombre escrito como `EncargadoCompras` se guarda como `Encargado de compras`. La app no busca roles por nombre: el SuperAdmin se reconoce por `es_sistema` y el acceso por `permisos`, así que renombrar un rol no cambia ningún acceso. `src/lib/roles.ts` sigue mostrando legibles los nombres anteriores si una base aún no tiene la migración.

| Rol | Antes | Origen |
| --- | --- | --- |
| `Super administrador` | `SuperAdmin` | Rol de sistema (`es_sistema`): todos los permisos y todas las sedes |
| `Administrador de sede` | `AdminSede` | Migración de roles |
| `Recursos humanos` | `RecursosHumanos` | Migración de roles (altas, bajas y expedientes) |
| `Seguridad` | `Almacenista de EPP` | Almacén de EPP: entrega, pide material y cuenta lo que llega (`epp.view`, `epp.deliver`, `epp.manage`, `epp.request`). Renombrado en `202611130001_compras_conteo_ciego.sql` |
| `Encargado de compras` | `EncargadoCompras` | Solo `epp.view` y `epp.purchase`: consulta y registra compras; recibe avisos de solicitudes nuevas y de faltantes |
| `Combustibles alternos` | `CombustiblesAlternos` | Migración de combustibles |
| `Operador de báscula` | `OperadorBascula` | Migración de combustibles |
| `Ecología` | `Ecologia` | Migración de combustibles |
| `Contabilidad de combustibles` | `ContabilidadCombustibles` | Migración de combustibles |
| `Cuentas por pagar` | — | Migración de facturas: `invoices.view`, `invoices.manage` |
| `Solo consulta` | — | Rol de solo consulta: ve Empleados y EPP sin poder modificar nada (`202611130003_rol_solo_consulta.sql`) |

## Separación por área

Cada rol ve solo su pantalla (`202611130006_roles_por_area.sql` deja a cada rol con los permisos de su área):

| Área | Roles |
| --- | --- |
| Empleados | Administrador de sede, Recursos humanos |
| EPP | Seguridad, Encargado de compras |
| Combustibles alternos | Combustibles alternos, Operador de báscula, Ecología, Contabilidad de combustibles |
| Facturas | Cuentas por pagar |

El Super administrador ve todo y los roles de solo consulta no se modifican. Una cuenta con varios roles ve las áreas de todos ellos.

## Roles de solo consulta

Al crear o editar un rol, **Solo consulta** limita los permisos a ver **Empleados** y/o **EPP** (no descarga expedientes ni ve combustibles o facturas). Se elige cuál de las dos áreas ve cada rol; la API y la base (`roles_solo_consulta_check`) rechazan cualquier permiso que modifique datos. Con `epp.view` también se consultan las solicitudes de compra, sin acciones.

## Reglas

- **Varios roles por cuenta**: los permisos son la suma de todos; el primero marcado es el rol principal (`authorized_users.role_id`). Requiere `202611080001_varios_roles.sql`.
- **Sede**: cada cuenta puede tener una sede asignada (`Campeche`, `Lagunas`, `Cruz Azul`, `El Carmen`). Con sede, solo ve y mueve el inventario de esa sede; sin sede (*Todas las sedes*) y el SuperAdmin eligen la sede en pantalla.
- **Pantalla de inicio**: si la cuenta abre una pantalla sin permiso, la app la lleva a la primera pantalla del menú que sí puede usar.
- **Protecciones**: no puedes borrar ni desactivar tu cuenta y siempre queda un SuperAdmin activo.
- Un permiso nuevo agregado en `permissions.ts` aparece solo en el editor de roles.
