# Foxbit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:23 to 04:31 UTC, and the second pass 04:41 to 04:51 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which Cloudflare places in Canada.

This profile covers the public REST API v3 of Foxbit (CCXT id `foxbit`) for its spot markets, because Foxbit lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) unless a source row is named.
Foxbit publishes a limit per endpoint and IP, so the probe spaces its requests 700 ms apart, 300 ms for repeated book and time reads, and 2.5 s for the bulk ticker, and never tests a limit.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| host | `api.foxbit.com.br`, the same host for REST and WebSocket | S1, S2 |
| resolved addresses | `104.17.159.56` and `104.17.160.56`, Cloudflare, in all three `catalog` runs | P1 |
| Cloudflare placement | `/cdn-cgi/trace` answered `loc=CA` and `colo=SEA`, and `cf-ray` named `YVR` on some replies and `SEA` on others | P1 |
| access | every public call answered 200, and unknown ids 404, with no 403, 451 or geoblock page | P1 to P4 |
| cold `markets`, new TCP and TLS | 85, 213 and 140 ms, TLS done at 44, 43 and 30 ms, served from the edge cache (`cf-cache-status: HIT`) | P1 |
| cold `orderbook`, new TCP and TLS | 333 and 254 ms, with `server-timing` `cfOrigin;dur=211` and `dur=200` | P1 |
| warm `markets` | median 28, 39 and 32 ms over five calls per run, all edge cache hits with `age` 45 to 49 s in the first run | P1 |
| warm `orderbook` | 87 to 157 ms, except the first call of each run at 304, 306 and 363 ms | P2 |
| warm bulk ticker | median 98 and 89 ms, max 313 and 337 ms on the first poll, over 24 polls per run | P3 |
| warm `system/time` | 292 to 315 ms round trip on 14 calls | P4 |

All access results above are from the Canadian VPN exit and say nothing about a Brazilian or US address.
Who may open an account is in [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api.foxbit.com.br/rest/v3/markets` returns `{"data": [...]}`, is cached for one minute, and allows 6 requests per second, S1.

| item | value |
|---|---|
| reply | 55,294 bytes, 133 rows, in every run |
| row keys | `base`, `default_fees`, `order_type`, `price_increment`, `price_min`, `price_precision`, `quantity_increment`, `quantity_min`, `quantity_precision`, `quote`, `symbol` |
| status field | none, so the catalog lists no state and every row is taken as tradable |
| quote assets | 128 `brl`, 5 `usdt` |
| perpetual count | 0 |
| `?category=PREDICTION` | 82 rows, all `pred…brl`, none in the default reply |
| `?category=ALL` | 215 rows, the 133 plus the 82 |
| `order_type` of `btcbrl` | `MARKET`, `LIMIT`, `INSTANT`, `STOP_MARKET`, `STOP_LIMIT` |

The 5 USDT markets are `btcusdt`, `ethusdt`, `usdcusdt`, `xrpusdt` and `solusdt`.
They are the only markets in the USD, USDC and USDT settlement family, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).

### How CCXT 4.5.68 maps it

| field | CCXT | evidence |
|---|---|---|
| markets | 133, all `type: 'spot'`, `swap: false`, loaded in 434 to 453 ms | P1, `server/node_modules/ccxt/js/src/foxbit.js` lines 1642 and 1646 |
| `market.id` | the REST `symbol`, on 133 of 133, and the same string the socket takes as `market_symbol` | P1, [`websocket.md`](./websocket.md) section 3 |
| `active` | `true` on every market, hard coded | same file, line 1641 |
| `contractSize` and `linear` | undefined on every market | same file, lines 1651 and 1652 |
| `taker` and `maker` | the market's `default_fees`, 0.005 and 0.0025 on `BTC/BRL`, 0.0015 and 0.0002 on `BTC/USDT` | same file, lines 1658 and 1659, and [`fees.md`](./fees.md) section 8 |
| `precision.price` | the quote asset's precision, 2 for BRL, although `btcbrl` has `price_increment` `"1.0"` and `price_precision` 0 | same file, line 1664, and P1 |
| prediction markets | not loaded, since `fetchMarkets` sends no `category` | same file, line 454 |
| pairs listed twice | none | P1 |

The engine keeps only active swaps, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 202, and logs `no usable swap markets; skipping the venue` when none is left, at lines 50 to 53.
So the engine would skip Foxbit at boot.

### Size unit, pairs listed twice, and price scale

Sizes are base currency on the socket and on REST, equal level by level at the same sequence, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice, and no market is quoted per 10 or per 1,000 units.

## 3. Anchor

Foxbit publishes no index price, no mark price and no funding rate, because it lists no derivative.
No path, schema field or tag in the REST v3 OpenAPI file names an index, a mark or funding, S1.
The nearest bulk call is the ticker, and it carries only trade and book prices.

| call | what it carries | reply | warm time |
|---|---|---|---|
| `GET /rest/v3/markets/ticker/24hr` | per market `last_trade` (price, volume, date), `rolling_24h`, and `best.ask.price` and `best.bid.price` with no size | 53,645 bytes, 133 rows | median 98 and 89 ms over 24 polls per run |
| `GET /rest/v3/markets/{market_symbol}/ticker/24hr` | the same for one market, with `best` sizes | 1 row | 115 and 124 ms |
| `GET /rest/v3/markets/quotes` | a simulated fill: buying 1,000 BRL of BTC returned `"price":"446205"` and `"base_amount":"0.0022411223540749207203"` | 1 row | 95 and 122 ms |

None of these is an index or a reference price, so there is no `AnchorRow` mapping.

## 4. Anchor semantics

Not applicable: there is no index, mark, funding rate or basket.

The bulk ticker is documented as cached for 10 seconds, S1.
Over 24 polls 2.5 s apart in each run, the `btcbrl` best bid changed 4 and 1 times and the best ask 5 and 4 times, and no field of the four markets logged changed more than 5 times, which fits a 10 s cache.
The `solusdt` and `btcusdt` rows changed at a similar rate, and `usdtbrl` did not change at all in the first run.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /rest/v3/markets/{market_symbol}/orderbook?depth=N` | S1 |
| depth | maximum and default 300 | S1 |
| probed depth | `depth=20` gave 20 and 20, no `depth`, `depth=0` and `depth=301` each gave 300 and 300 on `btcbrl` | P2, P4 |
| reply | `{"sequence_id", "timestamp", "bids", "asks"}`, prices and sizes as strings | P2 |
| level order | bids descending and asks ascending on every market of every run, 4 markets in the first two runs and 5 in the third | P2 |
| size of a 300 level reply | 14,176 to 14,183 bytes on `btcbrl` | P2 |
| symbol case | `BTCBRL` is accepted, unlike on the socket | P4 |
| sequence | the same per market sequence as the socket: a book built from the socket stood at the REST `sequence_id` and matched 40 of 40 sizes | [`websocket.md`](./websocket.md) section 4 |
| caching | `cf-cache-status: DYNAMIC`, no `age` header | P2 |

The `timestamp` of each market stays on its own 200 ms grid.
Every `btcbrl` timestamp read in the three `book` runs and the first `errors` run ended in 021 or 022 after a multiple of 200 ms, and `usdtbrl`, `btcusdt` and `solusdt` each kept one fixed remainder modulo 200, 86, 199 and 132, over their three reads.
Consecutive reads returned the same `sequence_id` and `timestamp` in 3 of 3 steps 250 ms apart in the first run, and in 2 and 3 of 7 steps 300 ms apart in the next two.
So the REST book appears to be a snapshot republished on a 200 ms tick per market, and `timestamp` is the tick of the last change.
That is an inference from the timestamps.
At arrival the `timestamp` was 184 to 1,102 ms old on the busy markets, and 22,326,756 ms, about 6.2 h, on `ftmann08brl`, whose book held 0 bids and 1 ask.

## 6. Rate limits and errors

The documented global limit is 300 requests per 10 s per IP, and a 429 blocks the IP for 10 s, S1.
An endpoint with its own limit overrides it.

| endpoint | documented limit, S1 | `x-fb-rate-limit-requests-limit` seen | CCXT 4.5.68 cost comment |
|---|---|---|---|
| `markets`, `currencies` | 6 per 1 s | 6 on `markets`, `currencies` not called | "6 requests per second", lines 144 and 145 |
| `markets/{market_symbol}/orderbook` | 10 per 2 s | 10 | "10 requests per 2 seconds", line 147 |
| `markets/{market_symbol}/ticker/24hr` | 12 per 2 s | 12 | "4 requests per 2 seconds", line 150, stricter than the documentation |
| `markets/ticker/24hr` | 2 per 4 s | 2 | "1 request per 2 seconds", line 146 |
| `markets/quotes` | 2 per 2 s | 2 | not in CCXT |
| `system/time` | 5 per 1 s | 5 | not in CCXT |

Every rate limited reply carried `x-fb-rate-limit-requests-limit`, `-remaining` and `-reset`, the reset in seconds, P1 to P4.
On a 429 the documentation adds `x-fb-rate-limit-retry-after` in seconds and this body, S1:

```json
{"error": {"message": "Too many requests.", "code": 429, "details": "Request limit exceeded, try again later."}}
```

No 429 was provoked, so its shape on the wire is Not verified.
The header is not the standard `Retry-After`, which [`../../../server/src/feeds/anchor/AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) reads, so a Foxbit poller would fall back to its fixed pause.

| request | status | body |
|---|---|---|
| `markets/nopebrl/orderbook` | 404 | `{"error":{"message":"Resource not found.","code":404,"details":["Market for symbol 'nopebrl' not found or not available."]}}` |
| `markets/nopebrl/ticker/24hr` | 404 | the same |
| `/rest/v3/nope` | 404 | `{"error":{"message":"Resource not found.","code":404,"details":["Cannot GET /rest/v3/nope"]}}`, with no rate limit headers |
| `orderbook?depth=301` and `depth=0` | 200 | 300 levels per side |

## 7. Server time and clock offset

`GET /rest/v3/system/time` returns `{"iso":"2026-09-23T04:42:49.104Z","timestamp":1790138569104}`, P4.
Server time minus the midpoint of each request read +100 to +105 ms over 7 calls at 04:30 UTC and +113 to +115 ms over 7 calls at 04:42 UTC.
The round trip of this call was 292 to 315 ms, three times the 87 to 115 ms of a warm book call, so the midpoint is only good to about half of that, and the offset is inside that bound.
The engine stamps book frames on arrival, so the offset does not enter any reading.

## 8. Recommended poller shape

None.
Foxbit publishes no index, mark or funding, so it has no anchor to poll, and a route with a Foxbit leg would be refused at open for want of a mark, see [`../../../server/src/engine/cluster/types.ts`](../../../server/src/engine/cluster/types.ts) and [`../../implemented/2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section "What the engine needs from a venue".
If a spot leg is ever designed, its anchor has to come from another venue's index.
The catalog needs no fast poll: `markets` is cached for one minute at the edge.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Foxbit REST API 3.0, with its OpenAPI file | https://docs.foxbit.com.br/rest/v3/ and https://docs.foxbit.com.br/rest/v3/public-docs-openapi.json | 2026-09-22 | Foxbit | paths, caching, per endpoint and global limits, 429 body and headers, depth limit, categories, sections 2 to 6 |
| S2 | Foxbit WebSocket API 3.0 | https://docs.foxbit.com.br/ws/v3/ | 2026-09-22 | Foxbit | the shared host, section 1 |
| S3 | CCXT 4.5.68 `foxbit.js` | `server/node_modules/ccxt/js/src/foxbit.js` | 2026-09-22 | CCXT | `parseMarket`, cost comments, sections 2 and 6 |
| P1 | `rest-probe.mjs catalog`, 04:29, 04:41 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | DNS, Cloudflare placement, cold and warm times, catalog, CCXT mapping, sections 1 and 2 |
| P2 | `rest-probe.mjs book`, 04:29, 04:41 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) | 2026-09-23 UTC | this host | book depth, order, timestamps, repeats, quote, single ticker, sections 3 and 5 |
| P3 | `rest-probe.mjs ticker`, 04:29 and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) | 2026-09-23 UTC | this host | bulk ticker size, time and change counts, sections 3 and 4 |
| P4 | `rest-probe.mjs errors`, 04:30 and 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) | 2026-09-23 UTC | this host | error shapes, depth clamps, symbol case, clock offset, sections 5 to 7 |
