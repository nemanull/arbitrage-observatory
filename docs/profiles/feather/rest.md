# Feather Exchange REST Profile

**Status:** Done.
Feather Exchange lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
The REST surface is undocumented and was read from the `ftrex.io` web app bundle.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:34 to 04:51 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada (Vancouver, AS212238).

Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/feather/rest-probe.py), whose second pass run is the one cited unless a line says otherwise.
Socket numbers come from [`ws-probe.py`](../../../scripts/probes/venues/feather/ws-probe.py).
Fees are in [`fees.md`](./fees.md) and the socket is in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

- Base URL: `https://ftrex.io/api`.
  The web bundle uses the relative `/api` on the web, and its app build reads `apiBaseUrl` `https://ftrex.info/api` with fallbacks `ftrex.bio`, `ftrex.org` and `ftrex.io` from `https://d2tfcodvkyt3f7.cloudfront.net/media/app-config/primary.json`, S1.
- `ftrex.io` resolves to `16.162.140.132`, `16.162.99.218` and `18.167.232.207`, AWS addresses, behind an AWS application load balancer that sets `AWSALB` cookies and signs its refusals `server: awselb/2.0`.
- The load balancer refuses a bare `Mozilla/5.0` and `Python-urllib/3.12` with HTTP 403 and the body `<html><head><title>403 Forbidden</title></head>...`, on the web pages and on `/api` alike.
  A full browser User-Agent is answered, so every probe sends one.
  This is a User-Agent filter, not a geoblock, and nothing answered differently because of the Canadian exit.
- Cold `POST /api/market/symbol-thumb` with a new TLS connection each time: 673, 658 and 685 ms.
- Warm on one kept-alive connection, after a first request of 663 ms: 173 to 182 ms, median 174 ms, about one round trip to Hong Kong.

## 2. Catalog

Two public calls list the markets, S2.

- `GET /api/market/symbol` returns 10 rows, 4,689 bytes, with `symbolId`, `symbol`, `coinSymbol`, `baseSymbol`, `enable`, `visible`, `exchangeable`, `matchingMode`, `externalMatching`, `fee`, `feeInBaseSymbol`, `minAmount`, `maxAmount`, `minTurnover`, `coinScale`, `baseCoinScale`, `zone`, `sort`, `flag`, `ifEnable` and `currentTime`.
- `POST /api/market/symbol-thumb` with an empty body returns the same 10 symbols with a 24 hour ticker: `open`, `high`, `low`, `close`, `chg`, `change`, `volume`, `turnover`, `lastDayClose`, `usdRate`, `baseUsdRate`, `guidancePrice`, `zone`, `coinScale` and `baseCoinScale`.

| symbol | `matchingMode` | `exchangeable` | `minAmount` | `minTurnover` | `coinScale` | `baseCoinScale` |
|---|---|---|---|---|---|---|
| FTR_USDT | LOCAL | 1 | 0 | 0 | 4 | 4 |
| BTC_USDT | EXTERNAL | 2 | 0.0001 | 5 | 5 | 2 |
| FTU_USDT | LOCAL | 2 | 0 | 0 | 4 | 6 |
| ETH_USDT | EXTERNAL | 2 | 0.003 | 5 | 4 | 2 |
| SOL_USDT | EXTERNAL | 2 | 0.1 | 5 | 3 | 2 |
| BNB_USDT | EXTERNAL | 2 | 0.01 | 5 | 3 | 2 |
| XRP_USDT | EXTERNAL | 2 | 5 | 5 | 1 | 4 |
| DOGE_USDT | EXTERNAL | 2 | 60 | 10 | 0 | 5 |
| ADA_USDT | EXTERNAL | 2 | 25 | 5 | 1 | 4 |
| TRX_USDT | EXTERNAL | 2 | 20 | 5 | 1 | 4 |

- Every row has `enable` 1 and `visible` 1, and USDT is the only quote asset.
- The symbol is spelled `BTC_USDT`, the same on REST and on the socket topics.
  A slash form, `BTC/USDT`, returns an empty book with HTTP 200, section 5.
- FTU_USDT showed `close` 0, `volume` 0 and `guidancePrice` 6, so it had no trade in the window.
- The 8 EXTERNAL rows are the 8 pairs CoinMarketCap lists, and their books are Binance's, section 5.
- No perpetual exists.
  `/api/swap/symbol-thumb`, `/api/contract/symbol-thumb`, `/api/swap/market/symbol` and `/api/futures/market/symbol` answer 404 with `{"code":404,"message": "404 NOT_FOUND","resultStat": ""}`, and the web bundle names no swap, contract or futures route, S1.
- There is no CCXT class to map the catalog, see [`fees.md`](./fees.md) section 8.

## 3. Anchor

Feather publishes no index price, no mark price and no funding rate, because it lists no perpetual.
`/api/market/funding-rate` and `/api/market/mark-price` answer 404.
The only reference prices it publishes are its own last trade, open, high and low on `symbol-thumb` and the socket thumb topic, `usdRate`, which equals `close` for every USDT pair, and `guidancePrice`, a fixed 6 on FTU_USDT and null elsewhere.
None of them is an index, and none can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding to describe.
Ten polls of `exchange-plate-mini` for BTC_USDT one second apart returned a different book on all 9 consecutive pairs, while the best bid and ask stayed at 82668.39 and 82668.40.
`GET /api/market/history?symbol=BTC_USDT&resolution=1&from=<ms>&to=<ms>` returns 1 minute bars as `[time ms, open, high, low, close, volume]`, 5 rows for the last 5 minutes.

## 5. REST book snapshot

- `GET /api/market/exchange-plate-mini?symbol=BTC_USDT`, `/api/market/exchange-plate` and `/api/market/exchange-plate-full` all return the same shape, 3,170 bytes in the second pass, 20 bids and 20 asks.
- `depth=100`, `limit=100` and `size=100` are ignored, and the reply stays at 20 levels per side.
- Shape: `{"symbol","bidItems":[{"price","amount","orderCount"}],"askItems":[...],"highestPrice","lowestPrice","totalAmount"}`, prices and sizes as JSON numbers, `orderCount` always 0.
- Bids descend from the best bid and asks ascend from the best ask.
- Sizes are in the base asset, for example BTC on BTC_USDT.
- No `Cache-Control` header is sent, and the book changed between every pair of polls one second apart, section 4.
- An unknown symbol, `FOO_USDT`, and the slash spelling `BTC/USDT` both return HTTP 200 with empty `bidItems` and `askItems`.
- A missing `symbol` returns HTTP 200 with `{"data":null,"code":3000,"message":"","totalPage":null,"totalElement":null,"ok":false}`.

The externally matched books are Binance's spot books.
`rest-probe.py` section "book against Binance spot" fetches Feather's book and `https://data-api.binance.vision/api/v3/depth?limit=20` at the same moment.

| pair | run | Feather levels whose price is on Binance's top 20 | levels equal in price and size |
|---|---|---|---|
| BTC_USDT against BTCUSDT | run 1, 04:43 UTC | 40 of 40 | 40 |
| ETH_USDT against ETHUSDT | run 1, 04:43 UTC | 38 of 40 | 36 |
| BTC_USDT against BTCUSDT | second pass, 04:50 UTC | 40 of 40 | 40 |
| ETH_USDT against ETHUSDT | second pass, 04:50 UTC | 40 of 40 | 40 |

The two requests are fired in parallel, and the few levels that differed in run 1 were near the top of the ETH book, where Binance's book moves between two replies.
The public trade tape of the same markets carries order ids `REF-BUY-<ms>` and `REF-SELL-<ms>` with null member ids, see [`websocket.md`](./websocket.md) section 6.

## 6. Rate limits and errors

- No rate limit is published, and no `X-RateLimit` or `Retry-After` header was seen.
  Replies carry only `Connection`, `Content-Type`, `Date`, `Set-Cookie`, `Transfer-Encoding` and `Vary`.
- 20 `GET /api/market/symbol` calls at about 4 a second all returned 200.
- Error shapes:
  - an unknown path under `/api` answers 404 with `{"code":404,"message": "404 NOT_FOUND","resultStat": ""}`.
  - an unknown path under `/api/market` answers 404 with a Spring Boot body, `{"timestamp":"2026-10-10 12:50:39","status":404,"error":"Not Found","path":"/market/symbol-info"}`, whose timestamp is in UTC+8.
  - a missing parameter answers 200 with `"code":3000` and `"ok":false`, section 5.
  - the User-Agent filter answers 403 with an HTML body, section 1.

## 7. Server time

There is no server time call, and `/api/market/time` answers 404.
The `Date` header was within 0.61 s of the local clock, at its 1 s resolution.
The socket trade frames carry a `time` in epoch milliseconds, see [`websocket.md`](./websocket.md) section 6.

## 8. Recommended poller shape

None.
There is no index, mark or funding to poll, and the venue has no perpetual leg to anchor.
For a future spot leg, `GET /api/market/symbol` is the catalog, filtered to `enable` 1, and `exchange-plate-mini` is the 20 level resync snapshot.
The 8 EXTERNAL books would duplicate Binance's spot books, so a spot leg there would add Binance's price a second time, not a new one.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://ftrex.io/_next/static/chunks/6120-56f17e2b10c808ea.js` and `4551-ca18025cc436f74f.js`, the web bundle on 2026-10-10, searched for paths | the REST paths, the socket path and topics, the app config URLs |
| S2 | `https://ftrex.io/api/market/symbol` and `https://ftrex.io/api/market/symbol-thumb` | the catalog |
| S3 | `https://data-api.binance.vision/api/v3/depth` | Binance's spot book for the comparison |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/feather/rest-probe.py) | every probed line above |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/feather/ws-probe.py) | the trade tape ids |
