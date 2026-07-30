# ROIS

## Red Scout universal

La red Scout utiliza un codigo permanente por perfil universal. Las empresas
publican misiones dentro de sus oportunidades y administran participantes,
prospectos, resultados y comisiones sin crear codigos nuevos.

Consulta [SCOUT-MISSIONS-NETWORK.md](./SCOUT-MISSIONS-NETWORK.md) para instalar y
validar la integracion.

Aplicacion web estatica conectada a Supabase para empresas, athletes, creadores y administracion. La compatibilidad tecnica de creadores conserva el role `founder` y la tabla `founders`.

## Compatibilidad Scout legacy

El role independiente `scout` y su CRM anterior se conservan unicamente para
cuentas legacy. No forman parte del flujo principal de crecimiento nuevo y las
empresas no crean ni asignan codigos desde ese panel.

La arquitectura vigente utiliza el codigo permanente del perfil universal:
cualquier usuario registrado puede vincularlo voluntariamente con una mision
publicada por una empresa. El CRM empresarial `Red Scout` administra esas
vinculaciones, prospectos, resultados y comisiones. Consulta
`SCOUT-MISSIONS-NETWORK.md` para el flujo actual.

## Acceso empresarial avanzado por invitacion

Las empresas invitadas desde el CRM interno reciben cinco meses de acceso Business sin costo, tarjeta ni renovacion automatica. El beneficio se vincula al correo del prospecto y comienza cuando la empresa crea su cuenta con ese mismo correo. Si la cuenta ya existe, se activa al procesar la invitacion. Una suscripcion pagada activa se conserva sin cambios.

Ejecuta `supabase-company-advanced-access-5-months.sql` despues de `supabase-company-marketplace-pro-business.sql` y vuelve a desplegar `supabase/functions/send-rois-crm-invitation`. La migracion crea el registro auditable `company_access_grants`, activa el periodo automaticamente y deja la fecha final en `company_subscriptions.current_period_end`.

La migracion anterior de Scouts externos se conserva solo para compatibilidad
con cuentas existentes. Ya no se crean cuentas Scout independientes: toda
persona se registra con el perfil universal y recibe un codigo global que puede
usar voluntariamente en las misiones publicadas por empresas.

La comision Scout es un pago unico de $500 MXN por cada deportista o creador que complete su activacion y sea validado por ROIS. No es una comision mensual. El estado `pending` no genera pago, `approved` identifica una comision por liquidar y `paid` confirma que ese referido ya fue pagado y no puede volver a generar la misma comision. Ejecuta una vez `supabase-scout-one-time-commission.sql` para documentar esta regla e indexar la cola de pagos sin modificar referidos existentes.

## Control ejecutivo Admin

Admin abre en `Control`, una radiografia del negocio organizada por adquisicion, activacion, propagacion Scout, demanda comercial, monetizacion y alertas operativas. Las vistas detalladas existentes siguen disponibles y el control enlaza directamente a cada cola de trabajo.

Ejecuta una vez `supabase-admin-growth-control.sql` en Supabase SQL Editor. La migracion agrega indices y la funcion de solo lectura `admin_growth_snapshot()`, protegida para cuentas con role `admin`. La funcion calcula metricas globales en PostgreSQL y devuelve un solo objeto, evitando descargar miles de filas para construir indicadores. Si aun no se ha ejecutado, la interfaz usa temporalmente los registros paginados cargados en el navegador y lo identifica como vista parcial.

## Comunicados colectivos y correo

Admin > Notificaciones permite enviar alertas a un perfil, todos los atletas, todos los creadores o todo el talento. Cada destinatario recibe un registro individual en su dashboard; los correos se procesan mediante una cola para que un fallo del proveedor no cancele la alerta interna ni exponga listas de destinatarios.

Ejecuta `supabase-broadcast-notifications.sql` y despliega la funcion `supabase/functions/send-rois-notification-email`. La configuracion de secretos y del remitente esta documentada en `supabase/functions/send-rois-notification-email/README.md`.

## Sponsor Deck ROIS y ROIS IA

Athletes y creadores cuentan con un constructor de Sponsor Deck dentro de su dashboard. El deck guarda narrativa, audiencia, evidencia, afinidad con marcas, entregables, beneficios y puntuacion de completitud en su registro real. Las empresas pueden abrirlo desde Mercado de fichajes, Creadores o el perfil completo.

El Sponsor Deck ROIS es la unica propuesta comercial activa. Los dashboards ya no permiten cargar ni descargar propuestas PDF externas ni imprimir el deck. Los PDF historicos y sus metadatos se conservan para auditoria y migracion, pero no se muestran ni se modifican desde la aplicacion.

Cada deck usa un solo ticket mensual por patrocinador, permite un maximo de 10 sponsors y presenta beneficios verificables en lugar de paquetes escalonados. Athlete y Creador pueden agregar dos imagenes comerciales para calendario, competiciones, eventos o evidencia; estos medios se guardan en `profile-media/{role}/{profile_id}/sponsor-deck/` y sus metadatos viven dentro del JSON del deck.

Ejecuta primero `supabase-sponsor-deck-ai-mvp.sql`. El modulo usa actualmente el generador guiado local, sin consumo de API. ROIS IA queda preparada como una mejora futura y se activa con `ROIS_CONFIG.roisIAEnabled: true` cuando exista presupuesto API. La Edge Function opcional permanece en `supabase/functions/generate-sponsor-deck`; nunca coloques `OPENAI_API_KEY` en archivos del frontend.

## Creator Marketplace

Ejecuta `supabase-creators-marketplace-evolution.sql` despues de las migraciones base de perfiles. Es aditiva y conserva todos los founders existentes, que se clasifican inicialmente como `creator_type = founder`.

La vertical visible **Creadores** admite artistas, influencers, musicos, actores, modelos, streamers, comunicadores y founders. Registra categoria de contenido, plataforma principal, audiencia, engagement, mercado de audiencia, afinidad con marcas, colaboraciones, entregables y disponibilidad comercial. Empresas y Admin reciben estas metricas sin mezclar los registros con `athletes`.

## Despliegue de esta actualizacion

Sube estos archivos:

- `app.js`
- `index.html`
- `supabase-schema.sql`
- `supabase-profile-persistence-storage.sql`
- `supabase-creators-marketplace-evolution.sql`
- `supabase-company-marketplace-pro-business.sql`
- `supabase-company-advanced-access-5-months.sql`
- `supabase-sponsor-deck-ai-mvp.sql`
- `supabase-broadcast-notifications.sql`
- `supabase-commercial-crm-invitations.sql`
- `supabase-external-scout-network.sql`
- `supabase/functions/generate-sponsor-deck/index.ts`
- `supabase/functions/send-rois-notification-email/index.ts`
- `supabase/functions/send-rois-notification-email/README.md`
- `supabase/functions/send-rois-crm-invitation/index.ts`
- `supabase/functions/send-rois-crm-invitation/README.md`
- `SPONSOR-DECK-AI-SETUP.md`
- `PROFILE-PERSISTENCE-VALIDATION.md`
- `README.md`

No es necesario modificar `app-config.js`, Stripe ni assets.

## Mercado Corporativo PRO / Business

La ampliacion empresarial es aditiva y no reutiliza `partnerships` como inventario masivo. Antes de habilitarla, ejecuta una vez:

```text
supabase-company-marketplace-pro-business.sql
```

La migracion crea:

- `company_subscriptions`: fuente de verdad de Free, PRO y Business;
- `company_listings`: productos, servicios, activos y oportunidades;
- `company_listing_media`: metadatos de archivos almacenados fuera de Postgres;
- `marketplace_leads`: solicitudes entre empresa compradora y oferente;
- bucket publico `company-media` con escrituras restringidas a la empresa propietaria;
- indices para feeds, empresa, categoria, fechas, leads y vigencias;
- RLS para propiedad, lectura aprobada y moderacion administrativa;
- vinculacion `profile_id` en empresas y propiedad `company_id` en eventos.

Planes iniciales configurados en frontend y aplicados por suscripcion:

| Plan | Precio de referencia | Publicaciones | Eventos / mes | Usuarios |
| --- | ---: | ---: | ---: | ---: |
| Explorador | $0 | 0 | 0 | 1 |
| PRO | $2,500 MXN + IVA / mes | 25 | 2 | 1 |
| Business | $7,500 MXN + IVA / mes | 100 | 10 | 5 |

Hasta conectar Payment Links y un webhook especifico, la solicitud de plan crea una solicitud operativa y Admin confirma la activacion. No se concede acceso PRO por una accion visual ni por un pago `pending`.

Centro VIP conserva los productos curados de `partnerships`. El Mercado Corporativo usa exclusivamente `company_listings`, por lo que puede crecer y paginarse sin mezclar contenido administrativo legacy.

Rutas de Storage corporativo:

```text
companies/{company_id}/listings/{listing_id}/{filename}
companies/{company_id}/events/{event_id}/{filename}
```

Para produccion recurrente, el siguiente paso de pagos es una Supabase Edge Function que reciba webhooks Stripe y actualice `company_subscriptions`. Nunca se debe activar un plan confiando solo en el navegador.

## Migracion obligatoria

Antes de probar el guardado de perfiles, ejecuta una sola vez en Supabase SQL Editor:

```text
supabase-profile-persistence-storage.sql
```

La migracion:

- agrega rutas y metadatos legacy de avatar/propuesta;
- completa las columnas de medios de founders;
- crea indices por `profile_id`, `email` y `contact` legacy;
- activa RLS para founders;
- actualiza las politicas Athlete/Founder;
- crea el bucket publico `profile-media`;
- restringe escrituras de Storage a `role/profile_id`;
- conserva todos los registros y Base64 existentes;
- incluye consultas de diagnostico, sin reparaciones silenciosas.

Cuando Supabase muestre la advertencia de RLS, revisa el SQL y ejecutalo con RLS habilitado. No vuelvas a ejecutar todo `supabase-schema.sql` sobre produccion.

## Persistencia de perfiles

Athletes se guardan en `athletes`. Founders se guardan en `founders`.

La resolucion de una ficha real usa este orden:

1. `profile_id = auth.uid()`
2. `email = correo de sesion`
3. `contact = correo de sesion` para athletes legacy
4. creacion segura de la fila real si el rol autenticado lo permite

Los formularios nunca intentan hacer PATCH sobre perfiles virtuales.

## Supabase Storage

Bucket:

```text
profile-media
```

Rutas:

```text
athletes/{profile_id}/avatar/{filename}
athletes/{profile_id}/sponsors/{filename}
founders/{profile_id}/avatar/{filename}
founders/{profile_id}/sponsors/{filename}
```

Limites:

- avatar: JPG, PNG o WEBP, maximo 5 MB;
- logo: JPG, PNG o WEBP, maximo 3 MB;
- maximo 10 logos;
- imagenes mayores a 1600 px se reducen en el navegador.

Las tablas guardan URL, ruta, nombre y MIME. No se generan nuevos Base64 para medios de perfiles.

Los perfiles Athlete y Founder tambien pueden guardar enlaces de Instagram, TikTok, Facebook y LinkedIn. Vuelve a ejecutar la migracion incremental si esta funcionalidad se agrego despues de la primera instalacion; usa `add column if not exists` y no elimina datos.

## Rendimiento

Referencia tecnica basada en el flujo anterior y el nuevo numero de solicitudes:

| Flujo | Antes | Despues esperado |
| --- | ---: | ---: |
| Login | 3-5 minutos en casos reportados | dashboard visible en menos de 4 segundos con red normal |
| Guardar perfil | PATCH + descarga global de tablas | PATCH puntual + actualizacion local |
| Athlete inicial | carga de todas las tablas | perfil y modulos propios limitados |
| Founder inicial | carga de todas las tablas | founder y modulos propios limitados |
| Empresa inicial | carga global | empresa y catalogos publicos resumidos |
| Medios | Base64 en JSON/cache | archivo en Storage + URL en tabla |

Los tiempos reales deben medirse en produccion despues de ejecutar la migracion.

## Pruebas de aceptacion

Athlete:

- perfil real existente;
- perfil nuevo sin fila;
- perfil legacy con `contact`;
- guardado solo texto;
- cambio de nombre;
- avatar valido;
- avatar roto;
- avatar mayor a 5 MB;
- generacion y guardado del Sponsor Deck ROIS;
- maximo 10 logos.

Founder:

- founder existente;
- founder nuevo;
- founder sin fila real;
- industria, etapa, ciudad y traccion;
- avatar;
- Sponsor Deck ROIS;
- tarjeta visible para empresas.

Empresa:

- mercado de athletes;
- mercado de founders;
- apertura de perfiles;
- fallback de imagen rota.

Login:

- admin;
- empresa;
- athlete;
- founder;
- conexion lenta.

Admin:

- Estadisticas muestra el diagnostico de integridad;
- detecta filas faltantes, IDs incorrectos, correos distintos, duplicados, Base64 y datos incompletos;
- no repara datos automaticamente.

## Capturas requeridas para revision

Despues de desplegar y ejecutar la migracion, captura:

1. Athlete despues de guardar.
2. Founder despues de guardar.
3. Tarjeta Athlete actualizada.
4. Tarjeta Founder actualizada.
5. Fallback de una imagen rota.
6. Dashboard abierto despues de login a zoom 100%.

## Seguridad

- La anon key puede existir en frontend cuando RLS esta activo.
- Nunca publiques `service_role`.
- Cada Athlete/Founder solo puede modificar su propia fila.
- Storage valida que el segundo segmento de la ruta coincida con `auth.uid()`.
- Admin conserva acceso operativo mediante `is_admin()`.

## Registro Scout para Creadores

- El alta de Creadores exige un codigo Scout ROIS, igual que el alta Athlete.
- El codigo de invitacion se conserva en `founders.invited_by_scout_code`.
- Los Scouts ven en un mismo panel los Athletes y Creadores registrados con su codigo.
- Admin puede revisar el codigo de origen y validar la comision sin mezclar las tablas `athletes` y `founders`.
- Ejecuta `supabase-creators-marketplace-evolution.sql` para agregar las columnas e indice Scout de Creadores y actualizar la validacion compartida de codigos.

## Mercado gestionado de oportunidades

ROIS incorpora una capa economica aditiva para conectar personas con oportunidades y empresas con distribucion, talento e inteligencia agregada.

### Compatibilidad de perfiles

- `Creador` es la cuenta universal para publico general. Puede activar capacidades de venta, recomendacion, contenido, prospectos, representacion, servicios, deporte o emprendimiento.
- `Athlete` conserva su experiencia deportiva especializada y tambien puede participar en oportunidades compatibles.
- Los perfiles legacy de Founder y Creador se conservan. La capa `user_profiles` los relaciona sin borrar sus fichas, imagenes ni relaciones.
- Las empresas y eventos actuales permanecen operativos.

### Despliegue

1. Ejecuta una sola vez `supabase-opportunities-marketplace-v1.sql` en el SQL Editor de Supabase.
2. Publica `app.js`, `index.html` y `styles.css`.
3. Revisa primero la verificacion empresarial y una oportunidad de prueba en estado `in_review`.
4. Aprueba la empresa y la oportunidad desde Admin.
5. Prueba postulacion, consentimiento, aceptacion y consulta de ingresos con cuentas de prueba.

La migracion es aditiva e idempotente: no elimina ni renombra tablas legacy. Los pagos reales, la facturacion automatica y el comercio electronico permanecen deshabilitados; conversiones y comisiones son registros operativos sujetos a validacion.

### Modulos MVP

- Personas: perfil universal, oportunidades, postulaciones e ingresos.
- Empresas: verificacion, publicacion moderada, postulantes autorizados, resultados e inteligencia agregada.
- Admin: verificacion empresarial, moderacion de oportunidades, comisiones, disputas, privacidad y planes configurables.
- Privacidad: consentimiento por oportunidad y campos solicitados, revocacion y auditoria.

Consulta `OPPORTUNITIES-MVP-ARCHITECTURE.md` para arquitectura, riesgos, pruebas y decisiones de lanzamiento.
