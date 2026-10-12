# Ripio REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 03:09 to 03:21 UTC, from the development host near Seattle, through the user's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada, so every access result below is from that Canadian exit.

This profile covers the public REST API of Ripio Trade, version 4.
Ripio Trade lists no perpetual, so the profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot catalog, no anchor, and the REST book, see [`fees.md`](./fees.md) section 3.
All probed numbers come from [`rest-probe.py`](../../../scripts/probes/venues/ripio/rest-probe.py), here P1, and the documentation is the v4 Redoc page at https://apidocs.ripiotrade.co/, here S1.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base URL | `https://api.ripiotrade.co/v4`, pattern `https://api.ripiotrade.co/{version}/{method}` | S1 |
| resolved address | `api.ripiotrade.co`, `ws.ripiotrade.co` and `apidocs.ripiotrade.co` all resolve to 104.18.30.189 and 104.18.31.189, Cloudflare | P1 |
| retired host | `api.exchange.ripio.com`, the host of the old CCXT class, has no DNS address | P1 |
| cold request | 165 ms and 257 ms for the first `GET /public/server-time` of each run | P1 |
| warm requests | 112 to 333 ms for `server-time` and `level-2`, with one call over 1 s in each run, 1,154 ms for `level-2` in the first and 1,134 ms for `server-time` in the second | P1 |
| headers | `Server: cloudflare`, `CF-Cache-Status: DYNAMIC`. No rate limit header and no `Age` | P1 |
| documentation | `https://apidocs.ripiotrade.co/` answered 200 with 1,311,247 bytes. Its own link to `../v3` and the address `/v4` answered 403 with an S3 style `AccessDenied` XML body | P1 |

## 2. Catalog

### The instruments call

`GET /v4/public/pairs` "Lists the active currency pairs available in the platform", with optional `pair` and `countries` filters, S1.
It returned 20 pairs, all with `enabled` true, in 5,830 bytes, in both runs, P1.

| quote | pairs |
|---|---|
| USDC | 11: `BTC_USDC`, `ETH_USDC`, `LTC_USDC`, `LINK_USDC`, `UNI_USDC`, `WLD_USDC`, `HYPE_USDC`, `LAC_USDC`, `RPC_USDC`, `PYUSD_USDC`, `EURC_USDC` |
| BRL | 5: `BTC_BRL`, `ETH_BRL`, `SOL_BRL`, `USDT_BRL`, `USDC_BRL` |
| ARS | 2: `USDT_ARS`, `USDC_ARS` |
| USDT | 1: `USDC_USDT` |
| COP | 1: `USDC_COP` |

Each row has `symbol`, `base`, `quote`, `base_name`, `quote_name`, `enabled`, `price_tick`, `amount_tick`, `min_amount`, `min_value`, `base_decimal_places`, `quote_decimal_places` and `countries`.
The first run's rows also carried `max_price_variation`, and the second run's rows did not, so a loader must not require it, P1.
The only status field is `enabled`.
`countries` limits who can trade a pair, as `BTC_BRL` for Brazil only, `USDT_ARS` for Argentina only, and `BTC_USDC` for Brazil, Argentina, Chile, Uruguay, Colombia, México and Spain, P1.
`?countries=BR` returned 17 pairs, P1.
`GET /v4/public/currencies` returned 32 currencies, all `active`, with networks and withdrawal minimums, P1.

| pair | price tick | amount tick | min amount | min value |
|---|---|---|---|---|
| `BTC_USDC` | 0.01 | 0.00000001 | 0.00000969 | 0.8 |
| `ETH_USDC` | 0.1 | 0.00001 | 0.00032 | 0.8 |
| `USDC_USDT` | 0.0001 | 0.001 | 1.997 | 2 |
| `BTC_BRL` | 1 | 0.000001 | 0.000012 | 5 |
| `USDT_ARS` | 0.1 | 0.01 | 0.93 | 1500 |

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no Ripio class, see [`fees.md`](./fees.md) section 8.
A loader would map `symbol` to `rawMarketId`, which is the spelling both the socket topic and `body.pair` use, `base` and `quote` to the unified codes, and sizes in base currency to a contract size of 1.
No pair is listed twice.

### Size unit and the settlement family

Book `amount` is in base currency on REST and on the socket.
Twelve pairs are in the engine's USD, USDC and USDT settlement family, and the liquid ones by 24 h quote volume in the first run were `ETH_USDC` at 371,241 USDC, `BTC_USDC` at 352,782 USDC, `UNI_USDC` at 64,508 USDC and `USDC_USDT` at 41,061 USDT, P1.
The quoted spread on `BTC_USDC` was 57.1 bps and on `ETH_USDC` 25.7 bps in the first run's `tickers` reply, P1.

## 3. Anchor

Ripio Trade publishes no index price, no mark price and no funding rate.
No field of `GET /v4/public/tickers` contains "index", "mark" or "fund", P1, and S1 documents none.
There is no bulk call that carries any `AnchorRow` column, and no anchor poller is recommended.

The reference prices it does publish are these.

| call | fields | coverage | size and time |
|---|---|---|---|
| `GET /v4/public/tickers` | `bid`, `ask`, `last`, `first`, `high`, `low`, `volume`, `quote_volume`, `trades_quantity`, `price_change_percent_24h`, `is_frozen`, `date` | all 20 pairs in one reply | 8,116 bytes, 356 ms |
| `GET /v4/public/tickers/{pair}` | the same for one pair | one pair | not timed |
| `ticker@BASE_QUOTE` on the socket | the same, plus `conversions`, the 24 h volume and last price in BRL, USD, ARS, CLP and other currencies | one pair per topic | see [`websocket.md`](./websocket.md) |

`date` in a ticker row is the time of the last trade, as `2026-10-10T01:55:15.743Z` for `BTC_BRL` at 03:09 UTC, P1.

## 4. Anchor semantics

None of the anchor semantics apply.
With no mark, a Ripio leg would read as mark 0, and the reader refuses such a route as `NoMark` at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 37 and 38.

## 5. REST book snapshot

| call | result | source |
|---|---|---|
| `GET /v4/public/orders/level-2?pair=BTC_USDC` | 92 bids and 94 asks in the first run, 89 and 95 in the second, `{amount, price}` levels, plus `timestamp` and `hash` | P1 |
| `limit=20` | 20 levels a side | P1 |
| `limit=max` | 92 and 95, then 90 and 95, the same depth as the default within the changes between calls | P1 |
| `limit=0` | 200 with a full book, so 0 is not refused | P1 |
| `GET /v4/public/orders/level-3?pair=BTC_USDC` | 100 orders a side with `id`, `amount` and `price` | P1 |
| default limit | 100, described as "Maximum number of records to return per request. Can specify 'max' to use the service maximum." | S1 |

Bids come by descending price and asks by ascending price, P1.
On level 3, prices are not strictly ordered because several orders share a price.
S1 warns that "The `Public` endpoints have a delay (cache) of up to 30 seconds".
In 28 polls of the `limit=20` book 2 s apart, the book changed 26 times in the first run and 25 in the second, and the reply `timestamp` trailed the local clock by at most 0.1 s, so no 30 s cache showed on this call, P1.
The REST `hash` is a 64 bit decimal string, unlike the 32 bit hash on the socket.

## 6. Rate limits and errors

S1 sets the limits per user: 1 request per second or 86,400 a day without approved documents, and 3.5 per second or 302,400 a day with them.
The "Public" section says the public endpoints "have a reduced requests limit and a 30 seconds cache", without a number.
The probe sent at most one request per second and never met a limit.

| condition | status and body | source |
|---|---|---|
| per second limit | 429, `{"message": "Too many requests"}` | S1 |
| daily limit | 429, `{"message": "Limit Exceeded"}` | S1 |
| unknown pair on `level-2` | 400, `{"error_code":40000,"message":"Invalid currency pair"}` | P1 |
| missing `pair` on `level-2` | 400, the same body | P1 |
| unknown pair on `tickers/{pair}` | 400, `{"error_code":40000,"message":"Invalid pair"}` | P1 |
| unknown path | 404, `{"code":404,"data":null,"error":"NotFoundException","message":"Cannot GET /v4/public/nope"}` | P1 |
| private call without a token | 401, `{"error_code":40100,"message":"Invalid token"}` | [`fees-probe.py`](../../../scripts/probes/venues/ripio/fees-probe.py) |
| maintenance | 503 | S1 |

No `Retry-After` is documented, and none was seen.
The documented error envelope is `{"error_code", "message", "data"}`, and the 404 route uses a different one.

## 7. Server time and clock offset

`GET /v4/public/server-time` returns `{"data":{"timestamp":<ms>},"error_code":null,"message":null}`.
Six readings over two runs, against the local midpoint, gave offsets of +26 to +92 ms with round trips of 116 to 247 ms, P1.

## 8. Recommended poller shape

No anchor poller, since there is no index, mark or funding.
A future spot leg would load the catalog from `GET /v4/public/pairs` at start, keep the pairs whose quote is USDC or USDT and whose `countries` include the account's country, and use the socket for books, see [`websocket.md`](./websocket.md) section 8.
`GET /v4/public/orders/level-2?pair=<symbol>&limit=max` is the REST fallback for one book.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S1 | Ripio Trade API Documentation v4.0, a Redoc page whose OpenAPI document is embedded in the HTML | https://apidocs.ripiotrade.co/ | 2026-10-10 03:00 UTC | paths, parameters, cache note, limits, error codes |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/ripio/rest-probe.py), modes `access`, `catalog`, `book`, `cache` and `time`, run twice | | 2026-10-10 UTC | every probed value above |
