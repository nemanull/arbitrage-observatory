# C-Patex REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09, for the venue survey of 2026-09-22, CoinMarketCap addition at rank 73, wave 42.

**Probed:** 2026-10-10 between 02:55 and 03:13 UTC, the evening of 2026-10-09 in local time, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the public spot REST API of C-Patex, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The API is the X-TXC family documented in S1, the same family that CCXT's `p2b` class speaks.
Every probed value comes from [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py), in two full runs, and where the runs differ both values are given.

## 1. Host and latency from this machine

| host | role | resolved address | probed |
|---|---|---|---|
| `api.c-patex.com` | documented public and private API, S1 line 119 | `104.21.2.84`, `172.67.128.237` and two IPv6 addresses, Cloudflare | the first request of each run took 494.5 ms, and the later ones 178 to 228 ms with outliers of 492 to 544 ms, `cf-ray` from the `YVR` colocation |
| `back.c-patex.com` | the web app's API, `/v2/...` and `/marketlist` | same addresses | answers public `/v2/trade/settings`, `/v2/fee-schedule` and `/marketlist` |
| `ws.c-patex.com` | socket, see [`websocket.md`](./websocket.md) | same addresses | HTTP 101 |

Every reply carried `cf-cache-status: DYNAMIC`, so Cloudflare does not cache these calls.
The probe opens a new TLS connection per request, so these times include the handshake, and a kept-alive connection would be faster.
No geoblock or refusal was seen from the Canadian exit.

## 2. Catalog

### The instruments call

`GET https://api.c-patex.com/api/v1/public/markets`, S1 line 353, returned 26 pairs in 2,904 bytes in both runs.

| field | value on the wire |
|---|---|
| `name` | `BTC_USDT`, base and quote joined by an underscore, case as listed (`XAUt_USDT`) |
| `stock`, `money` | base and quote asset |
| `stockPrec`, `moneyPrec`, `feePrec` | 8 on all 26 pairs |
| `minAmount` | `"0.001"` on all 26 pairs |

There is no status field.
Pairs by quote asset: 23 USDT, 2 USDC and 1 BTC.
No pair name contains PERP, SWAP or FUT.

| call | count | agrees with `markets` |
|---|---|---|
| `GET /api/v1/public/tickers` | 26 | yes, same names |
| `GET /api/v1/public/products` | 26 | yes |
| `GET /api/v1/public/symbols` | 26 | yes |
| `GET https://back.c-patex.com/marketlist`, the website's list | 35 | no, it adds 9 pairs that the API does not list, `APEPE_USDT`, `GLOT_USDT`, `ICE_USDT`, `MEW_USDT`, `NPT_USDT`, `VYUG_USDT`, `dBTC_dUSDT`, `dETH_dBTC` and `dETH_dUSDT` |

The public API's 26 pairs are what a feed can use.
14 of the 26 had zero 24 h volume in `tickers` in both runs, and 9 had a zero bid or a zero ask.
The busiest by quote volume were `BTC_USDT` at about 16.9 and 16.4 million USDT, `USDC_USDT` at 13.1 and 12.7 million, and `ETH_USDT` at 8.9 and 8.1 million, in runs 1 and 2.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no C-Patex class, see [`fees.md`](./fees.md) section 8.
There is no `market.id`, `contractSize`, `linear` or `active` to compare.
The REST `name` is identical to the socket's market parameter.

### Size unit, pairs listed twice, and price scale

Sizes are base asset units on REST and on the socket.
No pair is listed twice.
Prices and sizes are decimal strings with up to 8 decimals.

## 3. Anchor

C-Patex publishes no index price, no mark price and no funding rate, because it has no perpetuals.
The only reference prices are the spot `last`, `bid` and `ask` in `GET /api/v1/public/tickers` and the `last` of `price.update` on the socket.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET https://api.c-patex.com/api/v1/public/depth/result?market=BTC_USDT&limit=50`, S1 line 813 |
| reply | `{"asks":[[price,size],...],"bids":[[price,size],...]}` with no timestamp, no sequence and no envelope |
| depth limit | default 50, minimum 1, maximum 1000 as S1 line 824 says. `limit=1000` returned the whole book, 500 asks and 507 or 508 bids. `limit=1001` returned HTTP 400 `{"success": false, "message": {"limit": ["The limit may not be greater than 1000."]}, "result": []}` |
| level order | asks ascending from the best ask. Bids also ascending, so the best bid is the last element |
| documented order | S1 shows bids descending from the best bid, lines 862 and 866, so the documentation and the wire disagree |
| caching | `cache-control: no-cache, no-store, max-age=0, must-revalidate` and `cf-cache-status: DYNAMIC` |
| how often it moves | 10 reads of `BTC_USDT` at limit 20, one a second, gave 1 distinct book in run 1 and 2 in run 2 |
| order level call | `GET /api/v1/public/book?market=BTC_USDT&side=sell&offset=0&limit=5` lists single orders with `id`, `price`, `amount`, `left` and `timestamp`, best first on both sides, and `total` 500 sells and 507 or 508 buys |
| thin books | `PATEX_USDT` 91 asks and 1 bid, `INCA_USDT` 8 asks and 2 bids, in both runs |

The REST top five matched the socket's maintained book and `depth.query` at the end of each socket run, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No rate limit is published in S1.
Ten sequential `tickers` calls at one a second all returned HTTP 200 with no rate limit, `Retry-After` or `X-RateLimit` header.
The only `x-` headers were `x-content-type-options`, `x-xss-protection` and `x-frame-options`.

| case | status | body |
|---|---|---|
| unknown market on `depth/result` | 400 | `{"success": false, "message": "service unavailable", "result": []}` |
| missing market on `depth/result` | 400 | `{"success": false, "message": "Invalid input", "result": []}` |
| `limit=0` | 400 | `{"success": false, "message": {"limit": ["The limit must be at least 1."]}, "result": []}` |
| unknown market on `ticker` | 400 | `{"success": false, "message": {"market": ["Market is not available"]}, "result": []}` |
| `book` without `side` | 400 | `{"success": false, "message": {"side": ["The side field is required."]}, "result": []}` |
| unknown public path | 404 | `{"timestamp": 1791601973579, "status": 404, "error": "Not Found", "message": "", "path": "/api/v1/public/nope"}` |
| private path, GET or unsigned POST | 401 | `{"success": false, "message": "authentication failure", "result": []}` |
| upgrade request to `https://back.c-patex.com/ws` | 200 | `{"response":null,"status":404,"errors":{"message":[""]},...}`, so that path is not a socket |

An unknown market on `depth/result` reports "service unavailable", which a poller must not mistake for an outage.

## 7. Server time and clock offset

S1 documents no REST time call, and `/api/v1/public/time` and `/api/v2/public/time` both return HTTP 404.
The socket's `server.time` returns integer seconds, see [`websocket.md`](./websocket.md) section 5.
The HTTP `Date` header was between 0.77 s behind and 0.08 s ahead of the host's clock over six reads, at one second resolution.

## 8. Recommended poller shape

No anchor poller, because there is no index, mark or funding, see section 3.
If the engine ever adds a spot leg, `GET /api/v1/public/markets` once an hour is the catalog, and `GET /api/v1/public/depth/result?market=<name>&limit=50` is the resync snapshot after a socket close.
Bids must be reversed, or sorted, before use.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | C-Patex API documentation, `https://github.com/PatexGit/api-docs/blob/main/API.md`, last commit `565474b` of 2023-08-04, section "HTTP Protocol API" | documented calls, limits, level order |
| S2 | web bundle served by `https://c-patex.com/`, read 2026-10-09 | `back.c-patex.com` as the web API base, `/marketlist`, `/ws` |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py), modes `latency`, `catalog`, `depth`, `errors` and `rate`, two full runs | every probed value |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/c-patex/ws-probe.py), mode `book` | REST against socket cross-check |
