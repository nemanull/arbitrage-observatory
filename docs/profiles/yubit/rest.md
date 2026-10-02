# YUBIT REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 06:26 to 06:58 UTC), two runs of every probe mode, from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

YUBIT publishes no public REST documentation.
An Open API exists, and its documentation is sent to partners one by one: "Our customer support team will provide the latest API documentation to each partner individually.", R1.
Its host `openapi.yubit.com` answered 403 `Forbidden` to this host on every path tried except the web app's own `/mapi/` prefix, section 1.
This profile therefore records the calls the www.yubit.com web app makes for an anonymous visitor, found in its script bundles, R2 to R5.
They are undocumented, and YUBIT's futures trading rules forbid "Probing, scanning, or accessing undisclosed APIs", see [`fees.md`](./fees.md) section 1.
No CCXT class exists for YUBIT, so the engine has no catalog for it, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 UTC | edge | what it answered |
|---|---|---|---|
| `www.yubit.com` | `23.213.230.9`, `23.213.230.20` and two IPv6 addresses | Akamai, `akamai-cache-status` header | pages 200, `/mapi/...` public calls 200 |
| `yubit.com` | `184.26.91.14`, `23.202.34.233`, `43.174.224.103`, `43.174.225.102` | Tencent EdgeOne on the `43.174` addresses | `/` 307 to `/en-US/` in the first run, and a connect timeout in the second |
| `openapi.yubit.com` | `43.174.224.103`, `43.174.225.102` | Tencent EdgeOne, origin `server: elb` | `/` 307 to `/en-US/`, then 403 `Forbidden` (9 bytes, `text/plain`) on `/en-US/`, `/docs`, `/api`, `/v5/market/time` and `/trade/public/v1/market/fee-rate`. `/mapi/trade/public/v1/market/fee-rate` answered 200 with the same reply as on `www` |

These answers are from the Canadian VPN exit.
The web app's own region check, `POST /mapi/user/public/v1/ban-area/check` with an empty body, answered `{"banned":false,"threatLevel":"none","accessDecision":"allow","blocked":{"pages":[],"actions":[]}}`, and `GET /mapi/user/public/v1/country-code` answered `{"area_code":"1","country":"CA"}`, P2.
No call was refused for region.

| call | cold | warm |
|---|---|---|
| `GET /mapi/trade/public/v1/market/dynamic_symbol`, 698,614 bytes | 1,010 to 1,061 ms in three runs, including DNS and TLS, and 118 ms in a fourth run started seconds after another | 20 to 50 ms over five reads per run, median 26 to 31 ms |
| `GET /mapi/trade/public/v1/market/fee-rate`, 117 bytes | 228 to 507 ms, the first read of a run | 160 to 190 ms over the other reads, section 7 |

The catalog came back faster than the round trip of the small call because Akamai served it from its edge cache.
In the second to fourth runs the first read was `Miss from child, Miss from parent` and the next five were `Hit from child`, although the reply says `cache-control: no-cache`.

## 2. Catalog

### The instruments call

`GET https://www.yubit.com/mapi/trade/public/v1/market/dynamic_symbol`, no parameters, R2, P1.
The reply is `{"code":0,"message":"OK","data":{...},"ext_info":{},"time":<ms>}`, and `data` holds one array per family.

| `data` key | rows | settlement | status values |
|---|---:|---|---|
| `LinearPerpetual` | 514 | USDT | `contractStatus` `Trading` on 514, `symbolStatus` 0 on 514 |
| `InversePerpetual` | 2 | BTC and ETH, quoted in USD | `Trading` on 2 |
| `InverseFutures` | 0 | | |
| `FreeUPerpetual` | 2 | `FreeU`, the demo coin | `Trading` on 2 |

`SupportedCoins` maps BTC and ETH to `InversePerpetual`, and FreeU and USDT to `LinearPerpetual`.
Other status values are not documented, since no row carried one.
The active perpetual count is 514 USDT-M and 2 inverse, and the demo contracts do not count.
The same web app lists 278 USDT spot pairs in `GET /mapi/spot-openapi/public/v1/market/summary-new`, P1.

Each row carries, among 55 fields, `symbolName`, `symbolAlias`, `baseCurrency`, `quoteCurrency`, `contractType`, `tickSize`, `lotSize`, `minQty`, `maxNewOrderQty`, `contractStatus`, `indexSource`, `priceLimitPntE6`, `defaultTakerFeeRateE8` and `defaultMakerFeeRateE8`.

### Mapping to what the engine needs

No CCXT class exists, so there is no `market.id`, `contractSize`, `linear` or `active` from CCXT.
This is what the catalog offers in their place.

| engine field | catalog field | finding |
|---|---|---|
| `rawMarketId` | `symbolName` | `M1BTCUSDT`. It is the topic suffix on the socket, the `s` of every `tickers.all` row, and the `symbol` parameter of the funding and mark history calls, P1 and [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | `baseCurrency`, `quoteCurrency` | `symbolAlias` equals base plus quote on 514 of 514, and `symbolName` is `M1` plus the alias on 509 |
| `contractSize` | none | no multiplier field. `lotSize` is `"0.001"` on `BTCUSDT`, and book sizes are base coins, see [`websocket.md`](./websocket.md) section 4 |
| `linear` | the family key | `LinearPerpetual` |
| `active` | `contractStatus` | `Trading` |

The five rows whose `symbolName` is not `M1` plus the alias are `M1PUMPPUSDT` with alias `PUMPUSDT`, and `M1BIANRENSHENGUSDT`, `M1LONGXIAUSDT`, `M1NIULAIUSDT` and `M1HAJIMIUSDT`, whose aliases and bases are Chinese characters such as `币安人生`, P1.
A catalog adapter would need a base symbol mapping for those four.

### Pairs listed twice, price scale and odd rows

No base is listed twice within `LinearPerpetual`, P1.
BTC and ETH also appear as inverse and demo contracts, and the quote family would keep the USDT contract.
The catalog shows no per 1000 contracts other than those named in the base itself, such as `1000PEPEUSDT`.
`tickers.all` carried `M1STRKUSDT`, which is not in the catalog, with a mark of `0.1477` and an index of `0.0425` and `0.0426`, see [`websocket.md`](./websocket.md) section 4.
Every row has `priceLimitPntE6` `"50000"`, whose meaning is Not publicly specified.

## 3. Anchor

### The bulk calls

No REST call returns index, mark and funding for every contract.

| call | index | mark | funding rate | interval | next settlement | scope | time |
|---|---|---|---|---|---|---|---|
| socket `tickers.all`, see [`websocket.md`](./websocket.md) section 2 | `ip` | `mp` | absent | absent | absent | 519 rows in one frame about every second | pushed |
| socket `tickers-1000.<symbolName>` | `ip` | `mp` | `fr`, scaled by 1e6 | `nh`, hours | `ft`, ISO UTC string | one contract per topic | 31 and 32 frames in 30 s on `BTCUSDT`, 7 and 1 on `NVDAUSDT` |
| `GET /mapi/trade/public/v1/market/funding-rate-history?symbol=&from=&to=&timeStamp=` | | | settled `valueE8` | from the spacing of `time` | | one contract, history only | 163 to 242 ms |
| `GET /mapi/trade/public/v1/market/mark-price-list?symbol=&resolution=1&from=&to=` | | 1 minute mark candles | | | | one contract | 168 and 184 ms |

The REST calls are from the web app's contract data pages, R3 and R4.
`funding-rate-history` without a `symbol` answered HTTP 200 with `{"code":14120005,"message":"invalid symbol"}`.
The paths `tickers`, `ticker`, `instruments`, `orderbook` and `depth` under `/mapi/trade/public/v1/market/` answered 404, P3.
So the engine's REST `AnchorPoller` has no bulk call to read here.
A socket reader of `tickers.all` would carry index and mark for every contract in one frame, and funding would need one ticker topic per contract.

### Row mapping, if the socket were used

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `s` | string, `M1BTCUSDT` | none |
| `index` | `ip` | decimal string | `Number()` |
| `mark` | `mp` | decimal string, never 0 on 514 rows | `Number()` |
| `fundingRate` | `fr` on `tickers-1000.<symbol>` | integer scaled by 1e6: `-100` is -0.01 % | divide by 1,000,000 |
| `fundingIntervalHours` | `nh` on `tickers-1000.<symbol>` | integer hours, 8 or 4 | none |
| `nextFundingAt` | `ft` on `tickers-1000.<symbol>` | ISO string, `2026-09-23T08:00:00Z` | `Date.parse` |

The field names come from the web app's `TICKER_FIELD_TO_SHORTHAND` table, which spells `fr` as `funding_rate_e6`, `pf` as `predicted_funding_rate_e6`, `nh` as `funding_interval_hour` and `ft` as `next_funding_time`, R2.

## 4. Anchor semantics

### Index

The help center says "YUBIT aggregates price data for the same trading pair from several major exchanges (such as Binance, OKX, Bybit, etc.)" and combines them "using a weighted average formula", R6.
The catalog names each contract's sources in `indexSource`, without weights, P1.

| sources per contract | contracts | sources |
|---:|---:|---|
| 1 | 432 | `BinanceFuture` |
| 1 | 63 | `BitgetFuture`, which covers the stock, ETF and commodity perpetuals such as `NVDAUSDT` and `QQQUSDT` |
| 2 | 1 | `AAVEUSDT`: `Binance`, `OkEx` |
| 4 | 8 | for example `ETHUSDT`: `Binance`, `GateIO`, `KuCoin`, `OkEx` |
| 5 | 10 | for example `BTCUSDT`: `Binance`, `GateIO`, `KuCoin`, `Mexc`, `OkEx` |

So 495 of 514 indexes have one source, and the source names say it is another venue's futures market.
That reading of `BinanceFuture` and `BitgetFuture` is an inference from the names, since the meaning is Not publicly specified.
If it holds, the premium of a YUBIT mark over its index is YUBIT's basis against Binance or Bitget perpetuals, not against spot.
That is the shape [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) warns about, a basket that is a perpetual.
`ONEUSDT` itself has the single source `BinanceFuture`.
No `indexSource` names YUBIT.

### Mark

"YUBIT calculates the mark price based on a weighted average of prices from multiple sources.", R7.
No mark formula and no clamp are published.
In the fifth `tickers.all` frame of the second run of P4, the mark equalled the last price on 335 of 514 USDT-M contracts.
The distance between mark and index had a median of 862 ppm, a 90th percentile of 2,913 ppm and a maximum of 7,812 ppm, and no mark or index was 0.

### Funding

The formula is `Clamp( MA( (Bid1 + Ask1)/2 – Spot Index Price ) / Spot Index Price – Interest, a, b )` with interest 0, and `a` and `b` are not published, see [`fees.md`](./fees.md) section 6.
The formula names a "Spot Index Price", while most index baskets name a futures source.
On the per contract ticker, `fr` and the predicted rate `pf` were equal on every sample, P4.
`BTCUSDT` read `fr` `-281` at 06:40 UTC on `tickers-100`, `-100` at 06:46 UTC on `tickers-1000`, and `-280` at 06:53 and 06:54 UTC on both, so the published rate moves between reads.
`ONDOUSDT` and `NVDAUSDT` read `100`.
Whether `fr` is the rate for the upcoming settlement or the last settled one is Not verified, because no settlement was crossed.
The settled history for `BTCUSDT` was -0.01 % on 9 of 9 settlements, see [`fees.md`](./fees.md) section 6.

### How often each number changed

Over about 30 `tickers.all` frames in about 30 s, in the two runs of P4 that counted per contract:

| number | contracts that changed | median changes per contract | `BTCUSDT` | `ETHUSDT` | `SOLUSDT` |
|---|---:|---:|---:|---:|---:|
| mark `mp` | 433 and 388 of 514 | 5 and 4 | 14 and 14 | 12 and 13 | 12 and 11 |
| index `ip` | 354 and 334 of 514 | 3 and 2 | 5 and 6 | 5 and 6 | 6 and 5 |

The index of the most liquid contracts moved about once every 5 to 6 s, and the mark about once every 2 to 3 s.
The engine refuses a reading older than 10 s, see [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 5, so the cadence is inside that bound for liquid contracts and is Not verified for quiet ones.

## 5. REST book snapshot

None.
The futures web app reads its book only from the socket, R2, and the guessed paths answered 404, P3.
A feed that needs a REST snapshot to align deltas has none here, and the socket's own snapshot is used instead, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No limit is published, and a `fee-rate` reply carried no header whose name mentions a limit, retry, quota or remaining count, P5.
No 429 or 403 came from the `/mapi/` calls during the probes, which made at most about three requests per second.

| case | HTTP | body |
|---|---|---|
| unknown path under `/mapi/trade/public/v1/market/` | 404 | empty |
| `funding-rate-history` without a symbol | 200 | `{"code":14120005,"message":"invalid symbol","data":{"list":[]},...}` |
| every other path tried on `openapi.yubit.com`, after `/` redirects to `/en-US/` | 403 | `Forbidden` |

Errors travel in `code` inside an HTTP 200, so a reader has to check `code === 0`.

## 7. Server time and clock offset

A `/mapi/` reply carries `time` in Unix ms in its body and a `timenow` header, P5.
Over three runs of ten `fee-rate` reads, the offset of `time` against the midpoint of the local request was 1 to 9 ms on every read but the first of each run, with medians of 5, 4 and 6 ms, P5.
The first read of each run took 228 to 507 ms and read an offset of 28 to 171 ms, which is connection setup skewing the midpoint.
The other reads took 160 to 190 ms.

## 8. Recommended poller shape

No poller is recommended.
The engine's anchor is a REST bulk poll, and YUBIT has no REST bulk anchor call, section 3.
Its only bulk source of index and mark is the undocumented socket topic `tickers.all`, and funding needs one topic per contract.
The API that would carry this officially is closed to the public, and the rules forbid undisclosed APIs, see [`fees.md`](./fees.md) section 1.
If YUBIT granted written access, the shape would be a socket reader of `tickers.all` for `index` and `mark`, keyed by `s`, plus `tickers-1000.<symbolName>` for the funding fields, with the index read as a Binance or Bitget perpetual price and not as spot.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| R1 | Open API Signature Upgrade Notice | https://yubit.gitbook.io/yubit/other-help/announcements/feature-upgrade/openaiskill | 2026-09-22 | SafeTrading Ltd, global | Open API docs sent to partners individually, intro |
| R2 | YUBIT futures web app bundle | `https://www.yubit.com/trade/usdt/static/App-DkDO54Ej.js` and `index-BzPeGZpF.js` | 2026-09-22 | SafeTrading Ltd | catalog path, ticker key map, no REST book, sections 2 to 5 |
| R3 | contract data page bundle, funding history | `https://www.yubit.com/_next/static/chunks/app/%5Blocale%5D/trading-data/fundfee/page-aae6ca7608a7afcb.js` | 2026-09-22 | SafeTrading Ltd | `funding-rate-history` and `mark-price-list` paths and parameters, section 3 |
| R4 | contract data page bundle, mark price | `https://www.yubit.com/_next/static/chunks/app/%5Blocale%5D/trading-data/price/page-0688d08227b4c630.js` | 2026-09-22 | SafeTrading Ltd | same paths, section 3 |
| R5 | home page shared chunk | `https://www.yubit.com/_next/static/chunks/4319-df75e2067006ccbe.js` | 2026-09-22 | SafeTrading Ltd | `dynamic_symbol` and the socket paths, section 2 |
| R6 | What Is Index Price? | https://yubit.gitbook.io/yubit/derivatives-trading/futures-faq/what-is-index-price | 2026-09-22 | SafeTrading Ltd, global | index description, section 4 |
| R7 | Latest Price vs. Mark Price | https://yubit.gitbook.io/yubit/derivatives-trading/futures-faq/prices-and-references/latest-price-vs.-mark-price | 2026-09-22 | SafeTrading Ltd, global | mark description, section 4 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 4 and 6 |
| P2 | `rest-probe.mjs access` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 1 |
| P3 | `rest-probe.mjs anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3, 5 and 6 |
| P4 | `ws-probe.mjs tickers` and `book` | [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 4 |
| P5 | `rest-probe.mjs time` | [`rest-probe.mjs`](../../../scripts/probes/venues/yubit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 7 |
