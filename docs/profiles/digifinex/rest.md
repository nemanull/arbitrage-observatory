# DigiFinex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:13 to 03:44 UTC, and the second pass 03:46 to 03:56 UTC, from the development host near Seattle.

This profile covers the public swap REST API v2 of DigiFinex (CCXT id `digifinex`) for its perpetuals.
Every claim carries a source from section 9, a run of [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs), or a CCXT file and line.
All calls were public, unauthenticated and read-only, and no mode spent more than 1,300 of the 6,000 weight a minute the headers allow.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://openapi.digifinex.com/swap/v2`, S1 |
| resolved address | `openapi.digifinex.com` to 104.18.16.167 and 104.18.17.167, Cloudflare, P1 |
| edge | `cf-ray` ended `-SEA` on most calls and `-YVR` on some, P1 |
| cold request, `GET /public/time` | 266 and 269 ms in two runs, P1 |
| warm requests, `GET /public/time`, two runs of 10 | min 170 and 172, median 177 and 181, max 605 and 679 ms, P1 |
| `GET /public/tickers`, two runs of 60 polls | min 175 in both, median 187 and 206, p90 220 and 228, max 272 and 654 ms, time to first byte median 180 and 172 ms, P2 |
| `GET /public/funding_rate`, four runs of 111 calls | min 160 to 166, median 169 to 177, max 206 to 893 ms, P3 |

Every well formed public call answered 200 to this host, and no refusal, challenge or geoblock came back.
The website did redirect this host to `https://www.digifinex.ca/`, and the help center pages answered 403, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /swap/v2/public/instruments` returns every perpetual in one reply of 72 KB with no paging, weight 5, S1 and P1.
The optional `type` is 1 for simulated and 2, the default, for real contracts.

| field | values seen on 111 rows | documented values |
|---|---|---|
| `type` | `REAL` on 111 | `SIMULATE`, `REAL` |
| `contract_type` | `PERPETUAL` on 111 | `PERPETUAL` |
| `status` | `ONLINE` on 111 | `ONLINE`, `OFFLINE`, `DELIVERY` |
| `is_trading` | `true` on 111 | boolean |
| `clear_currency` | `USDT` on 103, and `BTC`, `ETH`, `FIL`, `DOT`, `XRP`, `UNI`, `TRX`, `LINK` on one each | settlement currency |
| `is_inverse` | `false` on the 103 USDT rows, `true` on the 8 coin rows | boolean |
| `contract_value` | 0.001 BTC for `BTCUSDTPERP`, 10,000,000 PEPE for `PEPEUSDTPERP`, 1 USD on the 8 inverse rows | "contract value for each size" |

With `type=1` the call returned 7 simulated rows: `BTC2PERP`, `ETH2PERP`, `BTCUSDT2PERP`, `ETHUSDT2PERP`, `SKHYNIXUSDT2PERP`, `SAMSUNGUSDT2PERP` and `QQQUSDT2PERP`, P1.
Delisted contracts are absent from the call, while the `all_ticker` WebSocket push still carries some, see [`websocket.md`](./websocket.md) section 2.

### How CCXT 4.5.68 maps it

`fetchMarkets` calls the spot symbol list and this instruments call and concatenates them, at `server/node_modules/ccxt/js/src/digifinex.js` lines 583 to 594.

| CCXT field | source | on 2026-09-23 UTC |
|---|---|---|
| `id` | `instrument_id`, line 655 | equal to the socket's `data.instrument_id` and the tickers `instrument_id` on 109 of 109 swap markets, P1 |
| `symbol` | `BASE/QUOTE:SETTLE`, line 682 | `BTC/USDT:USDT`, and `BTC/USD:BTC` for the inverse |
| `linear` | `!is_inverse`, line 684 | 101 linear, 8 inverse among the 109 |
| `active` | `is_allow` defaults to 1, and the swap branch reads a field named `isTrading`, lines 672 and 685 | the API spells it `is_trading`, so every swap market is `active: true` whatever its state, P1 |
| `contractSize` | `contract_value`, line 710 | equal to `contract_value` on 109 of 109 |
| `taker`, `maker` | the exchange constant 0.002, lines 350 and 351 | see [`fees.md`](./fees.md) section 8 |

`loadMarkets` took 2,319 and 2,343 ms in two runs and returned 300 markets, 191 spot and 109 active swaps, P1.
The instruments call lists 111 perpetuals, so two are lost.

### Pairs listed twice

`ETHUSDTPERP`, `BETHUSDTPERP` and `OETHUSDTPERP` all carry `base_currency` `ETH` and `quote_currency` `USDT`, P1.
CCXT gives all three the symbol `ETH/USDT:USDT`, and `this.indexBy(values, 'symbol')` at `server/node_modules/ccxt/js/src/base/Exchange.js` line 3747 keeps the last one.
So `markets['ETH/USDT:USDT']` is `OETHUSDTPERP`, and `ETHUSDTPERP` and `BETHUSDTPERP` never reach `Object.values(markets)`, which is what the connector reads at `server/src/ccxt/connector.ts` line 79.
`markets_by_id` still holds all three.

| contract | `contract_value` | index at 03:13 UTC | mark | 24 h volume in contracts |
|---|---|---|---|---|
| `ETHUSDTPERP` | 0.01 ETH | 2762.08 | 2760.84 | 272,201,218 |
| `BETHUSDTPERP` | 0.001 ETH | 2761.98 | 2760.67 | 909,437,815 |
| `OETHUSDTPERP` | 0.001 ETH | 2762.08 | 2760.75 | 914,282,909 |

What distinguishes `BETH` and `OETH` from `ETH` is Not publicly specified, and a help center search for either name returned no article.
The engine would take `OETHUSDTPERP` as its ETH market today by accident of array order, so a `marketFilter` should name the ETH contract it wants.

### Size unit, inverse contracts and price scale

- A linear contract is `contract_value` coins, and the socket and REST book sizes are in contracts, so CCXT's `contractSize` converts them correctly, see [`websocket.md`](./websocket.md) section 4.
- The 8 inverse contracts are 1 USD each and CCXT reports `contractSize` 1, so the engine would read their sizes as coins.
  `TRXPERP` is the only TRX perpetual, so the quote family would not rank it out.
  A `marketFilter` on `linear === true` removes all eight.
- Prices are per coin on every contract, `PEPEUSDTPERP` included at an index of 0.000004918, so no price scale is needed, P2.
- 36 of the 103 USDT contracts are stocks, ETFs, commodities or pre-IPO names with a 0.01 contract, among them `OPENAIUSDTPERP`, `ANTHROPICUSDTPERP`, `SPCXUSDTPERP`, `QNTXUSDTPERP`, `SKHYUSDTPERP` beside `SKHYNIXUSDTPERP`, and `NVDAUSDTPERP`, P1.
  Their tickers can name a different asset on another venue, so each needs a check against `DENIED_PAIRS` at `server/src/engine/cluster/clusterOverrides.ts` line 7 before the venue is activated.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /public/tickers`, weight 1 | `index_price` | `mark_price` | absent | absent | absent | 49.7 KB, 111 rows | median 187 and 206 ms, max 272 and 654 ms over two runs of 60 polls, P2 |
| `GET /public/funding_rate?instrument_id=`, weight 1, one contract per call | | | `funding_rate`, the last settled rate | always 8 h | `funding_time`, on the 8 h grid for every contract | 167 bytes | median 169 to 177 ms, P3 |
| `GET /public/funding_rate_history?instrument_id=&start_timestamp=<now>&limit=1`, weight 10, one contract per call | | | `rate` of the one future entry, the live upcoming rate | from the history steps | `time` of that entry, correct for 4 h contracts | 102 to 108 bytes | 172 to 178 ms in P3, 395 to 419 ms by curl in P4 |
| WebSocket `fund_rate` | | | `funding_rate`, the live upcoming rate | `next_funding_time` − `funding_time` | `funding_time`, correct for 4 h contracts | | pushed every 15.7 to 16.9 s and once after 33.6 s, see [`websocket.md`](./websocket.md) section 2 |

No call returns the upcoming funding rate for every contract at once.
`GET /public/funding_rate` without `instrument_id` answers 400 `{"code":400002,"msg":"invalid InstrumentId"}`, P1.
CCXT marks `fetchFundingRates` false at `server/node_modules/ccxt/js/src/digifinex.js` line 64, and its `parseFundingRate` reads the `funding_rate` call as the rate at `fundingTimestamp`, lines 3427 to 3463, which on this venue is the last settled rate labelled with the next 8 h instant.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument_id` of `tickers` | string, `BTCUSDTPERP` | none |
| `index` | `index_price` of `tickers` | decimal string | `Number()` |
| `mark` | `mark_price` of `tickers` | decimal string, never 0 on 111 rows | `Number()` |
| `fundingRate` | `rate` of the future entry of `funding_rate_history` | decimal string, a fraction per interval: `"0.00055"` is 0.055 % | `Number()` |
| `fundingIntervalHours` | the future entry `time` less the last past entry `time` | ms | divide by 3,600,000 |
| `nextFundingAt` | `time` of the future entry | Unix ms: `1790136000000` is 2026-09-23 04:00 UTC | none |

The `timestamp` field of a tickers row is not the time of its index or mark.
Every row of one reply carried the same `timestamp`, it was 0.5 to 59.7 s older than the reply's arrival, median 31 s in both runs, and between two replies it went backwards by up to 56 s while the index and mark kept moving, P2.
The engine stamps a reading on arrival, so this field is ignored.

## 4. Anchor semantics

### Index

"The index price is calculated based on the weighted average of the latest transaction prices from multiple exchanges.", S3.
The only published basket is the BTC example in S3: Coinbase Pro, Bitstamp, Kraken, Gemini, Bittrex and itbit at 16.6 % each, all against USD.
With three or more valid sources a price more than 3 % from the median is replaced by the median times 0.97 or 1.03, S3.
S3 also says "The above data and indicator contents may be adjusted in real time according to market conditions, and the adjustments will be made without further notice", and S4 repeats that components and weights change without notice.
No basket call exists in the public API, S1, so the live basket of any contract is Not publicly specified.
A self-referential basket, like the one behind [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), therefore cannot be screened on this venue.

### Mark

"Mark Price = Median (Funding Rate Premium, Mid-Price Basis Mark Price, Last Price)", S4, where:

- Funding Rate Premium = Index × (1 + Latest Funding Rate × Hours Until Next Settlement / Settlement Period in Hours).
- Mid-Price Basis Mark Price = Index + a moving average of ((best bid + best ask) / 2 − Index), over a period S4 does not state.

No clamp on the mark's premium is published.
On 111 contracts at 03:19 UTC the mark sat 0 to 5,076 ppm from the index, median 504 and p90 1,372, with `PORTALUSDTPERP` at 5,076 and `GRTUSDTPERP` at −2,645, P2.
At 03:47 UTC the median was 556, the p90 1,595, and the largest `COREUSDTPERP` at 4,367, P2.
The tickers also carry an order price band, `max_buy_price` and `min_sell_price`, which sat 5 % either side of the index on most contracts: median +50,000 and −50,114 ppm in the first run and +49,887 and −50,244 in the second, and up to ±100,324 ppm, P2.

### Funding

The formula, interval and payer are in [`fees.md`](./fees.md) section 6.
The rate is a fraction per interval, and the 8 four hour contracts publish their own four hour rate.

### Which rate each call publishes

The three funding sources disagree, and the history call settles which is which.

| source | `BTCUSDTPERP` at 03:38 UTC | `XAUTUSDTPERP`, a 4 h contract |
|---|---|---|
| `funding_rate` call | `-0.00002` at 08:00, next `-2e-05` at 16:00 | `-0.00013` at 08:00, next `-0.00012` at 16:00 |
| `funding_rate_history`, last two entries | `-0.00002` at 00:00, `-0.00003` at 08:00 | `-0.00013` at 00:00, `0.00055` at 04:00 |
| WebSocket `fund_rate` | `-0.00003` at 08:00, next at 16:00 | `0.00055` at 04:00, next at 08:00 |

- On 111 of 111 contracts, in each of two runs, the `funding_rate` call equalled the history entry at the last past settlement, 00:00 UTC, P3.
  So that call publishes the last settled rate, and labels it with the next 8 h instant.
- On 111 of 111 contracts the history held exactly one entry after the current time, at 08:00 UTC on 103 and at 04:00 UTC on 8, P3.
  Its rate moved between reads, `XAUTUSDTPERP` read 0.00056, 0.00055, 0.00054, 0.00055 and 0.00056 over half an hour, so it is the live estimate for the upcoming settlement.
- The WebSocket `fund_rate` value equalled that future history entry on 13 of 18 comparisons over three runs, and the other 5 differed by 0.00001 or 0.00002, because the push compared was the last one before the socket closed and the history call came after it, P5.
- The `funding_rate` call reported an 8 h interval and 08:00 UTC for all 111 contracts, including the 8 whose history steps are 4 h, P3.

The history documents `time` as "settlement time", S1, which supports this reading.
The settlement instant itself was not captured, so that the future entry's last value is the rate charged is inferred, not observed.

### How often each number changed

Two runs of 60 polls of `tickers`, one a second, at 03:18 and 03:46 UTC, P2.
Each cell is the count of the 59 steps on which the number changed, first run then second.

| contract | index changed | mark changed | best bid changed |
|---|---|---|---|
| `BTCUSDTPERP` | 17 and 37 | 29 and 54 | 5 and 22 |
| `ETHUSDTPERP` | 21 and 43 | 34 and 51 | 8 and 38 |
| `XAUTUSDTPERP` | 1 and 16 | 22 and 7 | 13 and 5 |
| `NVDAUSDTPERP` | 11 and 31 | 10 and 26 | 1 and 3 |
| `BTCPERP` | 17 and 37 | 21 and 40 | 6 and 22 |
| `MANAUSDTPERP` | 0 and 1 | 0 and 1 | 0 and 1 |
| all 111, median | 7 and 12 | 8 and 11 | |
| all 111, max | 53 and 54 | 54 and 56 | |

Beside the WebSocket pushes, in two runs of 37 one second polls, P5:

- The tickers mark of `BTCUSDTPERP` equalled the latest pushed mark on 36 and 37 polls, and the one miss matched a push 1.2 s older.
- The tickers index equalled the latest pushed index on 34 and 30 polls.
  In the second run 6 polls matched an earlier push 0.6 to 6.3 s old, and 3 polls in the first run and 1 in the second matched no push.
  The index repeated values in that minute, 11 distinct among 28 pushes, so an earlier match is an upper bound on the lag.

So the tickers reply is usually as fresh as the push channels, and a quiet contract simply does not move.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /swap/v2/public/depth?instrument_id=BTCUSDTPERP&limit=20`, weight 2, S1 |
| depth | `limit` 1 to 100, default 20, and 101 answers 400 `{"code":400002,"msg":"invalid Limit"}`, P1 and P6 |
| level order | bids descending and asks ascending at limits 1, 20, 50 and 100, P6 |
| number type | price and size are JSON numbers, `[86728,207]`, while S1 documents the price as a string and the socket sends it as one |
| size unit | contracts, equal to the socket sizes at the same prices, see [`websocket.md`](./websocket.md) section 4 |
| freshness | `timestamp` 76 to 93 ms before arrival on eight reads over two runs, P6 |
| caching | two reads 100 ms apart returned different bodies with timestamps 272 and 276 ms apart in two runs, so no cache was seen, P6 |
| against tickers | the depth top equalled the tickers best bid and ask on `BTCUSDTPERP` in both runs and on `MANAUSDTPERP` in the second, and the other reads differed by what moved in the second or so between the two calls, P6 |

## 6. Rate limits and errors

- Public calls count a weight per IP per minute, S1.
  The headers reported `ip-weight-minute-use` and `ip-weight-minute-remain`, 5 and 5,995 after the first call, so the budget is 6,000 a minute, P1.
- Weights from `GET /public/api_weight`: `tickers` 1, `ticker` 1, `funding_rate` 1, `instrument` 1, `time` 1, `trades` 1, `candles` 1, `depth` 2, `instruments` 5, `funding_rate_history` 10, `candles_history` 10, P1.
- Over the budget the venue answers 429 with a `retry-after` header, and repeated violation brings an IP ban with 403, "from 2 minutes to 1 day", S1.
  No 429 was provoked, so its body is Not verified.
- Error bodies are JSON with HTTP 400: `{"code":400002,"msg":"invalid InstrumentId"}` for an unknown or missing instrument on `funding_rate`, `depth` and `ticker`, and `{"code":400002,"msg":"invalid Limit"}` for a bad depth, P1.
  An unknown path answers 404 with the plain text `404 page not found` and no weight headers, P1.
- The documented error codes include 403001 `FrequencyLimit` and 403002 `RequestForbidden`, S1.

## 7. Server time and clock offset

`GET /swap/v2/public/time` returns `{"code":0,"data":1790133183971}`, Unix ms, weight 1, S1 and P1.
Against the midpoint of each request, the server ran −1 to 13 ms ahead of this host, median 7 and 8 ms, over two runs of five reads, P1, and 10 and 20 ms ahead in the WebSocket probe's reads, see [`websocket.md`](./websocket.md) section 3.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| index and mark | `GET https://openapi.digifinex.com/swap/v2/public/tickers` every 1,000 ms | one call carries both for every contract, weight 1, median 187 and 206 ms, max 654 ms over 120 polls |
| funding | `GET .../public/funding_rate_history?instrument_id=<id>&start_timestamp=<now>&limit=1` for one tracked contract after another, two a second, cached per contract and merged into each tickers round | the only REST source of the upcoming rate and its instant, weight 10, so 1,200 of the 6,000 a minute, and each of about 100 contracts refreshed about every 50 s |
| interval | once per contract at start and after each settlement, `funding_rate_history` with `start_timestamp` one day back: the step between the last two entries | the `funding_rate` call reports 8 h for the 4 h contracts |
| alternative for funding | the WebSocket `fund_rate` channel on sockets of its own, at most 30 contracts each | live and weightless, but 4 more sockets and a push only every 15 to 35 s |
| do not use | `GET .../public/funding_rate` | it returns the last settled rate and the wrong instant for 4 h contracts, section 4 |
| row mapping | section 3, key `instrument_id` | |
| skip | the 8 inverse contracts, and any `instrument_id` absent from the instruments call | inverse sizes are in USD, section 2 |
| rate limit pause | `rateLimitPauseMs` 60,000, or `retry-after` when present | the budget is per minute |
| deny list input | the TradFi and pre-IPO tickers in section 2, and every contract, since no basket call exists | section 4 |

The tickers reply is about 50 KB, so one hertz is about 4.3 GB a day, and the funding calls add about 19 MB.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | DigiFinex swap REST API v2 | https://docs.digifinex.com/en-ww/swap/v2/rest.html | 2026-09-22 | DigiFinex, global | base URL, calls and fields, weights, 429 and 403 rules, error codes, sections 1 to 7 |
| S2 | DigiFinex swap WebSocket API v2 | https://docs.digifinex.com/en-ww/swap/v2/websocket.html | 2026-09-22 | DigiFinex, global | `fund_rate` fields, section 3 |
| S3 | [Tutorial]Index and Exchange Rate Calculation, edited 2024-09-14 | https://support.digifinex.com/hc/en-us/articles/900000455366--Tutorial-Index-and-Exchange-Rate-Calculation | 2026-09-22 | DigiFinex, global | index formula, example basket, 3 % median clamp, section 4 |
| S4 | [Tutoria]Index Price, Mark Price and Last Price, edited 2024-09-14 | https://support.digifinex.com/hc/en-us/articles/36939919668761--Tutoria-Index-Price-Mark-Price-and-Last-Price | 2026-09-22 | DigiFinex, global | mark formula, index components change without notice, section 4 |
| S5 | CCXT 4.5.68 `digifinex.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/digifinex.js` | 2026-09-22 | CCXT | market mapping, funding parse, symbol indexing, sections 2 and 3 |
| P1 | `rest-probe.mjs main` at 03:18 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | host, latency, catalog, CCXT mapping, errors, weights, clock, sections 1, 2, 6 and 7 |
| P2 | `rest-probe.mjs anchor` at 03:18 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | tickers timing, change counts, premium and band, timestamp field, sections 1, 3 and 4 |
| P3 | `rest-probe.mjs funding`, runs at 03:20, 03:22, 03:34 and 03:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | funding call against history on 111 contracts, sections 3 and 4 |
| P4 | curl of `funding_rate_history` with `start_timestamp` set to the current time, at 03:44 UTC, and `rest-probe.mjs funding` in the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | the one row upcoming entry, section 3 |
| P5 | `ws-probe.mjs anchor` at 03:37, 03:38 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs) | 2026-09-23 UTC | this host | `fund_rate` against history, tickers against pushes, sections 3 and 4 |
| P6 | `rest-probe.mjs book` at 03:24 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | REST book, section 5 |
