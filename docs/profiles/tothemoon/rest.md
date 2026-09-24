# Tothemoon REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:20 to 03:56 UTC), from the development host near Seattle.

This profile covers the public REST API of Tothemoon, formerly Cryptology, and where the perpetual catalog and anchor fields live instead.
The documented REST API is spot only.
It has no call for perpetual instruments, books, index, mark or funding, so sections 2 and 3 read those from the public Octopus socket described in [`websocket.md`](./websocket.md).
CCXT 4.5.68 has no class for the venue, see [`fees.md`](./fees.md) section 8.
Sources (S) and probe runs (P) are in section 9.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 UTC | role | source |
|---|---|---|---|
| `api.tothemoon.com` | 172.66.164.103 and 104.20.24.196, Cloudflare, `server: cloudflare`, `cf-cache-status: DYNAMIC` | documented REST, spot only | P1 |
| `docs.tothemoon.com` | the same two Cloudflare addresses | documentation | P1 |
| `tothemoon.com` | four CloudFront addresses in 143.204.160.0/24 | website | P1 |
| `octopus-prod-ws.cryptology.com` | 172.66.138.198 and 172.66.135.160, Cloudflare | the socket that carries the perpetual catalog, book and anchor | P4 |
| `api.prod.cryptology.com` | four CloudFront addresses in 18.65.238.0/24, from `dig` | the web app's own API, `baseUrl` in S3, used for authenticated order entry, not probed | S3 |

The documentation says "Tothemoon data centers are in the Amazon EU region", S1.
No call was refused: every public path answered this host with HTTP 200, or with 404 or 400 for a wrong path.

| call | first request | warm requests | source |
|---|---|---|---|
| `GET /v1/public/get-trade-pairs`, 26,945 bytes | 1,057 ms and 906 ms in the two runs | | P1 |
| `GET /v1/public/get-order-book?trade_pair=BTC_USDT`, about 1,085 bytes | 811 ms and 782 ms | 19 more reads 1.1 s apart: min 176 and 181 ms, median 280 and 247 ms, max 822 and 811 ms | P2 |
| `GET /v1/public/get-24hrs-stat?trade_pair=BTC_USDT` | 702 ms and 184 ms | | P1 |

## 2. Catalog

### The instruments call

No REST call lists perpetuals.
`GET /v1/public/get-trade-pairs` returns 362 spot pairs with only `trade_pair`, `base_currency` and `quoted_currency`, and none of them contains `PERP`, P1.
`GET /v1/public/get-order-book?trade_pair=BTC_USDT_PERPETUAL` answers `invalid trade_pair BTC_USDT_PERPETUAL`, P3.

The perpetual catalog comes from the public socket channel `turboFutureInstruments.*`, which the tothemoon.com web app subscribes and the documentation does not name, S3.
One subscription returns every contract in one `subscriptionData` frame of about 5 KB, P4.

| field | value on 2026-09-23 UTC, P4 |
|---|---|
| `instrument_id`, `name` | `BTC_USDT_PERPETUAL`, the same string in both |
| `pair`, `base`, `counter` | `BTC_USDT`, `BTC`, `USDT`, except `XAU_USDT_PERPETUAL`, whose `pair` is `XAUT_USDT` and `contract_currency` is `XAUT` |
| `is_enabled` | true on 13 of 13 |
| `contract_size` | a base coin fraction: `0.000001` BTC, `0.00001` ETH and BCH, `0.0001` SOL, AVAX and LTC, `0.001` ATOM, DOT, ETC and UNI, `0.01` ADA, DOGE and XAU |
| `price_step` | `0.1` on BTC down to `0.00001` on DOGE |
| `margin_currency` | `USDT` on 13 of 13 |
| `expiration_date` | 0 on 13 of 13 |
| `funding_disabled` | true on 13 of 13, see [`fees.md`](./fees.md) section 6 |
| `reversed` | true on 13 of 13, and its meaning is Not publicly specified. The book's base and quote sizes behave linearly, see below |
| `default_leverage`, `order_index`, `price_precision` | `"0"`, 0 and the price decimals |

A second public channel, `turboEmergencyMode.*`, returns a map of 32 instrument ids to an emergency flag and a system flag, all false.
Its 19 ids that are not in the catalog are the retired contracts listed in [`fees.md`](./fees.md) section 3, P4.

### How CCXT 4.5.68 maps it

It does not, because CCXT has no class, see [`fees.md`](./fees.md) section 8.
A hand-written loader would map the catalog as follows.

| engine field | source | note |
|---|---|---|
| `rawMarketId` | `instrument_id` | the same string is the suffix of the book channel `contractsOrderbookVolumes.<id>`, the `instrument_id` inside every book frame, and the `instrument_id` of every ticker frame, on 13 of 13, P5 and P6 |
| `base` | `contract_currency` | `base` says `XAU` for the gold contract while `pair` and `contract_currency` say `XAUT`, and other venues list tokenised gold as XAUT |
| `quote` | `counter`, `USDT` | |
| `linear` | true | margin in USDT, and the book's quote size equals base size times price on every level checked, see [`websocket.md`](./websocket.md) section 4 |
| `contractSize` | `Number(contract_size)` | book sizes are contracts, and the socket's own base-coin size equals contracts times `contract_size` exactly on 400 levels checked per contract, [`websocket.md`](./websocket.md) section 4 |
| `active` | `is_enabled` | |

### Size unit, pairs listed twice, and price scale

The size unit is contracts of `contract_size` base coins, which is what the engine's `contractSize` expects.
No pair is listed twice, since each of the 13 underlyings has one contract.
No price scale is needed, since every price is per one base coin.

## 3. Anchor

### The bulk calls

No REST call returns an index, a mark or a funding rate.
The documented REST API has only the five spot calls of S1, and the web app reads its perpetual tickers from the socket, S3.

The one bulk source is the public socket channel `turboTickers.*`, a single subscription that streams a ticker frame per contract for all 13, each about once a second, P6.
The documented per-contract channel `contractsTickers.<instrument_id>` carries the same anchor fields, P5.

| source | index | mark | funding rate | interval | next settlement | cadence |
|---|---|---|---|---|---|---|
| `turboTickers.*` on the socket | `index_price` | `mark_price`, also `fair_price` | `funding_rate` | `funding_interval`, ms | absent, only `last_funding_time` | one frame per contract every 1,100 to 1,195 ms median, max 2,435 ms, over two 45 s runs, P6 |

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument_id` | string, `BTC_USDT_PERPETUAL` | none |
| `index` | `index_price` | decimal string | `Number()` |
| `mark` | `mark_price` | decimal string, equal to `index_price` and `fair_price` on every frame | `Number()` |
| `fundingRate` | `funding_rate` | decimal string, `"0"` or `"0.000000000000000000"` on every frame | `Number()` |
| `fundingIntervalHours` | `funding_interval` | integer ms: 28,800,000 on 11 contracts, 3,600,000 on AVAX, 21,600,000 on LTC | divide by 3,600,000 |
| `nextFundingAt` | none | `last_funding_time` plus `funding_interval` lies on 2026-09-08 for 12 contracts and in 2022 for SOL | no field, see section 8 |

## 4. Anchor semantics

### Index

"the Index Price is the average market price of different exchanges", S2.
No basket, weight or source list is published, and no basket call exists.
The index was compared with Gate's futures index for the same coin three times in one 45 s run at 03:33 UTC, P6.

| contracts | index minus Gate index |
|---|---|
| ADA, AVAX, BCH, BTC, DOGE, DOT, ETH, LTC, SOL, UNI | −1,265 to +446 ppm |
| XAU against Gate `XAUT_USDT` | −737 to −592 ppm |
| ATOM | +139,924 to +140,048 ppm: `index_price` 2.11 while Gate's index and Tothemoon's own book sat near 1.851 |
| ETC | +39,500 to +40,627 ppm: `index_price` 9.922 while Gate's index was 9.537 |

In the first run, at 03:28 UTC, the ATOM mark sat 139,843 to 141,310 ppm above its own book mid and the ETC mark 39,401 to 40,545 ppm above, P6.
So two of 13 indices are not the market price of their coin, and a route through either would read a 4 % or 14 % premium that is not there.

### Mark

"Mark Price = Index Price * ( 1 + Funding Rate * (Time to Funding / Funding Interval))", S2.
No clamp is published.
With every funding rate at 0 the mark equals the index, and `mark_price`, `fair_price` and `index_price` were identical on every frame of both runs, P6.
So the mark carries no information the index does not, and the mark is never 0.

### Funding

Funding Rate = Interest Rate Differential + Premium Index, with impact prices at about 10 BTC, and no cap or floor published, S2.
Funding is disabled on all 13 contracts and the published rate is 0, see [`fees.md`](./fees.md) section 6.
Whether a nonzero published rate would be the upcoming or the last settled one is Not publicly specified.

### How often each number changed

Two 45 s runs of `turboTickers.*`, at 03:28 and 03:33 UTC, P6.

| number | distinct values per contract in 45 s | seconds in which it changed |
|---|---|---|
| `index_price`, `mark_price` | 1 to 5 | 0 to 4 |
| `funding_rate`, `premium_index`, `interest_rate` | 1 value, zero | 0 |
| `funding_interval`, `last_funding_time` | 1 | 0 |

The ticker frame itself repeats about once a second whether or not a number changed, so a frame's arrival says nothing about the index's age.
ATOM's index held one value for the whole 45 s of the second run.

## 5. REST book snapshot

The REST book is spot only, and there is no REST book for a perpetual.

| item | value | source |
|---|---|---|
| call | `GET /v1/public/get-order-book?trade_pair=<pair>`, reply `{"status":"OK","error":null,"data":{"bids":[[price,size]],"asks":[[price,size]]}}` with strings | S1, P2 |
| depth | `BTC_USDT` 19 or 20 levels a side, `ETH_USDT` 19 and 20, `BTC_EUR` 24 or 25 bids and 18 asks, `XAUT_USDT` 8 or 9, `ATOM_USDT` 9 bids and no ask in both runs | P2 |
| depth parameter | none documented. `limit=100`, `depth=50` and `type=FULL` changed nothing | P2 |
| book type | the documentation lists `AGGREGATED`, and `BEST` and `FULL` "currently not supported" | S1 |
| level order | bids descending and asks ascending on 20 of 20 reads in both runs, never crossed | P2 |
| caching | 16 and 12 of 19 consecutive reads 1.1 s apart were byte-identical, with `cf-cache-status: DYNAMIC` and no `cache-control` or `age` header | P2 |
| spread | `BTC_USDT` best bid 86,690.48 and best ask 86,785.86 in the first read, about 1,100 ppm | P2 |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| documented limits | "10 requests per second for WebSocket API and 1 request per second for HTTPS API" | S1 |
| on the limit | REST error code `TOO_MANY_REQUESTS`, and on the socket "a message with THROTTLING response type and overflow_level param which must be used for waiting for overflow_level milliseconds" | S1 |
| headers | no rate limit header and no `Retry-After` on any reply | P1, P2, P3 |
| probed | the probes stayed at one REST request per 1.1 s and never saw a limit | P1, P2, P3 |

Every error from a known path is HTTP 200 with a JSON envelope, as S1 says ("Every endpoint returns a 200 HTTPS response code").

```json
{"status":"ERROR","error":{"code":"INVALID_REQUEST","message":"invalid trade_pair NOPE_USDT"},"data":null}
```

```json
{"status":"ERROR","error":{"code":"INVALID_REQUEST","message":"trade_pair required"},"data":null}
```

An unknown path answers 404 with the text `404 page not found`, and the bare host answers 400 with `{'error': 'invalid request'}`, which is not JSON, P3.

## 7. Server time and clock offset

The error table of S1 names "the /public/time endpoint", and `GET /v1/public/time` and `GET /v1/time` both answer 404, P3.
The HTTP `Date` header has one second resolution.
The socket's `welcomeMessage` carries `server_timestamp` in ms, and it arrived 79 to 83 ms after that stamp on this host, while a protocol ping took 157 to 188 ms to return, P4 and P7.
So the one-way trip is about 80 to 95 ms and the clock offset is within about 15 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| REST poller | none | no REST call carries an index, a mark or a funding rate |
| anchor source | a socket-fed anchor: one `turboTickers.*` subscription on `wss://octopus-prod-ws.cryptology.com/v1/connect`, the latest frame per `instrument_id` kept in memory and read by an `AnchorPoller` subclass | one subscription covers all 13 contracts about once a second, section 3 |
| stamp | on arrival | the ticker data carries no timestamp of its own, only `offset` counters, and the envelope's `server_timestamp` is the send time |
| row mapping | section 3 | |
| `mark` | `mark_price`, never 0 | equal to the index while funding is off |
| `fundingRate` | `Number(funding_rate)`, today 0 | |
| `nextFundingAt` | not available | funding is disabled and `last_funding_time` is two weeks old |
| skip | `ATOM_USDT_PERPETUAL` and `ETC_USDT_PERPETUAL` | their index is 14 % and 4 % away from the coin's market price, section 4 |
| skip | any contract whose `is_enabled` is false, or whose emergency flag in `turboEmergencyMode.*` is true | the documented maintenance states, S1 |
| base naming | `XAU_USDT_PERPETUAL` under `XAUT` | the contract is on the gold token, section 2 |
| catalog | read `turboFutureInstruments.*` at boot on the same socket | no REST call and no CCXT class lists the contracts |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tothemoon API Documentation | https://docs.tothemoon.com/ | 2026-09-22 | Tothemoon, global | REST calls, response and error format, rate limits, book types, time endpoint, data centres, sections 1, 3, 5, 6 and 7 |
| S2 | Futures Trading Terminology, updated 2024-11-20 | https://tothemoon.com/faq/futures-trading-terminology-43000493594 | 2026-09-22 | Tothemoon, global | index, mark and funding formulas, section 4 |
| S3 | tothemoon.com web app, `_app` chunk `pages/_app-179ed8454e51944c.js` | https://tothemoon.com/_next/static/chunks/pages/_app-179ed8454e51944c.js | 2026-09-22 | Tothemoon, global | `octopusUrl` `wss://octopus-prod-ws.cryptology.com`, `baseUrl` `https://api.prod.cryptology.com/`, the channel names `turboFutureInstruments`, `turboTickers`, `turboOrderbookVolumes`, sections 1 to 3 |
| P1 | `rest-probe.mjs catalog`, at 03:32 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tothemoon/rest-probe.mjs) | 2026-09-23 UTC | this host | DNS, spot catalog, 24 h stats, sections 1, 2 and 6 |
| P2 | `rest-probe.mjs book`, at 03:32 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tothemoon/rest-probe.mjs) | 2026-09-23 UTC | this host | REST book latency, depth, order, caching, sections 1, 5 and 6 |
| P3 | `rest-probe.mjs errors`, at 03:33 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tothemoon/rest-probe.mjs) | 2026-09-23 UTC | this host | error shapes, time call, sections 2, 6 and 7 |
| P4 | `ws-probe.mjs hosts` and `catalog`, at 03:26, 03:27 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | socket host, perpetual catalog, emergency map, welcome clock, sections 1, 2 and 7 |
| P5 | `ws-probe.mjs book`, at 03:27, 03:34 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | book and ticker symbol spelling, section 2 |
| P6 | `ws-probe.mjs anchor`, at 03:28 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | ticker fields, cadence, index against Gate, sections 3 and 4 |
| P7 | `ws-probe.mjs errors`, at 03:30 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | protocol ping round trip, section 7 |
