# BigONE REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:08 to 04:40 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocated to Canada (Cloudflare trace `loc=CA`, colo `YVR`).

This profile covers the public contract REST API v2 of BigONE (CCXT id `bigone`) for both perpetual families, USDT-margined and coin-margined.
Every measured number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) unless a source id says otherwise.
The OpenAPI file BigONE publishes, S2, documents only two public contract calls, `GET /instruments` and `GET /depth@{symbol}/snapshot`.
CCXT and BigONE's own web app also call `GET /symbols`, which is where the catalog lives.

## 1. Host and latency from this machine

| item | value |
|---|---|
| hosts | `big.one`, which CCXT uses at `server/node_modules/ccxt/js/src/bigone.js` line 110, and `api.big.one`, which the documentation uses, S1 |
| resolution | both resolved to `184.30.150.140` and `184.30.150.154`. `api.big.one` and `open.big.one` are CNAMEs of `b1.run.edgekey.net`, an Akamai edge |
| origin | `server: envoy` behind the edge, with `server-timing` split such as `edge; dur=105, origin; dur=23` |
| cold request, `GET /symbols` with `connection: close` | 248.6 ms, and 216 ms in the second pass |
| warm requests, `GET /symbols`, five at 1 s | median 161.6 ms, min 138.8, max 173.2, and median 181.8 ms, min 153.2, max 193.9 in the second pass |
| caching | every one of the 180 `instruments` polls and the 18 book reads carried `cdn-cache; desc=MISS`, so the edge does not cache these replies |
| compression | replies arrive gzip encoded |

The first run and the second pass differ by a few tens of milliseconds, see section 9 for the run times.

## 2. Catalog

### The instruments call

`GET https://big.one/api/contract/v2/symbols` returns a bare JSON array, 50,712 bytes and 103 rows on 2026-09-23 04:13 UTC.
Each row carries `symbol`, `baseCurrency`, `quoteCurrency`, `settleCurrency`, `isInverse`, `multiplier`, `enable`, `type`, `priceStep`, `pricePrecision`, `valuePrecision`, `initialMargin`, `maintenanceMargin` and risk limit fields.
The only status field is the boolean `enable`.

| family | `settleCurrency` | `isInverse` | `enable` true | `enable` false |
|---|---|---|---:|---:|
| USDT-M, `type` `CRYPTO` | USDT | false | 43 | 4 |
| USDT-M, `type` `STOCK` | USDT | false | 49 | 0 |
| USDT-M, `type` `METAL` | USDT | false | 2 | 0 |
| USDT-M, `type` `COMMODITY` | USDT | false | 3 | 0 |
| coin-M, `BTCUSD` and `ETHUSD` | BTC, ETH | true | 2 | 0 |
| total | | | 99 | 4 |

The four disabled contracts are `EOSUSDT`, `MATICUSDT`, `XINUSDT` and `TONUSDT`.
`GET /instruments` lists exactly the 99 enabled contracts, and no symbol appears in one call and not the other.
`GET /symbols@BTCUSDT` returns one row as an object.

### How CCXT 4.5.68 maps it

| CCXT field | source | line in `bigone.js` | probed |
|---|---|---|---|
| request | `Promise.all` of `asset_pairs` and `symbols` | 617 | 1,015 markets, 912 spot and 103 swap, in 641 ms |
| `id` | `symbol` | 739 | equal to the `instruments` `symbol` on 99 of 99 active swaps |
| `active` | `enable` | 759 | 99 active, the 4 disabled contracts inactive |
| `linear` | `!isInverse` | 761 | 97 linear, 2 inverse |
| `contractSize` | `multiplier` | 763 | equal to `multiplier` on 99 of 99 |
| `taker`, `maker` | not set, then overwritten with `undefined` | see [`fees.md`](./fees.md) section 8 | `undefined` on 103 of 103 |
| symbol | `BTC/USDT:USDT`, `BTC/USD:BTC` | 746 | |

`market.id` is the spelling the socket URL takes, the spelling the socket's delta frames carry in `symbol`, and the spelling the anchor rows carry, see [`websocket.md`](./websocket.md) section 3.
A lowercase id is refused by the socket and by the REST book with HTTP 400.

### Size unit, pairs listed twice, and price scale

`multiplier` is the number of coins in one contract.
The TradFi launch article says "1 Futures = 0.1 TSLA", "0.01 XAU" and "1 XAG", S4, and `symbols` carries 0.1, 0.01 and 1 for `TSLAUSDT`, `XAUUSDT` and `XAGUSDT`.

| `multiplier` | contracts on 2026-09-23 |
|---:|---:|
| 0.001 | 1, `BTCUSDT` |
| 0.01 | 15 |
| 0.1 | 38 |
| 1 | 26, including `BTCUSD` and `ETHUSD` |
| 10 | 13 |
| 100 | 7 |
| 1,000 | 2, `DOGEUSDT` and `PUMPUSDT` |
| 1,000,000 | 1, `PEPEUSDT` |

Prices stay per coin whatever the multiplier: `PEPEUSDT` read an index of 0.000004955 and `DOGEUSDT` 0.103693.
So no contract needs a price scale in [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).

BTC and ETH are each listed twice, as the linear `BTCUSDT` and `ETHUSDT` and the inverse `BTCUSD` and `ETHUSD`.
The inverse book counts contracts of 1 USD, see [`websocket.md`](./websocket.md) section 4, so a `marketFilter` that keeps `linear === true` is needed.

Half the enabled catalog is equity, metal and commodity contracts.
Several tickers name private companies or tokens that another venue may spell the same way for a different asset: `OPENAI`, `SPCX`, `ZHIPU`, `UNITREE`, `CXMT`, `SKHY`, `A`, `RE`, `ARX`, `PONS`, `HAJIMI`, `NIULAI`, `ELSA`, `BREV`, `MERL`, `GIGGLE` and `SKR`.
Each needs the usual `DENIED_PAIRS` check against the other venues before activation, and `OPENAI` is already discussed as a standing-basis pair in [`2026-09-15-denied-basis-pairs-gate-probe.md`](../../research/2026-09-15-denied-basis-pairs-gate-probe.md).

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/contract/v2/instruments` | `indexPrice` | `markPrice` | `fundingRate` | absent | `nextFundingTime`, Unix ms | 42.0 KB, 99 rows | 60 polls at 04:14 UTC: min 159, median 189.8, p90 258.4, max 368.7 ms. At 04:16: min 182.2, median 293.3, p90 434.7, max 559.8 ms. At 04:35: min 179.4, median 218.7, p90 313.3, max 388.2 ms |
| `GET /api/contract/v2/instruments@{symbol}` | same fields | | | | | 445 bytes, one object | |
| `GET /api/contract/v1/instruments`, the web app's path | same fields | | | | | 41.9 KB, 99 rows | |
| socket `wss://api.big.one/ws/contract/v2/instruments` | same fields | | | | | first frame 99 rows, then one row per frame | see [`websocket.md`](./websocket.md) section 2 |

One call carries four of the five `AnchorRow` columns for every contract, keyed by `symbol`, which is CCXT's `market.id`.
The funding interval is in no public call, see the row mapping below.
Every field but `symbol` is a JSON number, and `markPrice` and `indexPrice` were above 0 on 99 of 99 rows.
Each row also carries `usdtPrice`, `btcPrice` and `ethPrice`, which are the venue's USDT, BTC and ETH index prices, S2, and `nextFundingRate`, "Estimated next funding rate".

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTCUSDT` | none |
| `index` | `indexPrice` | JSON number | none |
| `mark` | `markPrice` | JSON number, rounded to the contract's price precision | none |
| `fundingRate` | `fundingRate` | JSON number, a fraction per interval: `0.0001765` is 0.01765 % | none |
| `fundingIntervalHours` | absent | | derive, see below |
| `nextFundingAt` | `nextFundingTime` | Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 04:13 UTC 98 contracts read `nextFundingTime` 08:00 UTC and `SKRUSDT` read 05:00 UTC.
Between 04:00 and 08:00 UTC a 4 h contract and an 8 h contract both settle next at 08:00, so the next time alone does not name the interval.

Three ways give `fundingIntervalHours`.

1. The settlement frequency announcement of 2026-09-02 lists 24 USDT-M contracts at 4 h and `SKRUSDT` at 1 h, and everything else stays at 8 h, S5.
   The table is already incomplete, since method 3 found 4 h, in at least one of three runs, on `ZHIPUUSDT`, `CXMTUSDT`, `PONSUSDT`, `HAJIMIUSDT` and `NIULAIUSDT`, which the announcement does not list.
2. The step of `nextFundingTime` after a settlement is the interval.
   A poller that keeps the previous value per symbol learns it at the first settlement it sees.
3. The mark formula of section 4 solves for the interval, `fundingRate * timeUntil / (markPrice / indexPrice - 1)`.
   It gave about 8 h for 42 contracts and about 4 h for 19 at 04:17 UTC, and 45 and 17 at 04:36 UTC, but it fails when the funding basis rounds away in the mark, see section 4.

The recommendation in section 8 combines all three.

## 4. Anchor semantics

### Index

"The Index Price is an average of the latest prices on the major spot exchanges", S3.
For commodity contracts, "the underlying price ... is calculated based on a weighted average of tokenized spot prices from multiple platforms", S4.
No public call lists the constituents or weights of any index, and no basket path was found in the OpenAPI file or the web app bundle.
So the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) cannot be screened from here.
BigONE's own token ONE has no perpetual, so the most obvious case does not arise.

The index republishes every 5 s.
Over 60 one-second polls the gaps between two index changes, across all 99 contracts, were min 4.2 s, median 5.0 s, p90 5.9 s and max 25.2 s over 886 gaps at 04:16 UTC, and min 4.1 s, median 5.0 s, p90 5.8 s and max 40.1 s over 842 gaps at 04:35 UTC.
`BTCUSDT` changed 7, 11 and 11 times in three runs of 59 polls, with gaps of 5.0, 5.1, 10.1, 5.0, 4.9, 4.9, 5.0, 5.2, 4.9 and 5.0 s in the second.
`AUSDT`, `ELSAUSDT`, `ARXUSDT` and `BREVUSDT` each never changed in at least one run.

### Mark

The mark is the Fair Price, `Index Price * (1 + Funding Basis)` with `Funding Basis = Funding Rate * (Time Until Funding / Funding Interval)`, S3.
The wire matches it.
At 04:15 UTC the formula with `fundingRate` gave an interval of 8.00 h for `BTCUSDT` and `BTCUSD`, 8.01 h for `ETHUSDT`, and 4.01 h for `HYPEUSDT` and 3.99 h for `XAUUSDT`, both on the 4 h list.
At 04:36 UTC the same five read 8.01, 8.00, 8.00, 4.00 and 4.00 h.
On `HYPEUSDT` and `XAUUSDT` `fundingRate` and `nextFundingRate` differed, and only `fundingRate` fits, so the mark uses `fundingRate`.
At 04:36 UTC 20 of the 82 contracts with a non-zero rate fit no interval.
Eleven read a basis of 0 ppm against rates of 50 to 249 ppm, among them `DOTUSDT`, `FILUSDT`, `PEPEUSDT` and `SKRUSDT`.
Eight read a basis of 23 to 37 ppm that implied 9.2 to 14.7 h, among them `LTCUSDT` and `NEARUSDT`, and `MERLUSDT` implied 5.5 h.
The mark is rounded to the contract's price precision, and `PEPEUSDT`'s mark `0.00000496` has three significant digits.
A basis this small sits inside that rounding, which is the likely cause, an inference.

The mark therefore carries no information about BigONE's own order book.
Its premium over the index is the funding basis only, which decays to zero at each settlement.
Over the 99 contracts, in three runs, the absolute mark premium was median 40 to 45 ppm, p90 250 to 294 ppm and max 601 to 660 ppm, while `latestPrice` sat a median 592 to 780 ppm and at most 6,085 to 9,133 ppm from the mark.
This is the shape [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) warns about, a mark whose premium the venue caps, here at `fundingRate * timeUntil / interval`, which that design says "reads a capped leg as fresh".

### Funding

`F = P + clamp(I - P, 0.05%, -0.05%)`, with `P` and `I` sampled every minute and averaged over 8 h, capped at 75 % of initial margin minus maintenance margin, S6.
The full formula and the caps are in [`fees.md`](./fees.md) section 6.

`fundingRate` did not change on any of the 99 contracts in three runs of 59 polls, while `nextFundingRate` changed 99, 84 and 96 times.
So `fundingRate` is fixed for the interval and `nextFundingRate` is the running estimate, the convention in which the fixed rate is the one charged at `nextFundingTime`.
That reading is an inference from the three runs and from the mark formula using `fundingRate`.
It was not confirmed across a settlement.

### Rate across a settlement

Not captured, since this survey does not wait for a clock event.
No public funding history call exists: CCXT marks `fetchFundingRateHistory` and `fetchFundingHistory` false at `bigone.js` lines 65 and 63, the OpenAPI file has none, and `GET /api/contract/v2/funding-rates?symbol=BTCUSDT` answered 404.
`GET /api/contract/v2/instruments/prices`, which CCXT lists, returned half-hourly price points per contract, 252,571 bytes, and `instruments/difference` a map of contract to a fraction, and neither carries funding.

### How often each number changed

Over 59 intervals between one-second polls of `instruments`, run at 04:16 UTC:

| contract | `indexPrice` | `markPrice` | `fundingRate` | `nextFundingRate` | `nextFundingTime` | `latestPrice` |
|---|---:|---:|---:|---:|---:|---:|
| `BTCUSDT` | 11 | 12 | 0 | 0 | 0 | 19 |
| `ETHUSDT` | 12 | 12 | 0 | 0 | 0 | 27 |
| `DOGEUSDT` | 12 | 12 | 0 | 0 | 0 | 2 |
| `XAUUSDT` | 12 | 12 | 0 | 12 | 0 | 5 |
| `BTCUSD` | 12 | 12 | 0 | 0 | 0 | 19 |
| all 99 | 983 | 977 | 0 | 84 | 0 | 410 |

The run at 04:14 UTC read 829 index and 826 mark changes over all 99, and the run at 04:35 UTC 939 and 930.
`nextFundingRate` on `XAUUSDT` moved with the index, every 5 s.

## 5. REST book snapshot

`GET https://big.one/api/contract/v2/depth@{symbol}/snapshot` takes no depth parameter and returns the whole book.

| contract | bid levels | ask levels | bid span from the touch | ask span | size at the touch | time |
|---|---:|---:|---:|---:|---|---:|
| `BTCUSDT` | 26 | 15 | 42.4 % | 3.9 % | 4,104 and 2,116 contracts | 230.3 ms |
| `ETHUSDT` | 21 | 15 | 6.3 % | 4.3 % | 410 and 187 | 133.6 ms |
| `DOGEUSDT` | 15, and 16 in the second pass | 8 | 13.5 % | 1.0 % | 100 and 79 | 133.5 ms |
| `BTCUSD` | 13 | 26 | 55.2 % | 37.0 % | 225,950 and 252,712 | 131.0 ms |

- The reply is `{"bids": {price: size}, "asks": {price: size}, "from": 0, "to": <id>, "lastPrice", "bestPrices": {"ask", "bid"}}`, S2.
- Prices are object keys, so they are strings, and sizes are JSON numbers.
- Keys arrive unordered on both sides on 4 of 4 contracts, so a reader sorts.
- `bestPrices` equalled the highest bid key and the lowest ask key on 4 of 4.
- `to` is one global sequence across contracts: four contracts read one after another carried `to` 4,298,678,832, 4,298,678,880, 4,298,678,896 and 4,298,678,956.
- Five reads of `BTCUSDT` a second apart returned four different `to` values and no cache hit, in both runs.
- The second pass read the same level counts, spans within 0.6 points and times of 183 to 349 ms.
- The snapshot equalled the socket book rebuilt from snapshot and deltas at the same `to` on every level of four contracts, see [`websocket.md`](./websocket.md) section 4.

The books are thin, and many sides hold fewer than the engine's 20 levels.
A size is in contracts, so the `BTCUSDT` touch of 4,104 is 4.104 BTC.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| REST limit | 500 requests per 10 s per IP, S1 | never reached, the probes stayed at about one request per second |
| WebSocket limit | "5 connections per user", S1 | not tested past 4 open sockets, see [`websocket.md`](./websocket.md) section 5 |
| over the limit | HTTP 429 and "Implement exponential backoff", S1 | not seen |
| `Retry-After` | not mentioned | not seen |
| rate limit headers | not mentioned | none on any reply |
| CCXT | `rateLimit: 20`, "500 requests per 10 seconds", `bigone.js` line 26 | |

| request | status | body |
|---|---|---|
| `GET /depth@NOPEUSDT/snapshot` | 400 | empty |
| `GET /depth@btcusdt/snapshot` | 400 | empty |
| `GET /depth@EOSUSDT/snapshot`, a disabled contract | 400 | empty |
| `GET /api/contract/v2/nope` | 404 | empty |
| `GET /accounts` without a token | 403 | `{"anomaly":"anomaly.token/invalid"}` |

The documentation's error shape `{"code": 40004, "message": "Unauthorized"}` belongs to the spot and wallet API, S1, and the contract API returned bare status codes instead.
The engine's poller pauses on 403, 418 and 429, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1 and [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 192, and a public `instruments` call never returned any of them here.

## 7. Server time and clock offset

`GET https://big.one/api/v3/ping` answers `{"code":0,"data":{"Timestamp":1790137001610879819}}`, in Unix nanoseconds, S1.
Five samples a second apart read offsets of 18, -20, 12, 8 and 7 ms against the midpoint of each request, with round trips of 121 to 236 ms.
The second pass read 71, 72, 72, 6 and 61 ms, with round trips of 222 to 280 ms.
Every offset is smaller than half its round trip, so the host clock agrees with BigONE within what this method can resolve.
The contract API has no time call of its own.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://big.one/api/contract/v2/instruments` | one call, 42 KB, carries index, mark, rate and next settlement for all 99 contracts |
| interval | 1,000 ms, the default at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 7 | medians of 190 to 293 ms and a max of 560 ms over 180 polls in three runs, 10 of the 500 per 10 s budget. The index moves every 5 s, so four of five polls repeat it, and a 1 s poll still catches each step within a second |
| row mapping | section 3, key `symbol` | |
| `fundingIntervalHours` | a static table seeded from S5 and from method 3 of section 3, 4 h for the 24 listed contracts and the five the formula found, 1 h for `SKRUSDT`, 8 h otherwise, replaced by the observed step of `nextFundingTime` once a settlement is seen | the API publishes no interval, and the announcement alone is incomplete |
| skip | `BTCUSD` and `ETHUSD` | the market filter drops them anyway |
| do not read | `nextFundingRate` as `fundingRate`, and `latestPrice` | the fixed rate for the upcoming settlement is `fundingRate` |
| rate limit pause | `rateLimitPauseMs` 10,000 | the window is 10 s and no `Retry-After` is documented |
| flag for the design | the mark is index plus funding basis | a BigONE leg's premium is at most the funding basis, the capped-mark shape of section 4 |
| flag for the design | the index republishes every 5 s | a reading stamped on arrival can hold a value up to about 5 s old, and one 5 s step can be larger than the 1,000 ppm per poll the reader allows, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 6 |

The socket channel `instruments` carries the same rows and could replace the poll, see [`websocket.md`](./websocket.md) section 2.
Its index still changes every 5 s, so it saves requests and not staleness.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BigONE API, General Information, and Contract Trading Introduction | https://open.big.one/docs/general-info and https://open.big.one/docs/contract/introduction | 2026-09-22 | BigONE, global | limits, 429, timestamps, `/ping`, base URLs, sections 1, 6 and 7 |
| S2 | BigONE OpenAPI specifications, `contract_rest.yml`, last commit 2026-01-08 | https://github.com/bigone-eng/openapi-specs | 2026-09-22 | BigONE, global | `instruments` and `depth@{symbol}/snapshot` schemas, field descriptions, sections 2 to 5 |
| S3 | Liquidation - Fair Price Marking, edited 2021-10-17 | https://bigone.zendesk.com/hc/en-us/articles/900000315483 | 2026-09-22 | BigONE, global | index and mark formula, section 4 |
| S4 | BigONE Launches TradFi Perpetual Futures, 2026-03-13 | https://bigone.zendesk.com/hc/en-us/articles/55981206209945 | 2026-09-22 | BigONE, global | contract sizes, commodity index, sections 2 and 4 |
| S5 | Adjustments to Funding Rate Settlement Frequency for Selected USDT-Margined Perpetual Futures, 2026-09-02 | https://bigone.zendesk.com/hc/en-us/articles/61829180468761 | 2026-09-22 | BigONE, global | 4 h and 1 h contracts, sections 3 and 8 |
| S6 | Funding, edited 2021-10-17 | https://bigone.zendesk.com/hc/en-us/articles/900000315543 | 2026-09-22 | BigONE, global | funding formula and caps, section 4 |
| S7 | CCXT 4.5.68 `bigone.js` | `server/node_modules/ccxt/js/src/bigone.js` | 2026-09-22 | CCXT | hosts, market mapping, funding capabilities, rate limit, sections 1, 2, 4 and 6 |
| S8 | BigONE web app bundle `main.0292236fc458b2ea.js` | https://static.peatio.com/main.0292236fc458b2ea.js | 2026-09-22 | BigONE, global | `contractEndpoint` `/api/contract/v1`, the `symbols` and `instruments` paths, section 3 |
| P1 | `rest-probe.mjs catalog`, 04:13 UTC, and the second pass at 04:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 2 |
| P2 | `rest-probe.mjs anchor`, 04:14 and 04:16 UTC, and the second pass at 04:35 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 4 |
| P3 | `rest-probe.mjs book`, `errors` and `time`, 04:16 UTC, and the second pass at 04:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bigone/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 4 to 7 |
