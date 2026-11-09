# Módulo EPP

Equipo de protección personal. Pantalla `/epp` (menú **Seguridad e higiene → EPP**). Código en `src/features/epp/` y API en `/api/epp`.

## Pestañas y acciones

| Función | Descripción |
| --- | --- |
| **Entregar EPP** | Busca al trabajador, agrega uno o varios artículos y confirma; descuenta existencia y guarda quién entregó y cuándo |
| **Ingreso de material** y **Ajuste** | El ajuste es un conteo físico con motivo obligatorio |
| **Nuevo artículo** / edición | Catálogo común a todas las sedes |
| **Por trabajador** | Todo el EPP recibido: resumen por artículo, control diario del mes, detalle con quién registró; descarga en CSV |
| **Control mensual** | Entregas, ingresos y ajustes del mes por artículo y por trabajador, con reporte descargable |
| **Historial** | Todos los movimientos con fecha, trabajador, quién los registró y notas |
| **Solicitudes** | Solicitudes de compra y su estado |

## Reglas de negocio

- La existencia solo cambia con la función `epp_apply_site()` (transacción atómica; valida permiso, sede y existencia).
- Los movimientos **no se pueden editar ni borrar**.
- **Inventario por sede**: el catálogo es común; existencia y mínimo son de cada sede (`epp_stock`). Una cuenta con sede asignada solo opera su sede (la base lo impone aunque se llame directo a Supabase).
- La existencia previa a la migración por sede pasó completa a **Campeche**; Lagunas y Cruz Azul cargan la suya con **Ingreso** o **Ajuste**.

## Solicitudes de compra

1. En el inventario, lo agotado o bajo el mínimo muestra **Pedir más**; **Pedir faltantes** junta todo en una solicitud con cantidad sugerida (hasta el doble del mínimo).
2. Un artículo con una solicitud abierta no se puede volver a pedir hasta que se cierre.
3. El `EncargadoCompras` recibe el aviso especial (campana morada y aviso emergente) y desde **EPP → Solicitudes** las marca *En compra*, *Recibida* o *Cancelada*.
4. Puede descargar el **PDF** de una solicitud o de todas las abiertas, con resumen por artículo para una sola compra.
5. **Registrar llegada** abre el ingreso con los artículos ya capturados; al guardarlo la solicitud queda *Recibida*.
6. Una cuenta de compras con sede solo ve las solicitudes de su sede; con *Todas las sedes* ve todas.

Estados: `pendiente` → `en_compra` → `recibida` (o `cancelada`).

## Permisos

`epp.view`, `epp.deliver`, `epp.manage`, `epp.request` y `epp.purchase` (ver [Roles y permisos](Roles-y-permisos)).

## Migraciones

`202611060001_epp.sql`, `202611060002_epp_historial.sql`, `202611070001_epp_por_sede.sql` y `202611090001_epp_controles.sql`.
