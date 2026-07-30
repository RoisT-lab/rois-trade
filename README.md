# ROIS commercial, Scout and Admin invitation email

Esta funcion envia invitaciones individuales desde el panel Comercial, Scout o Admin. Nunca expone `RESEND_API_KEY` en el navegador.

- Comercial y Admin pueden invitar empresas, creadores y deportistas.
- Scout solo puede invitar creadores y deportistas registrados por su propia cuenta y con su codigo personal.
- La funcion rechaza prospectos de empresa y codigos ajenos cuando la sesion pertenece a un Scout.
- Una invitacion empresarial crea un beneficio por correo: cinco meses de acceso Business sin costo, tarjeta ni renovacion automatica.
- El beneficio comienza cuando la empresa crea su cuenta con el mismo correo. Si la empresa ya existe, se aplica de inmediato.
- Una suscripcion pagada activa nunca se reemplaza ni se acorta.

## Despliegue

1. Ejecuta `supabase-external-scout-network.sql` si aun no existe la red Scout.
2. Ejecuta `supabase-company-marketplace-pro-business.sql` si aun no existe el mercado corporativo.
3. Ejecuta `supabase-company-advanced-access-5-months.sql`.
4. Verifica en Edge Function Secrets:
   - `RESEND_API_KEY`
   - `ROIS_EMAIL_FROM` con un remitente verificado, por ejemplo `ROIS <notificaciones@roistrade.com>`
   - `ROIS_APP_URL` con `https://roistrade.com`
5. Crea o vuelve a desplegar la funcion con el nombre exacto:
   - `send-rois-crm-invitation`
6. Conserva la validacion JWT activa. La funcion tambien verifica el usuario y su role dentro de `profiles`.

## Alta de Scouts

Los Scouts crean su cuenta desde el acceso publico `Scouts`. El registro genera su perfil, su fila en `scouts` y su codigo personal mediante `register_external_scout`.

No compartas `SUPABASE_SERVICE_ROLE_KEY` ni `RESEND_API_KEY` con el frontend.
