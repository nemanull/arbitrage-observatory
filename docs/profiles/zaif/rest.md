# Zaif REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:23 to 04:50 UTC), from the development host near Seattle, through the Canadian VPN exit named in [`fees.md`](./fees.md) section 1.

This profile covers the public spot REST API of Zaif (CCXT id `zaif`), because Zaif lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) unless it cites a document.

## 1. Host and latency from this machine

| host | resolved to | probed |
|---|---|---|
| `api.zaif.jp` | `zaif-alb-api-1281707867.ap-northeast-1.elb.amazonaws.com`, an AWS load balancer in Tokyo, at 57.181.57.185 and 16.76.112.204 | HTTP/2 through nginx, 200 on every documented call |
| `ws.zaif.jp` | `zaif-alb-websocket-772524234.ap-northeast-1.elb.amazonaws.com`, at 13.197.17.181 and 3.115.50.174 | see [`websocket.md`](./websocket.md) section 1 |
| `zaif.jp`, the web site | 52.193.5.189 and 54.150.186.202 | 200 on the fee page, terms and standards |
| `corp.zaif.jp`, the corporate site | HubSpot, 199.60.103.28 and 199.60.103.228 | 200 |

| measure | first run | second run |
|---|---|---|
| DNS lookup | 11 ms | 7 ms |
| cold request, `GET /api/1/ticker/btc_jpy` from Node | 645 ms | 151 ms, the connection already warm from the tickers mode |
| warm, 20 requests to the same call | min 136, median 141, p90 313, max 416 ms | min 152, median 156, p90 547, max 766 ms |
| TLS handshake done and first byte with curl, a new connection per call | 353 to 455 ms and 492 to 610 ms over eight calls, 1,108 ms for `trades` | |

The replies carry no rate limit, cache or CDN header.
They carry `server: nginx`, `x-frame-options`, and a `session` cookie that no call needs.
No request was refused from the Canadian VPN exit, and no geoblock was seen on any host above.

## 2. Catalog

### The instruments call

`GET https://api.zaif.jp/api/1/currency_pairs/all` returned 56 pairs in 45,783 bytes, P1.
Each row has `currency_pair`, `name`, `title`, `description`, `id`, `seq`, `is_token`, `event_number`, `item_unit_min`, `item_unit_step`, `item_japanese`, `aux_unit_min`, `aux_unit_step`, `aux_unit_point` and `aux_japanese`, S1.
There is no status field, so a suspended pair is indistinguishable from a live one in the catalog.

| quote | pairs |
|---|---:|
| JPY | 27 |
| BTC | 24 |
| XEM, ETH, ZAIF, `mosaic.cms`, `erc20.cms` | 1 each, the six event pairs less `csbtc_btc` |

Five pairs have `is_token` false: `btc_jpy`, `mona_jpy`, `mona_btc`, `xem_jpy` and `xem_btc`.
Six have a non-zero `event_number`: `csbtc_btc`, `cseth_eth`, `csxem_xem`, `cszaif_zaif`, `cscmseth_erc20.cms` and `cscmsxem_mosaic.cms`.
`GET /api/1/currencies/all` listed 148 currencies, 128 of them tokens.

The catalog reply is not stable.
In a third run of the `catalog` mode, 1 of 10 reads, one read a second, returned 50 rows, and the read made by the second run's `tickers` mode also returned 50, P1.
A curl loop of ten reads from this host returned 50 rows three times, from both load balancer addresses.
The missing six are always `dep_jpy`, `dep_btc`, `polygon.mv_jpy`, `polygon.mv_btc`, `polygon.rond_jpy` and `polygon.rond_btc`, the pairs whose socket frame carries `market_status` 1 and an empty book, see [`websocket.md`](./websocket.md) section 4.
So a loader sees 50 or 56 markets depending on the read.

Liquidity is thin, from `GET /api/1/ticker/{pair}` on every pair, P2.

| pair | 24 h volume | in JPY | spread at the read |
|---|---:|---:|---:|
| `btc_jpy` | 1.868 and 1.990 BTC | 25.3 and 27.0 million | 3,772 and 36 ppm |
| `eth_jpy` | 55.7 and 56.2 ETH | 24.1 and 24.3 million | 2,990 and 3,564 ppm |
| `bch_jpy` | 77.2 and 75.2 BCH | 3.6 and 3.5 million | 26,556 and 37,276 ppm |
| all 27 JPY pairs together | | 55.7 and 57.5 million | |

The two readings are the first and second runs, 18 minutes apart.
In the first run 20 of the 24 BTC-quoted pairs had no volume, and the six event pairs returned `null` for every field except `last`.
There is no bulk ticker call, so these took one request per pair.

### How CCXT 4.5.68 maps it

`fetchMarkets` calls `publicGetCurrencyPairsAll` at `server/node_modules/ccxt/js/src/zaif.js` line 240, and `parseMarket` at lines 264 to 320 maps each row.

| field | CCXT | on the wire | fits the engine |
|---|---|---|---|
| `market.id` | `currency_pair`, line 265 | `btc_jpy`, equal to the socket URL parameter, the socket's `currency_pair` and the REST path on 56 of 56 pairs | yes |
| `symbol` | `name` split on `/`, lines 266 to 270 | `BTC/JPY`. Ten symbols carry a dot, such as `POLYGON.MV/JPY`, `MOSAIC.CMS/BTC` and `ERC20.CMS/JPY` | the dot is harmless |
| `type`, `spot`, `swap` | `'spot'`, `true`, `false`, lines 280 to 283 | 56 spot, 0 swap, P1 | no market passes the swap filter |
| `contractSize` | `undefined`, line 290 | sizes are base units, see [`websocket.md`](./websocket.md) section 4 | would become 1, which is right for spot |
| `linear` | `undefined`, line 287 | | |
| `active` | `undefined`, line 286, "can trade or not" | the catalog has no status | a suspended pair looks active |
| `taker`, `maker` | not set per market, so the exchange constant 0.001 and 0 applies | see [`fees.md`](./fees.md) section 8 | |
| pairs listed twice | | none, P1 | |

The engine's connector keeps only `type === 'swap'` markets, so it would load no Zaif market at all, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203.

### Price scale

No pair is quoted per 10 or per 1000 units.
Prices below one satoshi are not possible, and BTC-quoted pairs such as `xem_btc` sit at the 1e-08 floor, P3.

## 3. Anchor

Zaif publishes no index price, no mark price and no funding rate, because it lists no derivative.
Nothing maps to an `AnchorRow`.

The public calls that return a price are per pair, with no bulk form, S1:

| call | fields | reply |
|---|---|---|
| `GET /api/1/ticker/{pair}` | `last`, `high`, `low`, `vwap`, `volume`, `bid`, `ask` | 137 or 138 bytes for `btc_jpy`. `vwap` is the 24 h volume weighted average, S1 |
| `GET /api/1/last_price/{pair}` | `last_price` | 26 bytes for `btc_jpy` |
| `GET /api/1/trades/{pair}` | the last 150 trades at most, S1 | 19,080 bytes for `btc_jpy` |

None of these is an index, since each is Zaif's own trading.
The easy trading desk quotes its own buy and sell prices, which include a spread of 0.1 % to 8.0 %, see [`fees.md`](./fees.md) section 2, and it has no public API.
The page `https://zaif.jp/download_trade_price` requires a login.

The retired AirFX group still answers on the futures API, with a frozen `last` of 4,879,970 JPY, an empty book and `swap_rate_bid` and `swap_rate_ask` of 0, P4.
It is not an anchor, see [`fees.md`](./fees.md) section 3.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.
The ticker's `vwap` is a 24 h average of Zaif's own trades, "過去24時間の加重平均", S1, and a quiet pair's `last` can be days old.
In the socket, a quiet pair's last push was 21.7 minutes to 13.7 hours old on the first frame, and the six suspended pairs' last push was dated 2026-01-29, see [`websocket.md`](./websocket.md) section 4.

## 5. REST book snapshot

`GET https://api.zaif.jp/api/1/depth/{pair}` returns `asks` and `bids`, each a list of `[price, size]` JSON numbers, at most 150 per side, with asks ascending and bids descending, S1.

| pair | bids | asks | order violations | reply |
|---|---:|---:|---:|---|
| `btc_jpy` | 150 | 150 | 0 | 6,500 to 6,503 bytes |
| `eth_jpy` | 150 | 150 | 0 | 5,889 and 5,890 bytes |
| `mona_jpy` | 49 | 150 | 0 | 2,897 bytes |
| `xem_btc` | 0 | 98 | 0 | 1,785 bytes, one-sided, asks from 1e-08 BTC |

Both runs, P3.
No crossed book was seen.
The reply carries no update id, sequence or timestamp, so it cannot be aligned with the socket except by content.
The socket's top 20 matched this book on 39 and 40 of 40 levels read 257 and 373 ms apart, see [`websocket.md`](./websocket.md) section 4.

Thirty reads of `btc_jpy` at one second changed from the previous read 16 times in the first run and 3 times in the second, with 15 and 4 distinct bodies, P3.
No cache header is sent, and the replies followed the book, so no edge cache was seen.

## 6. Rate limits and errors

"呼び出しは1秒間に10回以下におさまるようにしてください。呼び出しが多すぎるとアクセス拒否されることがあります。", keep public calls to 10 a second or fewer, or access may be denied, S1.
No status code, `Retry-After` or limit header is documented for a refusal, and the probe stayed at about 4 requests a second, so none was seen.
The trading API has its own per method limits, such as 10 calls in 10 s for `get_info` and 9 in 10 s for `trade`, S2.
CCXT sets `rateLimit` 100 ms at `zaif.js` line 25.

Errors come back as HTTP 200 with a JSON `error` string, P5.

| request | status | body |
|---|---|---|
| `/api/1/ticker/nope_jpy` | 200 | `{"error": "unsupported currency_pair"}` |
| `/api/1/depth/nope_jpy` | 200 | `{"error": "unsupported currency_pair"}` |
| `/api/1/depth/BTC_JPY` | 200 | `{"error": "unsupported currency_pair"}` |
| `/api/1/nope/btc_jpy` | 200 | `{"error": "unsupported method"}` |
| `/api/1/currencies/nope` | 200 | `[]` |
| `/fapi/1/ticker/99/btc_jpy` | 200 | `{"error": "invalid group_id or currency_pair"}` |
| `/api/1/depth/` | 404 | the site's HTML error page |

CCXT maps `unsupported currency_pair` to `BadRequest` at `zaif.js` line 225.
A poller has to check the body for `error`, because the status stays 200.

## 7. Server time and clock offset

No server time call exists, S1.
The `Date` header has one second resolution, and 20 reads put it 22 to 955 ms and then 90 to 845 ms behind the local midpoint of each request, which bounds the offset to about −22 to +45 ms in the first run and −90 to +155 ms in the second, P6.
The socket's `timestamp` has microseconds, and busy pushes arrived 62 to 92 ms after it, while a protocol ping took 114 to 139 ms round trip, see [`websocket.md`](./websocket.md) section 5.
If the timestamp is stamped at send, the two clocks agree within about 30 ms, which is an inference.
The socket `timestamp` is Japan time, UTC+9, with no zone marker.

## 8. Recommended poller shape

None.
There is no index, mark or funding to poll, and no bulk price call.
A spot design would take its book from the socket, see [`websocket.md`](./websocket.md) section 8, and it would have to read the catalog more than once, or keep the union of reads, because a read can drop the six suspended pairs.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Zaif API document v2.1.0, 現物公開API | https://zaif-api-document.readthedocs.io/ja/latest/PublicAPI.html | 2026-09-22 | Zaif Inc., Japan | endpoints, catalog fields, ticker and `vwap`, trades and depth caps, level order, 10 calls a second, errors, sections 2 to 7 |
| S2 | Zaif API document v2.1.0, 現物取引API | https://zaif-api-document.readthedocs.io/ja/latest/TradingAPI.html | 2026-09-22 | Zaif Inc., Japan | trading API limits, section 6 |
| S3 | CCXT 4.5.68 `zaif.js` | `server/node_modules/ccxt/js/src/zaif.js` | 2026-09-22 | CCXT | lines 25, 225, 240, 264 to 320, sections 2 and 6 |
| P1 | `rest-probe.mjs catalog`, at 04:29, 04:47 and 04:49 UTC, and a ten read curl loop at about 04:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog, CCXT mapping, unstable row count, section 2 |
| P2 | `rest-probe.mjs tickers`, at 04:29 and 04:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | volume and spread, section 2 |
| P3 | `rest-probe.mjs depth`, at 04:30 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | book shape and caching, sections 2 and 5 |
| P4 | `rest-probe.mjs futures`, at 04:30 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | the retired AirFX group, section 3 |
| P5 | `rest-probe.mjs errors`, at 04:30 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | error shapes, section 6 |
| P6 | `rest-probe.mjs latency`, at 04:29 and 04:47 UTC, and curl timings at 04:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/zaif/rest-probe.mjs) | 2026-09-23 UTC | this host | DNS, latency, headers, clock, sections 1 and 7 |
