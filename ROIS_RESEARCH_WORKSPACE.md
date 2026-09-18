# ROIS — CRM exclusivo de investigación

## Alcance (18 septiembre 2026)

La portada de incubación conserva planeta, logotipo y acceso privado. La aplicación
autenticada ofrece exclusivamente Investigación de mercado y Configuración.
No existe un nuevo modelo de agentes ni reparto de contactos entre agentes.

Investigación reutiliza el módulo existente: registro de empresa/destinatario,
enlaces ES/EN, recuperación/copia del enlace, seguimiento de invitaciones,
respuestas, filtros por país/fecha y reportes imprimibles/PDF.
El selector excluye prospectos comerciales ajenos a la investigación, conservando
empresas con invitaciones o respuestas anteriores aunque su origen sea legacy.

## Acceso y datos

- Se conserva Auth original y el acceso de administradores aprobados.
- El login consulta el perfil existente; no crea perfiles ni cambia roles.
- Una cuenta comercial/deportiva no se convierte automáticamente en administradora.
- La sesión restaurada renueva su token cuando corresponde y verifica usuario/perfil.
- Las consultas de respuestas y RPC conservan las verificaciones administrativas del servidor.
- Las restricciones de navegación no sustituyen RLS ni autorización de las APIs.
- No se alteraron esquema, políticas, contraseñas, Storage, registros ni servicios.
- NOUORD y Jafet & Co. no fueron modificados.
- Las funciones legacy permanecen en código por compatibilidad; no son parte de
  la navegación del espacio de investigación y no se cargan sus datasets.

## Validación local

Pruebas de navegador con todas las llamadas externas interceptadas; sin escrituras
en producción ni respuestas de investigación ficticias guardadas en el servidor:

- tests/incubation-home.cjs: portada en tres tamaños, login rechazado/aprobado,
  sesión restaurada, cierre de sesión, menú de dos entradas, rechazo de cuenta
  comercial, bloqueo de navegación legacy y ausencia de consultas deportivas/comerciales.
- tests/research-browser.cjs: encuesta ES/EN, consentimiento, reintento sin perder
  respuestas, 205 registros paginados, filtros, generación/recuperación del enlace,
  fallback de copia, exportación seleccionada y temas claro/oscuro.
- tests/research.test.cjs: validación, idiomas, denominadores y escape de reportes.

Estas pruebas verifican la integración local mediante datos simulados; no equivalen
a una nueva auditoría de seguridad de la base de datos compartida.
Publicación y comprobación autenticada en producción pendientes de autorización.
