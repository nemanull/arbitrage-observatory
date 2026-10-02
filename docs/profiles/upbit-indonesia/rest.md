# Upbit Indonesia REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:13 UTC), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public quotation REST API of Upbit Indonesia at `https://id-api.upbit.com/v1`, reached in CCXT as `upbit` with `hostname: 'id-api.upbit.com'`.
Upbit Indonesia lists no perpetual, so this is its spot catalog and book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/rest-probe.mjs) unless it names a source.
R1 is the first run of every mode at 04:49 to 04:50 UTC, and R2 is the second pass at 05:07 to 05:08 UTC, both listed in section 9.
All results are from the Canadian VPN exit, and no request was refused.

## 1. Host and latency from this machine

| item | value |
|---|---|
| name | `id-api.upbit.com`, a CNAME to `openapi.upbitit.bike` |
| addresses | `43.218.211.234`, `108.136.202.98` and `15.232.215.221`, the second of which reverse resolves to `ec2-108-136-202-98.ap-southeast-3.compute.amazonaws.com`, AWS Jakarta |
| edge | no CDN header on the API host. Replies carry `x-dunamu-traffic-path: gateway` and `x-dunamu-response-code-details: via_upstream` |
| web site | `id.upbit.com` is a CNAME to `id.upbit.com.cdn.cloudflare.net` and answered 200 |
| cold request | 916 and 919 ms for `/v1/market/all` in R1 and R2 |
| warm requests | 353 to 366 ms, median 356 and 361 ms, over 7 requests in each of R1 and R2 |
| refusals | none. Every public call answered 200 or a documented 4xx error |

The warm time is one round trip from Seattle to Jakarta through the Canadian exit, so any poll or REST book read costs at least 350 ms from this host.

## 2. Catalog

### The instruments call

`GET /v1/market/all?is_details=true` returned 444 rows and 32,162 bytes in R1 and R2.

| quote | pairs | pairs under an investment warning |
|---|---:|---:|
| IDR | 32 | 2, `IDR-ICX` and `IDR-SAND` |
| BTC | 262 | 5 |
| USDT | 150 | 3 |

A row is `{"market", "english_name", "market_warning"}`, and `market_warning` is `NONE` or `CAUTION`.
There is no `market_event` object and no status field, unlike Upbit Korea in [`../upbit/rest.md`](../upbit/rest.md), so a delisting is known only from the notices and from the socket ticker's `delisting_date`, see [`websocket.md`](./websocket.md) section 2.
The 444 pairs have 276 distinct bases: 114 trade against one quote, 156 against two and 6 against all three, and 7 bases trade against both IDR and USDT.

`GET /v1/orderbook/instruments` returns the tick size per pair, S4.
`IDR-BTC` and `IDR-ETH` tick at 10,000 IDR, `IDR-USDT` at 50 IDR, `IDR-DOGE` at 10 IDR, `USDT-BTC` and `USDT-ETH` at 0.01 USDT and `BTC-ETH` at 0.00000001 BTC.
At 17,774 to 17,784 IDR per USDT, the 50 IDR tick of `IDR-USDT` is about 2,800 ppm of the price.

### Turnover

`GET /v1/ticker/all?quote_currencies=<quote>` gives `acc_trade_price_24h` per pair, converted here to USDT through the last `IDR-USDT` and `USDT-BTC` trades, 17,784 and 87,197.77 in R1 and 17,774 and 87,000.01 in R2.

| quote | 24 h turnover in USDT, R1 | R2 | largest pairs in R1 | pairs under 1,000 USDT |
|---|---:|---:|---|---:|
| IDR | 3,810 | 3,865 | `IDR-USDT` 3,135, `IDR-TOKAMAK` 394, `IDR-XRP` 100 | 31 of 32 |
| BTC | 1,212,107 | 1,249,161 | `BTC-XRP` 419,083, `BTC-PUFFER` 199,224, `BTC-CHR` 121,308 | 217 of 262 |
| USDT | 948,709 | 1,006,586 | `USDT-BTC` 464,333, `USDT-XRP` 171,789, `USDT-ETH` 165,927 | 131 of 150 |

CoinGecko put the venue's 24 h volume at 24.4 BTC at 05:00 UTC, about 2.1 million USDT, which agrees with the sum above, S5.

### How CCXT 4.5.68 maps it

`new ccxt.upbit({ hostname: 'id-api.upbit.com' })` loaded 444 markets in 947 and 949 ms in R1 and R2.
Without the option CCXT reads Upbit Korea, since its `hostname` is `api.upbit.com`, at `server/node_modules/ccxt/js/src/upbit.js` line 97.

| field | CCXT | against the wire |
|---|---|---|
| `market.id` | `IDR-BTC`, quote first | identical to `/v1/market/all` on 444 of 444, and to the socket `code` |
| `symbol` | `BTC/IDR` | no pair was renamed |
| `type` | `spot` on 444, `swap` false on 444 | spot only |
| `active` | `true` on 444, hard coded at `upbit.js` line 542 | the catalog has no status, so a delisting pair stays active |
| `contractSize` | undefined, `upbit.js` line 548 | the connector reads a missing size as 1, and the book sizes are base currency, so the unit matches |
| `linear` | undefined | not a contract |
| `taker`, `maker` | 0.0025 on every pair | not the Indonesian rate, see [`fees.md`](./fees.md) section 8 |

No pair is listed twice under one symbol, because each quote is its own pair.
The connector keeps only swaps, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 203, so it would keep none of these.

## 3. Anchor

Upbit Indonesia publishes no index, no mark and no funding rate, because it lists no perpetual.
The only bulk price call is the ticker, which is the last trade, not a reference price.

| call | rows | reply | time over polls |
|---|---:|---:|---|
| `GET /v1/ticker/all?quote_currencies=IDR` | 32 | 20,115 and 20,224 bytes | 20 polls in each run: min 352 and 356, median 356 and 363, p90 362 and 366, max 364 and 374 ms |
| `GET /v1/ticker/all?quote_currencies=BTC` | 262 | 168,867 and 169,045 bytes | 641, 373, 380 and 391 ms in R1, 635, 377, 373 and 375 ms in R2 |
| `GET /v1/ticker/all?quote_currencies=USDT` | 150 | 99,876 and 99,830 bytes | 364, 368, 370 and 363 ms in R1, 370, 366, 368 and 370 ms in R2 |

The row carries `trade_price`, `trade_timestamp`, `timestamp`, 24 h and daily turnover and 52 week extremes, and no bid, ask, index or mark.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index, mark or funding formula to record.
The IDR ticker did not change once over 20 polls about a second apart in either run: 0 of 608 row pairs moved `trade_price`, `trade_timestamp` or `timestamp`.
The `IDR-BTC` ticker's last trade was from 03:13 UTC, 96 minutes before R1 and 114 minutes before R2.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /v1/orderbook?markets=USDT-BTC,IDR-BTC&count=30` |
| depth | `count` 1, 5, 15, 20 and 30 returned that many units, and 31 and 50 returned 30, so 30 is the cap, S3 |
| several pairs | 10, 50, 100 and all 444 pairs in one call all answered 200 with 30 units each. All 444 took 713 and 721 ms and about 1.18 MB in R1 and R2 |
| `level` | `level=100000` answered 400 `Invalid parameter. Check the given value!` |
| row | `{"market", "timestamp", "total_ask_size", "total_bid_size", "orderbook_units"}`, with no `level` key |
| level order | asks ascending and bids descending in the same units as the socket, once the zero slots are left out |
| zero slots | a side with fewer than 30 orders is padded with 0 price and 0 size units. 220 and 219 of 444 pairs had at least one zero slot, and 2 had a whole side empty, in R1 and R2. `IDR-BTC` had 23 and 22 real bids and 30 asks |
| caching | `cache-control: no-cache, no-store, max-age=0, must-revalidate`. 10 reads at 0.35 s spacing gave 9 and 7 distinct `USDT-BTC` timestamps and 7 and 2 distinct `IDR-BTC` timestamps in R1 and R2 |
| age | the book's `timestamp` trailed the reply by 228 to 1,253 ms on `USDT-BTC` over both runs, and by 412 to 1,823 ms on `IDR-BTC` in R1 and up to 86 s in R2, when that book did not change |
| against the socket | every REST read matched a socket frame of the same `timestamp` unit for unit, and trailed the newest socket frame by 0 to 1,000 ms, see [`websocket.md`](./websocket.md) section 4 |

The `IDR-BTC` touch in R1 was a bid of 1,519,320,000 IDR against an ask of 1,551,410,000 IDR, a spread of about 2.1 %, and in R2 the best bid was 1,512,690,000 IDR, a spread of about 2.6 %.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| quotation groups | `market`, `candle`, `trade`, `ticker` and `orderbook`, each 10 requests a second per IP, S2 | every reply carried `remaining-req: group=<group>; min=600; sec=<n>` and `limit-by-ip: Yes`, with `sec` 8 or 9 at about three requests a second |
| over the limit | 429, then 418 with a block duration for repeated violations, "progressively longer", S2 | not provoked |
| `Retry-After` | not documented. The 418 reply is said to carry the block duration, S2 | not seen |
| `Origin` header | one request per 10 s, S2 | one request with `Origin: https://example.com` answered 200 |
| compression | gzip on `Accept-Encoding: gzip`, S1 | the probe asks for gzip |

| request | status | body |
|---|---|---|
| `/orderbook?markets=IDR-NOPE` | 404 | `{"error":{"name":404,"message":"Code not found"}}` |
| `/orderbook?markets=IDR-BTC,IDR-NOPE` | 404 | the same, so one unknown pair fails the whole call |
| `/orderbook?markets=KRW-BTC` | 404 | the same, the Korean pairs do not exist here |
| `/orderbook?markets=idr-btc` | 200 | the `IDR-BTC` book, so REST accepts lower case while the socket ignores it |
| `/orderbook` | 400 | `{"error":{"name":400,"message":"Missing request parameter error. Check the required parameters!"}}` |
| `/orderbook?markets=IDR-BTC&count=abc` | 400 | `{"error":{"name":400,"message":"Type mismatch error. Check the parameters type!"}}` |
| `/ticker?markets=IDR-NOPE` | 404 | `Code not found` |
| `/nope` | 404 | `{"error":{"name":"not_found","message":"no Route matched with those values"}}`, with no `remaining-req` header |

The quotation API spells `error.name` as the integer status, S1.

## 7. Server time and clock offset

No server time call is documented.
The `Date` header bounds the offset: over 20 book reads at 0.2 s spacing, local time minus server time lay between -220 and +243 ms in R1 and between -287 and +156 ms in R2.
The round trip was 352 to 519 ms, which is what limits the bound.

## 8. Recommended poller shape

No anchor poller is recommended, because there is no index, mark or funding to poll.
If a spot leg were ever added, the catalog is `/v1/market/all` through CCXT with the host option of section 2, and the book comes from the socket.
A REST book read is only a fallback, since it trailed the socket by up to 1,000 ms and costs a 350 ms round trip from this host.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | REST API Usage and Error Guide | https://global-docs.upbit.com/reference/rest-api-guide.md | 2026-09-23 UTC | Upbit Singapore, Indonesia and Thailand | base URL `https://id-api.upbit.com`, error format, gzip, sections 1 and 6 |
| S2 | Rate Limits | https://global-docs.upbit.com/reference/rate-limits.md | 2026-09-23 UTC | same | groups, 429 and 418, `Remaining-Req`, `Origin` rule, section 6 |
| S3 | Get Orderbook | https://global-docs.upbit.com/reference/list-orderbooks.md | 2026-09-23 UTC | same | `count` up to 30, default 30, section 5 |
| S4 | List Orderbook Instruments | https://global-docs.upbit.com/reference/list-orderbook-instruments.md | 2026-09-23 UTC | same | tick sizes, section 2 |
| S5 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/upbit_indonesia | 2026-09-23 05:00 UTC | CoinGecko | 24 h volume, section 2 |
| S6 | CCXT 4.5.68 `upbit.js` | `server/node_modules/ccxt/js/src/upbit.js` | 2026-09-23 UTC | CCXT | `hostname`, `parseMarket`, section 2 |
| R1 | `rest-probe.mjs all`, first run at 04:49 to 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7 |
| R2 | `rest-probe.mjs all`, second pass at 05:07 to 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the same, second readings |
