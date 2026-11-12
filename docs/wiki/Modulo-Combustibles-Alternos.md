# Módulo Combustibles alternos

Pantalla `/combustibles` (menú **Ecología → Combustibles alternos**). Código en `src/features/fuels/`, API en `/api/fuels`, cálculo en `src/lib/fuels.ts`. Especificación original: `Archivos/ModuloCoque.txt`.

## Semáforo SEMARNAT

Visible sobre todas las pestañas, calculado por mes con la proyección de lo programado.

| Color | Sustitución térmica |
| --- | --- |
| Verde | hasta 25.0 % |
| Amarillo | 25.1 % a 29.9 % |
| Rojo | desde 30.0 % |

El horno tiene autorizado un máximo de **30.0 %** de sustitución con combustibles alternos.

## Memoria de cálculo

```
Energía alternos (Gcal) = Σ [ neto (t) × poder calorífico (cal/g) ] / 1000
Energía coque (Gcal)    = [ coque (t) × 7500 ] / 1000
% sustitución           = alternos / (alternos + coque) × 100
```

Se implementa en `src/lib/fuels.ts` (pantalla y reportes) y en `fuel_month_summary_raw()` (la base, que es la que bloquea).

## Pestañas

| Pestaña | Permiso | Qué hace | Candados (los exige la base) |
| --- | --- | --- | --- |
| **M1 · Proveedores** | `fuels.suppliers` | Alta y homologación (*Datos corporativos* y *Parámetros de calidad* por producto), adjuntar permiso PDF, ficha de proveedor autorizado en PDF o Excel | No guarda si cal/g < 5,000, cloro > 1.80 %, agua > 12.0 % o azufre > 1.0 %. Permiso vencido → *Rechazado*. Aviso 30 días antes del vencimiento |
| **M2 · Programación** | `fuels.schedule` | Agenda por día o próximas; descarga de la agenda de recepción para báscula | Solo proveedores aprobados con permiso vigente en la fecha y productos activos. **Bloqueo predictivo** si el mes llegaría al 30 % |
| **M3 · Báscula** | `fuels.scale` | Entrada (bruto) con bloques Generador, Transportista y Vehículo; salida (tara); certificado PDF; bitácora del día | Solo unidades de la agenda. Folio de manifiesto único por ticket. Al capturar la tara el neto se calcula y el ticket se **cierra de forma irreversible** |
| **M4 · Comercial** | `fuels.commercial` | Esquema (Cobro / Pago / Valor 0) y tarifa por tonelada; reportes diario, quincenal y mensual por producto y generador (PDF o Excel) | Subtotal = neto (t) × tarifa, sin IVA. La tarifa se congela en el ticket al cerrarlo |
| **M5 · Ecología** | `fuels.ecology` | Consumo mensual de coque, memoria de cálculo por mes y reporte semestral SEMARNAT (COA) | El reporte oficial usa solo el coque capturado de cada mes; la proyección diaria usa el último capturado si falta |

## Cloro por embarque y corrección cruzada

- El cloro de cada carga se captura una sola vez, al cerrar la tara o después.
- Si pasa de 1.80 %, el proveedor tiene **2 días** para enviar un embarque de compensación con 1.80 % o menos; al cerrarlo se elige *Compensa el embarque* y se muestra el promedio ponderado.
- Corregido = sin penalización; si vence el plazo queda *penalizado*.
- Solo **una corrección cruzada por proveedor al mes**.

## Avisos

- Semáforo amarillo o rojo, y permisos por vencer o vencidos, aparecen en la campana.
- La primera vez en el mes que el semáforo pasa a amarillo y a rojo se envía un correo a Ecología (`ECOLOGY_EMAIL_TO` + `RESEND_API_KEY`); `fuel_claim_alert` evita duplicados.

## Roles sugeridos

`CombustiblesAlternos`, `OperadorBascula`, `Ecologia` y `ContabilidadCombustibles` (los crea la migración `202611100001_combustibles_alternos.sql`).

## Almacenamiento

Bucket privado `fuel-permits` (PDF de hasta 10 MB).
