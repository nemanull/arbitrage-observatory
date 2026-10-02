# Crypto.com Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, which the venue's own geolocation placed in Canada.

This profile covers the public REST API v1 of the Crypto.com Exchange (CCXT id `cryptocom`) that a catalog, an anchor poller and a book resync would use, for its one perpetual family.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/cryptocom/rest-probe.mjs), run from `server/`, unless a row names [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs).
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.
The API answered this host in full, although the venue does not offer its derivatives to a Canadian or US account, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-22 | network |
|---|---|---|---|
| `api.crypto.com` | REST base `https://api.crypto.com/exchange/v1/{method}`, S1 | `104.19.222.17` and `104.19.223.17`, no CNAME | Cloudflare, inside `104.16.0.0/13`, S7 |
| `stream.crypto.com` | WebSocket, see [`websocket.md`](./websocket.md) | the same two addresses | Cloudflare |
| `static2.crypto.com` | documents, including the index constituent PDF | the same two addresses | Cloudflare |

Every reply came through Cloudflare, with `server: cloudflare` and a `cf-ray` ending in `SEA`, Cloudflare's Seattle edge, on the first run and in `YVR`, its Vancouver edge, on the rerun.
The origin behind it is not visible from here, so where the matching engine runs is Not publicly specified.

Latency from the `main` run at 21:43 UTC, one process, Node `fetch` with a kept connection.
The first request of the process paid DNS and TLS, and later paths reused that connection.

| call | first request ms | next five, min / median / max ms | reply bytes, decoded | content-encoding |
|---|---:|---:|---:|---|
| `GET /public/get-instruments` | 355 | 245 / 310 / 543 | 544,470 | br |
| `GET /public/get-tickers` | 160 | 159 / 193 / 293 | 258,041 | br |
| `GET /public/get-book?instrument_name=BTCUSD-PERP&depth=50` | 151 | 139 / 146 / 247 | 3,227 | br |
| `GET /public/get-valuations?instrument_name=BTCUSD-PERP&valuation_type=mark_price&count=1` | 144 | 135 / 137 / 143 | 200 | br |

The rerun at 22:08 UTC gave first requests of 481, 328, 124 and 125 ms and warm medians of 382, 193, 125 and 129 ms, and one warm instruments call took 4,098 ms.
These are one host on one date.

## 2. Catalog

### The instruments call

`GET /public/get-instruments` takes no instrument type and returns every instrument in one reply, S2.
On 2026-09-22 it returned 979 rows: 396 `PERPETUAL_SWAP`, 571 `CCY_PAIR` spot and 12 `FUTURE`, all with `tradable` true.
The only status field is the boolean `tradable`, and no delisting or pre-launch state is documented, S2.

| field | perpetual values on 2026-09-22 |
|---|---|
| `symbol` | `<base>USD-PERP` on 396 of 396, for example `BTCUSD-PERP` |
| `quote_ccy` | `USD` on 396 |
| `underlying_symbol` | `<base>USD-INDEX` on 396, the index instrument |
| `contract_size` | `"1"` on 396 |
| `product_type` | `DIGITAL_CURRENCIES` 241, `EQUITY` 118, `EQUITY_IND` 27, `COMMODITIES` 8, `PRE_IPO` 2 |
| `max_leverage` | `"50"` on 394, `"100"` on 2 |
| `beta_product` | false on 396 |
| a base listed twice | none |

### How CCXT 4.5.68 maps it

| item | value | evidence |
|---|---|---|
| call | `v1PublicGetPublicGetInstruments`, one call for every type | `server/node_modules/ccxt/js/src/cryptocom.js` line 680 |
| `market.id` | the reply's `symbol` | line 816 |
| `type` and `symbol` | `PERPETUAL_SWAP` becomes `swap` with symbol `BTC/USD:USD` | lines 797 to 800 |
| `settle` | the quote, `USD` | line 780 |
| `linear` | true for every contract | lines 813 and 832 |
| `contractSize` | `contract_size` | line 834 |
| `active` | `tradable` | line 830 |
| `taker` | none set here, so the exchange-wide 0.005 applies, see [`fees.md`](./fees.md) section 8 | lines 815 to 863 |
| `loadMarkets` time | 337 and 403 ms, one request | Probed |

Probed through the connector's filter, `type` swap, `swap` true and `active !== false`:

| result | value |
|---|---|
| active swaps | 396, all `USD` quoted, `USD` settled and linear |
| `market.id` against the catalog `symbol` | equal on 396 of 396 |
| `market.id` against the socket | `book.<market.id>.50` delivered a snapshot for all 396, see [`websocket.md`](./websocket.md) section 4 |
| `market.id` against the anchor | `get-valuations` and the `mark` and `funding` channels take `market.id`. The `index` channel takes `underlying_symbol`, and `get-valuations` accepts either and answers under the index name |
| `contractSize` | 1 on 396 |
| pairs listed twice inside CCXT's keys | none |

Sample markets, as CCXT returned them.

| id | symbol | base | quote | settle | linear | contractSize | taker | precision.price | precision.amount |
|---|---|---|---|---|---|---:|---:|---:|---:|
| `BTCUSD-PERP` | `BTC/USD:USD` | BTC | USD | USD | true | 1 | 0.005 | 0.1 | 0.0001 |
| `ETHUSD-PERP` | `ETH/USD:USD` | ETH | USD | USD | true | 1 | 0.005 | 0.01 | 0.0001 |
| `NVDAUSD-PERP` | `NVDA/USD:USD` | NVDA | USD | USD | true | 1 | 0.005 | 0.01 | 0.01 |

### Size unit, pairs listed twice, and price scale

Book sizes are base currency units and `contractSize` is 1, so the engine's size multiplier is right for every perpetual, see [`websocket.md`](./websocket.md) section 4.
The quote family folds `USD` into `USDT`, at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so every Crypto.com perpetual joins the `USDT` pair of its base, and the venue lists one contract per base.

The pre-IPO bases are named `ANTHROPICIPO` and `OPENAIIPO`, so they do not cluster with okx's `ANTHROPIC` and `OPENAI` at all.
Their index read 2,172.6 and 1,663.3 at 22:08 UTC, the basis okx reaches only after its price scale of 10 in [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) lines 20 to 23.
Whether a Crypto.com base names a different token than the same base on another venue was not surveyed, and `DENIED_PAIRS` needs that check before Crypto.com joins.
The 155 TradFi perpetuals share stock and commodity tickers with the TradFi perpetuals of other venues, and whether to cluster them is a decision for a later design.

## 3. Anchor

### No bulk call carries the anchor

| call | index | mark | funding rate | interval | next settlement | scope |
|---|---|---|---|---|---|---|
| `GET /public/get-tickers` | absent | absent | absent | absent | absent | every instrument, 979 rows, 258 KB. The fields are `i`, `h`, `l`, `a`, `v`, `vv`, `c`, `b`, `k`, `oi`, `t` |
| `GET /public/get-valuations?valuation_type=index_price` | `v` | | | | | one instrument per call |
| `GET /public/get-valuations?valuation_type=mark_price` | | `v` | | | | one instrument per call |
| `GET /public/get-valuations?valuation_type=funding_rate` | | | `v` | | | one instrument per call |
| `GET /public/get-risk-parameters` | | | | | | leverage, position and collateral limits per base, no prices |
| socket `index`, `mark`, `funding` channels | `v` | `v` | `v` | | | one instrument per channel, see [`websocket.md`](./websocket.md) section 2 |

`get-valuations` without `instrument_name` answers 400 `{"code":40004,"message":"Missing instrument_name param"}`.
CCXT agrees that no bulk funding call exists, with `'fetchFundingRates': false` at `server/node_modules/ccxt/js/src/cryptocom.js` line 69.

So one REST round over the catalog costs one call per perpetual per field.
One round of `mark_price` alone for all 396 perpetuals, at 40 requests per second, took 10.1 s in both runs, with 396 answers of HTTP 200 and a median reply of 135 and 124 ms.
At the published 100 requests per second per method, S1, the index and the mark alone are 792 calls, at least 7.9 s a round, all on the one method `get-valuations`.
The engine's reader refuses two legs read more than 5 s apart and a reading older than 10 s, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 4 and 5, so a REST round over every perpetual cannot feed it.

### Row mapping

| `AnchorRow` column | source | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument_name` of `mark` and `funding`, and `underlying_symbol` for `index` | string, `BTCUSD-PERP` | map the index name back through the catalog's `underlying_symbol` |
| `index` | `index_price` or the `index` channel, field `v` | decimal string | `Number()` |
| `mark` | `mark_price` or the `mark` channel, field `v` | decimal string, never 0 in the round of 396 | `Number()` |
| `fundingRate` | `funding_rate` or the `funding` channel, field `v` | decimal string, a fraction per hour: `"-0.000004992"` is −0.0004992 % | `Number()` |
| `fundingIntervalHours` | none, every perpetual settles hourly, see [`fees.md`](./fees.md) section 6 | | the constant 1 |
| `nextFundingAt` | none | | the next whole UTC hour, as CCXT computes it at `server/node_modules/ccxt/js/src/cryptocom.js` line 3118 |
| `ts` | `t` of each point | integer ms on the whole second | take the arrival time, or the older of the index and mark `t` |

`count=1` returns the newest point, stamped on the whole second.
Over 60 one second polls in each of two runs its age at arrival was a median of 992 to 1,082 ms and at most 1,182 ms, for mark and index on four perpetuals.
With `count` above 1 the series is sparse, two or three points a minute at seconds 6, 45 and 46, so its newest point can be tens of seconds old.
At 22:10:08 UTC the newest of eight BTC mark points was 23.7 s old, while `count=1` returned one 1.0 s old.

## 4. Anchor semantics

### Index

S3, dated 2024-01-16, is the method of record.

```text
Market Price of a constituent = median of last traded price, best bid, best offer
Index Price = equally weighted average of the Market Prices
```

| rule | documented |
|---|---|
| stale source | "If any of these price data...is not updated for 1 minute, the data will be excluded" |
| outlier clamp | "If an index constituent's Market Price differs from the median of all constituents' by 0.1% or more, it will be limited to 0.1% divergence" |
| quote conversion | "If the constituent does not trade against USD directly, it is converted to USD using Crypto.com USDTUSD index" |
| basket | a PDF, S4 |

The basket PDF read "Update Date: 2026-09-22" and listed 2,846 rows over 569 indices, which cover 394 of the 396 perpetuals.
`CSOPSAMSUNG2LUSD-PERP` and `FLNCUSD-PERP` had no basket in it.
The weights printed in the PDF are not all equal, so the equal weighting of S3 does not hold for every index.

| index | basket on 2026-09-22 |
|---|---|
| `BTCUSD-INDEX` | KuCoin, OKX, Coinbase, Kraken, Binance, Bitget, Bybit, MEXC, Crypto.com and Gate spot, 10 % each |
| `ETHUSD-INDEX` | the same ten spot venues, 10 % each |
| `ONEUSD-INDEX` | KuCoin, OKX, Binance, MEXC and Gate spot `ONE`, 20 % each |
| `NVDAUSD-INDEX` | ICE, Pyth and Chainlink `NVDA` 33 % each, Binance's `NVDAUSDT.Index` 1 % |
| `XAUUSD-INDEX` | Chainlink gold, Pyth `XAUUSD` and Binance's `XAUUSDT.Index` 33 % each, Crypto.com `PAXG_USD` 1 % |
| `CLUSD-INDEX` | Pyth `WTI.Front` 98 %, Binance's `CLUSDT.Index` and Hyperliquid's `xyz:CL.Oracle` 1 % each |
| `OPENAIIPOUSD-INDEX` | okx `OPENAI-USDT-SWAP`, Binance's `OPENAIUSDT.Index` and Gate futures `OPENAI_USDT`, 33.33 % each |
| `ANTHROPICIPOUSD-INDEX` | okx `ANTHROPIC-USDT-SWAP` and Gate futures `ANTHROPIC_USDT`, 50 % each |

The survey of all 394 baskets gave these shapes.

| shape | perpetuals |
|---|---|
| Crypto.com's own perpetual inside the basket | none |
| another venue's perpetual inside the basket | 5: `ANTHROPICIPOUSD-PERP` at 100 %, `OPENAIIPOUSD-PERP` at 66.66 %, and `GMEUSD-PERP`, `LITEUSD-PERP` and `VRTUSD-PERP` at 1 % |
| another venue's index or an oracle inside the basket | 151, all TradFi: 116 equity, 26 equity index, 8 commodity, 1 pre-IPO |
| one member at 90 % or more | 3: `BZUSD-PERP`, `CLUSD-PERP` and `NATGASUSD-PERP`, 98 % Pyth |
| Crypto.com spot at a third or more | 4: `VRAUSD-PERP` at 50 %, and `BASECATUSD-PERP`, `CASHCATUSD-PERP` and `PONSUSD-PERP` at 33.33 % |
| two members | 2: `ANTHROPICIPOUSD-PERP`, and `VRAUSD-PERP` with MEXC and Crypto.com spot |

Source counts across the 394 were 2 on 2, 3 on 36, 4 on 121, 5 on 14, 6 on 219 and 10 on 2.
The 241 crypto baskets are spot averages, 219 of them over six venues, and none holds a perpetual.
The pre-IPO pair is indexed to perpetuals: `ANTHROPICIPOUSD-PERP` rests entirely on okx's and Gate's, so on a route against either the index is half made of the other leg's own book.
That is a close relative of the self-index shape in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
The commodity baskets rest on one oracle at 98 %.

### Mark

S5, dated 2023-11-28, is the formula of record.

```text
Mark Price = Index Price + 30 seconds an exponential moving average of (Fair Price - Index Price)
Fair Price = (Fair Impact Bid + Fair Impact Ask) / 2
Fair Impact Bid = the greater of the average price of a market sale of the fair impact size, or the best bid - 0.5%
Fair Impact Ask = the lower of the average price of a market purchase of the fair impact size, or the best offer + 0.5%
```

| clamp | documented | probed |
|---|---|---|
| mark bandwidth | "Index +/- bandwidth. The bandwidth is set at a minimum of 0.5% and can be wider for instruments with lower liquidity or higher volatility." | the bandwidth per instrument is not published in any call read |
| fair impact size | not stated | Not publicly specified |
| price band for orders | "Aggressive: +/-5% of MarkPrice" and "Passive: +/-50% of MarkPrice", S6 | |

A mark held within the index plus or minus a bandwidth of at least 0.5 % is a capped premium.
A leg whose book sits beyond the band reads a capped mark as a fresh one, the trap [`saturated-anchor.md`](../../bestiary/saturated-anchor.md) describes on kraken's 1 % cap, and 0.5 % is half of that.

### Funding

The rate formula, the interval and the settlement rule are in [`fees.md`](./fees.md) section 6.
`funding_rate` is the "current hourly funding rate that will settle at the end of each hour of current 4-hour interval", and `estimated_funding_rate` the estimate for the next interval, S2.
`funding_hist` returns "hourly data of the funding rate settled in past hourly settlement", S2.

The 30 settled BTC rates read at 21:44 UTC ran in groups of four equal values, 21:00 then 17:00 to 20:00, 13:00 to 16:00, 09:00 to 12:00, 05:00 to 08:00 and 01:00 to 04:00, and ETH read the same way.
The rerun at 22:10 UTC showed the 22:00 settlement at the same rate as 21:00, on both.
So the rate fixed at the start of an interval is charged at the four hourly settlements that end it, and the current `funding_rate`, `-0.000004992` on BTC, equalled the rate settled at 21:00.
The rate the reply shows is therefore the rate of the upcoming settlement, known up to four hours ahead, which is what `AnchorRow.fundingRate` expects.

### How often each number changed

60 polls at one per second from 21:43:30 UTC and again from 22:09:07 UTC, with `count=1`, first run and rerun side by side.

| perpetual | field | value changed | `t` changed | median age at arrival | `t` seconds seen |
|---|---|---:|---:|---:|---|
| `BTCUSD-PERP` | mark | 49, 58 | 57, 59 | 994, 1,077 ms | 58 and 60 distinct seconds |
| `BTCUSD-PERP` | index | 52, 56 | 59, 59 | 1,010, 1,058 ms | 60 and 60 |
| `ETHUSD-PERP` | mark | 53, 54 | 59, 58 | 1,015, 1,056 ms | 60 and 59 |
| `ETHUSD-PERP` | index | 42, 52 | 58, 59 | 992, 1,058 ms | 59 and 60 |
| `NVDAUSD-PERP` | mark | 4, 8 | 59, 54 | 1,010, 1,070 ms | 60 and 55 |
| `NVDAUSD-PERP` | index | 3, 7 | 59, 56 | 993, 1,071 ms | 60 and 57 |
| `BATUSD-PERP` | mark | 8, 19 | 59, 58 | 1,011, 1,075 ms | 60 and 59 |
| `BATUSD-PERP` | index | 7, 12 | 59, 58 | 1,007, 1,082 ms | 60 and 59 |
| all four | funding rate | 0, 0 | 1, 1 | about 31 s | second 5 only |
| all four | estimated funding | 1, 1 | 1, 1 | about 31 s | second 59 only |

The mark and the index republish every second, even while the value holds, and no reply took more than 787 ms.
The funding rate is republished once a minute and changes only at an interval boundary.

## 5. REST book snapshot

`GET /public/get-book?instrument_name=&depth=`, S2: "Number of bids and asks to return (up to 50)", and levels "[Price, Quantity, NumOrders]".

| item | documented | probed |
|---|---|---|
| depth | "up to 50" | 10, 50, 100 and 150 answered in full on BTC. Without `depth` the reply carried `"depth" : 150`. `depth=0` and `depth=200` answered 400 `{"code":40004,"message":"Invalid depth"}`. CCXT caps its request at 50, at `server/node_modules/ccxt/js/src/cryptocom.js` line 1184 |
| order | | bids descending and asks ascending at every depth |
| fields | `bids`, `asks` | `bids`, `asks` and `t`, and no sequence number, so a REST book cannot be aligned with the socket's `u` |
| sizes | | strings of base units, equal to the socket book, see [`websocket.md`](./websocket.md) section 4 |
| caching | | two reads 150 ms apart carried different `t`, and `cf-cache-status` was `DYNAMIC` |
| a quiet book | | `WALUSD-PERP` answered 30 bids and 26 asks with a `t` 16.6 s old, and 27 bids and 32 asks with a `t` 0.9 s old in the rerun |
| time | | 123 to 142 ms warm over both runs, 3.2 KB at depth 50 and 9.2 KB at 150 |

The recommended feed takes its snapshot from the socket and needs no REST book, see [`websocket.md`](./websocket.md) section 8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | "For public market data calls, rate limits are per API method, per IP address", 100 requests per second each, S1 | no limit was reached. CCXT's `rateLimit` is 10 ms, "100 requests per second", at `server/node_modules/ccxt/js/src/cryptocom.js` line 24 |
| status on limit | HTTP 429 with code 42901 `TOO_MANY_REQUESTS`, S1 | Not verified |
| rate limit headers | not documented | none on any reply |
| `Retry-After` | not documented | absent on every reply |
| error shape | `{code, message}`, with HTTP 400 for bad requests, S1 | as documented, and an unknown path answers a 404 with a different body |

| request | status | body |
|---|---:|---|
| `get-book?instrument_name=NOPEUSD-PERP&depth=10` | 400 | `{"code":40004,"message":"Invalid instrument_name"}` |
| `get-book?instrument_name=BTCUSD-PERP&depth=0` | 400 | `{"code":40004,"message":"Invalid depth"}` |
| `get-tickers?instrument_name=NOPEUSD-PERP` | 400 | `{"code":40004,"message":"Invalid instrument_name"}` |
| `get-valuations?valuation_type=mark_price` | 400 | `{"code":40004,"message":"Missing instrument_name param"}` |
| `get-valuations?instrument_name=BTCUSD-PERP&valuation_type=nope` | 400 | `{"code":40004,"message":"Invalid valuation_type"}` |
| `get-valuations?instrument_name=NOPEUSD-PERP&valuation_type=mark_price` | 400 | `{"code":40004,"message":"Invalid instrument_name"}` |
| `/public/get-nope` | 404 | `{"timestamp":"2026-09-22T21:43:19.938+00:00","status":404,"error":"Not Found","path":"/v1/public/get-nope"}` |

The engine's poller pauses on 403, 418 and 429, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1, and 429 is the documented limit reply, so a socket-fed anchor would not need it and a REST fallback would.

## 7. Server time and clock offset

The documented public API has no time method, and CCXT sets `'fetchTime': false` at `server/node_modules/ccxt/js/src/cryptocom.js` line 99.
Two bounds were read instead.

| source | reading | bound on local clock minus server clock |
|---|---|---|
| HTTP `Date` header | `Tue, 22 Sep 2026 21:43:20 GMT` against a local arrival of 1790113400301 after a 298 ms round trip, and `22:08:55 GMT` against 1790114935416 after 177 ms | between −1.0 and +0.3 s, and between −0.8 and +0.4 s, since the header has one second resolution |
| WebSocket heartbeat `id`, the server clock in ms | local arrival minus `id` was 97 to 124 ms over every heartbeat, and 122 to 124 ms on the second `book` socket, where a subscribe took 214 ms from send to ack | between −92 and +122 ms |

Both are consistent with no offset, and neither can resolve anything finer than a round trip.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
The engine's anchor is a REST poller today, and this venue has no REST call that fits it, so the anchor is the change Crypto.com needs.

| item | recommendation | reason |
|---|---|---|
| source | a socket-fed anchor: `mark.<rawMarketId>`, `index.<underlying_symbol>` and `funding.<rawMarketId>` for every tracked perpetual, 1,188 channels on three connections, kept as the newest `{v, t}` per channel | the channels republish mark and index every second and funding every minute, and no REST call is bulk, section 3 |
| hand-off to the engine | an `AnchorPoller` subclass whose `fetchRound` reads that in-memory map once a second instead of calling HTTP | keeps `AnchorPoller`'s cadence, logging and `Engine.updateAnchor` path unchanged |
| row mapping | section 3, with `fundingIntervalHours` 1 and `nextFundingAt` the next whole UTC hour | neither is published as a field |
| row time | the older of the mark `t` and the index `t`, or the arrival time | `t` sits on the whole second and arrived a median of 174 to 187 ms later on the socket, in two runs |
| REST fallback | `get-valuations` with `count=1` for mark and index on the markets in live candidate routes only, at most 40 of them at 80 requests per second, and `funding_rate` once a minute | the per-method limit of 100 per second, section 6 |
| skip | `ANTHROPICIPOUSD-PERP` and `OPENAIIPOUSD-PERP` | indexed to other venues' perpetuals, section 4 |
| watch | a leg more than 0.5 % from its index | the mark bandwidth caps the premium, section 4 |
| rate limit pause | `rateLimitPauseMs` 1,000 for the REST fallback | the window is one second, and no `Retry-After` was seen |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Common API Reference, REST and WebSocket | https://exchange-developer.crypto.com/exchange/v1/docs/api/rest-common-api-reference | 2026-09-22 | Crypto.com Exchange API v1 | base URL, public limit of 100 per second per method per IP, reason codes, sections 1, 3, 6 |
| S2 | `public/get-instruments`, `public/get-tickers`, `public/get-book`, `public/get-valuations`, `public/get-risk-parameters` | https://exchange-developer.crypto.com/exchange/v1/docs/api/rest/public-get-valuations | 2026-09-22 | Crypto.com Exchange API v1 | fields, parameters, valuation types, sections 2 to 5 |
| S3 | Crypto.com Index Price, dated 2024-01-16 | https://help.crypto.com/en/articles/5311933-crypto-com-index-price | 2026-09-22 | Crypto.com, global | index method and clamps, section 4 |
| S4 | Exchange - Index Constituent, "Update Date: 2026-09-22" | https://static2.crypto.com/exchange/assets/documents/Exchange%20-%20Index%20Constituent.pdf | 2026-09-22 | Crypto.com Exchange | every basket, section 4 |
| S5 | Key Applicable Terms - Perpetuals, dated 2023-11-28 | https://help.crypto.com/en/articles/5338857-key-applicable-terms-perpetuals | 2026-09-22 | Crypto.com, global | mark formula and bandwidth, section 4 |
| S6 | Supported Perpetual Contracts | https://help.crypto.com/en/articles/4983603-supported-perpetual-contracts | 2026-09-22 | Crypto.com, global | order price bands, section 4 |
| S7 | Cloudflare IPv4 ranges | https://www.cloudflare.com/ips-v4 | 2026-09-22 | Cloudflare | network of the resolved addresses, section 1 |
| S8 | CCXT 4.5.68 `cryptocom.js` | `server/node_modules/ccxt/js/src/cryptocom.js` | 2026-09-22 | CCXT | catalog mapping, funding, time, limits, sections 2, 3, 5, 6, 7 |
| P1 | `rest-probe.mjs main`, 21:43 UTC and a rerun at 22:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptocom/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 5, 6, 7 |
| P2 | `rest-probe.mjs anchor` and `round`, 21:43 to 21:46 UTC and a rerun at 22:09 to 22:10 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptocom/rest-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P3 | `rest-probe.mjs baskets`, 21:46 UTC and a rerun at 22:10 UTC with an identical result | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptocom/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
| P4 | `ws-probe.mjs book` at 21:57 UTC, and `ws-probe.mjs anchor` at 22:02 and 22:10 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs) | 2026-09-22 | this host | heartbeat clock bound, socket anchor timing, sections 7 and 8 |
