# WhiteBIT REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers the public REST API v4 of WhiteBIT (CCXT id `whitebit`) that a catalog, an anchor poller and a book resync would use, for every perpetual family.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/whitebit/rest-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.
The developer documentation at `docs.whitebit.com` answered this host, and the website and help center did not, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-22 | edge |
|---|---|---|---|
| `whitebit.com` | REST base `https://whitebit.com/api/v4/public`, S1 | `104.18.32.131` and `172.64.155.125`, plus two AAAA records | both in Cloudflare's published ranges, S8 |
| `wss.whitebit.com` | current WebSocket host, see [`websocket.md`](./websocket.md) | the same two addresses | Cloudflare |
| `api.whitebit.com` | deprecated WebSocket host | the same two addresses | Cloudflare |

Every REST reply carried `server: cloudflare`, `cf-cache-status: DYNAMIC` and a `cf-ray` ending in `YVR` or `SEA`, Cloudflare's Vancouver and Seattle edges, which varied between runs.
Cloudflare's own trace service placed this host at `loc=CA` in all four runs, see [`fees.md`](./fees.md) section 1.
Where the origin runs is Not publicly specified, and the colocation page says only "Trading operations supported across EEA/EMEA and APAC regions", S9.
Depth frames arrived a median 79 to 102 ms after their own `event_time`, with this host's clock under NTP, which fits an origin in Europe rather than in Asia, and that is an inference, see [`websocket.md`](./websocket.md) section 3.

Latency from four `main` runs, at 21:34, 21:47, 22:02 and 22:08 UTC, one process each, Node `fetch` with a kept connection, one request per path every 1.1 s.

| call | first request ms | next five, min / median / max ms | reply bytes, decoded | content-encoding |
|---|---:|---:|---:|---|
| `GET /time` | 224, 205, 233, 260 | 168 / 171 / 173, 162 / 163 / 169, 169 / 175 / 185, 170 / 183 / 210 | 19 | none |
| `GET /futures` | 435, 762, 301, 268 | 244 / 301 / 1,055, 196 / 224 / 754, 208 / 240 / 759, 235 / 248 / 789 | 255,145 | `br` |
| `GET /markets` | 320, 230, 221, 269 | 253 / 329 / 745, 184 / 274 / 763, 194 / 222 / 377, 231 / 320 / 785 | 389,275 | `br` |
| `GET /orderbook/BTC_PERP?limit=100` | 173, 171, 174, 186 | 167 / 172 / 173, 164 / 166 / 168, 172 / 177 / 189, 174 / 184 / 233 | 3,991 | `br` |

The round trip to the Cloudflare edge is about 165 ms, since `/time`, which the docs say is "computed per request and ... not cached", took no less than 162 ms, S1.
No reply carried a rate limit header.
These are one host on one date.

## 2. Catalog

### The instruments calls

`GET /api/v4/public/markets` lists every market, spot and perpetual, and `GET /api/v4/public/futures` lists the perpetuals with their prices, S1 and S2.
The docs call both reference data, "re-synced from the database approximately every 10 seconds" for `markets`, S3.

| call | rows | perpetual rows | status values | fields a catalog needs |
|---|---:|---:|---|---|
| `/markets` | 1,199 | 304 `futures` and 93 `tradfiFutures` | `tradesEnabled` true on every row, since "The response includes only markets enabled for trading", S3 | `name`, `stock`, `money`, `stockPrec`, `stepSize`, `tickSize`, `makerFee`, `takerFee`, `type`, `isTradFiFutures`, `delistedAt` |
| `/futures` | 397 | 397, `product_type` `Perpetual`, `money_currency` `USDT` | none | `ticker_id` and the anchor fields of section 3 |

The 397 `ticker_id` values equal the 397 perpetual `name` values of `/markets`, with none missing either way, in all four runs.
`delistedAt` was set on `STG_PERP` for 2026-09-23 09:30 UTC, and on no other perpetual.
The docs say an announced delisting stays tradeable until it runs, and then the market leaves the reply, S4.

### How CCXT 4.5.68 maps it

| item | value | evidence |
|---|---|---|
| call | `v4PublicGetMarkets` alone, `/futures` is not read at load | `server/node_modules/ccxt/js/src/whitebit.js` lines 453 to 457 |
| `market.id` | the reply's `name`, for example `BTC_PERP` | line 484 |
| `base`, `quote`, `settle` | `stock`, and `money` with `PERP` read as `USDT`, and `settle` equal to the quote | lines 485 to 489, 505 and 506 |
| `type` swap | only when `type === 'futures'`, so the 93 `tradfiFutures` rows load as `spot` | line 497 |
| `linear`, `inverse` | true and false on every swap | lines 510 and 511 |
| `contractSize` | the amount precision, `10 ** -stockPrec`, which is the order step and not a contract multiplier | lines 500, 501 and 542 |
| `active` | `tradesEnabled` | line 490 |
| `taker` | the reply's `takerFee` divided by 100 | lines 516 and 517 |
| `loadMarkets` time | 653 to 1,105 ms | Probed |

Probed through the connector's filter, `type` swap, `swap` true and `active !== false`, identical in all four runs:

| result | value |
|---|---|
| active swaps | 304, all `USDT` linear |
| TradFi perpetuals in CCXT | 93, all as `spot`, for example `XAU/USDT` |
| markets loaded against raw rows | 1,198 against 1,199, because `CAT_USDT` spot and the TradFi `CAT_PERP` both map to `CAT/USDT` |
| `market.id` against `/futures` `ticker_id` | equal on 304 of 304 |
| `market.id` against the socket | `depth_update` names the market as `params[2]`, spelled like `market.id`, see [`websocket.md`](./websocket.md) section 4 |
| pairs listed twice among swaps | none |
| `contractSize` other than 1 | 110 of 304 |
| `contractSize` values | 1 on 194, 0.1 on 69, 0.01 on 18, 0.001 on 10, 10 on 7, 100 on 1, 1000 on 1, 10000 on 1, 100000 on 2, 1000000 on 1 |
| `stepSize` against `stockPrec` | `stepSize` equals `10 ** -stockPrec` on 304 of 304 |

Sample markets, as CCXT returned them.

| id | base | quote | settle | linear | contractSize | taker | maker | stockPrec | stepSize |
|---|---|---|---|---|---:|---:|---:|---|---|
| `BTC_PERP` | BTC | USDT | USDT | true | 0.001 | 0.00055 | 0.0001 | `"3"` | `"0.001"` |
| `ETH_PERP` | ETH | USDT | USDT | true | 0.01 | 0.00055 | 0.0001 | `"2"` | `"0.01"` |
| `SOL_PERP` | SOL | USDT | USDT | true | 0.01 | 0.00055 | 0.0001 | `"2"` | `"0.01"` |
| `STG_PERP` | STG | USDT | USDT | true | 1 | 0.00055 | 0.0001 | `"0"` | `"1"` |
| `SHIB_PERP` | SHIB | USDT | USDT | true | 1000 | 0.00055 | 0.0001 | `"-3"` | `"1000"` |
| `PEPE_PERP` | PEPE | USDT | USDT | true | 1000000 | 0.00055 | 0.0001 | `"-6"` | `"1000000"` |

### Size unit, and why the registry needs `contractSize: 1`

Book sizes and volumes are in base coins, and CCXT's `contractSize` is not a multiplier on them.

| evidence | reading |
|---|---|
| docs | the REST book level is `[price, quantity]`, with the price "in quote currency" and the quantity "in base currency", S1 |
| `/futures` volumes | `money_volume / stock_volume` over `last_price` was 0.999 on `BTC_PERP`, 0.999 on `ETH_PERP`, 0.995 on `SOL_PERP`, 0.968 on `STG_PERP`, 0.996 on `SHIB_PERP` and 1.021 on `PEPE_PERP`, so `stock_volume` is coins on markets whose CCXT `contractSize` is 0.001, 0.01, 1, 1000 and 1000000 |
| REST book, `BTC_PERP` | the touch read `"0.013"` on both sides, a multiple of the 0.001 step, about 1,120 USDT |
| REST book, `PEPE_PERP` | the best bid read `"306000000"` at `0.00000489`, a multiple of the 1,000,000 step, about 1,500 USDT |
| socket against REST | 40 of 40 top sizes equal at the same prices on `BTC_PERP`, in two runs, see [`websocket.md`](./websocket.md) section 4 |

The engine multiplies book sizes by `contractSize`, at [`types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/types.ts) line 56.
With CCXT's value it would read the `BTC_PERP` touch as 0.000013 BTC and the `PEPE_PERP` bid as 306 trillion PEPE.
A registry `contractSize: 1`, as Gemini already uses in [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts), corrects all 304.
The 13 perpetuals with a negative `stockPrec`, where CCXT's error is a factor of 10 to 1,000,000 upward, are `ADA_PERP`, `GRT_PERP`, `MOODENG_PERP`, `CETUS_PERP`, `RSR_PERP`, `PENGU_PERP` and `ANIME_PERP` at 10, `TURBO_PERP` at 100, `SHIB_PERP` at 1,000, `NEIRO_PERP` at 10,000, `BONK_PERP` and `FLOKI_PERP` at 100,000, and `PEPE_PERP` at 1,000,000.

### Pairs, tickers and price scale

Every perpetual settles in USDT, so the quote family has nothing to fold and no pair is listed twice.
WhiteBIT names its perpetuals by the plain base, and `PEPE_PERP` quotes the coin price of 0.000004889 rather than a thousand-coin price, so no price scale was needed on the markets read.
A full price scale survey against the running venues was not done.
`BB_PERP` names BounceBit and `QNT_PERP` names Quant in `index_name`, matching binance and bybit for the two `DENIED_PAIRS` entries at [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) lines 8 and 10, and a ticker collision survey was not done.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /futures` | `index_price` | `mark_price` | `funding_rate` | `funding_interval_minutes` | `next_funding_rate_timestamp` | 255 KB decoded, `br` on the wire, 397 rows | 60 polls per run: min 202, median 298, p90 665, max 1,083 ms, then min 177, median 219, p90 636, max 760 ms, then min 178, median 241, p90 750, max 861 ms, then min 189, median 248, p90 763, max 882 ms |

One call carries every `AnchorRow` column for every perpetual, keyed by `ticker_id`, which is CCXT's `market.id`.
No reply took 2 s, and one poll in 240 took over 1 s.
The docs say "The API caches the response for 1 second", and 28, 25, 27 and 27 of 59 consecutive one second polls returned a byte-identical body, S2.
Query parameters are ignored, since `/futures?market=BTC_PERP` returned all 397 rows.
The premium index socket channel pushes the same mark, index, rate and next settlement for every perpetual every 0.5 s, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `ticker_id` | string, `BTC_PERP` | none |
| `index` | `index_price` | decimal string, documented as `"0"` when neither the index nor any trade exists | `Number()`, and skip a 0 |
| `mark` | `mark_price` | decimal string, documented as `""` "while no fresh snapshot is available for the market" | `Number()`, and skip an empty string, which `Number()` turns into 0 |
| `fundingRate` | `funding_rate` | decimal string, a fraction per interval, `"0.00006502"` is 0.006502 % | `Number()` |
| `fundingIntervalHours` | `funding_interval_minutes` | integer minutes, 240 or 480 | divide by 60 |
| `nextFundingAt` | `next_funding_rate_timestamp` | decimal string of Unix milliseconds, `"1790121600000"` is 2026-09-23 00:00 UTC | `Number()` |

No `mark_price` was empty and no `index_price` was `"0"` on the 397 rows of any read, or on any of the 60 polls, in four runs.
The empty-mark case matters, because the engine takes a mark of 0 as "no mark" and refuses the route, at [`types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/types.ts) lines 32 to 49.
`funding_cap` and `funding_floor` are in the same row, see [`fees.md`](./fees.md) section 6.

CCXT's `fetchFundingRates` reads the same call at `server/node_modules/ccxt/js/src/whitebit.js` line 3401, but it looks for `markPrice` and `indexPrice` at lines 3484 and 3485, keys the reply does not carry.
Probed, it returned `fundingRate` and `fundingTimestamp` for `BTC/USDT:USDT` and no mark, index or interval, so a poller has to read the raw reply.

## 4. Anchor semantics

### Index

`index_name` read `Bitcoin`, `Ethereum` and `Solana` on the three majors, a coin name on 76 other perpetuals, and `<name> future contract` on 318 of 397.
The docs describe `index_price` as the "Price of the underlying index the contract tracks", and add "While the index is unavailable the field falls back to the last traded price of the corresponding spot market, then to the last traded price of the futures market itself", S2.
No basket or constituent call is documented, and none was found in the documentation index, S6.

| shape | contracts |
|---|---|
| TradFi index equal to the perpetual's own `last_price` at one read | 89, 92 and 61 of 93 in the second, third and fourth runs |
| TradFi index equal to the perpetual's own `last_price` on all five reads 3 s apart | 72, 75, 47 and 57 in four runs. Only `CAT_PERP`, Caterpillar, shares a ticker with a WhiteBIT spot market, `CAT_USDT`, which is a different asset |
| TradFi mark equal to the index at one read | 93 of 93 in all three reads that checked |
| crypto index equal to its own perpetual's `last_price` on all five reads | `SUSHI_PERP` in the first run, `CVC_PERP`, `MANTRA_PERP` and `OPEN_PERP` in the second, none in the third or fourth |
| crypto index equal to WhiteBIT's own spot `last_price` on all five reads | 14, 10, 5 and 6 in four runs, among them `AEVO_PERP`, `ERA_PERP`, `NOM_PERP`, `KAVA_PERP` and `SUSHI_PERP` |

Most TradFi perpetuals therefore anchor to themselves: the index is the perpetual's last trade, and the mark is the index.
That is the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), in its purest form.
CCXT loads those 93 as spot, so the connector's swap filter already keeps them out of the engine.
The crypto rows that matched a last price on five reads may be the documented fallback or a quiet book that traded at the index, and five reads cannot tell the two apart.

### Mark

The docs define the mark as "Fair value of the perpetual contract, derived from the underlying index price and the futures basis", added to the reply on 2026-08-19, S2 and S4.
The formula, its averaging window and any clamp are Not publicly specified in the pages read.

| reading | value |
|---|---|
| mark equal to the index | 182, 185, 189 and 191 of 397 in four reads, 92, 96 and 98 of them crypto in the three reads that split them |
| mark equal to the last trade | 117, 126, 143 and 82 of 397, 37, 51 and 21 of them crypto |
| mark more than 1 % from the index | 10, 8 and 7 of 397, the largest 4.49 %, 3.54 % and 4.43 % |
| `ETH_PERP` mark minus index | 0.08 on every change in the minute from 21:48:02 UTC, between minus 0.12 and plus 0.07 in the minute from 22:03:38 UTC, and between 0.06 and 0.43 in the minute from 22:09:14 UTC |
| `BTC_PERP` mark minus index | between minus 30 and minus 57 on every change logged over REST and the socket, with the mark equal to the last trade on 13, 0, 7 and 1 of 60 polls |

Gaps of 3.5 % to 4.5 % show the crypto mark is not held within 1 % of the index.
The 21:48 minute shows a basis carried as a constant, which is what a moving average basis would produce, and the later minutes show it can still move within a minute.

### How often each number changes

The mark, the index and the funding rate move in steps about 5 s apart, and the REST reply can step back to an older snapshot.

| source | `BTC_PERP` changes seen at |
|---|---|
| socket `premiumIndex`, pushed every 0.5 s, seconds after the subscribe, run at 21:41 UTC | 1.0, 4.1, 9.5, 14.6, 19.5, 24.6, 29.5, 34.5, 39.5, 44.5, 49.5, 54.5, 59.5, 64.5, 69.5 |
| socket `premiumIndex`, run at 21:55 UTC | 1.3, 6.2, 11.2, 16.2, 21.2, 26.2, 31.2, 36.2, 41.2, 46.2, 51.2, 56.7, 61.7, 66.7 |
| REST `/futures`, one poll a second from 21:48:02 UTC | 02.6, 07.1, 12.1, 17.2, 22.1, 27.1, 31.3, 38.2, 41.1, 46.1, 56.1 |
| REST `/futures`, one poll a second from 22:03:38 UTC | 38.8, 41.3, 46.3, 51.7, 53.7, 54.7, 57.4, then 02.7, 08.3, 09.7, 15.7, 21.7, 26.8, 32.7, 36.7 |

In the third REST run the reply at 22:03:54.7 carried exactly the mark and index of 22:03:51.7, and the one at 22:03:57.4 went back to those of 22:03:53.7, on `BTC_PERP` and `ETH_PERP` alike.
The fourth run, from 22:09:14 UTC, saw 12 changes 4 to 7 s apart and no reversal.
So consecutive polls can be served from snapshots of different ages, which the 1 s shared cache of S2 makes plausible, and the engine then sees a move and its reversal that never happened.

60 polls at one per second, four runs:

| contract | index changed | mark changed | funding rate changed | longest wait between index changes |
|---|---:|---:|---:|---:|
| `BTC_PERP` | 5, 4, 14, 11 | 15, 9, 14, 12 | 1, 1, 1, 1 | 20, 20, 6, 7 s |
| `ETH_PERP` | 8, 6, 14, 11 | 9, 6, 14, 11 | 0, 0, 0, 0 | 20, 20, 6, 11 s |
| `SOL_PERP` | 12, 10, 14, 12 | 17, 11, 14, 12 | 1, 1, 1, 1 | 15, 10, 6, 7 s |
| `STG_PERP`, in delisting | 0, 4, 5, 1 | 4, 4, 7, 4 | 0, 0, 0, 0 | 59, 34, 40, 47 s |

A 5 s step allows at most 12 changes a minute, and the third run's 14 include two reversals.
On the socket, the number of perpetuals whose index changed between two pushes had a median of 0 in both runs, with a maximum of 105 and 132, so the whole table refreshes in one step every tenth push.
A one second poll therefore returns the same anchor about four times in five, and a change carries up to 5 s of movement.
The reader stamps each reading on arrival, so a value up to 5 s old passes its 10 s age limit, and the 1,000 ppm move guard judges 5 s of movement at once, or a reversal of it, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 4 to 6.

### Funding

The published `funding_rate` is documented as the predicted rate for the next settlement, and it changed at most once a minute on the tracked contracts, both times seen on a step of the mark.
The funding history row of a settlement carries `rateCalculatedTime` one interval before `fundingTime`, 28,800 s on all 100 `BTC_PERP` rows, and the docs say "The rate is computed before the actual settlement", S7.
The cap, the floor and the interval are in [`fees.md`](./fees.md) section 6.

### Rate across a settlement

Not captured.
Every perpetual next settled at 2026-09-23 00:00 UTC, more than two hours after the probing window closed, and no contract was on a shorter interval.
`rest-probe.mjs settlement` waits for the next settlement, polls four contracts every 5 s from 90 s before it to 120 s after it, and then reads their funding history, so a later run can answer whether the rate charged is the last one published and what the reply shows in the minute after the instant.
Until then, the published `funding_rate` is the predicted rate for the upcoming settlement on the docs' word alone, S2.

## 5. REST book snapshot

`GET /api/v4/public/orderbook/{market}?limit=&level=`, S1.

| item | documented | probed |
|---|---|---|
| depth | `limit` "0 - 100. Not defined or 0 will return 100 entries" | no limit, 0, 100, 101 and 1000 all returned 100 bids, and 99 or 100 asks on `BTC_PERP`. 20 returned 20 per side |
| over the maximum | Not publicly specified | clamped to 100 without an error |
| order | bids and asks as arrays | bids descending and asks ascending on `BTC_PERP`, `STG_PERP` and `BTC_USDT` |
| aggregation | `level` 0 to 10, and out-of-range values "are clamped" to that range "rather than rejected" | `level=2` returned 20 aggregated levels. `level=abc` returned HTTP 200 with `"asks":null,"bids":null` |
| sizes | "quantity in base currency" | strings, base coins, see section 2 |
| timestamp | `timestamp` "Current timestamp" | integer Unix seconds |
| id | none | no update id, so a REST book cannot be aligned with the socket's `update_id` |
| caching | "The API caches the response for 100 ms" | three reads within about 330 ms returned byte-identical bodies |
| RPI orders | "Public order book responses exclude Retail Price Improvement (RPI) orders" | |
| rate limit | 600 requests per 10 s | not reached |
| time | | 164 to 173 ms warm, about 4 KB at 100 levels and 860 bytes at 20 |

`GET /orderbook/depth/{market}`, the ±2 % book of S5, answered 422 `{"market":["Market is not available."]}` for `BTC_PERP` and served `BTC_USDT`, so it is spot only.
The recommended feed takes its snapshot from the socket and needs no REST book, see [`websocket.md`](./websocket.md) section 8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | "All rate limits are per IP address", `/api/v4/public/*` "20,000 requests / 10 sec", S10. The API description says "2000 requests/10 sec for most endpoints", `/futures` and `/markets` state 2,000 per 10 s, and `/orderbook` 600 per 10 s, S1 to S5 | no reply carried a limit header, and no limit was reached at one request a second |
| status on limit | "HTTP 429 with a non-JSON body served by the gateway/CDN", S1 | not reached |
| `Retry-After` | Not publicly specified | not seen |
| maintenance | "every endpoint returns HTTP 503 with a non-JSON body served by the gateway", S1 | not seen |
| regional refusal | HTTP 451 with `{"success": false, "message": "...", "errors": []}` on `/futures` and `/collateral/markets`, S2 | `/collateral/markets` answered 451, `/futures` answered 200 |

| request | status | body |
|---|---:|---|
| `/orderbook/NOPE_PERP` | 422 | `{"market":["Market is not available."]}` |
| `/orderbook/BTC_PERP?limit=abc` | 422 | `{"limit":["The limit must be an integer."]}` |
| `/orderbook/BTC_PERP?level=abc` | 200 | `{"ticker_id":"BTC_PERP","timestamp":…,"asks":null,"bids":null}` |
| `/funding-history/NOPE_PERP` | 422 | `{"market":["Market is not available."]}` |
| `/funding-history/BTC_USDT` | 422 | `{"market":["Market is not available."]}` |
| `/trades/NOPE_PERP` | 422 | `{"market":["Market is not available."]}` |
| `/nope` | 404 | empty |
| `/collateral/markets` | 451 | `{"errors":[],"message":"Margin trading is not available in your country.","success":false}` |

The engine's poller pauses on 403, 418 and 429, at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) lines 187 to 193 and [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1.
A WhiteBIT poller should also log a 451 and a 503 in full, since those are the documented refusals for region and maintenance.

## 7. Server time and clock offset

`GET /time` returns `{"time":1790112989}` in whole Unix seconds.
Three reads a run with a 162 to 189 ms round trip bounded the local clock minus the server clock between minus 296 and plus 139 ms, minus 224 and plus 209 ms, minus 481 and plus 148 ms, and minus 284 and plus 176 ms in the four runs.
That is consistent with no offset, and a seconds field cannot resolve anything finer.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://whitebit.com/api/v4/public/futures` | one call carries all five `AnchorRow` fields for all 397 perpetuals |
| interval | 1,000 ms, the default | the values step about every 5 s, so a 1 s poll mostly repeats, and it keeps the arrival stamp within 1 s of each step |
| stale replies | drop a row whose values equal those of the poll before the previous one while the previous differed, or read `premiumIndex` instead | the REST reply stepped back to an older snapshot twice in one minute |
| row mapping | section 3, key `ticker_id` | |
| skip | rows whose `mark_price` is `""` or whose `index_price` is `"0"` | documented placeholders, and an empty mark reads as 0 |
| skip | TradFi perpetuals, which CCXT already loads as spot | their index is mostly their own last trade and their mark is that index |
| do not use | CCXT `fetchFundingRates` | it drops the mark, the index and the interval |
| rate limit pause | `rateLimitPauseMs` 10,000 | the windows are 10 s, and no `Retry-After` is documented |
| budget | 1 request per second against 2,000 per 10 s | |
| alternative | subscribe `premiumIndex` with an empty list on the book socket | the same fields for every perpetual every 0.5 s without a poll, but the engine's anchor path is a REST poller today |

The bulk reply is about 255 KB decoded and much less on the wire with `br`, about 22 GB a day decoded at one hertz, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Orderbook, `GET /api/v4/public/orderbook/{market}`, with the shared Public HTTP API V4 description of caching and errors | https://docs.whitebit.com/api-reference/market-data/orderbook.md | 2026-09-22 | WhiteBIT, global | base URL, caching tiers, error shapes, 429 and 503, book limits, base currency sizes, sections 1, 2, 5 and 6 |
| S2 | Available futures markets list, `GET /api/v4/public/futures` | https://docs.whitebit.com/api-reference/market-data/available-futures-markets-list.md | 2026-09-22 | WhiteBIT, global | anchor fields, index fallback, empty mark, 1 s cache, 451, sections 3, 4 and 6 |
| S3 | Market info, `GET /api/v4/public/markets` | https://docs.whitebit.com/api-reference/market-data/market-info.md | 2026-09-22 | WhiteBIT, global | catalog fields, refresh interval, section 2 |
| S4 | Changelog | https://docs.whitebit.com/changelog.md | 2026-09-22 | WhiteBIT, global | `delistedAt`, `mark_price` on 2026-08-19, sections 2 and 4 |
| S5 | Depth, `GET /api/v4/public/orderbook/depth/{market}` | https://docs.whitebit.com/api-reference/market-data/depth.md | 2026-09-22 | WhiteBIT, global | the ±2 % book, section 5 |
| S6 | Documentation index | https://docs.whitebit.com/llms.txt | 2026-09-22 | WhiteBIT, global | no index basket endpoint, section 4 |
| S7 | Funding history, `GET /api/v4/public/funding-history/{market}` | https://docs.whitebit.com/api-reference/market-data/funding-history.md | 2026-09-22 | WhiteBIT, global | `rateCalculatedTime`, section 4 |
| S8 | Cloudflare IP ranges | https://www.cloudflare.com/ips-v4 | 2026-09-22 | Cloudflare | edge addresses, section 1 |
| S9 | Colocation Services | https://docs.whitebit.com/platform/colocation.md | 2026-09-22 | WhiteBIT, global | regions, section 1 |
| S10 | REST API rate limits and error codes | https://docs.whitebit.com/api-reference/rate-limits.md | 2026-09-22 | WhiteBIT, global | per IP limits and 429, section 6 |
| S11 | CCXT 4.5.68 `whitebit.js` | `server/node_modules/ccxt/js/src/whitebit.js` | 2026-09-22 | CCXT | catalog mapping and funding parse, sections 2 and 3 |
| P1 | `rest-probe.mjs main`, 21:34, 21:47, 22:02 and 22:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/whitebit/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `ws-probe.mjs book`, premium index series, 21:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs) | 2026-09-22 | this host | section 4 |
