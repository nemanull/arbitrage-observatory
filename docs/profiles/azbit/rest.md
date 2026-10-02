# Azbit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:17 and 03:46 UTC on 2026-09-23.

This profile covers the public REST API of Azbit, which has no CCXT class, for its one perpetual family, USDT-margined linear contracts.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/azbit/rest-probe.mjs) unless a source id says otherwise.
The API reference is the OpenAPI file at `https://data.azbit.com/swagger/v1/swagger.json`, S1, whose description is unusually complete, and the pages at `https://docs.azbit.com/docs/`, S2.
The probe also reads Bybit's public linear market beside Azbit's, because the Azbit perpetual catalog, schedule and book match Bybit's.

## 1. Host and latency from this machine

| host | resolved | edge |
|---|---|---|
| `data.azbit.com` | `172.67.71.46`, `104.26.4.121`, `104.26.5.121` | Cloudflare, `cf-ray` suffix `SEA` or `YVR` |
| `ws.azbit.com` | the same three addresses | Cloudflare |

| call | first request | warm requests |
|---|---|---|
| `GET /api/healthcheck`, 10 calls 300 ms apart, two runs | 717 and 692 ms | 9 calls per run: min 173 and 169, median 174 and 172, max 207 and 178 ms |
| `GET /api/futures/exchange-data/pairs`, 45,368 and 45,356 bytes | 494 and 478 ms | 60 polls per run: min 173 and 324, median 312 and 332, p90 316 and 360, max 948 and 561 ms |
| `GET /api/futures/trade/orderbook/BTCUSDT`, about 3.6 KB | 176 and 174 ms | 40 reads per run: min 161 and 173, median 164 and 179, p90 201 and 204, max 325 and 286 ms |

`GET /api/healthcheck` answers `"PublicApi v1.0.12.7"`.
Replies carry `content-encoding` and no rate limit header.

## 2. Catalog

### The instruments call

`GET https://data.azbit.com/api/futures/exchange-data/pairs` returns one array of every futures pair with no paging, S1.

| field | meaning, S1 | on the wire |
|---|---|---|
| `currencyPairCode` | "Pair code in `BASE_QUOTE` form", which the WebSocket reference contradicts with "Pair codes have no underscore" | no underscore on 160 rows, as `BTCUSDT`, and `$BTC_TOP` on one |
| `isActive` | "False while the pair is suspended: it still appears in listings but takes no new orders" | true on all 161 |
| `contractValue` | "Base-asset quantity represented by one contract" | 0.001 for `BTCUSDT`, 0.01 for `ETHUSDT`, 100 for `1000PEPEUSDT` |
| `lotSize` | "Smallest tradable step in the base asset" | equal to `contractValue` on 160 of 161 rows, `$BTC_TOP` has 1 against 0.01 |
| `fundingRate`, `fundingRateStartTimestamp`, `fundingRateFinishTimestamp` | section 3 | |
| `basePricePrecision`, `quantityPrecision`, `quotePricePrecision` | decimal places | |
| `id` | "Internal pair identifier" | 0 on every row |

| family | active count on 2026-09-23 03:23 UTC | codes |
|---|---:|---|
| USDT-M linear | 161 | 157 of the form `BTCUSDT`, the index pair `$BTC_TOP`, and `TSLA`, `BRENT` and `EURUSD` |

Every code is listed once, so no pair is listed twice.
Six contracts are quoted per 1,000 tokens, `1000PEPEUSDT`, `1000FLOKIUSDT`, `1000BTTUSDT`, `1000LUNCUSDT`, `1000BONKUSDT` and `SHIB1000USDT`, spelled exactly as Bybit spells them.
`TSLA`, `BRENT` and `EURUSD` carry no quote suffix, and `$BTC_TOP` is an index pair, which the error codes describe as a pair with weighted components, S1.

### How a catalog would map it

CCXT 4.5.68 has no Azbit class, and the current CCXT master has none either, see [`fees.md`](./fees.md) section 8.
The engine builds its catalog from CCXT `loadMarkets`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68 and 79, so Azbit cannot enter the catalog without a class or a hand-built loader.
A hand-built loader would map fields as follows.

| engine field | Azbit source | note |
|---|---|---|
| `rawMarketId` | `currencyPairCode` | identical to the socket's `currencyPairCode`, see [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | the code less its `USDT` suffix, and `USDT` | `TSLA`, `BRENT`, `EURUSD` and `$BTC_TOP` do not split this way |
| `linear` | true | USDT-margined, S1 |
| `contractSize` | 1 | book quantities are in the base asset, not in `contractValue` units, see [`websocket.md`](./websocket.md) section 4 |
| `active` | `isActive` | true on all 161, including three pairs with no book |

### The catalog is Bybit's

| check on 2026-09-23 at 03:23 UTC, the same in the rerun at 03:43 UTC except where noted | result |
|---|---|
| Azbit codes that Bybit's linear `instruments-info` also lists | 154 of 161, out of 885 Bybit linear symbols |
| Azbit codes Bybit does not list | `IPUSDT`, `FIOUSDT`, `VINEUSDT`, `$BTC_TOP`, `TSLA`, `BRENT`, `EURUSD` |
| `lotSize` equal to Bybit's `qtyStep` | 154 of 154 |
| funding interval equal to Bybit's `fundingInterval` | 154 of 154 |
| `fundingRateFinishTimestamp` equal to Bybit's `nextFundingTime` | 154 of 154 |
| `fundingRate` equal to Bybit's current `fundingRate` | 116 of 154, and 119 of 154 in the rerun at 03:43 UTC |

| REST book at one instant, first run | Azbit top five bids and asks | Bybit top five bids and asks | top 20 bid levels equal, first run and rerun |
|---|---|---|---:|
| `BTCUSDT` | `86690x4.219,86689.9x0.001,…` | `86690x3.239,86689.9x0.001,…` | 5, 5 |
| `ETHUSDT` | `2769.33x42.27,2769.32x0.02,…` | `2769.33x41.05,2769.32x0.02,…` | 19, 3 |
| `AVAXUSDT` | `11.287x106,11.286x223.8,…` | `11.287x106,11.286x223.8,…` | 20, 0 |
| `SHIB1000USDT` | `0.006181x47850,0.00618x819390,…` | `0.006181x47850,0.00618x819390,…` | 19, 20 |

Where the two reads saw the same moment, every price level matched and the sizes that differ are the ones that moved between the reads.
In the rerun `AVAXUSDT` matched on no bid level because Bybit's best bid had moved up one tick to 11.385 while Azbit still showed 11.384 at the top.
The three pairs Bybit does not list have no book on Azbit's socket.
The socket comparison in [`websocket.md`](./websocket.md) section 4 shows every Azbit frame repeating a Bybit state a median of 90 to 168 ms after Bybit sent it.
The API reference names an "upstream venue" in its futures error codes 110601 to 110604, S1, and the evidence above says that venue is Bybit.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/futures/exchange-data/pairs` | absent | absent | `fundingRate` | `fundingRateFinishTimestamp` less `fundingRateStartTimestamp` | `fundingRateFinishTimestamp` | 45,368 bytes, 161 rows | 60 polls per run: median 312 and 332, max 948 and 561 ms |

Azbit publishes no index price and no mark price in any public REST call or WebSocket channel.
The 210 KB API reference contains no `markPrice` or `indexPrice` field, and the futures reference says "Mark-price ticks are not pushed" even on the private order channel, S1.
The web trading page shows a "Mark Price" label, S3, but where it reads it from is not part of the public API.
No reference price or basket is published either.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `currencyPairCode` | string, `BTCUSDT` | none |
| `index` | none | | 0 |
| `mark` | none | | 0, so the engine refuses every route as `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 and 38 |
| `fundingRate` | `fundingRate` | JSON number, a fraction per interval: `0.0000476` is 0.00476 % | none |
| `fundingIntervalHours` | `fundingRateStartTimestamp`, `fundingRateFinishTimestamp` | ISO strings with no zone designator, documented as UTC: `"2026-09-23T00:00:00"` | difference in hours, after appending `Z` |
| `nextFundingAt` | `fundingRateFinishTimestamp` | same | `Date.parse(value + 'Z')` |

At 03:23 and 03:43 UTC, 87 rows read the interval `00:00` to `08:00` on 2026-09-23 and 74 rows read `00:00` to `04:00`.

## 4. Anchor semantics

### Index

None published.

### Mark

None published.
Positions are liquidated on a loan to value and a margin ratio, see [`fees.md`](./fees.md) section 7, and the mark those use is Not publicly specified.

### Funding

The reference says the rate is "in force for the current interval", charged "only while a position is open", and that the finish timestamp is "when funding is settled and the next rate takes over", S1.
So the published rate is the one to be charged at `fundingRateFinishTimestamp`, which is the upcoming settlement in the engine's terms.
The formula, the cap and the floor are Not publicly specified.
No public funding history call exists, so the settlement instant was not captured.

| comparison | result |
|---|---|
| rate equal to Bybit's current rate | 116 of 154 shared contracts at 03:23 UTC, 119 of 154 at 03:43 UTC |
| rate equal to one of Bybit's last three settled rates, where it differed from the current one | 0 of the 6 checked at 03:43 UTC. `CROUSDT` read 0.00023033 against Bybit's current 0.00028499 and settled 0.0001, 0.0001 and 0.00023344 |
| rate changes over 60 one second polls | 0 on 161 contracts, in both runs |
| rate changes between the two runs | `BTCUSDT` went from 0.0000476 to 0.00002382, `CROUSDT` from 0.00010061 to 0.00023033, and `AVAXUSDT`, which differed from Bybit's current rate in the first run, equalled it in the second |

The rates therefore move within an interval and track Bybit's current rate, but not second by second.
A reading consistent with both runs is that Azbit copies Bybit's current rate at a cadence slower than a minute, which is an inference, since the copy cadence is Not publicly specified.

### How often each number changed

The funding rate did not change on any contract in 60 one second polls, at 03:24 and at 03:44 UTC, and it did change between the two runs, see the table above.
There is no index or mark to watch.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /api/futures/trade/orderbook/{currencyPairCode}`, S1 |
| depth | 50 levels per side on `BTCUSDT`, `ETHUSDT`, `EURUSD` and `$BTC_TOP`, with no depth parameter |
| level shape | `{"price": 86645.7, "quantity": 10.752}`, JSON numbers, quantity in the base asset |
| order | bids descending, asks ascending, "Bids run from the highest price down, asks from the lowest up", S1 |
| unknown or misspelt pair | `NOPEUSDT` and `BTC_USDT` answer 200 with `{"currencyPairCode":"BTC_USDT","asks":[],"bids":[]}` |
| caching | 40 reads at two per second, two runs: the Azbit top five changed between every pair of consecutive reads, and equalled Bybit's top five read at the same instant on 5 and 11 of 40 |

The socket sends 20 levels, so the REST book is the deeper of the two Azbit sources.

## 6. Rate limits and errors

"Requests are limited to 5 per second, as a fixed one-second window", keyed by client IP for calls without a key, and "The window is per endpoint", S2.
Going over answers "429 Too Many Requests, with a Retry-After header in seconds" and the body `{"error": "RateLimitExceeded", "message": "Too many requests", "retryAfterSeconds": 1}`, S2.
The probe stayed under three requests per second per endpoint and never saw a 429.

| request | status | body |
|---|---|---|
| `GET /api/futures/nope` | 404 | empty |
| `GET /api/futures/exchange-data/candles?CurrencyPair=NOPEUSDT&CandleTimePeriod=60` | 500 | empty |
| `GET /api/user/profile` without a key | 401, `text/plain` | `401 Unauthorized - No API-PublicKey or API-Signature header` |
| `GET /api/futures/trade/orderbook/NOPEUSDT` | 200 | empty arrays |
| `GET /api/orderbook?currencyPairCode=NOPE_USDT`, spot | 200 | `[]` |

The reference documents a JSON error body `{ "Code": 110301, "Message": "No such order for this account." }` for rejected futures requests, and says "Code is absent when a rejection comes from a layer that does not emit codes yet", S1.

## 7. Server time and clock offset

No public REST call returns the server time, S1, and the documented WebSocket `/time` route answers 404, see [`websocket.md`](./websocket.md) section 1.
The `Date` header, which has one second resolution, read -9, -282, -555, -829 and -104 ms against the midpoint of five requests, and -714, 14, -259, -532 and -806 ms in the rerun.
That fits a truncated header on a clock within about one second of this host.
A finer offset was not measurable.

## 8. Recommended poller shape

A recommendation for a later design, not a decision, and the recommendation is not to build it.

| item | recommendation | reason |
|---|---|---|
| URL | `https://data.azbit.com/api/futures/exchange-data/pairs` | the only call with funding fields, and it carries all 161 contracts |
| interval | 1,000 ms if ever built | 1 of the 5 requests per second the endpoint allows, median 312 and 332 ms |
| row mapping | section 3, key `currencyPairCode`, `index` and `mark` 0 | no index or mark exists |
| effect | every Azbit route refused at open as `anchor_no_mark` | [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 and 38 |
| skip | `IPUSDT`, `FIOUSDT` and `VINEUSDT`, active with no book, and `$BTC_TOP`, `TSLA`, `BRENT` and `EURUSD`, which are not crypto perpetuals | sections 2 and 5 |
| rate limit pause | `Retry-After`, 1 s in the documented body | S2 |

Taking Bybit's own mark and index for the same code would give the reader numbers, but it would anchor a Bybit copy to Bybit, which is a design question this profile does not settle.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Azbit PublicApi reference, OpenAPI v1 | https://data.azbit.com/swagger/v1/swagger.json | 2026-09-22 | AZ Strategic Ltd, global | pairs fields, funding wording, book call, error codes, upstream venue codes, no mark, sections 2 to 7 |
| S2 | Azbit docs, "Spot Limits" and "Exchange data" | https://docs.azbit.com/docs/spot/limits/ | 2026-09-22 | AZ Strategic Ltd, global | rate limit, 429 body, section 6 |
| S3 | Azbit web trading page strings | https://azbit.com/futures | 2026-09-22 | AZ Strategic Ltd, global | "Mark Price" label, section 3 |
| S4 | Bybit V5 public market API, `instruments-info`, `tickers`, `orderbook`, `funding/history` | https://api.bybit.com/v5/market/instruments-info?category=linear | 2026-09-22 | Bybit, global | the comparison in sections 2 and 4 |
| P1 | `rest-probe.mjs main`, runs at 03:23 and 03:43 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/azbit/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs poll`, runs at 03:24 and 03:44 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/azbit/rest-probe.mjs) | 2026-09-22 | this host | pairs timing, rate changes, REST book against Bybit, sections 1, 4 and 5 |
