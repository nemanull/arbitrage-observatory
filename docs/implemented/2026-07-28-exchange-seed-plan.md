# Exchange Reference Data Seed Plan

**Goal:** Get the schema into the database and seed the five exchanges with their connection settings and published spot fees.

**Design of record:** [`2026-07-28-exchange-seed-design.md`](./2026-07-28-exchange-seed-design.md).

**Status:** Done.

## Scope guard

This work does not add exchange adapters, WebSocket clients, or a connection manager.
It does not create `Pair`, `Market`, or `ArbitrageOpportunity` rows, which belong to the market sync job and the detector.
It does not seed VIP tiers, token discounts, market maker programmes, or regional entity schedules.
It does not seed derivatives, margin, or funding rates, because the schema covers spot only.
It does not resolve which pairs belong to which fee class, because no venue publishes that membership in the profiles.
It does not call any exchange endpoint.

## Task 1: Create and apply the schema migration

**Files:** `server/prisma/migrations/20260729044018_init/migration.sql`.

Generated with `prisma migrate dev --create-only --name init`, reviewed, then applied.
It creates two enums, six tables, thirteen indexes, and six foreign keys.
No hand edits were made to the generated SQL.

## Task 2: Extract the reference values from the profiles

The profiles under [`profiles/`](../profiles/) total about 8,800 lines, which is more than one reading pass can hold.
Two subagents read them, one across the five `websocket.md` files and one across the five `fees.md` files.
Both were required to return a file and line citation with the quoted line for every value, and were forbidden from using web search or model memory.
Every citation was then checked by hand against the file before anything was written to the database.

## Task 3: Write and apply the seed migration

**Files:** `server/prisma/migrations/20260729045500_seed_exchanges/migration.sql`.

Hand written SQL.
Five `Exchange` rows, five `ExchangeConfig` rows, and fifteen `ExchangeFee` rows.
Foreign keys are resolved by subselect on `Exchange.slug`.

## Seeded connection settings

Published values are copied from the profile.
Derived values are marked, and the derivation is repeated in a comment above the row in the migration.

| Exchange | wsUrl | Streams | Args | Subscribe ms | Keepalive ms | Idle ms | Max age ms | Reconnect ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| binance | `wss://stream.binance.com:9443/stream` | 1024 | 1024 | 500 | null | 60000 | 86400000 | 2000 |
| bybit | `wss://stream.bybit.com/v5/public/spot` | 900 | 10 | 200 | 20000 | 600000 | null | 1500 |
| okx | `wss://ws.okx.com:8443/ws/v5/public` | 500 | 500 | 10000 | 25000 | 30000 | null | 1000 |
| coinbase | `wss://advanced-trade-ws.coinbase.com` | 100 | 100 | 500 | null | 60000 | null | 500 |
| kraken | `wss://ws.kraken.com/v2` | 200 | 40 | 1000 | 30000 | 60000 | null | 5000 |

### Where each value came from

| Field | binance | bybit | okx | coinbase | kraken |
| --- | --- | --- | --- | --- | --- |
| wsUrl | Published, `websocket.md:84` | Published, `websocket.md:75` | Published, `websocket.md:35` | Published, `websocket.md:51` | Published, `websocket.md:62` |
| Streams per connection | Published 1,024, `websocket.md:254` | Derived from the 21,000 character argument budget, `websocket.md:260` | Derived from the 64 KB payload cap, `websocket.md:224` | Not published, engineering cap | Borrowed from the level three limit of 200 symbols, `websocket.md:283` |
| Args per subscribe | Not published, capped at the connection limit | Published 10, `websocket.md:261` | Derived from the same 64 KB cap | Not published, engineering cap | Derived from the 200 unit counter at 5 units per symbol, `websocket.md:284` |
| Subscribe interval | Derived from 5 inbound messages per second, `websocket.md:253` | No published inbound rate, plain default | Derived from 480 operations per connection per hour, `websocket.md:223` | Derived from 8 messages per second per IP, `websocket.md:225` | Derived from the level three counter, `websocket.md:284` |
| Keepalive | Null, the venue pings every 20 seconds, `websocket.md:251` | Published 20 seconds, `websocket.md:236` | Under 30 seconds, `websocket.md:86` | Null, liveness is the server-pushed heartbeats channel | Half the one minute idle window, `websocket.md:87` |
| Idle timeout | Pong deadline of 1 minute, `websocket.md:252` | About ten minutes, `websocket.md:266` | The 30 second ping window, `websocket.md:86` | Lower bound of the 60 to 90 second range, `websocket.md:88` | About one minute, `websocket.md:87` |
| Max connection age | Published 24 hours, `websocket.md:250` | Not published | Not published | Not published | Not published |
| Reconnect delay | Half of 300 attempts per 5 minutes per IP, `websocket.md:255` | 40 percent of 500 per 5 minutes per IP per domain, `websocket.md:258` | A third of 3 handshakes per second per IP, `websocket.md:222` | A quarter of the lower of two conflicting limits, `websocket.md:229` | Kraken's own 5 second recommendation, `websocket.md:91` |

### Endpoint choices worth knowing

Binance uses the combined stream path rather than the raw path, because the envelope names the source stream once one socket carries hundreds of streams.
Bybit has no bid or ask on its spot ticker, so top of book has to come from the one level order book channel.
OKX has a 10 millisecond top of book channel that is faster than its 100 millisecond ticker and is not tier gated.
Coinbase Advanced Trade was chosen over Coinbase Exchange, whose level two feed requires authentication and whose public substitute is batched at 50 milliseconds.
Coinbase has no top of book channel at all, so best bid and ask must be derived from the level two book.
Kraken can trigger its ticker on best bid and offer, but a size change at an unchanged price may not push, so the depth ten book stays the only checksum validated size source.

## Seeded fees

All rates are the entry tier, in parts per million, with `effectiveFrom` set to the profile retrieval date of 2026-07-26.

| Exchange | Fee class | Maker ppm | Taker ppm | Published as | Applies to |
| --- | --- | ---: | ---: | --- | --- |
| binance | `default` | 1000 | 1000 | 0.100% and 0.100% | Ordinary spot pairs at the Regular tier |
| binance | `usdc_pairs` | 1000 | 950 | Standard and 0.095% | The pairs Binance treats as USDC pairs |
| bybit | `default` | 1000 | 1000 | 0.1000% and 0.1000% | Global spot crypto pairs at VIP 0 |
| bybit | `fiat_pairs` | 1500 | 2000 | 0.1500% and 0.2000% | Fiat quoted pairs below the first VIP 0 fiat volume band |
| bybit | `adventure_zone_and_xstocks` | 2000 | 2000 | 0.2000% and 0.2000% | Adventure Zone and tokenized equity listings |
| okx | `default` | 800 | 1000 | 0.080% and 0.100% | Pair groups one, two, and three at the Regular tier |
| okx | `special_pairs` | 1000 | 1500 | 0.100% and 0.150% | The special pairs column of the global fee framework |
| okx | `stablecoin_pairs` | 0 | 500 | 0% and 0.05% | The pairs named in the later stablecoin notices |
| okx | `zero_fee_pairs` | 0 | 0 | 0% and 0% | The zero-fee column of the global fee framework |
| coinbase | `default` | 4000 | 6000 | 0.40% and 0.60% | The published maximum Advanced Trade rate |
| kraken | `default` | 4000 | 8000 | 0.40% and 0.80% | Standard Kraken Pro spot pairs at Tier 1 |
| kraken | `maker_rebate_pairs` | 3800 | 8000 | 0.38% and 0.80% | The eligible maker rebate pair list |
| kraken | `stablecoin_fx_pairs` | 2000 | 2000 | 0.20% and 0.20% | Named stablecoin and foreign exchange pairs |
| kraken | `usdg_base_pairs` | 0 | 100 | 0.00% and 0.01% | Pairs with USDG as the base asset |
| kraken | `xstocks` | -200 | 1000 | -0.02% and 0.10% | Eligible tokenized equity pairs, where maker is a rebate |

Groups one, two, and three on OKX print the same rate at the Regular tier, so they were collapsed into `default` rather than seeded three times.
Binance prints the word `Standard` in the USDC maker column, which the profile defines as the standard maker value for that row.
Kraken xStocks is the only negative rate in the set, and it is what the signed ppm column exists for.

### Entities that were deliberately not seeded

Coinbase Advanced Trade does not publish a per-account rate, only a ceiling that Advanced rates do not exceed.
That ceiling is seeded, and it happens to equal the entry tier of the separate Coinbase Exchange schedule.
The Coinbase Exchange stable-pair rate of 0.00% maker and 0.0045% taker was not seeded, because it belongs to Coinbase Exchange and Advanced Trade publishes no equivalent.
Binance.US, Binance TH, Tokocrypto, Binance Japan, Bybit EU, Bybit Indonesia, Bybit Turkiye, Bybit Georgia, Bybit Kazakhstan, and the OKX US, EEA, Australia, Singapore, UAE, Turkey, and Brazil entities all run their own schedules and are out of scope.
Coinbase International Exchange spot is a separate venue and was not seeded.

## Open questions for the next stage

These are recorded here because they are cheap to note now and expensive to rediscover later.

1. Fee class membership is unresolved for eight of the fifteen classes.
   Every market therefore starts on `default`, which is the schema default.
   That is the safe direction for Kraken and Bybit, whose non-default classes are mostly cheaper than default.
   It is the unsafe direction for OKX `special_pairs`, which is more expensive than `default`, so an OKX special pair would look more profitable than it is until membership is resolved.
2. `subscribeIntervalMs` means different things per venue.
   On Binance the underlying limit is per connection, and on Coinbase it is per IP and therefore shared by every connection the process opens.
   The connection manager has to know which of the two it is dealing with, and the schema does not currently record it.
3. Nothing enforces that one fee class has exactly one open row.
   The unique constraint covers exchange, class, and start date, so two rows with a null `effectiveTo` are possible.
   Postgres can express this with a partial unique index, but Prisma cannot declare one, so raw SQL here would show up as drift on the next migration.
   Until a rate actually changes, reading the row with the latest `effectiveFrom` and a null `effectiveTo` is enough.
4. Bybit allows only ten arguments per subscribe request, which is by far the tightest of the five.
   Three hundred symbols means thirty messages on that venue and one on OKX.
   The subscribe pacing loop should not assume the venues are alike.
5. Coinbase publishes two contradicting connection rate limits, and the profile instructs using the lower one until support confirms.
   The seeded value follows that instruction.

## Verification

All of the following were run and passed.

```bash
pnpm --filter server exec prisma migrate status
pnpm --filter server run typecheck
```

Row counts are five exchanges, five configs, and fifteen fees.
Every seeded ppm value was converted back to a percentage in SQL and compared against the percentage the profile prints, and all fifteen matched.
Every file and line citation returned by the extraction agents was opened and confirmed to contain the quoted text.
`prisma migrate dev` replayed both migrations against a shadow database from empty before applying, which is the fresh database check the design asks for.

## Reconciliation

The work matches the design.
Reference data ships in a migration, schema and data are in separate migrations, entry tier rates were used, foreign keys resolve by slug, and `effectiveFrom` is the retrieval date.

One decision was made during execution that the design did not anticipate.
The design assumed one exchange means one venue, but Coinbase runs several platforms with different fee schedules and different WebSocket feeds.
Advanced Trade was chosen for both, so that the seeded fee and the seeded endpoint describe the same venue.
The design has been updated to record this.

Two subagents were used for extraction rather than one agent per exchange, which is enough for five documents of this size and costs a fraction as much.
