# Five venue research, implementation plan

Implements [`2026-09-15-five-venue-research-design.md`](./2026-09-15-five-venue-research-design.md).

**Status:** Done.

**Archived:** 2026-09-15.

## Scope guard

This work does not:

- Add a venue to [`../../server/src/venues/registry.ts`](../../server/src/venues/registry.ts), write a feed or a poller, or change any code under `server/` or `app/`.
- Open an account, call an authenticated endpoint, subscribe a private channel, or place an order.
- Probe faster than a venue's published public limit, or hold a socket longer than a probe needs.
- Record deposit, withdrawal, card, staking or spot fee tables beyond one line naming the official lookup.
- Detail dated futures or options beyond naming them in the coverage matrix.
- Commit, or edit the profiles of the five venues already running.

## Tracker

| task | subject | status |
|---|---|---|
| 1 | Gate | Done |
| 2 | Bitget | Done |
| 3 | MEXC | Done |
| 4 | Bitstamp | Done |
| 5 | Gemini | Done |
| 6 | Comparison doc | Done |
| 7 | Second verification pass | Done |
| 8 | Index and reconcile | Done |

## The profile template

Tasks 1 to 5 each produce the same three files and one script.
Every numeric or protocol claim carries a source link, a probe reference, or a CCXT file and line.

### `fees.md`

1. Scope and freshness: retrieval date, legal entities, who may trade the perpetuals, and the regions excluded.
2. Quick answer: the VIP 0 maker and taker for each perpetual family, in percent and in ppm.
3. Coverage matrix: every perpetual family, and dated futures, options and spot marked present or absent.
4. Every published perpetual tier with its qualification rule.
5. Discounts that change the perpetual taker: token holding, referral, market maker, zero fee promotions with their end dates.
6. Funding as a cost: formula, interval, cap and floor, and when and to whom it is charged.
7. Liquidation, settlement and delisting charges.
8. CCXT: what `market.taker` reports for a swap market without credentials, and the source line in `server/node_modules/ccxt/js/src/<venue>.js`.
9. Recommended registry values, `takerPpm` and `ccxtTakerPpm`, with the reason.
10. Source ledger.

### `websocket.md`

1. Endpoints: public URLs per perpetual family, and whether one socket carries several families.
2. Channel matrix for public market data: book channels at every depth and speed, best bid and ask, trades, ticker, mark, index and funding channels.
3. The sixteen axes of [`../research/2026-07-30-venue-ws-protocol-differences.md`](../research/2026-07-30-venue-ws-protocol-differences.md), one row each, documented value and probed value side by side.
4. The book channel in detail: snapshot on subscribe or not, delta semantics, the per symbol sequence and its gap rule, checksum, level order on the wire, size unit against CCXT's `contractSize`, one-sided and empty books, idle repeats, and what an unknown or closed symbol returns.
5. Session: keepalive, silence the server tolerates, forced disconnects, maintenance notices, compression, handshake and subscription limits.
6. Captured frames from the probe: a subscribe acknowledgement, a snapshot, a delta, a keepalive answer, an error, each trimmed and annotated.
7. Private channels: names and endpoints only, for a future execution stage.
8. Recommended feed shape: URL plan, markets per connection, subscribe frames, keepalive, `maxSilenceMs`, and the resync rule.
9. Source ledger.

### `rest.md`

1. Host and latency from this machine: resolved address, cold and warm request time.
2. Catalog: the instruments call, status values, the active perpetual count by settlement asset, and how CCXT maps it: `market.id` against the socket and anchor symbol, `contractSize` against the book size unit, `linear`, `active`, and any pair listed twice.
3. Anchor: the calls that return index, mark, funding rate, interval and next settlement for every perpetual at once, with reply size and time, and the field for each `AnchorRow` column.
4. Anchor semantics: the index formula and basket, the basket call if public, the mark formula and every clamp, the funding formula and cap, whether the published rate is the upcoming or the last settled one, and how often each number changes over about a minute of one second polls.
5. REST book snapshot: the call, depth limits, level order, caching.
6. Rate limits, the status codes a limit produces, `Retry-After`, and error shapes.
7. Server time call and clock offset.
8. Recommended poller shape: URLs, interval, the row mapping, and what to skip.
9. Source ledger.

## Tasks

### 1. Gate

Files:

- Create: `docs/profiles/gate/fees.md`
- Create: `docs/profiles/gate/websocket.md`
- Create: `docs/profiles/gate/rest.md`
- Create: `scripts/probes/gate-venue-probe.mjs`
- Create: `scripts/probes/gate-ws-probe.mjs`

Questions this venue raises:

- How USDT settled and BTC settled perpetuals split across hosts and paths, and which the CCXT `gate` class loads as swaps.
- Whether book sizes arrive in contracts, and whether `quanto_multiplier` is what CCXT reports as `contractSize`.
- Which of the legacy and newer order book update channels carries a usable sequence, and at which depths and speeds.

### 2. Bitget

Files:

- Create: `docs/profiles/bitget/fees.md`
- Create: `docs/profiles/bitget/websocket.md`
- Create: `docs/profiles/bitget/rest.md`
- Create: `scripts/probes/bitget-rest-probe.mjs`
- Create: `scripts/probes/bitget-ws-probe.mjs`
- Create: `scripts/probes/bitget-settlement-probe.mjs`

Questions this venue raises:

- Which API generation serves public futures data today, the classic v2 mix API or the unified account v3 API, and which one CCXT 4.5.68 calls.
- How USDT, USDC and coin margined product types split, and whether one socket carries them all.
- The full book channel's checksum and sequence, and whether the fixed depth channels are snapshots on every push.

### 3. MEXC

Files:

- Create: `docs/profiles/mexc/fees.md`
- Create: `docs/profiles/mexc/websocket.md`
- Create: `docs/profiles/mexc/rest.md`
- Create: `scripts/probes/mexc-rest-probe.mjs`
- Create: `scripts/probes/mexc-ws-probe.mjs`

Questions this venue raises:

- Whether the futures API is open to order placement for ordinary accounts, since the engine's trades would go there.
- Whether the socket compresses frames by default, and how to turn that off.
- How the incremental depth channel's version field chains, and what the full depth channel sends.

### 4. Bitstamp

Files:

- Create: `docs/profiles/bitstamp/fees.md`
- Create: `docs/profiles/bitstamp/websocket.md`
- Create: `docs/profiles/bitstamp/rest.md`
- Create: `scripts/probes/bitstamp-venue-probe.mjs`
- Create: `scripts/probes/bitstamp-ws-probe.mjs`
- Create: `scripts/probes/bitstamp-settlement-probe.mjs`

Questions this venue raises:

- Which Bitstamp entity offers perpetuals after the Robinhood acquisition, to whom, and how their market symbols differ from spot.
- Whether Bitstamp publishes an index and a mark for its perpetuals, and where.
- Whether the WebSocket v2 book channels carry a sequence, or only whole snapshots.

### 5. Gemini

Files:

- Create: `docs/profiles/gemini/fees.md`
- Create: `docs/profiles/gemini/websocket.md`
- Create: `docs/profiles/gemini/rest.md`
- Create: `scripts/probes/gemini-venue-probe.mjs`
- Create: `scripts/probes/gemini-ws-probe.mjs`

Questions this venue raises:

- Which Gemini entity offers perpetuals, to whom, and in which settlement asset.
- Where the index, the mark and the funding rate of a perpetual are published, and whether one call returns them for every perpetual.
- Whether the market data socket's level 2 channel carries a sequence and a snapshot.

### 6. Comparison doc

- Create: `docs/research/2026-09-15-five-venue-integration.md`
- One table per concern: catalog, fees, book feed, anchor, access.
- A verdict per venue: fits the current shape as is, fits with a named change, or blocked, with the reason.
- Every blocker, conflict and open question the five profiles raised, each linked to its profile section.

### 7. Second verification pass

Run by the main session, independently of the researchers' scripts, for each venue:

- The VIP 0 perpetual taker against the official fee page.
- One anchor bulk call: the fields exist, the units match the profile, and a tracked symbol is present.
- One book subscription: the first frame is the documented snapshot, and two deltas satisfy the documented sequence rule.
- One book size against CCXT's `contractSize` for the same market.
- `market.id` from CCXT against the symbol the socket and the anchor reply spell.

A failed claim is corrected in the profile and recorded in the comparison doc.

### 8. Index and reconcile

- Modify: `docs/README.md` with one line per new profile, the comparison doc, this design and this plan.
- Check prose rules over every new doc: one sentence per line, no semicolons joining ideas, no em-dashes, no arrows.
- Check every relative link resolves.
- Reconcile the design and this plan against what was delivered, then move both to `docs/implemented/`.

## Reconciliation

Tasks 1 to 5 were written by five researchers, who were stopped on 2026-09-15 at about 07:40 UTC before their own second pass.
At that point `docs/profiles/mexc/websocket.md` did not exist, and every other profile carried a note that it was unverified.
The same evening two agents finished the work: one wrote the MEXC socket profile and checked MEXC and Gate, and the other checked Bitget, Gemini and Bitstamp.
Their corrections are recorded in place in each profile, and every profile's status is Done.

Task 7 ran as planned, with the main session's own scripts, on all five venues.
The VIP 0 taker was confirmed on the official page for Gate, MEXC and Gemini by the main session, and for Bitget and Bitstamp by the second pass.
Task 6 is [`../research/2026-09-15-five-venue-integration.md`](../research/2026-09-15-five-venue-integration.md).
Each venue ended with two or three probe scripts instead of one, as the file lists above now say.
