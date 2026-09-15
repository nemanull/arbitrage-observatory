# Bitstamp REST Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers Bitstamp's public REST API v2 as the catalog, the anchor poller and a book seed would use it, for the 20 USD settled linear perpetuals.
The probe behind every number is [`../../../scripts/probes/bitstamp-venue-probe.mjs`](../../../scripts/probes/bitstamp-venue-probe.mjs), run at 07:11 UTC, unless a row names [`../../../scripts/probes/bitstamp-ws-probe.mjs`](../../../scripts/probes/bitstamp-ws-probe.mjs) or [`../../../scripts/probes/bitstamp-settlement-probe.mjs`](../../../scripts/probes/bitstamp-settlement-probe.mjs).
All calls were public, unauthenticated and read-only.
A second pass reran the REST and socket probes from 19:20 to 19:25 UTC on the same date, and its numbers are given beside the morning ones where they differ.
Latency and cadence are one host on one date.

## 1. Host and latency

| host | resolved | inference |
|---|---|---|
| `www.bitstamp.net` | `45.60.111.13`, CNAME `qgjb4.x.incapdns.net` | Imperva, which every reply also names in `x-cdn: Imperva` |
| `ws.bitstamp.net` | eight addresses in the morning and six in the second pass, CNAME `websocket-1667196836.eu-central-1.elb.amazonaws.com` | an AWS load balancer in Frankfurt, by name only |

Cold is a fresh TLS connection, and warm is five requests on a kept connection, one per second.
Bytes are uncompressed, since this probe sent no `accept-encoding`.

| call | cold ms | cold connect, TLS, first byte ms | warm min / med / max ms | bytes | origin server header |
|---|---:|---|---|---:|---|
| `GET /api/v2/markets/` | 1,110 | 20, 37, 817 | 183 / 191 / 941 | 101,240 | Apache |
| `GET /api/v2/ticker/` | 766 | 13, 28, 473 | 441 / 467 / 732 | 80,322 | nginx |
| `GET /api/v2/funding_rate/btcusd-perp/` | 635 | 14, 31, 634 | 161 / 165 / 188 | 116 | Apache |
| `GET /api/v2/order_book/btcusd-perp/` | 466 | 13, 22, 466 | 154 / 156 / 162 | 2,442 | nginx |

The second pass read warm medians of 194, 444, 167 and 173 ms on the same four calls.
With `curl --compressed` the all-markets ticker was 15,602 bytes of gzip at 07:16 UTC, and 16,219 bytes in the second pass, and Node's `fetch`, which the poller uses, received `content-encoding: gzip`.
The ticker and order book replies carry `last-modified` equal to the second of the request and an `etag`, from nginx, while the markets and funding replies come from Apache without them.
That split suggests the ticker and book are files the venue regenerates, which is an inference from the headers.

## 2. Catalog

### The instruments call

`GET /api/v2/markets/` returns every market in one array, 277 rows on 2026-09-15.

| field | perpetual value | meaning |
|---|---|---|
| `market_type` | `PERPETUAL` on 20 rows, `SPOT` on 257 | the only two values |
| `market_symbol` | `btcusd-perp` | the id used in REST paths and socket channels |
| `name` | `BTC/USD-PERP` | the spelling used inside REST ticker and funding replies |
| `trading` | `Enabled` on all 20 | `Enabled` or `Disabled`, one spot row was `Disabled` |
| `payoff_type` | `Linear` on all 20 | |
| `contract_size` | `1.00000000` on all 20 | base units per contract |
| `counter_currency` | `USD` on all 20 | settlement is USD, per the trading information page |
| `asset_class` | `CRYPTO`, `COMMODITIES`, `ETF`, `FX` | |
| `has_market_hours` | `true` on GOLD, SILVER, QQQ, EWY, EUR, WTI and BRENT | these seven have an index publishing schedule, see section 4 |
| `max_leverage` | `10.00` or `5.00` | |

The API reference documents `tick_size` and `exchange` on this call, and the changelog of 2026-07-01 says `exchange` was added.
Neither field was on any row of the wire reply, so a catalog must not depend on them.
The documented `entity` filter, tried with each of its nine values, returned no perpetual at all, while the unfiltered call returned 20.

### CCXT

| item | value | source |
|---|---|---|
| `has.swap` | `true` | `server/node_modules/ccxt/js/src/bitstamp.js` line 33 |
| markets call | `publicGetMarkets`, one request | line 788 |
| type mapping | `market_type === 'PERPETUAL'` becomes `type: 'swap'`, settle is the counter currency | lines 674 to 676 |
| `market.id` | `market_symbol`, so `btcusd-perp` | line 689 |
| `active` | `trading === 'Enabled'` | line 704 |
| `linear` | `true` for every non-spot market | line 706 |
| `contractSize` | `undefined` for every market, which the connector turns into 1 | line 708, and [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 180 to 186 |
| `taker` | 0.004 from the class constant | line 439, see [`fees.md`](./fees.md) section 8 |

Filtered exactly like [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194, CCXT 4.5.68 loaded 277 markets in 836 ms and kept 20 active swaps, all `USD` settled and `linear: true`, with none inactive.
The second pass loaded the same 277 and 20 in 614 ms, and again found no `tick_size` or `exchange` field and no perpetual under any `entity` filter.

| market | `id` | `symbol` | base / quote / settle | `contractSize` | `taker` | precision amount / price |
|---|---|---|---|---|---:|---|
| BTC | `btcusd-perp` | `BTC/USD:USD` | BTC / USD / USD | undefined | 0.004 | 0.00001 / 1 |
| ASTER, a thin book | `asterusd-perp` | `ASTER/USD:USD` | ASTER / USD / USD | undefined | 0.004 | 1 / 0.00001 |

### Joins the engine depends on

- `market.id` against the socket: the channel suffix is the same string, `order_book_btcusd-perp`, see [`websocket.md`](./websocket.md) section 3.
- `market.id` against the anchor: the socket's `funding_rate_saved` data carries `market: "btcusd-perp"`, the same string.
  The REST ticker and funding replies carry `market: "BTC/USD-PERP"`, which is not the id.
  `market.replace('/', '').toLowerCase()` turns it into the id, and the probe built all 20 funding URLs that way and all 20 answered 200.
- `contractSize` against the book: 1 in the catalog, undefined in CCXT and therefore 1 in the engine, and the book is in base units, see [`websocket.md`](./websocket.md) section 4.
- Pairs listed twice: none, each of the 20 bases appears once.
- Price scale: none needed on this evidence, since every contract is one unit of its base.

### Tickers that may name a different asset elsewhere

CCXT 4.5.68 was loaded once for each running venue to see which Bitstamp bases collide.

| Bitstamp base | same base elsewhere | different spelling elsewhere |
|---|---|---|
| GOLD | coinbase `GOLD-PERP-INTX` | binance, bybit, okx and krakenfutures use `XAU` |
| SILVER | coinbase `SILVER-PERP-INTX` | the others use `XAG` |
| WTI | none | binance, bybit and okx use `CL` |
| BRENT | none | binance, bybit and okx use `BZ` |
| EUR | krakenfutures `PF_EURUSD` | bybit uses `EURUSD` |
| QQQ, EWY | binance, bybit, okx, coinbase | |
| PAXG, TAO, HYPE, ASTER | several venues | |

Whether coinbase GOLD and SILVER price the same quantity as Bitstamp's, which trades near 4,288 USD for "1 GOLD", was not verified.
A later design should compare the two prices before GOLD and SILVER cluster, and add a `DENIED_PAIRS` line if they differ.

## 3. Anchor

No single REST call returns index, mark and funding for every perpetual.

| call | returns | markets per call | probed reply |
|---|---|---:|---|
| `GET /api/v2/ticker/` | `index_price`, `mark_price`, `bid`, `ask`, `last`, `timestamp`, `open_interest` per market, spot rows included | 277 | 80.3 KB raw, 15.6 KB gzip, and 80.6 KB and 16.2 KB in the second pass |
| `GET /api/v2/funding_rate/{market_symbol}/` | `funding_rate`, `timestamp`, `market`, `next_funding_time` | 1 | 116 bytes |
| `GET /api/v2/funding_rate_history/{market_symbol}/?limit=N` | settled `funding_rate` and `timestamp` | 1 | 394 bytes for 6 rows |
| socket `funding_rate_{market_symbol}` | `funding_rate`, `mark_price`, `index_price`, `market`, `timestamp`, `next_funding_time` | 1 per channel, 20 channels on one socket | one frame a second per market, 239 to 247 bytes |

`GET /api/v2/funding_rate/` without a symbol returned 404 `{"message": "Not found."}`.

A perpetual row of the ticker, 07:03 UTC.

```json
{"timestamp": "1789455809", "open": "78237", "high": "79588", "low": "77191", "last": "77265", "volume": "108.78361", "vwap": "78381", "bid": "77239", "ask": "77240", "side": "1", "open_24": "77700", "percent_change_24": "-0.56", "market_type": "PERPETUAL", "pair": "BTC/USD-PERP", "market": "BTC/USD-PERP", "index_price": "77224.46266666667", "mark_price": "77238.10540904", "open_interest": "66.98297", "open_interest_value": "5173637.6974705640488"}
```

The funding reply, 07:03 UTC.

```json
{"funding_rate": "0.00013", "timestamp": "1789455811", "market": "BTC/USD-PERP", "next_funding_time": "1789459200"}
```

### Reply time over 60 polls at one hertz

| call | polls | ms min / med / p90 / max | status |
|---|---:|---|---|
| ticker, all markets | 60 | 10.6 / 164.5 / 448.8 / 726.6 | 200 on all |
| funding, `btcusd-perp` | 60 | 160.5 / 164.6 / 188.9 / 471.1 | 200 on all |
| funding, `ethusd-perp` | 60 | 160.2 / 165.0 / 191.9 / 577.2 | 200 on all |

9 of the 60 ticker replies took under 20 ms, below the 154 ms network floor of every other call, so they were served from an edge cache, an inference.
The second pass read the ticker at 7 / 299 / 728 / 1,028 ms, with 4 of 60 replies under 20 ms, and the two funding calls at a 163 ms median.
The order book was verified cached, see section 5.

### Field for each AnchorRow column

| column | source | conversion |
|---|---|---|
| key | ticker `market`, filtered to `market_type === "PERPETUAL"` | `market.replace('/', '').toLowerCase()`, so `BTC/USD-PERP` becomes `btcusd-perp` |
| `index` | ticker `index_price` | `Number`, a string with float artifacts such as `77224.46266666667` |
| `mark` | ticker `mark_price` | `Number`, 8 decimal places, never 0 on the 20 perpetuals |
| `fundingRate` | `funding_rate/{id}` `funding_rate` | `Number`, a fraction per 8 hours, see section 4 |
| `fundingIntervalHours` | none on the wire | 8 for every contract, published and probed |
| `nextFundingAt` | `funding_rate/{id}` `next_funding_time` | `Number(...) * 1000`, Unix seconds on the wire |

## 4. Anchor semantics

All formulas are from the perpetual futures trading information page, sections 1.3 to 1.5, retrieved 2026-09-15.

### Index

The index provider is Kaiko.
"Index provider is Kaiko and their Benchmark Reference Rates or Reference Rates are used, i.e. Kaiko BTC Benchmark Reference Rate, Kaiko ETH Benchmark Reference Rate."
Each contract names its rate in `underlying_asset`, for example "Kaiko BTC Benchmark Reference Rate" and "Kaiko ASTER Reference Rate".

| question | answer | label |
|---|---|---|
| basket and weights | not published by Bitstamp, and no constituents call exists in the API reference | Not publicly specified |
| basket call | none | Not offered |
| provider statement | Kaiko calls itself "an independent BMR-registered benchmark administrator" and says its reference rates "publish prices 24/7" | Published by Kaiko, constituents Not publicly specified |
| the venue's own perp in the basket | not stated for the crypto rates | Not publicly specified |
| fallback | an Internal Oracle Price, below | Published |

The Internal Oracle Price is a self-index.
It applies to contracts with index publishing hours "Outside of Index Publishing Hours" and to any contract "During Index Publishing Hours when the benchmark index provider fails to publish".
It "is calculated every second as follows".

```text
Oracle Price(t) = Oracle Price(t-1) + beta * Perp Premium
beta            = 2 * dt / tau,  dt = min(dt_actual, 0.1 * tau),  tau = 28,800 seconds
Perp Premium    = max(Impact Bid Price - Oracle Price latest, 0) - max(Oracle Price latest - Impact Ask Price, 0)
```

The impact prices come from Bitstamp's own perpetual book, so during those windows the index follows the perpetual it anchors, which is the shape of [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
The seven `has_market_hours` contracts have scheduled windows, from `GET /api/v2/derivatives/market_hours/` at 07:22 UTC.

| contracts | index publishing closed, UTC |
|---|---|
| GOLD, SILVER, EUR | 21:00 to 22:00 every day |
| WTI, BRENT | 18:00 to 00:00 every day |
| QQQ, EWY | Saturday 00:00 to Monday 00:00 |

All seven read `is_reference_index_publishing: true` during the morning probe.
At 19:22 UTC in the second pass, WTI and BRENT read `false`, inside their 18:00 to 00:00 window, with their mark 4,293 ppm above and 5,496 ppm below the ticker `index_price`.
Whether `index_price` on the ticker reports the oracle during a closed window is Not verified, since nothing on the wire names the source of the number.

### How often the index moves

The crypto rates of smaller coins moved in steps far coarser than the market.
From the socket, 201 s in run 2, index changes per market: BTC 154, GOLD 176, QQQ 154, EWY 152, SILVER 136, EUR 120, BRENT 92, WTI 87, ADA 40, XRP 39, ETH 38, TAO 37, SOL 35, SUI 31, DOGE 30, HYPE 28, PAXG 23, AVAX 20, LINK 19, ASTER 5.
Beside Binance's own index for the same coins, read once a second for 60 s from 07:19:52 UTC:

| coin | Bitstamp index changes | Bitstamp range ppm | Binance index changes | Binance range ppm |
|---|---:|---:|---:|---:|
| BTC | 42 | 480 | 45 | 294 |
| ASTER | 3 | 54 | 16 | 1,034 |
| LINK | 7 | 753 | 45 | 921 |
| AVAX | 1 | 2,271 | 33 | 1,607 |

Bitstamp's AVAX index changed once in that minute, between 7.486 and 7.503, a single step of 2,271 ppm.
That step alone exceeds the 1,000 ppm per poll limit at [`../../../server/src/engine/opportunity/anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 6, and between steps the index stands still while the book moves.
ASTER's index stood at 0.68721 for all 60 REST polls from 07:12 UTC.

### Mark

```text
Impact Bid Price = average bid price of a $10,000 equivalent market sell order on the perp book
Impact Ask Price = average ask price of a $10,000 equivalent market buy order on the perp book
Fair Impact Bid  = Max(Impact Bid Price, Best Bid Price - 0.1%)
Fair Impact Ask  = Min(Impact Ask Price, Best Ask Price + 0.1%)
Fair Price       = (Fair Impact Bid + Fair Impact Ask) / 2
Mark price       = round_nearest dp=8 (Raw Index Price + EMA over the last 300 seconds of (Fair Price - Raw Index Price))
```

| clamp | value | label |
|---|---|---|
| impact price against the touch | within 0.1 % of the best bid or ask | Published |
| mark premium over the index | no cap while the benchmark index is live | Not publicly specified |
| mark against the oracle, when the oracle is active | "bounded to ±10% of the Internal Oracle Price" | Published |
| thin book, oracle active | if impact bid and ask are more than 5 % apart, the mark "falls back to the Internal Oracle Price" | Published |
| EMA reset | the premium EMA "is reset to 0" after the oracle was used for 1 minute or more | Published |

Probed at 07:12 UTC, WTI's mark sat 14,889 ppm above its index and BRENT's 1,300 ppm, so nothing caps the mark premium near the engine's thresholds.
Because the premium is an EMA over 300 s of the perp's own impact prices, the mark trails the Bitstamp book, not the market.

### Funding

```text
Premium Rate Unrounded = sum over t of [(Fair Price t - Raw Index Price t) / Fair Price t] * w(t)  /  sum over s of w(s)
    w(t) = seconds from (most recent second - 8h) to t, over the last 8 hours, where both prices exist and come from the index provider
Premium Rate Rounded   = sign(P) * round_down dp=6 (Abs(P))
Funding Rate           = Max(1 bp, Premium Rate Rounded) + Min(-1 bp, Premium Rate Rounded)
Funding Payment        = Full Trade Notional in Settlement Currency * Funding Rate
```

| question | answer | label |
|---|---|---|
| interest component | none | Published |
| cap and floor | none beyond a dead band, a premium within plus or minus 1 bp gives 0 and a larger one is reduced by 1 bp | Published, cap Not publicly specified |
| interval | 8 hours on every contract | Published, and Probed: the three gaps between the last four settlements were 8 h on all 20 |
| instants | 00:00, 08:00, 16:00 UTC | Published, and Probed: `next_funding_time` was 1789459200, 2026-09-15 08:00 UTC, on all 20 at 07:12 UTC. At 19:22 UTC it was 00:00 UTC on 18 contracts and 08:00 UTC on WTI and BRENT, whose closed window and 1 hour buffer cover 00:00 |
| published rate | "Funding rates are calculated every second", and away from the instant the rate "is an indicative rate, which takes all observations from the current calculation time – 8h + 1 sec", so it is the running rate for the upcoming settlement | Published |
| rate at the instant | "the exact rate used for funding payment calculations at this time" | Published |
| unit | a fraction per 8 hour interval | Probed inference, see below |
| skipped | for contracts with index publishing hours, while the benchmark index is unavailable and for 1 hour after it resumes | Published |
| history timestamps | on the instant or 1 s after it, `16:00:00` and `16:00:01` both occur in the BTC history | Probed |

The documentation never states the unit.
Its API example is `"0.0024"`, while every probed value had six decimal places or fewer, like `"0.000127"`, which matches the six decimal rounding of a fraction.
The magnitudes decide it.
At 07:12 UTC BTC's mark premium was 171 ppm and its rate 0.000127, ETH 99 ppm and 0.000077, SUI 286 ppm and 0.000146, GOLD 484 ppm and 0.000328, ASTER 567 ppm and 0.000252.
Read as a fraction, those rates are the size an 8 hour premium of that order produces after the 1 bp dead band.
Read as a percent, every one of the 20 markets would need an 8 hour average premium between 1.00 and 1.04 bp, which the spread of mark premiums from -371 to 14,889 ppm rules out.

WTI and BRENT break the formula as published.
Every one of their last 100 settled rates, from 2026-08-13 00:00 UTC to 2026-09-15 00:00 UTC, is exactly 0, and their indicative rate was 0 during the probe, while their mark sat 1.49 % and 0.13 % over the index.
The second pass read the same 100 zeros through 2026-09-15 16:00 UTC, and an indicative rate of 0 again.
Their index publishing window covers 08:00 and 16:00 UTC, so the skip rule does not explain those instants.
This is an open question.

Whether the rate published in the last seconds before an instant equals the settled history value, and what the published rate does just after it, was Not verified.
[`../../../scripts/probes/bitstamp-settlement-probe.mjs`](../../../scripts/probes/bitstamp-settlement-probe.mjs) watches five markets across one instant for that.
It was stopped before the 08:00 UTC instant, and the second pass ran from 19:20 to 19:25 UTC, between instants, so it has no result yet.

### Change cadence over about a minute of one second polls

From 60 REST polls at 07:12 UTC.

| market | index changed | mark changed | ticker `timestamp` changed | funding rate changed | funding `timestamp` changed |
|---|---:|---:|---:|---:|---:|
| `btcusd-perp` | 29 | 32 | 32 | 0 | 58 |
| `ethusd-perp` | 11 | 35 | 35 | 2 | 55 |
| `asterusd-perp` | 0 | 32 | 32 | 1 | 59 |
| `ewyusd-perp` | 28 | 32 | 32 | 0 | 59 |

The second pass at 19:21 UTC read index, mark, ticker `timestamp`, funding rate and funding `timestamp` changes of 33, 41, 41, 1 and 59 on BTC, 12, 42, 42, 1 and 59 on ETH, 10, 42, 42, 4 and 57 on ASTER, and 35, 39, 39, 0 and 59 on EWY.

The all-markets ticker republished about every 2 s in the morning, since its BTC `timestamp` changed in 32 of 60 polls and `last-modified` in 37, and about every 1.5 s in the second pass, at 41 and 51.
The ticker's `timestamp` was 0 to 3 s old on arrival, median 1 s.
The funding call's `timestamp` changed on 55 to 59 of 60 polls, so it tracks the time of the reply rather than a change of the rate.
The socket's `funding_rate_saved` frames arrived every 1,000 ms median, 789 ms minimum and 1,180 ms maximum over runs 1 and 2 of the socket probe, and their mark changed on 200 of 200 frames for 19 of 20 markets, so the socket carries a fresher mark than the ticker.
The second pass read medians of 992 to 1,006 ms, 777 to 1,216 ms at the extremes, and a mark change on 89 or 90 of 90 gaps on all 20 markets.

## 5. REST book snapshot

`GET /api/v2/order_book/{market_symbol}/` returns `{timestamp, microtimestamp, bids, asks}` with string tuples.

| item | documented | probed |
|---|---|---|
| depth | no depth parameter | the whole book, 73 bids and 46 asks on `btcusd-perp`, from 77,218 down to 35,000 and from 77,219 up to 154,495, and 74 and 45 in the second pass, down to 35,000 and up to 152,095 |
| `group` | 0 per order, 1 aggregated and the default, 2 per order with order ids, an integer from 0 to 2 | 0 gave 84 bids with 18 repeated prices, 1 gave 69, 2 gave 86 with ids, and 3 was accepted and aggregated like 1. The second pass gave 97 with 20 repeated, 78, 99 with ids, and 79 for `group=3` |
| level order | not documented | bids strictly descending and asks strictly ascending on `btcusd-perp` and `asterusd-perp` |
| units | base currency | matches the socket at the same prices, see [`websocket.md`](./websocket.md) section 4 |
| caching | not documented | a second read 300 ms later returned in 15 ms with the same `microtimestamp`, the same `etag` and `x-iinfo` flag `0CNN`, and a read with the nonce `?_=<ms>` returned a fresh `microtimestamp` in 166 ms. The second pass repeated it at 9 ms and 151 ms |
| timestamps | `timestamp` seconds, `microtimestamp` microseconds | the `microtimestamp` trailed the reply by 0.5 s on `btcusd-perp` and 2.1 s on `asterusd-perp`, and by 0.16 s and 0.69 s in the second pass, so it marks the book's last change and is not a clock |

So the edge serves a cached book for up to about a second, and a seed read needs a nonce.

## 6. Rate limits and errors

The API reference says "As standard, all clients can make 400 requests per second."
It continues "There is a default limit threshold of 10,000 requests per 10 minutes in place."
CCXT's comment at `server/node_modules/ccxt/js/src/bitstamp.js` line 24 still says 8,000 per 10 minutes.

| item | value | label |
|---|---|---|
| per second | 400 requests | Published |
| per 10 minutes | 10,000 requests, a 16.7 per second average | Published |
| limit reply | `response_code` `400.002` "Request rejected due to exceeded rate limit", `400.067` "exceeded client rate limit", `400.068` "exceeded market rate limit" | Published |
| HTTP status of a limit reply | not stated | Not publicly specified |
| `Retry-After` | not documented, and no rate limit header appeared on any probed reply | Not publicly specified |
| WAF | the site answers non-browser page requests with an Imperva JavaScript challenge, the API paths did not | Probed |

The engine pauses only on 403, 418 and 429, at [`../../../server/src/shared/errors.ts`](../../../server/src/shared/errors.ts) line 1.
If Bitstamp answers a limit with HTTP 400 and `response_code: "400.002"`, the poller would not pause, which a later design has to handle.

Error shapes, probed:

| request | status | body |
|---|---|---|
| `/api/v2/order_book/fooxyz-perp/` | 404 | nginx HTML page, 146 bytes |
| `/api/v2/ticker/fooxyz-perp/` | 200 | the full all-markets array, 80 KB, not an error |
| `/api/v2/ticker/BTCUSD-PERP/` | 200 | the BTC perpetual ticker, so the path is case insensitive |
| `/api/v2/ticker/btcusd-perp/?x=1` | 200 | the ticker, although the reference says "Passing any GET parameters, will result in your request being rejected" |
| `/api/v2/funding_rate/fooxyz-perp/` | 404 | empty body with `content-type: application/json` |
| `/api/v2/funding_rate/btcusd/`, a spot market | 404 | empty body |
| `/api/v2/funding_rate/` | 404 | `{"message": "Not found."}` |
| `/api/v2/derivatives/market_hours/btcusd-perp/` | 404 | empty body, as documented for a market without a schedule |

The second pass returned the same status and body shape on all eight rows.
A mistyped symbol on the ticker call silently returns every market, so a poller must key by the `market` field and never trust the path.

## 7. Server time

The API reference lists no server time call.
The `Date` header matched this host's clock to the second, and the socket's frame timing bounds the offset to a few milliseconds, see [`websocket.md`](./websocket.md) section 4.

## 8. Recommended poller shape

This is a recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| index and mark | `GET https://www.bitstamp.net/api/v2/ticker/` every 1 s | one call carries all 20, a 164 ms median in the morning and 299 ms in the second pass, and its content changes every 1.5 to 2 s |
| funding | `GET https://www.bitstamp.net/api/v2/funding_rate/<rawMarketId>/`, one market per round in rotation | 20 markets at 1 Hz would be 12,000 requests per 10 minutes, over the 10,000 limit, while the rate changed 0 to 11 times in 201 s per market |
| request budget | 2 requests a second, 1,200 per 10 minutes | about an eighth of the published limit |
| interval | `fundingIntervalHours: 8` as a constant | no interval field exists, and all 20 settle every 8 h |
| next settlement | `nextFundingAt` from each reply's `next_funding_time`, never computed from the 8 hour grid | WTI and BRENT skip instants that fall in a closed publishing window, section 4 |
| row mapping | the table in section 3 | |
| skip | rows whose `market_type` is not `PERPETUAL` | the ticker mixes 257 spot rows in |
| refuse | legs of `has_market_hours` contracts inside a closed publishing window, read hourly from `GET /api/v2/derivatives/market_hours/` | the index there is the venue's own oracle |
| rate limit | also pause on HTTP 400 whose body carries `response_code` `400.002`, `400.067` or `400.068` | section 6 |

The socket channel `funding_rate_<rawMarketId>` is the stronger source.
It pushes all five fields once a second per market, keyed by the exact `rawMarketId`, with no request budget, and the ticker's 2 s republish and edge cache do not apply to it.
Using it means an anchor reader on a socket instead of `AnchorPoller`, which is a named change to the current shape.

Two readings will produce refusals or misleading rows whichever source is used.
The coarse steps of thin crypto indices, AVAX's 2,271 ppm step above, trip `anchor_moving` on the step and read as a fresh edge between steps.
The oracle index of the seven market-hours contracts is the perpetual's own book during closed windows.

## 9. Source ledger

| title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|
| Bitstamp API reference, OpenAPI 3.0.3 spec embedded in the page, changelog to 2026-08-28 | https://www.bitstamp.net/api/ | 2026-09-15 | all Bitstamp entities | sections 2, 3, 5, 6, 7 |
| Perpetual futures trading information | https://www.bitstamp.net/derivatives/perpetual-futures/trading-information/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | section 4 |
| Perpetual futures contract specifications | https://www.bitstamp.net/derivatives/perpetual-futures/contract-specifications/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | sections 2 and 4 |
| Pricing, Index, and Funding Mechanism (FAQ) | https://www.bitstamp.net/faq/pricing-index-and-funding-mechanism/ | 2026-09-15 | all Bitstamp entities | section 4 |
| Websocket API v2 | https://www.bitstamp.net/websocket/v2/ | 2026-09-15 | all Bitstamp entities | section 3 socket channel |
| Reference Rates: Crypto Markets | https://www.kaiko.com/indices/reference-rates-crypto-markets | 2026-09-15 | Kaiko, index provider | section 4 provider statement only |
| CCXT 4.5.68 bitstamp class | `server/node_modules/ccxt/js/src/bitstamp.js` lines 24, 33, 439, 674 to 676, 689, 704, 706, 708, 788 | 2026-09-15 | not applicable | section 2 |
| REST probe | [`../../../scripts/probes/bitstamp-venue-probe.mjs`](../../../scripts/probes/bitstamp-venue-probe.mjs), run 07:11 UTC | 2026-09-15 | this host | sections 1 to 7 |
| Socket probe, index comparison mode | [`../../../scripts/probes/bitstamp-ws-probe.mjs`](../../../scripts/probes/bitstamp-ws-probe.mjs), runs 07:11 and 07:19 UTC | 2026-09-15 | this host, and Binance `fapi/v1/premiumIndex` for the comparison | sections 3 and 4 |
| Settlement probe | [`../../../scripts/probes/bitstamp-settlement-probe.mjs`](../../../scripts/probes/bitstamp-settlement-probe.mjs), written, not run to completion | 2026-09-15 | this host | section 4 open question |

The `www.bitstamp.net` pages other than the API reference were rendered with headless Google Chrome, because plain requests received an Imperva challenge page.
