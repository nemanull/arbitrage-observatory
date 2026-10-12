# Cofinex REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
Cofinex lists perpetuals by its own words and on CoinMarketCap, see [`fees.md`](./fees.md) section 3, but no public call returns a perpetual catalog, book, index, mark or funding rate.
The documented API answers HTTP 502 or an authorization error, and the spot calls the web app makes serve Bitget's spot data through a cache.
This profile records what was checked and what failed.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/cofinex/rest-probe.py), section by section.

## 1. Host and latency from this machine

| host | resolved on 2026-10-09 | role | result |
|---|---|---|---|
| `cofinex.io`, `www.cofinex.io` | four CloudFront addresses, `143.204.1.x` | website, a Next.js app | HTTP 200 |
| `apidocs.cofinex.io` | four CloudFront addresses | Swagger UI over `openapi.json` | HTTP 200 |
| `dataapi.cofinex.io`, `dataapi.cofinex.in` | `34.196.185.226`, `54.211.185.146`, an AWS load balancer in us-east-1 | the documented API | HTTP 502 or an authorization error, section 2 |
| `marketdata.cofinex.io` | `18.213.182.90`, `52.200.148.110`, `52.207.178.117`, another AWS load balancer in us-east-1 | the web app's market data calls, served by `uvicorn` | HTTP 200 |
| `wss1.cofinex.io`, `tradeapi1.cofinex.io`, `auth.cofinex.io` | the same three addresses as `marketdata` | socket, trade API, Keycloak login | socket in [`websocket.md`](./websocket.md) |
| `api.cofinex.io` | no address | | |
| `cofinex.com` | `82.194.68.29` | an unrelated Hostalia placeholder page | |

Cold and warm times from section 3 of the probe, over three runs: 456 to 841 ms for the two large catalog replies and 237 to 452 ms for small replies, with no steady difference between cold and warm.
No geoblock or challenge was seen from this Canadian exit on any host.

## 2. Catalog

### The documented API

The API docs at `https://apidocs.cofinex.io/` load `openapi.json`, version 1.0.0, whose servers are `http://localhost:3972`, `https://auth.cofinex.io` and `https://dataapi.cofinex.io`, section 2.
It tags nine GET paths as Public API, and the catalog, book and trade paths take a `tradeType` of `SPOT` or `FUTURE`.

| documented path, on `dataapi.cofinex.io` and `dataapi.cofinex.in` | result |
|---|---|
| `/marketdata/tickerinfo` | 502 Bad Gateway, `server: awselb/2.0` |
| `/marketdata/tradepairinfo/SPOT` | 502 |
| `/marketdata/tradepairinfo/FUTURE` | 502 |
| `/marketdata/orderbook/FUTURE/BTCUSDT` | 502 |
| `/marketdata/orderbook/SPOT/BTCUSDT` | 502 in the first run, then HTTP 200 with the authorization error below |
| `/marketdata/assetinfo` | HTTP 200 with the authorization error below |

The authorization error is an Express reply wrapping an AWS signature error: `{"status":true,"body":{"message":"Invalid key=value pair (missing equal-sign) in Authorization header (hashed with SHA-256 and encoded with Base64): '...'."}}`.
So no documented market data path returned data to an unauthenticated caller, and the `FUTURE` catalog the docs describe could not be read.
The docs' own `FUTURE` example shows `symbol`, `minLeverage`, `maxLeverage`, `minTradeNum`, `priceEndStep`, `sizeMultiplier`, `makerFeeRate` and `takerFeeRate`, which is the field set of Bitget's USDT-M contracts call, see [`fees.md`](./fees.md) section 2.

### The web app's calls

The web bundle names its hosts in one config object, with `baseUrl` `https://marketdata.cofinex.io`, `dataUrl` `https://dataapi.cofinex.io` and a Bitget proxy `baseAWSUrlBitget` on API Gateway, which the bundle uses for authenticated spot order calls such as `trade/spot/placeOrder`, S1.
Every market data call the bundle makes is a spot call under `marketdata.cofinex.io/spot/v1/`, and no futures call appears in it.

| path on `marketdata.cofinex.io` | reply, section 3 |
|---|---|
| `spot/v1/tradepair` | 550 rows, about 240 KB |
| `spot/v1/summary` | 548 or 549 rows of last, bid, ask and 24 h volume |
| `spot/v1/market/BTC_USDT` | one summary row with `updated_at` |
| `spot/v1/orderbook/{pair}?depth=&level=` | a book, section 5 |
| `spot/v1/trades/{pair}?limit=` | recent trades |
| `spot/v1/quote-currencies` | 11 quote currencies |

Each `tradepair` row is `{"symbol", "exchange", "data"}`, where `exchange` is `bitget` on 542 rows and `cofinex` on 8, and `data.source` is `bitget_spot_pair_info_job` or `cofinex_spot_pair_info_job`.
Status is `online` on 548 rows and `halt` on 2 Bitget rows, no symbol is listed twice, and the quotes are USDT 494, USDC 29, EUR 11, BRL 4, BTC 3, USD 3, ETH 2, and one each of SOL, VND, U and INR.
The 8 Cofinex rows are SAIZUSDT, CNXUSDT, AIVOUSDT, USDTINR, YOUSDT, UNICUSDT, MTCUSDT and IMEXUSDT.

### Perpetuals

| tried | result, section 4 |
|---|---|
| `future/v1/tradepair`, `futures/v1/tradepair`, `future/v1/summary`, `futures/v1/summary`, `contract/v1/summary`, `perpetual/v1/summary` on `marketdata` | 404 `{"code":"404","msg":"Not Found",...}` |
| `marketdata/tradepairinfo/FUTURE` on `marketdata` | 404 |
| `spot/v1/tradepair?productType=FUTURE` | the same 550 spot rows |
| `https://cofinex.io/trade/UMCBL/ETH-USDT`, CoinMarketCap's market URL | HTTP 200 carrying the site's not found page |
| `https://cofinex.io/en/futures`, `https://cofinex.io/en/market/futures/BTC-USDT` | HTTP 200 carrying the not found page |

The active perpetual count, the symbol spelling, the contract size and the status values are Not verified.
CoinMarketCap reports 729 perpetual pairs with ticker ids such as `ETH-PERPUSDT`, section 7, and that is the only count available.
There is no CCXT class to map, see [`fees.md`](./fees.md) section 8.

## 3. Anchor

No Cofinex call returns an index price, a mark price, a funding rate, a funding interval or a next settlement time.
CoinMarketCap's perpetual rows carry `indexPrice` and `fundingRate`, for example 2,491.44 and 0.0001 on ETH/USDT, section 7, but CoinMarketCap does not publish where it reads them, and no Cofinex endpoint that serves them was found.

## 4. Anchor semantics

Not publicly specified.
No Cofinex page defines an index, a mark price or a funding formula, and the announcement blog has no post about funding, see [`fees.md`](./fees.md) section 4.

## 5. REST book snapshot

There is no perpetual book call.
The spot call is `GET https://marketdata.cofinex.io/spot/v1/orderbook/{pair}?depth={n}&level={m}`, and the web app's order book panel sends `depth=20&level=3` with a pair spelled `BTC_USDT`, S1.
The reply is `{"code":"200","msg":"success","data":{"bids":[[price, size], ...],"asks":[...],"timestamp":ms}}`, with prices and sizes as strings, bids descending and asks ascending, section 3.

| `depth` | levels per side for `BTC_USDT` | levels per side for `BTCUSDT` |
|---|---|---|
| 5 | 2 | 2 |
| 10 | 5 | 5 |
| 20 | 10 | 10 |
| 50 | 20 | 25 |
| 200 | 20 | 100 |
| 500 | 20 | 150 |
| omitted | 20 | 150 |

So a reply holds half the requested depth, capped at 20 or 150 depending on the spelling, and `level` changed nothing seen.
The book is cached, and the cache is minutes old.
Over twelve polls 5 s apart, each spelling returned one single `timestamp` in every run, section 5.
In run 2 the `BTC_USDT` book was 1,526 to 1,591 s old while the `BTCUSDT` book was 118 to 183 s old.
The cached `BTCUSDT` entry dates from this probe's own first request for that spelling, and it was still the same entry 656 s later in run 3.
The `BTC_USDT` entry had been replaced by run 3, about six minutes after run 2, and was then 21 to 97 s old.
So an entry is filled on first request and replaced only after many minutes, and the refresh rule is Not verified.
The trades call behaves the same way: the first `BTC_USDT` trade kept timestamp `1791600114022` for over ten minutes, while an `ETHUSDT` trades call made for the first time returned trades seconds old.
The `market` row refreshes about every 30 s, and its bid and ask always equalled a Bitget BTCUSDT top of book read in the previous 30 s, section 5.
An unknown pair returns HTTP 200 with empty sides on the book and trades calls, and HTTP 404 `{"code":"404","msg":"error","data":{"error":"not found: NOTACOIN_USDT"}}` on the market call, section 6.

## 6. Rate limits and errors

No limit is published, and no reply carries a rate limit or `Retry-After` header, section 6.
Ten sequential requests in 2.5 to 2.6 s all returned HTTP 200.
Unknown paths return HTTP 404 `{"code":"404","msg":"Not Found","data":{"error":"Not Found"}}`.

## 7. Server time

No server time call exists.
The `Date` header read between 0 and 0.81 s behind the local midpoint of each request over three runs, at whole second resolution, section 6.
Book frames on the socket carry a millisecond `ts`, see [`websocket.md`](./websocket.md) section 4.

## 8. Recommended poller shape

None.
There is no public perpetual catalog, book or anchor call, so neither the catalog nor the anchor poller can be built.
The spot calls are not a usable substitute even for a spot leg, because the book and trade replies come from a cache that is minutes old.
Every price the venue publishes is Bitget's, and the engine can read Bitget directly, see [`../bitget/rest.md`](../bitget/rest.md).

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Cofinex web bundle chunks under `https://www.cofinex.io/_next/static/chunks/`: `40jcj_2q29__k.js` for the host config, `0eyir2ndv8c9h.js` for the request helpers, `25lii85bvbi7b.js` for the spot calls and `07853l6kp2pdm.js` for the order book panel, with `0ivsr87lrf6tq.js` for the spot order calls | 2026-10-09 |
| S2 | [Cofinex API docs](https://apidocs.cofinex.io/) and [`openapi.json`](https://apidocs.cofinex.io/openapi.json) | 2026-10-09 |
| S3 | [CoinMarketCap market pairs, perpetual](https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=cofinex&category=perpetual&start=1&limit=200) | 2026-10-09 |
| S4 | [Bitget spot order book](https://api.bitget.com/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=15), used as the comparison in section 5 | 2026-10-09 |
