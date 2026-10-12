# Dzengi REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 04:07 to 04:30 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

Dzengi lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/dzengi/rest-probe.py) unless a source row is named.
The probe makes about 50 requests per run, and it ran five times, far inside the published 1,200 request weight per minute.

## 1. Host and latency from this machine

| host | role | resolved address | cold request | warm request |
|---|---|---|---|---|
| `api-adapter.dzengi.com` | REST and WebSocket, S2 | `172.66.40.96`, `172.66.43.160` and two IPv6 addresses, Cloudflare | 251 to 933 ms for `GET /api/v2/time` on a new TLS connection, 13 of 15 between 251 and 303 ms | median 215 to 245 ms on one keep-alive connection, with one outlier of 896 ms |
| `demo-api-adapter.dzengi.com` | demo, S2 | the same addresses | not called | |
| `api-adapter.backend.dzengi.com` | named in the docs' WebSocket code sample, S3 | does not resolve | | |
| `api-adapter.backend.currency.com` | the old Currency.com host CCXT used | resolves to other Cloudflare addresses | TLS handshake failure, `SSLV3_ALERT_HANDSHAKE_FAILURE` | |

Access from the Canadian exit was open.
`https://dzengi.com/cdn-cgi/trace` reported `loc=CA` and `colo=SEA`, so Cloudflare serves this zone from Seattle even though the exit is in Vancouver.
`https://dzengi.com/`, `https://dzengi.com/api` and the Swagger JSON all answered 200.
No call returned 403, 429 or a region message.
Canada is not among the excluded regions, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api-adapter.dzengi.com/api/v2/exchangeInfo`, public, S1.
It answered 889,671 to 889,681 bytes in 313 to 846 ms, uncompressed, with `cf-cache-status: DYNAMIC`, in four of five runs.
In the other run it answered a different catalog of 652,478 bytes, see below.
It carries `rateLimits`: `REQUEST_WEIGHT` 1,200 per minute, `ORDERS` 10 per second and 864,000 per day.

| measure | value |
|---|---|
| rows | 1,230 |
| unique symbols | 921 |
| symbols listed twice | 309, every copy identical to the first |
| status values | `TRADING` 187, `BREAK` 730, `HALT` 4 |
| spot crypto `TRADING` | 112 |
| spot crypto by quote | USD 56, USDT 30, BTC 18, BYN 5, EUR 3 |
| spot crypto bases | 56, of which 30 are listed against both USD and USDT |
| Leverage crypto `TRADING` | 75, by quote USD 51, BTC 17, BYN 4, EUR 3 |
| everything else | shares, currencies, commodities and indices, all `BREAK` at probe time, a Saturday at 04:20 UTC |

The table is the 1,230 row catalog that four runs got.
The fifth run got 925 rows with no duplicates, 925 unique symbols, and 78 `TRADING` crypto Leverage symbols instead of 75.
Spot crypto was the same in both, 112 `TRADING` pairs with the same `exchangeFee` split.
So successive calls can reach backends with different catalogs, and a catalog refresh should not treat a vanished symbol as delisted on one reply.

`marketType` is `SPOT` or `LEVERAGE`, and `assetType` is `CRYPTOCURRENCY`, `EQUITY`, `CURRENCY`, `COMMODITY` or `INDEX`.
A spot row carries `exchangeFee`, and a Leverage row carries `tradingFee`, `longRate`, `shortRate` and `swapChargeInterval` instead.
No row has a key naming a mark, an index, funding, an expiry or a contract size.

A spot row, trimmed:

```json
{"symbol": "BTC/USDT", "name": "Bitcoin / Tether", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT", "filters": [{"filterType": "LOT_SIZE", "minQty": "0.0001", "maxQty": "100", "stepSize": "0.0001"}, {"filterType": "MIN_NOTIONAL", "minNotional": "9"}], "marketType": "SPOT", "tickSize": 0.01, "exchangeFee": 0.2, "assetType": "CRYPTOCURRENCY"}
```

A Leverage row, trimmed:

```json
{"symbol": "BTC/USD_LEVERAGE", "name": "BTC/USD", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USD", "quoteAssetId": "USD_LEVERAGE", "marketType": "LEVERAGE", "longRate": -0.01, "shortRate": 0.01, "swapChargeInterval": 480, "tickSize": 0.05, "tradingFee": 0.06, "assetType": "CRYPTOCURRENCY"}
```

### Mapping without CCXT

Dzengi has no CCXT 4.5.68 class, see [`fees.md`](./fees.md) section 8, so a catalog would be built from this call directly.

| engine field | source |
|---|---|
| `rawMarketId` | `symbol`, such as `BTC/USDT`, which is exactly what the socket and the REST book take |
| `base`, `quote` | `baseAsset`, `quoteAsset` |
| `active` | `status` equal to `TRADING` |
| `contractSize` | none, sizes are in the base asset, so 1 |
| duplicates | drop repeated rows by `symbol` |

USD here is Dzengi's own currency token, priced and charged as a currency, not as a stablecoin, see [`fees.md`](./fees.md) section 2.
So BTC/USD and BTC/USDT are separate books with separate fees, and a spot leg that treats USD and USDT as one family must pick one with a market filter.

### Leverage catalog, named only

The 75 `TRADING` crypto Leverage symbols carry the `_LEVERAGE` suffix when they name a currency pair, S3.
Their REST book is one level a side with `lastUpdateId` 0, see section 5.

## 3. Anchor

Dzengi publishes no index, mark or funding.
The Swagger lists no such call, S1.
`GET /api/v2/premiumIndex`, `/api/v2/fundingRate` and `/api/v2/markPrice` answered 404 with `{"timestamp": ..., "status": 404, "error": "Not Found", "message": "", "path": "/api/v2/premiumIndex"}`.
The nearest public reference prices are these.

| call | content | probed |
|---|---|---|
| `GET /api/v2/ticker/24hr` with no symbol | every symbol's last, bid, ask and 24 h statistics | 282,971 to 283,032 bytes and 910 rows when it answers. Over five runs it answered on the first attempt in two, after one empty reply in one, and returned `[]`, 2 bytes, on every attempt in the other two, one attempt and then four attempts 3 s apart. The `closeTime` of rows on break was up to about 103,000 s old. |
| `GET /api/v2/ticker/24hr?symbol=BTC/USDT` | one symbol | always answered, in 263 to 291 ms |
| `GET /api/v2/klines` | candles | `[[1791605880000, "82675.99", "82682.89", "82673.49", "82673.89", 27], ...]` |

The ticker reports `volume` "0" on all 106 spot crypto rows it returns, BTC/USDT included, while BTC/USD_LEVERAGE reports 19.9279 BTC.
The Leverage mode's `longRate` and `shortRate` are a venue charge, not a funding rate, see [`fees.md`](./fees.md) section 6.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable.
Dzengi has no index basket, no mark price and no funding, as section 3 shows.

## 5. REST book snapshot

`GET /api/v2/depth?symbol=BTC%2FUSDT&limit=N`, public, S1.

| check | result |
|---|---|
| default depth | 20 a side |
| `limit` 5 | 5 a side |
| `limit` 100 and 1000 | still 20 a side, so 20 is the ceiling |
| level shape | `[price, size]` as JSON numbers, `[[82678.49, 6.0], [82666.49, 12.0]]` |
| level order | bids descending, asks ascending |
| size unit | base asset |
| `lastUpdateId` | a millisecond timestamp, 0.9 to 5.0 s behind the local clock |
| caching | `cf-cache-status: DYNAMIC`. Five calls 0.5 s apart gave 3 distinct `lastUpdateId` values in an order that went backwards, so successive replies may come from different backends. |
| Leverage symbol | `BTC/USD_LEVERAGE` returns one level a side, `{"lastUpdateId": 0, "asks": [[82608.65, 5.0]], "bids": [[82608.5, 5.0]]}`, whatever the limit |
| unknown symbol | HTTP 400 `{"code": -1128, "msg": "symbol not found NOPE/USD"}` |
| reply size and time | 719 bytes, 266 ms at 20 a side |

The BTC/USDT book top five levels a side were 6, 12, 24, 48 and 96 BTC, 12 USDT apart, and the levels below were 0.0001 to 0.01 BTC, which reads as a market maker ladder over a thin book.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| request weight | 1,200 per minute | `exchangeInfo` `rateLimits`, and S1 |
| limit status | 429 on a rate limit, 418 after continued requests following a 429, 403 when the WAF limit is hit | `Published`, S4 |
| `Retry-After` | not seen, no limit was reached | `Probed` |
| rate limit headers | none on any reply | `Probed` |
| error shape | `{"code": -1128, "msg": "..."}` with HTTP 400, for an unknown symbol or an invalid kline interval | `Probed` |
| signed call without a signature | HTTP 400 `{"code": -1102, "msg": "timestamp : must not be null"}`, for `/api/v2/currencies` and `/api/v2/leverageSettings` | `Probed` |
| unknown path | HTTP 404 with a Spring style body `{"timestamp", "status", "error", "message", "path"}` | `Probed` |

`GET /api/v2/tradingFees` answered without credentials.
It returned 1,230 rows and 140,088 bytes in three runs and 925 rows and 92,817 bytes in two.
Its `fee` for BTC/USDT and ETH/USDT is 0.075, which is the Leverage crypto trade fee and not the 0.2 spot commission, see [`fees.md`](./fees.md) section 9.

## 7. Server time and clock offset

`GET /api/v2/time` returns `{"serverTime": 1791606180215}`, and `/api/v1/time` answers the same.
Server minus the local midpoint had a median of 32 to 40 ms over five samples per run, with one outlier of 342 ms.

## 8. Recommended poller shape

No anchor poller, because there is nothing to anchor to.
A future spot adapter would need two REST calls.

| call | use | interval |
|---|---|---|
| `GET /api/v2/exchangeInfo` | catalog, `status`, `exchangeFee` | at start and every few hours, it is 890 KB |
| `GET /api/v2/depth?symbol=...` | seed each book after the socket ack | once per symbol per (re)subscribe |

Skip `ticker/24hr` without a symbol, which sometimes returns `[]`, and `tradingFees`, which disagrees with `exchangeInfo`.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | <https://apitradedoc.dzengi.com/v2/api-docs?group=public-api>, the Swagger behind <https://apitradedoc.dzengi.com/swagger-ui.html>, retrieved 2026-10-09 | every call and its parameters |
| S2 | <https://dzengi.com/general-rest-api-information>, retrieved 2026-10-09 | base URLs |
| S3 | <https://dzengi.com/general-websocket-api-information>, retrieved 2026-10-09 | the backend host in the code sample, the `_LEVERAGE` suffix rule |
| S4 | <https://dzengi.com/general-rest-api-information>, section "HTTP Return Codes", retrieved 2026-10-09 | 403, 418 and 429 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/dzengi/rest-probe.py) | every probed value |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/dzengi/ws-probe.py) | the socket's book, see [`websocket.md`](./websocket.md) |
