# Notificaciones e incidencias

## Notificaciones

La campana de la barra superior abre un panel con lo más urgente; **Ver todas** lleva a `/notificaciones`. Los avisos **no se guardan**: se calculan con los datos reales (`/api/notifications`), así que desaparecen al corregir el problema. Tipos y reglas en `src/lib/notifications.ts`.

| Gravedad | Aviso | Condición |
| --- | --- | --- |
| Grave | Sin existencias | Artículo activo de EPP con existencia en cero |
| Importante | Stock bajo | Existencia igual o menor que `min_stock` |
| Importante | Expediente incompleto | Empleado activo sin NSS, CURP, RFC, cuenta bancaria o salario |
| Menor importancia | Compra anticipada | Existencia hasta 1.5 veces `min_stock` |
| Menor importancia | Datos de contacto | Empleado activo sin correo o teléfono |
| — | Solicitud de compra | Solicitudes nuevas (solo `EncargadoCompras`) |
| — | Semáforo SEMARNAT / permisos | Amarillo o rojo; permisos por vencer o vencidos |

- **Descartar** oculta un aviso 24 horas (`SNOOZE_MS`); si el problema sigue, vuelve a mostrarse, y si un artículo empeora avisa de inmediato. Lo descartado se guarda en el navegador de cada cuenta.
- Avisos de expedientes: requieren `employees.view`. De inventario: `epp.view`. De combustibles: `fuels.view`.
- La respuesta indica el estado de cada fuente (`ok`, `no_permission`, `unavailable`).
- Para agregar un aviso: define su tipo y regla en `src/lib/notifications.ts` y léelo en `src/app/api/notifications/route.ts`.

## Incidencias por correo

Los errores del servidor (base de datos, API) y del navegador (red caída, error de JavaScript) se envían por correo con [Resend](https://resend.com).

**Configuración**

1. Crea una cuenta en Resend y genera una API key.
2. Defínela como `RESEND_API_KEY` (`.env.local` y panel del proveedor; solo servidor).
3. Opcional: `INCIDENT_EMAIL_TO` e `INCIDENT_EMAIL_FROM`. Con el remitente por defecto (`onboarding@resend.dev`) Resend solo entrega al correo de la cuenta; para otro destino verifica un dominio propio.

**Control de spam y privacidad**

- El mismo error se envía una vez cada 10 minutos, con máximo de 20 correos por hora.
- Se eliminan correos, tokens y números largos (NSS, CLABE, CURP, RFC) antes de enviar.
- Los errores esperados (contraseña incorrecta, datos inválidos) no generan correo.
- Sin `RESEND_API_KEY`, los errores solo se escriben en el log del servidor.

Código: `src/lib/incidents.ts` (servidor), `src/lib/report-incident.ts` (navegador) y `src/lib/email.ts`.
