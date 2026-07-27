# ROIS CRM invitation email

Esta funcion envia invitaciones individuales desde el panel Comercial o Admin. Nunca expone `RESEND_API_KEY` en el navegador y solo acepta sesiones aprobadas con role `admin` o `commercial`.

## Despliegue

1. Ejecuta `supabase-commercial-crm-invitations.sql` en Supabase SQL Editor.
2. Verifica en Edge Function Secrets:
   - `RESEND_API_KEY`
   - `ROIS_EMAIL_FROM` con un remitente verificado, por ejemplo `ROIS <notificaciones@roistrade.com>`
   - `ROIS_APP_URL` con `https://roistrade.com`
3. Crea o despliega la funcion con el nombre exacto:
   - `send-rois-crm-invitation`
4. Conserva la validacion JWT activa. La funcion tambien verifica el usuario y su role dentro de `profiles`.

## Crear un usuario comercial

Crea primero el usuario en Supabase Authentication. Despues crea o actualiza su fila en `profiles` con el mismo correo y ejecuta:

```sql
update public.profiles
set role = 'commercial',
    status = 'approved',
    must_change_password = false
where lower(email) = lower('ejecutivo@tu-dominio.com');
```

No compartas `SUPABASE_SERVICE_ROLE_KEY` ni `RESEND_API_KEY` con el frontend.
