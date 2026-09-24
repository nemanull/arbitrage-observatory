# Deribit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:20 and 20:45 Pacific time, which is 2026-09-23 03:20 to 03:45 UTC.

This profile covers the public JSON-RPC over HTTP API v2 of Deribit (CCXT id `deribit`) for both perpetual families: the catalog, the anchor calls, the index, mark and funding semantics, and the REST book.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs), from [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) where it says so, or from a cited source.
Each probe mode ran twice, and both readings are written where they differ.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST base | `https://www.deribit.com/api/v2`, S1, and CCXT at `server/node_modules/ccxt/js/src/deribit.js` line 129 |
| resolved addresses | `104.18.4.240` and `104.18.5.240`, Cloudflare, in both runs |
| edge | `server: cloudflare`, `cf-ray` ending in `SEA`, so the request enters Cloudflare in Seattle and travels on to London |
| first request | 223 ms and 229 ms |
| warm `public/get_time` | 10 calls: min 148, median 151, max 161 ms, and min 149, median 151, max 161 ms in the rerun |
| server time inside a request | `usDiff` of 54 µs and 103 µs on the first `get_time` of each run |
| compression and caching | `content-encoding: br`, `cache-control: no-store`, `cf-cache-status: DYNAMIC` |
| status | `public/status` answered `{"locked":"false"}` |
| access | every public call answered 200 or a JSON-RPC error with 400, and no call was refused for the host's location |

`docs.deribit.com` answered 200 and serves each page as Markdown at its URL plus `.md`.
`support.deribit.com/hc/en-us` answered 403 to curl and to WebFetch, while its Zendesk JSON API `support.deribit.com/api/v2/help_center/...` answered 200, see [`fees.md`](./fees.md).
`https://www.deribit.com/kb/fees` and other `/kb/` paths return the same 17,275 byte app shell titled "Crypto Futures and Options Exchange - Deribit by Coinbase".

## 2. Catalog

### The instruments call

`GET /public/get_instruments` without parameters returned every instrument of every kind: 5,930 rows, 5,115,758 bytes, in 375 ms and 265 ms, P1.
It costs 10,000 credits from a pool of 500,000, "1 request/second" sustained and a burst of 50, S2.
`currency` and `kind` narrow it, and `currency=USDT&kind=future` returned an empty list.

| state | documented values | seen on perpetuals |
|---|---|---|
| `state` | `open`, `settlement`, `delivered`, `inactive`, `locked`, `halted`, `archivized`, S3 | `open` on 131 of 131 |
| `is_active` | boolean | `true` on 131 of 131 |

The one row not `open` among the 5,930 was the spot pair `SOL_ETH`, `locked`.

| family | `instrument_type` | settlement | quote and counter | count | `price_index` |
|---|---|---|---|---:|---|
| USDC linear perpetuals | `linear` | USDC | USDC | 129 | `<base>_usdc` |
| BTC inverse perpetual | `reversed` | BTC | USD | 1 | `btc_usd` |
| ETH inverse perpetual | `reversed` | ETH | USD | 1 | `eth_usd` |

The 129 linear perpetuals split by `underlying_type` into 97 `crypto`, 23 `equity`, 5 `equity_etf`, 4 `commodity`, 1 `crypto_index` (`COIN50`) and 1 `preipo` (`OPENAI`).
Four bases carry a 1000 prefix, `1000BONK`, `1000MOG`, `1000PEPE` and `1000SHIB`.

### How CCXT 4.5.68 maps it

| CCXT field | source | probed |
|---|---|---|
| catalog call | one `get_instruments` with no currency, because `fetchAllMarkets` defaults to true, lines 805 to 808 | `loadMarkets` returned 5,930 markets in 786 ms and 944 ms |
| `id` | `instrument_name`, line 925 | equal to the socket's `instrument_name` and the anchor reply's `instrument_name` on 131 of 131 |
| `symbol` | `base/quote:settle`, line 957 | `BTC/USDC:USDC`, `BTC/USD:BTC`, `NVDA/USDC:USDC` |
| `base` | `base_currency` | `BTC`, `NVDA`, `1000PEPE` |
| `quote` | `counter_currency`, not `quote_currency`, line 927 | `USDC` on the linear, `USD` on the inverse |
| `type`, `swap` | `swap` when `settlement_period` is `perpetual`, line 933 | 131 active swaps |
| `linear` | `settle === quote`, line 968 | `true` on 129, `false` on the 2 inverse |
| `active` | `is_active`, line 992 | `true` on 131 |
| `contractSize` | `contract_size`, line 998 | equal to the catalog on 131 of 131: 0.0001 on 4, 0.001 on 10, 0.01 on 42, 0.1 on 33, 1 on 40 linear, 10 on `BTC-PERPETUAL`, 1 on `ETH-PERPETUAL` |
| `taker`, `maker` | `taker_commission`, `maker_commission`, lines 996 and 997 | 0.00035 and 0.00015 on 131 |

### Size unit, pairs listed twice, and price scale

The linear `contract_size` is in the base coin, and so is every book amount, so the amount is already coins and must not be multiplied by `contractSize`, see [`websocket.md`](./websocket.md) section 4.
The inverse `contract_size` is in USD, "A contract_size of 10 on BTC-PERPETUAL therefore means 10 USD, not 10 BTC", S4.
The engine multiplies book sizes by `contractSize`, so Deribit needs the registry's `contractSize: 1` pin, the same override Gemini uses in [`registry.ts`](../../../server/src/venues/registry.ts).

BTC and ETH are each listed twice, as `BTC_USDC-PERPETUAL` and `BTC-PERPETUAL`, and as `ETH_USDC-PERPETUAL` and `ETH-PERPETUAL`.
The quote family ranks a linear contract before an inverse one at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) line 16, so the linear one would win anyway.
A `marketFilter` of `linear === true` is still needed, because the `contractSize: 1` pin would read the inverse USD amounts as coins.

Prices are per one unit of the base, and the 1000-prefixed bases are priced per thousand, as their name says.
`OPENAI_USDC-PERPETUAL` marked 1,658 to 1,659 USDC, while OKX's `OPENAI-USDT-SWAP` already carries a price scale of 10 in [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts), so the two need a scale check before they cluster, which this profile did not do.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /public/get_book_summary_by_currency?currency=USDC&kind=future` | `estimated_delivery_price` | `mark_price` | `current_funding`, and `funding_8h` | absent | absent | 73.7 to 73.8 KB, 174 rows of which 129 perpetuals | 60 polls: min 151, median 154, p90 163, max 174 ms, and min 151, median 155, p90 164, max 210 ms in the rerun |
| same with `currency=BTC` | same fields | | | | | 4.9 KB, 12 rows, 1 perpetual | 147 ms and 146 ms |
| same with `currency=ETH` | same fields | | | | | 4.8 KB, 12 rows, 1 perpetual | 146 ms in both runs |
| same with `currency=any` | | | | | | 400, `invalid currency` | |

One call carries index, mark and rate for all 129 linear perpetuals, and the rows are keyed by `instrument_name`, which is CCXT's `market.id`.
No row was missing a mark, an index or a rate on either run.
The reply has no interval and no settlement time, because funding accrues continuously, see section 4.
`kind=future` returns the 45 dated USDC futures beside the perpetuals, so the poller keeps rows whose name ends in `-PERPETUAL`.

`estimated_delivery_price` is the index for a perpetual.
`public/get_index_price?index_name=btc_usdc` returned `{"estimated_delivery_price":86570.49,"index_price":86570.49}`, the BTC ticker read about 1.5 s earlier returned `index_price` 86570.49, and the summary row read just before that ticker said 86569.99.
In the rerun the ticker's `index_price` and the summary's `estimated_delivery_price` were equal on BTC, HYPE, NVDA and OPENAI, and the summary's `mark_price` equalled the ticker's on HYPE, NVDA and OPENAI.

### The summary is a snapshot about two seconds old

The rerun kept each poll's `creation_timestamp` on the BTC row.
60 polls one second apart saw only 31 distinct values, 1,001 to 3,056 ms apart with a median of 1,995 ms.
At arrival the snapshot was 375 to 2,510 ms old, median 1,401 ms, with the clock offset of section 7 under 34 ms.
So the bulk call republishes about every 2 s, and a reading stamped on arrival is a median 1.4 s older than its stamp.
The per instrument `public/ticker` was current, but polling 129 of them each second would exceed the 20 requests per second of the default limit in S2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `instrument_name` | string, `BTC_USDC-PERPETUAL` | none |
| `index` | `estimated_delivery_price` | JSON number | none |
| `mark` | `mark_price` | JSON number, never 0 on 131 rows | none |
| `fundingRate` | `current_funding` | JSON number, an 8 hour rate as a fraction: `0.00015788` is 0.015788 % per 8 h | none |
| `fundingIntervalHours` | none on the wire | | the constant 8, the period the rate is expressed over |
| `nextFundingAt` | none on the wire | | 0, which the engine treats as unknown at [`types.ts`](../../../server/src/engine/cluster/types.ts) line 38 |

`funding_8h` is not the upcoming rate.
It is the funding realised over the trailing 8 hours: `public/get_funding_rate_value` over the last 8 h returned 5.016e-5 on BTC, against `funding_8h` of 5.043e-5 to 5.082e-5 in the summaries read in the minute before, and 5.343e-5 against 5.434e-5 to 5.451e-5 in the summaries read in the two minutes after, in the rerun.

## 4. Anchor semantics

### Index

Deribit runs two index families, S5.
"This methodology applies to instruments with a listed Deribit option."
"Perpetual futures without a corresponding listed Deribit option use the Coinbase Index instead."
The Deribit Index is a capped median of exchange prices, each capped at 0.5 % around the initial median, then weighted.
It halts related derivatives on a move of more than 10 % between one second ticks, and drops a constituent that has not updated for 3 minutes, S5.
The Coinbase Index takes each live constituent's median of last trade, best bid and best offer, drops any more than 5 % from the median of those, and publishes their equal weighted average every second, S6.
Its sources are Coinbase, Binance, Bitstamp, Bybit, Kraken, LMAX Digital, Gemini and OKX, plus the aggregators Coin Metrics and Pyth, S6.
"As of the 15th of July 2025, the BTC-USDC index is pegged to the BTC-USD index", and the same holds for ETH, S7.

The basket is public on the WebSocket channel `deribit_price_ranking.{index_name}`, and `ws-probe.mjs basket` read the first frame of all 131 perpetual indices twice.
123 of the `_usdc` indices had one live source, `proxy_usd` at weight 100, so the probe then read the matching `_usd` index.

| basket after resolving `proxy_usd` | perpetuals |
|---|---:|
| `mda_index_source` at weight 100, a single external source whose constituents the API does not show | 122 |
| `kraken:20 lmax:20 okx:20 proxy_usdt:40`, BTC linear and inverse | 2 |
| `coinbase`, `gemini`, `kraken`, `lmax`, `okx` at 14.29 each and `proxy_usdt` at 28.57, ETH linear and inverse | 2 |
| `binance:20 bybit:20 kucoin:20 proxy_usd:40`, SOL and XRP | 2 |
| `binance:33.33 proxy_usd:66.67`, AVAX | 1 |
| `hyperliquid:20 proxy_usd:40 proxy_usdt:40`, HYPE | 1 |
| `kraken:25 okx:25 proxy_usdt:50`, TRX | 1 |

No visible basket contains Deribit's own perpetual.
The 122 opaque baskets are presumably the Coinbase Index of S6, but the name `mda_index_source` is not explained in any source read, so that is an inference.

Three index shapes can trail the perpetual itself, which is the failure of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).

- `OPENAI_USDC-PERPETUAL`, the one pre-IPO perpetual: the index is "the median of" two inputs, "(i) an internal reference price derived from trading activity on Deribit, being a one-hour exponential moving average (EMA) of the contract's Mark Price" and "(ii) one or more third-party, publicly observable market prices", and "If an external input diverges from the Index Price by more than 5%, the index falls back to internal-only pricing (EMA)", S8.
- The 23 equity and 5 equity ETF perpetuals: "When the underlying equity market is closed on weekends and/or holidays, Deribit switches to an Internal Index constructed using a one-hour exponential moving average (EMA) of the Mark Price combined with Tokenized Price Feeds or External Perpetual Futures Prices", S8.
- The 4 commodity perpetuals switch the same way when their markets are closed, including weekday evenings and daily maintenance, S8.

### Mark

"Index Price + EMA of the difference between bounded mid price and index price", S7.
The mid is a VWAP over "a configurable depth of the order book", locally bounded by the best bid and ask, the premium is smoothed by an EMA "over a defined time window", and a final "dynamic" bandwidth around the index constrains the result, S9.
The EMA window and the final bandwidth are Not publicly specified.
Deribit warns that "the mark price should not be relied upon for making trading decisions", because of "the lag in genuine market moves and flash crash protection", S9.
Trading itself is limited to "Deribit Index + 1 minute EMA (Bounded mid price - Index) +/- 1.5%, and a fixed bandwidth of the Deribit Index of +/- 7.5%", S7, and the ticker publishes that band as `min_price` and `max_price`, such as 85476.4 and 88079.9 on BTC against an index of 86744.11.
Pre-IPO perpetuals have a fixed band of plus or minus 10 % of the index, S8.

### Funding

The rate formula, damper and caps are in [`fees.md`](./fees.md) section 6.
`current_funding` is the rate at this instant, "Calculated as `(mark_price − index_price) / index_price` at this moment", S10, after the damper and cap of S11.
Applying the damper to each summary row's own mark and index reproduced `current_funding` within 0.000001 on 124 of 129 perpetuals in the first run and 121 in the rerun.
One miss is rounding: BNB publishes `current_funding` and `funding_8h` to four decimals, so 0.000084 reads as 0.0001.
The others differed by up to 0.00047, which fits a rate taken at a different instant from the row's mark and index, an inference.

### Rate across a settlement

There is no discrete settlement to cross.
Funding is "calculated every millisecond", S12, and the daily 08:00 UTC settlement moves realised funding into the cash balance, S11.
`public/get_funding_rate_history` returned 24 rows for the last 24 h on BTC, BTC inverse and HYPE, exactly 3,600,000 ms apart, each with `interest_1h` (the funding of that hour), a trailing `interest_8h`, `index_price` and `prev_index_price`.
The probe did not observe the 08:00 UTC settlement.

### How often each number changed

60 polls of the USDC summary one second apart, counting polls whose value differed from the poll before, out of 59.

| perpetual | index | mark | `current_funding` | `funding_8h` |
|---|---|---|---|---|
| `BTC_USDC-PERPETUAL` | 28, rerun 30 | 29, 30 | 28, 30 | 24, 20 |
| `ETH_USDC-PERPETUAL` | 28, 28 | 28, 28 | 15, 14 | 0, 2 |
| `HYPE_USDC-PERPETUAL` | 12, 18 | 15, 23 | 5, 14 | 0, 2 |
| `ALGO_USDC-PERPETUAL` | 14, 9 | 17, 9 | 8, 0 | 0, 1 |
| `GOLD_USDC-PERPETUAL` | 15, 11 | 14, 14 | 15, 14 | 20, 20 |
| `NVDA_USDC-PERPETUAL` | 2, 2 | 3, 3 | 3, 0 | 11, 1 |
| `OPENAI_USDC-PERPETUAL` | 10, 4 | 23, 8 | 0, 0 | 1, 1 |

BTC and ETH changed on about every second poll, which is the 2 s republish of section 3, not a slow index.
The index itself ticks once a second: `deribit_price_index.btc_usdc` sent 61 and 60 frames in 57 s over the socket.
NVDA's index moved twice a minute in both runs, at about 03:21 and 03:38 UTC, outside US market hours.

## 5. REST book snapshot

`GET /public/get_order_book?instrument_name=<id>&depth=<n>`, with `depth` one of 1, 5, 10, 20, 50, 100, 1000 or 10000, S13.

| read | time | levels | order |
|---|---|---|---|
| `BTC_USDC-PERPETUAL` depth 20 | 150 ms, 148 ms | 20 and 20 | bids descending, asks ascending |
| `BTC_USDC-PERPETUAL` depth 10000 | 150 ms, 147 ms | 273 and 115, 272 and 116, the whole book, about 7 KB | same |
| `ETH-PERPETUAL` depth 20 | 149 ms, 148 ms | 20 and 20 | same |
| `ALGO_USDC-PERPETUAL` depth 20 | 148 ms, 146 ms | 14 and 9, 12 and 11 | same |
| `NVDA_USDC-PERPETUAL` depth 20 | 155 ms, 147 ms | 19 and 16, 16 and 17 | same |

The reply also carries `change_id`, `timestamp`, `index_price`, `mark_price`, `current_funding`, `funding_8h` and the band, so one call holds a book and its anchor.
Every linear size was a multiple of `contract_size` in both runs, 388 of 388 at depth 10,000 on BTC.
The reply is `cache-control: no-store`, and `timestamp` was 74 to 329 ms old at arrival in eleven reads, P2.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| public requests | "rate-limited on a per-IP basis", with no published number, "subsequent calls may be temporarily rejected or the connection disconnected" | S2 |
| default non-matching engine limit | 500 credits per request, a pool of 50,000, a refill of 10,000 per second, "up to 20 requests per second", "up to 100 requests at once" | S2 |
| `public/get_instruments` | 10,000 credits, pool 500,000, 1 per second, burst 50 | S2 |
| `public/subscribe` | 3,000 credits, pool 30,000, about 3.3 per second, burst 10 | S2 |
| exhaustion | "we immediately send a `too_many_requests` (`code 10028`) or similar error and terminate the session" | S2 |
| HTTP status of a limit | Not publicly specified, and not provoked | |
| `Retry-After` | absent on every error reply read | P3 |

Errors are HTTP 400 with a JSON-RPC body, P3.

| request | body |
|---|---|
| unknown instrument on `ticker` or `get_order_book` | `{"code":-32602,"data":{"reason":"instrument not found","param":"instrument_name"},"message":"Invalid params"}` |
| `get_book_summary_by_currency` without `currency` | `-32602`, reason `value is required` |
| `currency=NOPE` or `currency=any` | `-32602`, reason `invalid currency` |
| `public/nope` | `{"code":-32601,"message":"Method not found"}` |
| `public/set_heartbeat` over HTTP | `{"code":10030,"message":"must_be_websocket_request"}` |
| `private/get_account_summary` without auth | `{"code":13009,"data":{"reason":"invalid_token"},"message":"unauthorized"}` |

## 7. Server time and clock offset

`GET /public/get_time` returns Unix ms in `result`, and every reply carries `usIn` and `usOut` in µs.
Against the midpoint of each request, the server clock led the local clock by 1 to 34 ms, median 3, over 11 calls, and by 2 to 28 ms, median 4, in the rerun.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=USDC&kind=future` | one call carries index, mark and rate for all 129 linear perpetuals |
| inverse | none | the two inverse perpetuals are filtered out, see section 2 |
| interval | 2,000 ms | the reply republishes about every 2 s, so a 1 s poll reads each snapshot twice, section 3 |
| row mapping | section 3, key `instrument_name`, rows ending in `-PERPETUAL` only | |
| `fundingIntervalHours` | 8 | the rate is expressed per 8 h, while it accrues each millisecond |
| `nextFundingAt` | 0 | there is no funding instant |
| receive time | stamp on arrival, and consider stamping `creation_timestamp` instead | the snapshot is a median 1.4 s old on arrival |
| rate limit pause | `rateLimitPauseMs` 10,000 | the public per IP limit is unpublished, and a breach may disconnect |
| skip | rows whose instrument is not `open` in the catalog | documented states include `locked` and `halted` |
| deny list input | `OPENAI_USDC-PERPETUAL` | its index can fall back to a one hour EMA of its own mark, section 4 |
| weekend input | the 23 equity, 5 equity ETF and 4 commodity perpetuals | their index becomes an EMA of their own mark while the underlying market is closed, section 4 |
| alternative | `ticker.<id>.100ms` for all 129 over the WebSocket | current index, mark and rate on every change, at the cost of a socket based anchor the engine does not have |

The bulk reply is about 3.2 GB a day at one poll every 2 s.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | JSON-RPC overview | https://docs.deribit.com/articles/json-rpc-overview.md | 2026-09-22 | Deribit, all | base URL, `usIn` and `usOut`, sections 1 and 7 |
| S2 | Rate Limits | https://docs.deribit.com/articles/rate-limits.md | 2026-09-22 | Deribit, all | credits, public per IP limit, 10028, sections 2, 3 and 6 |
| S3 | `public/get_instruments` | https://docs.deribit.com/api-reference/market-data/public-get_instruments.md | 2026-09-22 | Deribit, all | `book_state` values, `underlying_type` values, section 2 |
| S4 | Inverse Perpetual | https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual | 2026-09-22 | Deribit, all | USD contract size, section 2 |
| S5 | Index Prices | https://support.deribit.com/hc/en-us/articles/25944739377309-Index-Prices | 2026-09-22 | Deribit, all | Deribit Index method, the Coinbase Index rule, section 4 |
| S6 | Coinbase Index Price Methodology | https://support.deribit.com/hc/en-us/articles/38373568169501 | 2026-09-22 | Deribit, all | Coinbase Index method and sources, section 4 |
| S7 | Linear Perpetual | https://support.deribit.com/hc/en-us/articles/31424969384605-Linear-Perpetual | 2026-09-22 | Deribit, all | USDC index peg, mark formula, trading band, section 4 |
| S8 | RWA Perpetual | https://support.deribit.com/hc/en-us/articles/38325634622493-RWA-Perpetual | 2026-09-22 | Deribit, all | pre-IPO, equity and commodity index rules, section 4 |
| S9 | Mark Prices | https://support.deribit.com/hc/en-us/articles/25944746962973-Mark-Prices | 2026-09-22 | Deribit, all | mark building blocks and warning, section 4 |
| S10 | `public/get_book_summary_by_currency` | https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency.md | 2026-09-22 | Deribit, all | fields, `current_funding` and `funding_8h` definitions, sections 3 and 4 |
| S11 | Funding Specifications | https://support.deribit.com/hc/en-us/articles/31424939178397-Funding-Specifications | 2026-09-22 | Deribit, all | damper, cap, daily cash settlement, section 4 |
| S12 | Inverse Perpetual, funding paragraph | https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual | 2026-09-22 | Deribit, all | millisecond accrual, section 4 |
| S13 | `public/get_order_book` | https://docs.deribit.com/api-reference/market-data/public-get_order_book.md | 2026-09-22 | Deribit, all | depth values, section 5 |
| S14 | CCXT 4.5.68 `deribit.js` | `server/node_modules/ccxt/js/src/deribit.js` | 2026-09-22 | CCXT | lines 129, 805 to 808, 925, 927, 933, 957, 968 and 992 to 998, section 2 |
| P1 | `rest-probe.mjs host`, `catalog` and `anchor`, at 03:20 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 4 and 7 |
| P2 | `rest-probe.mjs funding` and `book` at 03:22 and 03:37 UTC, and the REST reads inside `ws-probe.mjs book` at 03:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs), [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P3 | `rest-probe.mjs errors` at 03:22 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs) | 2026-09-22 | this host | section 6 |
| P4 | `ws-probe.mjs basket` at 03:26 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) | 2026-09-22 | this host | the basket survey, section 4 |
