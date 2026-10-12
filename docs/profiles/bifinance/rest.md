# BiFinance REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 (2026-10-10 UTC), from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the public perpetual REST surface of BiFinance (no CCXT id).
BiFinance documents no futures REST API.
The only documented API is a spot market maker API keyed by `appKey` (S3).
Every call below is the web app's own API under `https://www.bifinance.com/api`, found in the public JS bundle (S1) and read by [`rest-probe.py`](../../../scripts/probes/venues/bifinance/rest-probe.py).
The first run started 2026-10-10 02:32 UTC and the second pass rerun 02:41 UTC, and the numbers below are from the second pass unless both are given.
Every call is a `POST` with a JSON body, and every contract call needs the web app's request signature, section 6.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `www.bifinance.com`, resolved to `174.35.86.179` and `2607:3f40:ff06::117` |
| front | nginx, with an `x-req-id` header whose value contains `PS-LAX` |
| unsigned spot `POST /api/market/tickers`, 197,361 bytes | first 428 ms, warm median 393 ms over 5 |
| signed `POST /api/contract-market/get-all-contract-coinmarket`, 34,841 bytes | first 339 ms, warm median 345 ms over 5 |
| `https://api.bifinance.com/` | 200 with the default nginx welcome page, so not an API host |

## 2. Catalog

### The instruments call

`POST /api/contract-market/get-all-contract-coinmarket` with body `{}`, signed, is what the web app's `getContractSymbolsAll` calls (S1).
It returned 55 contracts, all with `marketCoinName USDT` and `onDealing 1`.
Fields: `id`, `coinMarket`, `originCoinMarket`, `baseCoinName`, `marketCoinName`, `faceValue`, `pricePrecision`, `amountPrecision`, `limitNumber`, `limitNumberMin`, `muchLimitNumber`, `shotLimitNumber`, `priceFloatingLimit`, `maxLever`, `minLever`, `stepGear`, `onDealing`, `isHot`, `lastPrice`, `lastPriceCny`.

| contract | `originCoinMarket` | `faceValue` | `pricePrecision` | `amountPrecision` | `maxLever` |
|---|---|---|---|---|---|
| BTCUSDT | CONTRACT/BTCUSDT | 0.001 | 1 | 3 | 125 |
| ETHUSDT | CONTRACT/ETHUSDT | 0.01 | 2 | 2 | 125 |
| SOLUSDT | CONTRACT/SOLUSDT | 0.1 | 3 | 1 | 50 |
| TSLAUSDT | CONTRACT/TSLAUSDT | 0.01 | 2 | 2 | 20 |
| PAXGUSDT | CONTRACT/PAXGUSDT | 0.001 | 2 | 3 | 50 |
| CLUSDT | CONTRACT/CLUSDT | 0.01 | 2 | 2 | 50 |
| 1000PEPEUSDT | CONTRACT/1000PEPEUSDT | 1000 | 7 | 0 | 20 |

The 55 are SPCX, SKHY, BTC, ETH, TSLA, BNB, SOL, NVDA, DOGE, AAPL, TRX, UNI, FIL, GOOGL, ORDI, META, MEME, XRP, LINK, AVAX, MSFT, BCH, WLD, OP, ARB, ENA, BOME, 1000SHIB, 1000PEPE, XTZ, APE, BFT, SAND, SUI, LTC, TRUMP, ALGO, ONDO, 1000BONK, NEAR, PUMP, WLFI, PAXG, XAG, AMZN, MSTR, TSM, BABA, HOOD, AVGO, ORCL, WMT, JPM, CSCO and CL, each against USDT.
The contract tickers, `POST /api/contract-market/tickers` with `{"coinMarketType": "CONTRACT"}`, mark 18 of them `stockType US`.
BFTUSDT is the venue's own token.
There is no status field other than `onDealing`, and no listing or delisting time on the catalog.

### How CCXT maps it

There is no CCXT class in 4.5.68 or on master ([`fees.md`](./fees.md) section 8), so the engine would need its own catalog loader, as the Biconomy and BitradeX adapters have.
A loader would set the raw market id to `coinMarket` (`BTCUSDT`), which lowercased is the socket topic's symbol and as is the anchor calls' `coinMarket`.
`contractSize` would be `faceValue`, which matches the book's size unit by magnitude ([`websocket.md`](./websocket.md) section 4).
Every contract is linear and USDT-settled, and no pair is listed twice.

### Size unit, pairs listed twice, and price scale

The `1000SHIB`, `1000PEPE` and `1000BONK` contracts are quoted per 1,000 tokens, and 1000PEPEUSDT also has `faceValue 1000`.
Whether one 1000PEPEUSDT contract is 1,000 of the 1000PEPE unit or 1,000 PEPE is not stated, and this profile leaves it open.
Stock, gold (PAXG), silver (XAG) and crude oil (CL) contracts share the one family.

## 3. Anchor

BiFinance has no bulk anchor call.
Index and mark come one contract at a time, and so does funding.

| column | call | field | probed |
|---|---|---|---|
| `index` | `POST /api/contract-account/usdt/contract/marked/price` `{"coinMarket": "BTCUSDT"}` | `indexPrice` | 55 calls, median 305 ms each |
| `mark` | the same call | `markedPrice` | equal to `indexPrice` on 55 of 55 |
| `fundingRate` | `POST /api/contract/rateHistory/currentRate` `{"coinMarket": "BTCUSDT"}` | `rate` | 55 calls, median 338 ms each, `"0"` on 55 of 55 |
| `fundingIntervalHours` | none, inferred from the history | 8 | `historyTime` steps of 28,800 s |
| `nextFundingAt` | the same `currentRate` call | `historyTime` in Unix s, here 1791619200, 2026-10-10 08:00 UTC, and `nextTime` the seconds left | 55 of 55 named 08:00 UTC |

A reply is 132 to 146 bytes for the mark call and 188 to 194 bytes for the funding call.
The mark call with no `coinMarket` answers HTTP 200 with `{"code": 500, "message": "They system is busy, please try again later"}`, and the funding call with no `coinMarket` returns all nulls, so neither has a bulk form.
The contract tickers call returns all 55 contracts at once in 32,622 bytes, but carries no mark, index or funding field.
The socket also publishes mark and index on `usdt-marked-price-<sym>`, one topic per contract, every 1.4 s at the median ([`websocket.md`](./websocket.md) section 4).

## 4. Anchor semantics

### Index

No index formula or basket is published.
The `indexPrice` equalled `markedPrice` on every reading of both runs: 55 of 55 contracts in mode `anchor`, and 37 and 36 polls each on BTCUSDT and TSLAUSDT in mode `poll`.
Four comparisons per run against Binance USD-M BTCUSDT during mode `poll` put the BiFinance index 4 to 5 ppm from Binance's mark and book mid in the first run.
In the second run, while Binance fell about 15 USDT, the BiFinance value held at 82605.3 for three comparisons and sat 137 to 253 ppm above Binance's mark.
In both runs it was 239 to 502 ppm below Binance's own index, a spot basket.
So the published "index" follows a perpetual price close to Binance's, with lag, and is not a spot index.

### Mark

No mark formula is published.
The mark is the same number as the index, and it followed the venue's last trade price in the captured frames, `markedPrice 82589.5` beside a book `lastPrice 82589.6`.

### Funding

No formula, cap or floor is published.
`currentRate` returned `"0"` for all 55 contracts, and also `"0"` with a 2026-10-10 08:00 UTC `historyTime` for the unknown symbol `NOPEUSDT`, so the value is a default, not a computed rate.
`POST /api/contract/rateHistory/page` shows 8 hourly settlements, 2,459 records on BTCUSDT, whose newest record on BTCUSDT, ETHUSDT, SOLUSDT, TSLAUSDT and PAXGUSDT is 2026-04-27 16:00 UTC.
A `startTime` filter from 2026-04-28 00:00 UTC returned 0 BTCUSDT records.
So funding has not settled for more than five months, and whether the published rate is the upcoming or the last settled one cannot be told.

### How often each number changed

Mode `poll` read BTCUSDT and TSLAUSDT once a second for 60 s, which gave 37 and then 36 polls each, because every round made two calls of about 300 ms.
BTCUSDT changed 11 times in both runs, with 4 and then 8 distinct values, and TSLAUSDT changed 3 and then 5 times with 4 distinct values.
The funding rate did not change, and could not, being a constant.

## 5. REST book snapshot

| call | body | levels | size field | reply |
|---|---|---|---|---|
| `POST /api/contract-market/deeps` | `{"type": "trade", "coinMarket": "CONTRACT/BTCUSDT"}` | 20 bids, 20 asks | `cumulativeCommissionQuantity` | 4,289 bytes, 321 ms |
| `POST /api/contract-market/depth` | `{"type": "paint", "coinMarket": "CONTRACT/BTCUSDT"}` | 30 bids, 30 asks | `lastNumber` | 2,813 bytes, 303 ms |

Bids descend, asks ascend, and neither book was crossed.
Adding `limit` or `size` of 5, 50 or 100 still returned 20 levels per side, so the depth is fixed.
The same top bid, 82588.1 for 2214, appeared in both calls, and Binance USD-M's book a moment later was 82573.00 bid and 82573.10 ask, about 180 ppm lower.
An unknown contract returns HTTP 200 with `bids null` and `asks null`.
No cache header was seen.

## 6. Rate limits and errors

No rate limit is published, and 30 signed catalog calls back to back all answered 200 with code 1, median 341 ms and max 374 ms, with no rate limit or `Retry-After` header.

The request signature is the main error source.
The web app's request interceptor (S1, `encrypt.requestSign`) adds `time`, `deviceType 3` and `signature` headers.
The signature is the MD5 of the body's keys sorted, plus `time` equal to the header time minus 688, joined as `k=v` with `&`, plus `key=<constant>`, and the constant is assembled in the bundle from three string pieces.
The probe reproduces it exactly and sends no account token.

| case | answer |
|---|---|
| contract call with no signature headers | HTTP 500, Spring error body `{"timestamp", "path", "status": 500, "error": "Internal Server Error", "requestId"}` |
| contract call with a wrong signature | HTTP 200, `{"code": 710, "message": "com.bztex.response.code.open.validation.failed"}` |
| spot `market/tickers`, `market/coinMarkets`, `market/deeps` with no signature | HTTP 200, code 1 |
| spot fee table `order/get-exchange-fee-levels` with no signature | HTTP 500 ([`fees.md`](./fees.md) P1) |
| documented `market/market-user/tickers` and `depth` with no `appKey` | HTTP 200, `{"code": 713, "message": "com.bztex.response.code.open.incorrect.parameters"}` |
| mark for an unknown contract | HTTP 200, `{"code": 30058, "message": "Tag price is update"}` |
| success | HTTP 200, `{"code": 1, "message": "success", "data": ..., "extra": null, "success": true}` |

Errors come inside an HTTP 200 body, except the missing signature case.
An adapter would have to forge the web app's signature on every contract call, and a new bundle could change the constant, the offset or the header names without notice.

## 7. Server time and clock offset

No server time call was found.
The HTTP `Date` header matched the local clock to the second, and the Spring error body's `timestamp` is ISO 8601 UTC with milliseconds.

## 8. Recommended poller shape

Not recommended.
The venue lists 55 live USDT perpetuals and its socket book is usable, but the anchor fails on substance.

- The index is not an index: it equals the mark on every reading, follows a perpetual price close to Binance's, and sat 239 to 502 ppm below Binance's spot index.
- The funding rate is a constant default of 0, returned even for a contract that does not exist, and no settlement has been recorded since 2026-04-27 16:00 UTC.
- Every catalog, mark and funding call needs the web app's forged request signature, and there is no bulk call, so one round is 110 calls of about 0.3 s.

If it were built anyway, the shape would be a catalog loader on `get-all-contract-coinmarket`, mark and index from the socket topic `usdt-marked-price-<sym>` through [`../../../server/src/venues/socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs), and one `currentRate` call per contract on a slow schedule for the funding time, with `fundingIntervalHours` fixed at 8.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | web app bundle `https://www.bifinance.com/assets/index-411dd017.js`, API paths, the axios instance at `serveUrl` `https://{domain}/api`, the request interceptor and `requestSign` | 2026-10-09 |
| S3 | API documentation chunk `https://www.bifinance.com/assets/DocsApi-96558f87.js`, the market maker spot API, base URL `https://www.bifinance.com/api` | 2026-10-09 |
| S4 | futures page chunks `https://www.bifinance.com/assets/Futures-f5abc5a8.js` and `CoinStockFutures-94efea10.js`, call bodies for `contractMarketDepth`, `contractMarketDeeps`, `markedPrice` and `currentRate` | 2026-10-09 |
| S9 | Binance USD-M `https://fapi.binance.com/fapi/v1/premiumIndex` and `ticker/bookTicker`, for comparison only | 2026-10-10 UTC |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/bifinance/rest-probe.py), modes host, catalog, anchor, poll, funding, book, errors and limits | 2026-10-10 UTC |
