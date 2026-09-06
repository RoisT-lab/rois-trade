# ROIS Agent Workspace V1

El rol técnico sigue siendo `profiles.role = 'commercial'`; su interfaz se presenta como AGENTE ROIS. No hay un rol nuevo ni suplantación de clientes. Administración controla las asignaciones y su vigencia.

## Componentes

- `app.js`: carga mediante RPC autorizada, selector de cuenta, catorce paneles, editores con allowlists, variantes de propuesta y asignación administrativa. `agentScope` filtra las colecciones cargadas; no sustituye a RLS.
- `index.html`: navegación/paneles del agente y sección administrativa integrada. Conserva el acceso Scout previo.
- `styles.css`: sistema oscuro limitado a `.agent-workspace`, responsive y estados accesibles.
- `supabase-agent-workspace-v1.sql`: migración transaccional, aditiva y repetible.
- `supabase-external-scout-network.sql`: fuente canónica de Scouts externos, incluida en Git y obligatoria en los tests.
- `supabase/functions/send-rois-crm-invitation/index.ts`: baseline local incorporado con comprobación RLS del prospecto antes de usar service role. **No está confirmada su equivalencia con la versión desplegada**; no desplegar sin la comparación descrita abajo.
- `tests/agent-workspace-v1.test.mjs`: escenarios SQL aislados. No inserta fixtures en producción.

## Persistencia y seguridad

| Tabla nueva | Propósito |
| --- | --- |
| `commercial_account_assignments` | Agente, cuenta empresa o talento (exclusión mutua), asignador y vigencia. |
| `commercial_affinities` | Hipótesis, razones, score, prioridad, potencial y siguiente acción. |
| `commercial_proposal_variants` | Propuesta adaptada, master referenciado y revisión administrativa. Nunca escribe en el master. |
| `commercial_connections` | Contraparte, origen, etapa, potencial y siguiente acción. |
| `commercial_followups` | Acción fechada vinculada a una entidad de la cuenta. |
| `commercial_institutional_publishers` | Registro explícito de infraestructura publicadora ROIS propiedad de un perfil Admin; nunca una cuenta cliente. No contiene publishers precargados. |

Se añaden únicamente metadatos a `opportunities`, `company_listings`, `scout_leads`, `crm` y `analytics_events`. No se duplican oportunidades, activos, misiones, leads ni comisiones.

Funciones principales:

- `rois_agent_can_manage_assignment/company/profile`: autorización por sesión, aprobación, titularidad y vigencia; Administración conserva supervisión.
- `rois_agent_require_assignment`, `rois_agent_entity_belongs`: bloqueo compartido y verificación de pertenencia de referencias.
- `rois_agent_can_read_operation`, `rois_agent_can_read_opportunity`: priorizan siempre `commercial_assignment_id` cuando existe, también para las lecturas de misiones, leads, comisiones, participaciones y conversiones derivadas.
- `rois_agent_workspace`: snapshot filtrado. Los postulantes sólo incluyen campos de `shared_profile_snapshot` autorizados por consentimientos vigentes; no da acceso directo al perfil del postulante.
- `rois_agent_save`: escritura validada de afinidades, variantes, conexiones y seguimientos. Rechaza campos no permitidos y referencias cruzadas; impide autoaprobación.
- `rois_agent_operate`: escritura delegada en los objetos existentes, preservando borrador/revisión y moderación. No aprueba conversiones ni comisiones.
- `rois_agent_prepare_invitation`: reutiliza CRM/invitaciones a partir de un lead validado y consentido; conserva Scout y origen.
- `rois_scout_mission_profile`: integra al Scout externo aprobado con la identidad universal que utiliza el módulo de misiones, conservando su código. Requiere la infraestructura de Scouts externos ya instalada.
- Triggers `rois_agent_assignment_guard`, `rois_agent_record_guard`, `rois_agent_metadata_guard`, `rois_agent_audit`, `rois_agent_audit_guard`, `rois_agent_profile_guard`: verifican actor, timestamps, referencias, aprobación y trazabilidad; evitan falsificar metadatos o privilegios.

Las tablas nuevas tienen RLS y no permiten escritura libre del agente. En tablas existentes se agregan límites restrictivos para el rol commercial. **`user_profiles`, `athletes` y `founders` niegan toda lectura directa al agente**, incluso con una asignación vigente y aunque otra política permisiva permita leer el perfil público. Se eliminan sus políticas `agent_delegated_read`; sólo la proyección de `rois_agent_workspace()` devuelve información comercial. No devuelve correo privado, nacimiento, responsables/tutores ni enlaces privados de pago. Se conservan acceso propio de atleta/creador y acceso completo Admin.

El agente no puede asignarse cuentas, editar evidencia objetiva, aprobar comisiones, administrar usuarios, modificar facturación o borrar registros. La excepción de primer cambio de contraseña sigue disponible.

La retirada/expiración de una asignación se verifica en cada RPC; una selección guardada o un ID manual no otorgan acceso. Sólo se guarda el ID del selector en `sessionStorage`, identificado por sesión; los datos y borradores no se guardan en `localStorage`.

## Reutilización comercial

Mercado Corporativo utiliza **`company_listings`**, igual que `renderClientSponsors` y `renderAdminCorporateMarket`. Las misiones son la configuración Scout de **`opportunities`**; participantes, leads y comisiones siguen en **`mission_scouts`**, **`scout_leads`** y **`scout_mission_commissions`**.

### Titularidad del talento y publisher técnico

`scope.publishing_assignment_id` ya no se acepta: un cliente asignado NO puede publicar en nombre de otro talento. La nueva referencia es `scope.institutional_publisher_company_id`, limitada a `commercial_institutional_publishers`. Para designar una entidad institucional, debe existir realmente en `companies`, pertenecer a un perfil Admin aprobado y no haber sido asignada como cuenta cliente. No se inserta ninguna entidad ficticia ni se designa automáticamente una empresa.

En una futura configuración autorizada, Administración registra el ID de esa entidad en `commercial_institutional_publishers`; después aparece como opción en el formulario de asignación. Su identidad no puede transferirse a un cliente ni convertirse en una cuenta comercial asignada. La configuración requiere comprobar previamente qué entidad ROIS desempeña esa función; este PR no presume que ya exista.

**Titular comercial:** `commercial_assignment_id` → `commercial_account_assignments.user_profile_id`, el atleta/creador representado. **Publisher técnico:** `company_id`, exclusivamente para satisfacer la infraestructura legacy y su moderación/consentimientos. No es propietario comercial por el hecho de figurar en esa FK. En listings, `company_name` refleja el talento representado. No se cambia el Sponsor Deck maestro.

Las escrituras y lecturas delegadas usan la asignación representada, NO la empresa técnica como autorización. Si un registro tiene `commercial_assignment_id`, debe coincidir con la asignación utilizada para editarlo. La alternativa por `company_id` sólo aplica a registros legacy sin asignación y a cuentas empresa. Dos talentos con un publisher compartido permanecen aislados en RPC, SELECT directo, IDs manuales y entidades relacionadas. Los triggers impiden trasladar un registro delegado a otro titular/publisher. La vigencia del agente se valida por su asignación de talento; no existe una asignación del publisher al agente.

Sin publisher institucional configurado, afinidades, propuestas y conexiones de talento funcionan; la publicación de oportunidades/listings queda bloqueada con una explicación. Se mantienen los límites de publicación y moderación existentes. La distribución de un activo requiere una oportunidad de la misma cuenta.

### Términos Scout aceptados

Se implementa la opción A: **congelación global**, sin override administrativo. El primer `mission_scouts` o `scout_leads` fija `opportunities.scout_terms_locked_at` mediante trigger. Un UPDATE de la misma oportunidad serializa la incorporación con la edición de términos. Una vez bloqueados, no cambian recompensa, evento pagable, moneda, términos, evidencia requerida ni `scout_enabled` (evita anular retrospectivamente la generación de comisión).

El bloqueo es persistente aunque se elimine una membresía; tampoco se puede limpiar su fecha mediante UPDATE. El formulario muestra los campos bloqueados y permite editar información operativa no económica. Para ofrecer otras condiciones hay que crear otra misión/oportunidad: Admin tampoco modifica retrospectivamente estos términos. El trigger de comisiones existente sigue calculando sobre esos valores ahora inmutables; no se duplica lógica económica ni se reescriben comisiones.

Para misiones existentes antes de instalar el cambio se congelan los valores actuales. No existe historial suficiente para reconstruir términos aceptados antes de esta migración. **Antes de desplegar deben cotejarse las misiones ya activas con sus acuerdos originales**; este PR no afirma haber recuperado ese historial ni corregido importes históricos.

### Fuente canónica de Scouts externos

La auditoría confirmó que `main` no contenía `supabase-external-scout-network.sql`. Se recuperó su estructura desde el archivo local no versionado del workspace original y se incorporó una versión compatible en la raíz del repositorio, con ese mismo nombre. No se ha verificado que coincida con el esquema de producción.

Se conservaron tabla/campos de `scouts`, rol `scout`, registro, código y validación de códigos externos junto con los de atletas/creadores. Se excluyeron de la versión recuperada la conversión masiva `commercial → scout` y el borrado global de políticas CRM. El registro no permite cambiar otro rol ni reaprobar identidades bloqueadas. Aprobación, código y economía Scout son administrativos; se conservan códigos e importes existentes, incluido el campo económico legacy (distinto de recompensas de misiones).

`rois_scout_mission_profile()` obtiene el código de `scouts` aprobado bajo lock y actualiza un `user_profiles` existente si está desactualizado. Conserva su ID y no reescribe códigos de membresías históricas. Si el código canónico ya pertenece a otra identidad universal, falla y solicita reconciliación administrativa; no se apropia del código. El frontend llama al puente incluso cuando ya existe el perfil universal. Estos escenarios son obligatorios en el test suite, sin variable opcional de migración externa.

La propuesta adaptada conserva el master y utiliza los módulos del Sponsor Deck Viewer. Los datos objetivos se leen del master; narrativa, entregables y economía adaptada se guardan sólo en la variante. Las propuestas en revisión se aprueban en Administración.

## Métricas

`buildAgentExecutiveMetrics` usa `agentScope` y estas colecciones persistidas:

| KPI | Cálculo |
| --- | --- |
| Cuentas | Asignaciones activas y vigentes visibles. |
| Afinidades activas | Afinidades excepto `converted`/`discarded`. |
| Oportunidades activas | `opportunities.status = published`. |
| Activos corporativos | `company_listings.status = approved`. |
| Propuestas abiertas | Variantes excepto `closed`/`discarded`. |
| Conexiones abiertas | Conexiones excepto `closed_won`/`closed_lost`. |
| Misiones activas | Oportunidades publicadas con `scout_enabled`. |
| Leads por validar | Leads consentidos no eliminados en `submitted`/`contacted`. |
| Acciones vencidas | Seguimientos pendientes con `due_at` anterior a ahora. |
| Negociaciones | Conexiones en `negotiation`. |
| Valor potencial | Potencial declarado de conexiones abiertas, separado por moneda. No es revenue ni forecast. |

`buildAgentAttention` deriva alertas de ausencia de siguiente acción, propuestas en revisión, conexiones sin movimiento por siete días, leads pendientes, seguimientos vencidos y oportunidades que cierran en siete días. Opportunity Map agrupa afinidades reales, no calcula scores automáticamente.

Resultados filtra por cuenta, agente creador y fecha de creación para los objetos del agente. Leads y conversiones son resultados de las cuentas seleccionadas, no se atribuye su creación al agente. Profesionales incorporados exige invitación enviada y perfil registrado posteriormente con el mismo correo; no constituye atribución comercial exclusiva. El valor cerrado es declarado en conexiones. **Revenue se muestra como `—`** porque no hay una fuente confiable de ingresos efectivamente cobrados atribuibles a estas conexiones.

## Despliegue

1. Revisar en staging el esquema de producción y disponer de respaldo Supabase. No ejecutar todas las migraciones históricas a ciegas.
2. Prerrequisitos: esquema base, perfiles universales/oportunidades, Mercado Corporativo Pro Business, misiones Scout, invitaciones CRM/localizadas y campos actuales de Sponsor Deck. Comparar la migración canónica `supabase-external-scout-network.sql` con el esquema real y ejecutarla antes de Agent Workspace únicamente cuando se autorice el despliegue.
3. Después de revisar misiones previas y publisher institucional, ejecutar `supabase-agent-workspace-v1.sql`. Si falta una relación/campo, la transacción falla; no desactivar RLS para continuar. El código viejo `scope.publishing_assignment_id` queda inválido y necesita una decisión administrativa, no una sustitución automática de empresas.
4. **NO desplegar `send-rois-crm-invitation` todavía.** Obtener/respaldar la función actualmente desplegada mediante el acceso autorizado a Supabase; comparar contra el archivo del PR, incluidos proveedor, plantillas, idiomas, atribución Scout, permisos, validación JWT, reintentos, límites y efectos CRM. Confirmar nombres/configuración de secretos sin mostrarlos ni guardarlos en Git. Verificar que no se pierde ninguna funcionalidad. Sólo después de ese cotejo, pruebas de staging y aprobación explícita podrá planearse su despliegue. La protección RLS del PR no prueba equivalencia funcional con el baseline remoto.
5. La publicación conjunta de `app.js`, `styles.css` e `index.html` queda igualmente pendiente de autorización. No publicar fixtures ni dependencias de QA.
6. En Administración → AGENTES ROIS, asignar cuentas reales a agentes commercial aprobados. Sin asignación el agente ve un estado vacío, no el CRM global antiguo.
7. Repetir en staging y luego en producción las pruebas de aislamiento A/B, consentimientos, revocación, invitación con correo autorizado y compatibilidad de los demás roles.

## Validación realizada

- `node --check app.js` y `node --check supabase/functions/send-rois-crm-invitation/index.ts`.
- `git diff --check`.
- PostgreSQL embebido PGlite: ambas migraciones aplicadas dos veces en vacío y de nuevo con datos; **135 aserciones**. Incluyen SELECT sensible denegado, proyección segura, aislamiento bidireccional con publisher compartido, IDs manuales, términos congelados, comisión de $1,000 conservada, código Scout reconciliado/reservado, registro bloqueado, aislamiento/consentimientos y acceso propio de atleta/creador/cliente/Admin. Las 28 comprobaciones adicionales cubren alta pendiente, ambos estados, aprobación sólo Admin, prohibición de misiones/leads incluso con perfil universal legacy activo, no auto-reactivación y no apropiación del código.
- Navegador Edge/Playwright con servidor local y RPCs ejecutadas en ese PostgreSQL aislado: catorce paneles, creación persistida de afinidad, asignar/retirar desde Admin, selector, borrador entre paneles, propuesta compartida, menú móvil e inglés. Consola sin errores en esos recorridos.
- Anchos/altos revisados: 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 390×844, 360×800; sin overflow horizontal en Inicio. Botón de envío móvil de 44 px de alto. Capturas fuera del repositorio con datos exclusivamente de QA.
- Hardening en navegador: campos económicos de misión aceptada deshabilitados, guardado permitido de un objetivo no económico y catálogo administrativo con sólo el publisher institucional. Formulario móvil 390×844 sin overflow ni errores de consola en estos recorridos.
- Aprobación Scout en navegador: botón administrativo conectado a la RPC local, refresco con `approved / approved`, sin botón para rechazados; siete resoluciones sin overflow horizontal. Capturas desktop/móvil fuera del repositorio.

Reproducir SQL: proporcionar PGlite como dependencia de pruebas externa y ejecutar `node tests/agent-workspace-v1.test.mjs`. `ROIS_PGLITE_MODULE` permite indicar su módulo. `supabase-external-scout-network.sql` se carga obligatoriamente desde el repositorio; ya no se utiliza `ROIS_SCOUT_SCHEMA`. No se agrega dependencia al frontend.

### Límites de la validación

No se conectó ni migró Supabase remoto. PGlite ejecuta SQL/RLS real pero sustituye los helpers de Auth/Storage y no valida PostgREST, infraestructura de red ni la configuración efectiva de producción. La sesión de navegador fue inicializada por el arnés local, no se probó login real. No se enviaron correos ni se ejecutó Deno typecheck. Compatibilidad de cliente/atleta/creador/admin verificada en RLS; no se realizó una regresión visual completa de sus dashboards ni todos los uploads/pagos remotos. Esos recorridos requieren staging con cuentas autorizadas antes de publicar.

## Aprobación obligatoria de Scouts externos

`register_external_scout` crea `profiles.role=scout` con `profiles.status=pending` y `scouts.status=pending`. Reintentos conservan el código canónico y no cambian roles, estados ni códigos existentes. Los Scouts ya aprobados no se degradan al reaplicar la migración. Identidades legacy inconsistentes requieren revisión, no una aprobación implícita.

Administración → AGENTES ROIS → **Aprobación de Scouts externos → Aprobar Scout** llama a `rois_admin_approve_scout(profile_id)`. La función verifica Admin aprobado, bloquea ambas filas y actualiza ambos estados en una transacción. No permite que el agente o el Scout se aprueben; no desbloquea silenciosamente cuentas bloqueadas, eliminadas o rechazadas.

`rois_external_scout_profile_guard` impide cambiar el rol/estado de la identidad Scout desde permisos propios legacy; `scouts_identity_guard` protege la fila Scout. `external_scout_approval_boundary` es restrictiva en oportunidades, membresías, leads y comisiones: ambos estados deben estar aprobados para un usuario Scout, incluso si ya tenía un perfil universal activo o una membresía anterior. Los demás roles conservan sus políticas. `rois_scout_mission_profile` también exige ambos estados aprobados.

`rois_reserved_scout_code_guard` rechaza que otro perfil universal, atleta o creador reclame un código reservado en `scouts`, incluso cuando su titular está pendiente/bloqueado/rechazado. La unicidad normalizada de `scouts` impide registrar dos identidades con el mismo código.

## Preflight de producción: exclusivamente lectura

Este checklist **no autoriza SQL remoto, merge, publicación ni despliegue de funciones**. No contiene consultas para ejecutar. El repositorio describe el esquema esperado, no demuestra el estado real de producción.

Con una sesión administrativa autorizada, consultar únicamente metadatos y vistas de lectura del panel:

- Tables/Schema: existencia y columnas de `profiles`, `scouts`, `user_profiles`, `opportunities`, `company_listings`, `mission_scouts`, `scout_leads`, `scout_mission_commissions`, las seis tablas `commercial_*` y metadatos delegados/lock de términos. Anotar diferencias, sin editar ni ejecutar SQL.
- En `profiles`, tipos de rol/estado efectivamente presentes; revisar incoherencias de estado Scout sin exportar correos u otros datos personales.
- Misiones: identificar oportunidades publicadas con Scout habilitado y las que ya tienen membresías/leads. Verificar términos históricos antes de congelarlos; no inferir acuerdos anteriores a partir de valores actuales.
- Mercado Corporativo: estado/columnas de `company_listings` y propietarios actuales; no usar un cliente como publisher de talento.
- Publisher: verificar candidatos reales ROIS en `companies`, propietario Admin aprobado y ausencia de asignación como cliente. La migración no designa candidatos automáticamente.
- Edge Functions: existencia, versión, fecha, JWT y configuración visible de `send-rois-crm-invitation`. Obtener el baseline autorizado antes de cualquier despliegue; comprobar proveedor y nombres de secretos sin revelar valores.
- Backups: disponibilidad real de respaldo/restauración/exportación, fecha del último respaldo y acceso a un mecanismo de exportación autorizado. No iniciar restauración ni exportar datos sensibles durante este preflight.

Si el panel no está autenticado o no expone esos datos sin SQL, marcar **no verificado** y solicitar acceso de lectura o un inventario administrativo autorizado. No convertir hipótesis del código en hechos de producción.
