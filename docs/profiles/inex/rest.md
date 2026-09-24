# INEX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:38 to 05:06 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

INEX lists no perpetual, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The documented Open API refuses every call that carries no JWT, including the one call its own quickstart calls public, so nothing on it could be read.
What the website itself loads without a login was read instead, and it is undocumented.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) unless a source id says otherwise.
Access results are from the Canadian VPN exit of this laptop, whose Cloudflare trace read `loc=CA`, `colo=YVR`.

## 1. Host and latency from this machine

| host | resolved to | role |
|---|---|---|
| `api.inexcoin.com` | `54.117.44.81`, `52.79.152.32`, AWS `ap-northeast-2` (Seoul) by reverse DNS | documented Open API, REST and WebSocket, S1 |
| `www.inexcoin.com` | four CloudFront addresses in `3.165.160.0/24`, reverse DNS `sea90` | website, and its `/client-api/service` calls |
| `socket.inexcoin.com` | `54.116.233.112`, `43.203.1.146`, AWS `ap-northeast-2` | the website's market socket, see [`websocket.md`](./websocket.md) |
| `docs.inex.im` | `43.202.206.15`, `54.116.241.136` | API documentation, a Next.js site |
| `support.inexcoin.com` | `216.198.53.6`, `216.198.54.6`, `server: cloudflare` | Zendesk help center |

### The documented Open API

Every documented market data path answered HTTP 400 with the same JSON body, cold and warm, in the run at 04:50 UTC and the rerun at 05:01 UTC.

| path | documented auth | status | cold, run 1 and rerun | warm, run 1 and rerun |
|---|---|---|---|---|
| `GET /v1/symbol/all` | "the only public endpoint, callable without a signature", S1, and "a public endpoint that needs no authentication", S2 | 400 | 663, 647 ms | 643, 158 and 707, 175 ms |
| `GET /v1/tickers` | JWT, S3 | 400 | 702, 709 ms | 159, 160 and 175, 178 ms |
| `GET /v1/tickers/BTC-USDT` | JWT, S3 | 400 | 901, 651 ms | 163, 158 and 176, 176 ms |
| `GET /v1/orderbook/BTC-USDT` | JWT, S4 | 400 | 652, 668 ms | 158, 158 and 179, 197 ms |
| `GET /v1/trades/ticks?market=BTC-USDT&count=5` | JWT, S5 | 400 | 671, 708 ms | 159, 160 and 174, 176 ms |
| `GET /v1/market/ticker?symbol=btcusdt` | the example on the website's Open API page, S6 | 400 | 688, 645 ms | 157, 158 and 176, 176 ms |
| `GET /v1/nope`, undefined | | 400 | 674, 667 ms | 158, 158 and 176, 177 ms |

```json
{"error":{"name":"empty_token","message":"토큰 정보가 없습니다.\n토큰 정보를 확인해주세요."}}
```

The first warm reading of `/v1/symbol/all`, 643 and 707 ms, opened the kept connection, so it is a cold time.
The message says there is no token information and asks the caller to check the token.
The reply is `application/json` with no `Retry-After`.
An undefined path gets the same refusal, so the token check runs before routing, and a bare `Authorization: Bearer` header changed nothing.
The limits page lists `empty_token` as 400 "include a JWT in the Authorization header", S7.
The refusal is an authentication refusal and not a geoblock, since the error name is the documented token error and the website on the same network answered 200.
The WebSocket handshake of the Open API is refused the same way, see [`websocket.md`](./websocket.md) section 1.
A key needs an account that finished KYC, S1, and a foreigner cannot finish KYC, see [`fees.md`](./fees.md) section 1.
So no part of the Open API is readable from this host without an account this project cannot open.

### The website's own calls

The website fetches market data from `https://www.inexcoin.com/client-api/service/...`, a path its JavaScript names in `serviceApiClient`, S8.
These calls need no login and are not part of the Open API documentation.

| call | status | first request, run 1 and rerun | reply |
|---|---|---|---|
| `GET /client-api/service/market-coins` | 200 | 529, 653 ms | 11,480 characters, the catalog and `serverTime` |
| `GET /client-api/service/market/tickers` | 200 | 413, 411 ms, CloudFront `Miss from cloudfront`, POP `SEA900-P6` | 2,850 characters, 11 rows |
| `GET /client-api/service/coins` | 200 | 424, 414 ms | 6,033 characters, per coin settings such as `withdrawMaxKrw` and `mainChainName` |

## 2. Catalog

### The instruments call

The documented `GET /v1/symbol/all` returns `[{symbol, base, quote}]` with symbols spelled `BTC-KRW`, S2, and it answered 400 here, section 1.
The website's `market-coins` answered with `code` `"0"` and one market.

| field | value on 2026-09-23 |
|---|---|
| markets | one, `USDT` |
| pairs | 11: `btcusdt`, `ethusdt`, `solusdt`, `bnbusdt`, `trxusdt`, `avaxusdt`, `aaveusdt`, `ldousdt`, `ondousdt`, `qiusdt`, `eseusdt` |
| `isOpen`, `isShow` | 1 on all 11 |
| `is_open_lever` | 0 on all 11, so no margin |
| `price`, `volume` | 8 and 8 on all 11, the decimals of price and size |
| `depth` | `"0.00000001,0.000001,0.0001"` on all 11, three price steps whose use is Not publicly specified |
| `quoteFeeRate`, `openQuoteFee` | 0 and 1 on all 11, meaning Not publicly specified |
| `listingDate` | `2024-12-09 14:00:00` for BTC to `2025-05-29 15:00:00` for BNB |
| perpetuals | none, no swap, future or option market exists |

CoinGecko lists the same 11 pairs, all against USDT, S9.
The pair has four spellings: `btcusdt` in the catalog, the ticker and the socket, `BTC/USDT` as `showName`, `BTC_USDT` in the trade page URL, and `BTC-USDT` in the Open API's form.
The trading guide sets the order limits at 1 to 500,000 USDT, and a market order is refused when it would walk past the first 15 levels, S10.
Its tick table gives 0.01 USDT for a price of 100 USDT or more, 0.001 from 10, 0.0001 from 1, and so on down to 0.00000001 below 0.001, S10.

### How CCXT 4.5.68 maps it

It does not.
No CCXT class exists in 4.5.68 or in master at 4.5.82, see [`fees.md`](./fees.md) section 8.
Sizes on the website socket are in base coins, so a spot adapter would use a `contractSize` of 1, see [`websocket.md`](./websocket.md) section 4.

## 3. Anchor

INEX publishes no index, no mark and no funding, since it lists no perpetual.
No bulk call returns an `AnchorRow`.
The only reference price is the last trade: `close` in the website's `market/tickers`, next to `open`, `high`, `low`, `prevClose`, `amount` in USDT and `vol` in base coin over 24 hours.

```json
{"symbol":"btcusdt","amount":"1195.17352230","close":"87169.83000000","prevClose":"86189.25000000","high":"87199.05000000","prevHigh":"86624.39000000","low":"86158.00000000","prevLow":"85176.81000000","open":"86158.00000000","rose":"1.13","vol":"0.01388000","vp":"74.79"}
```

The documented `GET /v1/tickers` carries `symbol`, `price`, `change` and `volume` only, S3, and it answered 400.

## 4. Anchor semantics

None.
The last trade is a poor reference on this venue.
Over 60 polls a second apart, `close` or `amount` changed once on `btcusdt`, once on `aaveusdt`, once on `bnbusdt`, and never on the other eight pairs.
In the rerun it changed three times on `ethusdt`, once on `ondousdt`, and never on the other nine.
The 24 h volume was 1,195 to 1,208 USDT on BTC and about 17,900 USD across all 11 pairs on CoinGecko, S9.

## 5. REST book snapshot

The documented call is `GET /v1/orderbook/{market}`, which returns `{market, buys, asks}` with bids best first descending and asks best first ascending, S4.
It needs a JWT and answered 400 here, section 1.
Its depth limit and caching are Not publicly specified.
No REST book call appears among the website calls found in its JavaScript, S8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit | "every API call is limited to 30 per second per Access Key", S7. Raised from 20 to 30 in v1.1.0 on 2025-12-15, S11 | not reachable without a key |
| over the limit | HTTP 429 `too_many_requests`, S7 | not reached |
| `Retry-After` | the documented backoff example reads `Retry-After` and defaults to 1 s, S7 | absent from every 400 |
| error shape | `{"error": {"name", "message"}}`, and 401 is split into several `name`s, S7 | `{"error":{"name":"empty_token",…}}` with HTTP 400 |
| website calls | not documented | 60 polls of `market/tickers` at one per second, twice: 120 of 120 answered 200 |

The documented error names are `empty_token` 400, `unauthorized` 401, `invalid_jwt_payload` 401, `invalid_jwt_nonce` 401, `not_found_access_token` 401, `expired_token` 401 and `too_many_requests` 429, S7.

The `market/tickers` poll took min 163, median 395, p90 420 and max 455 ms over 60 polls, and min 160, median 217, p90 419 and max 444 ms in the rerun, with none over 1 s.

## 7. Server time and clock offset

The Open API has no server time call.
The website's `market-coins` carries `serverTime` as a Korea Standard Time wall clock with milliseconds, `"2026-09-23 13:50:47.552"`.
Read against the midpoint of the request, the server clock was 87 ms ahead of this host in a 529 ms request and 193 ms behind in a 653 ms request in the rerun.
Each reading is only bounded by half its reply time, so the offset is within a few hundred ms and its sign is not settled.
The `Date` header has one second resolution and read 106 to 1,067 ms behind over both runs, which is that resolution and not a skew.

## 8. Recommended poller shape

None.
INEX publishes no index, mark or funding, so the engine has nothing to poll for an anchor.
The website's `market/tickers` gives a last trade price for 11 pairs in one call at median 217 to 395 ms, but it is undocumented, and its last price changed on 2 or 3 of 11 pairs in a minute.
The documented Open API cannot be polled without a KYC-bound key.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | INEX Developer, 시작하기 (quickstart) | https://docs.inex.im/docs/quickstart | 2026-09-23 | Infinity Exchange Korea | base URLs, KYC before a key, `/v1/symbol/all` as the only public call |
| S2 | INEX Developer, 심볼 코드 조회 (`/v1/symbol/all`) | https://docs.inex.im/docs/symbol-all | 2026-09-23 | Infinity Exchange Korea | reply shape, "public endpoint" |
| S3 | INEX Developer, 전체 종목 현재가 조회 and 개별 종목 현재가 조회 | https://docs.inex.im/docs/tickers and https://docs.inex.im/docs/tickers-symbol | 2026-09-23 | Infinity Exchange Korea | ticker fields, JWT required |
| S4 | INEX Developer, 개별 종목 호가 조회 (`/v1/orderbook/{market}`) | https://docs.inex.im/docs/orderbook-market | 2026-09-23 | Infinity Exchange Korea | book shape and level order, JWT required |
| S5 | INEX Developer, 최근 체결 주문 조회 (`/v1/trades/ticks`) | https://docs.inex.im/docs/trades-ticks | 2026-09-23 | Infinity Exchange Korea | trades, JWT required |
| S6 | INEX Open API page | https://www.inexcoin.com/en/open-api | 2026-09-23 | Infinity Exchange Korea | the `/v1/market/ticker` example, docs host |
| S7 | INEX Developer, Rate Limit · 에러 | https://docs.inex.im/docs/limits | 2026-09-23 | Infinity Exchange Korea | 30 per second per key, error names, backoff |
| S8 | website JavaScript chunks under `https://www.inexcoin.com/_next/static/chunks/` | https://www.inexcoin.com/en/open-api | 2026-09-23 | Infinity Exchange Korea | `serviceApiClient` at `/client-api/service`, the `market-coins`, `coins` and `market/tickers` calls |
| S9 | CoinGecko exchange API, `inex` | https://api.coingecko.com/api/v3/exchanges/inex | 2026-09-23 04:50 UTC | CoinGecko | 11 pairs, volume |
| S10 | [안내] 거래이용 안내, trading guide | https://support.inexcoin.com/hc/ko/articles/27520190445593 | 2026-09-23 | Korea | order limits, 15 level market order rule, tick table |
| S11 | INEX Developer, 변경 기록 (changelog) | https://docs.inex.im/docs/changelog | 2026-09-23 | Infinity Exchange Korea | v1.0.0 on 2025-10-01 to v1.4.0 on 2026-07-20, the limit raise |
| P1 | `rest-probe.mjs official`, 04:50 UTC and the rerun at 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) | 2026-09-23 | this host | section 1 |
| P2 | `rest-probe.mjs web` and `poll`, 04:50 to 04:52 UTC and the rerun at 05:01 to 05:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inex/rest-probe.mjs) | 2026-09-23 | this host | sections 2 to 7 |
