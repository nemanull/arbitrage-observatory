# StakeCube REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:14 to 05:28 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

StakeCube lists no perpetuals, so this profile covers its spot catalog and its REST book, as change 1 of the survey plan's template says.
The public API at `https://stakecube.io/api/v2` answered every call from the Canadian exit without a key.
It publishes no index, mark or funding, and no anchor poller is recommended.
Probed values come from [`rest-probe.py`](../../../scripts/probes/venues/stakecube/rest-probe.py) unless a source id says otherwise.

## 1. Host and latency from this machine

### Where the API lives

| item | value | evidence |
|---|---|---|
| API base | `https://stakecube.io/api/v2` | S1 |
| API host index | `https://stakecube.io/` answers HTTP 200 with two lines, "stakecube.net api" and a link to the docs repository | `rest-probe.py host` |
| server | `nginx/1.24.0 (Ubuntu)`, no CDN in front | `rest-probe.py host` |
| web site | `stakecube.net`, behind Cloudflare | `rest-probe.py host`, `ws-probe.py webapp` |

### Access, from the Canadian VPN exit

Every documented public call answered HTTP 200 with JSON and no key.
The web app pages `https://stakecube.net/app/exchange/` and `https://stakecube.net/app/system/fees` answered HTTP 403 with `cf-mitigated: challenge` and a "Just a moment..." page, while the marketing pages answered 200, see [`fees.md`](./fees.md) section 1.
No geoblock was met.

### Resolution

`stakecube.io` resolved to the single address 172.99.188.17.
`stakecube.net` resolved to three Cloudflare IPv4 addresses, 104.26.12.195, 104.26.13.195 and 172.67.74.250, and three IPv6 addresses.

### Latency

On one kept connection, four calls of `GET /exchange/spot/orderbook?market=SCC_BTC` took 589 and 649 ms cold over two runs, and 278 to 299 ms warm.
A call on a new connection took 587 to 848 ms, and the full catalog, 108,732 bytes, took 1,075 and 1,078 ms.
Every reply carries `executionTime`, which read 0.13 to 0.20 s in the probe's replies, so about half of a warm request is server time.

## 2. Catalog

### The instruments call

`GET /exchange/spot/markets` returns every pair at once, keyed by pair name, S1.
Optional filters are `market`, `baseMarket`, `category`, `orderBy`, `orderData` and `priceHistory`, S1.

| item | value |
|---|---|
| pairs | 300 |
| `state` values | `ACTIVE` 300 |
| pairs by quote coin, the `baseMarket` field | BTC 89, SCC 85, USDT 61, DOGE 37, LTC 24, USDT-BSC 3, DASH 1 |
| pairs with nonzero `volumeBase24h` | 84: SCC 47, USDT 18, BTC 7, DOGE 7, LTC 4, DASH 1 |
| largest 24 h quote volume | `DASH_SCC` 50,053 SCC, then `RDD_SCC` 35,466 SCC and `NMNSC_SCC` 17,698 SCC |
| `BTC_USDT` | last 88,900, 24 h volume 12.24 USDT and 0.0001429 BTC |
| fields | `baseMarket`, `baseMinDecimal`, `change24h`, `high24h`, `highlighted`, `lastPrice`, `low24h`, `priceHistory5days`, `state`, `tradeMarket`, `tradeMinDecimal`, `volumeBase24h`, `volumeTrade24h` |

StakeCube's naming is inverted against CCXT's.
`baseMarket` is the quote coin and `tradeMarket` is the base coin, so `SCC_BTC` has `tradeMarket` SCC and `baseMarket` BTC.
The pair key is `TRADE_BASE` in upper case, and four keys differ from their fields in case only: `SDBTC_BTC`, `SDDASH_DASH`, `SDDOGE_DOGE` and `SDLTC_LTC` carry `tradeMarket` `sdBTC`, `sdDASH`, `sdDOGE` and `sdLTC`.
`baseMinDecimal` and `tradeMinDecimal` are the price and amount precisions, 8 and 3 on `SCC_BTC`.
CoinMarketCap lists 94 spot pairs for the venue, close to the 84 with volume, see [`fees.md`](./fees.md) section 3.

### How CCXT maps it

It does not.
CCXT 4.5.68 and the current CCXT master have no StakeCube class, see [`fees.md`](./fees.md) section 8.
A catalog would be hand-built from this call, with `rawMarketId` the pair key exactly as the book call takes it.

### Size unit, pairs listed twice, and price scale

`amount` in the book and the trades is in the traded coin, the `tradeMarket`, S1.
No pair is listed twice, and there is no contract size.
USDT and USDT-BSC are separate quote coins with separate pairs.

## 3. Anchor

Not offered.
StakeCube lists no perpetual, so it publishes no index, no mark and no funding.
The one reference price it publishes is `GET /exchange/spot/arbitrageInfo?ticker=DASH`, which returns 100 rows in CoinGecko's ticker shape for other venues, with `trust_score`, `converted_last` and `trade_url`.
Every row is stale: the oldest `timestamp` is 2025-01-11T13:36:58Z and the newest 2025-01-13T21:15:43Z, nearly 21 months before the probe.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

### The call

`GET /exchange/spot/orderbook?market=SCC_BTC`, with an optional `side` of `BUY` or `SELL`, S1.
The reply is `{"success":true,"result":{"bids":[...],"asks":[...]},"error":"","timestamp":...,"timestampConverted":...,"executionTime":...}`, and each level is `{"price":"...","amount":"..."}` in decimal strings.

| market | bids | asks | best bid | best ask | bytes |
|---|---|---|---|---|---|
| `SCC_BTC` | 2 | 269 | 0.00000002 | 0.00000004 | 10,909 to 10,910 |
| `DASH_SCC` | 708 | 163 | 18,500.02 | 19,000 | 32,246 to 32,247 |
| `BTC_USDT` | 124 | 81 | 84,656.8484 | 88,900 | 8,318 to 8,319 |

`side=BUY` on `DASH_SCC` returned 708 bids and an empty `asks`.
`GET /exchange/spot/markets?orderData=true&market=DASH_SCC` returned `bestBid` 18500.02000000 and `bestAsk` 19000.00000000, equal to the book's top, with empty `bids` and `asks` arrays.

### Depth limits

There is no depth parameter, and every call returned every resting level, from 2 to 708 per side.

### Level order and values

Bids arrive from the highest price to the lowest, best first.
Asks also arrive from the highest price to the lowest, so the best ask is the last element, `19000` after `2200000` on `DASH_SCC`.
No price repeated within a side, and no book was crossed.
Books are thin and wide: the `BTC_USDT` spread was 4,243 USDT, about 5 % of the bid, and its 24 h volume was 12.24 USDT.

### Caching

Every reply carried `Cache-Control: no-store`.
Fifteen polls of the `DASH_SCC` book 2 s apart over 40 s returned 15 distinct `timestamp` values and 0 changes to the top of book, in each of two runs, so the replies are fresh and the market was idle.

## 6. Rate limits and errors

`GET /system/rateLimits` publishes three request weight limits, S1:

| interval | limit |
|---|---|
| 10 s | 20 |
| 1 minute | 1,200 |
| 1 day | 100,000 |

Each reply reports the caller's use in `x-mbx-used-weight-10s`, `x-mbx-used-weight-1m` and `x-mbx-used-weight-1d`, and every call the probe made weighed 1.
The docs promise "temporary penalties" past a limit, S1, and the status code, any `Retry-After` and the penalty length are Not publicly specified and were not provoked.

| case | status | body |
|---|---|---|
| unknown market `NOPE_BTC` | 200 | `{"success":false,"result":false,"error":"no data",...}` |
| missing `market` | 200 | `{"success":false,"result":[],"error":"required parameter missing",...}` |
| bad `side=UP` | 200 | `success` true, both sides returned, the parameter ignored |
| lower case `scc_btc` | 200 | `success` true, the same book as `SCC_BTC` |
| unknown filter on `/markets` | 200 | `{"success":false,"result":[],"error":"no data",...}` |
| undocumented path | 404 | nginx's stock HTML page |

Errors come back as HTTP 200 with `success` false, so a client must read `success`, not the status.
During exploration before the probe was written, one manual call of `/exchange/spot/markets?orderData=true&market=DASH_SCC` at 05:18:41 UTC returned HTTP 200 with `{"success":false,"result":[],"error":"Cannot assign requested address",...}`, and the same call 1.5 s before and after succeeded.
The first run of the probe met the same reply on that call seconds earlier and stopped, so the probe now retries and counts such replies, and its later runs saw none.

## 7. Server time and clock offset

There is no time call, but every reply carries `timestamp` in Unix ms and `timestampConverted` in UTC.
Against `api.binance.com` as a reference, the local clock read 12 to 14 ms behind.
StakeCube's `timestamp` read 214 to 228 ms after the local midpoint of round trips of 589 to 718 ms that each opened a new TLS connection.
That offset is inside half a round trip, so the clock agrees with UTC within the resolution of this measurement.

## 8. Recommended poller shape

None for an anchor, because there is no index, mark or funding.
A spot book poller, if a later design wanted one, would call `GET /exchange/spot/orderbook?market=<KEY>` per pair, take the last ask as the best, check `success`, and stay under 20 calls per 10 s per IP, which refreshes about 2 pairs per second.
The data clause of the terms in [`fees.md`](./fees.md) section 1 would need StakeCube's written consent before any such use.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://github.com/stakecube-hub/stakecube-api-docs`, files `rest-api/README.md`, `rest-api/exchange.md` and `rest-api/system.md`, last pushed 2022-05-09, linked from `https://stakecube.io/` as `stakecube/DevCube` | the base URL, the public routes and their parameters, the weight headers, the private signing rule |
