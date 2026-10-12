# WOO X Pro REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 02:21 to 02:32 UTC on 2026-10-10 and again from 02:35 to 02:40 UTC in the second pass, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures REST API of WOO X Pro (no CCXT class) for every perpetual family: the catalog, the anchor, the book, limits and the clock.
Every number was measured by [`rest-probe.py`](../../../scripts/probes/venues/woo-x-pro/rest-probe.py), run with `uv run scripts/probes/venues/woo-x-pro/rest-probe.py <mode>`, unless a source is named.
The API is BitMart's futures v2 API on the host `cloud-api.wooxpro.com`, and its catalog matched the one [`../bitmart/rest.md`](../bitmart/rest.md) recorded for BitMart on 2026-09-22 row for row in its counts, see section 2.
Two things set it apart from that profile.
The documented REST book and trade calls are frozen on most contracts, see section 5.
No public REST call returns the mark in bulk, so the anchor needs the WebSocket ticker, see section 3.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://cloud-api.wooxpro.com`, S1 |
| resolved address | `104.18.16.209` and `104.18.17.209`, and `2606:4700::6812:10d1` and `2606:4700::6812:11d1`, Cloudflare |
| edge | Cloudflare edge `YVR` in the `cf-ray` header, then `via: 1.1 google` |
| small call | `GET /contract/public/details?symbol=BTCUSDT` in 194 to 336 ms over eight calls in two runs |
| whole catalog | `GET /contract/public/details`, 1,047,553 to 1,047,562 bytes, 267 to 571 ms over eight calls in two runs |
| access from the Canadian exit | every public call answered HTTP 200 with `code` 1000, and no 403, 429 or geoblock was seen |

The help center pages answered HTTP 403 with a Cloudflare challenge, and the help center API answered 200, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /contract/public/details` without `symbol` returns every contract, delisted ones included, in one reply, S2.

| count on 2026-10-10 02:22 UTC | value |
|---|---|
| rows | 1,215 |
| `product_type` | 1, perpetual, on every row |
| `Trading` | 359: USDT 354, USD (coin-M) 4, USDC 1 |
| `Delisted` | 856 |
| `Trading` with 24 h volume above 0 | 100: USDT 95, USD 4, USDC 1 |
| `Trading` rows with a `delist_time` in the past | 127 |
| `Trading` rows with `tradfi_info` | 158, all with `market_session_status` 2 at 02:22 UTC, and 3 of them with 24 h volume |
| `funding_interval_hours` on `Trading` rows | 8 on 216, 4 on 141, 1 on 2 |

These are the counts the BitMart profile recorded on 2026-09-22: 1,215 rows, 359 `Trading`, 354, 4 and 1 by quote, 100 with volume, 127 stale delist markers.

Fields: `symbol`, `product_type`, `base_currency`, `quote_currency`, `contract_size`, `index_price`, `index_name`, `last_price`, `funding_rate`, `expected_funding_rate`, `funding_time`, `funding_interval_hours`, `status`, `delist_time`, `tradfi_info`, volumes, open interest and order limits.
No row carries a mark price.

### Live contracts

The 24 h volumes look inflated.
`ASTEROIDETHUSDT` reported a 24 h turnover of 20,000,912,502 USDT while its WebSocket snapshot held 1 bid and no ask.
`BTCUSDT` reported 3,893,692,425 USDT, and the fills the WebSocket trade channel showed in the first run were 2 to 6 contracts of 0.001 BTC, see [`websocket.md`](./websocket.md) section 2.
So "24 h volume above 0" is the probe's filter for a live contract, not a measure of depth.

### Mapping without CCXT

No CCXT class exists, see [`fees.md`](./fees.md) section 8, so an adapter parses this call itself, as [`../../../server/src/venues/gate/markets.rs`](../../../server/src/venues/gate/markets.rs) does for Gate.

| market field | catalog field | value | check |
|---|---|---|---|
| raw market id | `symbol` | `BTCUSDT` | equal to the socket `data.symbol` and the `group` suffix on all 100 live contracts |
| base and quote | `base_currency`, `quote_currency` | `BTC`, `USDT` | |
| contract size | `contract_size` | `0.001` on `BTCUSDT`, `100` on `BTCUSD` | the socket `vol` counts contracts, see [`websocket.md`](./websocket.md) section 4 |
| linear | `quote_currency` | USDT and USDC linear, USD inverse | the four USD contracts are coin-M |
| active | `status` | `Trading` | and `delist_time` 0 or in the future |

Contract sizes on `Trading` rows: `1` on 132, `0.01` on 109, `0.1` on 63, `0.001` on 28, `10` on 15, `0.0001` on 4, `100` on 4, `10000` on 2, `1000` on 1 and `100000` on 1.

### Pairs listed twice, and price scale

| base | contracts |
|---|---|
| BTC | `BTCUSDT`, `BTCUSD`, `BTCUSDC` |
| ETH | `ETHUSDT`, `ETHUSD` |
| XRP | `XRPUSDT`, `XRPUSD` |
| SOL | `SOLUSDT`, `SOLUSD` |

The engine takes one market per pair, so the adapter keeps the USDT contract.
Bases such as `1000PEPEUSDT` are quoted per 1,000 tokens in the symbol itself and need the usual price scale.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /contract/public/details` | `index_price` | absent | `expected_funding_rate`, see section 4 | `funding_interval_hours` | `funding_time` in ms | about 1,047,560 bytes, every contract | median 307 and 314.5 ms, 268 to 706 ms over two runs of 60 polls |
| WebSocket `futures/ticker` without a symbol | `index_price` | `mark_price` | absent | absent | absent | 95.3 and 96.6 frames a second, 299 and 305 contracts | each live contract about every 3 s, see below |
| `GET /contract/public/markprice-kline?symbol=` | | `close_price` of the current bar | | | | one contract per call | 242 to 268 ms |
| `GET /contract/public/funding-rate?symbol=` | | | `expected_rate`, which disagreed on 3 of 8 contracts, section 4 | | `funding_time` | one contract per call | 212 to 285 ms |

No REST call returns the mark for more than one contract.
`markprice-kline` is limited to 12 requests per 2 s per IP, S3, so it can serve 6 contracts a second, not the 100 live ones.
`GET /contract/public/funding-rate-v2`, the bulk funding call the BitMart profile used, answered HTTP 404 `{"error_msg":"404 Route Not Found"}` here.

The ticker without a symbol covered 98 and 99 of the 100 live contracts in two runs of 40 s, missing `ASTEROIDETHUSDT` both times and `BMXUSDT` once.
The longest gap between two frames of one live contract had a median of 3,022 and 3,013 ms and a maximum of 5,064 and 5,061 ms.
A mark stamped on arrival is therefore up to about 5 s old, which sits at the engine's 5 s limit on two legs read apart.

### Row mapping

| `AnchorRow` column | source | example from `BTCUSDT` | conversion |
|---|---|---|---|
| `index` | catalog `index_price` | `"82631.02369565"` | parse the decimal string |
| `mark` | ticker `mark_price` | `"82592.21328986"` | parse the decimal string, never 0 or missing on 299 and 305 contracts in two runs of 40 s |
| `fundingRate` | catalog `expected_funding_rate` | `"0.0000802"` | already a fraction per interval |
| `fundingIntervalHours` | catalog `funding_interval_hours` | `8` | integer |
| `nextFundingAt` | catalog `funding_time` | `1791619200000` | already ms, 08:00 UTC on 2026-10-10 |

## 4. Anchor semantics

### Index

The help center names a volume weighted basket of spot venues, "Huobi, OKEX, Bittrex, HitBTC, Gate.io, Bitmax, Poloniex, MXC, etc.", S4, a list that reads as copied from an older BitMart text.
No basket call is public.
`index_name` equals the symbol on every row.

### Mark

The help center says the mark "reflects the global spot index adjusted by funding costs", S4.
No clamp is published for crypto contracts.
On the ticker, the mark of a live contract sat a median 627 and 608 ppm from its index in two runs, with a 90th percentile of 1,506 and 1,353 ppm and a maximum of 2,536 and 3,263 ppm.
The `BTCUSDT` mark tracked the book, not the index: mark 82,592.21, best bid 82,592, index 82,633.14.
On 12 of 98 and 5 of 99 live contracts the last ticker frame had the mark equal to the last price.
So the mark here behaves like the venue's own fair price, and a route that compares this mark with another venue's index-led mark should expect a standing gap of several hundred ppm.

### Funding

Four numbers are published, and they disagree.
The table is from the first run, and the second run, 6 minutes later, kept the same pattern on every contract.

| contract | catalog `funding_rate` | catalog `expected_funding_rate` | front end `funding_rate` | `funding-rate` `expected_rate` | `funding-rate` `rate_value` | last settled in history |
|---|---|---|---|---|---|---|
| BTCUSDT | 0.0001034 | 0.0000801 | 0.0000799 | 0.0000248 | 0.000053934 | 0.000053934 at 00:00 UTC |
| ETHUSDT | 0.0000526 | 0.0000275 | 0.0000273 | 0.000025 | 0.0000562 | 0.0000562 |
| SOLUSDT | 0.0000799 | 0.000051 | 0.000051 | 0.000051 | 0.000102272 | 0.000102272 |
| DOGEUSDT | 0.0000512 | 0.0000212 | 0.0000212 | 0.0000212 | 0.00007168 | 0.00007168 |
| XRPUSDT | 0.0000114 | 0.000013 | 0.0000129 | 0.0000094 | 0.00001404 | 0.00001404 |
| SUIUSDT | 0.0001 | 0.0001 | 0.0001 | 0.0001 | 0.000137 | 0.000137 |
| BTCUSD | 0.00001 | 0.0000269 | 0.0000269 | 0.0000269 | 0.0000099 | 0.0000099 |
| BTCUSDC | 0.000041 | 0.0000301 | 0.0000301 | 0.0000301 | 0.00003895 | 0.00003895 |

The front end column is `funding_rate` from `https://contract-v2.wooxpro.com/v1/ifcontract/tickers?contractID=<id>`, the call the futures web page itself makes, with `next_funding_at` `2026-10-10T08:00:00Z`.

- Catalog `expected_funding_rate` matched the web page's own rate on all 8 contracts to within 0.0000005 in both runs, so it is the upcoming settlement's estimate and the anchor's `fundingRate`.
- `rate_value` of `funding-rate` equalled the last settled rate in `funding-rate-history` on all 8, so it is the last settlement.
- Catalog `funding_rate` matched neither on 7 of 8, and `BTCUSDT`'s `0.0001034` appears nowhere in the 100 settlements back to 2026-09-07.
  The WebSocket `fundingRate` field carries the same number, see [`websocket.md`](./websocket.md) section 6.
  Its meaning is unknown, and a feed should not read it.
- `expected_rate` of `funding-rate` matched the estimate on 5 of 8 in both runs and was under a third of it on `BTCUSDT`.

The cap is ±3.75 %, `funding_upper_limit` `"0.0375"` and `funding_lower_limit` `"-0.0375"` on both `funding-rate` calls.
Settlements fall at 00:00, 08:00 and 16:00 UTC on 8 h contracts, S5, and the settlement instant itself was not captured.

### How often each number changed

Over 60 polls of the catalog at one a second, on the 100 live contracts, in two runs:

| field | changes, median over contracts | range |
|---|---|---|
| `index_price` | 41 and 39 | 0 to 41 |
| `last_price` | 34 and 34 | 0 to 41 |
| `expected_funding_rate` | 0 and 0 | 0 to 30, `BTCUSDT` 7 and 20 |
| `funding_rate` | 0 and 0 | 0 to 0 |
| `funding_time` | 0 and 0 | 0 to 0 |

The index changed on at most 41 of 59 intervals, so the catalog refreshes about every 1.5 s.
On the ticker, a live contract's mark changed a median 9 times in both runs and its index 7 and 10 times in 40 s.

## 5. REST book snapshot

`GET /contract/public/depth?symbol=` returns up to 50 levels a side as `[price, size, cumulative size]` strings, S6.
The call answers, but on most contracts its book is frozen.

| contract | REST best bid and ask | web front end best bid and ask | REST last trade | front end last trade |
|---|---|---|---|---|
| BTCUSDT | 84,321.5 and none | 82,593.4 and 82,593.5 | 86,939.5, 406.1 h old | 82,593.4, 0 s old |
| ETHUSDT | 1,150 and none | 2,492.96 and 2,492.97 | 1,150, 956.5 h old | 2,492.97, 0 s old |
| SOLUSDT | 73.42 and 73.85 | 109.71 and 109.72 | 73.85, 344.1 h old | 109.73 |
| DOGEUSDT | 0.07044 and 0.07059 | 0.08622 and 0.08623 | 0.07059, 444.6 h old | 0.08622 |
| BTCUSD | 82,525 and 82,525.2 | 82,525 and 82,525.1 | 64,673.7, 1,256.8 h old | 82,525.1 |
| BTCUSDC | 82,530 and 82,530.2 | 82,530 and 82,530.3 | 82,530.1, under 0.1 h old | 82,530.3 |

The front end columns come from `https://contract-v2.wooxpro.com/v1/ifcontract/depth` and `/trades`, which the futures web page builds as `contract-v2.<hostname>`.
Over all 100 live contracts, the REST book was one-sided or empty on 59, and of the 41 two-sided books 38 had a mid more than 1 % from the index.
The median distance of a two-sided mid from the index was 277,435 and 277,898 ppm in two runs.
Only `BTCUSD`, `ETHUSD` and `BTCUSDC` had a mid within 1 % of the index, in both runs.
The `BTCUSDT` REST book showed bids at 644, 600 and 250 USDT, and its last REST trade was at 1790137283, 2026-09-23 UTC.
The reply's `timestamp` is the current time, 80 to 167 ms before arrival over six calls, even on a frozen book, so it cannot reveal staleness.
`limit=5` is ignored, and the reply is not cached by Cloudflare (`cf-cache-status: DYNAMIC`).
A feed must take its book from the WebSocket, which is live, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value |
|---|---|
| public limit | per IP, 12 requests per 2 s for `details`, `depth`, `funding-rate`, `funding-rate-history`, `kline`, `markprice-kline`, `leverage-bracket` and `market-trade`, and 2 per 2 s for `open-interest`, S3 |
| status on a limit | 429 with code 30013, and 418 with code 30017 after repeated 429s, S1 and S7. Not provoked |
| `Retry-After` | not documented, and absent from every error reply seen |

| request | status | body |
|---|---|---|
| `depth?symbol=NOPEUSDT` | 400 | `{"code":40034,"message":"Symbol Not Exist","trace":"..."}` |
| `depth` without `symbol` | 400 | the same 40034 |
| `funding-rate?symbol=NOPEUSDT` | 400 | the same 40034 |
| `details?symbol=NOPEUSDT` | 400 | `{"code":40012,"message":"SYMBOL_NOT_EXIST","trace":"..."}` |
| `/contract/public/nothing` | 404 | `{"error_msg":"404 Route Not Found"}` |
| `markprice-kline` with `step=2` | 400 | `{"code":40038,"message":"Invalid K-Line Step","trace":"..."}` |
| `/spot/v1/symbols` | 200 | `{"code":-107,"message":"divide:Can not find selector, please check your configuration!"}` |

`market-trade?symbol=ASTEROIDETHUSDT` answered 40034 `Symbol Not Exist` although the catalog lists that contract as `Trading`.

## 7. Server time and clock offset

No time call exists.
`/system/time` answered HTTP 200 with the `-107` body above, and `/contract/public/time` answered 404.
The `Date` header sat between 0.66 s behind and 0.08 s ahead of the local midpoint over six calls, within its one second resolution.
The depth reply's `timestamp` sat 5 to 39 ms ahead of the local midpoint over six calls with round trips of 211 to 256 ms.

## 8. Recommended poller shape

The engine's anchor poller is REST only, and WOO X Pro publishes no bulk REST mark, so the anchor cannot be built from REST alone.

| item | value |
|---|---|
| named change | a mark source fed by the WebSocket `futures/ticker` without a symbol, stamped on arrival. It is the only bulk source of `mark_price`. Without it every row has mark 0 and every route is refused at open |
| REST URL | `GET https://cloud-api.wooxpro.com/contract/public/details`, every 2 s. The reply refreshes about every 1.5 s and weighs about 1 MB |
| row mapping | section 3, with `fundingRate` from `expected_funding_rate`, never from `funding_rate` |
| staleness | ticker frames per contract arrive about every 3 s and up to 5.1 s apart, at the edge of the engine's 5 s limit between legs |
| market filter | `quote_currency` USDT, `status` `Trading`, `delist_time` 0 or in the future |
| skip | TradFi contracts outside their session (`tradfi_info.market_session_status` 2), and contracts whose socket book is empty or one-sided |
| REST book | do not use, section 5 |

## 9. Source ledger

| id | source | url | retrieved | applies to | used for |
|---|---|---|---|---|---|
| S1 | Developer docs: API Basic Information | https://developer.wooxpro.com/english/basic-info.md | 2026-10-09 | futures API | base URL, status codes |
| S2 | Developer docs: Get Contract Details | https://developer.wooxpro.com/english/restful_public/symbol-detail.md | 2026-10-09 | futures API | catalog fields |
| S3 | Developer docs: Rate Limit | https://developer.wooxpro.com/english/rate-limit.md | 2026-10-09 | futures API | limits |
| S4 | Help center: Futures Trading: Core Concepts and Glossary | https://support.wooxpro.com/hc/en-us/articles/52753219432729, read through the articles API | 2026-10-09 | perpetuals | index basket, mark |
| S5 | Help center: Funding Rate and Settlement | https://support.wooxpro.com/hc/en-us/articles/55311526612505, read through the articles API | 2026-10-09 | perpetuals | settlement times |
| S6 | Developer docs: Get Market Depth, Get Current Funding Rate, Get Funding Rate History, Get MarkPrice K-line | https://developer.wooxpro.com/english/restful_public/depth.md and the sibling pages `funding-rate.md`, `funding-rate-history.md`, `kline-mark-price.md` | 2026-10-09 | futures API | book and funding calls |
| S7 | Developer docs: error codes | https://developer.wooxpro.com/english/error_code/restful.md | 2026-10-09 | futures API | 30013, 30017, 40034 |
| P1 | `rest-probe.py host`, `catalog`, `book`, `errors`, `time` and `identity` at 02:22 to 02:23 UTC, and 02:35 to 02:36 UTC in the second pass | [`rest-probe.py`](../../../scripts/probes/venues/woo-x-pro/rest-probe.py) | 2026-10-09 | this host | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.py frozen` and `live` at 02:25 and 02:36 UTC | [`rest-probe.py`](../../../scripts/probes/venues/woo-x-pro/rest-probe.py) | 2026-10-09 | this host | section 5 |
| P3 | `rest-probe.py anchor` and `funding` at 02:27 and 02:30 UTC, and 02:36 and 02:37 UTC in the second pass | [`rest-probe.py`](../../../scripts/probes/venues/woo-x-pro/rest-probe.py) | 2026-10-09 | this host | sections 3 and 4 |
| P4 | `ws-probe.py ticker` at 02:28 and 02:39 UTC | [`ws-probe.py`](../../../scripts/probes/venues/woo-x-pro/ws-probe.py) | 2026-10-09 | this host | the mark source, sections 3 and 4 |
