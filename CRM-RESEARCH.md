# Investigación de mercado / Market research

## Estado

La primera versión se publicó el 15 de septiembre de 2026. La simplificación de interfaz está implementada en el worktree `dashboard-brand-refresh` y pendiente de publicación. El cambio aditivo `research_named_invitations` ya se aplicó a Supabase; su SQL reproducible está en `supabase-research-named-invitations.sql` (CLI local no disponible; ejecución mediante la conexión Supabase). Conserva el RPC anterior y sus enlaces. Las pruebas se revierten íntegramente: no envían correos ni conservan contactos o respuestas de prueba.

## Uso

1. Entrar como administrador, abrir CRM y encontrar **Investigación de mercado**.
2. Abrir **Crear invitación / enlace ES–EN**. Seleccionar una empresa existente o ingresar una nueva empresa y el **nombre del destinatario**. No requiere correo: el CRM conserva nombre de persona, organización y correo nulo; la invitación guarda el destinatario. Una combinación repetida de persona/empresa de investigación se rechaza para que se seleccione el registro existente. Tras generar, el formulario selecciona el ID creado para no duplicarlo al regenerar.
3. Generar y copiar los dos enlaces antes de actualizar. Los enlaces duran 30 días; regenerar uno pendiente invalida el anterior. No se envían automáticamente. Tratar el enlace como una invitación privada: quien lo recibe puede responder por esa empresa.
4. El participante abre `encuesta.html?lang=es#token=…` o `?lang=en#token=…`, elige idioma y responde sin cuenta. Cambiar de idioma conserva lo escrito. Un error de envío conserva los campos; no se muestran confirmaciones hasta que la base confirma el guardado.
5. **Actualizar respuestas** carga todas las páginas de datos. Solo se muestran país, fecha desde/hasta y orden por fecha (reciente/antigua) o país (A–Z). La lista muestra 20 respuestas por página; el PDF contiene toda la selección en el mismo orden. Las demás respuestas del cuestionario se conservan sin añadir filtros.
6. **Exportar selección a PDF** abre el reporte; pulsar **Guardar como PDF / Imprimir** y seleccionar **Guardar como PDF** en el navegador. También hay PDF individual y exportación agregada sin respuestas identificadas. El reporte está en el idioma del administrador y conserva los textos originales del participante.
7. El formulario comercial anterior está cerrado por defecto detrás de **Enviar invitación comercial**. El botón permite abrirlo/cerrarlo conservando el borrador y no envía correos por sí solo. Ese flujo comercial separado mantiene su correo obligatorio.

## Datos y privacidad

- Cuestionario v1 en `research-schema.js`, etiquetas ES/EN y códigos de opciones estables.
- `research_invitations`: vínculo único al CRM, hash SHA-256 de un token aleatorio, vigencia, creador y fecha de respuesta. El token original no se almacena.
- `research_responses`: vínculo al CRM e invitación, versión, idioma, respuestas JSON, consentimiento fechado y permiso opcional de entrevista.
- Solo administradores aprobados pueden leer respuestas/invitaciones. No se copian respuestas a notas del CRM accesibles a agentes.
- La presentación anónima valida una capacidad aleatoria de 244 bits, con caducidad, antes de escribir. No permite seleccionar otro CRM, leer respuestas ni modificar una respuesta existente. Un reintento idéntico devuelve éxito sin duplicar.
- Las escrituras privilegiadas viven en esquema privado, con `search_path` fijo; los dos RPC públicos son `SECURITY INVOKER`. Los permisos de administrador se consultan en perfiles, nunca en metadata editable por el usuario.
- El enlace usa fragmento, no query string, y el formulario establece `no-referrer`. No usa analítica, cookies adicionales ni almacenamiento local de respuestas.
- Consentimiento de investigación obligatorio y contacto para entrevista opcional. El aviso general enlazado permanece en español; el propósito específico de esta investigación se presenta en ambos idiomas. La encuesta no garantiza financiamiento ni servicios.
- El reporte declara muestra exploratoria, universo filtrado, denominadores, respuestas «ninguno/no sé» y que presupuesto no demuestra intención de compra.
- Las respuestas no tienen edición directa. Correcciones y solicitudes de privacidad requieren un proceso administrativo separado; no reutilizar el permiso de entrevista como consentimiento comercial general.

## Pruebas

- `node tests/research.test.cjs`: paridad ES/EN, validación, consentimientos, categorías, escape HTML, reportes completos/agregados.
- `node tests/research-browser.cjs`: Edge sin interfaz, API simulada, preservación ES/EN, error y reintento, estado exitoso, móvil, integración en CRM real, tema claro/oscuro, 205 respuestas, paginación, filtros, enlaces y PDF ES/EN. Dependencia Playwright del runtime local, ajustar ruta si cambia el entorno.
- `tests/research-db.sql`: pruebas SQL en transacción con rollback, ejecutadas sobre Supabase: invitación administrativa, rotación, envío anónimo, validación, reintento, separación de consentimientos, lectura administrativa y rechazo a otros roles. Requiere administrador aprobado existente. No conserva fixtures.
- `node tests/agent-workflow.test.mjs`: regresión previa de navegación/agentes.
- PDFs de QA en `tmp/research-qa/`, revisados con Poppler: márgenes, saltos de página, acentos, caracteres internacionales y texto largo. No contienen respuestas reales y no se publican.

## Alertas anteriores ajenas a esta migración

El asesor de seguridad no señaló objetos nuevos de investigación. Sí devolvió alertas existentes sobre dos vistas del marketplace con privilegios del creador, funciones antiguas con `search_path` mutable o ejecución amplia, y protección de contraseñas filtradas deshabilitada. No se modificaron esos módulos en esta tarea; requieren revisión independiente antes de ampliar el acceso a información sensible.

- [Vistas SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- [Funciones sin search_path fijo](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [Funciones privilegiadas ejecutables por anónimos](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
