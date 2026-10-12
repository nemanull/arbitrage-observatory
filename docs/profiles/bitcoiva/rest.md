# Bitcoiva REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:29 to 03:51 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers Bitcoiva's spot Open API, because Bitcoiva lists no exchange perpetual, see [`fees.md`](./fees.md) section 3.
The API is documented only inside the web app, at the route `/bitcoiva-apidocs`, as "Bitcoiva Open API v3.0 Documentation", S1.
It has two public calls, `GET /api/v1/ticker` and `GET /api/v1/depth`, on `https://apistack.bitcoiva.com`, S1.
Every number below was captured by [`rest-probe.py`](../../../scripts/probes/venues/bitcoiva/rest-probe.py) unless a source id says otherwise.
The source ids are listed in section 9, and `fees.md S<n>` points at the ledger of [`fees.md`](./fees.md).

## 1. Host and latency from this machine

- `www.bitcoiva.com`, `apistack.bitcoiva.com` and the web app's API hosts all resolve through `prod-bitcoiva-user-alb-976200628.ap-south-1.elb.amazonaws.com`, an AWS load balancer in Mumbai, to `13.127.74.191` and `15.252.249.239`.
- The API answers through nginx and Express, by the `Server` and `X-Powered-By` headers.
- `GET /api/v1/ticker?symbol=BTC_USDT` took 759 to 801 ms over two runs of three calls, cold and warm alike, because the round trip to Mumbai dominates.
- No call was refused from the Canadian exit, and no geoblock was seen.
- `GET /` on the API host returns HTTP 200 with `{"payload":"U2FsdGVkX1..."}`, an AES payload in OpenSSL's salted format, the same envelope the web app's private API uses.

## 2. Catalog

### The instruments call

There is no instruments call.
`GET /api/v1/ticker` without a symbol returns every pair, and it serves as the catalog.

| item | value |
|---|---|
| rows | 221 |
| by quote | USDT 112, INR 90, BTC 11, ETH 6, BNB 2 |
| reply | 49,894 and 49,899 bytes, in 1,335 and 1,347 ms, over two runs |
| fields | `symbol`, `fromSymbol`, `toSymbol`, `lastPrice`, `bestBid`, `bestAsk`, `high`, `low`, `changePer`, `changePrc`, `volume`, `amtVol` |
| status field | none, so a delisted or halted pair cannot be told apart |
| duplicate symbols | none |
| rows with a zero bid or ask | none |

- The documentation names the ticker's parameter `pair`, S1, but the server reads `symbol`.
  `?pair=BTC_USDT` returned all 221 rows.
- `GET /api/v1/ticker?symbol=BTC_USDT` returned `"volume":448823.46712` and `"amtVol":5.43`, which read as 24 h quote and base volume on Bitcoiva itself.
- The ticker socket lists 241 pairs, USDT 111, INR 111, BTC 11, ETH 6 and BNB 2, [`websocket.md`](./websocket.md) section 6.
- CoinMarketCap lists 199 spot pairs, USDT 106, INR 85, BTC 5, ETH 2 and BNB 1, and flags all 199 with `priceExcluded` 1 and `volumeExcluded` 1, `fees.md S8`.
  It lists 0 perpetual and 0 futures pairs.

### How the engine's catalog would map it

There is no CCXT class, so there is no `market.id` to compare, [`fees.md`](./fees.md) section 8.
The Open API symbol is upper case `BASE_QUOTE`, such as `BTC_USDT`.
Sizes are in base units, the same as Binance's, section 5.

## 3. Anchor

Bitcoiva publishes no index, no mark price and no funding rate, because it lists no exchange perpetual.
Neither public call carries one, S1.
The ticker socket's `inrPrc` field is the fixed INR rate that turns a USDT price into an INR price, 99.5 during the probe, and it is a conversion rate rather than an index.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, section 3.

## 5. REST book snapshot

`GET /api/v1/depth?symbol=<PAIR>&limit=<n>` returns `{"lastUpdateId":<n>,"bids":[[price,size],...],"asks":[...]}`, with prices and sizes as strings.

| `limit` | levels a side |
|---|---|
| 5 | 5 |
| absent | 10 |
| 20, 21, 50, 100 | 20 |
| 0, 101, 1000 | 10 |

- The documentation says "Default 20, max 100", S1.
  The wire gives 10 by default and never more than 20.
- Bids are in descending and asks in ascending price order, and no reply was crossed.
- Replies carry a weak `ETag` and no `Cache-Control`.
- Over 30 s of polls every 2 s, 15 polls, the five level book changed at each of the 14 steps in both runs, while the best bid and ask prices did not move.
  `lastUpdateId` only rose, by 79 to 263 per step.

### The book is Binance's

The probe fetched Bitcoiva's depth and Binance's `/api/v3/depth` in parallel, `mirror` mode, in two runs.
Each cell gives run 1, then run 2.

| Bitcoiva pair | Binance symbol | sizes equal, of 10 bids and 10 asks | best bid ratio | `lastUpdateId` ahead of Binance by |
|---|---|---|---|---|
| `BTC_USDT` | `BTCUSDT` | 8 and 9, then 8 and 9 | 1.0, then 1.0 | 68, then 49 |
| `ETH_USDT` | `ETHUSDT` | 10 and 10, then 4 and 4 | 1.0, then 1.0 | 34, then 62 |
| `XRP_USDT` | `XRPUSDT` | 10 and 10, then 8 and 7 | 1.0, then 1.0 | 2, then 14 |
| `BTC_INR` | `BTCUSDT` | 7 and 10, then 9 and 8 | 99.5, then 99.5 | 38, then 49 |
| `ETH_INR` | `ETHUSDT` | 10 and 10, then 10 and 10 | 99.500002, then 99.5 | 13, then 12 |
| `ETH_BTC` | `ETHBTC` | 10 and 10, then 10 and 10 | 1.0, then 1.0 | 0, then 2 |

- The best prices matched in every case, the sizes matched where the book did not move between the two reads, and `lastUpdateId` is Binance's own counter, equal on `ETH_BTC` in run 1.
- INR books are Binance's USDT book with every price multiplied by 99.5.
- The error codes are Binance's too, such as `-1121` and `-1102`, section 6.
- `CNT_USDT` returns a book whose `lastUpdateId` is a millisecond timestamp, such as 1791603715857, which fits the LBank source the trade page uses for CNT, [`websocket.md`](./websocket.md) section 1.
- Bitcoiva's own token `BCA` has a ticker but no depth: `depth?symbol=BCA_USDT` and `BCA_INR` return 404, while `ticker?symbol=BCA_USDT` returns a price.

So the public book is a pass-through of Binance spot, and it says nothing about orders resting on Bitcoiva.
Whether Bitcoiva fills orders against that book through Binance is not stated in the documentation.
The web app routes each pair to one of two order hosts by a `liquidity` flag, and the second host's calls are named `makeLiqOrder` and `cancelLiqOrder`, `fees.md S2` and `fees.md S6`.

## 6. Rate limits and errors

| call | scope | limit | window | source |
|---|---|---|---|---|
| `GET /ticker` | IP address | 1,200 | 60 s | S1 |
| `GET /depth` | IP address | 1,200 | 60 s | S1 |
| `POST /balance` | API key | 1,200 | 60 s | S1 |
| `POST /openOrders` | API key | 300 | 60 s | S1 |
| `POST /tradeHistory` | API key | 300 | 60 s | S1 |
| `POST /createOrder` | API key | 50 | 10 s | S1 |
| `POST /cancelOrder` | API key | 100 | 10 s | S1 |

- The documentation says "Limits use a fixed window", which starts with the first request, S1.
- The wire carries `RateLimit-Policy: 1200;w=60`, `RateLimit-Limit: 1200`, `RateLimit-Remaining` and `RateLimit-Reset` in seconds.
- `Retry-After` is documented for HTTP 429 only, S1, and the probe never reached a limit.

| request | status | body |
|---|---|---|
| `depth?symbol=NOPE_USDT` | 404 | `{"code":-1121,"msg":"Invalid symbol or inactive trading pair"}` |
| `depth?symbol=BCA_USDT` | 404 | the same |
| `depth?symbol=btc_usdt` or `BTCUSDT` | 400 | `{"code":-1121,"msg":"Invalid symbol format."}` |
| `depth` without a symbol | 400 | `{"code":-1102,"msg":"Mandatory parameter 'symbol' was not sent"}` |
| `POST /api/v1/balance` without a key | 200 | `{"status":false,"text":"Missing authentication headers","statusCode":1001}` |
| web app `GET .../ctrader/viewbitcoivafuturepairs` without a login | 200 | 122 bytes, `{"payload":"U2FsdGVkX1..."}`, encrypted |

## 7. Server time and clock offset

There is no time call.
The HTTP `Date` header was within half a second of the local clock in six reads over two runs, from -0.27 to 0.49 s, at the header's one second resolution.

## 8. Recommended poller shape

None.
Bitcoiva publishes no index, mark or funding, section 3.
A spot book poller on `/api/v1/depth` would poll Binance's book through Mumbai, about 0.8 s late, under another venue's name.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `/bitcoiva-apidocs` page chunk `https://www.bitcoiva.com/static/js/3259.6a9380d5.chunk.js`, same as `fees.md S4` | 2026-10-09 |
| S2 | [`rest-probe.py`](../../../scripts/probes/venues/bitcoiva/rest-probe.py), modes `host`, `catalog`, `ticker`, `book`, `mirror`, `poll`, `errors` and `time` | 2026-10-09 |
| S3 | Binance spot `https://api.binance.com/api/v3/depth`, read by the `mirror` mode | 2026-10-09 |
