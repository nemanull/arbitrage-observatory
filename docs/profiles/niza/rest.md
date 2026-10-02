# Niza REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, in the local evening, which is 02:36 to 03:05 UTC on 2026-09-23.

This profile covers the public REST market data behind the Niza.fun perpetuals.
Niza.fun is the Orderly Network builder `niza`, so every call below goes to Orderly's public API, and no Niza host serves perpetual market data, see [`fees.md`](./fees.md) section 1.
Every claim was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/niza/rest-probe.mjs), in two runs at 02:45 and 02:55 UTC, and the capture is quoted beside the documented value.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 | used for | cold | warm |
|---|---|---|---|---|
| `api.orderly.org` | `34.36.82.46`, a Google front end that answers `via: 1.1 google` | the documented mainnet REST host, S1 | 202 and 174 ms for `GET /v1/public/system_info` including TLS | 135 to 172 ms, and 115 to 155 ms in the rerun |
| `api-evm.orderly.org` | `34.111.187.47` | the host CCXT `woofipro` calls, `server/node_modules/ccxt/js/src/woofipro.js` line 153 | not timed | `loadMarkets` in 866 and 774 ms |
| `ws-evm.orderly.org` | `34.111.60.95` | the public WebSocket, see [`websocket.md`](./websocket.md) | | |

`GET /v1/public/system_info` answered `{"status":0,"msg":"System is functioning properly.","scheduled_maintenance":null}` in both runs.
No call was refused, and `GET /v1/ip_info` placed this host in Canada with `"checked": false`.

The Niza hosts themselves, for the spot line of the coverage matrix:

| URL | reply on 2026-09-23 |
|---|---|
| `https://niza.io/` | 402, body `Payment required` and `DEPLOYMENT_DISABLED`, header `x-vercel-error: DEPLOYMENT_DISABLED` |
| `https://niza.fun/` and `https://niza.fun/perpetual` | 200, a Next.js app |
| `https://app.niza.io/trade/v1/markets` | 200, 453,922 bytes, 1,305 spot pairs |
| `https://app.niza.io/trade/v1/tickers` | 500, an HTML `Server Error` page, in a curl read at 02:40 UTC |
| `https://api.niza.io/` | TLS failure `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, because the host at `91.98.8.154` presents a Cloudflare Origin certificate |

## 2. Catalog

### The instruments call

`GET https://api.orderly.org/v1/public/info` returns every symbol in one reply of 110,847 bytes, S2.

| count on 2026-09-23 | value |
|---|---|
| rows | 139 |
| shared markets, `broker_id` null, named `PERP_<BASE>_USDC` | 80, all `ACTIVE` |
| builder-listed markets | 57 `_mythos`, 1 `_alpix`, 1 `_fastx` |
| `status` values | `ACTIVE` on 138, `REDUCE_ONLY` on `PERP_ALPIX_USDC_alpix` |
| `is_pretge` true | `PERP_ALPIX_USDC_alpix`, `PERP_FASTX_USDC_fastx` |
| settlement asset | USDC on all 139 |

The 80 shared markets are exactly the 80 perpetuals CoinGecko lists for Niza.fun, compared symbol by symbol on 2026-09-22.
No market carries the suffix `_niza`, so Niza lists nothing of its own.
Among the 80 are RWA markets `EURUSD`, `USDJPY`, `NAS100`, `SPX500`, `GOOGL`, `NVDA`, `TSLA`, `XAU`, `XAG`, `CL` and `BZ`.
The bases `1000BONK`, `1000PEPE` and `1000SHIB` are quoted per 1,000 tokens.

Each row carries the order rules and the funding and mark parameters, for example `PERP_BTC_USDC`:

```json
{"symbol":"PERP_BTC_USDC","broker_id":null,"quote_tick":0.1,"base_min":0.00001,"base_tick":0.00001,"min_notional":10,"std_liquidation_fee":0.006,"liquidator_fee":0.003,"funding_period":8,"cap_funding":0.003,"floor_funding":-0.003,"interest_rate":0.0001,"cap_ir":0.0004,"floor_ir":-0.0004,"mark_index_price_deviation_floor":0.97,"mark_index_price_deviation_cap":1.03,"status":"ACTIVE","deviation_factor":10,"is_pretge":false}
```

### How CCXT 4.5.68 maps it

CCXT has no Niza class, and `woofipro` reads the same Orderly catalog, see [`fees.md`](./fees.md) section 8.

| check | result, both runs |
|---|---|
| markets | 139, all `swap` |
| `market.id` | equal to `symbol` in `/v1/public/info` on 139 of 139, which is also the topic prefix on the socket and `symbol` in `/v1/public/futures` |
| unified symbol | `PERP_BTC_USDC` becomes `BTC/USDC:USDC`, and a builder market such as `PERP_AAPL_USDC_mythos` becomes `AAPL/USDC:USDC` with the suffix dropped |
| `contractSize` | 1 on every market, `woofipro.js` line 570 |
| `linear` | true on every market |
| `active` | `undefined` on every market, `woofipro.js` line 566, so the connector's `market.active !== false` keeps all 139, [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 201 |
| `taker` | 0.0005 on every market, `woofipro.js` line 318 |

### Size unit, pairs listed twice, and price scale

Book sizes are base units, and `contractSize` 1 describes them correctly.
The socket's top ten levels per side of `PERP_ETH_USDC` equalled the REST book read 600 ms later on 20 of 20 prices in the first run, see [`websocket.md`](./websocket.md) section 4.
No unified symbol appears twice on 2026-09-23.
A builder could list a suffixed market on a base the shared list already has, and CCXT would then map both to one symbol, so the recommended `marketFilter` keeps only the shared pattern.
CCXT keeps the prefix in the base, so `PERP_1000BONK_USDC` becomes `1000BONK/USDC:USDC` with base `1000BONK`, and likewise `1000PEPE` and `1000SHIB`.
These cluster only with markets another venue also names `1000BONK`, and no price scale entry is needed for them in [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts), whose `PRICE_SCALE` at lines 20 to 23 covers per 10 contracts.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /v1/public/futures` | `index_price` | `mark_price` | `est_funding_rate` | absent | `next_funding_time`, Unix ms | 59,877 to 59,883 bytes, 139 rows | 60 polls: min 151, median 159, p90 169, max 246 ms. Rerun: min 151, median 179, p90 278, max 360 ms |
| `GET /v1/public/funding_rates` | | | `est_funding_rate` and `last_funding_rate`, each with a timestamp | absent | `next_funding_time` | 33,483 bytes, 139 rows | 149 and 130 ms |
| `GET /v1/public/info` | | | | `funding_period`, hours | | 110,847 bytes | 183 and 228 ms |

No single call carries all five `AnchorRow` columns.
`/v1/public/futures` carries four, and the interval comes from `/v1/public/info`.
The interval did not change during the probe, and Orderly documents changing it only in extreme volatility or for new listings, S3.
`GET /v1/public/futures/PERP_BTC_USDC` returns the same row for one symbol in 479 bytes.
`mark_price` and `index_price` were positive on all 139 rows in both runs.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `PERP_BTC_USDC` | none, equals CCXT `market.id` |
| `index` | `index_price` | JSON number | none |
| `mark` | `mark_price` | JSON number | none |
| `fundingRate` | `est_funding_rate` | JSON number, a fraction per funding period: `0.0001` is 0.01 % | none |
| `fundingIntervalHours` | `funding_period` from `/v1/public/info` | integer hours, 8 or 4 on the shared markets | none |
| `nextFundingAt` | `next_funding_time` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

At 02:45 and 02:55 UTC, 80 rows read `next_funding_time` 08:00 UTC and 59 read 04:00 UTC, the same split as the 80 rows with `funding_period` 8 and the 59 with 4.
`BTC` and `ETH` read 08:00 UTC, and `CL` and `MERL` read 04:00 UTC.

## 4. Anchor semantics

### Index

The index is the volume-weighted average of spot prices on the listed exchanges, weighted by each exchange's 4 h volume and reweighted every 5 minutes, S4.
A source more than 5 % from the median of all sources is clamped to ±5 %, several such sources switch the index to the median, and a source silent for 10 s is dropped, S4.
Stork runs as a backup oracle, S4.

The basket is public at `GET /v1/public/index_price_source`, 164 rows keyed `SPOT_<BASE>_USDC`, S2.

| check on the 80 shared markets | result, both runs |
|---|---|
| `BTC` and `ETH` basket | `gateio`, `bybit`, `binance`, `okx`, `kucoin` |
| source counts | `gateio` and `kucoin` 60, `binance` 55, `bybit` 54, `okx` 48, `mexc` 43, `bitget` 30, `binancefuturesindex` 20, `bingx` 13, `hyperliquidperp` 9, `pyth` 8, `trademade` 4, `bingxfuturesindex` 3, `mexcfuturesindex` 3, `finage` 2, `finagefx` 2, `lbank` 2, `huobi` 1 |
| baskets that include another venue's perpetual | 23 |
| baskets made only of perpetuals | `BZ` and `CL`, both `binancefuturesindex` plus `hyperliquidperp` |
| baskets that include Orderly itself | none |

No basket is Orderly's own perpetual, so the self-index trap of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not apply.
`BZ` and `CL` follow Binance and Hyperliquid perpetuals rather than spot, and an index built on perps carries their basis.
For the RWA markets the documentation says the index is frozen while the underlying market is closed, S4.
`PERP_EURUSD_USDC` sent no book frame in 60 s during the probe, see [`websocket.md`](./websocket.md) section 5.

### Mark

The documented formula, S4:

```text
Median Price = Median(P1, P2, Futures Price)
P1 = Index * (1 + Last Funding Rate * time until next funding / dt)
P2 = Index + 15 minute moving average of (Median(Bid0, Ask0) - Index), sampled every minute
Futures Price = Median(Bid0, Ask0, Last Price)
Mark = Clamp(Median Price, Index * (1 + Factor * Floor Funding), Index * (1 + Factor * Cap Funding))
```

The clamp band is on the wire as `mark_index_price_deviation_floor` and `mark_index_price_deviation_cap`.

| band on the shared markets | markets |
|---|---|
| 0.9475 to 1.0525, ±5.25 % | 46, and 2 more at 0.94750112 to 1.05249887 |
| 0.97 to 1.03, ±3 % | `BTC`, `GOOGL`, `NVDA`, `TSLA` |
| 0.976 to 1.024, ±2.4 % | `ETH` |
| 0.9925 to 1.0075, ±0.75 % | `BZ`, `CL`, `EURUSD`, `USDJPY` |
| 0.9925 to 1.00075 | `NAS100`, `SPX500` |
| 0.99 to 1.01, ±1 % | `XAG`, `XAU` |
| 0.76666 to 1.23334, ±23.3 % | `ARB`, `OP` |
| 0.78462 to 1.21538, ±21.5 % | `ZEC` |
| 0.86 to 1.14, ±14 % | `APT`, `WLD` |
| others | 14 markets with bands from ±0.59 % (`UNI`) to ±10 % (`NEAR`) |

The documentation's factor table says 3 % for `ETH`, and the wire band for `ETH` is ±2.4 %, which is its factor 8 times its 0.3 % cap.
The mark is therefore capped against the index, the shape that reads a capped leg as fresh in the engine's gate, see [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md).
A reader should treat a mark at the band edge as saturated.
For RWA markets the documentation widens the factor fivefold while the underlying market is closed, S4.

### Funding

The formula, cap and interval are in [`fees.md`](./fees.md) section 6.
`est_funding_rate` is the predicted rate for the settlement at `next_funding_time`, S3, and its timestamp moved on 15 s marks, 02:47:00 and 02:56:45 UTC, which matches the documented 15 s premium sample.
`last_funding_rate` is the rate settled at the previous settlement.
It equalled the newest row of `GET /v1/public/funding_rate_history?symbol=<symbol>` on `BTC`, `ETH`, `CL` and `MERL` in both runs.

| symbol | period | est at 02:56 UTC | last settled, 00:00 UTC | the three settlements before |
|---|---|---|---|---|
| `PERP_BTC_USDC` | 8 h | 0.0001 | 0.00005802 | 0.00009956, 0.00009961, 0.00010048 |
| `PERP_ETH_USDC` | 8 h | 0.00018525 | 0.00017419 | 0.00017846, 0.00018696, 0.00014402 |
| `PERP_CL_USDC` | 4 h | 0.00005 | 0.00005029 | 0.00005027, 0.00005025, 0.00005007 |
| `PERP_MERL_USDC` | 4 h | 0.00005 | 0.00006408 | 0.00003282, 0.00003404, 0.00003527 |

The history rows carry `funding_rate`, `funding_rate_timestamp` and `next_funding_time`, and they settle on the documented grid, 00:00, 08:00 and 16:00 UTC for 8 h and every four hours for 4 h.
The rate is per period, since the 4 h markets sit at half the 8 h interest floor.
The settlement instant itself was not captured.

### How often each number changed

Changes between consecutive polls of `/v1/public/futures`, 59 intervals of about one second.

| symbol | index, run 1 | index, run 2 | mark, run 1 | mark, run 2 | `est_funding_rate` | `next_funding_time` |
|---|---:|---:|---:|---:|---|---|
| `PERP_BTC_USDC` | 45 | 30 | 18 | 27 | 0 and 0 | 0 |
| `PERP_ETH_USDC` | 48 | 41 | 48 | 29 | 4 and 3 | 0 |
| `PERP_CL_USDC` | 9 | 7 | 4 | 5 | 0 and 0 | 0 |
| `PERP_MERL_USDC` | 4 | 10 | 2 | 13 | 0 and 0 | 0 |

The index and mark republish at up to once a second, and the WebSocket `markprices` and `indexprices` topics push once a second too, see [`websocket.md`](./websocket.md) section 2.
A thin market such as `MERL` or `CL` can hold both for several seconds.

## 5. REST book snapshot

`GET /v1/orderbook/{symbol}` is private and answered 401 `{"success":false,"code":-1002,"message":"orderly-account-id header is empty"}`.
The zero-auth route is the Public Info API, S5 and S6.

```json
{"type": "orderbook", "symbol": "PERP_BTC_USDC", "max_level": 1000}
```

sent as `POST https://api.orderly.org/v1/public/query`.

| request | levels returned | bytes | time |
|---|---|---|---|
| `PERP_BTC_USDC`, `max_level` 100 | 100 bids, 100 asks | 8,298 and 8,286 | 191 and 217 ms |
| `PERP_BTC_USDC`, `max_level` 1000 | 428 and 278, then 419 and 288 | 28,618 and 28,647 | 131 and 145 ms |
| `PERP_ETH_USDC`, `max_level` 1000 | 508 and 193, then 476 and 216 | 27,063 and 26,713 | 163 and 135 ms |
| `PERP_MERL_USDC`, `max_level` 1000 | 25 and 28, then 21 and 30 | 2,231 and 2,149 | 118 ms |
| `PERP_AXS_USDC`, `max_level` 100 | 11 and 10, then 11 and 11 | 896 and 935 | 125 and 117 ms |

Bids arrive best first and descending and asks best first and ascending, on every reply.
Price and quantity are strings, as `{"price":"86454.1","quantity":"0.00369"}`.
The inner `ts` is the time of the book's last change, 0.6 to 5.4 s before the reply on these books.
Two reads 161 and 162 ms apart returned the same inner `ts` once and a newer one once, so the reply follows the live book.
The call costs weight 1 of the 1,200 per minute pool.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| `/v1/public/*` | 10 requests per second per IP on each public call, S2 | no rate headers on the reply, and no refusal at one call a second |
| `/v1/public/query` | 1,200 weight per minute per IP, rolling, `X-RateLimit-Limit`, `-Remaining`, `-Reset` and `-Weight` headers, S6 | headers present, `rateLimitStatus` answered `{"limit":1200,"remaining":1193,"reset":1790132220000,"tier":"default"}` |
| over the limit | `/v1` returns 429 with code -1003, S7. The Public Info API returns 429 `RATE_LIMIT_EXCEEDED` with `retry_after` in ms and a `Retry-After` header in seconds, S6 | not reached |

| request | reply |
|---|---|
| `GET /v1/public/futures/PERP_NOPE_USDC` | 200 `{"success":true,"timestamp":…}`, with no `data` |
| `GET /v1/public/funding_rate_history?symbol=PERP_NOPE_USDC` | 200 with `rows: []` |
| `GET /v1/public/nope` | 400 `{"success":false,"code":-1000,"message":"path not found"}` |
| Public Info API `orderbook` for `PERP_NOPE_USDC` | 400 `{"success":false,"code":"INVALID_PARAM","message":"symbol PERP_NOPE_USDC not found",…}` |

An unknown symbol is not an error on the `/v1/public` calls, so a poller has to notice a missing row itself.

## 7. Server time and clock offset

Every reply carries `timestamp` in Unix ms.
Against the midpoint of each request, the offset was -14 ms on `/v1/public/info`, and over 60 polls of `/v1/public/futures` it was -36 to 8 ms with a median of -19 ms, and -119 to 13 ms with a median of -26 ms in the rerun.
The clock is within the request time of this host's.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.orderly.org/v1/public/futures` | one call carries index, mark, predicted rate and next settlement for all 139 markets |
| interval source | `https://api.orderly.org/v1/public/info` on the first round and then once a minute, keeping `funding_period` per symbol | `/v1/public/futures` has no interval, and the interval changes only by Orderly's decision |
| interval | 1,000 ms, the default | median 159 and 179 ms, max 360 ms over 120 polls, 1 of the 10 per second allowed |
| row mapping | section 3, key `symbol` | |
| skip | rows not matching `^PERP_[A-Z0-9]+_USDC$`, and rows whose `status` is not `ACTIVE` | the builder-listed markets are not Niza's, and `REDUCE_ONLY` exists |
| treat as saturated | a mark within one tick of `index * mark_index_price_deviation_floor` or `index * mark_index_price_deviation_cap` | the mark is clamped, section 4 |
| watch | the RWA markets while their underlying market is closed | the index is frozen then |
| unknown symbol | log a tracked market missing from the reply | the call answers success with no row |
| rate limit pause | `rateLimitPauseMs` 1,000 | the documented window is one second, and no `Retry-After` was seen on `/v1` |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Orderly, Websocket API and REST base URLs | https://orderly.network/docs/build-on-omnichain/websocket-api/introduction | 2026-09-22 | Orderly Network | hosts, section 1 |
| S2 | Orderly REST, Get available symbols, Get market info for all symbols, Get index price source, Get predicted funding rates for all markets | https://orderly.network/docs/build-on-omnichain/restful-api/public/get-available-symbols | 2026-09-22 | Orderly Network | catalog and anchor calls, 10 per second limit, basket call, sections 2 to 4 and 6 |
| S3 | Orderly, Funding Rate | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/funding-rate | 2026-09-22 | Orderly Network | funding formula, 15 s premium, settlement grid, section 4 |
| S4 | Orderly, Mark Price, Index Price, and Last Price | https://orderly.network/docs/introduction/trade-on-orderly/perpetual-futures/mark-price-index-price-and-last-price | 2026-09-22 | Orderly Network | index and mark formulas, clamps, RWA factors, section 4 |
| S5 | Orderly Public Info API, Orderbook | https://orderly.network/docs/build-on-omnichain/public-info-api/market/orderbook | 2026-09-22 | Orderly Network | zero-auth book, `max_level` 1 to 1000, section 5 |
| S6 | Orderly Public Info API, Introduction | https://orderly.network/docs/build-on-omnichain/public-info-api/overview | 2026-09-22 | Orderly Network | weight pool, headers, 429 shape, sections 5 and 6 |
| S7 | Orderly, Error Codes | https://orderly.network/docs/build-on-omnichain/error-codes | 2026-09-22 | Orderly Network | -1003 is 429, section 6 |
| S8 | CCXT 4.5.68 `woofipro.js` | `server/node_modules/ccxt/js/src/woofipro.js` | 2026-09-22 | CCXT | host, market mapping, sections 1 and 2 |
| P1 | `rest-probe.mjs catalog`, `anchor`, `book` and `errors` at 02:45 to 02:53 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/niza/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7, first readings |
| P2 | the same four modes rerun at 02:55 to 02:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/niza/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7, second readings |
