# Módulo Facturas

Pantalla `/facturas` (menú **Finanzas → Facturas**). Requiere las migraciones de facturas hasta `202611250002_facturas_cierre_y_roles.sql`. Las facturas son nuestras: **nosotros las cobramos** (nos depositan). No carga datos de prueba.

## Permisos y rol

| Permiso | Qué permite |
| --- | --- |
| `invoices.view` | Ver la lista, los PDF (factura, contrarecibo, complemento), el texto, el historial y los resúmenes |
| `invoices.manage` | Cargar facturas, marcarlas firmadas y cargadas al sistema, subir contrarecibos y complementos de pago, y eliminar una factura mientras está enviada |

Roles (se asignan en *Usuarios y roles*): **Cuentas por cobrar** (`invoices.view` + `invoices.manage`: carga y avanza cada paso) y **Supervisión de facturas** (`invoices.view`: revisa el avance y el cierre semanal sin modificar). El rol anterior *Cuentas por pagar* conserva los mismos permisos que Cuentas por cobrar.

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
3. **Contrarecibo** (ya cargada al sistema): se sube el PDF y se captura la **fecha posible de cobro** (queda como dato del contrarecibo). Después **falta el complemento**.
4. **Complemento de pago** (con contrarecibo): se sube el PDF; se verifica que mencione el **UUID** de la factura (`complement_verified`: sí / no / no se pudo revisar) y la factura queda **cerrada** (con el complemento se da prácticamente por cobrada).

Estado en la lista: *En trámite* → *Falta contrarecibo* → *Falta complemento* → *Cerrada*. No hay estados de por cobrar, pago programado ni atrasado.

## Historial

`invoice_events` guarda cada paso con quién y cuándo: cargada, firmada, cargada al sistema, contrarecibo (archivo y fecha posible de cobro), complemento (verificado o no) y, si ocurre, que se eliminó. Lo escribe la base (trigger `invoices_log_event`), nadie lo puede modificar y se conserva aunque se elimine la factura. Se ve en la pestaña **Historial** de cada factura.

## Pantalla (una sola, con buscador)

Sin pestañas: una lista y un buscador (`src/lib/invoice-search.ts`) que entiende y combina:

| Escribes | Busca |
| --- | --- |
| `FAC-00012`, `12`, `fac12`, texto | Folio del sistema, folio del PDF, UUID, nombres de archivo o quién hizo cada paso |
| `por firmar`, `por cargar`, `falta contrarecibo`, `falta complemento`, `cerradas`, `abiertas`, `incidente` | Estado de la factura |
| `esta semana`, `semana pasada`, `este mes`, `mes pasado`, `hoy`, `ayer` | Día de carga al sistema |
| `noviembre`, `nov 2026`, `2026-11`, `11/2026` · `24/11`, `24/11/2026` · `semana 24/11` | Un mes · un día · la semana (lunes a domingo) de ese día |
| `$1,160`, `1160.00`, `>5000`, `<1000` | Total de la factura |

Ejemplo: `falta complemento semana pasada`.

Junto al buscador, el botón **Filtros** abre un menú desplegable (`filters-dropdown.tsx`) con: **estado**, **periodo rápido** (hoy, ayer, esta semana, semana pasada, este mes, mes pasado; llena el calendario), **rango de fechas con calendario** (desde / hasta), **a qué fecha aplica** (carga al sistema o fecha de la factura) y **rango de total** (mínimo / máximo). El botón muestra cuántos filtros hay activos; lo del menú y lo escrito en el buscador se combinan.

Debajo de la caja se muestra lo que se está filtrando (con *Quitar todo*) y, si hay un periodo de carga, cómo va su **cierre** (cargadas, cerradas, cuántas faltan o *periodo cerrado*). Arriba: en proceso, falta contrarecibo, falta complemento y cerradas esta semana.

La descarga (PDF / Excel) lleva las facturas de la búsqueda y su cierre por semana.

Las facturas anteriores al flujo nuevo conservan sus datos (incluido un incidente, si lo tenían, que las deja cerradas).

## API

| Método | Ruta | Permiso | Uso |
| --- | --- | --- | --- |
| GET | `/api/invoices` | `invoices.view` | Lista (sin textos); `?from=YYYY-MM-DD` por fecha de carga; las que no están cerradas siempre se incluyen |
| POST | `/api/invoices` | `invoices.manage` | Registra un PDF ya subido: `{ file_path, file_name }` |
| GET | `/api/invoices/:id` | `invoices.view` | Factura con `text_content` y `events` (historial) |
| PATCH | `/api/invoices/:id` | `invoices.manage` | `{ action: "stage", stage: "firmada" \| "cargada" }`, `{ action: "receipt", file_path: "cr-….pdf", file_name, payment_date }` o `{ action: "complement", file_path: "cp-….pdf", file_name }` |
| DELETE | `/api/invoices/:id` | `invoices.manage` | Solo enviada (o Super administrador); borra sus PDF, el historial se conserva |
