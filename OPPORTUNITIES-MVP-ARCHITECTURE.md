# ROIS Opportunities MVP

## Decision de producto

ROIS evoluciona primero como un mercado gestionado de oportunidades. No se convierte todavia en una red social generica ni en una plataforma completa de comercio electronico.

Propuesta:

> ROIS conecta personas con oportunidades y a empresas con distribucion, talento e inteligencia de mercado.

El perfil de Creador existente funciona como cuenta universal para publico general. Athlete conserva su recorrido especializado. Founder y Creator legacy se mantienen y se proyectan a `user_profiles` mediante distintivos y capacidades.

## Auditoria del sistema reutilizado

- Frontend estatico: `index.html`, `styles.css` y `app.js`.
- Autenticacion y datos: Supabase Auth, PostgREST, RLS y Storage.
- Sesiones y roles existentes: admin, empresa, athlete, founder/creator y scout.
- Modulos reutilizados: perfiles, empresas, eventos, notificaciones, CRM, Sponsor Deck, medios y panel administrativo.
- Estrategia: capa aditiva sobre el modelo existente; no reemplazo destructivo.

## Flujo MVP

1. La persona completa su perfil universal y capacidades.
2. La empresa solicita verificacion.
3. Admin aprueba o rechaza la verificacion.
4. La empresa crea una oportunidad en revision.
5. Admin modera y publica.
6. La persona consulta condiciones y selecciona los datos que autoriza compartir.
7. La empresa verificada revisa exclusivamente ese snapshot autorizado.
8. La empresa acepta o rechaza.
9. ROIS registra participacion, conversion, comision y pago sujeto a validacion.
10. Admin conserva auditoria y resolucion de disputas.

## Modelo de datos

La migracion `supabase-opportunities-marketplace-v1.sql` agrega:

- `user_profiles` y `user_social_accounts`
- `company_verifications` y `company_plan_definitions`
- `opportunities` y `opportunity_applications`
- `application_consents` y `participations`
- `tracking_links`, `referral_codes` y `conversions`
- `commissions`, `reviews` y `disputes`
- `privacy_consents`, `data_subject_requests` y `data_access_logs`
- `analytics_events`

Todos los registros operativos incluyen timestamps y estados. La migracion no borra tablas legacy.

## Seguridad y privacidad

- Solo empresas verificadas pueden revisar postulaciones autorizadas.
- La empresa recibe un snapshot limitado a los campos consentidos.
- La persona no puede autoaprobar su postulacion.
- La empresa solo administra oportunidades propias y no puede publicarlas sin Admin.
- Los eventos analiticos se vinculan a la persona o empresa autenticada.
- No existe exportacion masiva de personas.
- Inteligencia usa agregados; el umbral minimo debe configurarse antes de habilitar reportes de segmentos.
- No se usa `service_role` en frontend.

## Plan de migracion

### Etapa 1

- Ejecutar migracion aditiva.
- Backfill de `user_profiles` desde Creator/Founder/Athlete.
- Validar conteos y correos sin alterar fuentes legacy.

### Etapa 2

- Habilitar oportunidades a un grupo de empresas verificadas.
- Revisar manualmente cada oportunidad y comision.
- Medir registro, perfil completado, vistas y postulaciones.

### Etapa 3

- Activar conversiones y conciliacion operativa.
- Integrar pagos solo despues de validacion juridica, fiscal y antifraude.
- Habilitar inteligencia cuando existan segmentos suficientes.

## Riesgos y dependencias

- RLS: probar cada rol antes de produccion.
- Calidad de perfiles legacy: correos o `profile_id` inconsistentes requieren diagnostico, no reparacion silenciosa.
- Fraude y atribucion: conversiones manuales requieren evidencia y validacion.
- Menores: permanecen fuera del mercado general y bajo su flujo de tutor.
- Privacidad: definir textos juridicos, retencion y procedimiento ARCO antes del lanzamiento amplio.
- Escala: agregar paginacion y RPC de agregacion antes de miles de registros.

## Variables y servicios

No se agregan secretos nuevos al navegador. Se conservan:

- URL publica de Supabase.
- Anon/publishable key de Supabase.
- Configuracion existente de Storage y Edge Functions.

Nunca incluir `service_role` ni credenciales privadas en `app.js`.

## Pruebas de aceptacion

1. Creador nuevo crea perfil universal y selecciona varias capacidades.
2. Athlete existente conserva su ficha y consulta oportunidades.
3. Empresa no verificada no accede a postulantes.
4. Empresa aprobada crea una oportunidad en revision.
5. Admin publica o rechaza la oportunidad.
6. Persona autoriza campos y se postula.
7. Empresa ve solo los campos autorizados.
8. Persona no puede cambiar su estado a aceptada.
9. Empresa acepta y se crea una participacion.
10. Admin registra y actualiza una comision.
11. Usuario consulta saldo pendiente, aprobado y pagado.
12. Disputa y solicitud de privacidad son visibles para Admin.
13. Perfiles, eventos, Sponsor Deck y Scouts legacy siguen operando.

## Limitaciones deliberadas

- Sin pagos reales ni ingresos garantizados.
- Sin inventario alojado dentro de ROIS.
- Sin captacion de capital, credito o inversiones.
- Sin publicacion automatica de oportunidades.
- Sin acceso empresarial a datos individuales fuera de una postulacion consentida.
