# Schema Rework Design

**Status:** Done.

**Archived:** 2026-08-19.

## Purpose

This design records the rework of [`server/prisma/schema.prisma`](../../server/prisma/schema.prisma) that was needed before the BullMQ write path could carry a closed opportunity into Postgres.

The old schema was written before the engine existed.
It modelled venues as exchanges, kept socket settings and fee schedules in two tables, and stored an opportunity as a single peak snapshot.
The engine in [`server/src/engine/cluster/types.ts`](../../server/src/engine/cluster/types.ts) had since settled on a different vocabulary and a much richer opportunity, so every write would have needed a translation layer that threw most of the episode away.

The reworked schema mirrors the engine types instead.
It is an outlining schema for the testing stage, not the final one.

## Scope

This work changes the Prisma schema, adds one migration, and renames the ccxt wrapper types to the venue vocabulary.

This work does not:

- add a catalog sync that fills Venue, Pair, and Market from ccxt,
- change `OpportunityManager`, which still returns a closed `Opportunity` instead of enqueueing it,
- add the per venue config that replaces the deleted `ExchangeConfig` and `ExchangeFee` tables,
- touch `server/src/feeds/book/ws.spec.ts`, which was a stale pre-engine draft that still failed `tsgo -p tsconfig.json --noEmit` for reasons unrelated to this work, and which has since been removed.

## Decisions

1. Exchange becomes Venue everywhere.
   The model is `Venue`, its natural key is `slug`, and every foreign key that pointed at an exchange now points at a venue.
   `slug` must equal `Venue.id` in the engine types, which is also the ccxt exchange id.
2. `ExchangeConfig` and `ExchangeFee` are deleted.
   Socket settings already have a home in code as `VenueSpec` in [`server/src/feeds/book/types.ts`](../../server/src/feeds/book/types.ts), and fee schedules belong next to it.
   The venue research that seeded those tables is preserved under [`profiles/`](../profiles/), so nothing is lost by dropping them.
3. `Pair` is unchanged.
   Its `symbol` is the engine `PairKey`, spelled `BTC|USDT`.
4. `Market` mirrors the engine `Market`.
   It keeps `rawMarketId`, `linear`, and `takerPpm` from the engine type, adds `makerPpm` for the maker side the engine does not read yet, and replaces the `MarketStatus` enum with an `active` boolean.
   `tickSize`, `qtyStep`, `minNotional`, `feeClass`, and `lastSeenAt` are gone, because nothing reads them.
5. `ArbitrageOpportunity` mirrors the engine `Opportunity`.
   One row is one closed episode.
   It carries the open snapshot, the close, the episode aggregates, and the four index aligned series, so a later analysis can replay the whole episode tick by tick.
6. Prices and ppm readings are `Float`, not `Decimal`.
   The engine holds them in `Float64Array`, and a double survives a JSON round trip through the queue without loss.
   A `Decimal(38, 18)` column would only add a string conversion on both ends and imply a precision the engine never had.
7. The two legs of an opportunity are recorded by venue slug and raw market id rather than by foreign key.
   The engine speaks in slugs and has no database ids, so a foreign key would force an id lookup on every write and a catalog sync that does not exist yet.
   Recording the slugs also keeps a row readable after a delisting or a catalog rebuild.
   `Market` can still be joined on `venueId` and `rawMarketId` when a query needs the catalog.
8. The per tick series are Postgres scalar lists: `Int[]` for `sampleTsMs` and `Float[]` for the three price and ppm series.
   A separate sample table would multiply row counts by the tick rate for no gain at this stage.
9. Timestamps are `DateTime` and durations are integer milliseconds.
   The engine holds epoch milliseconds, so the converter wraps them in `new Date(...)`.
   Only columns whose unit is milliseconds carry the `Ms` suffix, which is `sampleTsMs` and `durationMs`.
10. `pair` and `route` are stored as plain strings on the opportunity.
    They are the two keys the engine already groups by, and `route` is exactly `OpportunityManager.getRouteKey`, spelled `bybit-binance`.
    Both are indexed with `openedAt` so the common analysis queries need no join.
11. The `Opportunity` to row converter lives in [`server/src/db/conversion.ts`](../../server/src/db/conversion.ts) as `toOpportunityRow`.
    That keeps [`server/src/db/writes.ts`](../../server/src/db/writes.ts) free of engine types, as its own comment promises, and keeps the queue payload plain JSON.
    Conversion sits beside the write path rather than inside the engine, because the engine only needs the queue and never the row shape.
    Its `min` helper moved to `server/src/shared/shared.ts` alongside `max`, since neither is specific to an opportunity.
    Both were dropped later, because [`OpportunityLifecycle.ts`](../../server/src/engine/opportunity/OpportunityLifecycle.ts) tracks `minNetPpm` as each sample arrives and never scans the finished series.
    The queue name and the job type live in [`server/src/engine/opportunity/OpportunityWorker.ts`](../../server/src/engine/opportunity/OpportunityWorker.ts) next to the consumer that reads them, so there is no separate contract file.
12. The migration is additive on top of the existing history rather than a fresh single init.
    `20260819000000_venue_core` drops the exchange tables, drops and rebuilds `Market` and `ArbitrageOpportunity`, keeps `Pair`, and creates `Venue`.
    It applies cleanly to a fresh database and to a database already carrying the two earlier migrations.

## Column sources

Every `ArbitrageOpportunity` column and the exact engine expression that fills it.
The source is a closed `Opportunity` named `o`, plus the `pair` and `route` the manager already holds at close time.

| Column | Source |
| --- | --- |
| `pair` | the `PairKey` key of the map the opportunity lived in |
| `route` | `OpportunityManager.getRouteKey(o.highestBidMarket, o.lowestAskMarket)` |
| `highestBidVenue` | `o.highestBidMarket.venueId` |
| `highestBidRawMarketId` | `o.highestBidMarket.rawMarketId` |
| `lowestAskVenue` | `o.lowestAskMarket.venueId` |
| `lowestAskRawMarketId` | `o.lowestAskMarket.rawMarketId` |
| `highestBidTakerPpm` | `o.highestBidMarket.takerPpm` |
| `lowestAskTakerPpm` | `o.lowestAskMarket.takerPpm` |
| `openedAt` | `o.openedAt` |
| `netPpmAtOpen` | `o.netPpmAtOpen` |
| `highestBidAtOpen` | `o.highestBidAtOpen` |
| `lowestAskAtOpen` | `o.lowestAskAtOpen` |
| `closedAt` | `o.closedAt`, which the converter refuses to accept as null |
| `closeReason` | `o.closeReason`, which the converter refuses to accept as null |
| `netPpmAtClose` | `o.lastNetPpm` |
| `lastSeenAt` | `o.lastSeenAt` |
| `durationMs` | `o.closedAt - o.openedAt` |
| `ticks` | `o.ticksSinceStart` |
| `avgNetPpm` | `o.netPpmSum / o.ticksSinceStart` |
| `peakNetPpm` | `o.peakNetPpm` |
| `peakAt` | `o.peakAt` |
| `peakHighestBid` | `o.peakHighestBid` |
| `peakLowestAsk` | `o.peakLowestAsk` |
| `minNetPpm` | one pass over `o.netPpmSeries` |
| `sampleTsMs` | `o.sampleTs` |
| `netPpmSeries` | `o.netPpmSeries` |
| `highestBidSeries` | `o.highestBidSeries` |
| `lowestAskSeries` | `o.lowestAskSeries` |

`highestBidVenueIndex` and `lowestAskVenueIndex` are deliberately not stored.
They are positions inside a runtime cluster array and mean nothing once the process restarts.

`netPpmSum` is not stored either, because `avgNetPpm` and `ticks` reconstruct it.

`peakHighestBid` and `peakLowestAsk` are the two prices read at the tick where `netPpm` peaked.
They are not the extremes of their own series.
`minNetPpm` is the worst reading of the episode, and the engine tracks no running trough, so the converter scans the series once at close time.

The gap between `lastSeenAt` and `closedAt` is the close reason in disguise.
A wide gap means the route closed because its quotes went stale or its venue dropped.
A gap of zero means the spread collapsed on a live tick.

## Rejected alternatives

- Foreign keys from `ArbitrageOpportunity` to `Market` and `Pair`.
  Rejected because the engine has no database ids, so every write would need a boot time catalog sync and a slug to id cache that do not exist yet.
  This is the one decision most likely to be revisited once a catalog sync lands.
- `Decimal(38, 18)` for prices, as the old schema had.
  Rejected because the engine never holds a decimal, so the column would only add conversions and imply precision that is not there.
- A separate opportunity sample table with one row per tick.
  Rejected as far too heavy for a testing stage schema.
  Scalar lists give the same data with one row per episode.
- Keeping the `ArbitrageKind` and `MarketStatus` enums.
  Rejected because a single valued enum and a two valued enum are noise.
  A boolean covers the second, and the first can come back when a non CEX to CEX route exists.
- A `closeReason` column.
  Rejected for now because the engine does not record one, and `lastSeenAt` against `closedAt` already separates a stale close from a collapsed spread.
- Storing `linear` per leg on the opportunity.
  Rejected because `Market.linear` is recoverable by joining on venue slug and raw market id.
- Deleting the two committed migrations and generating one clean init.
  Rejected because it would need a database reset and would drop the seeded venue research from the migration history for no functional gain.

## Follow-ups

1. A catalog sync that upserts `Venue`, `Pair`, and `Market` from the ccxt connector at boot.
   Nothing writes those three tables today.
2. `OpportunityManager.closeOpportunity` should call `toOpportunityRow` and enqueue a batch instead of returning the `Opportunity`.
   The queue and the worker are already in place.
3. The per venue config that replaces `ExchangeConfig` and `ExchangeFee`, built from [`profiles/`](../profiles/) and shaped like `VenueSpec`.
4. `Market.makerPpm` has no engine consumer yet, because the engine only builds taker multipliers.
