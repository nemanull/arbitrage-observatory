# CRMClick REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 04:22 to 04:33 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers CRMClick's public REST for its USDT-margined perpetuals, see [`fees.md`](./fees.md) section 1.
CRMClick publishes no API documentation.
Every call below was found in the web app bundle, source S5 of [`fees.md`](./fees.md) section 10, and called by [`rest-probe.py`](../../../scripts/probes/venues/crmclick/rest-probe.py), whose output sections are numbered 1 to 8.
The API answers with `{"code":1,"msg":"success","data":...}` on success, and the web app appends `?lang=en-us` to every path and sends the header `XX-Device-Type: web`.

The finding: the perpetual catalog and book are HTX's, and no public call returns index, mark or funding.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| host | `api.crmclick.io`, behind Cloudflare, edge YVR | section 1 |
| resolved | 104.21.68.28, 172.67.185.122 and two IPv6 addresses | section 1 |
| cold request, new TLS | `GET futures/market`, median 0.482 s of 3 in the second pass, 0.488 s in the first | section 1 |
| warm request | `GET futures/market`, median 0.381 s of 5 in the second pass, 0.374 s in the first, 78,833 bytes | section 1 |
| access | every call answered from the Canadian exit, no geoblock and no refusal | sections 1 to 7 |
| backend | ThinkPHP. A 404 returns a full exception trace with the server path `/www/wwwroot/api.crmclick.io/ex_standard_2022-master/`. | section 6 |

## 2. Catalog

`GET futures/market` returns every perpetual in one reply, section 2.

| item | value |
|---|---|
| rows | 69, `count` 69, after RLCUSDT was added between the first pass at 04:22 UTC and the second at 04:31 UTC, when there were 68 |
| platform | `huobi` on all 69 |
| settlement asset | USDT on all 69 |
| status field | none. The rows have no `tradeStatus`, and the web app treats every row as live. |
| symbol | `market` such as `BTCUSDT`, and `market_name` such as `BTC/USDT`. One row is `龙虾USDT`. |
| contract size | `huobi_contract_size`, which equals the `contract_size` of HTX's `swap_contract_info` on all 69 contracts, and on all 68 in the first pass |
| fee, funding, mark or index fields | none |

The contract size matches HTX's exactly, and the book sizes are HTX contract counts, see section 5.
Every CRMClick symbol is an HTX `contract_code` without its dash, `BTC-USDT` to `BTCUSDT`, and the probe matched all 69 that way, section 3.
There is no CCXT class to map, see [`fees.md`](./fees.md) section 8.

`GET spot/market` returns 449 USDT pairs, 439 with `"platform":"huobi"` and 10 with `"platform":"match"`, all `tradeStatus` 1, none listed twice, section 2.
The matched markets are STYLOUSDT, ARCBUSDT, MOONXUSDT, RCCUSDT, NDAUSDT, PLSUSDT, NNCUSDT, RCUSDT, HYKUSDT and AVTUSDT, and eight of them show zero 24 hour volume.
CoinMarketCap shows 426 spot pairs and 0 perpetual or futures pairs for CRMClick, section 8.

## 3. Anchor

None public.

| call | result | evidence |
|---|---|---|
| `GET futures/huobiMarketPatch?symbol=BTCUSDT`, the call the trade page reads `funding_rate`, `funding_time` and open interest from | `{"code":10001,"msg":"用户未登录","data":[]}`, not logged in | section 3, S5 |
| the same call as POST | the same reply | section 3 |
| `futures/fundingRate`, `futures/premiumIndex`, `futures/markPrice`, `futures/index` | 404, ThinkPHP "method not exists" | section 3 |

The trade page takes mark and index from HTX's `ws_index` socket, see [`websocket.md`](./websocket.md) section 1.
So CRMClick publishes no index, mark or funding of its own, and the numbers it shows are HTX's.

## 4. Anchor semantics

Not applicable, because there is no public anchor.
The help center's funding articles describe coin-margined contracts and an 8 hour schedule, see [`fees.md`](./fees.md) section 6.
HTX's own anchor calls and their semantics are in [`../htx/rest.md`](../htx/rest.md).

## 5. REST book snapshot

`POST futures/depth` with form fields `symbol` and `limit` returns the perpetual book, section 4.
It returns 150 levels a side whatever `limit` is, 5, 20, 100 or 500, and refuses a missing `limit` with `{"code":0,"msg":"Please enter limit"}`, sections 5 and 6.
Levels are `[price, size]` JSON numbers, bids descending and asks ascending, with `lastUpdateId` 0 and an `E` timestamp.

Five paired reads of BTCUSDT in the second pass, each against HTX's `GET /linear-swap-ex/market/depth?contract_code=BTC-USDT&type=step0` at once, section 4:

| pair | CRMClick best bid and ask | HTX best bid and ask | CRMClick prices found in HTX's book, bids and asks |
|---|---|---|---|
| 1 | 82610.4 x 622, 82610.5 x 7398 | the same | 145 of 150, 146 of 150 |
| 2 | 82610.4 x 622, 82610.5 x 7398 | the same | 149 of 150, 150 of 150 |
| 3 | 82610.4 x 1083, 82610.5 x 7398 | the same | 150 of 150, 150 of 150 |
| 4 | 82610.4 x 1191, 82610.5 x 7217 | the same | 149 of 150, 148 of 150 |
| 5 | 82610.4 x 1211, 82610.5 x 7332 | the same | 149 of 150, 150 of 150 |

The first pass gave identical best levels on all five pairs as well, with 145 to 150 of 150 prices found.
The depth, the level count and the sizes in contracts are HTX's step0 book, and the few missing prices are levels that changed between the two reads.
Four reads one second apart moved `E` each time, and Cloudflare reported `cf-cache-status: DYNAMIC`, so the edge does not cache the book, section 5.

`POST spot/depth` on the HTX-routed BTCUSDT returned the same best bid and ask as HTX's spot `market/depth` read at once, section 5.
On the matched ARCBUSDT it returned 5 levels for `limit` 5, 17 bids and 20 asks for `limit` 20 and 100, and an empty book for `limit` 500, section 5.

## 6. Rate limits and errors

No rate limit is published and no rate limit header came back, section 1.
Errors are HTTP 200 with `code` 0 or 10001, except an unknown controller or method, which is HTTP 404 with a ThinkPHP trace.

| request | reply |
|---|---|
| `futures/depth` without `limit` | 200 `{"code":0,"msg":"Please enter limit","data":[]}` |
| `futures/depth` for `NOSUCHUSDT` | 200 `{"code":0,"msg":"The trading market is not available","data":[]}` |
| `spot/depth` for `NOSUCHUSDT` | 200 `{"code":0,"msg":"The platform is not supported","data":[]}` |
| `GET spot/depth` with no fields | 200 `{"code":0,"msg":"symbol require","data":[]}` |
| `futuresOrder/openFuturesOrders` without a login | 200 `{"code":10001,"msg":"用户未登录","data":[]}` |
| `GET no/such/path` | 404 `{"code":0,"message":"controller not exists:app\\controller\\No","traces":[...]}` |

## 7. Server time

There is no REST time call, and `GET common/time` is a 404, section 7.
The `E` field of `futures/depth` was 460 to 494 ms behind the local midpoint of each request in the second pass and 449 to 530 ms in the first, and the `Date` header 0.5 to 1.4 s behind, section 7.
The socket's `server.time` returns Unix seconds, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

None.
CRMClick publishes no anchor, and its catalog and book are HTX's.
A venue leg on CRMClick would duplicate HTX, which has its own profile in [`../htx/`](../htx/).

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S5 | `https://crmclick.io/assets/index.b5aeda38.js` and `index.5a4f90d9.js` | API base, call names and methods, the `huobiMarketPatch` funding call |
| H1 | `https://api.hbdm.com/linear-swap-api/v1/swap_contract_info?business_type=swap` and `https://api.hbdm.com/linear-swap-ex/market/depth` | HTX contract sizes and book, for comparison |
| H2 | `https://api.huobi.pro/market/depth?symbol=btcusdt&type=step0&depth=20` | HTX spot book, for comparison |
| C1 | `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=crmclick` | pair counts by category |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/crmclick/rest-probe.py) | every probed number above |
