# CoinCola REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:33 to 04:47 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

CoinCola lists no perpetuals, so this profile covers the public REST surface of its spot market, as change 1 of the survey plan's template says.
CoinCola publishes a small market API, S4 of [`fees.md`](./fees.md), on `api.coincola.com`.
The web app also calls its own backend under `www.coincola.com/api/`, which is undocumented.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/coincola/rest-probe.py) unless a source row is named, and ranges cover its three runs.

## 1. Host and latency from this machine

| host | role | resolved addresses |
|---|---|---|
| `api.coincola.com` | the documented market API, `/v1/market...` and `/v1/contract/market...` | `3.169.173.7`, `.34`, `.81` and `.111`, Amazon CloudFront |
| `www.coincola.com` | the web app, and its own backend under `/api/` | the same four addresses |
| `www.coincola.stream` | the spot socket, see [`websocket.md`](./websocket.md) | `18.161.6.15`, `.90`, `.118` and `.127`, Amazon CloudFront |

| call | cold, new TLS connection | warm, kept alive |
|---|---|---|
| `api.coincola.com` `/v1/market/orderbook?market_pair=BTC_USDT&level=1` | 164 to 186 ms | 139 to 204 ms, median 146 to 160 ms |
| `www.coincola.com` `/api/exchange/market/category` | 166 to 215 ms | 137 to 193 ms, median 143 to 146 ms |

- Every reply carried `server: nginx`, `x-cache: Miss from cloudfront` and an `x-amz-cf-pop` of `HIO52`, which by CloudFront's airport code naming is Hillsboro, Oregon.
- No call was refused from the Canadian exit.
- `GET https://api.coincola.com/` answers `"Hi CoinCola!"`, and the 404 bodies name the path `/api//v1/...`, so the API host is a path prefix of the same backend.
- The `runtimeConfig` of the web page names the backend as an internal AWS load balancer in `ap-northeast-2`, Seoul, S3 of [`fees.md`](./fees.md).

## 2. Catalog

### The instruments call

`GET https://api.coincola.com/v1/market` returns every spot pair in one reply of about 9 KB in about 210 ms.

| field | values |
|---|---|
| rows | 29, 24 against USDT and 5 against BTC |
| `trading_pairs` | upper case with an underscore, `BTC_USDT`, the same spelling the socket wants |
| status | none in this call. `GET /v1/market/ticker` carries `is_frozen`, 0 on 28 pairs and 1 on `ETH_BTC` |
| prices | `last_price`, `highest_bid`, `lowest_ask` and the 24 hour high, low, change and volumes, as JSON numbers |
| precision | none in this call |

`ETH_BTC` is the frozen pair, yet it has a two sided book on REST and sends book frames on the socket, so `is_frozen` cannot be read as a book filter on its own.
`EOS_BTC` is not frozen, but has no bid or ask and a last price of 0.
`EOS_USDT` is listed with a book.

### The web app's symbol table

The spot trading page embeds a second table in its `__NEXT_DATA__` state, at `tradingStore.assetInfo.exchange_market`, with 30 symbols.
It holds what the API does not: `trading_precision` with `price_step_value` and `qty_step_value`, `depth_price_precision`, `order_type`, `margin_support` and `leverage`.
For example `BTC_USDT` has a price step of 0.01, a quantity step of 1e-8 and depth precisions 0, 1 and 2, and `ETH_BTC` has 1e-6, 0.0001 and 3 to 6.
The two lists differ.
The page has `A_BTC`, `A_USDT` and `DASH_USDT`, which the API lacks, and the API has `EOS_BTC` and `EOS_USDT`, which the page lacks.
`A` is listed as Vaulta in the withdrawal table of S1 of [`fees.md`](./fees.md), and Vaulta is the 2025 rebrand of EOS, so the page has the new ticker and the API the old one.
`DASH_USDT` is on the page and in the web ticker list, and is absent from the API.
The web backend's `POST /api/exchange/market/ticker/list` with `currency=USDT` and `currency=BTC` returned 25 and 5 tickers, matching the page.
The page table has no public call of its own and is filled when the server renders the page, so it can only be read by fetching the HTML.

### How CCXT 4.5.68 maps it

CCXT has no CoinCola class, see [`fees.md`](./fees.md) section 8.
The Rust server reads each venue's catalog over its own REST, as [`markets.rs`](../../../server/src/venues/gate/markets.rs) line 36 does for Gate, so a custom read of `GET /v1/market` would fit that shape, with steps taken from the page table.

### Size unit and price scale

Sizes are base currency units, the documented `quantity` of S4.
There is no contract size and no price scale.

## 3. Anchor

CoinCola publishes no index, mark or funding for its spot market, because it has no perpetuals.
No anchor poller is recommended.

| `AnchorRow` column | call | result |
|---|---|---|
| index | `GET /v1/contract/market?product_type=PERPETUAL`, field `index_price` | `[]`, no contract |
| mark | none in the documentation | Not offered |
| funding rate | the same call, `funding_rate` and `next_funding_rate` | `[]` |
| interval | none in the documentation | Not offered |
| next settlement | the same call, `next_funding_rate_timestamp` | `[]` |

- `product_type=FUTURES` and `product_type=OPTIONS` also returned `[]`.
- `GET /v1/contract/market/specifications?product_type=PERPETUAL&ticker_id=BTC_PERPUSDT`, the documentation's own example, returned every field `null`.
- `GET /v1/contract/market/orderbook` for the same id returned empty `bids` and `asks`.
- Without `product_type` the contract call returns HTTP 400 with `{"error_code":400,"error_msg":"{\"field\":\"product_type\",\"rejected_value\":null}"}`.

Two reference prices exist and neither is a perpetual anchor.

- `POST https://www.coincola.com/api/exchange/market/currency/price` with `quote_currency=USDT` returns a USDT price per asset, with `"-1"` for assets CoinCola does not list, such as `MATIC` and `TAO`.
  It is the web app's valuation price and is not documented.
- The margin socket has a `MARGIN_INDEX_TICK` channel behind a login token, see [`websocket.md`](./websocket.md) section 7.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The documentation, S4, describes the perpetual fields it would return, but publishes no index basket, mark formula or funding formula.

## 5. REST book snapshot

- Call: `GET https://api.coincola.com/v1/market/orderbook?market_pair=BTC_USDT&level=2&depth=N`.
- `depth` counts both sides, as S4 says, so `depth=10`, 20, 50 and 100 returned 5, 10, 25 and 50 levels a side.
- `depth=0`, `depth=400`, `depth=1000` and no `depth` all returned the whole book, 90 to 92 asks and 81 to 82 bids on `BTC_USDT`.
  `depth=15` returned 7 a side, so odd values are halved and rounded down rather than refused.
- `level=1` returns one bid and one ask.
- Levels are `[price, size]` JSON numbers, asks ascending and bids descending on every reply.
  `BTC_USDT` sizes carried eight decimals, against six on the socket, so the socket rounds sizes.
- Each reply carries `timestamp` in ms, which sat 38 ms behind to 6 ms ahead of the local midpoint of the request over three runs, so it is the reply time rather than a book update time.
- There is no sequence or update id.
- No `cache-control`, `etag` or `age` header was sent, and CloudFront reported a miss on every reply.
- Over 30 one second polls of `depth=10`, the `BTC_USDT` book changed on 8, 4 and 14 of 29 polls in the three runs.
- The web backend's `POST /api/exchange/market/depth` with `levels`, `price_precision` and `symbol` returns the socket's book shape, `{"price":"...","volume":"..."}` strings, 20 levels a side for `levels=20`.

## 6. Rate limits and errors

- No rate limit is published, S4, and no reply carried a rate limit header.
- 20 requests in 7 seconds all returned 200, and no 429 or `Retry-After` was seen.
- An unknown pair returns HTTP 400 with `{"error_code":400,"error_msg":"{\"field\":\"market_pair\",\"rejected_value\":\"NOPE_USDT\"}"}`.
- Lower case `btc_usdt` is refused the same way, so ids are case sensitive.
- A missing `market_pair` or `level` returns the same 400 shape naming the field, and `limit=2000` on the trade call is refused as out of range.
- An unknown path returns HTTP 404 with a Spring style body, `{"timestamp":...,"status":404,"error":"Not Found","message":"","path":"/api//v1/nope"}`.
- The web backend wraps every reply as `{"success":...,"code":...,"message":...,"data":...}`, and a JSON body instead of a form body returns HTTP 415 with `"PARAMETER_ERROR"`.

## 7. Server time and clock offset

There is no time call.
`/v1/time`, `/v1/common/time` and `/v1/market/time` return 404.
The book's `timestamp` had a median offset between 3 ms behind and 2 ms ahead of the local midpoint of the request over 30 polls in each of three runs, and the `Date` header was 0.9 to 1.0 s behind, within its one second resolution, so the server clock agrees with this host.

## 8. Recommended poller shape

No anchor poller is recommended, because CoinCola has no perpetuals and publishes no index, mark or funding.
The venue cannot join the engine as a perpetual leg.

For a future spot leg, the catalog would be `GET /v1/market` once at start, keeping pairs with both a bid and an ask.
The `is_frozen` flag would be logged rather than trusted, since the one frozen pair still has a live book.
Price and size steps would come from the trading page's symbol table, since the API has none.
The REST book `GET /v1/market/orderbook?level=2&depth=100` would serve as the resync snapshot for the socket in [`websocket.md`](./websocket.md).

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1, S3, S4 | see [`fees.md`](./fees.md) section 10 | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coincola/rest-probe.py), sections 1 to 7 | 2026-10-10 UTC |
