# Módulo Facturas

Pantalla `/facturas` (menú **Finanzas → Facturas**). Requiere la migración `202611110002_facturas.sql` (después de `202611110001_normalizar_roles.sql`). No carga datos de prueba.

## Permisos y rol

| Permiso | Qué permite |
| --- | --- |
| `invoices.view` | Ver la lista, el PDF, el texto digitalizado y los resúmenes |
| `invoices.manage` | Cargar facturas, corregir sus datos, marcarlas pagadas o pendientes y eliminarlas |

La migración crea el rol sugerido **Cuentas por pagar** con ambos permisos (se ajusta en *Usuarios y roles*).

## Flujo

1. **Cargar factura**: el navegador sube el PDF (máx. 10 MB) al bucket privado `invoices` y llama a `POST /api/invoices`.
2. El servidor descarga el PDF, lo **digitaliza** con `unpdf` (texto por página, guardado en `invoices.text_content`) y detecta fecha de emisión, vencimiento, folio, UUID, emisor, RFC, subtotal, IVA, total y moneda (`parseInvoiceText` en `src/lib/invoices.ts`; reconoce CFDI del SAT y formatos comerciales comunes).
3. La factura se guarda **siempre como pendiente de pago** (lo exige también la política RLS de inserción). Se abre la ventana de revisión para corregir lo que no se haya detectado.
4. **Repaso**: al cargarla (y con **Repasar** en la lista) se abre el PDF original junto a los datos capturados para compararlos y corregir lo que no coincida. Cada corrección se guarda en `invoice_edits` con quién la hizo, cuándo y el valor anterior y nuevo de cada dato (pestaña **Correcciones**). Requiere `202611110003_facturas_ediciones.sql`.
5. **Marcar pagada** pide la fecha de pago (no futura) y guarda quién la marcó; **Pendiente** la regresa.

Un PDF escaneado como imagen no trae texto: queda marcado como *PDF sin texto* y los datos se capturan a mano (no hay OCR).

## Resúmenes

- **Encabezado**: pendientes, vencidas (pendientes con vencimiento anterior a hoy), facturas y pagadas del mes, monto por pagar y lo facturado en la semana.
- **Resumen semanal** (lunes a domingo) y **Resumen mensual**, por fecha de la factura: número de facturas, total, pagado, pendiente y vencidas. Los montos se suman por moneda.
- La lista y los resúmenes se descargan en PDF o Excel.

## API

| Método | Ruta | Permiso | Uso |
| --- | --- | --- | --- |
| GET | `/api/invoices` | `invoices.view` | Lista (sin texto); `?from=YYYY-MM-DD`, las pendientes siempre se incluyen |
| POST | `/api/invoices` | `invoices.manage` | Registra un PDF ya subido: `{ file_path, file_name }` |
| GET | `/api/invoices/:id` | `invoices.view` | Factura con `text_content` |
| PATCH | `/api/invoices/:id` | `invoices.manage` | `{ action: "edit", ... }` o `{ action: "status", status, paid_on }` |
| DELETE | `/api/invoices/:id` | `invoices.manage` | Elimina la factura y su PDF |
