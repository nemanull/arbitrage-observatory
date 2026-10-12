# KlicklX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:14 to 04:44 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public REST calls behind KlicklX's USDT-margined perpetuals.
KlicklX publishes no futures REST API.
Its API document, inherited from IDCM, covers spot only, see section 1.
Every futures call below is one the futures website makes without a login, found in its script, S1, and checked by [`rest-probe.py`](../../../scripts/probes/venues/klicklx/rest-probe.py).

## 1. Host and latency from this machine

### What was looked for

The website's config names its hosts: `baseHost` `https://api.klicklx.com`, `futuresHost` `https://ctapi.klicklx.com`, `tradeMarketHost` `https://api.klicklx.com/flexpusher/hub/exchanges` and `futuresMarketHost` `https://ctws.klicklx.com/senders`, S1.
The API document at `GetApiDocumentTitleList` and `GetApiDocument` lists an introduction, a WebSocket API and a REST API, S2.
Its REST reference describes spot calls such as `POST https://api.{siteName}.com/api/v1/getticker` and `/api/v1/getdepth`, with `X-IDCM-APIKEY` and `X-IDCM-SIGNATURE` headers, and its update log has one entry, dated 2018-05-10, S2.
`POST https://api.klicklx.com/api/v1/getticker` with `{"Symbol":"BTC-USDT"}` and no key still answered `{"result":1,"code":"200","data":{"Timestamp":1791607260,"Buy":82652.50,...}}`.
Nothing in the document covers futures.

### Hosts

`ctapi.klicklx.com`, `ctws.klicklx.com`, `futures.klicklx.com`, `www.klicklx.com` and `api.klicklx.com` all resolved to the Cloudflare addresses `104.18.8.176` and `104.18.9.176`.
Replies carried `server: cloudflare`, `cf-cache-status: DYNAMIC` and a `cf-ray` ending in `YVR`, the Vancouver edge.

### Latency

| call | cold, new TLS connection | warm, kept alive |
|---|---|---|
| `POST /api/baseinfo/GetContracts`, 8441 bytes | 236, 665 and 181 ms | 158 to 167 ms |

The second run measured 183 to 196 ms cold and 160 to 163 ms warm.

## 2. Catalog

### The instruments call

`POST https://ctapi.klicklx.com/api/baseinfo/GetContracts` with an empty body returns every contract.
The envelope is `{"data":[...],"success":true,"errorCode":-1,"msg":"请求成功！"}`, where `errorCode` -1 means success.
It returned 20 contracts, all quoted in USDT, none with `isLimit` true.

| `symbolType` | count | contracts |
|---|---|---|
| 0 | 14 | `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `DOGEUSDT`, `BNBUSDT`, `LTCUSDT`, `TRXUSDT`, `ADAUSDT`, `LINKUSDT`, `APTUSDT`, `TRUMPUSDT`, `DASHUSDT`, `1000SHIBUSDT`, `SUIUSDT` |
| 5 | 6 | `XAUUSDT`, `TSLAUSDT`, `QQQUSDT`, `SPYUSDT`, `CLUSDT`, `SPCXUSDT` |

Each row has `id`, a numeric string such as `1917057417200713728`, the `name`, the `underlying`, `faceValue`, a `tickSize` list such as `[0.1, 1, 10, 100]`, `minChangeUnit`, the maximum leverage as `level`, and `riskReserverAmount`.
No status field exists, and the catalog shows no closed or delisted contract.
`POST /api/baseinfo/GetCoins` returns USDT as the only margin coin.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no KlicklX class, see [`fees.md`](./fees.md) section 8.
The Rust server reads catalogs natively, so an adapter would map this call itself.

### Ids, size unit, and price scale

- The socket and the REST book key on `id`, the numeric string.
  The anchor reply carries both `contractId` and `symbol`, so either can key a row.
- Sizes on the book are in base currency, see [`websocket.md`](./websocket.md) section 4. `faceValue` is the order size step, not a multiplier for book sizes, so the contract size is 1.
- `1000SHIBUSDT` is quoted per 1000 SHIB and needs the price scale of 1000.
- The six `symbolType` 5 contracts are stocks, ETFs and commodities. `SPCXUSDT` names a ticker that is not a crypto token, and none of the six has a crypto counterpart, so an adapter skips them or denies them.
- No pair is listed twice.

## 3. Anchor

### The bulk calls

| call | reply | time | content |
|---|---|---|---|
| `POST /api/market/RealTimeHandicapFull`, empty body | 10207 bytes, 20 rows | 214 ms, median 185 ms over 60 polls | ticker, mark, index, last settled and forecast funding, interval, time to settlement, for every contract |
| `POST /api/market/GetRealFundingRateList`, empty body | 1316 bytes, 8 rows | 176 ms | last settled rate per contract, only for the 8 contracts with a non-zero rate |
| `POST /api/market/GetHistoryFundingRateList`, `contractId`, `pageIndex`, `pageRows` | 1144 entries for `BTCUSDT` | 160 ms | settled rates, newest first |
| `POST /api/market/RealTimeHandicap`, `contractId` | one row | 173 ms | the same row for one contract |

`RealTimeHandicapFull` returned a row for every one of the 20 catalog contracts.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| `index` | `indexPrice` | number |
| `mark` | `markPrice` | number |
| `fundingRate` | `forecastFundRate` | fraction per interval, the upcoming settlement, section 4 |
| `fundingIntervalHours` | `intervalHour` | 8 on every contract |
| `nextFundingAt` | reply time plus `distanceSettlementTime` | `distanceSettlementTime` is `HH:MM:SS` text, the same on every row of one reply, so it counts from the reply, not from the row's `timestamp`. Rounding to the hour gives 08:00 UTC |

The row also has `firstBid`, `firstAsk`, `marketPrice` as the last trade, 24 hour volume in base currency and turnover in USDT, `timestamp` in Unix ms, and `createTime` as UTC+8 text such as `2026-10-10 12:34:58.409`.
`turnover24H` divided by `volume24H` and by `markPrice` was between 0.971 and 1.006 on every row, which shows the volume is in base currency.

## 4. Anchor semantics

### Index

No public page gives the index formula or basket, and no basket call was found.
On the probe, `BTCUSDT` had an index of 82652.97 against a mark of 82677.4.
For `QQQUSDT` the mark equalled the index to the last digit in both runs, such as 753.8390704 for both, and `SPYUSDT` did the same in the first run.

### Mark

No public page gives the mark formula or a clamp.

### Funding

No public page gives the funding formula or a cap.
`currentFundRate` is the last settled rate, not the upcoming one.
For `BTCUSDT` it was 0.00005342, the same as the newest history entry, `createTime` `2026-10-10 08:00:00.000` in UTC+8, `createTimeOffset` 1791590400, which is 00:00 UTC.
`GetRealFundingRateList` gave the same rate on all 8 of its rows, with `createTimeOffset` 1791590400000 in ms.
`forecastFundRate`, 0.00001832 for `BTCUSDT` at the same moment, is therefore the predicted rate for the settlement at 08:00 UTC.
Every history entry has `predictionRate` equal to `realRate`.
History entries fall at 00:00, 08:00 and 16:00 UTC, and `createTimeOffset` in the history is in seconds, while in `GetRealFundingRateList` it is in ms.
The instant of a settlement was not captured.

### How often each number changed

Over 60 polls at one a second, in 59 intervals, first run and second run:

| contract | `markPrice` | `indexPrice` | `forecastFundRate` | `timestamp` |
|---|---|---|---|---|
| `BTCUSDT` | 37 and 37 | 19 and 30 | 1 and 0 | 38 and 39 |
| `ETHUSDT` | 17 and 19 | 19 and 23 | 16 and 20 | 19 and 21 |
| `XAUUSDT` | 13 and 13 | 9 and 4 | 0 and 0 | 12 and 14 |
| `TSLAUSDT` | 18 and 18 | 20 and 19 | 0 and 0 | 16 and 18 |

The row `timestamp` lagged the local clock by a median of 1.8 s and a maximum of 14.2 s and 13.6 s across all rows of all polls.
So a row is only as fresh as the last ticker change, and quiet contracts such as `TRUMPUSDT` were 7.7 s old in one reply.

## 5. REST book snapshot

`POST /api/market/Depth` with `contractId` and `tickSize` returns `{"data":{"contractId":"...","bids":[[price,size],...],"asks":[...]}}`.

| request | result |
|---|---|
| `BTCUSDT`, `tickSize=0.1` | 100 levels a side, bids descending, asks ascending, 154 ms |
| `BTCUSDT`, `tickSize=10` | 100 levels a side, aggregated, best bid and best ask both 82670 |
| `BTCUSDT`, `tickSize=0.1&limit=500` | still 100 levels a side, so `limit` is ignored |
| `BTCUSDT`, no `tickSize` | `{"success":false,"errorCode":40000,"msg":"The tickSize field is required."}` |
| `contractId=123` | `success` true with empty sides |

The reply is not cached by Cloudflare, `cf-cache-status: DYNAMIC`.

## 6. Rate limits and errors

No limit is published, and no reply carried a rate limit or `Retry-After` header.
About 100 requests per run at up to one a second drew no refusal.

| request | reply |
|---|---|
| `GET /api/market/RealTimeHandicapFull` | HTTP 405 with an empty body |
| `POST /api/market/NoSuchCall` | HTTP 404 with an empty body |
| `POST /api/market/RealTimeHandicap` without `contractId` | HTTP 200, `{"success":false,"errorCode":40000,"msg":"The contractId field is required."}` |
| `POST /api/account/GetMyHandlingFee` without a login | HTTP 200, `{"success":false,"errorCode":40003,"msg":"token invalid."}` |

Errors come with HTTP 200, so a poller reads `success` and `errorCode`, not the status code.

## 7. Server time and clock offset

No server time call was found.
The `Date` header was 0.07 to 0.47 s behind the local clock in three readings, and 0.0 to 0.81 s behind in the second run, within its one second resolution.
The newest row `timestamp` in each reply was 0.10 to 0.43 s behind local time.

## 8. Recommended poller shape

- URL: `POST https://ctapi.klicklx.com/api/market/RealTimeHandicapFull` with an empty body, once a second.
  One reply covers every contract in about 185 ms.
- Row mapping: as in section 3, with `forecastFundRate` as the upcoming rate and `nextFundingAt` from the arrival time plus `distanceSettlementTime`, rounded to the hour.
- Key rows on `contractId`, the same id the socket uses.
- Skip the six `symbolType` 5 contracts.
- Treat `success` false as a failed poll, since the status is 200.
- An alternative is the socket's `ShowRealTimeHandicapAsync` push, which carries the same fields for every contract, see [`websocket.md`](./websocket.md) section 2.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.klicklx.com/client/static/js/Page.c725b912.chunk.js`, which holds the host config, and the futures app `https://futures.klicklx.com/assets/index.7f891b75.js` with its chunk `index.554fb3b4.js`, which hold the market calls | 2026-10-09 |
| S2 | `POST https://api.klicklx.com/api/idcm/foundation/app/ApiDocument/GetApiDocumentTitleList` and `GET .../ApiDocument/GetApiDocument?id=` 2, 5, 7, 9, 14 and 15 | 2026-10-09 |
| S3 | The calls on `https://ctapi.klicklx.com/api/`, probed by [`rest-probe.py`](../../../scripts/probes/venues/klicklx/rest-probe.py) | 2026-10-09 |
