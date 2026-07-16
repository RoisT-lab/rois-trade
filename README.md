# ROIS

Aplicacion web estatica conectada a Supabase para empresas, athletes, founders y administracion.

## Despliegue de esta actualizacion

Sube estos archivos:

- `app.js`
- `index.html`
- `supabase-schema.sql`
- `supabase-profile-persistence-storage.sql`
- `PROFILE-PERSISTENCE-VALIDATION.md`
- `README.md`

No es necesario modificar `app-config.js`, Stripe ni assets.

## Migracion obligatoria

Antes de probar el guardado de perfiles, ejecuta una sola vez en Supabase SQL Editor:

```text
supabase-profile-persistence-storage.sql
```

La migracion:

- agrega rutas y metadatos de avatar/propuesta;
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
athletes/{profile_id}/proposals/{filename}
athletes/{profile_id}/sponsors/{filename}
founders/{profile_id}/avatar/{filename}
founders/{profile_id}/proposals/{filename}
founders/{profile_id}/sponsors/{filename}
```

Limites:

- avatar: JPG, PNG o WEBP, maximo 5 MB;
- propuesta: PDF, maximo 15 MB;
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
- PDF de propuesta;
- maximo 10 logos.

Founder:

- founder existente;
- founder nuevo;
- founder sin fila real;
- industria, etapa, ciudad y traccion;
- avatar;
- PDF;
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
