# CoinDCX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:25 PDT, which is 03:25 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public REST market data of CoinDCX perpetual futures.
Every number was read by [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs), whose mode and run are named beside it, and the documentation is S1 in section 9.
All probe times are UTC on 2026-09-23.
The central finding is section 2: every CoinDCX perpetual is a Binance USD-M perpetual, relayed.

## 1. Host and latency from this machine

| host | resolved to | role |
|---|---|---|
| `api.coindcx.com` | `104.18.12.22`, `104.18.13.22` and two IPv6, Cloudflare | catalog, instrument details, trades |
| `public.coindcx.com` | the same Cloudflare addresses | current prices, order books, candles |
| `stream.coindcx.com` | CNAME `k8s-production-socket-pub-758436106.ap-south-1.elb.amazonaws.com`, six AWS Mumbai addresses | WebSocket, see [`websocket.md`](./websocket.md) |

`rest-probe.mjs latency`, ten requests each, 300 ms apart, at 03:34 and 03:55 UTC:

| call | bytes | cold | warm min, median, max | `cf-cache-status` |
|---|---:|---:|---|---|
| `GET /exchange/v1/markets` | 10,387 | 338 and 327 ms | 258 to 262, 267, 1,007 to 1,024 ms | `DYNAMIC` |
| `GET /exchange/v1/derivatives/futures/data/active_instruments` | 7,030 | 22 and 29 ms | 17, 19 to 21, 25 to 35 ms | `HIT`, `age` 279 and 114 |
| `GET /market_data/v3/current_prices/futures/rt` | 126,096 to 126,122 | 291 and 365 ms | 29 to 32, 37 to 46, 376 to 941 ms | `HIT` and `EXPIRED` |
| `GET /market_data/v3/orderbook/B-BTC_USDT-futures/50` | 1,830 | 302 and 262 ms | 259 to 261, 267 to 268, 709 to 719 ms | `DYNAMIC` |

A request that reaches the origin takes about 260 ms from here, and one served from the Cloudflare edge takes 17 to 50 ms.
Every host answered this machine, with no refusal.
The marketing site `coindcx.com` refuses it, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=USDT` returns a bare JSON array of pair ids, 504 on 2026-09-23 in both runs, `catalog` P1.
The same call with `INR` returns the same 504 ids, and with `BTC` it returns `[]`.
Every id has the shape `B-<base>_USDT`.
The call is cached at the Cloudflare edge, and the `age` header read 279 s and 114 s in two runs.

There is no bulk details call.
`GET /exchange/v1/derivatives/futures/data/instrument?pair=<id>&margin_currency_short_name=USDT` returns one pair, S1, and the probe read all 504 at four per second in two runs with identical tallies, `instruments` P2:

| field | values on 504 pairs |
|---|---|
| `status` | `active` on 504, documented values `active` and `inactive` |
| `kind` | `perpetual` on 504 |
| `settle_currency_short_name` | `USDT` on 504 |
| `unit_contract_value` | 1 on 504, "This will be equal to 1 for all the Perpetual futures" |
| `quanto_to_settle_multiplier` | 1 on 504 |
| `funding_frequency` | 4 on 397, 8 on 105, 1 on 2, in hours |
| `maker_fee`, `taker_fee` | see [`fees.md`](./fees.md) section 2 |
| `exit_only` | true on 1, `B-STG_USDT` |

A details request for a pair that does not exist does not fail.
`pair=B-NOPE_USDT`, `pair=BTCUSDT` and `pair=B-BTC_USDT&margin_currency_short_name=BTC` each returned 200 with the details of `B-LAB_USDT`, `errors` P5.

### The pairs are Binance USD-M perpetuals

| check | result | run |
|---|---|---|
| each id `B-<base>_USDT` as a Binance symbol `<base>USDT` | 504 of 504 are Binance USD-M perpetuals with status `TRADING`, 498 of contract type `PERPETUAL` and 6 of `TRADIFI_PERPETUAL` | `catalog` P1 |
| the `mkt` field of the current prices reply | equals the Binance spelling on every key that carries it | `catalog` P1 |
| `mp` against Binance `premiumIndex` `markPrice` | equal on 498 of 498 in the first read, and on 369 and 261 of 504 in two later reads, with Binance read 147 to 152 ms after CoinDCX. The anchor polls found 158 to 504 of 504 equal | `catalog` P1, `anchor` P3 |
| `efr` against Binance `lastFundingRate` | equal on 504 of 504 | `catalog` P1 |
| `fr` against the latest Binance settlement from `/fapi/v1/fundingRate` | equal on 504 of 504 | `catalog` P1 |
| `funding_frequency` against Binance `fundingInfo` | equal on 504 of 504, counting a symbol absent from `fundingInfo` as 8 h | `instruments` P2 |
| order book levels against Binance `/fapi/v1/depth` | 20 of the top 20 bid prices on Binance for ETH and DOGE in two runs, with 17, 17, 5 and 17 of 20 sizes equal, read 147 to 377 ms apart | `book` P4 |
| book update event time `E` against Binance diff events | every update carried the `E` of a Binance `@depth@500ms` event | [`websocket.md`](./websocket.md) section 4 |

The documentation calls the source "TPE", a "Third-Party exchange", S1 glossary.
The terms say CoinDCX places "corresponding orders with third party exchanges", see [`fees.md`](./fees.md) section 1.
So CoinDCX lists 504 of Binance's 727 trading USDT-quoted perpetuals, under its own ids, with Binance's book, mark and funding.
That Binance is the third party is an inference from the wire, since no CoinDCX document names it.

### How the engine's catalog would map it

| engine need | CoinDCX |
|---|---|
| CCXT `loadMarkets` | no CCXT class exists, see [`fees.md`](./fees.md) section 8, so a catalog would have to be built from the two calls above |
| `rawMarketId` | the REST and anchor key is `B-BTC_USDT`, while the book frame routes on `s` spelled `BTCUSDT`, see [`websocket.md`](./websocket.md) section 3. One of the two needs a mapping, removing `B-` and `_` |
| `contractSize` | 1, and book sizes are in base coins: ETH sizes read 92.692 against Binance's 92.648 at the same price, and Binance ETHUSDT sizes are ETH |
| `linear` | yes, USDT settled |
| `active` | the active list. The current prices reply also keeps 37 inactive pairs with marks frozen since as early as 2026-02-16 |
| a pair listed twice | no. INR margin trades the same contract ids |
| price scale | 11 contracts carry a multiplier in the base name, for example `B-1000PEPE_USDT`, `B-1MBABYDOGE_USDT` and `B-1000000MOG_USDT`, the same as on Binance |

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET https://public.coindcx.com/market_data/v3/current_prices/futures/rt` | absent | `mp` | `efr` upcoming, `fr` last settled | absent | absent | 126.1 to 126.8 KB, 541 keys | two runs of 60 polls: min 33 and 28, median 70 and 45, p90 360 and 642, max 1,410 and 1,420 ms |

`anchor` P3 polled it once a second for 60 s at 03:33 and 03:54 UTC.
The reply is `{ts, vs, prices}`, where `prices` is keyed by pair id and each value carries `fr`, `efr`, `mp`, `bmST`, `cmRT`, `skw` on all 541 keys, and `h`, `l`, `v`, `ls`, `pc`, `mkt`, `btST`, `ctRT` on 539.
The documentation defines only `h`, `l`, `v`, `pc`, `btST` "TPE Tick send time" and `bmST` "TPE mark price send time (The timestamp at which Third-Party exchange sent this event)", and leaves `fr`, `efr`, `ls`, `mkt`, `ctRT`, `skw` and `cmRT` blank, S1.
The reading of `fr` and `efr` below comes from the Binance comparison in section 2.

No public call returns an index, a funding interval in bulk, or a next settlement time.
`POST /api/v1/derivatives/futures/data/stats` and `/conversions` need an API key, S1.

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| key | the `prices` key, `B-BTC_USDT` | filter to the active list, since 37 keys are inactive |
| `index` | none | CoinDCX publishes none. The engine divides by the index at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 58, so a zero index cannot stand in |
| `mark` | `mp`, a JSON number | never 0 on 541 keys |
| `fundingRate` | `efr`, a JSON number, a fraction per interval | equals Binance's upcoming rate on 504 of 504 |
| `fundingIntervalHours` | `funding_frequency` of the per pair details call | 504 calls, so a slow refresh |
| `nextFundingAt` | none | 0, unknown |

## 4. Anchor semantics

### Index

CoinDCX publishes no index and no basket.
The mark is Binance's, so the index behind it is Binance's, and Binance's basket shapes carry over, including a basket that is Binance's own perpetual, see [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
`B-ONE_USDT` is in the active list, P1.

### Mark

`mp` equals Binance USD-M `markPrice`, so the formula and every clamp are Binance's, see [`../binance/fees.md`](../binance/fees.md) section "Futures funding" for the premium and its clamp.
CoinDCX adds only delay.

| measure, `anchor` P3, 60 polls, run at 03:33 and run at 03:54 | min | median | max |
|---|---:|---:|---:|
| per poll median of `cmRT` minus `bmST`, CoinDCX receipt after Binance's stamp | 132 and 123 ms | 147 and 143 ms | 243 and 246 ms |
| per poll median of `ts` minus `cmRT`, reply built after receipt | 500 and 447 ms | 595 and 589 ms | 668 and 1,297 ms |
| per poll median of arrival here minus `bmST` | 1,041 and 907 ms | 2,022 and 1,632 ms | 2,467 and 2,631 ms |
| arrival here minus the reply's `ts` | 308 and 196 ms | 1,221 and 929 ms | 1,724 and 1,681 ms |

So a mark read from this reply was stamped by Binance about 1.6 to 2 s before it arrived.
Of 12 compares per run with Binance read about 150 ms later, a pair that differed was almost always newer on Binance, and CoinDCX's `bmST` was newer on only 4 pairs in one compare and 5 pairs in each of two others, `anchor` P3.
`B-BTC_USDT` `bmST` stood still on 28 and 26 of 59 steps and otherwise moved by 998 to 1,000 ms at the median, up to 3,002 ms.
The reply's `vs` stepped by 0 to 7 per second, median 2 and 3, so the edge sometimes served the same reply twice.

### Funding

`efr` is the rate for the upcoming settlement and `fr` is the rate of the last one, section 2.
Both are Binance's, so the funding formula and cap are Binance's, see [`../binance/fees.md`](../binance/fees.md) section "Futures funding".
The support page describes only the payment, see [`fees.md`](./fees.md) section 6.
The settlement instant was not captured.
After the 04:00 UTC settlement of the 4 hourly pairs, `fr` differed from Binance's newest settled rate on 13 of 504 pairs at 04:03:49 UTC, and at 04:04:13 UTC it equalled the newest rate on 502 and the previous rate on 2, `catalog` P1.
`efr` equalled Binance's `lastFundingRate` on 504 of 504 in both reads.
No CoinDCX funding history is public, since the funding stage of the transactions call needs an API key, S1.

### How often each number changed

Over 59 one second steps on the 504 active pairs, two runs, `anchor` P3:

| field | changes | per pair |
|---|---|---|
| `mp` | 7,534 and 7,591 | median 13 and 14, max 31 and 33. `B-BTC_USDT` 27 and 27, `B-ETH_USDT` 25 and 30, `B-DOGE_USDT` 29 and 29, `B-CHR_USDT` 12 and 15 |
| `ls` | 3,920 and 3,952 | |
| `efr` | 6 and 74 | |
| `fr` | 0 and 0 | |

## 5. REST book snapshot

`GET https://public.coindcx.com/market_data/v3/orderbook/<id>-futures/<depth>`, where depth is 10, 20 or 50, S1.

| item | finding, `book` P4 |
|---|---|
| shape | `{ts, vs, asks, bids}`, each side an object from price string to size string |
| depth 10, 20, 50 | exactly that many levels per side on `B-ETH_USDT` |
| depth 30 or 100, or an unknown pair | 200 with `{"ts":0,"vs":0,"asks":{},"bids":{}}` |
| level order in the text | bids descending, asks ascending, except that a price with no decimals is written first. `B-ETH_USDT` asks began `"2766"`, `"2765.91"`, `"2765.92"` at every depth in the first run, and the 50 level asks began `"2775"`, `"2774.66"` in the second, while its 10 and 20 level asks held no round price and were in order |
| `vs` | one counter per pair and depth, since depth 10, 20 and 50 of ETH read 220,433,809, 220,531,495 and 220,546,821 |
| refresh | reads 250 ms apart advanced `vs` by one for each 500 ms step of `ts`, in two runs |
| age on arrival | 144 to 616 ms after `ts` over two runs |
| caching | `cf-cache-status: DYNAMIC` |

The `vs` of a REST book belongs to the socket's chain for the same pair and depth, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented | observed |
|---|---|---|
| general limit | "16/sec, 960/min", S1 FAQ | `ratelimit-policy: 5000;w=60` and `ratelimit: limit=5000, remaining=4989, reset=30` on `/exchange/v1/markets` and `/exchange/ticker` |
| futures data and `public.coindcx.com` | not separately specified | no rate limit header |
| order calls | a spot table from 30 to 2,000 per 60 s, S1 | not probed |
| limit status | 429, glossed "Too Many Requests" and "You're making too many API calls", S1 | not reached, the probes stayed at 4 per second or less |
| `Retry-After` | not documented | not seen |
| outage | 500, and 503 "when there is a downtime", S1 FAQ | not seen |

| request, `errors` P5 | status | body |
|---|---|---|
| unknown path | 404 | `{"status":"error","message":"not_found","code":404}` |
| instrument of an unknown pair | 200 | the details of `B-LAB_USDT` |
| trades of an unknown pair | 200 | trades at prices near 0.063 in both runs, which belong to some other pair |
| order book of an unknown pair or depth | 200 | `{"ts":0,"vs":0,"asks":{},"bids":{}}` |

A consumer has to check the returned `pair` and a nonzero `ts`, since a wrong request fails silently.

## 7. Server time and clock offset

CoinDCX documents no time call, and `GET /api/v1/time` answered 404, `errors` P5.
The `Date` header read 687 and 157 ms behind the local clock, which is inside its one second granularity.
Book frames on the socket arrived 130 to 138 ms after their `ts` at the minimum, which bounds the CoinDCX clock offset plus the one-way transit from Mumbai, see [`websocket.md`](./websocket.md) section 4.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| poller | none | the reply has no index and no next settlement, and its mark and rates are Binance's, about 2 s late |
| where the anchor comes from | Binance's own `premiumIndex`, already polled by the Binance poller, keyed by the Binance spelling of the pair | it is the same number without the relay |
| if a CoinDCX poll is ever wanted | `current_prices/futures/rt` every 1,000 ms, key the pair id, keep only active ids, `mark` from `mp`, `fundingRate` from `efr`, `fundingIntervalHours` from a daily sweep of the details call, `nextFundingAt` 0 | median 45 and 70 ms and max 1,420 ms over two runs of 60 polls, and one call per second is far inside 16 per second |
| skip | the 37 inactive keys, and any key whose `bmST` is more than a few seconds old | their marks are frozen |
| rate limit pause | 60,000 ms | the only limit header seen has a 60 s window, and no `Retry-After` was seen |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinDCX API documentation | https://docs.coindcx.com/ | 2026-09-22 | CoinDCX, India | calls, fields, glossary, limits, error codes, FAQ, sections 2 to 7 |
| S2 | Binance USD-M public endpoints `premiumIndex`, `exchangeInfo`, `fundingRate`, `fundingInfo`, `depth` | https://fapi.binance.com/fapi/v1/ | 2026-09-23 UTC | Binance | the comparison of section 2 |
| P1 | `rest-probe.mjs catalog` at 03:25 to 03:27 UTC, three runs, the last with the settled rate paged, and at 03:54, 04:03 and 04:04 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | section 2 |
| P2 | `rest-probe.mjs instruments` at 03:26 to 03:31 and 03:49 to 03:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | section 2 |
| P3 | `rest-probe.mjs anchor` at 03:33 and 03:54 UTC, after a first run at 03:31 UTC without the relay timings | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 4 |
| P4 | `rest-probe.mjs book` at 03:34 and 03:55 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 2 and 5 |
| P5 | `rest-probe.mjs errors` and `latency` at 03:34 and 03:55 UTC, and one `curl -D -` of the headers at 03:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coindcx/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 2, 6 and 7 |
