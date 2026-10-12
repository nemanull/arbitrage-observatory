# GudangKripto REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:44 to 04:14 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

GudangKripto lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST surface.
GudangKripto publishes no API documentation and no API keys for market data.
Every path below comes from the endpoint map in the web app's entry chunk, S2 of [`fees.md`](./fees.md) section 10, and was then called without credentials.
The short answer is a usable public coin list, two chart calls, and no REST order book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/gudangkripto/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S7 are those of [`fees.md`](./fees.md) section 10, and R1 to R3 are in section 9 below.

## 1. Host and latency from this machine

### Where the API lives

The web app's runtime config names the bases, R1.

| config key | value | probed |
|---|---|---|
| `apiBaseUrl` | `https://be.gudangkripto.id/api/core` | public calls answer, see section 2 |
| `marketApiBaseUrl` | `https://be.gudangkripto.id/api/market` | only account paths such as `/spot/order-history` are mapped to it, and the bare base answers 404 |
| derived `socket` base | `https://be.gudangkripto.id/api/socket`, built by replacing `core` with `socket` | the chart calls answer, see section 5 |
| `wsUrl` | `wss://be.gudangkripto.id/ws` | see [`websocket.md`](./websocket.md) |
| `graphqlHttp` and `graphqlWs` | `https://vakotrade-gudangkripto-uat.cryptosrvc.com/graphql`, a leftover test host | the name does not resolve |
| `walletApiBaseUrl` | `https://gudang-api.cobaaja.xyz` | not called, wallet calls need a login |

Each entry of the endpoint map has a `direct` path on the backend and a `server` path on the Nuxt server at `https://gudangkripto.id/api/...`, R1.
The coin list answers on both, `GET /api/core/coin` on the backend and `GET /api/core/crypto` on the Nuxt server, with the same 36 coins.

### Access, from the Canadian VPN exit

| call | status | body or note |
|---|---|---|
| `GET https://be.gudangkripto.id/api/core/coin` | 200 | JSON coin list, 41,889 to 41,934 bytes, see section 2 |
| `GET /api/core/coin/BTC` | 200 | one coin, 2,040 bytes |
| `GET /api/core/app-parameter` | 200 | fee and limit parameters, 943 bytes, see [`fees.md`](./fees.md) section 2 |
| `GET /api/core/faqs` | 200 | five referral FAQ entries |
| `GET /api/socket/kline/history/bulk?symbols=BTC_IDR&interval=1h&from=...&to=...` | 200 | candles, see section 5 |
| `GET /api/socket/data-klines-tradingview?symbol=BTC_IDR&interval=1h&from=...&to=...` | 200 | candles in a second shape, see section 5 |
| `GET https://be.gudangkripto.id/` and `GET /api/core`, `/api/market` | 404 | `text/plain`, empty or "Not Found" |

No geoblock, challenge or refusal was met.

### Resolution

`be.gudangkripto.id`, `gudangkripto.id` and `market.gudangkripto.id` all resolved to the Cloudflare addresses `104.20.19.227` and `172.66.169.10`, and to two IPv6 addresses.
Replies carry `Server: cloudflare`, `cf-cache-status: DYNAMIC`, a W3C `traceparent` header, and edge `YVR` in `CF-RAY`.

### Latency

| measure | value |
|---|---|
| cold `app-parameter` request, new connection | 228 ms, and 221 ms in the rerun |
| five more requests, each on a new connection | 220 to 355 ms, and 206 to 232 ms in the rerun |
| coin list, about 41.9 kB | 292 ms, and 307 ms in the rerun |
| one coin detail | 304 ms, and 934 ms in the rerun |
| missing paths | 203 to 310 ms across both runs |

Every probe request opened its own TLS connection, so these times include the handshake to the Vancouver edge and the edge's trip to the origin.
The socket upgrade's `Server-Timing` header reported `cfEdge;dur=13,cfOrigin;dur=528` in the rerun, R2.

## 2. Catalog

### The instruments call

`GET https://be.gudangkripto.id/api/core/coin` returns `{"status": true, "message": "Success", "data": [...]}` with 36 coins.
Each entry carries `coin`, `name`, `icon`, `created_at`, `tags`, `rounded`, `detail`, `min_buy`, `min_sell`, `high_24h`, `low_24h`, `volume_24h`, `market_cap`, `price_performance`, `chart_performance`, `market_stats`, `about`, `links`, `market_cap_rank` and `user_activity`.
`detail` holds one row per deposit network, and every row's `pairs` is `IDR`, so the catalog is 36 pairs, all quoted in IDR.

| field | meaning, as probed |
|---|---|
| `coin` | the base symbol, such as `BTC` |
| `detail[].pairs` | the quote, `IDR` on every coin |
| `rounded.price` and `rounded.qty` | display decimals, such as 1 and 6 for BTC, 2 and 4 for ETH, 9 and 9 for USDT |
| `min_buy` and `min_sell` | 70,000 IDR on every coin |
| `volume_24h` | above 0 on 7 of 36 coins |

The 36 pairs are AAVE, ADA, ALGO, ANOA, ATOM, AVAX, BCH, BNB, BTC, CJL, CST, DOGE, DOT, DRX, ETH, GOIDR, IDRT, JAM, KITE, LINK, LIT, LTC, NXA, PEPE, POL, RAI, SHIB, SLVON, SOL, TRUMP, TRX, UNI, USDC, USDT, VVV and XRP, each against IDR.
There is no status, active, tick size or lot size field.
A coin that is listed but not trading is visible only on the socket, where `orderbook:KITE_IDR` delivered empty bid and ask arrays, see [`websocket.md`](./websocket.md) section 4.
The socket's `market:IDR` channel carries the same 36 coins in every frame.

### Symbol formats

| surface | form |
|---|---|
| coin list | `BTC`, with the quote in `detail[].pairs` |
| socket channels | `orderbook:BTC_IDR`, `ticker:BTC_IDR`, `trades:BTC_IDR` |
| bulk kline call | `symbols=BTC_IDR`, and the reply is keyed `BTC_IDR` |
| TradingView kline call | `symbol=BTC_IDR`, and the reply's `ch` is `market.btc/idr.kline.1hour` |
| fee page tables | `BTC/IDR` in the fee rows and `BTC / IDR` in some rule rows |

### How CCXT maps it

It does not.
CCXT 4.5.68 has no GudangKripto class, and the current CCXT `master` has none either, see [`fees.md`](./fees.md) section 8.

### Size unit, pairs listed twice, and other lists

Book amounts and trade quantities are in the base coin, such as `0.997129` BTC, and prices are in whole rupiah for BTC, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice.
Three other pair lists disagree with the coin list.
The fee page's static table has 44 rows, and it holds 11 coins the coin list lacks and misses 3 the coin list has, see [`fees.md`](./fees.md) section 7.
CoinMarketCap's market pair list also has 36 pairs, but with AIA, LEO, ONDO and USDP in place of CJL, IDRT, KITE and NXA, S5.
The coin list is the one the trade page and the socket follow, so it is the catalog.

## 3. Anchor

Not offered.
GudangKripto publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The prices it does publish are the last trade price per pair, in the coin detail, the socket's `ticker` and `market:IDR` channels and the candles.
The parameter call also carries a fixed buy and sell price for its IDR-pegged GIDR token, `price_buy_gidr` "1129000" and `price_sell_gidr` "1130000", S3.
None of these is a basket index, and no anchor poller is recommended.

## 4. Anchor semantics

Not offered, for the reason in section 3.

## 5. REST book snapshot

### The call

None exists.
The web app's endpoint map has no order book, depth or ticker entry, R1.
Its trade page takes the book only from the socket channel `orderbook:<COIN>_IDR`, R1.
Nine guessed paths answered HTTP 404 with `text/plain` "Not Found" or an empty body: `/api/market/orderbook?pair=BTC_IDR`, `/api/market/orderbook/BTC_IDR`, `/api/core/orderbook/BTC_IDR`, `/api/socket/orderbook/BTC_IDR`, `/api/socket/depth?symbol=BTC_IDR`, `/api/market/ticker`, `/api/core/ticker`, `/api/v1/depth?symbol=BTC_IDR` and `/api/v3/depth?symbol=BTC_IDR`.

### Chart calls

Two public chart calls answer without a login.

| call | shape |
|---|---|
| `GET /api/socket/kline/history/bulk?symbols=BTC_IDR&interval=1h&from=<s>&to=<s>` | `{"BTC_IDR": [[open time ms, open, high, low, close, base volume, close time ms, quote volume, 0, 0], ...]}`, numbers as JSON numbers, with 20 to 22 decimals in the first run's first candle prices and 5 or 6 in the rerun's |
| `GET /api/socket/data-klines-tradingview?symbol=BTC_IDR&interval=1h&from=<s>&to=<s>` | `{"ch": "market.btc/idr.kline.1hour", "message": "success", "ts": <ms>, "pricenow": {...}, "data": [...]}` |

The second call without a query answers HTTP 400 `{"message":"invalid file_name or (symbol+interval)"}`.
Candle and ticker prices carry long fractional parts, such as the socket ticker's `last_price` `1475672925.2791066666639093164` beside a last trade at `1475672925`, so a consumer should parse them as decimals.

### Caching

Every reply carried `cf-cache-status: DYNAMIC`, so Cloudflare does not cache the API.

## 6. Rate limits and errors

The limit is Not publicly specified.
Twenty `app-parameter` requests at two per second all answered HTTP 200, and no reply carried a rate limit or `Retry-After` header.

| case | status | body |
|---|---|---|
| unknown coin, `/api/core/coin/NOPE` | 404 | `{"status":false,"message":"Cryptocurrency not found"}` |
| unknown path under `/api/core` | 404 | `text/plain` "Not Found" |
| unknown static page, `/api/core/static-pages/trading-rules` | 404 | `{"status":false,"message":"Page not found"}` |
| TradingView kline call with no query | 400 | `{"message":"invalid file_name or (symbol+interval)"}` |

Success bodies wrap data as `{"status": true, "message": "...", "data": ...}`, and the chart calls do not.

## 7. Server time and clock offset

There is no server time call in the endpoint map, R1.
The HTTP `Date` header matched the local clock to within its 1 s resolution, with the probe's estimate at 0.5 s and 0.6 s in the two runs.
The socket's `pong` frame carries a millisecond `data.ts`, and the `market:IDR` frames reached this host a median 76 ms after their `ts`, which bounds the clock offset plus one trip from the origin, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

None.
No anchor exists, and no REST book exists to seed or check a socket book.
If a later design added an IDR spot leg, the catalog would come from `GET https://be.gudangkripto.id/api/core/coin` polled every few minutes, with the 36 `coin` values joined to `_IDR` to form socket channel names, and the book from the socket alone.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| R1 | the web app's entry chunk `https://gudangkripto.id/_nuxt/BySqCzkc.js` and the runtime config in `https://gudangkripto.id/` | the base URLs, the endpoint map with `direct` and `server` paths, the trade page's socket channel names, the absence of any book or time call |
| R2 | the socket upgrade response from `wss://be.gudangkripto.id/ws`, see [`websocket.md`](./websocket.md) | `Server-Timing` with `cfEdge;dur=13,cfOrigin;dur=528` |
| R3 | [`rest-probe.py`](../../../scripts/probes/venues/gudangkripto/rest-probe.py) runs on 2026-10-10 UTC | every status, size, time and body in sections 1, 2, 5, 6 and 7 |
