# NonKYC REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, from the development host near Seattle, between 04:49 and 05:05 UTC on 2026-09-23, and again in the second pass between 05:07 and 05:09 UTC, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST market data behind NonKYC's perpetuals.
`perp.nonkyc.io` is the Orderly Network builder `nonkyc`, see [`fees.md`](./fees.md) section 1, so every perpetual call goes to Orderly's public API, the same API profiled for Niza.fun in [`../niza/rest.md`](../niza/rest.md).
NonKYC's own spot API at `https://api.nonkyc.io/api/v2` appears only where the coverage matrix or the access record needs it.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/nonkyc/rest-probe.mjs) unless it cites a source.
Access results are from the Canadian VPN exit of this host, and Orderly's `/v1/ip_info` placed it in Vancouver, Canada, with `"checked":false`.

## 1. Host and latency from this machine

| host | resolved | first request | warm requests |
|---|---|---|---|
| `api.orderly.org` | `34.36.82.46` | `GET /v1/public/futures` 200 in 214 to 302 ms over three runs | 5 per run: 124 to 239 ms, medians 131, 135 and 224 |
| `api-evm.orderly.org`, the host CCXT `woofipro` uses | `34.111.187.47` | 200 in 259 to 315 ms | 154 to 307 ms, medians 182, 223 and 251 |
| `ws-evm.orderly.org` | `34.111.60.95` | see [`websocket.md`](./websocket.md) section 1 | |
| `nonkyc.io`, `perp.nonkyc.io`, `api.nonkyc.io`, `ws.nonkyc.io` | `104.20.43.76` and `172.66.168.81`, plus two IPv6 addresses, Cloudflare | `https://nonkyc.io/` 200, `https://perp.nonkyc.io/` 200, `https://api.nonkyc.io/api/v2/time` 200 in 739 and 269 ms | `GET /api/v2/market/getlist` 200 in 1,683 and 1,097 ms, 557 KB |

Both Orderly hosts serve the same reply, 59,860 to 59,868 bytes for 139 rows, P1.
`https://api.nonkyc.io/` serves a Swagger page for `/openapi.json`, "NonKYC REST API" version 1.3.0, whose 38 operations cover spot only, S9.
No refusal of any kind was seen from this host.

## 2. Catalog

### The instruments call

`GET https://api.orderly.org/v1/public/info` returned 139 rows, 110,842 bytes, in 158 to 311 ms, S1.

| group | rows | status | note |
|---|---:|---|---|
| shared `PERP_<BASE>_USDC`, `broker_id` null | 80 | 80 `ACTIVE` | the markets every builder, NonKYC included, trades |
| `_mythos` suffix | 57 | | listed by another builder, mostly equities such as `PERP_AAPL_USDC_mythos` |
| `_alpix` suffix | 1 | | another builder |
| `_fastx` suffix | 1 | | another builder |
| `_nonkyc` suffix | 0 | | NonKYC lists no market of its own |

Each row carries `funding_period` in hours, `cap_funding`, `floor_funding`, `interest_rate`, `mark_index_price_deviation_cap` and `_floor`, `std_liquidation_fee`, `liquidator_fee`, `base_tick`, `quote_tick` and `status`.
On the 80 shared markets `funding_period` is 8 on 40 and 4 on 40.
Three shared markets are quoted per 1,000 units: `PERP_1000BONK_USDC`, `PERP_1000PEPE_USDC` and `PERP_1000SHIB_USDC`.
Eleven are real-world assets, commodities or currency pairs whose baskets draw on other venues' futures index or perpetual feeds, see section 4: `BZ`, `CL`, `EURUSD`, `GOOGL`, `NAS100`, `NVDA`, `SPX500`, `TSLA`, `USDJPY`, `XAG` and `XAU`.
`PERP_SPX_USDC` is a crypto token with a six-source basket, not the index.

### How CCXT 4.5.68 maps it

No NonKYC class exists, see [`fees.md`](./fees.md) section 8.
`new ccxt.woofipro()` loaded the same catalog in 637 to 746 ms.

| check | result |
|---|---|
| markets | 139, all `swap` |
| `market.id` | equals the REST `symbol` on 139 of 139, and it is the socket topic prefix and the `/v1/public/futures` key |
| `contractSize` | 1 on all 139, `woofipro.js` line 570. Book sizes are in the base asset, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | true on all 139, settle USDC |
| `active` | `undefined` on all 139, `woofipro.js` line 566, so the connector's `market.active !== false` keeps every row, including the 59 builder-listed ones, [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203 |
| unified symbol | `BASE/USDC:USDC`, built from the second and third parts of the id, so a builder suffix is dropped, `woofipro.js` lines 541 to 551 |
| pairs listed twice | none on 2026-09-23 UTC, since no builder-listed market shares a base with a shared one |
| `BTC/USDC:USDC` | `id` `PERP_BTC_USDC`, amount precision 0.00001, price precision 0.1, equal to `base_tick` and `quote_tick` |

Because the unified symbol drops the builder suffix, a future builder listing on a shared base would collide with the shared market.
A `marketFilter` of `(m) => /^PERP_[A-Z0-9]+_USDC$/.test(m.id)` keeps exactly the 80 shared markets.
USDC sits in the USD settlement family, see [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
The three `1000` markets need a price scale in `clusterOverrides.ts` to pair with a venue that quotes the single token.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /v1/public/futures` | `index_price` | `mark_price` | `est_funding_rate`, and `last_funding_rate` | absent | `next_funding_time`, Unix ms | 59.9 KB, 139 rows | two runs of 60 polls at 1 Hz: min 136 and 149, median 153 and 158, p90 176 and 165, max 246 and 214 ms, none over 1 s |
| `GET /v1/public/funding_rates` | | | `est_funding_rate` with `est_funding_rate_timestamp`, and `last_funding_rate` with `last_funding_rate_timestamp` | absent | `next_funding_time` | 33.5 KB, 139 rows | 187 and 214 ms |
| `GET /v1/public/info` | | | | `funding_period`, hours | | 110.8 KB, 139 rows | 158 to 311 ms |

One call, `/v1/public/futures`, carries four of the five `AnchorRow` columns for every market, keyed by `symbol`, which is CCXT's `market.id`, S2.
The interval exists only in `/v1/public/info`, so a poller reads it at boot and on a slow timer.
The socket also pushes `markprices` and `indexprices` once a second, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `PERP_BTC_USDC` | none |
| `index` | `index_price` | JSON number | none |
| `mark` | `mark_price` | JSON number, never 0 on the 80 shared rows in 120 polls | none |
| `fundingRate` | `est_funding_rate` | fraction per funding period: `0.0001` is 0.01 % | none |
| `fundingIntervalHours` | `funding_period` from `/v1/public/info` | integer hours, 8 or 4 | none |
| `nextFundingAt` | `next_funding_time` | Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 04:49 and 05:07 UTC all 80 shared rows read `next_funding_time` 08:00 UTC, the next 8 h settlement and also the next 4 h one.

## 4. Anchor semantics

### Index

"the Index price is the volume-weighted average of the underlying asset prices listed on major spot exchanges", S3.
A source more than 5 % from the median of all sources is capped at ±5 %, several sources beyond 5 % switch the index to the median, and a source silent for 10 seconds is dropped, S3.
The weights are refreshed every 5 minutes from each source's volume over the past 4 hours, S3.

The basket call is public: `GET /v1/public/index_price_source` returned 164 rows, 17,730 bytes, keyed `SPOT_<BASE>_USDC`, with source names and no weights, S2.
Every one of the 80 shared markets has a row, with 2 to 8 sources, most often 5.
`PERP_BTC_USDC` reads `gateio`, `bybit`, `binance`, `okx` and `kucoin`.
Across the 80 baskets, `gateio` and `kucoin` appear 60 times each, `binance` 55, `bybit` 54, `okx` 48, `mexc` 43 and `bitget` 30.
23 baskets include a source named `binancefuturesindex`, `bingxfuturesindex`, `mexcfuturesindex` or `hyperliquidperp`.
Nine include `hyperliquidperp`, which by its name is Hyperliquid's perpetual price, and `CL` and `BZ` use only `binancefuturesindex` and `hyperliquidperp`.
The `...futuresindex` names suggest those venues' own futures index prices rather than their perpetuals, which is an inference.
No basket names Orderly, so the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not occur, although a basket priced from another venue's perpetual can trail a move the same way.

### Mark

The documented mark is `Clamp(Median(P1, P2, Futures Price), Index Price * (1 + Factor * Floor_funding), Index Price * (1 + Factor * Cap Funding))`, S4.
`P1` is the index carried forward by the last funding rate, `P2` is the index plus a 15 minute moving average of the basis, and `Futures Price` is the median of best bid, best ask and last price, S4.
The documentation's table gives a factor of 10 and a band of 3 % on BTC, a factor of 8 and a band of 3 % on ETH, and a factor of 7 and a band of 5.25 % on other crypto markets, S4.

The wire carries the band per market as `mark_index_price_deviation_cap` and `_floor`, and it does not always equal the documented factor times `cap_funding`.
BTC reads 0.97 to 1.03, which matches 10 times its 0.003 cap.
ETH reads a cap of 1.024, 2.4 %, which is 8 times its 0.003 cap and not the documented 3 %.
37 shared markets have `cap_funding` 0.02 and a band of 1.0525, which is 7 times 0.0075 rather than 7 times 0.02.
`PERP_NAS100_USDC` and `PERP_SPX500_USDC` have an asymmetric band, 0.9925 to 1.00075.
RWA markets use a larger factor while their underlying market is closed, S4.
Over 120 polls no shared mark sat outside its wire band, and at the first poll none sat on its edge, while the absolute mark premium over index had a median of 321 ppm, p90 1,374 ppm and max 2,441 ppm.
A capped mark would read a capped leg as fresh, so a reader should treat a mark on its band edge as saturated.

### Funding

The formula, premium sampling, caps and settlement are in [`fees.md`](./fees.md) section 6, S5.
`est_funding_rate` is the predicted rate for the upcoming settlement, per funding period.
`last_funding_rate` is the last settled rate: on `PERP_BTC_USDC` it read 0.00005802, equal to the newest row of `GET /v1/public/funding_rate_history?symbol=PERP_BTC_USDC`, settled at 2026-09-23 00:00 UTC, and on `PERP_WOO_USDC` 0.00007764, equal to its newest row at the same time.
The history rows of both markets were 8 h apart for the last five settlements.
`est_funding_rate_timestamp` read `1790138970000`, `1790139030000`, `1790140050000` and `1790140110000` in four reads, each 30 s past a minute.
The socket's `@estfundingrate` frames were stamped on 15 s marks, see [`websocket.md`](./websocket.md) section 2, which matches the documented 15 s premium sampling, S5.
The settlement instant itself was not captured.

### How often each number changed

Over 59 intervals of one second polls, at 04:49 to 04:50 UTC and again at 05:07 to 05:08 UTC, each cell giving both runs:

| market | index changed | mark changed | `est_funding_rate` changed | `next_funding_time` changed |
|---|---:|---:|---:|---:|
| `PERP_BTC_USDC` | 42, 44 | 35, 42 | 0, 0 | 0, 0 |
| `PERP_ETH_USDC` | 48, 47 | 33, 27 | 4, 3 | 0, 0 |
| `PERP_SOL_USDC` | 49, 53 | 19, 53 | 4, 2 | 0, 0 |
| `PERP_WOO_USDC` | 2, 1 | 2, 1 | 0, 0 | 0, 0 |
| all 80 shared, 4,720 row intervals | 1,394, 1,740 | 1,241, 1,543 | 74, 53 | |

The estimated rate moved at most 4 times a minute, consistent with a 15 s update, and not at all on BTC and WOO.
The index and mark of a liquid market move most seconds, and a quiet market's can sit still for a minute.

## 5. REST book snapshot

`GET /v1/orderbook/{symbol}` needs an Orderly account and answered 401 `{"success":false,"code":-1002,"message":"orderly-account-id header is empty"}`.
The zero-auth book is `POST https://api.orderly.org/v1/public/query` with `{"type": "orderbook", "symbol": "PERP_BTC_USDC", "max_level": 100}`, weight 1, S6.

| request | reply |
|---|---|
| BTC, `max_level` 20 | 20 bids and 20 asks, about 1.8 KB, 243 and 218 ms |
| BTC, `max_level` 100 | 100 and 100, about 8.3 KB, 187 and 143 ms |
| BTC, `max_level` 1000 | the whole book, 435 bids and 263 asks, then 318 and 380, about 28.3 KB, 165 and 169 ms |
| WOO, `max_level` 1000 | 22 bids and 17 asks, then 20 and 20, 155 and 136 ms |

Levels are best first, bids descending and asks ascending, as `{"price": "87127.2", "quantity": "0.04373"}` strings, with `mid_price` and `spread` alongside.
The book is a cached snapshot: its inner `ts` was 0.3 to 4.5 s old on BTC over two runs, and 12.0 and 19.1 s old on WOO, which may be the time of WOO's last change rather than of the cache.
In each run five BTC reads over about 1.7 s returned only two distinct `ts` values, 6.2 s apart in the first run and 1.4 s apart in the second.
Whether that `ts` sits on the socket's delta chain was not tested, which is why [`websocket.md`](./websocket.md) section 8 takes the snapshot from the socket.

## 6. Rate limits and errors

| scope | limit | source |
|---|---|---|
| `GET /v1/public/futures` and the other public REST calls | "10 requests per 1 second per IP address" | S2 |
| `POST /v1/public/query` | 1,200 weight per rolling minute per IP, its own pool, `orderbook` and `feeRate` weigh 1, `rateLimitStatus` weighs 0 | S6 |

`/v1/public/futures` sent no rate limit header, only `date`.
The query API sent `x-ratelimit-limit: 1200`, `x-ratelimit-remaining`, `x-ratelimit-reset` in Unix ms and `x-ratelimit-weight`.
No limit was reached, so the status code and any `Retry-After` of a refusal are Not verified.
`GET /v1/public/system_info` answered `{"status":0,"msg":"System is functioning properly.","scheduled_maintenance":null}`.

| request | status | body |
|---|---|---|
| `GET /v1/public/futures/PERP_NOPE_USDC` | 200 | `{"success":true,"timestamp":…}`, no `data` |
| `GET /v1/public/funding_rate_history?symbol=PERP_NOPE_USDC` | 200 | empty `rows`, `total` 0 |
| `GET /v1/public/nope` | 400 | `{"success":false,"code":-1000,"message":"path not found"}` |
| query `orderbook` for `PERP_NOPE_USDC` | 400 | `{"success":false,"code":"INVALID_PARAM","message":"symbol PERP_NOPE_USDC not found",…}` |
| NonKYC spot `GET /api/v2/market/info?symbol=NOPE_USDT` | 400 | `{"error":{"code":2001,"message":"Market not found",…}}` |
| NonKYC spot `GET /api/v2/nope` | 404 | empty |

An unknown symbol on the per-symbol futures call is a success with no data, so a poller must check for `data`.

## 7. Server time and clock offset

| call | offset, server minus the midpoint of the request | round trip |
|---|---|---|
| Orderly `GET /v1/public/system_info`, envelope `timestamp` | +1 to +9 ms over 10 reads in two runs | 112 to 122 ms |
| NonKYC spot `GET /api/v2/time`, `serverTime` | -6 to +0.5 ms over 6 reads in two runs | 179 to 196 ms |

This host's clock is within 10 ms of both.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
It is the Niza recommendation with NonKYC's builder named, and at most one Orderly poller should exist in the engine.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.orderly.org/v1/public/futures` | one call carries index, mark, rate and next settlement for all 139 markets |
| interval source | `https://api.orderly.org/v1/public/info` at boot and every 60 s, for `funding_period` and the mark band | the interval is not in the bulk reply, and Orderly may change it or the cap |
| interval | 1,000 ms, the default | medians 153 and 158 ms and max 246 ms over two runs of 60 polls, 1 of the 10 per second budget, and a liquid index moves most seconds |
| row mapping | section 3, key `symbol` | |
| skip | rows whose `symbol` does not match `^PERP_[A-Z0-9]+_USDC$`, and rows whose `status` is not `ACTIVE` | the 59 builder-listed markets are not NonKYC's |
| saturation | flag a leg whose `mark_price / index_price` sits on `mark_index_price_deviation_cap` or `_floor` | a capped mark reads as fresh |
| deny list input | review `CL`, `BZ` and the other baskets that carry `hyperliquidperp`, and short tickers such as `S`, `M`, `SPX`, `EDGE` and `BASED` that may name a different token elsewhere | section 4 and `clusterOverrides.ts` |
| rate limit pause | `rateLimitPauseMs` 1,000 | the window is 1 s, and no `Retry-After` was seen |

The bulk reply is about 5 GB a day at one hertz.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Orderly REST, Get available symbols | https://orderly.network/docs/build-on-omnichain/restful-api/public/get-available-symbols | 2026-09-22 | Orderly Network | `/v1/public/info` fields, section 2 |
| S2 | Orderly REST, Get market info for all symbols, and Get index price source | https://orderly.network/docs/build-on-omnichain/restful-api/public/get-market-info-for-all-symbols | 2026-09-22 | Orderly Network | `/v1/public/futures` fields, the 10 per second limit, the basket call, sections 3, 4 and 6 |
| S3 | Orderly, Mark Price, Index Price, and Last Price, index section | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/mark-price-index-price-and-last-price | 2026-09-22 | Orderly Network | index formula, clamps, weights, section 4 |
| S4 | Orderly, Mark Price, Index Price, and Last Price, mark section | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/mark-price-index-price-and-last-price | 2026-09-22 | Orderly Network | mark formula, factor table, RWA factors, section 4 |
| S5 | Orderly, Funding Rate | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/funding-rate | 2026-09-22 | Orderly Network | 15 s premium sampling, schedule, section 4 |
| S6 | Orderly Public Info API, Overview and Orderbook | https://orderly.network/docs/build-on-omnichain/public-info-api/overview | 2026-09-22 | Orderly Network | `/v1/public/query`, weights, the 1,200 per minute pool, sections 5 and 6 |
| S7 | CCXT 4.5.68 `woofipro.js` | `server/node_modules/ccxt/js/src/woofipro.js` | 2026-09-22 | CCXT | host line 153, `parseMarket` lines 541 to 570, section 2 |
| S8 | CCXT 4.5.68 connector | [`connector.ts`](../../../server/src/ccxt/connector.ts) | 2026-09-22 | this repository | `isActiveSwapMarket` lines 196 to 203, section 2 |
| S9 | NonKYC REST API 1.3.0 | https://api.nonkyc.io/openapi.json | 2026-09-22 | Nonkyc.io | spot-only API, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:49, 05:04 and 05:07 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/nonkyc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2 and 4 |
| P2 | `rest-probe.mjs anchor` at 04:49 to 04:50 UTC, rerun at 05:07 to 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/nonkyc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 4 |
| P3 | `rest-probe.mjs book` and `errors` at 04:50 to 04:51 UTC, rerun at 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/nonkyc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 5, 6 and 7 |
