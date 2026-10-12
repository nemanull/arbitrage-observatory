# EasiCoin REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time (2026-10-10 02:23 to 02:37 UTC), two runs of every probe mode, from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocates to Vancouver, Canada.

EasiCoin documents no public REST API.
Its home page says to "contact support@Easicoin.finance to enable API access", R1, and the help center has no API section, see [`fees.md`](./fees.md) S12.
The calls below are the ones the www.easicoin.io web app makes for an anonymous visitor, found in its script bundles, R2 and R3, and every number was captured by [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) or [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py).
The terms forbid "unauthorized data scraping, extraction, or mining", see [`fees.md`](./fees.md) section 1, so these calls are described for the record and no poller is recommended.
The web app is the platform YUBIT runs, see [`../yubit/rest.md`](../yubit/rest.md).

## 1. Host and latency from this machine

| host | resolved | answer from this host |
|---|---|---|
| `www.easicoin.io` | 104.21.75.46 and 172.67.213.194, Cloudflare | pages and every `/mapi/` call below answered 200, P2 |
| `easicoin.io` | the same Cloudflare addresses | 301 to `https://www.easicoin.io/`, P2 |
| `api.easicoin.io` | 43.169.32.244, APISIX 3.12.0 | `/` answered 404 `{"message":"404 Not Found"}`, and `/mapi/trade/public/v1/market/dynamic_symbol`, `/v5/market/time` and `/api/v1/time` answered 503 `Service Temporarily Unavailable`, P2 |
| `openapi.easicoin.io` and `ws2.easicoin.io` | do not resolve | P1 |
| `www.easicoin.com` | not resolved by the probe | 200 with a 425 byte page, which on a manual read was a "This domain may be for sale" frame and not the exchange, P2 |

`GET /mapi/user/public/v1/country-code` answered `{"area_code":"1","country":"CA"}`, and the newer `GET /mapi/user/public/v3/country-code` answered `{"area_code":"86","country":"CN"}` from the same host, P2.
Neither refused anything.

| call | cold, new connection | warm |
|---|---|---|
| `GET /mapi/trade/public/v1/market/dynamic_symbol`, 749,433 bytes, Cloudflare `HIT`, `cache-control: max-age=60` | 207 and 229 ms | median 56 and 32 ms over five reads |
| `GET /mapi/spot/public/v1/quote/market/tickers`, not cached | | 155 to 594 ms over ten reads |

## 2. Catalog

### The instruments call

`GET https://www.easicoin.io/mapi/trade/public/v1/market/dynamic_symbol`, no parameters, R2, P1.
The reply is `{"code":0,"message":"success","data":{...}}`, whose `data` holds one list per family.

| family key | rows on 2026-10-10 UTC | status |
|---|---|---|
| `LinearPerpetual` | 413, all quoted in USDT | 413 `contractStatus` `Trading`, `symbolStatus` 0 and `symbolDisplay` 1 |
| `InversePerpetual`, `InverseFutures`, `StockRwaPerpetual`, `MetalRwaPerpetual` | 0 each | |
| `FreeUPerpetual` | 6, quoted in the demo coin USDX | `Trading`, not tradable for money |
| `BlockTradePerpetual` | 4, `XAUUSD`, `XAGUSD`, `UKOUSD`, `USOUSD`, quoted in USD | `Trading`, contract sizes 1000, 1000, 100 and 2500 |
| `OfflineSymbols` | one closed contract, `MKRUSDT` | `Closed` |

The `LinearPerpetual` list splits by `symbolCategory` into 239 `crypto`, 169 `stock` and 5 `gold` rows, the last being `XAUUSDT`, `XAGUSDT`, `XPDUSDT`, `XPTUSDT` and `COPPERUSDT`, P1.
Each row carries 67 fields, among them `symbolName`, `baseCurrency`, `quoteCurrency`, `contractStatus`, `lotSize`, `tickSize`, `contractSize`, `indexSource`, `priceLimitPntE6` and the fee fields of [`fees.md`](./fees.md) section 2.

### Mapping to what the engine needs

| engine field | catalog field | finding |
|---|---|---|
| `rawMarketId` | `symbolName` | `BTCUSDT`. It equals `baseCurrency` plus `quoteCurrency` and `symbolAlias` on 413 of 413 rows. It is the topic suffix on the socket, the `s` of every `tickers.all` row and the `symbol` parameter of the funding and mark history calls, P1 and [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | `baseCurrency`, `quoteCurrency` | `BTC` and `USDT` |
| `linear` | `contractType` | `LinearPerpetual` on all 413 |
| `active` | `contractStatus` | `Trading` on all 413 |
| `contractSize` | `contractSize` | `"0"` on all 413 USDT-M rows, and the socket sizes are in the base coin, so a contract size of 1 is right. The engine already turns a non-positive size into 1 |

### Pairs listed twice, price scale and odd rows

No base is listed twice in `LinearPerpetual`, P1.
Seven names carry a multiplier and would need a price scale against venues that list the plain token: `1000SHIBUSDT`, `1000PEPEUSDT`, `1000BONKUSDT`, `1000CATUSDT`, `1000FLOKIUSDT`, `1000LUNCUSDT` and `1000000MOGUSDT`, P1.
The socket's `tickers.all` carried 435 rows: the 413 catalog contracts, the 6 USDX demo and 4 block trade contracts, and 12 symbols absent from the catalog, such as `HK0625USDT`, `NVDLUSDT` and `TSLLUSDT`, in the second run, P4.
A reader would filter to the catalog.

## 3. Anchor

### The bulk calls

There is no REST call that returns index, mark and funding for every contract.

| candidate | result |
|---|---|
| `GET /mapi/trade/public/v1/market/` with `tickers`, `ticker`, `instruments`, `funding-rate`, `premium-index`, `orderbook` or `depth` | 404 with an empty body, P3 |
| `GET /mapi/trade/public/v1/market/funding-rate-history?symbol=<symbolName>` | settled rates for one contract, 100 rows, 161 to 200 ms. Without `symbol` it answers HTTP 200 with `{"code":14110001,"message":"field \"symbol\" is not set"}`, P3 |
| `GET /mapi/trade/public/v1/market/mark-price-list?symbol=BTCUSDT&resolution=1` | one minute mark candles for one contract, 1,000 rows, about 82,250 bytes, 458 and 466 ms, P3 |
| socket `tickers.all` | every contract in one frame every 3.0 s, 435 rows and about 120,900 bytes, with `mp` (mark) and `ip` (index) and no funding fields, P4 |
| socket `tickers-100.<symbolName>` | one contract per topic, with `mp`, `ip`, `fr`, `pf`, `nh` and `ft`, [`websocket.md`](./websocket.md) section 2 |

### Row mapping, if the socket were used

| source | index | mark | funding rate | interval | next settlement | scope |
|---|---|---|---|---|---|---|
| socket `tickers.all` | `ip` | `mp` | absent | absent | absent | every contract, every 3 s |
| socket `tickers-100.<symbolName>` | `ip` | `mp` | `fr`, scaled by 1e6 | `nh`, hours | `ft`, ISO UTC string | one contract per topic |

The engine's anchor is a REST bulk poll, and EasiCoin has no REST bulk anchor call.
Index and mark come in bulk only over the undocumented socket topic `tickers.all`, and funding needs one socket topic per contract.

## 4. Anchor semantics

### Index

The help center says only that funding uses the "Spot Index Price", see [`fees.md`](./fees.md) S4, and publishes no basket or weights.
The catalog's `indexSource` names the sources per contract, P1.

| sources per contract | contracts | detail |
|---|---|---|
| 1 | 179 | `BinanceFuture` on 177, which are all 169 stock contracts, all 5 metal contracts and 3 crypto contracts, and `Binance` on 2 crypto contracts |
| 2 to 6 | 234, all crypto | `BTCUSDT`, `ETHUSDT`, `SOLUSDT` and `DOGEUSDT` list `Binance`, `GateIO`, `KuCoin`, `Mexc` and `OkEx` |

No contract lists EasiCoin itself.
By its name `BinanceFuture` is another venue's perpetual and not spot, so 177 index baskets are a single foreign perpetual price.

### Mark

The mark price "aggregates price information from multiple sources to form a more stable and reliable price indicator", with no published formula or clamp, see [`fees.md`](./fees.md) S5.
On the captured `BTCUSDT` ticker snapshot, `mp` was 82592.6 and `ip` was 82632.3, about 480 ppm below the index, P1 of [`websocket.md`](./websocket.md).
Every contract carries `priceLimitPntE6` `"50000"`, an order price band of 5 %, P1.

### Funding

The formula and its unpublished clamp are in [`fees.md`](./fees.md) section 6.
On the socket, `fr` and `pf` are integers scaled by 1e6: `"fr":100` is 0.01 %, and `nh` 8 and `ft` `2026-10-10T08:00:00Z` give the interval and next settlement on `BTCUSDT`, [`websocket.md`](./websocket.md) section 6.
`funding-rate-history` gives settled rates as `valueE8`, where `10000` is 0.01 %, and its newest row on all four contracts tried was 2026-10-10 00:00 UTC, P3.
It returned 100 rows at 8 h spacing for a three day `from` and `to` window, so the window is ignored.
Whether `fr` is the rate for the coming settlement or the last settled one is Not verified, because no settlement instant was captured.

### How often each number changed

Over 30 s of `tickers.all`, 11 frames and 10 transitions per contract, P4:

| contract | mark changes | index changes | last price changes |
|---|---|---|---|
| `BTCUSDT` | 6 and 4 | 0 and 4 | 10 and 9 |
| `ETHUSDT` | 9 and 8 | 4 and 5 | 7 and 6 |
| `SOLUSDT` | 4 and 2 | 3 and 4 | 4 and 5 |

The 3 s frame period is inside the engine's 10 s bound on an anchor reading, `ANCHOR_MAX_AGE_MS` in [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) line 5.

## 5. REST book snapshot

No perpetual REST book call was found.
`/mapi/trade/public/v1/market/orderbook`, `/depth` and `/orderBook/L2` with `symbol=BTCUSDT` answered 404 with an empty body, P5.
The spot book is `GET /mapi/spot/public/v1/quote/depth?symbol=301.BTCUSDT`, where `301` is the spot catalog's `exchangeId`, and it answered `{"code":200,...,"data":[{"e":301,"s":"BTCUSDT",...,"b":[...]}]}`, P5.
The same call with `symbol=BTCUSDT` answered `"data":[]`.
The socket's `ob_depth` frames are full snapshots, so a REST snapshot is not needed for a feed, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No rate limit is published, and no reply carried a limit, quota or `Retry-After` header, P6.
The response headers were `alt-svc`, `cache-control`, `cf-cache-status`, `cf-ray`, `content-type`, `date`, `last-modified`, `nel`, `report-to`, `server`, `timenow`, `traceid` and the transfer headers, P6.
No call was refused in two runs at pauses of 300 ms or more.

| case | reply |
|---|---|
| unknown path under `/mapi/` | HTTP 404, empty body |
| missing parameter | HTTP 200, `{"code":14110001,"message":"field \"symbol\" is not set"}` |
| unknown path on `api.easicoin.io` | HTTP 503, an HTML `Service Temporarily Unavailable` page |

## 7. Server time and clock offset

No time call was found.
The spot tickers reply carries `time` in Unix milliseconds, and every reply carries a `timenow` header, P6.
Over ten reads the offset of `time` from the local midpoint had a median of 4 and 7 ms, with round trips of 157 to 251 ms, P6.

## 8. Recommended poller shape

No poller is recommended, and EasiCoin should not join the engine in its current shape.

- No public API is documented, and API access is granted by support on request, R1.
- No CCXT class exists in 4.5.68 or on master, see [`fees.md`](./fees.md) section 8.
- The terms forbid unauthorized scraping and the user agreement forbids bots, see [`fees.md`](./fees.md) section 1.
- No REST call returns index, mark and funding in bulk, section 3.
- 177 of 413 contracts take their index from one source named `BinanceFuture`, section 4.

If EasiCoin documents these calls or grants written consent, a catalog would read `dynamic_symbol` and keep `LinearPerpetual` rows with `contractStatus` `Trading`.
The anchor would then need a socket reader of `tickers.all` for index and mark, plus either one `tickers-100.<symbolName>` topic per contract or a per contract REST call for funding.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| R1 | EasiCoin home page, API card text | https://www.easicoin.io/en-US | 2026-10-09 | EasiCoin, global | API access enabled by support, intro and section 8 |
| R2 | EasiCoin home page bundles: `API_HOST` `/mapi`, `dynamic_symbol`, spot ticker and quote token paths | `https://www.easicoin.io/_next/static/chunks/633-f1736998207d3ee8.js` and `https://www.easicoin.io/_next/static/chunks/pages/index-ee27e8d11cf0b9c2.js` | 2026-10-09 | EasiCoin, global | call paths, sections 1 and 2 |
| R3 | EasiCoin futures web app bundles | `https://www.easicoin.io/trade/usdt/static/js/main~6709df1a.c0d2d71c.chunk.js` and `https://www.easicoin.io/trade/usdt/static/js/main~991f4369.76a95a23.chunk.js` | 2026-10-09 | EasiCoin, global | socket host and ticker field names, section 3 |
| P1 | `rest-probe.py catalog` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | DNS, catalog latency, families, mapping, index sources, sections 1, 2 and 4 |
| P2 | `rest-probe.py access` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | host status codes and region answers, section 1 |
| P3 | `rest-probe.py anchor` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | funding and mark history, bulk guesses, sections 3 and 4 |
| P4 | `ws-probe.py tickers` | [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | `tickers.all` rows, fields and change counts, sections 2 to 4 |
| P5 | `rest-probe.py book` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | REST book guesses, section 5 |
| P6 | `rest-probe.py time` | [`rest-probe.py`](../../../scripts/probes/venues/easicoin/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | headers, clock offset, sections 6 and 7 |
