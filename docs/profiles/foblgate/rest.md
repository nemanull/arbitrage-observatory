# FOBLGATE REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:05 to 05:26 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers FOBLGATE's spot market data, because FOBLGATE lists no perpetual, see [`fees.md`](./fees.md) section 3.
FOBLGATE publishes no API documentation, S3.
Its key-gated Open API under `/api/` refuses a call without a key, section 6.
The calls below are the ones the web app makes without a login on `https://api2.foblgate.com`, read from its bundle, S1.
Every number below was captured by [`rest-probe.py`](../../../scripts/probes/venues/foblgate/rest-probe.py) unless a source id says otherwise.

## 1. Host and latency from this machine

- `www.foblgate.com`, `api2.foblgate.com`, `api.foblgate.com` and `api-document.foblgate.com` all resolve to `43.201.239.67` and `54.117.20.212`, Amazon (AS16509) addresses that geolocate to Incheon, Korea, behind nginx.
- `POST /ticker/orderBook` for BTC/USDT took 675 to 741 ms over three runs of three calls, cold and warm alike, because the round trip to Korea dominates.
- `GET /` on `api2` returns HTTP 200 with `{"funcName":null,"message":"Your request is temporarily unable to be processed. Please try again later. (9999)","status":"9999"}`, the generic error of section 6.
- `GET https://api-document.foblgate.com/` returns HTTP 204 with an empty body.
- No call was refused from the Canadian exit, and no geoblock was seen.

## 2. Catalog

### The instruments call

`POST /ticker/marketList` with the JSON body `{}` returns every pair as an object keyed by pair name, S1.

| item | value |
|---|---|
| rows | 59 |
| by quote | BTC 38, USDT 21 |
| reply | 47,047 bytes, in 1,225 and 1,029 ms over two runs |
| status flags | `tradeUse`, `listUse`, `askUse` and `bidUse`, each `ON` or `OFF` |
| fully on | 55 |
| partly or fully off | `MAKE/USDT` with trading and listing off, `MYX/BTC` and `PEAQ/BTC` with bids off, `TEST/USDT` with every flag off |
| key against `marketName` | equal on every row |
| `delistingDt` set | none |
| pairs with 24 h value above zero | 5, ZEUS/USDT 13,132, MOBIS/USDT 10,392, CONUT/USDT 251, BNB/USDT 5.6, all in USDT, and LINKA/BTC 0.0087 BTC |
| majors | BTC/USDT, ETH/USDT, XRP/USDT and XRP/BTC, none with 24 h value |

Each row carries `orderFee`, `orderMin`, `tickUnit`, `amountUnit`, `nowPrice`, `closePrice`, `high24`, `low24`, `tradingValue24` and the names in English and Korean.
There is no KRW pair, see [`fees.md`](./fees.md) section 1.
CoinMarketCap lists 11 spot pairs, USDT 7 and BTC 4, none excluded from price or volume, and 0 perpetual and 0 futures pairs, `fees.md S8`.

### How the engine's catalog would map it

There is no CCXT class, so there is no `market.id` to compare, [`fees.md`](./fees.md) section 8.
The pair name is upper case `BASE/QUOTE`, such as `BTC/USDT`, on both the REST calls and the stream.
Sizes are in base units, with `amountUnit` `1.00E-8` on every pair checked.

## 3. Anchor

FOBLGATE publishes no index, no mark price and no funding rate, because it lists no perpetual.
No call in the bundle names one, S1.
The market list's `firstSignPrice` and `closePrice` are the venue's own trade prices, not a reference price.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

`POST /ticker/orderBook` with the multipart form field `pairName`, the way the app sends a `FormData`, S1.
There is no depth parameter.

| pair | bids | asks | best bid | best ask | bytes |
|---|---|---|---|---|---|
| BTC/USDT | 22 | 12 | 82,020.03 for 0.0000429 BTC | 83,117.99 for 0.00002406 BTC | 1,623 |
| ETH/USDT | 61 | 11 | 2,527.002 for 0.00156358 ETH | 2,618.999 for 0.00114547 ETH | 3,175 |
| ZEUS/USDT | 9 | 53 | 0.0005 | 0.00067 | 2,929 |

- The reply is `{"data":{"pairName","buyList","sellList","tickUnit","amountUnit","orderMinUnit","volumePower"},"funcName":"orderBook","message":"정상적으로 처리되었습니다.","status":"0"}`.
- Levels are `{"amount":"0.00004290","price":"82020.03"}`, decimal strings, with bids descending and asks ascending, and no book was crossed.
- The depth differs per pair and per side, so the reply reads as the whole book.
- `Cache-Control` is `no-cache, no-store, max-age=0, must-revalidate`.

### The books are static and off market

- Over two runs of 60 s of polls every 5 s, 10 and 11 per pair, the BTC/USDT and ZEUS/USDT books did not change once.
- The three books of the table had the same content hash in all three runs, between 05:16 and 05:25 UTC.
- Taken together with Binance's book, S2, FOBLGATE's BTC/USDT spread was 133.0 bps wide and its mid sat 13.4 to 16.2 bps below Binance's over two runs.
- ETH/USDT was 357.5 bps wide with its mid 307.8 to 315.0 bps above Binance's.
- The best BTC/USDT levels hold about 3.5 USD and 2 USD.

### Recent trades

`POST /ticker/publicSign` with `pairName` returns the last 100 trades as strings `side|price|amount|yyyyMMddHHmmss`, in Korean time, oldest first.

| pair | oldest of the last 100 | newest |
|---|---|---|
| BTC/USDT | 2026-08-25 04:31:31 | 2026-10-08 04:38:34 |
| ETH/USDT | 2026-08-19 08:15:25 | 2026-09-28 14:50:36 |
| ZEUS/USDT | 2026-09-10 23:54:22 | 2026-10-10 14:00:38 |
| MOBIS/USDT | 2026-08-29 00:35:05 | 2026-10-10 14:01:08 |

So 100 BTC/USDT trades took about six weeks.

## 6. Rate limits and errors

FOBLGATE publishes no rate limit, and none was hit at one call per second.
Every reply below came with HTTP 200, and the error is in the body's `status`.

| case | reply |
|---|---|
| unknown pair `FOO/USDT` | `{"data":null,"funcName":"orderBook","message":"Market unavailable","status":"6104"}` |
| `BTC/KRW`, a pair not listed | the same `6104` |
| no `pairName` | `{"data":null,"funcName":"orderBook","message":"Your request is temporarily unable to be processed. Please try again later. (9999)","status":"9999"}` |
| `GET /ticker/orderBook?pairName=BTC/USDT` | the same `9999` |
| `POST /api/ticker/orderBook`, the Open API, with no key or a fake one | `{"data":null,"funcName":"orderBook","message":"This API key does not have permission to access the URL.","status":"6004"}` |
| `POST /api/chart/selectChart` with a fake key | the same `6004` with `"funcName":"getChart"` |

## 7. Server time and clock offset

No server time call was found in the bundle.
The HTTP `Date` header was 0.15 and 0.2 s behind the local clock over two runs, at its 1 s resolution.

## 8. Recommended poller shape

No anchor poller is recommended, because there is no index, mark or funding.
If a spot leg were ever built, the catalog would be `POST /ticker/marketList` every few minutes, keeping rows with every flag `ON`.
The book would come from `POST /ticker/orderBook` once per pair, then from the stream, see [`websocket.md`](./websocket.md) section 8.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | web bundle `https://www.foblgate.com/assets/index-CLQxZdIW.js` and trade page chunk `https://www.foblgate.com/assets/TradePage-Bkv6Mtpc.js` | 2026-10-09 |
| S2 | Binance `GET https://api.binance.com/api/v3/ticker/bookTicker`, read by `rest-probe.py` mode `mirror` | 2026-10-09 |
| S3 | API management chunk `https://www.foblgate.com/assets/ApiManagePage-UZMsgfcV.js`, whose "API 개발 문서" button shows "문서를 준비 중입니다.", and `https://api-document.foblgate.com/` | 2026-10-09 |
| probed | [`rest-probe.py`](../../../scripts/probes/venues/foblgate/rest-probe.py), modes `host`, `catalog`, `book`, `mirror`, `poll`, `errors`, `trades` and `time` | 2026-10-09 |
