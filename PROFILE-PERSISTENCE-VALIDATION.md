# ROIS profile persistence validation

Date: 2026-07-16

## Static validation completed

- `app.js` passes `node --check`.
- Requested unified profile helpers exist once.
- No `select=*` remains in `app.js`.
- API `insert`, `update`, `upsert` and `remove` do not call `loadAll()`.
- No direct `hydrateDashboardData(true)` remains.
- Dashboard hydration has one shared promise and one hydrated-role set.
- Profile forms use Supabase Storage for avatar, proposal and sponsor logos.
- Profile cache removes embedded `data:` payloads.
- The known missing isotipo fallback was replaced with `assets/rois-logo.png`.
- The migration contains no `drop table`, `truncate`, `delete from` or `service_role`.
- The CSS and Stripe configuration were not modified.

## Runtime validation required after deployment

The following checks require the production Supabase project and authenticated test accounts:

| Role | Test | Expected result |
| --- | --- | --- |
| Athlete | Save text only | Immediate confirmation and card update without page reload |
| Athlete | Upload avatar | Object in `profile-media/athletes/{auth.uid()}/avatar` |
| Athlete | Upload PDF | Object in `profile-media/athletes/{auth.uid()}/proposals` |
| Athlete legacy | Record matched by `contact` | Existing row reused, no virtual PATCH |
| Founder | Save industry/stage/city/stats | Row updated in `founders` |
| Founder | Upload avatar/PDF | Objects stored below `founders/{auth.uid()}` |
| Company | Open both markets | Only approved real Athlete/Founder rows appear |
| Admin | Open Statistics | Profile diagnostic table appears |
| Login | All four roles | Dashboard appears before secondary hydration |
| RLS | Edit another profile | Operation is blocked |

## Timing capture

Record these values from browser DevTools after deployment:

| Scenario | Before reported | Target | Production result |
| --- | ---: | ---: | ---: |
| Login | 180-300 seconds | under 4 seconds | Pending |
| Save text profile | global reload | under 2 seconds | Pending |
| Avatar upload under 5 MB | Base64/global reload | under 15 seconds | Pending |
| Founder market refresh | manual reload | immediate local update | Pending |

## Screenshot checklist

- Athlete saved.
- Founder saved.
- Athlete market card.
- Founder market card.
- Broken image fallback.
- Dashboard visible at 100% zoom after login.
