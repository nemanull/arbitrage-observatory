# Coincheck REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:44 UTC, from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare loc=CA, SEA edge), so every access result below is from that Canadian VPN exit.

This profile covers the public REST API of Coincheck (CCXT id `coincheck`) for its spot market, since Coincheck lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coincheck/rest-probe.mjs), from the documentation S1, or from CCXT 4.5.68 with a file and line.
The probe ran its `catalog` mode at 04:28 UTC, `errors` at 04:29 and `poll` at 04:30, and all three again at 04:41 to 04:43 UTC for the second pass.
All public calls answered from the Canadian VPN exit, with no geoblock, no challenge page and no refusal.

## 1. Host and latency from this machine

| host | resolved | serves |
|---|---|---|
| `coincheck.com` | `3.165.160.10`, `.33`, `.65` and `.87`, and the reverse name of `3.165.160.10` is `server-3-165-160-10.sea90.r.cloudfront.net` | REST through CloudFront, `x-amz-cf-pop` `SEA900-P6`, origin `nginx` |
| `ws-api.coincheck.com` | `52.193.52.158`, `54.248.222.81` and `13.158.153.94`, and the reverse name of the first is `ec2-52-193-52-158.ap-northeast-1.compute.amazonaws.com` | the public WebSocket, in AWS Tokyo |

| call | cold | warm | cache |
|---|---|---|---|
| `GET /api/ticker?pair=btc_jpy` | 395 ms and 116 ms | 10 calls back to back: median 15 and 16 ms, max 17 and 23 ms, which only the edge can answer | `x-cache` `RefreshHit` and `Hit` on the cold calls. Over 20 calls 3 s apart, `Hit` or `RefreshHit` on 8 and 7 and `Miss` on 12 and 13 |
| `GET /api/order_books?pair=btc_jpy` | | 60 one second polls: min 112 and 114, median 124 and 124, p90 297 and 304, max 310 and 339 ms | `Miss from cloudfront` on 60 of 60 in both runs, so every call reaches the origin |
| `GET /api/exchange_status` | 122 and 118 ms, 3,334 bytes | | |

The pairs of numbers are the first and the second pass.
An origin round trip from this host is about 115 to 125 ms, with a second mode near 300 ms on about one call in ten.

## 2. Catalog

### The instruments call

`GET /api/exchange_status` lists every tradable pair, S1.

| field | meaning, S1 | probed |
|---|---|---|
| `pair` | the pair id | 26 pairs, all quoted in JPY: `btc_jpy`, `eth_jpy`, `etc_jpy`, `lsk_jpy`, `xrp_jpy`, `xem_jpy`, `bch_jpy`, `mona_jpy`, `iost_jpy`, `chz_jpy`, `imx_jpy`, `shib_jpy`, `avax_jpy`, `fnct_jpy`, `dai_jpy`, `wbtc_jpy`, `bril_jpy`, `doge_jpy`, `pepe_jpy`, `mask_jpy`, `mana_jpy`, `trx_jpy`, `grt_jpy`, `sol_jpy`, `fpl_jpy`, `sui_jpy` |
| `status` | `available`, `itayose` or `stop` | `available` on 26 of 26 in both runs |
| `timestamp` | time of the status retrieval | Unix seconds |
| `availability` | `order`, `market_order` and `cancel` booleans | all true on 26 of 26 |

There is no perpetual, so the active perpetual count is 0 in every settlement family.
The active spot count is 26, all against JPY.
The list equals the pair list printed in S1 for the ticker, trades, order book and WebSocket sections.
The reply carries no tick size, lot size or minimum order.

### How CCXT 4.5.68 maps it

CCXT does not call any catalog endpoint.
`coincheck.js` defines no `fetchMarkets`, so the base class at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 1241 to 1248 returns the five markets hard-coded at `server/node_modules/ccxt/js/src/coincheck.js` lines 170 to 195.

| CCXT symbol | `market.id` | still listed |
|---|---|---|
| BTC/JPY | `btc_jpy` | yes |
| ETC/JPY | `etc_jpy` | yes |
| FCT/JPY | `fct_jpy` | no, the REST book answers 400 `invalid pair` |
| MONA/JPY | `mona_jpy` | yes |
| ETC/BTC | `etc_btc` | no, the REST book answers 400 `invalid pair` |

The other 23 live pairs, `eth_jpy` to `sui_jpy`, are absent from CCXT.
Where a market exists, `market.id` is spelled exactly as the socket channel prefix, the socket frame's first element and the REST `pair`.
Every market is `type: 'spot'` with `swap: false`, and `active`, `contractSize`, `linear`, `precision.price`, `precision.amount`, `taker` and `maker` are all `undefined`, in both runs.
No pair is listed twice.
The connector's `isActiveSwapMarket` at `server/src/ccxt/connector.ts` lines 196 to 202 keeps 0 of the 5, and the connector then logs that it found no usable swap markets and skips the venue, at line 51.

### Size unit, pairs listed twice, and price scale

Sizes on REST and on the socket are in the base coin, see [`websocket.md`](./websocket.md) section 4.
CCXT's `contractSize` is `undefined`, which the engine would read as 1, and 1 is right for a base coin size.
No pair is listed twice and no price is scaled.
Every quote is JPY, which is outside the engine's USD, USDC and USDT quote family at `server/src/engine/cluster/quoteFamily.ts` lines 3 to 6.

## 3. Anchor

Coincheck publishes no index price, no mark price and no funding rate, because it lists no derivative.
No bulk call returns any `AnchorRow` column.

It does publish three reference prices, none of which is an index.

| call | what it is | probed |
|---|---|---|
| `GET /api/rate/<pair>` | "Standard Rate of Coin", `{"rate": "60000"}`, formula Not publicly specified, S1 | one pair per call, 121 to 310 ms, never cached. It changed on 19 of 19 three second intervals in both runs and sat within 108 ppm of the REST book mid in the first run and 23 ppm in the second, with a median of 0. It also answers for `etc_btc`, a pair the exchange does not list, with `{"rate":"0.00010985"}` |
| `GET /api/ticker?pair=<pair>` | last, bid, ask, 24 h high, low and volume, and `timestamp`, S1 | one pair per call, and without `pair` it returns `btc_jpy`, S1. It is stale: `timestamp` was 0.5 to 10.7 s behind this host's clock over 40 calls, including calls the edge reported as `Miss`, and the body changed on only 5 and 6 of 19 three second intervals |
| daily closing prices | the page `https://coincheck.com/exchange/closing_prices`, rendered by script | not probed |

So the standard rate behaves like the exchange book mid, and it is not a basket of other venues.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The standard rate's formula is Not publicly specified.
The rate for `etc_btc`, which has no exchange book, suggests that the rate also covers pairs quoted by the broker desk, and that reading is an inference.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /api/order_books?pair=<pair>`, S1 |
| depth | no depth parameter is documented, and the reply holds up to 200 levels per side: `btc_jpy` 200 and 200, `xrp_jpy` 200 and 200, `eth_jpy` 200 and 162 or 164, and the thinnest, `grt_jpy`, 7 bids and 3 asks |
| level order | bids descending and asks ascending on 26 of 26 pairs in both runs |
| numbers | price and size both strings, as `["13689876.0","0.27303781"]`, while the S1 example shows the price as a JSON number |
| size | 196 to 9,872 bytes per pair |
| caching | none: `x-cache` `Miss from cloudfront` on 60 of 60 polls, and the body and the `etag` changed on 59 of 59 one second intervals, in both runs |
| missing `pair` | 200 with the `btc_jpy` book |
| spread at the touch | `btc_jpy` 222 and 108 ppm, `eth_jpy` 601 and 757 ppm, and a median over the 26 pairs of 34,145 and 33,406 ppm, up to 297,872 ppm on `wbtc_jpy` and 211,346 ppm on `grt_jpy` |

No book was crossed or empty on either side.
The book has no update id, which is why a socket feed cannot align to it, see [`websocket.md`](./websocket.md) section 4.
`GET /api/exchange/orders/rate?order_type=buy&pair=<pair>&amount=<n>` returns the price an order of that size would get, S1, and was not probed.

## 6. Rate limits and errors

No limit is published for the public API.
S1 publishes two private limits: new orders at most 4 per second and order details at most once per second, each answered with `429:too_many_requests` when exceeded, "Limits are not per currency pair" and "may be changed depending on the system load status".
CCXT spaces calls by `rateLimit: 1500` ms at `coincheck.js` line 23.

The probe stayed far below any plausible limit, apart from one burst.
The first pass sent 20 ticker calls back to back in 0.44 s, which the CloudFront edge answered, all 200.
The second pass sent 20 ticker calls 200 ms apart in 5.6 s, all 200.
No reply carried a rate limit header or `Retry-After`, and none of the about 400 public calls of this survey was refused.

| request | status | body |
|---|---|---|
| `GET /api/order_books?pair=nope_jpy` | 400 | `{"success":false,"error":"invalid pair"}` |
| `GET /api/order_books?pair=BTC_JPY` | 400 | `{"success":false,"error":"invalid pair"}` |
| `GET /api/order_books?pair=fct_jpy`, and `etc_btc` | 400 | `{"success":false,"error":"invalid pair"}` |
| `GET /api/trades?pair=nope_jpy`, and without `pair` | 400 | `{"success":false,"error":"invalid pair"}` |
| `GET /api/rate/nope_jpy` | 400 | `{"success":false,"error":"Invalid pair"}` |
| `GET /api/ticker?pair=nope_jpy`, and `etc_btc` | 404 | an HTML page of 68,506 bytes titled `ページが見つかりません` |
| `GET /api/exchange_status?pair=nope_jpy` | 404 | empty, `content-type: application/json` |
| `GET /api/nope` | 404 | empty, `content-type: application/json` |

The same replies came back in both runs.

## 7. Server time and clock offset

No server time call exists.
`timestamp` in `exchange_status` and `ticker` is whole seconds, and the ticker's was up to 10.7 s stale.
The `Date` header of the uncached `order_books` reply has one second resolution, so each of eight calls bounds the offset to a one second window, and the probe intersects them.
At 04:41 UTC the server clock minus this host's clock lay between -97 and +132 ms.
The first pass used the cached ticker for this and is not cited.

## 8. Recommended poller shape

None.
Coincheck publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read, and no `AnchorRow` can be built.
The standard rate tracks the book mid and would add nothing a book feed does not already hold.

For a later spot stage, two calls would serve a book feed.

| item | recommendation | reason |
|---|---|---|
| catalog | `GET /api/exchange_status`, keep pairs whose `status` is `available`, instead of CCXT `loadMarkets` | CCXT knows 3 of the 26 live pairs and 2 dead ones |
| seed | `GET /api/order_books?pair=<pair>`, one pair at a time | the socket sends no snapshot, and this reply is uncached and live |
| pacing | no faster than CCXT's 1,500 ms between calls without a published limit, so 26 seeds take about 40 s | no public limit is published |
| skip | `ticker` | its `timestamp` was up to 10.7 s old |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coincheck Exchange API documentation | https://coincheck.com/documents/exchange/api | 2026-09-22 | Coincheck, Inc., Japan | public calls, parameters, status values, private rate limits, sections 2, 3, 5 and 6 |
| C1 | CCXT 4.5.68 `coincheck.js` | `server/node_modules/ccxt/js/src/coincheck.js` | 2026-09-22 | CCXT | `rateLimit` at line 23, static markets at lines 170 to 195, section 2 and 6 |
| C2 | CCXT 4.5.68 `Exchange.js` | `server/node_modules/ccxt/js/src/base/Exchange.js` | 2026-09-22 | CCXT | the base `fetchMarkets` at lines 1241 to 1248, section 2 |
| P1 | `rest-probe.mjs catalog` at 04:28 UTC and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coincheck/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 5 and 7 |
| P2 | `rest-probe.mjs errors` at 04:29 UTC and 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coincheck/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 6 |
| P3 | `rest-probe.mjs poll` at 04:30 UTC and 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coincheck/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 3 and 5 |
