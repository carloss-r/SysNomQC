# Módulo Facturas

Pantalla `/facturas` (menú **Finanzas → Facturas**). Requiere las migraciones de facturas hasta `202611240002_facturas_flujo_pago.sql`. No carga datos de prueba.

## Permisos y rol

| Permiso | Qué permite |
| --- | --- |
| `invoices.view` | Ver la lista, los PDF (factura, contrarecibo, complemento), el texto, el historial y los resúmenes |
| `invoices.manage` | Cargar facturas, marcarlas firmadas y cargadas al sistema, subir contrarecibos y complementos de pago, y eliminar una factura mientras está enviada |

Rol sugerido: **Cuentas por pagar** (se ajusta en *Usuarios y roles*).

## Regla principal: lo cargado no se modifica

La factura se carga del PDF y **así se queda**: no hay edición de datos. La base lo garantiza con el trigger `invoices_guard` (solo deja escribir los pasos del flujo, cada uno una sola vez y en orden). Si se subió el PDF equivocado, se elimina **antes de firmarla** y se vuelve a cargar; después solo el Super administrador puede eliminarla.

- **Folio**: lo pone la base al cargarla, consecutivo (`FAC-00001`, trigger `invoices_assign_folio`). El folio que trae el PDF se guarda aparte (`pdf_folio`).
- **Moneda**: siempre nacional (MXN). Ya no se captura emisor ni moneda.

## Flujo

1. **Cargar factura**: el navegador sube el PDF (máx. 10 MB) al bucket privado `invoices`; el servidor lo digitaliza con `unpdf` y detecta fecha, vencimiento, folio del PDF, UUID, subtotal, IVA y total (`parseInvoiceText`). Queda **enviada**.
2. Los **tres cuadritos** del documento (rojo = pendiente, verde = hecho):
   1. **Enviada**: al cargarla.
   2. **Firmada / autorizada**: botón *Firmada*.
   3. **Cargada al sistema**: botón *Cargada al sistema*.
3. **Contrarecibo** (ya cargada al sistema): se sube el PDF y se captura la **fecha posible de pago**.
4. **Complemento de pago** (con contrarecibo): se sube el PDF; se verifica que mencione el **UUID** de la factura (`complement_verified`: sí / no / no se pudo revisar) y la factura queda **pagada y cerrada**.

Estado del pago en la lista: *En trámite* → *Falta contrarecibo* → *Pago dd/mm/aaaa* (o *Pago atrasado* si ya pasó la fecha sin complemento) → *Pagada*.

## Historial

`invoice_events` guarda cada paso con quién y cuándo: cargada, firmada, cargada al sistema, contrarecibo (archivo y fecha de pago), complemento (verificado o no) y, si ocurre, que se eliminó. Lo escribe la base (trigger `invoices_log_event`), nadie lo puede modificar y se conserva aunque se elimine la factura. Se ve en la pestaña **Historial** de cada factura.

## Resúmenes

- **Encabezado**: en proceso, falta contrarecibo, pagos programados esta semana, pagos atrasados y pagadas en el mes, más el monto por pagar.
- **Por semana** (lunes a domingo) y **Por mes**: facturas **cargadas** en el periodo (por día de carga) con su avance (firmadas, al sistema, con contrarecibo, pagadas) y lo que falta por pagar, y los **pagos programados** del periodo (por fecha posible de pago) con cuánto ya se pagó y cuántos están atrasados. Al hacer clic en un periodo se abre la lista de esas facturas.
- La lista y los resúmenes se descargan en PDF o Excel.

Las facturas anteriores al flujo nuevo conservan sus datos (incluido un incidente, si lo tenían, que las deja cerradas).

## API

| Método | Ruta | Permiso | Uso |
| --- | --- | --- | --- |
| GET | `/api/invoices` | `invoices.view` | Lista (sin textos); `?from=YYYY-MM-DD` por fecha de carga; las que no están pagadas siempre se incluyen |
| POST | `/api/invoices` | `invoices.manage` | Registra un PDF ya subido: `{ file_path, file_name }` |
| GET | `/api/invoices/:id` | `invoices.view` | Factura con `text_content` y `events` (historial) |
| PATCH | `/api/invoices/:id` | `invoices.manage` | `{ action: "stage", stage: "firmada" \| "cargada" }`, `{ action: "receipt", file_path: "cr-….pdf", file_name, payment_date }` o `{ action: "complement", file_path: "cp-….pdf", file_name }` |
| DELETE | `/api/invoices/:id` | `invoices.manage` | Solo enviada (o Super administrador); borra sus PDF, el historial se conserva |
