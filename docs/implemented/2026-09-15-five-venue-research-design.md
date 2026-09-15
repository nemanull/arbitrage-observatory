# Five venue research, design

Design of record for researching Gate, Bitget, MEXC, Bitstamp and Gemini as the next venues of the engine.
The work is documentation and read-only probe scripts.
It adds no runtime code and no registry entry.

**Status:** Done.

**Archived:** 2026-09-15.

## Purpose

The engine runs five venues today, and each one plugs in through the same three parts.
A CCXT catalog supplies the markets, a WebSocket book feed is the only writer of quotes and depth, and a REST anchor poller is the only writer of index, mark and funding.
This research answers, for each new venue, everything those three parts and the fee registry need, with evidence a later design can cite.

The July package in [`../implemented/2026-07-26-exchange-profiles-design.md`](../implemented/2026-07-26-exchange-profiles-design.md) was written from documentation alone.
Later work showed the wire and the documents disagree often enough that a frame capture has to back every protocol claim, see [`../research/2026-09-06-venue-depth-endpoints-probe.md`](../research/2026-09-06-venue-depth-endpoints-probe.md) section 1c.
This package therefore probes every load-bearing claim live.

## What the engine needs from a venue

Each item cites the code that consumes it.
A researcher answers every item for every perpetual family the venue lists.

### 1. Catalog

- The catalog is `loadMarkets` from CCXT 4.5.68, filtered to active swaps, at [`../../server/src/ccxt/connector.ts`](../../server/src/ccxt/connector.ts) lines 71 and 188 to 194.
- `market.id` becomes `rawMarketId`, and it must be the symbol exactly as the socket and the anchor reply spell it, at [`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts) line 11.
  A mismatch is silent except for one warning per symbol, at [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) lines 170 to 189.
- `base`, `quote`, `linear` and `contractSize` come straight from the CCXT market, and a missing or non-positive contract size becomes 1, at [`../../server/src/ccxt/connector.ts`](../../server/src/ccxt/connector.ts) lines 149 to 186.
  Book sizes are multiplied by the contract size, so the unit the socket reports must match the unit CCXT's `contractSize` describes, at [`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts) line 56.
- A venue contributes one market per pair, and a venue listing two contracts on one pair picks one with `marketFilter`, at [`../../server/src/ccxt/types.ts`](../../server/src/ccxt/types.ts) lines 14 to 21.
  USD, USDC and USDT are one settlement family, see [`../implemented/2026-09-06-quote-family-design.md`](../implemented/2026-09-06-quote-family-design.md).
- A contract quoted per 10 or per 1000 units needs a price scale, at [`../../server/src/engine/cluster/clusterOverrides.ts`](../../server/src/engine/cluster/clusterOverrides.ts) lines 14 to 23.
- A ticker that names a different token on another venue needs a `DENIED_PAIRS` line, at the same file, lines 7 to 12.

### 2. Fees

- `takerPpm` in [`../../server/src/venues/registry.ts`](../../server/src/venues/registry.ts) overrides CCXT's per market `taker`, and `ccxtTakerPpm` declares the CCXT constant the connector should expect, at [`../../server/src/ccxt/connector.ts`](../../server/src/ccxt/connector.ts) lines 29 to 31 and 154.
- The registry comments cite the CCXT source line of that constant, so the research records it for each venue.
- The engine models a taker cross at the base retail tier, so the VIP 0 perpetual taker is the number that matters, and the full perpetual tier table is context.

### 3. Book feed

- A venue subclass implements `planEndpoints`, `getSubscribeFrames`, `startKeepalive` and `handleMessage`, and sets `maxSilenceMs`, at [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) lines 22 and 316 to 322.
- Permessage deflate is refused on every socket, at line 77, so a venue that forces compression, or compresses inside the frame, has to be flagged.
- The subclass keeps a book with `resetBook`, `setBid`, `setAsk` and `publish`, and on a sequence gap it calls `resync`, which terminates the socket and resubscribes, at lines 192 to 244.
  So the feed needs a snapshot on subscribe, a per symbol sequence rule, or both.
- The engine holds `depthLevels` per side, 20 by default, at [`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts) line 61, so a depth channel of at least 20 levels is wanted.
- The Bybit feed at [`../../server/src/venues/bybit/bybit.ts`](../../server/src/venues/bybit/bybit.ts) is the reference shape: one URL per family, a slice of markets per connection sized by the venue's cap, an application ping, a gap check on the update id.

### 4. Anchor

- A poller returns one `AnchorRow` per tracked market, keyed by `rawMarketId`, from a bulk reply, at [`../../server/src/feeds/anchor/AnchorPoller.ts`](../../server/src/feeds/anchor/AnchorPoller.ts) line 242 and [`../../server/src/feeds/anchor/types.ts`](../../server/src/feeds/anchor/types.ts).
- The row is `index`, `mark`, `fundingRate` as a fraction for the upcoming settlement, `fundingIntervalHours` and `nextFundingAt` in Unix ms, at [`../../server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts) lines 32 to 49.
  A mark of 0 means the venue publishes none, and the route is refused at open.
- The poll runs once a second by default, stamps each reading on arrival, and pauses on 403, 418 and 429 using `Retry-After` when present, at [`../../server/src/feeds/anchor/AnchorPoller.ts`](../../server/src/feeds/anchor/AnchorPoller.ts) lines 34, 103 to 106 and 188 to 191, and [`../../server/src/shared/errors.ts`](../../server/src/shared/errors.ts) line 1.
- The reader refuses two legs read more than 5 s apart, a reading older than 10 s, and an index or mark that moved more than 1,000 ppm in one poll, at [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) lines 4 to 6.
  So a reply slower than about 2 s, or a venue that republishes slower than a few seconds, has to be flagged.
- Two index and mark shapes have already produced false rows.
  A mark whose premium the venue caps reads a capped leg as fresh.
  An index basket that is the venue's own perp makes the mark trail the perp, see [`../research/2026-09-15-one-self-index-fresh-gate.md`](../research/2026-09-15-one-self-index-fresh-gate.md).
  The research records each venue's index, mark and funding formula, every clamp, and the basket endpoint if one exists.

## Deliverables

Each venue gets a profile folder named by its CCXT id, beside the five existing ones under [`../profiles/`](../profiles/).

- `docs/profiles/<venue>/fees.md` records the perpetual fee model, every perpetual tier, funding, the CCXT constant, and the registry values this research recommends.
- `docs/profiles/<venue>/websocket.md` records the public book channels on the sixteen axes of [`../research/2026-07-30-venue-ws-protocol-differences.md`](../research/2026-07-30-venue-ws-protocol-differences.md), with captured frames and a recommended feed shape.
  Private channels get one short section naming them for a future execution stage.
- `docs/profiles/<venue>/rest.md` records the catalog, the anchor, the REST book snapshot, rate limits, errors and host latency, with a recommended poller shape.
- `scripts/probes/<venue>-*-probe.mjs` are the read-only scripts behind every probed number, two or three per venue.
- `docs/research/2026-09-15-five-venue-integration.md` compares the five on one page, states what fits the current shape as is, and lists every blocker and open question.

The CCXT ids are `gate`, `bitget`, `mexc`, `bitstamp` and `gemini`.

## Evidence labels

The July labels still apply: `Published`, `Dynamic`, `Account-gated`, `Negotiated`, `Region-specific`, `Not offered` and `Not publicly specified`.
This package adds `Probed`, which means a script under `scripts/probes/` observed it from this host on the stated date.
A number with neither a source link nor a probe behind it is not written.
When the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## Decisions

1. One researcher per venue, five in total, each owning its profile folder and its probe scripts.
   A venue's context stays whole, and no two researchers write the same file.
   The second pass over the profiles is run by at most two agents, each owning a disjoint set of venues.
2. Fees are scoped to perpetual trading: every perpetual tier, discounts that apply to perpetuals, funding, liquidation and settlement charges.
   Deposit, withdrawal, card, staking and spot schedules get one line pointing at the official lookup.
3. Every perpetual family the venue lists is covered: USDT margined, USDC margined, coin margined, and any other settlement asset.
   Dated futures and options are named in the coverage matrix and not detailed.
4. Every protocol claim the feed or the poller would depend on is probed live, and the capture is quoted in the profile.
5. Probes are public, unauthenticated and read-only, and they stay well inside each venue's published limits.
6. A venue's CCXT class is read at the installed 4.5.68, and each claim about it cites `server/node_modules/ccxt/js/src/<venue>.js` with a line.
7. The researchers do not edit [`../README.md`](../README.md), the code, or any file outside their venue.
   The main session writes the comparison, runs its own checks of the load-bearing claims, and indexes the docs.
8. Each profile ends with a recommended shape for the feed, the poller and the registry entry, stated as a recommendation for a later design, not as a decision.
9. Access boundaries are recorded as facts: who may trade the perpetuals, and whether the public endpoints answered from this host, which sits near Seattle.

## Rejected alternatives

### The July all-fee scope

Cards, staking, custody and withdrawal schedules for five more venues would roughly double the reading and none of it reaches the engine.
It was rejected because the engine models a perp to perp taker cross and nothing else.

### Documentation only

It is faster and it repeats the failure the depth probe found, where Kraken's documented bid order was the opposite of the wire.
It was rejected because every feed shipped since 2026-09-07 was built from captures.

### One researcher per topic across all five venues

A fees researcher, a socket researcher and an anchor researcher would each hold five venues at once.
It was rejected because a venue's catalog, book units and anchor keys depend on each other, and one context per venue keeps those joins checkable.

### CCXT Pro as the feed

It was rejected in [`../research/2026-07-30-ccxt-ws-ingest-feasibility.md`](../research/2026-07-30-ccxt-ws-ingest-feasibility.md) and nothing about these venues changes that.

## Verification

A second pass runs over every profile: every probe rerun, every number against its source or its probe, every JSON block parsed, every link resolved.
The main session then re-probes the load-bearing claims itself, independently of the researcher's script.
Those are the VIP 0 taker, the anchor bulk call and its fields, the book channel's snapshot and sequence rule, the size unit against CCXT's contract size, and the market id against the socket's symbol.
A claim that fails the re-probe is corrected in the profile and noted in the comparison doc.

## Reconciliation

The five researchers wrote fourteen of the fifteen profiles and every probe script, then were stopped on 2026-09-15 at about 07:40 UTC before any finished its own second pass.
The user asked for the rest to be finished with at most two agents.
One agent wrote `docs/profiles/mexc/websocket.md` and ran the second pass over MEXC and Gate.
The other ran the second pass over Bitget, Gemini and Bitstamp.
Both reran the probes and reread the sources that evening, corrected numbers in place, and set each profile's status to Done.

The main session checked the load-bearing claims with its own scripts, kept outside the repo, on all five venues.
It rendered Gate's fee page in headless Chrome and confirmed the 500 ppm VIP 0 taker that the second pass could not read.
The results are section 8 of [`../research/2026-09-15-five-venue-integration.md`](../research/2026-09-15-five-venue-integration.md).

The probe scripts ended up as two or three per venue rather than one: a REST or venue probe, a socket probe, and for Bitget and Bitstamp a settlement probe.
No runtime code, registry entry or other venue's profile was changed.
