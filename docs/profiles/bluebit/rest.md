# BlueBit REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:18 to 04:50 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

BlueBit lists no live perpetual, see [`fees.md`](./fees.md) section 3, so this profile covers the public spot REST API, as change 1 of the survey plan's template says.
The API is ChainUP's older `open/api` family, documented in the venue's API document, S1.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/bluebit/rest-probe.py), run three times.
The figures below give runs 1 and 2 where they differ, and run 3 added one call, the upper case ticker in section 6, and otherwise showed the same behaviour.

## 1. Host and latency from this machine

### Hosts

| host | role | resolved |
|---|---|---|
| `openapi.bluebit.io` | spot REST, "The root URL for REST access", S1 | `52.74.184.139` |
| `www.bluebit.io` | website, `fePublicInfo` and the `/fe-ex-api/` calls of the web app | `52.74.184.139` |
| `ws.bluebit.io` | spot WebSocket | `52.74.184.139` |
| `futures.bluebit.io` | futures web shell and its `/fe-co-api/` calls, `coUrl` in `fePublicInfo` | `52.74.184.139` |
| `futuresopenapi.bluebit.io` | the ChainUP futures open API name | `52.74.184.139` |
| `futuresws.bluebit.io` | the ChainUP futures socket name, see [`websocket.md`](./websocket.md) section 1 | `52.74.184.139`, from [`futures-ws-probe.py`](../../../scripts/probes/venues/bluebit/futures-ws-probe.py) |
| `api.bluebit.io`, `fapi.bluebit.io` | guessed names | no address |

Every host resolves to the one address `52.74.184.139`, and the `get_ticker` replies named `nginx/1.20.1` as their server.
`openapi.bluebit.io/exchange-open-api`, the `open_api_url` of the web config, served `common/symbols` with a body identical to the bare path in run 2.

### Access, from the Canadian VPN exit

Every spot call answered HTTP 200 with no challenge, cookie or geoblock.
Every futures data call answered HTTP 502, section 3.

### Latency

Three `get_ticker` calls, each on a new TLS connection, took 799, 757 and 776 ms in run 1 and 758, 784 and 785 ms in run 2.
On one kept-alive connection the first call took 761 and 812 ms, and the next four took 189 to 196 ms and 197 to 201 ms.
So about 190 to 200 ms is the round trip to the server, and the rest of a cold call is connection and TLS setup.

## 2. Catalog

### The instruments call

`GET https://openapi.bluebit.io/open/api/common/symbols` returned 20 symbols in 2,589 bytes, in 759 ms in run 1 and 769 ms in run 2, S1 "All Transaction Pairs and Accuracy Supported by Query System".

| field | example | meaning |
|---|---|---|
| `symbol` | `btcusdt` | lower case base and quote joined, the id the socket uses |
| `base_coin`, `count_coin` | `BTC`, `USDT` | base and quote |
| `price_precision`, `amount_precision` | 2, 5 | decimals |
| `limit_volume_min` | `"0.00001"` | minimum order size in base currency |

All 20 symbols are quoted in USDT.
The call has no status field, so every listed symbol is taken as trading.
The website's own list, `market.market` in `https://www.bluebit.io/fePublicInfo`, holds the same 20 symbols, S2.
They are BLUESPARROW, BTC, ETH, XRP, BNB, SOL, USDC, DOGE, TRX, ADA, LINK, BCH, TON, SHIB, LTC, PEPE, UNI, AAVE, POL and XAUT, all against USDT.

### How CCXT maps it

CCXT has no BlueBit class, see [`fees.md`](./fees.md) section 8.
A catalog would come from this call directly.

### Ids, size unit, and price scale

The `symbol` field equals the socket's symbol, so `rawMarketId` would match without a map.
Sizes are base currency on both the catalog and the socket.
No pair is listed twice, and no pair needs a price scale.

## 3. Anchor

BlueBit publishes no index, mark or funding for any spot pair, and no anchor poller is recommended.

The futures surfaces that would carry them all fail from this host.

| call | run 1 | run 2 |
|---|---|---|
| `GET https://futuresopenapi.bluebit.io/fapi/v1/contracts` | 502, 3,693 bytes of HTML, title "The page is temporarily unavailable", 3,743 ms | 502, same page, 3,833 ms |
| `GET https://futuresopenapi.bluebit.io/fapi/v1/ticker?contractName=E-BTC-USDT` | 502, same page, 2,006 ms | 502, 2,007 ms |
| `GET https://futuresopenapi.bluebit.io/fapi/v1/index?contractName=E-BTC-USDT` | 502, same page, 2,012 ms | 502, 2,010 ms |
| `POST https://futures.bluebit.io/fe-co-api/common/public_info` | 502, same page, 2,002 ms | 502, 2,007 ms |
| `POST https://futures.bluebit.io/fe-co-api/common/public_market_info` | 502, same page, 2,011 ms | 502, 1,999 ms |
| `GET https://futures.bluebit.io/fe-co-api/common/getMakerAndTaker` | 502, same page, 2,002 ms | 502, 2,012 ms |
| `GET https://futures.bluebit.io/en_US/` | 200, the web shell of 37,085 bytes, 938 ms | 200, 1,007 ms |

The `/fe-co-api/common/public_info` path and the `getMakerAndTaker` URL are the ones the web app itself calls, read from its bundles, S3.
The `/fapi/v1/` paths are the futures open API that the server's ChainUP adapter calls on FameEX, x.me and Koinbay, S4, and BlueBit's own document does not list them, S1.
The 502 pages arrive after about 2 s, and 3.7 to 3.8 s for the first call of a run, which looks like an nginx upstream timeout.
`POST https://www.bluebit.io/fe-ex-api/common/public_info` returns `"contractOpen":"0"`, the web config's futures switch, set off, S2.
So the futures product is switched off, and not merely slow.

Two spot reference prices are published, and neither is an index.

| call | content | run 1 | run 2 |
|---|---|---|---|
| `GET /open/api/market` | last trade price per symbol, one map of 20 entries | 663 bytes, 777 ms | 663 bytes, 790 ms |
| `GET /open/api/get_allticker` | 24 hour ticker for every symbol, with `buy`, `sell`, `last`, `vol` and a server `date` in ms | 20 rows, 4,209 bytes, 809 ms | 20 rows, 4,216 bytes, 805 ms |

## 4. Anchor semantics

Not applicable, because there is no index, mark or funding.

The ticker's `buy` and `sell` are the socket book's top.
In run 2 of the socket probe, `get_ticker` read right after the last book frame gave the same bid and ask, see [`websocket.md`](./websocket.md) section 4.
`get_allticker` gave BTC/USDT `buy` 81,866.78 and `sell` 83,338.37 in run 1, a spread of 17,815 ppm, and 81,664.38 and 83,140.09 in run 2, a spread of 17,909 ppm.
Over 20 polls of `get_ticker` at about one per second, `time` took 4 distinct values in run 1 and 5 in run 2, `last` changed twice and then not at all, and `buy` or `sell` changed twice in each run.

## 5. REST book snapshot

The documented call is `GET /open/api/market_dept?symbol=<symbol>&type=step0`, with `step0` to `step2` for merged depth, S1.
It returns no book from this host.

| request | reply |
|---|---|
| `market_dept?symbol=btcusdt&type=step0` | `{"code":"1","msg":null,"data":null,"message":null}` |
| `market_dept?symbol=BTCUSDT&type=step0` | `{"code":"0","msg":"suc","data":{"tick":null},"message":null}` |
| `market_dept?symbol=ETHUSDT&type=step1` | `{"code":"0","msg":"suc","data":{"tick":null},"message":null}` |
| `market_dept?symbol=btcusdt` | `{"code":"1",...}` |

Lower case, the spelling of the catalog, is an error, and upper case succeeds with an empty `tick`.
So a feed cannot seed or check a book over REST, and the socket is the only book source.

`get_allticker` lacked `buy` and `sell` on `tonusdt`, the pair whose socket book was one-sided.

`GET /open/api/get_trades?symbol=btcusdt` returned 200 trades in each run, 149 buys and 51 sells in run 1 and 142 and 58 in run 2, with a median gap of 11.0 s and the five smallest sizes between 0.02237 and 0.02241 BTC.
The near-constant size and the regular gap look like an automated trader.

## 6. Rate limits and errors

The published public limit is "up to 6 requests every 2s" per IP, with HTTP 429 when it is exceeded, S1 "Rate Limits".
The probe stays at one request per second and met no 429.
No reply carried a rate limit or `Retry-After` header.

| request | status | body |
|---|---|---|
| `get_ticker?symbol=nosuchusdt` | 200 | `{"code":"1","msg":null,"data":null,"message":null}` |
| `get_ticker` without a symbol | 200 | the same |
| `/open/api/nosuch` | 404 | Spring Boot JSON, `{"timestamp":...,"status":404,"error":"Not Found",...}` |
| `/sapi/v1/symbols`, the newer ChainUP family | 404 | the same shape |

An application error is HTTP 200 with `code` other than `"0"`, so a client must check `code`.
`get_ticker` accepts both `btcusdt` and `BTCUSDT`, the second checked in run 3.

## 7. Server time and clock offset

No time call exists.
`/open/api/common/timestamp` and `/sapi/v1/time` both answered 404.
The `date` field of `get_allticker` read 290 to 374 ms ahead of the local midpoint of each request in run 1 and 289 to 302 ms in run 2, with the local clock synchronised by NTP.
That gap is the server's clock offset plus whatever delay sits between stamping and sending.

## 8. Recommended poller shape

No anchor poller is recommended, because BlueBit publishes no index, mark or funding and its futures product is switched off.
If BlueBit's futures return, `https://futuresopenapi.bluebit.io/fapi/v1` would be the place to look for a catalog and an anchor, as on the other ChainUP members, S4.
If a spot leg is added later, `GET /open/api/common/symbols` once at start is the catalog, and the socket is the only book source.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | BlueBit API document, `https://github.com/bluebitltd/bluebitfile/blob/main/api_doc_en.md`, sections "Request Process", "Rate Limits", "Get all trading pairs quotations on the market", "Search the depth of buying and selling" and "All Transaction Pairs and Accuracy Supported by Query System", last commit `81e6c9f` of 2023-10-08 | 2026-10-09 |
| S2 | `https://www.bluebit.io/fePublicInfo` and `POST https://www.bluebit.io/fe-ex-api/common/public_info`, the web app's config | 2026-10-09 |
| S3 | the web app bundles of `https://futures.bluebit.io/`, entry `/js/co-index.c648b38f.js` and its chunks, for the `/fe-co-api/` paths | 2026-10-09 |
| S4 | [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 1 to 3 and 101 to 162, the ChainUP futures family and the `futuresopenapi` hosts of FameEX, x.me and Koinbay | 2026-10-09 |
