# Coinut REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:42 to 05:06 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Coinut lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers its spot catalog and its REST book.
The API is the legacy exchange API, which still answers although the exchange is no longer a product on the website, see [`fees.md`](./fees.md) section 1.
Every probed claim comes from [`rest-probe.py`](../../../scripts/probes/venues/coinut/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S10 are those of [`fees.md`](./fees.md) section 10, and P1 to P3 are its probes.

## 1. Host and latency from this machine

| item | probed |
|---|---|
| API host | `https://api.coinut.com`, S1 |
| resolved addresses | 104.26.0.35, 104.26.1.35, 172.67.70.28 and three IPv6 addresses in 2606:4700:20::, all Cloudflare. `coinut.com` and `wsapi.coinut.com` resolve to the same set |
| edge | `server: cloudflare`, `cf-ray` at the YVR edge |
| cold request | GET `/` answered 200 `{"status":["OK"]}` in 221 to 287 ms on a new connection over three runs |
| warm request | POST `hb` over a kept connection, median 204 to 213 ms over 8 calls, in each of three runs |
| request shape | every call is a POST of one JSON object to `/` with `request` and `nonce`, S1. A GET with a query string answers `{"status":["OK"]}` and ignores the query |
| refusals | none on `api.coinut.com`, `wsapi.coinut.com` or `coinut.com`. The help center HTML at `help.coinut.com/hc/en-us` answered 403 with a Cloudflare challenge (`cf-mitigated: challenge`, "Just a moment..."), while its JSON API under `/api/v2/help_center/` answered 200. The fee article HTML page answered 200 on one run and the same challenge on the rerun, P1 and P3 |

## 2. Catalog

### The instruments call

`{"request":"inst_list","sec_type":"SPOT","nonce":...}` returns every spot instrument in one 2,064 byte reply, in 202 to 233 ms, S1.
The reply maps each symbol to a one element list of `base`, `quote`, `inst_id` and `decimal_places`.

| item | probed |
|---|---|
| instruments | 26 |
| by quote | USDT 6, XSGD 6, BTC 5, LTC 4, CAD 4, XIDR 1 |
| symbol | base plus quote with no separator, such as `BTCUSDT`, on all 26 |
| identifier for the book and tick calls | the integer `inst_id`, such as 490589 for `BTCUSDT`. The wiki says it "will not change over time", S1 |
| status field | none. A delisted pair drops out of the list, as the USD pairs did in 2023, S4 |
| lot size, minimum size, tick size | none, apart from `decimal_places` for the price |
| pair listed twice | none |
| other `sec_type` values | `OPTION` and `FUTURE` answer `OK` with no instruments. `FUTURES`, `SWAP`, `PERPETUAL` and `MARGIN` answer `JSON_VALIDATION_FAILED` |

### How CCXT maps it

There is no CCXT class in 4.5.68 or on master, see [`fees.md`](./fees.md) section 8.
A catalog would have to be built from `inst_list`, keyed by `inst_id`.

### Trading activity

`inst_tick` and `inst_trade` were read once for each instrument.
The newest trade on any instrument is 2026-02-04 23:54:48 UTC on `BTCUSDT`.
Only 6 of 26 instruments traded in the 365 days before the probe, and none in the last 90 days.

| symbol | `inst_id` | best bid | best ask | last | last trade, UTC |
|---|---|---|---|---|---|
| `BTCCAD` | 1801843 | 0 | 0 | 9698.1 | 2020-01-05 |
| `BTCUSDT` | 490589 | 111024.84 | 111111 | 111024.84 | 2026-02-04 |
| `BTCXIDR` | 2372512 | 1906060 | 1066524605.2 | 1000000000 | 2024-03-04 |
| `BTCXSGD` | 2372505 | 70511 | 135000 | 150000 | 2025-08-14 |
| `DAIXSGD` | 2372510 | 0.001 | 1.15 | 1.137 | 2024-11-09 |
| `ETCBTC` | 3 | 0.000146 | 0.000423 | 0.000146 | 2025-12-12 |
| `ETCLTC` | 490588 | 0.13 | 0.3 | 0.5 | 2025-11-27 |
| `ETCUSDT` | 490592 | 12 | 38 | 38 | 2024-12-03 |
| `ETCXSGD` | 2372511 | 18.32 | 45 | 20.25 | 2024-11-28 |
| `ETHBTC` | 2 | 0.0021 | 0.05748 | 0.05748 | 2025-10-28 |
| `ETHCAD` | 1801845 | 0 | 0 | 241.7 | 2019-11-12 |
| `ETHLTC` | 490569 | 15 | 47 | 14 | 2025-10-11 |
| `ETHUSDT` | 490591 | 660 | 4990 | 2000 | 2025-04-07 |
| `ETHXSGD` | 2372507 | 2000 | 5000 | 5700 | 2025-08-14 |
| `LTCBTC` | 1 | 0.00091 | 0.0018 | 0.00199 | 2026-01-04 |
| `LTCCAD` | 1801844 | 0 | 0 | 76.12 | 2020-10-27 |
| `LTCUSDT` | 490590 | 50 | 51.22 | 120 | 2025-01-17 |
| `LTCXSGD` | 2372506 | 61.8 | 149.99 | 150 | 2025-01-17 |
| `USDTXSGD` | 2372508 | 1.34 | 88.8 | 1.36 | 2025-07-14 |
| `XMRBTC` | 852383 | 0.00202 | 0.015 | 0.00272 | 2024-02-06 |
| `XMRLTC` | 852384 | 1.275 | 3.448 | 2.404 | 2023-11-22 |
| `XMRUSDT` | 852382 | 66 | 182 | 142 | 2024-02-06 |
| `ZECBTC` | 1111977 | 0.0003 | 0.006 | 0.0008 | 2023-10-23 |
| `ZECCAD` | 1885998 | 0 | 0 | 80.47 | 2020-10-27 |
| `ZECLTC` | 1111978 | 0.142 | 1 | 0.427 | 2023-12-05 |
| `ZECUSDT` | 1111976 | 17 | 38 | 24.84 | 2024-01-03 |

The tick's `volume24` is not zero on any instrument, for example 0.0024 BTC on `BTCUSDT`, although no instrument traded in the last day.
That field is stale, and CoinMarketCap's daily volumes for Coinut cannot come from trades, see [`fees.md`](./fees.md) section 1.

## 3. Anchor

Not offered.
Coinut publishes no index, no mark price and no funding rate, because it lists no derivative.
The only reference price it publishes is the tick's `last`, the price of the most recent trade, and on every instrument that trade is months or years old.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The probe polled the `BTCUSDT` tick and its top 10 book once a second for 30 s.
It saw 1 distinct tick, with the same `trans_id` 38,974,911,423 throughout, and 1 distinct top 10 book.
Every tick carried a `timestamp` of 2026-10-08 16:24:13 UTC, 36.6 to 36.7 hours before the probe runs, so the tick timestamp is not the server's current time.

## 5. REST book snapshot

| item | probed |
|---|---|
| call | `{"request":"inst_order_book","inst_id":490589,"nonce":...}`, S1 |
| default depth | the whole book. `BTCUSDT` held 310 bids and 42 asks in 16,938 bytes, in 210 to 215 ms |
| depth limits | `top_n` 10, 50, 100 or 200, S1. `BTCUSDT` gave 10 and 10 at 10, and 50, 100 and 200 bids against the 42 asks at the larger values. `top_n` 20 answers `JSON_VALIDATION_FAILED` |
| level shape | `{"count":1,"price":"111024.84","qty":"0.00004700"}`, strings for price and size, size in base currency |
| level order | bids descending and asks ascending on every level |
| sequence | a `trans_id` on the reply, which is a venue wide counter, see [`websocket.md`](./websocket.md) section 4 |
| caching | Not publicly specified, and not measurable here, because the book never changed |

## 6. Rate limits and errors

No rate limit is published in the wiki, S1.
No reply carried a rate limit or `Retry-After` header, and no call was refused at about 2 requests a second.
Every error came back as HTTP 200 with a status array.

| case | reply |
|---|---|
| unknown `inst_id` | `{"nonce":608303,"reply":"inst_tick","status":["INVALID_INST_ID"]}` |
| symbol string in `inst_id` | `JSON_VALIDATION_FAILED` with a `msg` naming the `type` constraint |
| unknown request | `{"nonce":608305,"reply":"no_such_request","status":["INVALID_REQUEST_TYPE"]}` |
| no nonce | `{"status":["NONCE_MISSING"]}` |
| nonce 16,777,216 | `{"status":["INVALID_NONCE"]}` |
| body not JSON | `{"status":["INVALID_JSON_FORMAT"]}` |
| private request without credentials | `{"nonce":608307,"reply":"user_balance","status":["AUTH_FAILURE"]}` |

## 7. Server time and clock offset

There is no time request, and `{"request":"time"}` answers `INVALID_REQUEST_TYPE`.
The HTTP `Date` header sat 0.2 to 0.5 s behind the local clock at the request midpoint, a figure limited by the header's one second resolution.
The tick `timestamp` cannot serve as a clock, see section 4.

## 8. Recommended poller shape

None.
Coinut has no perpetual and publishes no index, mark or funding, so there is nothing for an anchor poller to read.
A spot catalog would be one `inst_list` call, but its books are frozen, see section 2.

## 9. Source ledger

The sources are S1 to S10 and the probes P1 to P3 of [`fees.md`](./fees.md) section 10.

| id | what it supports here |
|---|---|
| S1 | the endpoint, request shapes, `inst_id` stability, `top_n` values |
| S4 | the 2023 removal of the USD pairs |
| P1 | every probed row in sections 1 to 7. Runs at 04:45 to 04:47 and 04:56 to 04:58 UTC on 2026-10-10, and the second pass rerun at 05:03 to 05:05 UTC |
| P3 | the help center JSON API answering 200, and CoinMarketCap's volumes |
