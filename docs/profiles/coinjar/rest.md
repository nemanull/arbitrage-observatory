# CoinJar REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:24 to 03:25 UTC and again 03:43 to 03:45 UTC, from the development host near Seattle.

This profile covers the public REST APIs of CoinJar Exchange, which has no CCXT class, on its spot market, because CoinJar lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the catalog is the spot catalog, and section 3 states that the venue publishes no index, mark or funding.
Every number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) or a source ledger row.
CoinJar splits its public REST calls over two hosts: the catalog lives on the Trading API host `api.exchange.coinjar.com`, S1, and tickers and books on the Data API host `data.exchange.coinjar.com`, S2.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| addresses | `api.exchange.coinjar.com`, `data.exchange.coinjar.com` and `feed.exchange.coinjar.com` all resolved to `104.20.27.93`, `172.66.174.241`, `2606:4700:10::ac42:aef1` and `2606:4700:10::6814:1b5d`, which are Cloudflare | P1 |
| edge | `cf-ray` of the catalog reply ended in `SEA` in the first run and `YVR` in the second | P1 |
| origin region | "you may choose to co-locate with the CoinJar Exchange servers in AWS Sydney (`ap-southeast-2`) region" | S3 |
| `GET /products`, 582,288 bytes | cold 169.4 and 145.2 ms, warm 58.5 to 80.7 ms over ten calls in two runs | P1 |
| one ticker per product, 302 calls | min 26.2 and 24.5, median 56.8 and 36.9, p90 91.2 and 57.0, max 153.9 and 117.6 ms in the two runs | P2 |
| one ticker at one hertz, 60 polls | median 24.1 to 36.3 ms, max 75.3 to 129.3 ms, on four products in two runs | P3 |
| access | every public call answered from this host, no geoblock and no challenge | P1 to P3 |

The polled replies are fast because Cloudflare serves about half of them from its edge cache, see section 5.

## 2. Catalog

### The instruments call

`GET https://api.exchange.coinjar.com/products`, S1, needs no credentials.
It returned 302 products on 2026-09-23.
`GET /products?all=true` "returns all products from CoinJar Exchange, including inactive products", S1, and returned 452, so 150 products are inactive, 78 of them quoted in EUR, 23 in BTC, 13 in AUD, 12 in GBP, 11 in USD, 11 in USDC and 2 in USDT, in P1.
The same path on the Data API host answers 404.

| field | meaning |
|---|---|
| `id` | the product id used in every Data API path and every socket topic, `BTCUSD` for 143 older products and `BTC-USDT` for 159 newer ones |
| `name` | `BTC/USD` |
| `base_currency`, `counter_currency` | `iso_code`, `name`, `subunit`, `subunit_to_unit` |
| `tick_value`, `tick_value_exponent` | the smallest counter currency unit, such as `"0.01"` |
| `price_levels` | 12 price bands, each with `tick_size` and `trade_size`, the rule of four significant figures in S4 |

No row carries a status.
Every one of the 302 tickers read `status` `continuous` in P2, so the default list is the tradable list.
The counter currencies were 70 `USD`, 69 `AUD`, 68 `GBP`, 67 `USDC`, 19 `USDT`, 7 `BTC` and 2 `DAI`, in P1.
No base and counter pair is listed twice.

### How CCXT maps it

It does not.
CCXT 4.5.68 and the current CCXT master have no CoinJar class, see [`fees.md`](./fees.md) section 8.
So `market.id`, `contractSize`, `linear` and `active` do not exist, and a feed would need a catalog written by hand from this call.
The product `id` is identical in the catalog, the Data API path and the socket topic, and all three are case sensitive: `btc-usdt` answers 404 on REST and `invalid product` on the socket.

### The USD settlement family

The engine's quote family ranks USDT, then USDC, then USD, at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) line 13.
70 bases have a market in that family, and the rank picks 19 USDT, 48 USDC and 3 USD markets, in P1.
The 3 USD picks are `USDC-USD`, `GBPUSD` and `AUDUSD`, whose bases are not crypto, and 2 of the USDC picks are the stablecoins `USDT` and `DAI`.
That leaves 65 crypto bases, 19 on USDT and 46 on USDC.

Of the 70 picks, 69 had two sides in P2.
Their spread over the mid was min 1,800, median 31,063, p90 46,174 and max 105,747 ppm, and 1 was under 2,000 ppm, in the second run of P2.
The first run, computed afterwards from its saved replies, gave min 1,401 and median 29,868 ppm.
23 of the 70 had no 24 h volume in both runs of P2.
The six BNB products, among them `BNB-USDT`, list no order on either side, with `bid` and `ask` null and `last` false, in P2.

### Size unit and price scale

Sizes are in the base currency and prices in the counter currency, S4.
Spot has no contract, so the engine's size multiplier would be 1.
No product is quoted per 10 or per 1000 units.

## 3. Anchor

CoinJar publishes no index price and no funding rate for any product, because every product is spot.
No such call exists in the Trading API or the Data API reference, S1 and S2.
The only reference prices it publishes are these, all per product.

| call | fields | meaning |
|---|---|---|
| `GET /products/{id}/ticker` | `bid`, `ask`, `last`, `mark_price`, `prev_close`, `session`, `status`, `transition_time`, `current_time`, `volume`, `volume_24h`, `change_24h` | `mark_price` and `change_24h` are not in the documented schema, S2 |
| `GET /products/{id}/auction` | `indicative`, `auction_volume`, `imbalance` | the indicative auction price, empty strings outside an auction, S2 and P1 |
| `GET /products/{id}/stats` | `vwap`, `volume` and `total` over 1 h, 1 d and 1 w | market statistics, S2 |

No bulk call exists: `GET https://data.exchange.coinjar.com/products` answers 404, and the ticker takes one product id.
A poll of every USD family pick would cost 70 calls a second.
Nothing here can fill an `AnchorRow`, whose `index` and `fundingRate` have no source.
A route with no anchor row is refused as `anchor_missing`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 25 to 27, and a mark of 0 as `anchor_no_mark` at lines 37 to 39.
So a CoinJar leg could never pass the open gate in the engine's current shape.

## 4. Anchor semantics

### Index and funding

None exist.

### The ticker's `mark_price`

It is undocumented, S2, and it is not a mark in the perpetual sense.
In P2, 296 products had a bid, an ask and a last, and on 237 and 250 of them in the two runs `mark_price` equalled the median of `bid`, `ask` and `last`.
On the others it sat near the bid or the ask, such as `LTCBTC` with bid `0.00072880`, ask `0.00073270`, last `0.00070350` and mark `0.00072850`.
The socket probe tested the median against the native book, which excludes implied levels, see [`websocket.md`](./websocket.md) section 4.
In the socket probe's second book run the mark equalled the median of the native best bid, the native best ask and the last on 12 of 13 ticker readings, and the median of the ticker's own bid, ask and last on 12 of 13, in P4.
In the third run the two counts were 14 and 33 of 55, and `ETH-USDC` read mark `2776` with bid `2775`, ask `2783` and last `2767`, which neither median explains, in P4.
So the mark usually sits at or near a last price clamped to the best bid and ask, and its rule is Not verified.

### How often each number changed

Sixty polls one second apart on 2026-09-23 at 03:25 and 03:44 UTC, in P3.

| product | changes in 59 intervals, first run | changes in 59 intervals, second run |
|---|---|---|
| `BTC-USDT` | none | `ask` 2 |
| `ETH-USDC` | `bid` 4, `ask` 2 | `mark_price` 15, `bid` 9, `ask` 5 |
| `BTCUSD` | none | `bid` 2, `ask` 3, `mark_price` 1 |
| `XRPBTC` | `bid` 5, `mark_price` 5, `ask` 1 | `bid` 4, `mark_price` 3, `ask` 2 |

`last` did not change on any of the four in either run.
At 03:24 UTC the newest `BTC-USDT` trade in the `trades` reply was from 2026-09-22 18:50 UTC, more than eight hours earlier, and at 03:43 UTC it was from 03:40:50 UTC, in P1.

## 5. REST book snapshot

`GET https://data.exchange.coinjar.com/products/{id}/book?level=1|2|3`, S2.

| level | documented | probed |
|---|---|---|
| 1 | "Only the best bid and ask", S2 | one level per side, equal to the ticker's `bid` and `ask` read just before on `BTC-USDT`, `BTCUSD` and `XRPBTC` |
| 2 | "Top 20 bids/asks" in the API reference, S2, and "Top 40" in the order book table, S5 | 40 bids and 40 asks on `BTC-USDT` and `BTCUSD`, 38 or 37 bids and 40 asks on `XRPBTC`, about 2.6 KB |
| 3 | "Full order book", S2, all native levels and the top 40 implied, S5 | bids and asks of 92 and 80, then 91 and 77 on `BTC-USDT`, 45 and 81, then 52 and 78 on `BTCUSD`, 38 and 114, then 37 and 107 on `XRPBTC`, 4.0 to 5.6 KB |
| 4 | not documented | 200 with the level 1 shape |

Bids come best first and descending, asks best first and ascending, at every level, in P1.
The level 2 book includes implied levels, and so does the socket's `book:` channel, see [`websocket.md`](./websocket.md) section 4.

Every Data API reply carries `cache-control: public, maxage=1, s-maxage=1, stale-while-revalidate=15`, and Cloudflare honours it.
Over 60 one hertz polls, each of the four tickers came back `HIT` 28 to 30 times and `EXPIRED` or `MISS` the other times, and the level 2 book `HIT` 29 and 30 times, in the two runs of P3.
The ticker's `current_time` repeated the previous poll's value on 28 to 30 of 59 polls, and trailed the arrival time by a median of 925 to 1,071 ms and at most 2,613 ms.
The level 2 book changed between polls 29 and 27 times out of 59.
A query string with a changing value, `?nonce=<ms>`, made all 6 such requests a `MISS` in each run, in P3.
`stale-while-revalidate=15` also allows the edge to serve a reply up to 15 s old while it refetches, and no reply older than 1 s by its `age` header was seen.

## 6. Rate limits and errors

"Generally, most API calls are rate limited to 600 requests every 10 minutes", and "API calls for order placements, order cancellation and market data are not rate limited", S6.
CoinJar "reserves the right to restrict your API access" if non rate limited use "is excessive compared to your settled trading activities", S6.
No reply carried a rate limit header or `Retry-After`, and no 429 was met, in P1 to P3.

| request | status | body |
|---|---|---|
| unknown product, Data API ticker or book | 404 | `{"error_type":"NOT_FOUND","error_messages":["Record not found."]}` |
| lower case product id | 404 | the same |
| unknown path under a product | 404 | the same |
| `GET /products` on the Data API host | 404 | the same |
| unknown product on the Trading API host | 404 | the same |
| an inactive product, `BTCEUR`, Data API ticker or book | 404 | the same |
| `book?level=4` | 200 | the level 1 book |

The API reference lists a 400 reply with an empty schema for each Data API call, S2, and none was met.

## 7. Server time and clock offset

No server time call is documented.
The ticker's `current_time` is the nearest reading.
On ten uncached ticker reads over two runs it was 21 to 480 ms behind the midpoint of the local send and receive times, with round trips of 45 to 102 ms, in P1.
The development host's clock is NTP synchronised, `timedatectl` read `NTPSynchronized=yes` on 2026-09-23, so the gap is most likely the age of the ticker at the origin rather than a clock offset.
`GET https://api.exchange.coinjar.com/sessions`, "List of trading sessions +/- 3 days from now", S1, answered 200 with `[]` and no credentials, in P1.

## 8. Recommended poller shape

None.
CoinJar has no perpetual, no index and no funding rate, and no bulk ticker call, so no anchor poller can be built for it.
If a later design ever admits spot legs, the engine would need a different anchor for a spot leg, and this venue offers only the per product ticker of section 3.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading REST API reference, `List products` and `List recent sessions` | https://docs.exchange.coinjar.com/reference/get_products-1 | 2026-09-22 | CoinJar Exchange | catalog call, `all` parameter, sessions call, sections 2, 3 and 7 |
| S2 | Market Data REST API, Getting Started and the Ticker, Order Book, Auction and Market Stats references | https://docs.exchange.coinjar.com/reference/getting-started-data-api | 2026-09-22 | CoinJar Exchange | Data API host, schemas, book levels, 400 replies, sections 2 to 6 |
| S3 | Trading Rules, Development Considerations | https://docs.exchange.coinjar.com/page/trading-rules | 2026-09-22 | CoinJar Exchange | AWS Sydney co-location, section 1 |
| S4 | Prices and Sizes | https://docs.exchange.coinjar.com/docs/prices-and-sizes | 2026-09-22 | CoinJar Exchange | tick and trade size rule, section 2 |
| S5 | Matching Engine, Order Book | https://docs.exchange.coinjar.com/docs/order-book-1 | 2026-09-22 | CoinJar Exchange | book types, 40 levels, implied levels, section 5 |
| S6 | Rate Limits | https://docs.exchange.coinjar.com/docs/rate-limits | 2026-09-22 | CoinJar Exchange | 600 per 10 minutes, market data unlimited, section 6 |
| P1 | `rest-probe.mjs main` at 03:24 and 03:43 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2 and 5 to 7 |
| P2 | `rest-probe.mjs scan` at 03:24 and 03:43 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) | 2026-09-22 | this host | ticker of every product, status, spreads, mark rule, sections 2 to 4 |
| P3 | `rest-probe.mjs poll` at 03:25 and 03:44 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) | 2026-09-22 | this host | change counts, cache behaviour, sections 1, 4 and 5 |
| P4 | `ws-probe.mjs book`, second and third runs at 03:30 and 03:45 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs) | 2026-09-22 | this host | mark against the native book, section 4 |
