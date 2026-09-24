# Bitazza REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:21 to 03:23 UTC for run 1 and 03:40 to 03:42 UTC for run 2, from the development host near Seattle.

This profile covers the public REST API of the AlphaPoint gateway that serves Bitazza's spot market, the only public API Bitazza has, see [`fees.md`](./fees.md) section 3.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitazza/rest-probe.mjs), run 1 and run 2, the rerun of every mode.
The documentation is the Bitazza API Reference, version 3.3, whose `_index.html` carried `last-modified` 2026-09-18, S1.
Its root URL `https://api-doc.bitazza.com/` serves only `<h5>We are hiring..</h5>`, and has since October 2023 according to the web archive, S2.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| base URL, Global | `https://apexapi.bitazza.com:8443/AP/`, S1 | |
| DNS, Global | CNAME `api.newbitazza.alphaprod.net`, nine A records `139.99.94.9` to `139.99.94.21`, reverse name `ip9.ip-139-99-94.net` | `dig`, and `rest-probe.mjs latency` in both runs |
| edge, Global | no CDN. Replies carry only `date`, `content-type` and, on `Ping`, `access-control-allow-origin: *`, with no `server` header | both runs |
| base URL, Thailand | `https://apexapi.bitazza.co.th:8443/AP/`, behind Cloudflare at `104.18.8.83` and `104.18.9.83` | `dig`, curl at 03:25 UTC |
| same engine | `GetInstruments?OMSId=1` returned 307 rows on both hosts with identical symbols, 403,104 bytes each | curl at 03:25 UTC |
| `GET /AP/Ping`, cold, a new TLS connection each | min 631.1 and 637.7, median 895.2 and 707.3, p90 1,671.5 and 1,892, max 1,685.1 and 2,260.1 ms, 20 calls per run | run 1 and run 2 |
| `GET /AP/Ping`, warm | min 224.5 and 218.3, median 225.4 and 220.9, p90 633.2 and 1,006.9, max 935.4 and 1,074.9 ms, 20 calls per run | run 1 and run 2 |
| reply | `{"msg":"PONG"}` | both runs |

The warm floor of about 220 ms is one round trip to the gateway.
The address block is OVH, and the gateway's region is Not publicly specified.

## 2. Catalog

### The instruments call

`GET /AP/GetInstruments?OMSId=1` returns every instrument, 403,104 bytes, 307 rows in both runs, in 1.74 s and 1.31 s.
Every count in the table below was the same in run 2.
`OMSId` is required, and `OMSId` 0 and 2 answer `Invalid OMSId`, so the whole venue is one order management system.

| field | values in run 1 |
|---|---|
| `InstrumentType` | `Standard` on 307 of 307 |
| `SessionStatus` | `Running` 273, `Stopped` 34 |
| `Product2Symbol`, the quote | THB 140, USDT 133, BTC 16, USDF 16, USD 2 |
| running by quote | THB 125, USDT 117, USDF 15, BTC 14, USD 2 |
| `IsDisable` | false on 307 |
| `Symbol` equal to `VenueSymbol` | 307 of 307 |
| `Symbol` equal to base plus quote | 294 of 307 |
| `PriceCollarEnabled` | true 284, false 23 |

The thirteen exceptions are ten THB pairs listed a second time with a `Q` prefix, `QBTCTHB`, `QETHTHB`, `QXRPTHB`, `QXLMTHB`, `QUSDTTHB`, `QUSDCTHB`, `QSHIBTHB`, `QDOGETHB`, `QSLPTHB` and `QSANDTHB`, and three renamed products, `DAIBTC` now USDS/BTC, `FTMUSDF` now S/USDF and `BTZUSDF` now FDM/USDF.
So ten pairs are listed twice, all THB: BTC, ETH, XLM, XRP, USDT, USDC, DOGE, SHIB, SLP and SAND.
What the `Q` books are for is Not publicly specified.

`GET /AP/GetProducts?OMSId=1` returns 157 products, 154 `CryptoCurrency` and 3 `NationalCurrency`, all with `MarginEnabled` false.

`GET /AP/summary` returns one row per instrument keyed `trading_pairs`, spelled `BTC_USDT`, with last price, best bid and ask and 24 h volumes, 84,650 bytes in 218.5 and 222.5 ms.
In both runs, 111 of 133 USDT pairs and 110 of 140 THB pairs had a 24 h volume above zero, and every BTC, USDF and USD pair had none.
The busiest USDT pairs were BTC_USDT at 597,142 USDT, PEPE_USDT at 359,538 and XRP_USDT at 348,873 in run 1, and BTC_USDT at 596,613, XRP_USDT at 356,406 and PEPE_USDT at 340,191 in run 2.

### How a CCXT catalog would map it

CCXT 4.5.68 has no Bitazza class, see [`fees.md`](./fees.md) section 8.
The unmerged pull request builds one as a subclass of `ndax`, so `ndax` pointed at the Bitazza gateway shows what that catalog would look like.

| item | value with `ndax` on the Bitazza gateway | against the socket |
|---|---|---|
| markets | 297 spot, 263 active, from 307 rows, because the ten pairs listed twice share one unified symbol | |
| `market.id` | the numeric `InstrumentId` as a string, `"7"` for BTC/USDT | the socket reports the same number in field 7 of every level, `ProductPairCode` |
| `type`, `linear`, `contractSize` | `spot`, and no `linear` or `contractSize` | sizes are base currency units, see [`websocket.md`](./websocket.md) section 4 |
| `active` | from `SessionStatus` | |
| taker and maker | 0.0025 and 0.002, the `ndax` constants | not Bitazza's schedule |

The engine filters CCXT markets to active swaps, so this catalog contributes nothing to it.

## 3. Anchor

Bitazza publishes no index, mark or funding for any public market.
No call in S1 returns one, and no field of the instruments, Level 1 or summary replies is an index price.
`GetInstruments` carries `PriceCollarPercent`, 3 on BTCUSDT, and `PriceCollarIndexDifference`, 5 on BTCUSDT, but S1 describes the price collar fields in terms of option collar strategies, and their meaning on this spot engine is Not publicly specified.

The bulk calls that do exist are Level 1 calls.

| call | fields | reply | time |
|---|---|---|---|
| `GET /AP/GetLevel1Summary?OMSId=1` | an array of JSON strings, one per instrument, each with `BestBid`, `BestOffer`, `LastTradedPx`, `TimeStamp` and session and 24 h statistics | 240,706 and 240,573 bytes, 334 rows, 27 more than the catalog | 30 polls per run: min 221.7 and 225, median 435 and 440.5, p90 514.4 and 692.2, max 2,527.5 and 1,317 ms |
| `GET /AP/summary` | best bid, best ask, last, 24 h volumes | 84,650 bytes, 307 rows | 218.5 and 222.5 ms, one call per run |

Over 30 one second polls, the median `GetLevel1Summary` poll changed the bid, ask or last of 36 rows in run 1, min 18, max 87, and of 55 rows in run 2, min 3, max 146.
The `TimeStamp` of BTCUSDT read `1790133600092` against a `LastTradeTime` of `1790133600098` on one call, and `1790133900099` against `1790133900105` on the socket five minutes later, so it follows the last trade and not the quote.

## 4. Anchor semantics

None exist, since there is no index, mark or funding.
The spot books themselves are the only price source, and nothing public references an external index.

## 5. REST book snapshot

`GET /AP/GetL2Snapshot?OMSId=1&InstrumentId=<id>&Depth=<n>` returns the book as an array of ten field arrays, the same shape as the socket, see [`websocket.md`](./websocket.md) section 4.
All three parameters are required.
Without `Depth`, or with `Symbol` instead of `InstrumentId`, it answers `"OMSId, InstrumentId and Depth are Required"`, although the socket accepts `Symbol`.

| `Depth` on BTCUSDT | run 1 entries, bids and asks | run 2 entries, bids and asks | reply |
|---:|---|---|---|
| 1 | 2, 1 and 1 | 2, 1 and 1 | 123 bytes, 1,957.8 ms as the first call of run 1, 218 ms in run 2 |
| 20 | 40, 20 and 20 | 40, 20 and 20 | 2,441 bytes, 225.8 and 222 ms |
| 100 | 139, 68 and 71 | 80, 38 and 42 | 8,562 and 4,964 bytes, 226.4 and 217.7 ms |
| 500 | 139, 67 and 72 | 80, 38 and 42 | 8,563 and 4,964 bytes |
| 5000 | 139, 67 and 72 | 80, 38 and 42 | 8,563 and 4,964 bytes |

The whole BTCUSDT book held 139 levels at 03:22 UTC and 80 at 03:41 UTC, so any `Depth` from about 100 up returns all of it.
Two minutes after the run 2 read, a socket snapshot at `Depth` 500 carried 140 entries again, see [`websocket.md`](./websocket.md) section 4.
Bids come first, best first and descending, then asks, best first and ascending, on every read.
Every entry of one snapshot carries the same `MDUpdateId`.

### Caching and replicas

No cache header is sent.
Ten reads of BTCUSDT, the first two 100 ms apart and the rest 200 ms apart, returned the ids `90459696, 90459780, 90459856, 90459826, 90459806, 90459806, 90459828, 90459866, 90459950, 90459984`.
The id went backwards twice and repeated once.
In run 2 the ids were `90576682, 90576796, 90576682, 90576802, 90576842, 90576958, 90576890, 90577004, 90576956, 90576962`, three steps backwards, one of them to an id already returned.
So consecutive reads can come from gateway replicas at different states, and a later read may be older than an earlier one.
In the socket probe, a REST snapshot read at the end of the `book` mode was behind the socket by 12 to 80 ids on four books in run 1, and between 28 ids behind and 16 ids ahead in run 2, see [`websocket.md`](./websocket.md) section 4.

### Level 1 of one instrument

`GET /AP/GetLevel1?OMSId=1&InstrumentId=7` answered in 226.2 and 217.8 ms with the BTCUSDT touch, `BidQty`, `AskQty`, and `BidOrderCt` and `AskOrderCt` both 0.

## 6. Rate limits and errors

No public limit is published.
The Market Maker section of S1 says operators arrange "appropriate ip-address rate limits" with their account manager.
Twenty sequential `GetLevel1` calls in 4.89 s and in 4.83 s all answered 200.
No 429, no `Retry-After` and no rate limit header was seen.

| request | status | body |
|---|---|---|
| unknown path `NoSuchFunction` | 404 | `NOT FOUND` |
| `GetInstruments` without `OMSId` | 200 | `{"result":false,"errormsg":"Invalid Request","errorcode":100,"detail":"OMSId is Required"}` |
| `GetL2Snapshot` without `OMSId` | 200 | the same shape, `"detail":"OMSId, InstrumentId and Depth are Required"` |
| `GetL2Snapshot` for `InstrumentId` 999999 | 200 | `[]` |
| `GetLevel1` for `InstrumentId` 999999 | 200 | a full Level 1 row of zeros |
| `GetOMSs` | 200 | `"detail":"OperatorId is Required"` |
| `GetUserInfo` | 404 | `NOT FOUND` |

A failure is a 200 with `result` false and a numeric `errorcode`, or a bare 404, and an unknown instrument is not an error at all.

## 7. Server time and clock offset

No server time call exists, and `GetServerTime` answered 404 to a hand curl at about 03:19 UTC.
The `date` header bounds the offset to a window.
Over 20 warm calls, the server clock minus the local clock lay between minus 169 and plus 215 ms in run 1, and between minus 216 and plus 131 ms in run 2.
The newest `ActionDateTime` of a BTCUSDT snapshot trailed the local arrival time by 112 to 128 ms over 10 reads in run 1 and by 111 to 129 ms in run 2, median 114 both times.
That is about half the 220 ms round trip, so the offset is small against the one way path.

## 8. Recommended poller shape

None.
Bitazza has no index, mark or funding to poll, so no `AnchorRow` can be built and no anchor poller is recommended.
If a later design wants a spot cross check, `GET /AP/GetLevel1Summary?OMSId=1` gives every touch in one call of about 240 KB, at a median of 435 and 440.5 ms, keyed by `InstrumentId`.
It is not an anchor, and its replies can come from replicas at different states, section 5.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitazza API Reference, version 3.3, `last-modified` 2026-09-18 | https://api-doc.bitazza.com/_index.html | 2026-09-23 03:25 UTC | both gateways | REST base URL, call names and parameters, Level 1 and Level 2 shapes, Market Maker rate limit note, sections 1 to 7 |
| S2 | Web archive index of `api-doc.bitazza.com` | https://web.archive.org/cdx/search/cdx?url=api-doc.bitazza.com/ | 2026-09-23 03:10 UTC | | root page replaced since 2023-10-07, preamble |
| S3 | CCXT 4.5.68 `ndax.js` | `server/node_modules/ccxt/js/src/ndax.js` | 2026-09-22 | CCXT | `ndax` fee constants at lines 363 and 364, section 2 |
| P1 | `rest-probe.mjs latency`, `catalog`, `book`, `poll`, `errors`, `web`, run 1 at 03:21 to 03:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitazza/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs`, every mode, run 2 at 03:40 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitazza/rest-probe.mjs) | 2026-09-23 UTC | this host | second readings |
| P3 | `dig` and curl against both gateways | | 2026-09-23 03:12 to 03:25 UTC | this host | DNS and the Thailand gateway, section 1 |
