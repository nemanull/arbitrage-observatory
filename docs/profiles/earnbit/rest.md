# EarnBIT REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:34 to 05:04 UTC on 2026-09-23, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare `loc=CA`, edges `SEA` and `YVR`).

This profile covers the public REST API of EarnBIT (no CCXT class) on its spot market, since EarnBIT lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/earnbit/rest-probe.mjs) unless it cites a document.
EarnBIT publishes no index, no mark and no funding rate, so sections 3 and 4 record that absence and the reference prices it does publish.

## 1. Host and latency from this machine

| host | role | resolved | probed |
|---|---|---|---|
| `api.earnbit.com` | public REST API, S1 | `104.21.96.99` and `172.67.176.146`, Cloudflare | cold request 495 to 601 ms, then 9 warm requests of `GET /` at 154 to 227 ms, median 157 to 181 ms, over four runs. Cloudflare's trace answered `loc=CA` and `colo=SEA`, and some replies came through `YVR` |
| `ws.earnbit.com` | WebSocket, see [`websocket.md`](./websocket.md) | the same two addresses | |
| `earnbit.com` | web app | the same two addresses | serves the Nuxt bundle that names every other host |
| `back.earnbitech.cloud` | the web app's own backend, `BASE_URL` in the bundle, S3 | `51.178.73.155` | TCP connected in 13 to 291 ms in four runs, but an HTTPS request got no answer within 8 s in the three runs that tried one, and two earlier `curl` requests stalled after the TLS client hello for 10 to 12 s. Not part of the public API |
| `ws-futures.earnbit.com`, `futures.earnbit.com`, `api-futures.earnbit.com` | guesses at a futures host | `ENOTFOUND` | none exists |

Every reply of `api.earnbit.com` carried `cache-control: no-store, must-revalidate, no-cache, max-age=0` and `cf-cache-status: DYNAMIC`, so Cloudflare does not cache it.
`GET /` answers a status object, `{"status":"ok","uptime":655861,"timestamp":1790138855114}`, whose `timestamp` is the server clock in ms.
Nothing refused this host, and who may trade is in [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

| call | reply | rows |
|---|---|---|
| `GET /api/v1/public/markets` | `{"code":200,"success":true,"message":"","result":[…]}`, 3,884 bytes | 26 |
| `GET /api/v1/public/symbols` | a list of names, 348 bytes | 26 |
| `GET /api/v1/public/products` | `{id, fromSymbol, toSymbol}`, 1,503 bytes | 26 |
| `GET /api/v1/public/tickers` | an object keyed by market, each `{at, ticker: {name, open, last, high, low, deal, vol, bid, ask, change}}`, 5,520 to 5,535 bytes | 26 |

A `markets` row, as read on 2026-09-23.

```json
{"name":"BTC_USDT","moneyPrec":1,"stockPrec":6,"feePrec":8,"stock":"BTC","money":"USDT","minAmount":"0.000001","maxDistancePercentFromMidPrice":"20"}
```

The 26 markets are 24 quoted in USDT and 2 in BTC: `USDC_USDT ETC_USDT SNX_USDT SUSHI_USDT COMP_USDT USDQ_USDT ETH_USDT DOGE_USDT ADA_USDT SHIB_USDT BTC_USDT IMX_USDT BCH_USDT TRX_USDT SOL_USDT USDG_USDT LTC_BTC UNI_USDT XLM_USDT LINK_USDT BLUR_USDT AVAX_USDT ETH_BTC XRP_USDT FLOKI_USDT LTC_USDT`.
No row has a status field, and every listed market had a book of 98 to 100 orders on each side, so all 26 are live.
CoinGecko counts the same 26 pairs over 24 coins, S4.

### How a catalog would map it

CCXT 4.5.68 has no EarnBIT class, and neither does CCXT master, see [`fees.md`](./fees.md) section 8.
So the engine's `loadMarkets` path does not exist for this venue, and a custom loader would be needed.

| engine field | source | note |
|---|---|---|
| `rawMarketId` | `name`, `BTC_USDT` | identical to the socket's `params[2]` and to the `tickers` keys on 26 of 26 markets |
| `base`, `quote` | `stock`, `money` | |
| `linear`, `contractSize` | not applicable | spot, amounts are in base currency |
| `active` | every listed row | no status field exists |
| pairs listed twice | none | 26 distinct names |

### Futures routes

Six candidate paths, `/api/v1/public/futures`, `/api/v1/public/futures/markets`, `/api/v1/public/perpetual/markets`, `/api/v1/public/margin/markets`, `/api/v2/public/markets` and `/api/v4/public/futures`, each answered 404 with a body like `{"status":"error","message":"Cannot GET /api/v1/public/futures","result":null}`, in four runs.
The documentation lists no futures endpoint, S1.

## 3. Anchor

EarnBIT publishes no index, mark or funding rate, so there is no bulk anchor call and no `AnchorRow` column can be filled.

| reference price it does publish | where | what it is |
|---|---|---|
| last trade, best bid and ask, 24 h open, high, low and volume | `GET /api/v1/public/tickers`, all 26 markets in one call, median 159 to 179 ms over 60 polls in each of two runs | the ticker, not an index |
| last trade | `price.update` on the socket | the ticker, not an index |
| 24 h statistics | `state.update` on the socket | the matching engine's own statistics, which differ from the REST ticker, section 4 |

No anchor poller is recommended.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.
What the reference prices are made of is still worth writing down, because it says what an EarnBIT quote is.

### The book follows Bybit

Read in one parallel round with Bybit's and Binance's bulk spot tickers, EarnBIT's mid equalled Bybit's mid exactly on 12, 16 and 9 of the 24 markets Bybit lists, in the runs at 04:47, 04:53 and 05:02 UTC.
On the other markets it differed from Bybit's by at most 593, 649 and 451 ppm.
Against Binance, 7, 3 and 5 of 24 were exactly equal, and the largest gaps were 1,446, 1,283 and 989 ppm.
`USDQ_USDT` and `USDG_USDT` are not listed on either.
The REST ticker's 24 h `high` and `low` both equalled Bybit's spot `highPrice24h` and `lowPrice24h` on 15, 16, 16 and 9 of 26 markets in four runs, and Binance's on 1, 1, 1 and 0.
Every visible order is a zero fee order, see [`fees.md`](./fees.md) section 5.
So an EarnBIT quote is a market maker's ladder around Bybit's price, and a route between EarnBIT and Bybit would mostly read the maker's own spread.

### REST ticker against the socket statistics

Read at the same moment at 04:56:43 UTC, the REST ticker and the socket's `state.update` for the same 86,400 s period agreed on `high` and disagreed on everything else.

| market | `high`, both | `low`, socket and REST | `volume`, socket and REST | ratio |
|---|---|---|---|---:|
| `BTC_USDT` | 87285.7 | 86140.2 and 85109.8 | 1.904726 and 13.367360 BTC | 7.0 |
| `ETH_USDT` | 2788.96 | 2745.84 and 2715.74 | 40.93640 and 265.15688 ETH | 6.5 |
| `XRP_USDT` | 1.6587 | 1.5696 and 1.493 | 87081.84 and 470544.53 XRP | 5.4 |
| `SOL_USDT` | 119.72 | 117.83 and 115.56 | 703.7195 and 4817.2392 SOL | 6.8 |

The REST ticker reports 5.4 to 7.0 times the socket's 24 h volume, and its `low` is the one that matched Bybit's.
CoinGecko's 24 h volume of 56.69 to 59.57 BTC in three reads, S4, is of the size of the REST ticker's sum, about 5.0 million in quote units.

### How often each number changed

Over 60 polls of `tickers` one second apart, the `bid`, `ask` or `last` of a market changed on 0 to 29 of 59 intervals, in two runs.
`XRP_USDT` and `AVAX_USDT` changed most, and `TRX_USDT`, `SNX_USDT` and `IMX_USDT` least.
Over 40 reads of the `BTC_USDT` book two a second, the touch changed once and twice in two runs, while the socket showed 11 and 18 `BTC_USDT` touch changes in other 60 s windows, so activity comes in bursts.

## 5. REST book snapshot

| call | depth | order | probed |
|---|---|---|---|
| `GET /api/v1/public/depth/result?market=BTC_USDT&limit=N` | documented default 50, minimum 1 and maximum 1000, S2 | asks ascending, best first. Bids ascending, best last | `limit` 1, 50 and 100 returned 1, 50 and 100 levels a side. `limit` 1000 returned 100, because the book holds about 100 orders a side. `limit` 5000 answered 400 `The limit may not be greater than 1000.`. 170 to 215 ms |
| `GET /api/v1/public/book?market=BTC_USDT&side=buy&offset=0&limit=100` | up to 1,000 orders, S2 | per side, best first | each order carries `id`, `price`, `amount`, `left`, `timestamp` in seconds with ms, `takerFee` and `makerFee`. `total` was 98 to 100 on the 52 market sides of each scan, and 97 on one later read |
| `GET /api/v1/public/history/result?market=BTC_USDT&since=0&limit=3` | trades | newest first | `{tid, date, price, type, amount, total}` |

The `depth/result` reply has no envelope and no timestamp, only `{"asks":[…],"bids":[…]}`.

```json
{"asks":[["87179.3","0.048079"],["87181.3","0.006045"]],"bids":[["87178.7","0.007689"],["87179","0.034108"]]}
```

The book behind both calls is the one the socket sends: top 20 levels equal on both sides of three markets, and the REST touch equal to the socket's touch on 103 of 103 reads, see [`websocket.md`](./websocket.md) section 4.
The orders on one side carried 9 to 93 distinct `timestamp` values, median 64 to 67, so the ladder is not replaced in one stroke.

## 6. Rate limits and errors

No rate limit is documented, S1.
Every reply carried `x-ratelimit-limit: 500`, `x-ratelimit-remaining` and `x-ratelimit-reset: 60`, so the server counts 500 requests per 60 s window.
The probe stayed under 3 requests a second and never saw 429, so the status code and `Retry-After` of a limit are Not verified.

| request | status | body |
|---|---|---|
| unknown path | 404 | `{"status":"error","message":"Cannot GET /api/v1/public/nope","result":null}` |
| `depth/result` without `market` | 400 | `{"code":400,"success":false,"message":{"market":["The market field is required."]},"result":[]}` |
| `depth/result?market=NOPE_USDT` or `btc_usdt` | 200 | `{"code":500,"success":false,"message":"service unavailable","result":[]}` |
| `depth/result` with `limit=5000` | 400 | `{"code":400,"success":false,"message":{"limit":["The limit may not be greater than 1000."]},"result":[]}` |
| `ticker?market=NOPE_USDT` | 400 | `{"code":400,"success":false,"message":{"market":["Market is not available"]},"result":[]}` |
| `book` without `side` | 400 | `{"code":400,"success":false,"message":{"side":["The side field is required."]},"result":[]}` |

An unknown market on the depth call is a 200 with an inner code 500, so a client must read `success`.

## 7. Server time and clock offset

`GET /` returns `timestamp` in Unix ms.
Against the midpoint of each request, the median offset was 0 to 4 ms and the smallest -3 ms over four runs of ten requests, while the cold request read 169 to 202 ms off because of its handshake.
The socket's `server.time` returns Unix seconds, see [`websocket.md`](./websocket.md) section 6.

## 8. Recommended poller shape

None.
EarnBIT has no perpetual and publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read, and a spot leg would carry no anchor.
If the catalog were ever needed, `GET /api/v1/public/markets` once at boot gives every `rawMarketId`, and `GET /api/v1/public/tickers` is the one bulk price call, well inside 500 requests a minute.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | EarnBIT API, Public endpoints, HTTP | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/public-endpoints-or-http.md | 2026-09-22 | EarnBIT, global | base URL, endpoint list, no futures endpoint, no rate limit, sections 1, 2, 6 |
| S2 | EarnBIT API, Depth List and Order Book Data | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/public-endpoints-or-http/depth-list.md | 2026-09-22 | EarnBIT, global | `limit` default 50 and max 1000, section 5 |
| S3 | EarnBIT web app bundle | https://earnbit.com/_nuxt/d6d52ea.js | 2026-09-22 | Earnbit LLC | `BASE_URL` of the web backend, section 1 |
| S4 | CoinGecko API, exchange record, read by P1 | https://api.coingecko.com/api/v3/exchanges/earnbit | 2026-09-22 | third party | 26 pairs, 24 coins, 59.14, 59.57 and 56.69 BTC of 24 h volume at 04:35, 04:54 and 05:03 UTC, and one 429 at 04:48, sections 2 and 4 |
| P1 | `rest-probe.mjs main`, four runs at 04:34, 04:47, 04:53 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/earnbit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 4, 5, 6, 7 |
| P2 | `rest-probe.mjs poll`, two runs at 04:42 and 04:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/earnbit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 4 |
| P3 | `ws-probe.mjs book`, three runs, with the REST compare and the statistics comparison of the third | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 4 and 5 |
