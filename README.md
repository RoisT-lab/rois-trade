# ROIS notification email

Edge Function para procesar correos individuales y comunicados colectivos creados desde Admin > Notificaciones.

## Antes de desplegar

1. Ejecuta `supabase-broadcast-notifications.sql` en Supabase SQL Editor.
2. Crea y verifica el dominio remitente en Resend.
3. Agrega estos secretos en Supabase Edge Functions:

```text
RESEND_API_KEY=re_...
ROIS_EMAIL_FROM=ROIS <notificaciones@tudominio.com>
ROIS_APP_URL=https://roistrade.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son secretos predeterminados de Supabase. No deben copiarse al frontend.

## Despliegue

Nombre exacto de la funcion:

```text
send-rois-notification-email
```

Mantener activa la validacion JWT. La funcion vuelve a validar que el usuario autenticado tenga role `admin` y status `approved` antes de leer la cola.
