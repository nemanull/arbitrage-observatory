# bitFlyer REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 03:21 to 03:42 UTC), from the development host near Seattle.

This profile covers the public HTTP API of bitFlyer Lightning (CCXT id `bitflyer`) for its one perpetual, the Crypto CFD `FX_BTC_JPY`.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitflyer/rest-probe.mjs) unless a source is named.
The API documentation is S1, and the pages on `bitflyer.com` that hold the fee, funding and trading rules refused this host, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.bitflyer.com`, the same URL for the JP, US and EU regions, S1 |
| resolution | CNAME `curie.edgekey.net` to `e9796.dscb.akamaiedge.net`, an Akamai edge at 23.49.141.195, plus two IPv6 addresses that this host cannot route |
| TCP connect | 12.7 ms over IPv4. A client that tries IPv6 first, as `curl` does by default, connected in 213 ms because the IPv6 attempt fails first |
| cold request | 212 ms and 114 ms for `getticker` from Node, in two runs |
| warm request that reaches the origin | 106 to 358 ms over two runs of 40 `getticker` polls, medians 169 and 126 ms, and 131 to 214 ms for `getfundingrate` |
| warm request served by the edge | 18 to 82 ms, see section 5 |
| refusals | none. Every public call answered 200, or 400 and 404 for the malformed requests of section 6 |

The edge is about 13 ms away and the origin is in Japan, so a reply in under about 100 ms was served from the edge cache.

## 2. Catalog

### The instruments call

`GET /v1/getmarkets` lists the JP region, and `/v1/getmarkets/usa` and `/v1/getmarkets/eu` list the other two, S1.

| call | rows | types | time |
|---|---|---|---|
| `/v1/getmarkets` | 9 | 8 `Spot`, 1 `FX` | 193 and 232 ms |
| `/v1/getmarkets/usa` | 4 | 4 `Spot` | 140 and 162 ms |
| `/v1/getmarkets/eu` | 4 | 4 `Spot` | 131 and 326 ms |

A row is only `{"product_code": "FX_BTC_JPY", "market_type": "FX"}`.
There is no status, tick size, minimum size or contract size in any public call.
The minimum order is 0.001 BTC from the Crypto CFD page, S2.
Every CFD price on the wire was a whole yen, and the tick size itself is Not publicly specified.
`GET /v1/getboardstate?product_code=FX_BTC_JPY` gives the trading state, `{"health":"NORMAL","state":"RUNNING"}` in every run, with the documented states `RUNNING`, `CLOSED`, `STARTING`, `PREOPEN` and `CIRCUIT BREAK`, S1.

### How CCXT 4.5.68 maps it

`loadMarkets` calls all three lists, which took 2,425 and 2,768 ms because CCXT spaces requests by its `rateLimit` of 1,000 ms at `server/node_modules/ccxt/js/src/bitflyer.js` line 25.
The 17 rows became 13 markets, because `BTC_JPY` and `ETH_BTC` appear in more than one region list and CCXT keys markets by symbol.

| field | `FX_BTC_JPY` | source |
|---|---|---|
| `id` | `FX_BTC_JPY`, the same spelling as the socket channel suffix and the funding call's `product_code` | P1 |
| `symbol` | `BTC/JPY:JPY` | `bitflyer.js` lines 316 to 318 and 352 |
| `type`, `swap` | `swap`, true | `bitflyer.js` lines 303 and 316 |
| `base`, `quote`, `settle` | `BTC`, `JPY`, `JPY` | P1 |
| `linear`, `inverse` | true, false | `bitflyer.js` line 375 |
| `contractSize` | undefined, which the engine turns into 1 at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194 | `bitflyer.js` line 379 |
| `active` | true, hard coded for every market | `bitflyer.js` line 373 |
| `taker`, `maker` | 0, 0 | `bitflyer.js` lines 350 and 351 |
| `precision`, `limits` | all undefined | P1 |

The connector keeps it, since it is an active swap with a numeric taker, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 180 to 186 and 196 to 203.
The book size unit is BTC, which matches a `contractSize` of 1, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice among perpetuals.

The quote is the blocker.
The engine folds USD and USDC into USDT and leaves every other quote as it is, at [`../../../server/src/engine/cluster/quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 10.
So `FX_BTC_JPY` would form a `BTC|JPY` cluster, and no other venue in the registry lists a JPY perpetual, so it would have no second leg.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /v1/getfundingrate?product_code=FX_BTC_JPY` | absent | absent | `current_funding_rate` | absent | `next_funding_rate_settledate` | 92 bytes | 131 to 214 ms |
| `GET /v1/getfundingratehistory?product_code=FX_BTC_JPY&count=500` | absent | absent | `rate` per row | the step between rows, 8 h | `settlement_date` of the newest row | 52,676 bytes | 191 and 262 ms |
| `GET /v1/getticker?product_code=FX_BTC_JPY` | absent | absent, `ltp` is the CFD's last trade | absent | absent | absent | 369 bytes | section 1 |
| `GET /v1/getticker?product_code=BTC_JPY` | absent, the Lightning Spot ticker of the same venue | absent | absent | absent | absent | 373 bytes | section 1 |

There is no bulk call, and none is needed for one product.
bitFlyer publishes no index price and no mark price.
`/v1/getindex` and `/v1/getmarkprice` answered 404, and the documentation lists no such call, S1.
CCXT's `fetchFundingRate` reads the same call and returns `markPrice` and `indexPrice` undefined, and `interval` undefined, at `server/node_modules/ccxt/js/src/bitflyer.js` lines 1165 to 1211.
It puts the rate into `nextFundingRate`, line 1203, and leaves `fundingRate` undefined.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the product code `FX_BTC_JPY` | string | none |
| `index` | none published | | 0, or a proxy, see below |
| `mark` | none published | | 0, which refuses the route at open, [`../../../server/src/engine/opportunity/anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 37 and 38 |
| `fundingRate` | `current_funding_rate` | JSON number, a fraction per 8 h: `0.0001` is 0.01 % | none |
| `fundingIntervalHours` | none published | | 8, a constant taken from the history |
| `nextFundingAt` | `next_funding_rate_settledate` | UTC without a zone, `"2026-09-23T05:00:00"` | `Date.parse(value + 'Z')` |

The only proxies are the venue's own numbers.
The margin rule values a position at the CFD's own last trade and prices the margin from the Lightning Spot last trade, S2.
So a mark proxy would be the CFD's own `ltp`, which cannot diverge from the perpetual it is supposed to judge, and an index proxy would be the one-venue spot `BTC_JPY`.
A reference built from the venue's own perpetual is the shape that let false rows through the fresh gate in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
Over 40 polls the CFD mid sat 399 to 724 ppm below the spot mid, median 533 ppm below, and over 40 more in the second pass it ranged from 424 ppm below to 187 ppm above, median 191 ppm below, in P2.

## 4. Anchor semantics

### Index

None is published.
The divergence circuit breaker uses a reference price that is "the spot trading price of the crypto asset … utilized as the standard for calculating the trading prices that bitFlyer offers at the exchange in its role as a crypto asset exchange operator", which "under normal market conditions … matches the crypto asset spot trading price displayed by bitFlyer on the exchange as the midprice", S3.
That is the mid of bitFlyer's own dealer price, and it has no public API call.
S3 adds that bitFlyer has discretion over how it presents those buy and sell prices, so the reference may differ from the displayed mid.

### Mark

None is published.
The CFD position is valued at "the most recent trading price on bitFlyer Crypto CFD", S2.
The clamps that exist act on trading, not on a mark.

| clamp | rule | source |
|---|---|---|
| divergence breaker | trading suspends for about 5 minutes when an order would trade more than 5 % above or below the dealer spot reference, and resumes by Itayose | S3 |
| sudden move breaker | 15 % above or below the CFD's last trade 10 minutes earlier | S3 |
| Itayose note | bitFlyer's "proprietary trading department may employ the Itayose method to hold positions for the purpose of hedging price fluctuation risks or for arbitrage trading" when trading resumes | S3 |

### Funding

The formula, cap and floor sit on `bitflyer.com` and are Not verified.
What the API shows is in [`fees.md`](./fees.md) section 6: an 8 h interval settling at 05:00, 13:00 and 21:00 UTC, a rate fixed at the previous settlement, and 279 of the last 500 rates at exactly 0.0001.
The published rate is the upcoming one, because `current_funding_rate` equalled the history row whose `settlement_date` was the next settlement.

### Rate across a settlement

The settlement instant was not captured.
The history shows that the rate for the next settlement is fixed at the moment the previous one settles, so `current_funding_rate` changes once every 8 h, at 05:00, 13:00 and 21:00 UTC.

### How often each number changed

Over 40 polls of both tickers at 1.5 s, in P2:

| number | changed on, first run | changed on, second pass |
|---|---|---|
| CFD best bid | 31 of 39 polls | 38 of 39 |
| CFD best ask | 32 of 39 | 38 of 39 |
| CFD `ltp` | 9 of 39 | 23 of 39 |
| CFD `timestamp` | 39 of 39 | 39 of 39 |
| spot `ltp` | 2 of 39 | 9 of 39 |
| `current_funding_rate` | 0 | 0 |

The funding rate changes once per 8 h.
The CFD ticker's `timestamp` was 153 to 1,205 ms old on arrival, median 735 ms, and 170 to 1,937 ms, median 740 ms, in the second pass, because the edge cache serves the same reply for up to about 1 s, section 5.
The WebSocket ticker arrived 93 to 359 ms after its own `timestamp`, see [`websocket.md`](./websocket.md) section 3.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /v1/getboard?product_code=FX_BTC_JPY`, S1 |
| depth | the whole book: 787 bids and 330 asks in 38,021 bytes, 807 bids and 308 asks in 37,916 bytes in the second pass, and 1,088 to 1,108 levels in the four WebSocket runs. No depth parameter exists |
| order | bids descending, asks ascending |
| shape | `{"mid_price": 13636578, "bids": [{"price": 13636000, "size": 0.21}, …], "asks": [{"price": 13637156, "size": 0.01}, …]}` |
| consistency | `mid_price` equalled the mid of the touch, rounded down to a whole yen in the second pass, and the summed sizes were within 0.12 BTC of the ticker's `total_bid_depth` and `total_ask_depth` read at the same time |
| caching | edge cached. In 20 `getticker` requests 150 ms apart, 15 were identical to the previous reply and came back in 22 to 72 ms, and 18 to 43 ms in the second pass, while a fresh reply came about once a second in 120 to 236 ms. 6 of 8 `getboard` replies were identical and came back in 19 to 82 ms, in both runs. `getfundingrate` was never served under 100 ms |

The response headers say `cache-control: no-cache`, and the edge caches `getticker` and `getboard` anyway.
A REST book is therefore up to about 1 s older than the origin's, and the REST ticker's own `timestamp` was up to 1.9 s old on arrival from this host.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| public limit | "500 queries per 5 minutes" from the "Same IP Address", about 1.67 per second | S1 |
| order limits | 100 placements per minute for orders of 0.1 or less, which drops to 10 per minute for an hour after a breach, and 300 per 5 minutes for the send and cancel all endpoints | S1 |
| after a breach | "future API requests will be blocked temporarily. After being blocked, the maximum request limit will be temporarily be decreased." | S1 |
| headers | `x-ratelimit-period`, `x-ratelimit-remaining` and `x-ratelimit-reset` in Unix seconds, for example `235`, `492` and `1790133966` on the first Node request | P1 |
| status at the limit | Not verified, the probe stayed under 100 requests per mode | |
| `Retry-After` | not seen | P1 |

`x-ratelimit-period` counted down in seconds to `x-ratelimit-reset`, and `x-ratelimit-remaining` fell as requests were made.
Across the poll run the reset instant moved forward by 36 s, and in the second pass `x-ratelimit-remaining` read 492 and then 494 in one run while the reset moved from 1790134996 to 1790135128.
An edge cached reply probably repeats the headers of the origin reply it copies, which is an inference from the cache behaviour of section 5.
So the headers are only an approximate budget.

| request | status | body |
|---|---|---|
| `getticker?product_code=NOPE_JPY` | 400 | `{"status":-100,"error_message":"Invalid product","data":null}` |
| `getboard?product_code=NOPE_JPY` | 400 | the same |
| `getfundingrate?product_code=BTC_JPY`, a spot product | 400 | the same |
| `getfundingrate` without `product_code` | 404 | `{"Message":"No HTTP resource was found that matches the request URI 'https://api.bitflyer.com/v1/getfundingrate'."}` |
| `getticker` without `product_code` | 200 | the `BTC_JPY` spot ticker |
| `getticker?product_code=fx_btc_jpy` | 200 | the `FX_BTC_JPY` ticker, so the code is case insensitive |
| an unknown path, `/v1/nope`, `/v1/getindex`, `/v1/getmarkprice` | 404 | an HTML page |

## 7. Server time and clock offset

There is no server time call.
The `Date` header read 278 and 110 ms behind the local midpoint of the request, and 782 and 514 ms behind in the second pass, all inside the header's 1 s resolution.
The WebSocket ticker's `timestamp`, stamped in Japan with seven fractional digits, arrived 93 to 359 ms later on the local clock over four runs, medians 133 to 143 ms, which bounds the one-way delay plus any clock offset.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The venue does not fit the engine in its current shape, for three reasons.

1. The only perpetual is JPY margined, and the quote family has no JPY, so it has no partner leg, section 2.
2. bitFlyer publishes no index and no mark, so every route would be refused at open as `anchor_no_mark`, section 3.
3. The only anchor proxies are the venue's own spot ticker and the CFD's own last trade, and a reference built from the venue's own perpetual has already let false rows through the fresh gate, section 3.

If a JPY family and a proxy anchor were ever wanted, the poller would look like this.

| item | recommendation | reason |
|---|---|---|
| funding URL | `https://api.bitflyer.com/v1/getfundingrate?product_code=FX_BTC_JPY` every 60 s | the rate changes once per 8 h and is known 8 h ahead |
| price URLs | `getticker` for `FX_BTC_JPY` and `BTC_JPY` every 2 s | two calls a second would exceed 500 per 5 minutes, and the edge cache returns the same reply within about 1 s anyway |
| budget | 305 requests per 5 minutes | inside the 500 limit with room for a restart |
| interval hours | the constant 8 | no field carries it |
| next settlement | `Date.parse(next_funding_rate_settledate + 'Z')` | the string has no zone |
| skip | a `getboardstate` other than `RUNNING` | Itayose and the breakers of section 4 |
| rate limit pause | `rateLimitPauseMs` 300,000 | the documented window is 5 minutes and no `Retry-After` was seen |
| fresher prices | the WebSocket ticker | it arrives 93 to 359 ms after its stamp, while the REST ticker was up to 1.9 s old |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | bitFlyer Lightning API Documentation | https://lightning.bitflyer.com/docs?lang=en | 2026-09-22 | bitFlyer, Inc., JP, US and EU regions | calls, fields, regions, limits, board states, sections 1 to 6 |
| S2 | What is bitFlyer Crypto CFD? | https://lightning.bitflyer.com/about-crypto-cfd?region=JP&lang=en | 2026-09-22 | bitFlyer, Inc., JP | minimum order, valuation and margin rules, sections 2 to 4 |
| S3 | Circuit Breaker | https://lightning.bitflyer.com/docs/circuitbreaker?region=JP&lang=en | 2026-09-22 | bitFlyer, Inc., JP | dealer spot reference, 5 % and 15 % breakers, Itayose note, section 4 |
| S4 | CCXT 4.5.68 `bitflyer.js` | `server/node_modules/ccxt/js/src/bitflyer.js` | 2026-09-22 | CCXT | sections 2 and 3 |
| P1 | `rest-probe.mjs catalog`, `latency`, `funding`, `book` and `errors` at 03:22 UTC, and the second pass `all` at 03:40 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitflyer/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs cache` at 03:25:20 UTC and `poll` at 03:25:34 UTC, and the second pass at 03:40:35 and 03:40:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitflyer/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3, 4 and 5 |
| P3 | `curl -4` and default `curl` connect times, and the `bitflyer.com` refusals | this host's shell | 2026-09-23 UTC | this host | section 1, and [`fees.md`](./fees.md) section 1 |
