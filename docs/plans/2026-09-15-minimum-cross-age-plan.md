# Minimum cross age, implementation plan

Implements [`2026-09-15-minimum-cross-age-design.md`](./2026-09-15-minimum-cross-age-design.md).

## Scope guard

This work does not:

- Change any close rule, the anchors, the basis rule or the region floor.
- Add a database column or a migration.
- Change the shape of `opportunity_rejected` beyond adding one reason.
- Touch the feeds or the engine.

## Tasks

### 1. `server/src/engine/opportunity/OpportunityManager.ts`

- Add `MIN_CROSS_AGE_MS` of 100, next to `MIN_NET_PPM`.
- Add `'unconfirmed_cross'` to `RejectionReason`.
- Add a pending map keyed by pair, holding the route key, the time the cross was first seen and the net ppm at that moment.
- Forget the pending cross, and report it, wherever `validate` returns because the pair no longer crosses: no bid or ask side, one venue on both sides, or net ppm under `MIN_NET_PPM`.
- Keep the pending cross when a guard refuses the route, because the cross is still there and its age keeps running.
- After the region floor and before `trackOpportunity`: record the cross when it is new or on a different route, refuse while its age is under `MIN_CROSS_AGE_MS`, and delete the entry when the route opens.
- An already tracked route deletes any pending entry for that pair, since the cross is open.

### 2. `server/src/engine/opportunity/OpportunityManager.spec.ts`

- Update `openOn` so the cross is first seen at `now - MIN_CROSS_AGE_MS` and the returned tick is the one that opens at `now`, which keeps every existing assertion about `openedAt` true.
- Add cases:
  - A cross seen once does not open a route.
  - The same cross opens on a later tick once it is `MIN_CROSS_AGE_MS` old.
  - A cross that vanishes before the age reports `unconfirmed_cross` and opens nothing.
  - A better route replacing the pending one restarts the clock.
  - A route that closes and crosses again waits the age again.
  - A refusal, such as the region floor, still reports its own reason on the first sight of a cross.
- Fix the tests that open a route outside `openOn`, including the reopen after the age cap, which now reopens one tick later rather than on the closing tick.

### 3. Verification

- `npx jest src/engine src/venues --forceExit` from `server/`.
- `npx tsc --noEmit`, `npx eslint`, `npx prettier --check` on the touched files.
- On the next run: `unconfirmed_cross` counts per route, and no row whose first sample is under `MIN_NET_PPM`.

## Reconcile

After the run, record the measured refusal counts in the design, then move both docs to [`implemented/`](../implemented/) and update [`README.md`](../README.md).
