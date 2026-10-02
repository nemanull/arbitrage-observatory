# Bitkub REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 01:26 to 01:55 UTC, from the development host near Seattle.

This profile covers the public REST API of Bitkub Exchange, which is spot only, see [`fees.md`](./fees.md) section 3.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs), run 1 from 01:36 to 01:39 UTC and run 2, the rerun of every mode, from 01:48 to 01:50 UTC.
The documentation is `rest-v3.md` and `rest-v1.md` of the official GitHub repository, S1 and S2, since the Bitkub web pages refuse this host, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| base URL | `https://api.bitkub.com`, S1 | |
| DNS | CNAME `api.bitkub.com.eo.dnse5.com`, A records `43.174.224.42` and `43.174.225.42` | `dig` and `rest-probe.mjs latency`, both runs |
| edge | replies carry `server: nginx`, `eo-log-uuid` and `eo-cache-status`, and `eo-cache-status` reads `HIT` or `MISS` | both runs |
| `GET /api/v3/servertime`, cold, a new TLS connection each | min 434 and 427.4 ms, median 455 and 458.7 ms, max 974.8 and 918.6 ms, 20 calls per run | run 1 and run 2 |
| `GET /api/v3/servertime`, warm, keep-alive | min 341.6 and 340.5 ms, median 354.9 and 368 ms, p90 380.7 and 893.7 ms, max 445.7 and 937.3 ms | run 1 and run 2 |
| a reply served from the edge cache | median 43.5 and 47.6 ms on the depth call | section 5 |
| status codes | every public call answered HTTP 200, errors included, except an unknown path, which answered 404, and the removed V1 market path, which never answered | section 6 |

The warm floor of about 340 ms is the path to the origin, and a cache hit comes back in under 50 ms, so the edge is near this host and the origin is not.
No refusal, geoblock or challenge was met on `api.bitkub.com`.

## 2. Catalog

### The instruments call

`GET /api/v3/market/symbols` returned 473 rows, 285,128 bytes, in 1,713.9 and 1,615.9 ms, `error` 0, in both runs.

| field | value on 2026-09-23 | note |
|---|---|---|
| `market_segment` | `SPOT` on 473 of 473 | no derivative segment exists |
| `status` | `active` 366, `stopped` 107 | a stopped row has `freeze_buy`, `freeze_sell` and `freeze_cancel` true |
| `source` | `exchange` 337, `broker` 136 | code 61 of S1 says some endpoints do not support broker coins |
| `quote_asset` | `THB` 463, `USDT` 10 | |
| by quote, source and status | THB exchange 249 active and 88 stopped, THB broker 107 active and 19 stopped, USDT broker 10 active | |
| `symbol` | `BTC_THB`, base first, upper case, 473 unique | |
| `pairing_id` | 473 unique integers from 1 to 501 | the order book socket's key |
| steps | `BTC_THB` has `price_step` `"0.01"` and `quantity_step` `"1"`. `BTC_USDT` has `price_step` `"0.1"` and `quantity_step` `"0.00000001"` | |

`GET /api/v3/market/ticker` without `sym` returned 366 rows, 82,144 and 82,176 bytes, in 951.1 and 957.2 ms.
Its rows are exactly the 366 active symbols, and no stopped symbol appears.
No active row had a zero bid or ask, and none was crossed or locked, in either run.
A broker row adds `base_volume_self` and `quote_volume_self` to the exchange row's fields.

Activity is concentrated.
Over the 249 active THB exchange pairs the 24 h quote volume summed to 1,886,149,748 and 1,879,464,145 THB, `USDT_THB` alone was 921,925,855 and 919,745,087 THB, the median pair traded 103,786 and 102,718 THB, and 2 pairs traded nothing.

### How the engine's catalog would map it

- There is no CCXT class in 4.5.68 or on CCXT master, see [`fees.md`](./fees.md) section 8, so `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 64 to 68 has nothing to load, and the swap filter at lines 200 to 201 would drop every row anyway.
- The symbol has three spellings: `BTC_THB` on REST, `thb_btc` on the ticker socket, and `1` on the order book socket, see [`websocket.md`](./websocket.md) section 3.
  The REST call accepts `btc_thb` and `BTC_THB` and refuses `thb_btc` with `error` 11.
- Sizes are in the base asset on REST and on the socket, so a contract size of 1 is right.
- THB is outside the quote family at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a THB market would form a cluster with no other venue in it.
- Ten bases are listed twice, once against THB and once against USDT: BTC, ETH, ADA, BCH, XRP, DOGE, NEAR, SOL, SUI and XAUT.

### Broker markets track Bybit spot

The `broker` rows look like books Bitkub takes from another venue rather than matches itself, which fits the Digital Asset Broker licence of [`fees.md`](./fees.md) section 1.
The probe checked the 10 USDT broker pairs and the 5 busiest of the 107 active THB broker pairs.
`rest-probe.mjs mirror` read each USDT broker book and the Bybit spot book of the same pair at the same instant.

| pair | run 1 bid, ask against Bybit, ppm | run 2 bid, ask, ppm | top 5 sizes equal to a Bybit size, run 1 and run 2 | 24 h base volume, Bitkub `base_volume` and Bybit `volume24h`, run 2 |
|---|---|---|---|---|
| `BTC_USDT` | -1,400, +1,401 | -1,401, +1,401 | 5 and 8 of 10 | 6,832.34 and 6,838.95 |
| `XRP_USDT` | -1,392, +1,519 | -1,453, +1,453 | 2 and 10 of 10 | 54,570,618.7 and 54,679,407.28 |
| `ETH_USDT` | -1,516, +1,287 | -1,400, +1,404 | 1 and 8 of 10 | 77,731.43 and 77,790.03 |
| `DOGE_USDT` | -1,478, +1,478 | -1,477, +1,477 | 7 and 10 of 10 | 324,378,856.8 and 325,035,405.1 |
| `ADA_USDT` | -1,975, +1,184 | -1,583, +1,582 | 0 and 9 of 10 | 52,237,292.74 and 52,449,250.14 |
| `SOL_USDT` | -1,435, +1,435 | -1,440, +1,439 | 8 and 4 of 10 | 881,706.91 and 883,076.70 |
| `BCH_USDT` | -1,770, +885 | -1,464, +1,464 | 1 and 9 of 10 | 83,858.68 and 83,877.53 |
| `SUI_USDT` | -1,470, +1,470 | -1,672, +1,278 | 6 and 2 of 10 | 22,401,290.66 and 22,466,755.74 |
| `XAUT_USDT` | -1,403, +1,403 | -1,404, +1,403 | 10 and 9 of 10 | 1,777.15 and 1,784.24 |
| `NEAR_USDT` | -1,605, +1,604 | -1,617, +1,616 | 10 and 9 of 10 | 13,056,478.79 and 13,075,953.96 |

The 24 h high on Bitkub sat 1,143 to 1,400 ppm above Bybit's, and the low 1,396 to 1,663 ppm below it, in run 2.
So the ten USDT books are Bybit spot's book with about 1,400 ppm added to each side, and the ticker volume is Bybit's volume, while `base_volume_self`, for example 9.887 BTC on `BTC_USDT` in run 1, is Bitkub's own flow.
The deviations beyond 1,400 ppm are most likely tick rounding or a Bybit touch that moved between the two reads.
That the source is Bybit is an inference from the numbers, and no Bitkub document names it.

The busiest THB broker pairs behave the same way through a THB rate.
Their touch divided by Bybit's USDT touch gave 32.879 to 32.901 THB per USDT on the bid and 33.336 to 33.363 on the ask over both runs, while Bitkub's own `USDT_THB` book was 33.12 by 33.13.
`RLUSD_THB`, `PEPE_THB`, `PUMP_THB`, `VVV_THB` and `LIT_THB` all showed it, and their `base_volume` was within 0.5 % of Bybit's `volume24h`.

A broker book is therefore a copy of Bybit spot, a venue whose perpetuals the engine already reads, widened by about 1,400 ppm per side on USDT pairs, and by 6,400 to 7,400 ppm per side on THB pairs against the 33.125 mid of Bitkub's own `USDT_THB` book.

## 3. Anchor

Bitkub publishes no index price, no mark price and no funding rate, because it lists no perpetual.

| `AnchorRow` column | Bitkub field |
|---|---|
| `index` | none |
| `mark` | none |
| `fundingRate` | none |
| `fundingIntervalHours` | none |
| `nextFundingAt` | none |

The only published reference prices are the ticker's `last`, `highest_bid` and `lowest_ask`, and the candles of `GET /tradingview/history`, S2.
None of them is an index, and the broker rows are a marked up copy of Bybit spot, section 2.

## 4. Anchor semantics

There is no index, mark or funding formula to record.
For context on how often the bulk ticker changes, `rest-probe.mjs poll` read it once a second for 30 polls in each run.

| item | run 1 | run 2 |
|---|---|---|
| reply time, min, median, p90, max | 42.7, 941, 1,005.4, 1,510.3 ms | 156.4, 944.6, 1,414.6, 2,088.6 ms |
| rows of 366 whose bid, ask or last changed since the previous poll, min, median, max | 0, 94, 143 | 0, 96, 156 |

The fastest reply, 42.7 ms in run 1, has the time of an edge cache hit, and a poll with 0 changed rows fits a repeated cached reply, but the probe did not record the cache header per poll, see section 5.

## 5. REST book snapshot

| call | reply | evidence |
|---|---|---|
| `GET /api/v3/market/depth?sym=btc_thb&lmt=N` | aggregated levels `[price, size]` as JSON numbers, bids descending and asks ascending with no violation, no repeated price in 1,000 levels | both runs |
| `lmt` 1, 20, 100 | 1, 20, 100 levels per side, 86 to 89, 944 to 950 and 4,449 to 4,450 bytes | both runs |
| `lmt` 1000 and 5000 | 1,000 levels per side either way, about 43.7 KB, in 922.3 to 1,099 ms | both runs |
| no `lmt` | `{"error":10}` | both runs |
| `lmt=0` | `{"error":10,"result":{"lmt":["The lmt must >=1"]}}` | both runs |
| `GET /api/v3/market/bids?sym=btc_thb&lmt=1000` | 1,000 single orders with `order_id`, `price`, `size`, `side`, `timestamp` in ms and `volume`, over 483 and 480 distinct prices | both runs |
| `GET /api/v3/market/depth?sym=btc_usdt&lmt=3`, a broker pair | a normal book | both runs |
| `GET /api/v3/market/bids` or `asks` on `btc_usdt` | `{"error":59}`, a code S1 does not list. S1 lists 61 for broker coins | both runs |
| `GET /api/v3/market/trades?sym=btc_usdt&lmt=3` | trades `[ts in s, price, size, side]` | both runs |
| stopped `ltc_thb` | `{"error":0,"result":{"asks":[],"bids":[]}}` from depth, `{"error":11}` from ticker | both runs |

### Caching

Twenty depth reads of `btc_thb&lmt=20` spaced 250 ms apart came back `HIT` 14 and 13 times and `MISS` 6 and 7 times, in run 1 at 01:38 UTC and in run 2.
They held 6 and 5 distinct books, and up to 4 and 7 consecutive reads were identical, which is up to about 1 and 1.75 s of the same reply.
A hit took a median 43.5 and 47.6 ms and a miss 389.8 and 403.9 ms.
No `cache-control` or `age` header was sent, so the age of a cached reply cannot be read.
Adding an unused query parameter such as `nocache=<ms>` turned every read into a `MISS`, 60 of 60 in each `ws-probe.mjs sync` run.

The REST book also changes more often than the socket reports it, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limits | per user per endpoint, "regardless of API version": `market/ticker`, `symbols`, `trades`, `bids`, `asks` 100 per second, `market/depth` 10 per second, `servertime` 2,000 per 10 s, `status` 100 per second, S1 | the probes stayed at 4 per second or less, and no limit was reached |
| on excess | "Exceeding the limit blocks requests for 30 seconds (HTTP 429).", S1 | not provoked |
| rate limit headers | Not publicly specified | none: the depth reply headers are `content-type`, `server`, the `access-control-*` group, `content-length`, `accept-ranges`, `connection`, `date`, `eo-log-uuid` and `eo-cache-status` |
| `Retry-After` | Not publicly specified | not seen |
| error shape | "V3 uses numeric error codes, not HTTP status-based codes.", S1 | HTTP 200 with `{"error": N}`: 10 invalid parameter, 11 invalid symbol, 59 on a broker `bids` call |
| unknown path | | HTTP 404 `{"error":404,"message":"Not Found"}` |
| removed V1 market path | "The V1 `/api/market/*` endpoints have been removed", S2 | `GET /api/market/depth?sym=THB_BTC&lmt=3` sent no reply in 10 s in both runs |
| status | `GET /api/status`, "When status is not `ok`, it is highly recommended to wait", S2 | `[{"name":"Non-secure endpoints","status":"ok","message":""},{"name":"Secure endpoints","status":"ok","message":""}]` |

## 7. Server time and clock offset

`GET /api/v3/servertime` returns a bare integer of Unix ms, for example `1790127030647`, and the unversioned `GET /api/servertime` answers the same way.
Server time minus the local midpoint of each warm request had a median of 4.5 and 2.5 ms over 20 calls per run.
The range was -4.5 to 56 ms in run 1 and -26 to 290.5 ms in run 2, where the outliers are calls that took up to 937 ms.
The host clock is therefore within a few ms of Bitkub's.

## 8. Recommended poller shape

No anchor poller is recommended, because Bitkub publishes no index, mark or funding.

| item | recommendation | reason |
|---|---|---|
| anchor | none | section 3 |
| L1 by REST, if ever wanted | `GET /api/v3/market/ticker` once a second, keyed by `symbol` | one call carries the touch of all 366 active pairs, but a reply takes a median 941 to 945 ms, so it is already about a second old, and a cached reply can repeat the previous second |
| cache | add a changing query parameter to every book or ticker read | the edge serves a cached reply for up to about 1.75 s otherwise |
| skip | `status` `stopped` rows | empty books |
| skip | `source` `broker` rows | a marked up copy of Bybit spot, section 2 |
| rate limit pause | 30,000 ms | the documented block after a 429 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitkub Official API Docs, `rest-v3.md` | https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v3.md | 2026-09-22, repository head `d65eafa538` of 2026-09-09 | Bitkub | base URL, market endpoints, error codes, rate limits, sections 1 to 6 |
| S2 | Bitkub Official API Docs, `rest-v1.md` | https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v1.md | 2026-09-22 | Bitkub | removed V1 paths, `/api/status`, `/api/servertime`, `/tradingview/history`, sections 3, 6 and 7 |
| S3 | Bybit V5 spot `market/orderbook` and `market/tickers` | https://api.bybit.com/v5/market/orderbook | 2026-09-23 UTC | Bybit | the comparison books, section 2 |
| P1 | `rest-probe.mjs latency` and `catalog`, run 1 at 01:36 UTC and run 2 at 01:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 2 and 7 |
| P2 | `rest-probe.mjs book`, run 1 at 01:38 UTC and run 2 at 01:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 5 and 6 |
| P3 | `rest-probe.mjs mirror`, run 1 at 01:38 UTC and run 2 at 01:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) | 2026-09-23 UTC | this host | section 2 |
| P4 | `rest-probe.mjs poll`, run 1 at 01:39 UTC and run 2 at 01:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P5 | `ws-probe.mjs sync`, at 01:53 and 01:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs) | 2026-09-23 UTC | this host | cache busting, section 5 |
