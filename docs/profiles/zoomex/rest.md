# Zoomex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:11 to 03:54 UTC, from the development host near Seattle.

This profile covers the public REST API v3 of Zoomex for its perpetual catalog and anchor, and the verdict that follows from both.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/zoomex/rest-probe.mjs) or by `curl` from this host, and the capture is quoted beside the documented value.
The API documentation at `zoomexglobal.github.io/docs/` is Bybit's v5 documentation under Zoomex names, and the market calls are Bybit's v5 calls under the path prefix `/cloud/trade/v3/market/` instead of `/v5/market/`.

The central finding is in section 2.
On 693 of 697 USDT perpetuals, what Zoomex publishes is Bybit's book, Bybit's trades, Bybit's index, mark and funding.
Four perpetuals, `BTCUSDT`, `ETHUSDT`, `SOLUSDT` and `GMTUSDT`, are a market of Zoomex's own, and the bulk ticker reports Bybit's numbers for those four too.

## 1. Host and latency from this machine

| host | resolves to on 2026-09-23 | probed |
|---|---|---|
| `openapi.zoomex.com` | `openapi.zoomex.com.edgekey.net`, then `e170158.a.akamaiedge.net`, then 184.30.150.154 and 184.30.150.138, Akamai | cold `curl` of `/time`: connect 20 ms, TLS done 47 ms, first byte 235 ms, HTTP 200 |
| `stream.zoomex.com` | `d1yq1nuwbz5sl7.cloudfront.net`, then 99.86.101.16, .70, .14 and .90, CloudFront | see [`websocket.md`](./websocket.md) section 1 |

Warm request times from P1, over one kept-alive connection, in two runs:

| call | reply | time |
|---|---|---|
| `/time` | 134 bytes | 10 calls a run, 179 to 293 ms round trip |
| `/tickers?category=linear` | 353 KB, 697 rows | 60 polls a run: min 244 and 244, median 299 and 299, p90 373 and 530, max 864 and 617 ms, 0 over 1 s |
| `/instruments-info?category=linear&limit=1000` | 385 KB, 697 rows | 416 and 713 ms |
| `/orderbook?category=linear&symbol=BTCUSDT&limit=50` | 2.3 KB | 236 and 207 ms |

No request from this host was refused.
The website `www.zoomex.com` answered 200, and the Help Center pages answered 403 while the Help Center API answered 200, see [`fees.md`](./fees.md).

## 2. Catalog

### The instruments call

`GET https://openapi.zoomex.com/cloud/trade/v3/market/instruments-info?category=linear&limit=1000`, S1.

| category | rows | status | type | settle | funding interval, minutes |
|---|---:|---|---|---|---|
| `linear` | 697 | 697 `Trading` | `LinearPerpetual` | USDT | 368 at 480, 326 at 240, 3 at 60 |
| `inverse` | 4 | 4 `Trading` | `InversePerpetual` | BTC, ETH, SOL, XRP | 4 at 480 |
| `spot` | 95 | 95 `Trading` | | quote USDT | |
| `option` | HTTP 400 `We don't support the category, plz check.` | | | | |

One page holds the whole family at `limit=1000`, and `nextPageCursor` came back empty.
`limit=5` returned the cursor `first%3D0GUSDT%26last%3D10000SATSUSDT`.
`status=PreLaunch` returned 0 rows, and the documentation says linear and inverse have `Trading` only, S1.
Documented states are `PreLaunch`, `Trading`, `Settling` and `Closed`, S2.
`offlineTime` was set on one row, `PENGUUSDT`, to `1738227600`, which read as seconds is 2025-01-30, long past, while the row still said `Trading`.

The tags split the linear catalog: 234 `Stock`, 4 `Commodity`, 73 `Innovation Zone`, 152 `new`, and others, P1 `catalog`.
All 697 linear symbols are also in Bybit's linear catalog, P1 `catalog`.

### Whose market this is

| check | relayed perpetuals | own perpetuals | evidence |
|---|---|---|---|
| WebSocket `orderbook.50` | 688 and 687 in two runs carry Bybit's `u` and `seq` frame for frame, and the other 5 or 6 all but 1 to 7 frames | 4 carry their own | [`websocket.md`](./websocket.md) section 4 |
| single symbol ticker against the bulk row | equal cap and open interest within a factor of 2 on 693 | different cap and open interest on `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `GMTUSDT` | P1 `own` |
| recent trades against Bybit's | `XRPUSDT`, `CHRUSDT`: 60 of 60 execution ids are Bybit's | `ETHUSDT`: 0 of 60 | P1 `mirror` |
| settled funding against Bybit's, last 4 settlements | `CHRUSDT`: 4 of 4 equal | `BTCUSDT` 0 of 4, `ETHUSDT` 0 of 4, `GMTUSDT` 3 of 4, the three all at the 0.0001 baseline | P1 `funding` |

The own open interest is small against Bybit's: 107.458 BTC against 60,401.797 BTC on `BTCUSDT`, and 4,114.22 ETH against 854,995.45 ETH on `ETHUSDT`, P1 `own` in the second pass.
The Help Center search API returned 0 articles for "bybit" on 2026-09-23, so this relationship rests on the wire alone.

### How CCXT 4.5.68 maps it

CCXT has no Zoomex class, see [`fees.md`](./fees.md) section 8.
Because the calls are Bybit's under another prefix, a subclass of `ccxt.bybit` loads the catalog, P1 `ccxt`:

```js
class Zoomex extends ccxt.bybit {
  describe() {
    return this.deepExtend(super.describe(), {
      id: 'zoomex', name: 'Zoomex', hostname: 'zoomex.com',
      urls: { api: { public: 'https://openapi.zoomex.com', spot: 'https://openapi.zoomex.com', futures: 'https://openapi.zoomex.com', v2: 'https://openapi.zoomex.com' } },
      options: { fetchMarkets: { types: ['linear', 'inverse'] } },
    });
  }
  sign(path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
    return super.sign(path.replace(/^v5\//, 'cloud/trade/v3/'), api, method, params, headers, body);
  }
}
```

The `sign` override is needed because the class builds `urls.api[api] + '/' + path` with paths spelled `v5/market/...`, at `server/node_modules/ccxt/js/src/bybit.js` line 9883.
The option type is dropped because Zoomex answers `category=option` with HTTP 400.
The spot type is dropped because the engine loads swaps only.

| item | result | evidence |
|---|---|---|
| `loadMarkets` | 701 markets in 571 and 631 ms, all active swaps: 697 linear, 4 inverse | P1 `ccxt` |
| `market.id` | equal to the REST `symbol` on 701 of 701, and to the socket topic symbol | P1 `ccxt`, [`websocket.md`](./websocket.md) section 3 |
| `contractSize` | 1 on all 701, from `bybit.js` line 2199, which gives linear 1 and inverse `minOrderQty` | P1 `ccxt` |
| `linear` | true on 697, false on 4 | P1 `ccxt` |
| `active` | `status === 'Trading'`, `bybit.js` line 2215 | P1 `ccxt` |
| `taker`, `maker` | 0.0006 and 0.0001 on all 701, fallback constants at `bybit.js` lines 2219 and 2220 | P1 `ccxt` |
| pairs listed twice | none | P1 `ccxt` |

### Size unit, pairs listed twice, and price scale

- USDT-M sizes are base coin, which matches `contractSize` 1, see [`websocket.md`](./websocket.md) section 4.
- Inverse sizes are 1 USD contracts, which `contractSize` 1 misdescribes as 1 coin, see [`websocket.md`](./websocket.md) section 4.
- No base is listed twice within the linear family.
  `BTC` and `ETH` appear as `BTCUSDT` and `BTCUSD`, which the quote family ranks with USDT first, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
- 16 symbols carry a multiplier in the name, such as `1000PEPEUSDT`, `10000SATSUSDT` and `1000000MOGUSDT`, and CCXT keeps it in the base, `1000PEPE`, as it does for Bybit, P1 `catalog` and `ccxt`.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /cloud/trade/v3/market/tickers?category=linear` | `indexPrice` | `markPrice` | `fundingRate` | `fundingIntervalHour` | `nextFundingTime`, Unix ms | 353 KB, 697 rows | median 299 ms, max 864 and 617 ms over 60 polls, two runs |
| `GET /cloud/trade/v3/market/tickers?category=inverse` | | | | | | an empty `list` with `retCode` 0 | |
| `GET /cloud/trade/v3/market/tickers?category=inverse&symbol=BTCUSD` | same fields | | | | | one row | |
| `GET /cloud/trade/v3/market/tickers?category=linear&symbol=BTCUSDT` | same fields | | | | | one row, Zoomex's own market | |

One linear call carries every `AnchorRow` column for all 697 perpetuals, keyed by `symbol`, which is CCXT's `market.id`.
The reply also carries `fundingCap`, the per contract cap, since the 2026-03-30 change log entry, S3.
The inverse family answers only per symbol, so its four contracts take four calls.

### The bulk row is Bybit's, also for the four own markets

Read in the second pass, P1 `mirror`: the bulk reply first, then the Zoomex single symbol call and Bybit's single symbol call together.

| perpetual | field | Zoomex bulk | Zoomex single symbol | Bybit single symbol |
|---|---|---|---|---|
| `BTCUSDT` | `markPrice` | 86797.00 | 86792.47 | 86797.00 |
| `BTCUSDT` | `fundingRate` | 0.00002534 | 0.00001427 | 0.00002534 |
| `BTCUSDT` | `fundingCap` | 0.00333 | 0.0027 | 0.00333 |
| `BTCUSDT` | `openInterest` | 60606.98 | 105.894 | 60606.98 |
| `ETHUSDT` | `fundingRate` | 0.00007014 | 0.0001 | 0.00007014 |
| `SOLUSDT` | `fundingCap` | 0.005 | 0.01 | 0.005 |
| `GMTUSDT` | `openInterest` | 126528364 | 1643225 | 126528364 |
| `CHRUSDT`, relayed | `fundingRate`, `fundingCap` | equal | equal | equal |

The index was the same in all three columns for `BTCUSDT`.
The WebSocket ticker of the four own markets carries the single symbol values, in two runs of P2 `tickers`, see [`websocket.md`](./websocket.md) section 2.
So for the four own markets the bulk reply hands the poller Bybit's mark, rate and cap, and only the single symbol call gives Zoomex's own.

Across all 697 perpetuals, five bulk reads beside Bybit's bulk reply matched Bybit on these counts, P1 `mirror`, in two runs:

| field | matching rows per read, run 1 | run 2 |
|---|---|---|
| `indexPrice` | 650, 685, 680, 686, 695 | 685, 694, 697, 697, 694 |
| `markPrice` | 676, 693, 685, 687, 694 | 688, 696, 695, 696, 694 |
| `fundingRate` | 696, 697, 697, 696, 697 | 696, 696, 696, 697, 697 |
| `nextFundingTime` | 697 in every read | 697 in every read |
| `fundingCap` | 697 in every read | 697 in every read |
| best bid and ask | 659, 680, 689, 690, 695 | 690, 691, 694, 693, 692 |

The two replies were read in parallel, with server times up to 328 ms apart in run 1 and 43 ms in run 2, so a miss is a number that moved between the two reads.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `indexPrice` | decimal string, never 0 on 697 rows | `Number()` |
| `mark` | `markPrice` | decimal string, never 0 on 697 rows | `Number()` |
| `fundingRate` | `fundingRate` | decimal string, a fraction per interval: `"0.0001"` is 0.01 % | `Number()` |
| `fundingIntervalHour` | `fundingIntervalHour` | string hours: `"8"`, `"4"`, `"1"` | `Number()` |
| `nextFundingAt` | `nextFundingTime` | string Unix ms: `"1790150400000"` is 2026-09-23 08:00 UTC | `Number()` |

At 03:15 UTC the 368 contracts on 8 h read 08:00 UTC and the 329 on 4 h or 1 h read 04:00 UTC, P1 `anchor`.
This is the row mapping of the existing Bybit poller at [`anchor.ts`](../../../server/src/venues/bybit/anchor.ts).

## 4. Anchor semantics

### Index

- "Zoomex calculates the composite index price every 500 milliseconds", from "the most liquid spot and derivative exchanges worldwide", S4.
- TradFi contracts use a weighted index during market hours and hold the last value outside them, with every component limited to ±3 % of the Pyth index, S5.
- No basket call exists: `/cloud/trade/v3/market/index-price-components` answered HTTP 404 `404 page not found` to `curl`, and the documentation lists none, S8.
- The index equals Bybit's on 650 to 697 of 697 rows per read, section 3, and on all six perpetuals in P2 `tickers`, own markets included.
  So Bybit's public `GET https://api.bybit.com/v5/market/index-price-components?indexName=<symbol>` is the practical basket source, which is an inference from the equal numbers.

### Mark

- `Mark Price = Median (Price 1, Price 2, Last Traded Price)`, with `Price 1 = Index Price × [1 + Last Funding Rate × (Time Until Funding / 8)]` and `Price 2 = Index Price + Moving Average (2.5-minute Basis)`, the basis being `(Bid1 + Ask1)/2 − Index Price` sampled every second, S6, updated 2026-09-18.
- No other clamp is published.
  Because the median includes the last trade, the mark often is the last trade: `markPrice` equalled `lastPrice` on a median of 26 and 22 of 60 polls per perpetual in two runs, P1 `anchor`.
- This is Bybit's formula and Bybit's number, which the engine already reads for Bybit.

### Funding

- `F = P + clamp(I − P, 0.05%, −0.05%)`, `I` = 0.01 % per 8 h, `P` sampled every minute and averaged, S7.
- The cap is per contract in `fundingCap`, 19 distinct values from 0.0025 to 0.05 in the bulk reply, P1 `anchor`.
- The published rate is the upcoming one, "updated every minute" until the interval ends, S7.
- Funding history, `GET /cloud/trade/v3/market/funding/history?category=linear&symbol=<symbol>`, returns `symbol`, `fundingRate` and `fundingRateTimestamp`, spaced exactly by the interval, P1 `funding`.
  Passing only `startTime` answers HTTP 200 with `retCode` 10001 `params error: Time Is Invalid`, as documented.

### Rate across a settlement

The settlement instant was not captured, by design of this survey.
At 03:16 UTC the latest settled rows were 2026-09-23 00:00 UTC for 8 h contracts, 00:00 UTC for `XAUUSDT` on 4 h, and 03:00 UTC for `LSKUSDT` on 1 h, so history is written at the instant or soon after, P1 `funding`.
Whether the settled rate equals the last published estimate was not checked.

### How often each number changed

Over 60 bulk polls one second apart, 59 intervals, in two runs, P1 `anchor`:

| number | per perpetual, changes in 59 intervals | never changed |
|---|---|---:|
| `indexPrice` | median 3 and 5, p90 23 and 29, max 58 and 59 | 105 and 84 |
| `markPrice` | median 4 and 6, p90 20 and 27, max 58 and 58 | 135 and 85 |
| `fundingRate` | median 0 and 0, p90 1 and 1, max 33 and 32 | 554 and 537 |
| `nextFundingTime` | 0 | 697 and 697 |

`BTCUSDT` changed its index 38 and 57 times and its mark 55 and 58 times, `ETHUSDT` its index 33 and 56 times and its mark 25 and 57 times, and `CHRUSDT` its index 12 and 18 times and its mark 11 and 13 times.

## 5. REST book snapshot

`GET /cloud/trade/v3/market/orderbook?category=linear&symbol=<symbol>&limit=<n>`, limit 1 to 500, default 25, S8.

| limit | bids | asks | order |
|---:|---|---|---|
| 1 | 1 | 1 | descending, ascending |
| 25 | 25 | 25 | descending, ascending |
| 50 | 50 | 50 | descending, ascending |
| 200 | 200 | 200 | descending, ascending |
| 500 | 413 and 416 | 247 and 240 | descending, ascending |
| 501 | 413 and 416 | 247 and 240 | accepted, the same as 500 |

These are `BTCUSDT`, an own market, at 03:16 and 03:39 UTC, P1 `book`.
The reply carries `s`, `b`, `a`, `ts`, `u`, `seq` and `cts`.
Its `u` is the `u` of the `orderbook.1000` WebSocket topic, see [`websocket.md`](./websocket.md) section 2, and `u` and `ts` move together.
Two `ETHUSDT` reads made 100 ms apart moved `u` by 1 and `ts` by 1,000 ms in the first run, and by 2 and 400 ms in the second, so the reply is the current state of that book and not a cached copy.
On `BTCUSDT` the top 20 levels per side of the WebSocket book equalled this reply, 40 of 40, in each run of the socket probe.
The reply sends `cache-control: max-age=0`.
The inverse book answers the same way, with sizes in USD contracts.

## 6. Rate limits and errors

- "You are allowed to send 600 requests within a 5-second window per IP by default", S9.
- Over the limit: HTTP 403 "access too frequent", and "you should terminate all HTTP sessions and wait for at least 10 minutes", S9.
  The engine already pauses on 403, at [`errors.ts`](../../../server/src/shared/errors.ts) line 1.
- The public replies carried no `X-Bapi-Limit` header, only `cache-control` and `traceid`, P1 `errors`.
  No limit was reached, so `Retry-After` was never seen.

| request | HTTP | content type | body |
|---|---:|---|---|
| unknown symbol, tickers or orderbook | 400 | `text/plain` | `we don't support this symbol, plz check.` |
| a spot symbol on `category=linear` | 400 | `text/plain` | same |
| unknown category | 400 | `text/plain` | `We don't support the category, plz check.` |
| no category | 400 | `text/plain` | `must input category` |
| orderbook without symbol | 200 | `application/json` | `{"result":null,"retCode":10001,"retExtInfo":null,"retMsg":"params error: symbol invalid",…}` |
| unknown path | 404 | `text/plain` | `404 page not found` |

A poller that parses the body as JSON has to check the status first, because several refusals are plain text.

## 7. Server time and clock offset

`GET /cloud/trade/v3/market/time` returns `{"retCode":0,"retMsg":"OK","result":{"timeSecond":"1790133386","timeNano":"1790133386488476194"},"retExtInfo":{},"time":1790133386488}`.
Over 10 calls the server clock led this host by a median 7 ms, between −1 and 46 ms, with round trips of 184 to 293 ms, and in the second pass by a median 7 ms, between 5 and 34 ms, with round trips of 179 to 248 ms, P1 `time`.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

### Whether to add the venue

On 693 of 697 perpetuals, Zoomex is Bybit's book, trades, index, mark and funding under another name, and its relay reached this host a median of 5 ms early to 10 ms late against Bybit's own socket.
Added beside Bybit, those markets would give the engine a second copy of every Bybit route at a higher fee, 600 ppm against 550, and a Zoomex and Bybit pair that can never cross.
Only `BTCUSDT`, `ETHUSDT`, `SOLUSDT` and `GMTUSDT` are a separate market, with their own book, funding and open interest.
Their books move in bursts with pauses of up to about a second, and their mid sat a median of 0 to 229 ppm from Bybit's across two runs, well under the 1,150 ppm the two takers cost together, see [`websocket.md`](./websocket.md) section 4.

So the recommendation is to keep Zoomex out while Bybit is a venue.
If it is added, it should carry only the four own markets through a `marketFilter`.

### If the four own markets are added

| item | recommendation | reason |
|---|---|---|
| catalog | the `ccxt.bybit` subclass of section 2, with a `marketFilter` keeping `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `GMTUSDT` | no CCXT class, and the other 693 are Bybit's markets |
| URL | `https://openapi.zoomex.com/cloud/trade/v3/market/tickers?category=linear&symbol=<symbol>`, once per tracked market | the bulk row is Bybit's for exactly these four |
| interval | 1,000 ms, four calls a round | 4 calls a second against 120 a second allowed, and median 299 ms for the far larger bulk call |
| row mapping | section 3, the same as the Bybit poller | |
| skip | rows whose `fundingRate` or `fundingIntervalHour` is empty, as the Bybit poller does | |
| errors | treat any non-200 status and any `retCode` other than 0 as a failed round | plain text refusals, section 6 |
| rate limit pause | `rateLimitPauseMs` 600,000 | the documented 10 minute ban after a 403, the same as Bybit |
| deny list input | Bybit's basket call for these four symbols | the index is Bybit's, section 4 |

If the relayed markets were ever wanted without Bybit, the bulk linear call would serve all 693 others in one reply, exactly as the Bybit poller does.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Zoomex API documentation, Get Instruments Info | https://zoomexglobal.github.io/docs/v3/market/instrument | 2026-09-23 | Zoomex | instruments call, `limit`, `status`, section 2 |
| S2 | Zoomex API documentation, Enums | https://zoomexglobal.github.io/docs/v3/enum | 2026-09-23 | Zoomex | status and contract type values, section 2 |
| S3 | Zoomex API documentation, Get Tickers and Change Log | https://zoomexglobal.github.io/docs/v3/market/tickers and https://zoomexglobal.github.io/docs/v3/changelog | 2026-09-23 | Zoomex | ticker fields, `fundingIntervalHour` and `fundingCap` added 2026-03-30, section 3 |
| S4 | FAQ 1000x Futures, updated 2026-04-30 | https://zoomex.zendesk.com/hc/en-us/articles/41845512770457-FAQ-1000x-Futures | 2026-09-23 | Zoomex | index every 500 ms, section 4 |
| S5 | Trading Account (Traditional Finance) Terms and Conditions, updated 2026-06-05 | https://zoomex.zendesk.com/hc/en-us/articles/58633669722905-Trading-Account-Traditional-Finance-Terms-and-Conditions | 2026-09-23 | Zoomex | TradFi index and Pyth limit, section 4 |
| S6 | What is Dual-Price mechanism?, updated 2026-09-18 | https://zoomex.zendesk.com/hc/en-us/articles/35622148000025-What-is-Dual-Price-mechanism | 2026-09-23 | Zoomex | mark formula, section 4 |
| S7 | What is funding rate?, updated 2025-12-05 | https://zoomex.zendesk.com/hc/en-us/articles/34755393448729-What-is-funding-rate | 2026-09-23 | Zoomex | funding formula, minute updates, section 4 |
| S8 | Zoomex API documentation, Get Orderbook, Get Funding Rate History, Get Zoomex Server Time | https://zoomexglobal.github.io/docs/v3/market/orderbook | 2026-09-23 | Zoomex | book limits and order, funding history parameters, time call, sections 4, 5, 7 |
| S9 | Zoomex API documentation, Rate Limit and Error | https://zoomexglobal.github.io/docs/v3/rate-limit and https://zoomexglobal.github.io/docs/v3/error | 2026-09-23 | Zoomex | 600 per 5 s, 403 and the 10 minute wait, error codes, section 6 |
| S10 | CCXT 4.5.68 `bybit.js` | `server/node_modules/ccxt/js/src/bybit.js` | 2026-09-23 | CCXT | `sign` at line 9883, `contractSize` at 2199, `active` at 2215, fees at 2219 and 2220, section 2 |
| S11 | Bybit public API, tickers, recent trades, funding history, index price components | https://api.bybit.com/v5/market/tickers | 2026-09-23 | Bybit | the same-instant compares, sections 2 to 4 |
| P1 | `rest-probe.mjs` modes `catalog`, `anchor`, `funding`, `book`, `errors`, `time`, `ccxt`, `mirror`, `own`, 03:15 to 03:31 UTC, and the second pass at 03:39 to 03:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zoomex/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 8 |
| P2 | `ws-probe.mjs tickers` at 03:27 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zoomex/ws-probe.mjs) | 2026-09-23 | this host | section 3, the own market's mark and rate |
