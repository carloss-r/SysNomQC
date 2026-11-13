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

## Solicitudes de compra y conteo ciego

1. **Seguridad** (almacén) pide material: en el inventario, lo agotado o bajo el mínimo muestra **Pedir más**; **Pedir faltantes** junta todo en una solicitud. Un artículo con una solicitud abierta no se puede volver a pedir.
2. **Compras** recibe el aviso y en **EPP → Solicitudes** usa **Registrar compra** para capturar cuánto compró de cada artículo. La solicitud pasa a *Comprada · por contar*. Esa cantidad solo la ven las cuentas con `epp.purchase` (tabla `epp_purchase_buys`); puede corregirla mientras nadie haya contado.
3. Mientras un artículo de una compra no se cuente, en esa sede **no se puede entregar, ingresar ni ajustar** (lo bloquea `epp_apply_site()` en la base). En el inventario aparece *Por contar · folio N*.
4. Seguridad usa **Contar lo que llegó**: captura lo que contó **sin ver lo comprado**. Se puede contar por artículo; cada conteo suma la existencia (movimiento de ingreso) y libera el artículo. Un conteo guardado no se cambia. Contado todo, la solicitud queda *Recibida*.
5. Si se contó menos de lo comprado, Compras recibe el aviso **Llegó menos de lo comprado** (campana y aviso emergente) hasta que pulsa **Enterado del faltante**.
6. Cancelar: lo pendiente lo cancela Compras o quien pidió; una compra registrada sin conteos, solo el Super administrador.
7. PDF de una solicitud o de todas las abiertas, con resumen por artículo.

Estados: `pendiente` → `en_compra` (comprada, por contar) → `recibida` (o `cancelada`).

## Permisos

`epp.view`, `epp.deliver`, `epp.manage`, `epp.request` y `epp.purchase` (ver [Roles y permisos](Roles-y-permisos)).

## Migraciones

`202611060001_epp.sql`, `202611060002_epp_historial.sql`, `202611070001_epp_por_sede.sql`, `202611090001_epp_controles.sql` y `202611130001_compras_conteo_ciego.sql`.
