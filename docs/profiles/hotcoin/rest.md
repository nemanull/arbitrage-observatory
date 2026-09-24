# Hotcoin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:17 to 03:46 UTC in two passes, from the development host near Seattle.

This profile covers the public perpetual REST API of Hotcoin that a catalog, an anchor poller and a book check would use, for every perpetual family.
CCXT 4.5.68 has no Hotcoin class, see [`fees.md`](./fees.md) section 8.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/hotcoin/rest-probe.mjs), run from `server/`, labelled P1 with its mode.
The documentation is the English swap section of the official API site, S1, whose latest changelog entry is dated 2025-04-09.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| documented base URL | `https://api-ct.hotcoin.fit` | S1 "REST Basics" |
| DNS | `api-ct.hotcoin.fit` is a CNAME for `api-ct.hotcoin.fit.wcdnga.com`, which resolved to `146.103.66.62` | `dig` on 2026-09-23 03:11 UTC, P1 `latency` |
| edge | every reply carries an `x-req-id` such as `6ab34511_PS-LAX-04Nnp24_26251-38328`, and an `acw_tc` cookie | P1 `latency`, `curl -D -` |
| cold request, new TCP and TLS, `GET /api/v1/perpetual/public/time` | min 308, median 503, max 568 ms over 5, and 516, 526 and 771 ms in the rerun | P1 `latency` |
| warm request, same call | min 224, median 226, max 314 ms over 10, and 219, 223 and 491 ms in the rerun | P1 `latency` |
| warm catalog call, 555 KB | 4,627, 2,341 and 1,913 ms in the latency run, 3,204, 2,167 and 1,863 ms in its rerun, and 669 to 5,817 ms over 80 polls in two anchor runs, section 3 | P1 `latency`, `anchor` |
| catalog timing split | time to first byte 0.38 to 0.72 s, and total 3.24 to 5.13 s over six `curl` reads, with and without `--compressed` | `curl -w` on 2026-09-23 03:18 UTC |
| compression | none. A request that offers gzip gets `Content-Length: 554908` and no `Content-Encoding` | `curl --compressed -D -` |
| access | every public call answered HTTP 200 with live data, and nothing refused this US host | P1, all modes |

The small calls return in about one round trip of 220 ms, so the edge relays each request to a distant origin.
The catalog's first byte comes after about half a second, and the rest of the body streams for another 1 to 5 s.
That slow body is the one number in this profile that works against a 1 s anchor poll, see section 3.

## 2. Catalog

### The instruments call

`GET /api/v1/perpetual/public` returns every listed perpetual in one reply, with no parameter, S1 "Available Futures List".
On 2026-09-23 at 03:37 and 03:43 UTC it returned 585 rows of about 554,775 bytes, `{"code":200,"msg":"success","data":[…]}`, the same 585 both times, P1 `catalog`.

| family | `base` (margin) | `quote` | `direction` | rows | asset categories |
|---|---|---|---|---:|---|
| USDT-M linear | `usdt` | `usdt` | 0 | 567 | 364 `crypto`, 197 `us_stock`, 3 `hk_stock`, 2 `forex`, 1 `bond` |
| USDC-M linear | `usdc` | `usdc` | 0 | 9 | `crypto` |
| coin-M inverse | the coin, such as `btc` | `usd` | 1 | 9 | `crypto` |

Every row had `env` 0, which S1 defines as "0:listing,1:testing".
The reply has no status field, and a delisted contract simply leaves it.
The undocumented `GET /api/v1/perpetual/public/products/tickers` returned 968 rows, about 115,580 bytes, in 607 and 608 ms: the 585 catalog contracts plus 383 more with zero 24 h volume, among them `funusdt`, `kernelusdt` and `babyusdt`, P1 `catalog`.
Those 383 are delisted contracts that the tickers call and the `fund_rates` channel still carry, so the catalog, not the tickers call, is the list of live contracts.

The `assetCategory` field is not reliable for TradFi.
`jpn225usdt`, `gbpusdusdt`, `hschkdusdt` and `gvzusdt` read `crypto` although their names are an equity index, a currency pair, a Hong Kong index and a volatility index, P1 `book`.
The `us_stock` rows include the pre-IPO contracts `anthropicusdt` and `openaiusdt`, P1 `catalog`.

The row fields are `amount24`, `assetCategory`, `base`, `baseDisplayName`, `code`, `codeDisplayName`, `direction`, `env`, `fluctuation`, `fund`, `guaranteedStopLossRate`, `guaranteedStopLossStatus`, `high`, `indexBase`, `indexBaseAppLogo`, `indexBaseDisplayName`, `indexBaseWebLogo`, `indexPrice`, `liquidationTime`, `low`, `markPrice`, `marketPriceDigit`, `maxLever`, `minQuoteDigit`, `minTradeDigit`, `minTradeUnit`, `price`, `quote`, `quoteDisplayName`, `size24`, `totalPosition`, `underlying` and `unitAmount`, P1 `catalog`.
The documented example lacks `assetCategory`, `liquidationTime`, `underlying` and the display names, S1.

### How a loader would map it

CCXT has no class, so this is the mapping a direct loader would need, set against what [`connector.ts`](../../../server/src/ccxt/connector.ts) takes from a CCXT market.

| engine field | Hotcoin field | evidence |
|---|---|---|
| `rawMarketId` | `code`, lowercase, such as `btcusdt` | 585 of 585 `code` values are lowercase and equal to `codeDisplayName` lowercased, P1 `catalog`. The socket echoes the lowercase code, and the `fund_rates` channel keys its rows by it, see [`websocket.md`](./websocket.md) section 3 |
| `base` | `underlying` uppercased, such as `BTC` or `1000PEPE` | `base` in this API is the margin asset, not the traded coin, S1 and P1 `catalog` |
| `quote` | `quote` uppercased | `usdt`, `usdc` or `usd` |
| `linear` | `direction === 0` | S1 "0:Linear Contract,1:Inverse Contract" |
| `contractSize` | `unitAmount` | see below |
| `active` | present in the reply | no status field exists |

### Size unit, pairs listed twice, and price scale

`unitAmount` is the size of one contract.
On a linear contract it is coins of the underlying, and on an inverse contract it is US dollars.
The probe recovered it from each row's own 24 h figures, `size24 / amount24 / price` on linear rows and `size24 × price / amount24` on inverse rows, and the result agreed with `unitAmount` within 25 % on 584 of 584 rows that traded more than 1,000 contracts, P1 `catalog`.
So `amount24` counts contracts, and `size24` is quote turnover on linear rows and coin turnover on inverse rows.
The values seen were 0.0001 (3 rows), 0.001 (21), 0.01 (115), 0.1 (122), 1 (100), 10 (131), 100 (75), 1,000 (16), 1,500 (1) and 10,000 (1), P1 `catalog`.
The book sizes on the socket and on REST are counts of these contracts, see [`websocket.md`](./websocket.md) section 4.

Nine pairs are listed in both USDT-M and USDC-M: AAVE, DOGE, ETH, HYPE, BTC, WLFI, XRP, BNB and SOL.
Thirteen underlyings appear in more than one family, since nine of them also have a coin-M inverse contract, P1 `catalog`.
The quote family ranks one of them, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).

Seven contracts carry a multiplier in the name, and their price is per that many coins: `10000nexusdt`, `1000luncusdt`, `1000000mogusdt`, `1000flokiusdt`, `1000pepeusdt`, `1000bonkusdt` and `1000shibusdt`, whose `underlying` keeps the prefix, P1 `catalog`.
Their base should keep the prefix, like `1000PEPE`, and pair with the same prefixed base elsewhere.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/perpetual/public` | `indexPrice` | `markPrice` | `fund`, the last settled rate | absent | `liquidationTime`, Unix ms | 554,745 to 554,795 bytes, 585 rows | 40 polls: min 675, median 880, p90 2,014, max 5,817 ms, 17 over 1 s and 5 over 2 s. Rerun: 669, 856, 1,581 and 4,087 ms, 12 over 1 s and 2 over 2 s |
| `GET /api/v1/perpetual/public/{code}/premiumIndex` | `indexPrice` | `markPrice` | `estimateFeeRate`, upcoming, and `lastFeeRate`, settled | absent | `liquidationTime`, Unix ms | 428 bytes, one contract | 40 polls on `btcusdt`: min 221, median 229, max 526 ms, and 228, 232 and 510 ms in the rerun |
| `GET /api/v1/perpetual/public/{code}/fee-rate` | | | settled history | from the spacing | | about 1.9 KB for 5 rows | 0.66 s |
| WebSocket `fund_rates` | row field 2 | row field 1 | field 3 settled and field 4 upcoming | absent | field 5, a countdown in ms | 131 KB, 968 rows, every 2.5 to 3.5 s | see [`websocket.md`](./websocket.md) section 2 |

All from P1 `anchor`, `funding` and `history`, 2026-09-23 03:19 to 03:21 UTC and rerun at 03:43 to 03:45 UTC.

One REST call carries index, mark and next settlement for every contract, but not the upcoming rate and not the interval.
The catalog `fund` equalled `lastFeeRate` from `premiumIndex` on 13 of 13 reads across 12 contracts in each of two runs, and it equalled the newest row of the funding history, so it is the rate that was last settled, P1 `funding` and `history`.
The rate for the upcoming settlement is only in `premiumIndex`, one contract per call, and in the `fund_rates` socket channel.
On `btcusdt` at 03:20 UTC the settled rate was −0.0001213795555556 and the upcoming estimate −0.00011118132712528001, and on `sophusdt` −0.00175189 against −0.00126008, P1 `funding`.
At 03:44 UTC the two estimates read −0.00011342294343242668 and −0.00121223 against the same settled rates.

No call publishes the funding interval.
The funding history spacing gives it: 8 h on 19 of 38 sampled contracts and 4 h on the other 19, P1 `history`.
On 2026-09-23 at 03:17 UTC, 321 contracts showed a next settlement of 08:00 UTC and 264 showed 04:00 UTC, P1 `catalog`.
A contract whose next settlement falls at 04:00, 12:00 or 20:00 UTC is on 4 h, since an 8 h contract settles only at 00:00, 08:00 and 16:00 UTC.
At 00:00, 08:00 and 16:00 UTC, which both groups share, a single read cannot tell the two apart.

### Row mapping

| `AnchorRow` column | field in `GET /api/v1/perpetual/public` | unit on the wire | conversion |
|---|---|---|---|
| key | `code` | string, `btcusdt` | none |
| `index` | `indexPrice` | decimal string | `Number()` |
| `mark` | `markPrice` | decimal string, never 0 on 585 rows | `Number()` |
| `fundingRate` | `fund` | decimal string, a fraction per interval: `"-0.0001213795555556"` is −0.0121 % | `Number()`, and it is the last settled rate, not the upcoming one |
| `fundingIntervalHours` | none | | from the funding history at boot, 4 or 8 |
| `nextFundingAt` | `liquidationTime` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

The rate is a fraction, not a percent.
The value 0.0001 recurs in the settled histories, which is the 0.01 % that the funding help page uses as its example rate, S3, and a percent reading would make it a 0.0001 % rate.

## 4. Anchor semantics

### Index

The help center calls the index "a composite reference price calculated using prices from multiple major spot trading platforms", S2.
No live basket call exists.
`GET /api/v1/perpetual/public/{code}/indexInfo` is documented as the basket, S1, but on 2026-09-23 it returned a basket stamped 2023-12-26 09:34 UTC for `btcusdt`, `ethusdt`, `solusdt`, `xrpusd` and `btcusdc`, with a BTC index of 42,712.6 against a live 86,630.4, and `"data":null` for `sophusdt`, `qcomusdt`, `klacusdt`, `clskusdt`, `10000nexusdt`, `achusdt`, `biousdt` and `flexusdt`, P1 `index`.
The stale baskets were `binance_contract` at weight 1 for BTC, ETH and XRP, and five sources at 0.2 each for SOL: `okex`, `binance`, `gateio`, `huobi` and `binance_contract`.
So in 2023 the BTC index was the Binance perpetual alone, and whether it still is cannot be read from this API.
A self-index screen in the sense of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) is therefore not possible for Hotcoin.

### Mark

The help center says the mark "is typically derived from the Index Price and funding rates", S2.
No formula and no clamp is published.
Across the catalog read at 03:37 UTC, the mark sat above the index by a median of 0 ppm, with p5 −1,221, p95 978, min −7,663 and max 67,567 ppm, and 190 of 585 rows had the mark exactly equal to the index, P1 `catalog`.
The rerun at 03:43 UTC read p5 −1,051, p95 984, min −5,780 and max 68,674 ppm, with 189 rows equal.
The largest both times was `bpusdt`, whose mark 0.91672 sat 6.8 % above its index 0.8587, and 0.91019 sat 6.9 % above 0.8517 in the rerun, near its last trade, P1 `catalog`.
So the mark premium is not capped at 1 % the way the Kraken mark is, and a leg can read far from its index.

### Funding

The funding formula, the clamp of 0.05 % on I − P, and the unpublished absolute limit are in [`fees.md`](./fees.md) section 6.
The published bulk rate is the last settled one, and the upcoming estimate is only per contract or on the socket, section 3.
The estimate on `btcusdt` changed once in 40 reads over about a minute, and not at all in the rerun, P1 `anchor`.

### Rate across a settlement

The settlement instant was not captured.
The history rows are stamped 4 to 213 s after the hour, median 44 s, over 380 rows, P1 `history`, so a poller should expect `fund` and `liquidationTime` to step up to a few minutes after the hour.

### How often each number changed

Over 39 pairs of consecutive catalog polls, taken back to back at a median 880 ms apart, with the rerun after the slash, P1 `anchor`:

| contract | mark changed | index changed | `fund` changed | `liquidationTime` changed |
|---|---:|---:|---:|---:|
| `btcusdt` | 27 / 26 | 28 / 25 | 0 / 0 | 0 / 0 |
| `ethusdt` | 27 / 30 | 28 / 31 | 0 / 0 | 0 / 0 |
| `btcusdc` | 15 / 28 | 14 / 28 | 0 / 0 | 0 / 0 |
| `xrpusd` | 9 / 19 | 9 / 19 | 0 / 0 | 0 / 0 |
| `sophusdt` | 8 / 12 | 8 / 12 | 0 / 0 | 0 / 0 |

Across all 585 rows the mark changed on 103 rows per poll on average in both runs, and the index on 98 and 101.
The `premiumIndex` `time` field was 109 to 1,485 ms old on arrival, median 377 ms, and 117 to 755 ms, median 267, in the rerun.
Its mark matched the catalog mark read just before on 16 and 18 of 40 polls, P1 `anchor`.
In the `funding` rerun the same field was 7.1 s old on `btcusd` and 19.2 s old on `swarmsusdt`, P1 `funding`.
So the mark republishes about once a second on a busy contract, and a quiet contract's mark can hold still for many seconds.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET /api/v1/perpetual/public/products/{code}/orderbook` | S1 |
| reply shape | `{"asks":[[price, size, cumulative size], …], "bids":[…]}` with no `code` wrapper, no timestamp and no update id | P1 `book` |
| depth | 100 levels per side on `btcusdt`, `sophusdt`, `xrpusd` and `jpn225usdt`. `?depth=5`, `?limit=100` and `?size=200` all still return 100 | P1 `book` |
| level order | bids descending, asks ascending, on 4 of 4 | P1 `book` |
| numbers | strings, and the third element is the running sum of the second on every level | P1 `book` |
| thin books | the eight contracts with the lowest 24 h turnover, 2,657 to 5,876 USDT, all held 100 bids and 100 asks, with spreads from 113 ppm (`hschkdusdt`) to 15,035 ppm (`gvzusdt`) | P1 `book` |
| caching | `Cache-Control: no-cache`. Two back-to-back reads were identical on 3 of 4 contracts, and on 2 of 4 in the rerun, and `btcusdt` changed both times | P1 `book` |
| sizes | contracts, the same as the socket, and the socket's top 40 sizes equalled REST on 38, 40 and 40 of 40, and on 40 of 40 on all three in the rerun | [`websocket.md`](./websocket.md) section 4 |
| unknown contract | HTTP 200 with an empty body | P1 `errors` |

## 6. Rate limits and errors

The documentation publishes no number.
It says "Each IP has an upper limit on access frequency", that exceeding it "returns HTTP 429", and that "Continued violations will result in an IP ban", S1 "IP Access Limits".
It also says "It is strongly recommended to use WebSocket subscriptions for real-time market data", S1.
The probes never exceeded about 2 requests a second, saw no 429, and saw no rate limit header and no `Retry-After`, P1 all modes.

| request | status | body |
|---|---|---|
| `nopeusdt/premiumIndex`, `indexInfo`, `fee-rate` or `candles` | 400 | `{"message":"合约不存在"}`, "contract does not exist" |
| `products/nopeusdt/orderbook` | 200 | empty |
| `nopeusdt/fills` | 200 | `{"code":20021,"data":null,"msg":"合约不存在"}` |
| `BTCUSDT/premiumIndex` or `products/BTCUSDT/orderbook`, uppercase | 200 | the `btcusdt` data, so the path is case insensitive |
| `btcusdt/candles?kline=7min` | 400 | `{"message":"没有K线类型"}`, "no such kline type" |
| `btcusdt/fee-rate?page=0&pageSize=100000` | 200 | the history, in 1,818 and 599 ms |
| `/api/v1/perpetual/nope` | 500 | `{"code":500,"data":null,"msg":"服务器内部错误"}`, "internal server error" |
| `/api/v1/perpetual/products/btcusdt/ticker` | 404 | `{"code":404,"data":null,"msg":"请求地址不存在"}`, "request path does not exist" |

All from P1 `errors` in two runs, except the last row, which is from `curl`, on 2026-09-23 UTC.
The documented error shape `{"code": 500, "msg": "Invalid symbol."}` was not seen, S1.
A poller has to treat a non-200 status, an empty body, and a 200 whose `code` is not 200 as errors.

## 7. Server time and clock offset

`GET /api/v1/perpetual/public/time` returns `{"epoch":"1790133526.571","iso":"2026-09-23T03:18:46.571Z","timestamp":1790133526571}`, P1 `clock`.
Against the midpoint of each request, the server clock read 2 to 3 ms ahead of this host on four warm samples with a 218 to 220 ms round trip, and 7 to 9 ms ahead with a 227 to 229 ms round trip in the rerun, P1 `clock`.
The first sample of each run, 148 and 74 ms ahead with a 521 and 373 ms round trip, is dropped as a cold connection.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api-ct.hotcoin.fit/api/v1/perpetual/public` | one call carries index, mark, settled rate and next settlement for all 585 contracts |
| interval | 2,000 ms, with one request in flight at a time | the reply took 669 to 5,817 ms, 7 of 80 over 2 s, so a 1 s cadence would queue. The reader refuses a reading older than 10 s, which a 2 s cadence still meets when a reply takes 5 s |
| row mapping | section 3, key `code` | |
| `fundingRate` | `fund`, flagged as the last settled rate | the upcoming rate needs 585 `premiumIndex` calls or the `fund_rates` socket channel |
| `fundingIntervalHours` | from `fee-rate` at boot, one call per tracked contract at 2 a second, and refreshed when `liquidationTime` steps | no call publishes it |
| alternative | the socket `fund_rates` channel, every 2.5 to 3.5 s, which carries the upcoming rate and the next settlement for every contract in one 131 KB frame | a push anchor is a change to the engine, which polls REST today, see [`websocket.md`](./websocket.md) section 8 |
| skip | `assetCategory` other than `crypto`, until TradFi hours are handled | TradFi contracts go reduce-only when their market is closed, [`fees.md`](./fees.md) section 7 |
| skip | codes not in the catalog | 383 delisted contracts linger in tickers and `fund_rates` |
| rate limit pause | `rateLimitPauseMs` 10,000 | no window is published and no `Retry-After` was seen |
| deny list input | none possible from the index, section 4 | the basket call is stale or empty |

The bulk reply is about 24 GB a day at one read every 2 s.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hotcoin Global API, Perpetual Futures: Introduction, Market API, Change Log | https://hotcoinex.github.io/en/swap/introduction.html and https://hotcoinex.github.io/en/swap/market.html and https://hotcoinex.github.io/en/swap/log.html | 2026-09-23 03:08 UTC | Hotcoin, global | base URL, calls, field meanings, rate limit wording, error shape, sections 1 to 6 |
| S2 | Common Price Types in Futures Trading | https://www.hotcoin.com/en_US/support/common-price-types/ | 2026-09-23 UTC | Hotcoin, global | index and mark descriptions, section 4 |
| S3 | Funding Rate | https://www.hotcoin.com/en_US/support/What-Is-the-Funding-Rate/ | 2026-09-23 UTC | Hotcoin, global | rate unit example, section 3 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/hotcoin/rest-probe.mjs) modes `latency`, `catalog`, `anchor`, `funding`, `history`, `index`, `book`, `errors` and `clock` | run from `server/` | 2026-09-23 03:17 to 03:37 UTC, and every mode rerun at 03:42 to 03:46 UTC | this host | sections 1 to 8 |
