# ROIS MVP privado

App web estática lista para publicarse desde GitHub y conectarse a Supabase.

## Publicación desde GitHub

Sube estos archivos al repositorio conectado a tu dominio:

- `index.html`
- `styles.css`
- `app.js`
- `app-config.js`
- `assets/`

## Activar Supabase

1. Crea un proyecto en Supabase.
2. En Supabase, abre SQL Editor y ejecuta `supabase-schema.sql`.
3. En Authentication, crea el usuario administrador.
4. Copia el UUID del usuario admin creado en Authentication.
5. En Table Editor, inserta un registro en `profiles`:

```sql
insert into profiles (id, email, role, name, status, must_change_password)
values (
  'UUID_DEL_USUARIO_AUTH',
  'correo_admin_autorizado',
  'admin',
  'Administrador ROIS',
  'approved',
  true
);
```

6. Edita `app-config.js` con tu URL y anon key pública:

```js
window.ROIS_CONFIG = {
  demoMode: false,
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "TU_ANON_KEY",
  stripePaymentLinks: {
    eventRegistration: "https://buy.stripe.com/...",
    athleteAnnualProfile: "https://buy.stripe.com/...",
    roisPartnerMonthly: "https://buy.stripe.com/...",
    officialSponsorMonthly: "https://buy.stripe.com/...",
    roisLegacyMonthly: "https://buy.stripe.com/...",
    strategicRequest: "https://buy.stripe.com/..."
  }
};
```

La anon key puede estar en frontend si las políticas RLS están activas. Nunca publiques la service role key.

## Flujo de clientes

- Las empresas crean cuenta directa con correo y contraseña.
- El perfil de empresa queda aprobado automáticamente como cliente.
- Admin aprueba eventos, deportistas, noticias, alianzas y visuales.
- Los deportistas incluyen ficha técnica, video por URL y patrocinio anual desde $1,000 MXN.
- Admin puede habilitar o inhabilitar el fee anual de ingreso por deportista.
- Los reels publicados por deportistas aparecen directamente en el feed empresarial.
- Patrocinios ROIS: Partner $25,000 MXN mensual, Oficial $50,000 MXN mensual y Legacy $100,000 MXN mensual con exclusividad de giro por compromiso anual.
- Los pagos se activan por tipo de producto con Stripe Payment Links desde `app-config.js`.
- Si Supabase tiene confirmación por correo activa, la empresa debe confirmar su email antes de iniciar sesión.
- Admin puede enviar notificaciones a deportistas desde el panel. Se guardan en el dashboard del deportista y pueden disparar correo si `notificationEmailWebhook` esta configurado en `app-config.js`.

## Pendiente para producción completa

- Conectar Supabase Storage para imágenes.
- Conectar Supabase Storage para videos propios. Por ahora se recomienda URL de YouTube, Vimeo o archivo alojado.
- Agregar moderación automática de imágenes antes de publicar.
- Conectar `notificationEmailWebhook` a una Supabase Edge Function o proveedor transaccional para email real de notificaciones a deportistas.
- Para conciliación automática de Stripe, crear webhook o Edge Function.
- Agregar TOTP/MFA real para administradores y operaciones sensibles de clientes.
