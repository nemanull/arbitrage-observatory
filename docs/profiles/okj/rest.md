# OKJ REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:11 to 03:35 UTC), from the development host near Seattle.

OKJ lists no perpetual, so this profile covers the public spot REST API, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, see [`fees.md`](./fees.md) section 3.
The V5 API, released on 2026-09-16 per S3, serves the OKX V5 paths on `https://api.okj.com`, and every row below is about it unless it says V3.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/okj/rest-probe.mjs) or carries a source id from section 9.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST host | `api.okj.com`, S1 |
| resolved addresses | `52.195.53.179`, `18.176.241.6`, `35.79.91.169`. The first reverses to `ec2-52-195-53-179.ap-northeast-1.compute.amazonaws.com`, AWS Tokyo |
| socket host | `ws.okj.com` at `43.206.42.59`, `13.192.111.90`, `13.115.193.33`, also AWS Tokyo |
| front | no CDN header: no `server`, `via`, `x-cache` or `cf-ray` on the reply |
| cold request | `GET /api/v5/public/time` in 590 ms, and 517 ms in the rerun, HTTP 200 |
| warm `public/time` | 10 requests: min 142, median 145, p90 498, max 498 ms. Rerun: min 119, median 122, max 497 ms |
| warm `market/tickers?instType=SPOT` | 10 requests: min 143, median 146, p90 157, max 157 ms, 14.6 KB. Rerun: min 123, median 125, max 138 ms |
| warm `public/instruments?instType=SPOT` | 10 requests: min 143, median 146, p90 147, max 147 ms, 24.5 KB. Rerun: min 120, median 124, max 127 ms |
| access | every public call answered this host with HTTP 200 or a JSON error, and nothing was refused for region |

The legacy V3 REST API also answers: `https://www.okj.com/api/spot/v3/instruments` and `https://www.okcoin.jp/api/spot/v3/instruments` returned the same 47 pairs with HTTP 200, S2.
The help center HTML at `support.okcoin.jp` is the only OKJ surface that refused this host, with a Cloudflare challenge and HTTP 403, see [`fees.md`](./fees.md).

## 2. Catalog

### The instruments call

`GET /api/v5/public/instruments?instType=SPOT`, 20 requests per 2 s per IP and instrument type, S1.

| `instType` | reply on 2026-09-23 |
|---|---|
| `SPOT` | 47 rows, all `state` `live`, all `quoteCcy` `JPY`, all `ruleType` `normal` |
| `MARGIN`, `SWAP`, `FUTURES` | HTTP 200 `{"code":"0","data":[],"msg":""}` |
| `OPTION` | HTTP 400 code `50015` "Either uly or instFamily is required", and with `uly=BTC-JPY` code `51014` "Index doesn't exist" |

Documented states are `live`, `suspend`, `preopen` and `test`, S1.
The contract fields `ctVal`, `ctMult`, `ctType` and `settleCcy` are present and empty on every row.
Tick sizes range from `1` JPY on seven pairs including `BTC-JPY` to `0.00000001` JPY on two.

The pairs are `BTC`, `ETH`, `ADA`, `APE`, `APT`, `ARB`, `ASTR`, `AVAX`, `BAT`, `BCH`, `BERA`, `BNB`, `CC`, `DEP`, `DOGE`, `DOT`, `ENJ`, `ETC`, `FIL`, `GMT`, `GRAM`, `HBAR`, `IOST`, `IOTX`, `KAIA`, `LINK`, `LSK`, `LTC`, `MASK`, `MEME`, `NEO`, `OKB`, `OP`, `PEPE`, `POL`, `QTUM`, `SAND`, `SEI`, `SHIB`, `SKY`, `SOL`, `SUI`, `TRUMP`, `TRX`, `XLM`, `XRP` and `XTZ`, each against JPY.

### Volume

`GET /api/v5/market/tickers?instType=SPOT` summed to 208,039,775 JPY of `volCcy24h`, and 209,401,420 JPY in the rerun, and `market/platform-24-volume` read 208,621,784 JPY both times.
In the first run `XRP-JPY` carried 83.7 million JPY, `ETH-JPY` 35.0 million, `BTC-JPY` 26.7 million, `SUI-JPY` 11.2 million and `SOL-JPY` 10.6 million.
Five pairs, `OKB`, `SKY`, `KAIA`, `QTUM` and `NEO`, traded nothing in 24 h.
Every pair had a bid and an ask.

### How CCXT 4.5.68 maps it

No class exists, see [`fees.md`](./fees.md) section 8.
The `okx` class with `hostname` `api.okj.com` and `fetchMarkets` types `['spot']` loads the 47 pairs, S4.

| field | value for `BTC-JPY` | against the socket |
|---|---|---|
| `market.id` | `BTC-JPY` | equal to `arg.instId` on the socket |
| `symbol` | `BTC/JPY` | |
| `type` | `spot`, `active` true | the engine keeps only `swap` markets, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 202 |
| `precision` | amount `1e-8`, price `1` | equal to `lotSz` and `tickSz` of the instruments row |
| `contractSize` | undefined | the socket sizes are base currency, so a multiplier of 1 would be right |
| `taker` | 0.0015 | OKX's spot default, not OKJ's 0.0014 |
| pair listed twice | none, one `instId` per pair | |

The engine's quote family merges only USD and USDC into USDT, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a JPY pair would form its own cluster and meet no other venue.

## 3. Anchor

OKJ publishes no index, no mark price and no funding rate for any pair.

| call | reply on 2026-09-23 |
|---|---|
| `public/mark-price?instType=SPOT` or `SWAP` | HTTP 404 `{"code":404,"data":{},"detailMsg":"","error_code":"404","error_message":"Not Found","msg":"Not Found"}` |
| `public/funding-rate`, `public/funding-rate-history` | HTTP 404, same body |
| `public/price-limit`, `public/estimated-price`, `public/open-interest` | HTTP 404, same body |
| `market/index-tickers?quoteCcy=JPY` | HTTP 200 `{"code":"0","msg":"","data":[]}` |
| `market/index-tickers?instId=BTC-JPY` | HTTP 200 `{"code":"52000","msg":"No market data available","data":[]}` |
| `market/index-components?index=BTC-JPY` | HTTP 500 `{"code":"50026","msg":"System error.","data":[]}` |

Two reference prices exist, and neither is an anchor.

- The OKJ BTC Index at `https://www.okj.com/btc-index` publishes one bid, ask and average price per day for buying and selling 1 BTC on the exchange, S5.
  Its data call `https://www.okj.com/v2/support/home/price-index/btc_jpy/getData` returned daily entries, the newest `{"askPrice":13481062,"avgPrice":13432296,"bidPrice":13383531,"calculateTime":1790060400000,"calculateTimeStr":"2026-09-22", …}`, stamped 2026-09-22 07:00 UTC, which is 16:00 JST.
- The circuit breaker compares each trade with a reference price, "10分前の市場価格（複数社の価格を基に算出）", the market price 10 minutes earlier computed from the prices of several companies, S6.
  That reference price is not published on the API.

No row of `AnchorRow` can be filled, and the engine would read OKJ as markless.

## 4. Anchor semantics

Not applicable, because section 3 found no index, mark or funding.
The daily BTC index is a once-a-day average on the venue's own book, S5, so it would not pass the anchor reader's 10 s age rule even for BTC.

## 5. REST book snapshot

| call | depth | probed on 2026-09-23 |
|---|---|---|
| `GET /api/v5/market/books?instId=BTC-JPY&sz=400` | `sz` up to 400 per side, default 1, 40 requests per 2 s per IP, S1 | 148 bids and 68 asks, 147 ms, 6,980 bytes, `ts` 87 ms old. Rerun: 148 and 70, 123 ms, `ts` 72 ms old |
| `GET /api/v5/market/books-full?instId=BTC-JPY&sz=5000` | `sz` up to 5,000, "updated once a second", 10 requests per 2 s per IP, S1 | the same level counts as `books` in both runs, `ts` 538 and 594 ms old |
| `market/books` on `XRP-JPY` and `IOST-JPY` | | 57 bids and 42 asks, and 25 bids and 34 asks. Rerun: 58 and 43, and 26 and 31 |

Levels are `[price, size, "0", orders]` strings on `books`, and `[price, size, orders]` on `books-full`.
Bids are descending and asks ascending on every reply.
Ten reads of `books` 200 ms apart returned 10 distinct `ts` values in both runs, so it is not cached between reads.
Ten reads of `books-full` returned 4 distinct `ts` values in both runs, which fits its once-a-second refresh.
`sz=401` answers HTTP 200 with code `51000` "Parameter sz error.".
The whole book of the deepest pair fits inside 400 levels, so `books` with `sz=400` is the complete book.

## 6. Rate limits and errors

| item | value |
|---|---|
| documented public limits | tickers and ticker 20 per 2 s, books 40 per 2 s, books-full 10 per 2 s, instruments 20 per 2 s per instrument type, time 10 per 2 s, platform volume 2 per 2 s, all per IP, S1 |
| limit reply | code `50011` with HTTP 200 "Rate limit reached…", or with HTTP 429 "Too Many Requests", and `50013` HTTP 429 "Systems are busy", S1 |
| headers seen | `ratelimit-limit: 300`, `ratelimit-remaining: 299`, `ratelimit-reset: 1`, `x-ratelimit-limit-second: 300`, `x-ratelimit-remaining-second: 299`, a gateway budget per second above the documented per-endpoint limits |
| `Retry-After` | Not verified, because the probe stayed inside every limit |
| unknown pair | HTTP 200 `{"code":"51001","msg":"Instrument ID does not exist."}` on `books`, and the same code with `"data":[]` on `ticker` |
| missing parameter | HTTP 400 `{"code":"50014","data":[],"msg":"instType cannot be empty"}` |
| unknown path | HTTP 404 `{"code":404,"data":{},"detailMsg":"","error_code":"404","error_message":"Not Found","msg":"Not Found"}` |

A JSON error can come with HTTP 200, so a client reads `code` and not only the status.

## 7. Server time and clock offset

`GET /api/v5/public/time` returns `{"code":"0","data":[{"ts":"1790133322254"}],"msg":""}`, 10 requests per 2 s, S1.
Over 10 samples the server read 1 to 6 ms ahead of the midpoint of each request, and 3 ms ahead at the fastest round trip of 141 ms.
In the rerun 17 minutes later it read 7 to 10 ms ahead, and 10 ms at the fastest round trip of 117 ms.

## 8. Recommended poller shape

None.
OKJ has no perpetual and no anchor, so there is nothing for an anchor poller to read.
If a spot leg were ever wanted, `market/tickers?instType=SPOT` returns best bid, best ask and 24 h volume for all 47 pairs in one 14.6 KB reply at a median of 146 ms, and 125 ms in the rerun, but the engine reads the book from the socket and not from a ticker.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | OKJ API guide, V5 | https://dev.okj.com/apidoc/v5/en/ | 2026-09-22 | OKJ | host, instruments, books, rate limits, error codes, time, sections 1 to 7 |
| S2 | OKJ API guide, V3 | https://dev.okj.com/apidoc/v3/en/ | 2026-09-22 | OKJ | the legacy API, section 1 |
| S3 | OKJ API V5 change log | https://dev.okj.com/apidoc/v5/log_en/ | 2026-09-22 | OKJ | "API v5 released." on 2026-09-16 |
| S4 | CCXT 4.5.68 `okx.js` | `server/node_modules/ccxt/js/src/okx.js`, `hostname` at line 176 and `fetchMarkets` types at line 1267 | 2026-09-22 | CCXT | the hostname swap, section 2 |
| S5 | OKJ BTC Index page | https://www.okj.com/btc-index | 2026-09-22 | OKCoin Japan K.K. | its meta description "OKJ BTC Indexとは、当社取引所にて1BTCを購入・売却するための価格情報を日々公表するものです。", section 3 |
| S6 | 取引ルール (trading rules) | https://www.okj.com/pages/products/trade-rules.html | 2026-09-22 | OKCoin Japan K.K. | circuit breaker reference price, section 3 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/okj/rest-probe.mjs) `all` at 03:16 UTC | | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/okj/rest-probe.mjs) `all`, rerun in the second pass at 03:33 UTC | | 2026-09-23 UTC | this host | sections 1 to 7, the second readings |
