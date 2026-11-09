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
| `epp.manage` | Administrar catálogo, ingresos y ajustes |
| `epp.request` | Solicitar compra cuando falta material |
| `epp.purchase` | Atender solicitudes de compra (encargado de compras) |
| `fuels.view` | Ver combustibles alternos y semáforo SEMARNAT |
| `fuels.suppliers` | Homologar proveedores (M1) |
| `fuels.schedule` | Programar recepciones (M2) |
| `fuels.scale` | Operar báscula y manifiestos (M3) |
| `fuels.commercial` | Tarifas y reportes contables (M4) |
| `fuels.ecology` | Capturar consumo de coque y reporte SEMARNAT (M5) |
| `users.manage` | Administrar usuarios y roles |

## Roles

La base guarda nombres técnicos y la app los muestra legibles (`src/lib/roles.ts`). **No renombres un rol en la base**: las migraciones lo buscan por ese nombre. Para cambiar cómo se ve, agrégalo en `roles.ts`.

| Rol (técnico) | En pantalla | Origen |
| --- | --- | --- |
| `SuperAdmin` | Super administrador | Rol de sistema (`es_sistema`): todos los permisos y todas las sedes |
| `AdminSede` | Administrador de sede | Migración de roles |
| `RecursosHumanos` | Recursos humanos | Migración de roles (altas, bajas y expedientes) |
| `AlmacenistaEPP` | Almacenista de EPP | Permisos de inventario: `epp.view`, `epp.deliver`, `epp.manage`, `epp.request` |
| `EncargadoCompras` | Encargado de compras | Migración de EPP por sede; recibe el aviso de solicitudes nuevas |
| `CombustiblesAlternos` | Combustibles alternos | Migración de combustibles |
| `OperadorBascula` | Operador de báscula | Migración de combustibles |
| `Ecologia` | Ecología | Migración de combustibles |
| `ContabilidadCombustibles` | Contabilidad de combustibles | Migración de combustibles |

## Reglas

- **Varios roles por cuenta**: los permisos son la suma de todos; el primero marcado es el rol principal (`authorized_users.role_id`). Requiere `202611080001_varios_roles.sql`.
- **Sede**: cada cuenta puede tener una sede asignada (`Campeche`, `Lagunas`, `Cruz Azul`). Con sede, solo ve y mueve el inventario de esa sede; sin sede (*Todas las sedes*) y el SuperAdmin eligen la sede en pantalla.
- **Pantalla de inicio**: si la cuenta abre una pantalla sin permiso, la app la lleva a la primera pantalla del menú que sí puede usar.
- **Protecciones**: no puedes borrar ni desactivar tu cuenta y siempre queda un SuperAdmin activo.
- Un permiso nuevo agregado en `permissions.ts` aparece solo en el editor de roles.
