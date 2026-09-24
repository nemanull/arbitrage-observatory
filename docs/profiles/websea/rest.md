# Websea REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:10 and 20:47 local time, which is 2026-09-23 03:10 to 03:47 UTC.

This profile covers the public REST market data of the Websea USDT-margined perpetuals, the only perpetual family the venue lists.
Two hosts serve it: the documented OpenAPI host `oapi.websea.com`, S1, and `capi.websea.com`, the undocumented host the futures web app calls, found in its bundle, S6.
Only the web host publishes the mark price, the true index and the settlement history, so both are probed.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/websea/rest-probe.mjs), in a first run at 03:24 to 03:30 UTC and a rerun at 03:42 to 03:47 UTC, written as first run and rerun.

## 1. Host and latency from this machine

| host | resolved | notes |
|---|---|---|
| `oapi.websea.com` | `172.66.160.234`, `104.20.41.173`, and two IPv6 addresses | Cloudflare, `cf-ray` suffix `YVR`, Vancouver |
| `capi.websea.com` | the same four addresses | Cloudflare |
| `cws.websea.com` | the same four addresses | Cloudflare, the web app's sockets, see [`websocket.md`](./websocket.md) |

| call | cold, 5 new connections | warm, 10 on one connection |
|---|---|---|
| `GET /v1/futures/24hr`, 89 KB | first run 346 to 1,072 ms, median 486. Rerun 398 to 945 ms, median 401 | first run 378 to 437 ms, median 385. Rerun 369 to 3,917 ms, median 372 |
| `GET capi…/webApi/market/getSymbolDetail?symbol=BTC-USDT`, 1.9 KB | | first run 196 to 228 ms, rerun 200 to 765 ms, 5 calls each |

Every call answered from this host with HTTP 200, with no geoblock, no challenge page and no refusal.
The bulk ticker took 3.9 to 4.0 s once in the rerun of `latency` and once in each of three 60 poll runs of `anchor`, see section 3.

## 2. Catalog

### The instruments calls

| call | rows | notes |
|---|---:|---|
| `GET /v1/futures/symbols` | 246 | 54.5 KB. Fields `symbol`, `base_currency`, `quote_currency`, `contract_size`, `min_size`, `max_size`, `min_price`, `max_price`, `max_hold`, `maker_fee`, `taker_fee`, `id` |
| `GET /v1/futures/info` | 246 | `contract_type` `future` on every row, and `contract_price` equal to `contract_size` of `symbols` on all 246 |
| `GET /v1/futures/symbol_precision` | 246 | price and amount decimals per symbol |
| `GET /v1/futures/24hr` | 246 | the same 246 symbols as the three calls above |
| `GET capi…/webApi/market/getSymbolList` | 246 | 212 KB, `status` `true` on all 246, and the flags `isTradFi`, `isCfd`, `isCrypto` |

No call returns a status such as trading, suspended or delisted, and none returns a listing time.
All 246 perpetuals settle in USDT.
The web list splits them into 155 crypto, 85 TradFi and 6 CFD contracts, and the TradFi names include stocks such as `NVDA`, `TSLA`, `AAPL`, pre-listing names such as `OPENAI`, `SHEIN` and `ZHIPU`, and commodities such as `XAU`, `XAG`, `CL` and `NATGAS`.
The documentation defines `contract_size` as "Contract face value, i.e., USD value per contract", S1, but on the wire it is in coins: BTC reads `0.001`, and the depth socket's `numberConvert` equals `number` times it on every entry, see [`websocket.md`](./websocket.md) section 4.

### How a catalog would map it

CCXT 4.5.68 has no Websea class, and neither has the current CCXT source, see [`fees.md`](./fees.md) section 8.
So the engine's catalog path, `loadMarkets` at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) line 68, cannot load Websea, and a catalog would have to be built from `/v1/futures/symbols`.

| engine field | source | notes |
|---|---|---|
| `rawMarketId` | `symbol`, as `BTC-USDT` | the same string on both sockets, the bulk ticker, the index call and the web calls |
| `base` | `base_currency` | `symbol` equals `base_currency` plus `-USDT` on all 246 |
| `quote` | `quote_currency` | `USDT` on all 246 |
| `linear` | true | USDT-margined, sizes in coins |
| `contractSize` | `Number(contract_size)` | ten distinct values: `0.01` on 90, `1` on 61, `10` on 34, `100` on 30, `0.1` on 20, `0.001` on 6, `10000` on 2, and `1000`, `100000` and `1000000` on 1 each |
| active | every row | no status field exists |

### Size unit, pairs listed twice, and price scale

Prices are per coin on every contract, including those with large contract sizes: `PEPE-USDT`, with a contract of 1,000,000 PEPE, last traded at `0.00000491104` in the same 03:10 UTC reply, and `SHIB-USDT` and `BONK-USDT` at `0.00000615` and `0.00000367`, so no price scale is needed on the Websea side.
No base is listed twice under one name.
Some underlyings are listed twice under different base names: `XAU`, `XAU500` and `XAUT`, `XAG` and `XAG500`, `CL` and `CL500`, `COPPER` and `COPPER500`, `NVDA` and `NVDA500`, `TSLA` and `TSLA500`.
`XAU-USDT` and `XAU500-USDT` last traded at 4,340.05 and 4,340.06 in a `/24hr` reply read with curl at 03:10 UTC.
A catalog would need to decide which of these joins a cluster, and a quote family rule alone would not catch them, since the base names differ.
Three symbols are written in Chinese characters, `币安人生-USDT`, `哈基米-USDT` and `牛来-USDT`, so the engine's symbol handling must accept non-ASCII bases or skip them.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /v1/futures/24hr` | `index_price`, a JSON number, cached, section 4 | absent | `funding_rate`, a fraction, cached | absent | `next_funding_rate_times`, Unix seconds, one second before the settlement | 89 KB, 246 rows | 60 polls a run: median 377 and 374 ms, max 3,885 and 3,918 ms |
| `GET /v1/futures/index_price` | named index, but carries the mark, section 4 | `price`, a string | absent | absent | absent | 13.9 KB, 246 rows, `ts` in Unix seconds | 60 polls a run: median 289 and 287 ms, max 351 and 366 ms |
| `GET capi…/webApi/market/getSymbolDetail?symbol=` | `indexPrice` | `markerPrice` | `capitalRate`, in percent | `feeCycle`, hours | `countdown`, seconds | 1.9 KB, one contract | 180 calls a run: median 221 and 199 ms, max 843 and 1,201 ms |
| `GET /v1/futures/funding_rate?symbol=` | | | `capitalRate`, in percent, with no envelope | | | one contract | |

No single call carries all five `AnchorRow` fields, and the only call that carries the true index and the mark together is per contract.
246 per contract calls a second would exceed the documented 100 requests per 10 s per endpoint, S2.

### Row mapping, if it were built from the bulk calls

| `AnchorRow` column | field | unit on the wire | conversion | problem |
|---|---|---|---|---|
| key | `symbol` | `BTC-USDT` | none | |
| `index` | `/24hr` `index_price` | JSON number with long decimals, `86721.00051448934` | none | changed 2 and 5 times in 59 one second polls for BTC, and sat a median of 326 to 459 ppm below the Binance index, section 4 |
| `mark` | `/index_price` `price` | decimal string | `Number()` | 0 on up to 11 new contracts in most polls |
| `fundingRate` | `/24hr` `funding_rate` | fraction per interval, `-0.0001` is -0.01 % | none | cached like the index |
| `fundingIntervalHours` | none in bulk | | `feeCycle` per contract, or the spacing of the settlement history | |
| `nextFundingAt` | `/24hr` `next_funding_rate_times` | Unix seconds, `1790150399` is 07:59:59 UTC | `(x + 1) * 1000` | |

At 03:28 and 03:45 UTC, 135 contracts read `1790150399`, 08:00 UTC less one second, and 111 read `1790135999`, 04:00 UTC less one second.
The three of the 111 read in `funding` had `feeCycle` 4, `settlementTime` `00:00/04:00/08:00/12:00/16:00/20:00` and a history spaced 14,400 s, so the 111 are at least partly 4-hourly.
No hourly contract was found among those read, so whether any contract is on the hourly schedule of [`fees.md`](./fees.md) section 6 today is Not verified.

## 4. Anchor semantics

### Index

The web app's `indexPrice` follows the Binance USD-M index closely.
It is the only Websea number that does.

| source, per poll against the Binance `premiumIndex` `indexPrice` read in the same second, S7 | BTC median, min to max | ETH median, min to max |
|---|---|---|
| web `indexPrice` | 0 ppm, -11 to 42, and -1 ppm, -21 to 114 | -2 ppm, -18 to 8, and -1 ppm, -823 to 230 |
| `/24hr` `index_price` | -459 ppm, -732 to -270, and -326 ppm, -863 to 118 | -360 ppm, -755 to 28, and -119 ppm, -1,246 to 500 |
| `/index_price` `price` | -615 ppm, -682 to -541, and -513 ppm, -682 to -393 | -515 ppm, -670 to -380, and -379 ppm, -1,556 to -21 |
| web `markerPrice` | -614 ppm, -677 to -543, and -510 ppm, -629 to -399 | -523 ppm, -608 to -435, and -383 ppm, -1,200 to -29 |

The first figure of each cell is the first run, and the second is the rerun.
Across all 246 contracts, `/24hr` `index_price` and `/index_price` `price` differed by a median of 381 and 329 ppm, p90 1,946 and 1,970 ppm, max 27,027 and 20,314 ppm.

The web detail names the basket as `"indexSource":"Binance、HUOBI、OKEX、Bitfinex、Coinbase、Bitstamp"`.
The type 8 stream sends the same string for `OPENAI-USDT`, a pre-listing contract that no spot venue quotes, so the field is a label, not the basket, P2.
The index formula, the constituents and a basket call are Not publicly specified.

### Mark

`/v1/futures/index_price` returns the mark, not the index.
Its `price` differed from the web `markerPrice` read right after it by a median of 0 ppm on BTC, -147 to 75, and 0 ppm on ETH, -356 to 140, in the rerun, which is the run that compared them.
The web mark differed from the web last trade by a median of 7 ppm on BTC, -697 to 185, and -25 ppm on ETH, -1,452 to 313.
So the mark sits on Websea's own book, which traded about 380 to 620 ppm below the Binance index during both runs.
The mark formula and its clamp are Not publicly specified.
The web detail carries `"premiumPriceRatio":"0.005"` on BTC and ETH and `"0.1"` on LAPTOP, whose meaning is not documented.
The mark "is designed to prevent unnecessary liquidations caused by market manipulation or short-term price volatility", S5, and nothing more is published.

`/index_price` returned `"0"` for new Trending Watchlist contracts in most polls: at least one zero in 60 of 60 polls of the first run and 56 of 60 of the rerun, on 11 and 8 contracts, for example `STONKS-USDT` in 46 and 32 polls.
An unknown symbol also returns `"price":"0"` with errno 0.

### Funding

The formula, interval and cap are in [`fees.md`](./fees.md) section 6, from S4.
`capitalRate` in the web detail, the single funding call and the settlement history is in percent: `"-0.0100"` is -0.01 %.
`funding_rate` in `/24hr` is the same number as a fraction, `-0.0001`.
The published rate is the live rate for the upcoming settlement, since it moves inside the interval: ETH read `0.0032`, `0.0003`, `-0.0040` and `-0.0100` percent in the `anchor` and `funding` runs between 03:24 and 03:43 UTC while its last settled rate, at 00:00 UTC, was `0.0093`.
The settlement history is `GET capi…/webApi/capital/settle?symbol=`, with `settleTime`, a `snapshotTime` 60 s earlier, the touch, `markePrice` and `capitalRate`, 50 rows for BTC and ETH.

### How often each number changed

Over 59 one second intervals of each run, across 246 contracts.

| number | median contract | busiest contract | contracts that never changed |
|---|---|---|---|
| `/24hr` `index_price` | 2 and 5 | 3 and 5 | 1 and 2 |
| `/index_price` `price`, the mark | 17 and 20 | 58 and 59 | 8 and 6 |
| `/index_price` `ts` | 59 and 59 | 59 | 0 |
| `/24hr` `funding_rate` | 0 and 0 | 2 and 2 | 166 and 165 |
| `/24hr` `next_funding_rate_times` | 0 | 0 | 246 |

| number, from the web detail | BTC | ETH |
|---|---|---|
| `markerPrice` | 57 and 57 | 52 and 56 |
| `indexPrice` | 40 and 47 | 38 and 45 |
| `capitalRate` | 0 and 0 | 2 and 0 |

`/24hr` is a cached snapshot that refreshes a few times a minute, so its index, rate and quotes can be tens of seconds old.
The `ts` of `/index_price` is the second of the reply, and its BTC age at arrival was 201 to 1,169 ms and 195 to 1,153 ms, which is the one second resolution.
The type 8 socket stream pushed each contract a median of 40 and 41 times in 40 s, with its mark changing a median of 7 and 6 times, see [`websocket.md`](./websocket.md) section 2.

## 5. REST book snapshot

| call | depth | level order | notes |
|---|---|---|---|
| `GET /v1/futures/depth?symbol=&limit=` | default 50, max 100, `limit=200` returns 100 | bids descending, asks ascending, on every read | not aggregated: the same price repeats on consecutive rows, 2 to 12 times per side on BTC, ETH, PLTR and LAPTOP at 50 rows in the rerun. LAPTOP returned 58 and 76 bids at limits 100 and 200. Prices and sizes as strings, `ts` in ms, 97 to 166 ms old |
| `GET /v1/futures/depth_merged?symbol=&depth=` | 50 gears per side | gear 1 is the touch | aggregated per merge step, the same gear keyed levels the depth socket sends. `depth` must be a listed step, `0.0001` on BTC answers errno `20501` "bad argument" |

`depth_merged` equalled the socket's top 10 gears per side on BTC, ETH, PLTR and LAPTOP in both book runs, see [`websocket.md`](./websocket.md) section 4.
Two reads of `/v1/futures/depth` in a row returned different bodies and `cf-cache-status` `DYNAMIC`, in both runs, so that call is not cached at the edge.
The documentation's example for `depth_merged` is `curl -d /v1/futures/depth_merged`, which is not a working call, S1.
The merge steps a contract accepts come from `GET capi…/webApi/market/getSymbolDepth?symbol=`, for example `100`, `10`, `1` and `0.1` for BTC, and the finest equals the price tick.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| per endpoint | 100 requests per 10 s for every public futures market call | S2 |
| global | "A global rate limit of 100 requests per 10 seconds per API key applies across all OpenAPI endpoints." | S2 |
| unsigned requests | "unsigned requests may be subject to stricter rate limits", with no number | S2 |
| status on a limit | HTTP 429 "Too Many Requests" is listed on the error page | S3 |
| rate limit headers | none on any reply, and no `Retry-After` | P1 |

No limit was reached, since the probe sent at most 3 requests a second to any host.
Errors come back as HTTP 200 with an `errno`.

| request | HTTP | body |
|---|---|---|
| `/v1/futures/depth?symbol=NOPE-USDT`, and `btc-usdt`, and `BTCUSDT` | 200 | `{"errno":20501,"errmsg":"base symbol error"}` |
| `/v1/futures/depth` with no symbol | 200 | errno 0 with `"symbol":null` and empty sides |
| `/v1/futures/funding_rate` with no or an unknown symbol | 200 | `{"capitalRate":"0"}` |
| `/v1/futures/index_price?symbol=NOPE-USDT` | 200 | errno 0 with `"price":"0"` |
| `/v1/futures/24hr?symbol=NOPE-USDT` | 200 | errno 0 with an empty `result` |
| `/v1/futures/nope` | 200 | `{"errno":404,"errmsg":"The request address does not exist. …"}` |
| `capi…/getSymbolDetail?symbol=NOPE-USDT` | 200 | `{"errno":20501,"errmsg":"The trading pair does not exist."}` |
| `api.websea.com/webApi/entrust/getRate`, the fee table call, read once with curl | 200 | `{"errno":401,"errmsg":"User information is not obtained, please log in again."}` |

An unknown symbol reads as a zero price or a zero rate on three calls, so a poller must treat 0 as missing.

## 7. Server time and clock offset

No server time call is documented.
The `Date` header minus the local midpoint of the request was -902 to -195 ms over five reads in the first run and -893 to +73 ms in the rerun.
The header has one second resolution and floors, so these readings agree with the local clock to within the round trip of about 190 to 870 ms.
Timestamps in ms on the sockets never arrived less than 89 ms old, see [`websocket.md`](./websocket.md) section 4, which bounds the one-way delay plus any offset.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The engine's poller wants one bulk reply with a fresh index and a fresh mark, at [`../../../server/src/feeds/anchor/AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts), and Websea has no such reply.

| item | recommendation | reason |
|---|---|---|
| mark | `https://oapi.websea.com/v1/futures/index_price` every 1,000 ms, `Number(price)` as the mark | a bulk call, median 287 to 289 ms, that tracks the web mark within a median of 0 ppm |
| index | none from REST at one hertz | `/24hr` refreshes a few times a minute and sits hundreds of ppm from both the mark and the Binance index, and the true index is per contract |
| alternative for index, mark and rate | the type 8 stream on `wss://cws.websea.com/ws/realTime?compress=0`, all 246 contracts on one socket | the only bulk source of the true index, but it is a socket, and the engine's anchor path is a REST poller |
| rate and next settlement | `https://oapi.websea.com/v1/futures/24hr` every 10 s or slower | the rate is cached anyway, and `next_funding_rate_times + 1` is the settlement second |
| interval | `feeCycle` from the web detail once per contract at boot, or the history spacing | not in any bulk reply |
| skip | a `price` of `"0"` | new contracts and unknown symbols read 0 |
| do not read | `maker_fee` and `taker_fee` of `/v1/futures/symbols` | they read 1, a multiplier, not a rate, see [`fees.md`](./fees.md) section 5 |
| rate limit pause | `rateLimitPauseMs` 10,000 | the window is 10 s and no `Retry-After` exists |
| deny list input | the `500` variants and `XAUT` next to `XAU` | the same underlying under a second base name, section 2 |

Without a fresh bulk index, the reader at [`../../../server/src/engine/opportunity/anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 4 to 6 would judge Websea legs on a stale index, so the anchor is a blocker until the index comes from the socket or from a new REST call.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Websea Open Interface v2.3.0, Futures Market Data pages | https://webseaex.github.io/en/ | 2026-09-22 | Websea, global | sections 2, 3, 5 |
| S2 | Websea Open Interface, Rate Limiting Rules | https://webseaex.github.io/en/about/limit/ | 2026-09-22 | Websea, global | sections 3, 6 |
| S3 | Websea Open Interface, Error Codes | https://webseaex.github.io/en/about/errno/ | 2026-09-22 | Websea, global | section 6 |
| S4 | Funding Rate Mechanism | https://webseahelp.zendesk.com/hc/en-us/articles/9168254698895-Funding-Rate-Mechanism | 2026-09-22 | Websea, global | sections 3, 4 |
| S5 | Terminology for positions, "11. Mark Price" | https://webseahelp.zendesk.com/hc/en-us/articles/7208309845775 | 2026-09-22 | Websea, global | section 4 |
| S6 | Websea web app bundles, `44.cf742c67a98b95ac49d2.js` and the futures chunks 36 and 51 | https://www.websea.com/assets/static/js/44.cf742c67a98b95ac49d2.js | 2026-09-22 | Websea, global | the `capi` host and its calls, sections 2 to 5 |
| S7 | Binance USD-M `premiumIndex`, public | https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT | 2026-09-22 | Binance | the reference index, section 4 |
| P1 | `rest-probe.mjs latency`, `catalog`, `book`, `errors` and `clock`, runs at 03:24 to 03:30 and 03:42 to 03:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/websea/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 5, 6, 7 |
| P2 | `rest-probe.mjs anchor` and `funding`, runs at 03:24 to 03:29 and 03:43 to 03:47 UTC, and `ws-probe.mjs mark` | [`rest-probe.mjs`](../../../scripts/probes/venues/websea/rest-probe.mjs), [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4 |
