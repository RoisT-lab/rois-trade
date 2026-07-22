# ROIS

Aplicacion web estatica conectada a Supabase para empresas, athletes, creadores y administracion. La compatibilidad tecnica de creadores conserva el role `founder` y la tabla `founders`.

## Sponsor Deck IA

Athletes y creadores cuentan con un constructor de Sponsor Deck dentro de su dashboard. El deck guarda narrativa, audiencia, evidencia, afinidad con marcas, entregables, paquetes comerciales y puntuacion de completitud en su registro real. Las empresas pueden abrirlo desde Mercado de fichajes, Creadores o el perfil completo.

El Sponsor Deck ROIS es la unica propuesta comercial activa. Los dashboards ya no permiten cargar ni descargar propuestas PDF externas. Los PDF historicos y sus metadatos se conservan para auditoria y migracion, pero no se muestran ni se modifican desde la aplicacion.

Ejecuta primero `supabase-sponsor-deck-ai-mvp.sql`. El modulo incluye un generador guiado local para disponibilidad inmediata y una Edge Function segura opcional en `supabase/functions/generate-sponsor-deck`. Consulta `SPONSOR-DECK-AI-SETUP.md`; nunca coloques `OPENAI_API_KEY` en archivos del frontend.

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
- `supabase-sponsor-deck-ai-mvp.sql`
- `supabase/functions/generate-sponsor-deck/index.ts`
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
