# Globe REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that exits in Canada.

This profile covers the public REST API of Globe for its one perpetual family, the linear USD perpetuals.
Globe has no CCXT class, see [`fees.md`](./fees.md) section 8, so the catalog below is Globe's own reply and not a CCXT mapping.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/globe/rest-probe.mjs) in two passes, or is quoted from the documentation with its source.
Globe publishes a REST limit of 1 request per second, S1, so the probe waited at least 1.2 s between requests and polled the anchor every 2 s.
Every access result was seen from the Canadian VPN exit, and nothing was refused.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://globe.exchange/api/v1`, S1 |
| resolved | `104.26.0.151`, `104.26.1.151`, `172.67.69.61`, and `2606:4700:20::681a:97`, `2606:4700:20::681a:197`, `2606:4700:20::ac43:453d`, all Cloudflare |
| edge | `https://globe.exchange/cdn-cgi/trace` answered `colo=SEA` and `loc=CA`, and replies carried `cf-ray` suffixes `YVR` and `SEA` |
| cold request | `/ticker/contracts` on a new connection: 583 and 572 ms to the first byte, 589 and 576 ms in total |
| warm request | five more reads 1.2 s apart: 113 to 121 ms in the first pass and 112 to 119 ms in the second |
| caching | `cf-cache-status: DYNAMIC` on every read, no `cache-control`, gzip |

Every public call answered 200 from this host, except the error cases of section 6.
The legacy host `globedx.com` answers 301 to `https://globe.exchange/`, and the client library still names `http://www.globedx.com/api/v1`, S3.

## 2. Catalog

### The instruments call

`GET https://globe.exchange/api/v1/ticker/contracts` takes no parameters and returns every perpetual in one array, S1.

| item | first pass | second pass |
|---|---|---|
| rows | 30 | 30 |
| `product_type` | `perpetual` on 30, where the documentation shows `Perpetual` | same |
| `product_status` | 28 `Active`, 2 `Suspended` (`IOTA-PERP`, `ALPHA-PERP`) | same |
| `quote_symbol` | `USD` on 30 | same |
| `contract_type` | `Vanilla` on 30, while the socket's `product-detail` says `Linear` | same |
| `next_funding_time` | 1790164800000, 2026-09-23 12:00 UTC, on 30 | same |
| `early_access` | false on 30 | same |
| reply | 24,877 bytes | 24,882 bytes |

The documented `product-detail` status values are `Active`, `Suspended`, `Configuring`, `NoMatching` and `Closed`, S1.
The active perpetual count by settlement asset is 28 USD-margined contracts.
`GET /api/v1/ticker/pairs` returned the 3 spot pairs, `BTC/USDT`, `ETH/USDT` and `GDT/USDT`, which this survey does not profile.

A row, trimmed of `ohlc`, `tags` and the volume fields.

```json
{"product_type":"perpetual","product_status":"Active","name":"Tellor","instrument":"TRB-PERP","best_bid":{"price":20.513,"volume":5.0},"best_ask":{"price":20.526,"volume":0.2},"base_increment":0.1,"quote_increment":0.001,"base_symbol":"TRB","quote_symbol":"USD","contract_price":0.1,"contract_type":"Vanilla","contract_price_currency":"USD","funding_rate":-0.02,"mark_price":20.50137,"index_price":20.5234,"next_funding_time":1790164800000,"max_leverage":20,"early_access":false}
```

### What the engine would need, since CCXT has no class

| engine input | Globe field | finding |
|---|---|---|
| `market.id` and `rawMarketId` | `instrument`, as `BTC-PERP` | the same string on REST, on the socket's `subscription.instrument` and in `product-list`, 30 of 30 |
| `base`, `quote` | `base_symbol`, `quote_symbol` | quote is `USD` on every row, which is in the USD, USDC and USDT quote family |
| `linear` | `contract_type` `Vanilla` or `Linear` | every contract is linear with USD margin, S2 |
| `active` | `product_status === "Active"` | 28 of 30 |
| `contractSize` | `contract_price` on REST, `contract_size` on the socket | equal to each other and to `base_increment` on 30 of 30, as 0.0001 for `BTC-PERP`, 10 for `XLM-PERP` and 1,000,000 for `PEPE-PERP`. Book sizes are already in the base currency, so the engine's size multiplier must be 1, see [`websocket.md`](./websocket.md) section 4 |
| pairs listed twice | none | one contract per base |
| price scale | none | `PEPE-PERP` is quoted per PEPE, at about 0.000005 USD |

The catalog is `loadMarkets` of a CCXT exchange today.
`VenueRegistration.createExchange` must return a `ccxt.Exchange`, at `server/src/venues/registry.ts` line 29, and the connector filters `loadMarkets` to active swaps at `server/src/ccxt/connector.ts` lines 68, 79 and 200 to 201.
So Globe needs a catalog that is not CCXT, or a small `ccxt.Exchange` subclass whose market load reads this call.
The existing `contractSize` option, at `server/src/ccxt/types.ts` line 22 and `server/src/ccxt/connector.ts` line 175, is the place to pin the size multiplier to 1.

The tick differs between the two sources on 2 of 30 contracts.
`AVAX-PERP` has `quote_increment` 0.01 on REST and `tick_size` 0.001 on the socket, and `APT-PERP` has 0.001 and 0.0001.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/ticker/contracts` | `index_price` | `mark_price` | `funding_rate`, a percentage | absent | `next_funding_time`, Unix ms | about 24.9 KB, 30 rows | 31 polls 2 s apart in each pass: min 112 and 113, median 116 and 116, p90 118 and 122, max 193 and 586 ms, none over 1 s |
| socket `product-detail`, one frame per instrument | | | | `funding_period`, seconds, 28800 on 30 of 30 | `next_funding_time` | | 101 to 156 ms after the subscribe |
| `GET /api/v1/ticker?instrument=BTC-PERP` | `index_price` | `mark_price` | `funding_rate` | absent | `next_funding_time` | 939 and 941 bytes, one instrument | 121 and 112 ms |

One REST call carries four of the five `AnchorRow` columns for every perpetual, keyed by `instrument`.
The interval is on the socket only, and it was 8 h on every contract.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument` | string, `BTC-PERP` | none |
| `index` | `index_price` | JSON number | none |
| `mark` | `mark_price` | JSON number, never 0 on 30 rows | none |
| `fundingRate` | `funding_rate` | JSON number, a percentage per 8 h: `-0.006666666666666667` is −0.00667 %, which is −67 ppm | divide by 100 |
| `fundingIntervalHours` | `funding_period` from the socket, or a constant | 28800 s | divide by 3,600, which gives 8 |
| `nextFundingAt` | `next_funding_time` | integer Unix ms | none |

The documentation calls `funding_rate` the "Current funding rate percentage", S1.
Read as a fraction, `XTZ-PERP`'s `-0.07333333333333333` would be −7.3 % per 8 h, which no premium in the catalog supports, so the percentage reading holds.

## 4. Anchor semantics

### Index

"The index price of each perpetual product is calculated from the spot price of the asset on other exchanges, except for exotic perpetuals, such as BTC-VIX. Exchanges used include Ascendex, Binance, Bitfinex, Bitstamp, Bybit, Coinbase Pro, FTX, Kraken.", S2.
The list still names FTX, so it is older than the index it describes.
The basket and weights per instrument are Not publicly specified, and no basket call is documented.
Globe's own markets are not named as a source, so the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) is not indicated, but it cannot be ruled out without a basket.
Index candles are public at `GET /api/v1/history/index-price/<instrument>/candles/<resolution>`, which returned 2,500 one minute rows, newest first, about 42 hours, in 242 and 251 ms.

### Mark

"The mark price is defined as a 30 second exponential moving average of the fair price, which is the average of the fair impact ask price and fair impact bid price.", S2.
The impact prices are those of a 10,000 USD market order "in the current adjusted orderbook", which is Globe's own book with 10,000 USD of depth inserted at a maximum and a minimum level set from the index, S2.

| band | contracts |
|---|---|
| index ± 2 % | `BTC-PERP`, `ETH-PERP` |
| index ± 5.75 % | `ADA-PERP`, `BCH-PERP`, `LTC-PERP`, `XLM-PERP`, `XRP-PERP` |
| index ± 10 % | 67 contracts, which include the other 22 contracts in the catalog |
| not in the table | `PYTH-PERP`, `PEPE-PERP` |

The inserted levels bound the impact prices, so the mark premium cannot pass the band.
That is the capped mark shape that the design warns reads a capped leg as fresh.
A leg whose premium sits near its band is saturated, and the reader should treat it that way.
The 10,000 USD impact order reaches past the touch on every contract, since the touch held a median of 2 to 16 USD, see [`websocket.md`](./websocket.md) section 4.

The mark sat below the index on most contracts.
In the second catalog read, 24 of 28 active contracts had a negative premium, with a median of −361 ppm and a range of −1,437 to +479 ppm.
Over the anchor polls the largest premium seen was 1,971 ppm on `DOT-PERP` in the first pass and 2,319 ppm on `WLD-PERP` in the second, well inside the bands.

`SAND-PERP` published mark and index with 5 decimals, a step of about 224 ppm at 0.0445 USD, and they were equal on all 31 polls of the second pass.
A suspended contract publishes its mark equal to its index, and both still moved a few times a minute.

### Funding

The formula, the ±0.05 % dead band, the 8 h time weighted average and the absence of a cap are in [`fees.md`](./fees.md) section 6.
The published rate moved between settlements.
`XTZ-PERP` read `-0.07333333333333333` at 04:27 and 04:37 UTC, changed once during the polls of 04:37:31 to 04:38:31 UTC, and read `-0.07` at 04:38:44 UTC, about 38 minutes after the 04:00 UTC settlement that `next_funding_time` implies.
A settled rate would not move, so the published rate is a running value for the upcoming settlement.
That is an inference from one change, and no settlement instant was captured.
No funding history call is documented, S1, so the settled rates could not be read back.
Every rate on the wire was a whole multiple of 1/300 of a percent, on 30 of 30 contracts in both catalog reads.

### Rate across a settlement

Not captured, by design of the survey.
The help article puts settlements at 00:00, 08:00 and 16:00 UTC, S2, while `next_funding_time` read 12:00 UTC from 04:20 to 04:38 UTC with an 8 h period, which puts them at 04:00, 12:00 and 20:00 UTC.

### How often each number changed

REST, 31 polls 2 s apart, 30 intervals per pass.

| number | first pass | second pass |
|---|---|---|
| `mark_price` | changed on 28 to 30 intervals for 25 of 28 active contracts, and on 13 to 20 for `SAND`, `PYTH` and `CHZ` | 26 to 30 for 25 of 28, and 6, 17 and 19 for `SAND`, `CHZ` and `PYTH` |
| `index_price` | 5 on `ZRX`, 13 on `SAND` and `CHZ`, 16 on `LDO`, 19 on `PYTH` and `COMP`, 23 to 30 on the rest | 6 on `SAND`, 12 on `COMP`, 16 on `CHZ`, 18 on `XTZ` and `ZRX`, 19 on `TRB` and `PYTH`, 21 to 30 on the rest |
| `funding_rate` | 0 changes on 30 | 1 change, on `XTZ-PERP`, 0 on the rest |
| `next_funding_time` | 0 changes | 0 changes |

Socket, `market-overview` and `index-price`, 60 s.

| number | first pass | second pass |
|---|---|---|
| `BTC-PERP` mark | 59 changes in 120 pushes, longest hold 1.03 s | 60 changes in 121 pushes, longest hold 1.50 s |
| `XLM-PERP` mark | 59 changes, longest hold 1.03 s | 60 changes, longest hold 1.50 s |
| `BTC-PERP` index | 58 changes, longest hold 2.0 s | 53 changes, longest hold 4.0 s |
| `XLM-PERP` index | 57 changes, longest hold 2.0 s | 54 changes, longest hold 3.0 s |
| funding rate on both | 0 changes | 0 changes |

So Globe republishes mark and index about once a second, and the socket pushes them every 500 ms.
A 2 s poll therefore reads every second mark.

## 5. REST book snapshot

`GET /api/v1/ticker/orderbook?instrument=BTC-PERP` returns `{"bids": [[price, size], …], "asks": [[price, size], …], "last_updated_at": <ms>}`, S1, where `last_updated_at` is not in the documentation.

| instrument | levels per side | `[0, 0]` padding | order of real levels | `last_updated_at` age at receipt, second pass |
|---|---|---|---|---|
| `BTC-PERP` | 25 and 25 | none | bids descending, asks ascending | 133 ms |
| `XLM-PERP` | 25 and 25 | 2 bids | same | 152 ms |
| `IOTA-PERP`, suspended | 25 and 25 | all 50 | none | 78 ms |
| `BTC/USDT`, spot | 25 and 25 | none | same | 60 ms |
| `NOPE-PERP` | 400 `{"error":"invalid-instrument","details":"NOPE-PERP"}` | | | |

The book always has 25 entries per side, and a side with fewer real levels is filled with `[0, 0]` at the end.
A reader has to drop those entries.
Sizes are in the base currency, and the top five levels equalled the socket book on both passes, see [`websocket.md`](./websocket.md) section 4.
No depth parameter is documented, and replies were `DYNAMIC` at the edge, so nothing is cached.
The socket is the better source, since it pushes the same book every 100 ms.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| REST limit | "1 request per second" | S1 |
| WebSocket limit | "50 messages per second" | S1 |
| on excess | "requests may be rejected. If you persistently exceed these limits we may block your IP address or deactivate your trading account." | S1 |
| status code of a limit | Not publicly specified, and not tested, since the probe stayed under the limit | |
| `Retry-After` | not seen, and no rate limit header was present on any reply | P1 |

| request | status | body |
|---|---|---|
| `/ticker?instrument=NOPE-PERP` | 400, `application/json` | `{"error":"invalid-instrument","details":"NOPE-PERP"}` |
| `/ticker` with no `instrument` | 400, `text/plain` | ``Query deserialize error: missing field `instrument` `` |
| `/ticker/orderbook` with no `instrument` | 400, `text/plain` | the same text |
| `/nope` | 404 | empty |
| `/history/index-price/BTC-PERP/candles/8h` | 404 | ``unknown variant `8h`, expected one of `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `60m`, `2h`, `4h`, `6h`, `12h`, `1d`, `24h`, `3d`, `1w`, `7d` `` |
| `/history/NOPE-PERP/candles/1m` | 200 | `[]` |

The documentation spells the error key `detail`, and the wire spells it `details`.
The engine pauses its poller on 403, 418 and 429, at `server/src/shared/errors.ts` line 1, and whether Globe's limit uses one of those codes is unknown.

## 7. Server time and clock offset

No server time call is documented, S1.
The HTTP `Date` header has a resolution of one second, and the local midpoint minus the header fell between −153 and +899 ms over both passes, which only says the clocks agree to within that second.
The socket gives a finer bound.
The `depth` stamp arrived a median 53 to 57 ms after it was taken, the protocol ping round trip was 102 to 109 ms, and the host clock was NTP synchronised with an offset of 1.08 ms.
So if the path is symmetric, Globe's clock and this host's agree to within a few milliseconds, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://globe.exchange/api/v1/ticker/contracts` | one call carries index, mark, rate and next settlement for all 30 perpetuals |
| interval | 2,000 ms | the published REST limit is 1 request per second, so the default 1 s cadence would sit on the limit. The reader allows 5 s between legs and 10 s of age, at `server/src/engine/opportunity/anchorReading.ts` lines 4 and 5 |
| row mapping | section 3, key `instrument`, `fundingRate` divided by 100 | the rate is a percentage |
| interval hours | the constant 8, checked against `funding_period` on the socket at boot if a later design wants it | the REST reply has no interval, and all 30 contracts read 28800 s |
| skip | rows whose `product_status` is not `Active` | the 2 suspended contracts have empty books and a mark equal to the index |
| rate limit pause | the default 60,000 ms, at `server/src/feeds/anchor/AnchorPoller.ts` line 9 | no `Retry-After` and no limit status are documented |
| capped mark | treat a premium near the band of section 4 as saturated | the mark cannot leave index ± 2 %, 5.75 % or 10 % |
| alternative | the socket's `market-overview` pushes mark, index and funding every 500 ms per instrument | fresher than a 2 s poll, but the engine's anchor path is REST only, so it would be a new reader |

The bulk reply is about 25 KB before gzip, so a 2 s poll is about 1.1 GB a day.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Globe API documentation, sections "HTTP API", "Get Ticker Contracts", "Get Ticker Orderbook", "Rate Limits", "Errors", "Product Detail" | https://globe.exchange/developers | 2026-09-23 | Globe, global | sections 1 to 7 |
| S2 | Perpetual Contracts | https://globe.exchange/support/perpetual-contracts | 2026-09-23 | Globe, global | index, mark bands, funding schedule, sections 2 and 4 |
| S3 | Globe API client library, `python_client/src/globe.py` line 24 | https://github.com/globedx/globe-api-clients | 2026-09-23 | Globe, last pushed 2021-06-15 | legacy host, section 1 |
| P1 | `rest-probe.mjs catalog`, `anchor`, `book`, `history` and `errors`, first pass at 04:27 to 04:30 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/globe/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | the same five modes, second pass at 04:37 to 04:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/globe/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1 to 7, the second readings |
| P3 | `ws-probe.mjs book`, `product-detail` and `market-overview` | [`ws-probe.mjs`](../../../scripts/probes/venues/globe/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | interval, mark and index cadence, clock, sections 3, 4, 7 |
