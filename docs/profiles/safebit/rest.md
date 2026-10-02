# SAFEbit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:15 to 03:45 UTC), from the development host near Seattle.

SAFEbit's only public API is a read-only REST feed for price aggregators at `https://api.safebit.com.tr`, described by a Swagger page titled `WebApplication2 v1`, S1.
It lists no perpetual, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The web app at `https://www.safebit.com.tr` uses a separate internal API that refused this host, see [`websocket.md`](./websocket.md) section 1.
Every claim below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) unless it names another source.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `api.safebit.com.tr` | S1 |
| resolved | 104.18.14.151 and 104.18.15.151, and 2606:4700::6812:e97 and 2606:4700::6812:f97, Cloudflare | P1 `dns` |
| edge | `cf-ray` suffixes `YVR` and `SEA` | P5 `clock`, and the ws probe of [`websocket.md`](./websocket.md) |
| cold request | 947 ms for `GET /api/Spot/pairs`, and 817 ms in the rerun | P1 `latency`, P6 |
| warm request | 230 to 238 ms for `GET /api/Spot/pairs`, five requests 500 ms apart, and 203 to 212 ms in the rerun | P1 `latency`, P6 |
| warm book request | 205 to 899 ms over 60 one second polls, median 209 ms, and 197 to 926 ms, median 199 ms, in the rerun | P3 `poll_book`, P6 |

The Swagger lists 20 GET operations under the tags `CoinMarketCap`, `External`, `Spot` and `Token`, with no security scheme, S1.
No trading, account or WebSocket call is published.

## 2. Catalog

### The instruments call

| call | rows | fields | reply | time |
|---|---|---|---|---|
| `GET /api/Spot/pairs` | 123 | `ticker_id` spelled `BTC_TRY`, `base`, `target` | 6.6 KB | 235 ms |
| `GET /api/exchangeinfo` | 123 | `symbol` spelled `BTCTRY`, `status`, `baseAsset`, `baseAssetPrecision` 12, `quoteAsset`, `quotePrecision` 12, `orderTypes` | 19.0 KB | 436 ms |

Both lists hold the same 123 pairs, 114 quoted in TRY and 9 in USDT, P1 `catalog_match`.
All 123 have `status` `Trading` and `orderTypes` `["Market","Limit"]`, P1 `exchangeinfo`.
No base is listed twice, so no pair needs a choice between two contracts.
The perpetual count is 0 in every settlement asset.
CoinGecko reported 35 pairs on the same day, S3, against 123 in the API.

### Liquidity on the day

A scan of every pair's book at 03:24 UTC found 121 two-sided books, `USDC_TRY` with asks only, and `USDT_TRY` empty, P4.
83 of 123 pairs had zero 24 h volume in `/api/Spot/tickers`, P4.
The 24 h volume summed to 3,437,698 TRY, and 3,437,437 TRY in the rerun, over the TRY pairs and 4,277 USDT over the USDT pairs, and the largest were `BCH_TRY` at 1,039,754 TRY and `ETH_TRY` at 749,868 TRY, P1 `volume`.
At the 43.51 TRY per USDT that the ticker reported, the TRY total is about 79,000 USDT a day, which is arithmetic.
Two-sided spreads ran from 42 to 91,993 ppm, median 6,865 ppm, and median 6,883 ppm in the rerun, P4 and P6.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 and CCXT master have no SAFEbit or Bitci class, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare, and the engine's catalog path through `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68 cannot load this venue.
The spot book size is in base units, section 5, and a hand written catalog would key on `ticker_id`.

## 3. Anchor

SAFEbit publishes no index price, no mark price and no funding rate, because it lists no perpetual.
No anchor poller is recommended.

The reference prices it does publish, all computed from its own spot trades or book, P1 `ticker_variant`:

| call | rows | price fields | reply | time |
|---|---|---|---|---|
| `GET /api/Spot/tickers` | 123 | `last_price`, `bid`, `ask`, `high`, `low`, `base_volume`, `target_volume` | 34.3 KB | 465 ms |
| `GET /api/CoinMarketCap/summary` | 123 | `last_price`, `lowest_ask`, `highest_bid`, 24 h high, low and change | 35.0 KB | 253 ms |
| `GET /api/CoinMarketCap/ticker` | 123, keyed by pair | `last_price`, volumes, `isFrozen` | 16.3 KB | 265 ms |
| `GET /api/ReturnTicker` | 123 | `price`, `bid`, `ask`, 24 h fields, `timestamp` in seconds | 42.3 KB | 437 ms |
| `GET /api/Summary` | 123, keyed by pair | `last`, `lowestAsk`, `highestBid`, `percentChange`, 24 h volumes, high and low, `lastUpdateTimestamp`, inside a JSON string that holds the JSON document, served as `text/plain` to the first `curl` and as `application/json` to both probe runs | 39.9 KB | 436 ms |

The ticker `bid` and `ask` are not always the book's touch.
On `XRP_TRY`, `LDO_TRY` and `LPT_TRY` the ticker `ask` sat below the book's best bid, for example `XRP_TRY` with ticker bid 73.51 and ask 69.06 against a book of 73.51 and 73.63, P2 and P4.
`USDT_TRY` carried a ticker bid of 43.51 and ask of 46.59 while its book was empty, P4.
The ticker bid matched the book on 120 pairs and the ask on 118, and 121 and 118 in the rerun, P4 and P6.

## 4. Anchor semantics

Not applicable, since no index, mark or funding exists.
No price basket, premium clamp or funding cap is published.

Over 60 one second polls at 03:23 UTC, and again at 03:32 UTC, the `ETH_TRY` book body and the `ETH_TRY` ticker bid, ask, last and volume changed 0 times, P3 and P6.
Only the book's `timestamp` changed, on 59 of 59 transitions, because it is the time of the reply and not of the last book change, section 7.

## 5. REST book snapshot

Three calls return a book, and they disagree on shape.

| call | level shape | depth rule | order | size precision |
|---|---|---|---|---|
| `GET /api/Spot/orderbook?ticker_id=BTC_TRY&depth=N` | `["size", "price"]` strings, size first | `depth` counts both sides: N gives N / 2 levels per side rounded down, so 1 gives none, 20 gives 10, and 100 gives 50. `0`, `-1`, a value larger than the book, or no `depth` returns every level | bids descending, asks ascending | size rounded to 2 decimals: `"0.13"` for 0.1286 BTC |
| `GET /api/CoinMarketCap/orderbook/market_pair?market_pair=BTC_TRY&depth=N&level=L` | `{"price": number, "amount": number}` | the same `depth` rule. `level=1` returns one level per side, `level=2` and `level=3` follow `depth` | bids descending, asks ascending | full precision: `0.1286` |
| `GET /api/OrderBook/BTC_TRY` | `{"quantity": number, "price": number}` | every resting order, one row per order: 72 ask rows at 71 prices | unsorted, asks began `6000000, 5548980.4, 5000000, 5000000` | full precision |

Evidence is P2 `spot_orderbook`, `cmc_orderbook`, `legacy_orderbook` and `size_rounding`, all on `BTC_TRY` at 03:22 UTC.
Prices matched between the first two calls level by level, P2 `size_rounding`.
The whole `BTC_TRY` book held 42 bids and 71 asks in both runs, and across all pairs the most levels seen were 84 bids on one pair and 116 asks on one pair, and 84 and 115 in the rerun, P4 and P6.
10 of the 121 two-sided books held fewer than 20 levels on a side, P4.
The unit is the base asset, since 0.1286 at a price near 4.18 million TRY is a plausible BTC amount.
Replies carry `cf-cache-status: DYNAMIC` and no `age` or `cache-control` header, P3 `cache_headers`.
An empty book and an unknown pair give the same reply, see section 6.

Samples from the first `curl` of each call at 03:18 UTC, trimmed to two levels per side, S2.

```json
{"ticker_id":"BTC_TRY","timestamp":"1790133519559","bids":[["0.13","4182544.20000000"],["0.14","4177263.80000000"]],"asks":[["0.10","4185864.00000000"],["0.14","4186700.10000000"]]}
```

```json
{"ticker_id":"BTC_TRY","timestamp":1790133522742,"bids":[{"price":4182544.20000000000000,"amount":0.12860000000000},{"price":4177263.80000000000000,"amount":0.13833000000000}],"asks":[{"price":4185864.00000000000000,"amount":0.10452731000000},{"price":4186700.10000000009313,"amount":0.14290000000000}]}
```

The second call prints numbers with 14 decimals, and some carry binary float noise, as `4186700.10000000009313` shows, so a reader parses them as doubles and never compares them as text.

## 6. Rate limits and errors

No rate limit is published, S1, and no reply carried a header whose name contains `rate` or `limit`, P5.
No 429, 403 or 418 was seen at up to two requests a second over the 86 s scan and the 90 s rerun, P4 and P6.
One scan started at 03:32:59 UTC stopped on a reply that held no `bids` array, and its status was not recorded, because the probe had no failure log yet.
The rerun at 03:34 UTC logged every reply and had 0 failures, so whether that reply was a limit is Not verified.
No `Retry-After` header was seen, so its behaviour is Not verified.

| request | status | body |
|---|---|---|
| `/api/Spot/orderbook?ticker_id=NOPE_TRY&depth=10` | 200 | `{"ticker_id":"NOPE_TRY","timestamp":"…","bids":[],"asks":[]}`, the same as the real but empty `USDT_TRY` |
| `/api/Spot/orderbook?ticker_id=btc_try&depth=10` | 200 | the `BTC_TRY` book, `ticker_id` upper cased |
| `/api/Spot/orderbook?ticker_id=BTCTRY&depth=10` | 404 | `application/problem+json`, `"title":"Not Found"` |
| `/api/Spot/orderbook?depth=10` | 400 | `application/problem+json`, `"title":"Bad Request"` |
| `/api/Spot/orderbook?ticker_id=BTC_TRY&depth=abc` | 400 | `"title":"One or more validation errors occurred."` |
| `/api/OrderBook/NOPE_TRY` | 200 | `{"timeStamp":…,"asks":[],"bids":[]}` |
| `/api/CoinMarketCap/orderbook/market_pair?market_pair=NOPE_TRY` | 200 | empty `bids` and `asks` |
| `/api/Spot/nope`, `/api/v1/time` | 404 | empty |

The error shape is the ASP.NET problem document with `type`, `title`, `status` and `traceId`, P5.

## 7. Server time and clock offset

No time call exists, and `/api/v1/time` is 404, P5.
`GET /api/exchangeinfo` carries `"timezone": "UTC"` and a `serverTime` in Unix seconds that was 10,799 s ahead of this host's clock, and 10,800 s in the rerun, which is Istanbul time labelled as UTC, P5 `clock` and P6.
The book `timestamp` is Unix ms of the reply, and it read 97 ms, and 95 ms in the rerun, before this host's clock at the end of the request, P5 and P6, so the host clock and the server agree to within a round trip.
`ReturnTicker` carries a `timestamp` in Unix seconds whose meaning is Not publicly specified.
It read 1675695600, 2023-02-06 15:00 UTC, on `BTC_TRY`, which had 24 h volume on 2026-09-22, and its values across the 123 rows ran from 2023-01-13 to 2026-07-10, S2, so it is neither the reply time nor the last trade.

## 8. Recommended poller shape

None.
An anchor poller needs an index, a mark and a funding rate, and SAFEbit publishes none of them.

| item | finding |
|---|---|
| anchor | none, section 3 |
| book, if ever wanted | `GET /api/CoinMarketCap/orderbook/market_pair?market_pair=<ticker_id>&depth=40&level=2`, since it keeps full size precision and sorted levels. `/api/Spot/orderbook` rounds sizes to 2 decimals |
| do not read | `/api/Spot/tickers` `bid` and `ask`, whose `ask` sat below the book's best bid on 3 pairs, and `exchangeinfo` `serverTime`, which is 3 h off |
| skip | pairs whose book is empty or one-sided, since an unknown pair looks the same |
| pause | no limit is published, so a pause would have to be guessed |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SAFEbit public API, Swagger `WebApplication2 v1` | https://api.safebit.com.tr/swagger/index.html and https://api.safebit.com.tr/swagger/v1/swagger.json | 2026-09-22 | Safebit | the 20 calls, no security scheme, no rate limit, sections 1, 2 and 6 |
| S2 | first `curl` of every public call, replies kept in the scratch folder only | https://api.safebit.com.tr/api/ | 2026-09-22 | this host | reply shapes, the `ReturnTicker` timestamp, section 7 |
| S3 | CoinGecko exchange record `bitci` | https://api.coingecko.com/api/v3/exchanges/bitci | 2026-09-22 | CoinGecko | 35 pairs listed, section 2 |
| P1 | `rest-probe.mjs catalog` at 03:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | DNS, latency, catalog, volume, ticker variants, CCXT, sections 1 to 3 |
| P2 | `rest-probe.mjs book` at 03:22 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | depth rule, level shapes and order, size rounding, section 5 |
| P3 | `rest-probe.mjs poll` at 03:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | change counts, reply times, cache headers, sections 1, 4 and 5 |
| P4 | `rest-probe.mjs scan` at 03:24 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | every pair's book against the ticker, spreads, level counts, sections 2, 3, 5 and 6 |
| P5 | `rest-probe.mjs errors` at 03:25 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | error shapes, clock, sections 6 and 7 |
| P6 | `rest-probe.mjs` rerun of every mode at 03:31 to 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | the second readings, cited beside the first |
