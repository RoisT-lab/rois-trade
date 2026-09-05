# ROIS Agent Workspace V1

El rol técnico sigue siendo `profiles.role = 'commercial'`; su interfaz se presenta como AGENTE ROIS. No hay un rol nuevo ni suplantación de clientes. Administración controla las asignaciones y su vigencia.

## Componentes

- `app.js`: carga mediante RPC autorizada, selector de cuenta, catorce paneles, editores con allowlists, variantes de propuesta y asignación administrativa. `agentScope` filtra las colecciones cargadas; no sustituye a RLS.
- `index.html`: navegación/paneles del agente y sección administrativa integrada. Conserva el acceso Scout previo.
- `styles.css`: sistema oscuro limitado a `.agent-workspace`, responsive y estados accesibles.
- `supabase-agent-workspace-v1.sql`: migración transaccional, aditiva y repetible.
- `supabase/functions/send-rois-crm-invitation/index.ts`: función existente de correo, incorporada al repositorio con comprobación RLS del prospecto antes de usar service role. No cambia proveedor, plantilla ni atribución Scout.
- `tests/agent-workspace-v1.test.mjs`: escenarios SQL aislados. No inserta fixtures en producción.

## Persistencia y seguridad

| Tabla nueva | Propósito |
| --- | --- |
| `commercial_account_assignments` | Agente, cuenta empresa o talento (exclusión mutua), asignador y vigencia. |
| `commercial_affinities` | Hipótesis, razones, score, prioridad, potencial y siguiente acción. |
| `commercial_proposal_variants` | Propuesta adaptada, master referenciado y revisión administrativa. Nunca escribe en el master. |
| `commercial_connections` | Contraparte, origen, etapa, potencial y siguiente acción. |
| `commercial_followups` | Acción fechada vinculada a una entidad de la cuenta. |

Se añaden únicamente metadatos a `opportunities`, `company_listings`, `scout_leads`, `crm` y `analytics_events`. No se duplican oportunidades, activos, misiones, leads ni comisiones.

Funciones principales:

- `rois_agent_can_manage_assignment/company/profile`: autorización por sesión, aprobación, titularidad y vigencia; Administración conserva supervisión.
- `rois_agent_require_assignment`, `rois_agent_entity_belongs`: bloqueo compartido y verificación de pertenencia de referencias.
- `rois_agent_workspace`: snapshot filtrado. Los postulantes sólo incluyen campos de `shared_profile_snapshot` autorizados por consentimientos vigentes; no da acceso directo al perfil del postulante.
- `rois_agent_save`: escritura validada de afinidades, variantes, conexiones y seguimientos. Rechaza campos no permitidos y referencias cruzadas; impide autoaprobación.
- `rois_agent_operate`: escritura delegada en los objetos existentes, preservando borrador/revisión y moderación. No aprueba conversiones ni comisiones.
- `rois_agent_prepare_invitation`: reutiliza CRM/invitaciones a partir de un lead validado y consentido; conserva Scout y origen.
- `rois_scout_mission_profile`: integra al Scout externo aprobado con la identidad universal que utiliza el módulo de misiones, conservando su código. Requiere la infraestructura de Scouts externos ya instalada.
- Triggers `rois_agent_assignment_guard`, `rois_agent_record_guard`, `rois_agent_metadata_guard`, `rois_agent_audit`, `rois_agent_audit_guard`, `rois_agent_profile_guard`: verifican actor, timestamps, referencias, aprobación y trazabilidad; evitan falsificar metadatos o privilegios.

Las tablas nuevas tienen RLS y no permiten escritura libre del agente. En tablas existentes se agregan límites restrictivos para el rol commercial, además de lecturas delegadas. Las políticas de otros roles permanecen. El agente no puede asignarse cuentas, editar evidencia objetiva, aprobar comisiones, administrar usuarios, modificar facturación o borrar registros. La excepción de primer cambio de contraseña sigue disponible.

La retirada/expiración de una asignación se verifica en cada RPC; una selección guardada o un ID manual no otorgan acceso. Sólo se guarda el ID del selector en `sessionStorage`, identificado por sesión; los datos y borradores no se guardan en `localStorage`.

## Reutilización comercial

Mercado Corporativo utiliza **`company_listings`**, igual que `renderClientSponsors` y `renderAdminCorporateMarket`. Las misiones son la configuración Scout de **`opportunities`**; participantes, leads y comisiones siguen en **`mission_scouts`**, **`scout_leads`** y **`scout_mission_commissions`**.

El modelo existente exige una empresa publicadora. Para publicar oportunidades o activos en representación de un atleta/creador, Administración puede vincular `scope.publishing_assignment_id` a una asignación empresarial vigente del mismo agente. Ambas autorizaciones se verifican al escribir. Sin ella se muestra la limitación, no se inventa una empresa ni se suplantan sesiones. La distribución de un activo requiere una oportunidad existente vinculada.

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
2. Prerrequisitos existentes: esquema base, perfiles universales/oportunidades, Mercado Corporativo Pro Business, misiones Scout, invitaciones CRM/localizadas y campos actuales de Sponsor Deck. El test usa las migraciones del repositorio de esas funciones. Scouts externos requiere su migración existente `supabase-external-scout-network.sql`; este cambio no la reemplaza.
3. Ejecutar **sólo la nueva migración `supabase-agent-workspace-v1.sql`** en SQL Editor sobre un entorno con esos prerrequisitos. Si falta una relación/campo, la transacción falla; no desactivar RLS para continuar.
4. Desplegar la función existente actualizada: `supabase functions deploy send-rois-crm-invitation --project-ref <proyecto>`. Conservar JWT verification y secretos actuales de Supabase/Resend; no publicar credenciales.
5. Publicar juntos `app.js`, `styles.css` e `index.html` (build `20260905-agent-workspace-v1`). No desplegar fixtures ni dependencias de QA.
6. En Administración → AGENTES ROIS, asignar cuentas reales a agentes commercial aprobados. Sin asignación el agente ve un estado vacío, no el CRM global antiguo.
7. Repetir en staging y luego en producción las pruebas de aislamiento A/B, consentimientos, revocación, invitación con correo autorizado y compatibilidad de los demás roles.

## Validación realizada

- `node --check app.js` y `node --check supabase/functions/send-rois-crm-invitation/index.ts`.
- `git diff --check`.
- PostgreSQL embebido PGlite: migración aplicada dos veces; 53 aserciones con infraestructura Scout externa, incluidas asignación/revocación/expiración, RLS entre agentes, IDs manuales, consentimientos revocados/expirados, aprobación, lead → afinidad/conexión idempotente, invitación, identidad Scout y master intacto.
- Navegador Edge/Playwright con servidor local y RPCs ejecutadas en ese PostgreSQL aislado: catorce paneles, creación persistida de afinidad, asignar/retirar desde Admin, selector, borrador entre paneles, propuesta compartida, menú móvil e inglés. Consola sin errores en esos recorridos.
- Anchos/altos revisados: 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 390×844, 360×800; sin overflow horizontal en Inicio. Botón de envío móvil de 44 px de alto. Capturas fuera del repositorio con datos exclusivamente de QA.

Reproducir SQL: proporcionar PGlite como dependencia de pruebas externa y ejecutar `node tests/agent-workspace-v1.test.mjs`. `ROIS_PGLITE_MODULE` permite indicar su módulo; `ROIS_SCOUT_SCHEMA` permite indicar la migración Scout externa existente. No se agrega dependencia al frontend.

### Límites de la validación

No se conectó ni migró Supabase remoto. PGlite ejecuta SQL/RLS real pero sustituye los helpers de Auth/Storage y no valida PostgREST, infraestructura de red ni la configuración efectiva de producción. La sesión de navegador fue inicializada por el arnés local, no se probó login real. No se enviaron correos ni se ejecutó Deno typecheck. Compatibilidad de cliente/atleta/creador/admin verificada en RLS; no se realizó una regresión visual completa de sus dashboards ni todos los uploads/pagos remotos. Esos recorridos requieren staging con cuentas autorizadas antes de publicar.
