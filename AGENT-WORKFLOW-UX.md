# Agent workflow: focused commercial workspace

Frontend version: `20260914-agent-workflow`.

## Navigation

Six agent destinations: Mi jornada, Cuentas, Gestiones comerciales, Propuestas,
Resultados, Configuración. Existing panel IDs and records remain intact.

- Relationships and connections share a searchable, paginated case view. An
  affinity already linked to a connection is not shown twice in that view.
- Priority view remains available inside cases; it is explicitly manual.
- Account details contain publications, assets, Scout missions, prospect review,
  participants and history. These are tools, not additional primary menus.
- Scout-role navigation is unchanged. Agent preferences remain in Settings.

## Business rules retained

No migrations, new tables, grants, RLS changes or production data mutations.
Existing RPCs and administrative review remain authoritative.

- Published opportunities and approved listings/proposals are read-only.
- Closed cases are read-only in this UI, preventing routine edits from moving
  the existing server-maintained `closed_at` timestamp.
- New proposals expose only draft/review states; approved content can be copied
  to a new variant, never overwritten through the editor.
- Economic fields serialize into the existing object; unknown historical keys
  remain intact. Users no longer write JSON.
- The invalid affinity-to-publication action is removed. Publications can still
  be created from account tools. Affinity-to-case/proposal references remain.
- Child Scout/lead records resolve their account through the parent opportunity.
- Source references travel with local drafts and are checked by existing RPCs.
- Agenda groups are exclusive; an explicit linked task suppresses an identical
  inline next action. Results use closing dates for wins, creation dates for new
  cases/proposals, and exclude undated historical wins with a visible note.
- Declared won value is not labelled as collected revenue.

## Validation

`node tests/agent-workflow.test.mjs` uses Node built-ins and executes the shipped
helpers for navigation, policy, proposal fields, account resolution, agenda and
closing-date regression checks.

`tests/agent-workspace-v1.test.mjs` remains the SQL authorization/regression suite
(135 assertions, local in-memory PGlite; optional test dependency only).

External local QA also exercises browser → SQL → Admin approval → case linkage
→ follow-up → close; all six primary views on desktop/mobile in both themes;
and cross-dashboard settings/mobile-menu regressions. Test fixtures never use
production identities, credentials or data.

Before production rollout, review the preview with an operator. Live account
assignments, deployment of historical migrations and real email delivery are
not implied by local QA. Agent work remains scoped to assigned accounts;
company-wide acquisition CRM or automated matching are not introduced here.
