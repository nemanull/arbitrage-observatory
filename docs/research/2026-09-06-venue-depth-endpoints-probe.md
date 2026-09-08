# Venue depth endpoints probe

Date: 2026-09-07 01:57 to 02:55 UTC, which is the evening of 2026-09-06 local.
This was the research behind the REST depth fetch design of 2026-09-06, which the WebSocket book feeds superseded on 2026-09-07, see [`2026-09-07-depth-sequence-gaps.md`](./2026-09-07-depth-sequence-gaps.md).
It answers two questions for the depth block that shipped in [`../implemented/2026-09-06-depth-block-design.md`](../implemented/2026-09-06-depth-block-design.md): what each venue returns when asked for its book, and how long the answer takes.
Every number here was measured from this development host with the scripts under [`../../scripts/probes/`](../../scripts/probes/), run from `server/` on Node 24 with the global `fetch` and `WebSocket`.
All endpoints are public and unauthenticated.
Latency includes TLS, the request, and reading the whole body, and it is one host on one evening, not a distribution.

## 0. Method

- [`rest-depth-probe.mjs`](../../scripts/probes/rest-depth-probe.mjs) requests each venue's REST book once on a fresh process, then five more times on the kept connection, and prints the first two levels of each side.
- [`ws-depth-probe.mjs`](../../scripts/probes/ws-depth-probe.mjs) opens each venue's depth channel for two instruments and measures connect time, the time from subscribe to the first snapshot, the snapshot size, and the message rate over a window of about eight seconds.
- [`rest-depth-followup-probe.mjs`](../../scripts/probes/rest-depth-followup-probe.mjs) checks the four surprises the first two runs raised.
- [`ws-depth-load-probe.mjs`](../../scripts/probes/ws-depth-load-probe.mjs) subscribes every live perpetual on the five venues, first on the layer 1 channels the feeds use today and then on the depth channels, and measures message rate, bytes, `JSON.parse` time, process CPU and event loop delay over a twenty second window.

Instruments: BTC everywhere, plus LAYER on binance, bybit, okx and kraken, and S on coinbase, because the third audit found LAYER and S books thin enough to show what a short side looks like.

## 1. REST snapshot endpoints

### 1a. Latency and size

| venue | request | cold ms | warm min / med / max ms | bytes | levels returned |
|---|---|---:|---:|---:|---|
| binance USD-M | `fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=20` | 396 | 94 / 96 / 98 | 925 | 20 and 20 |
| binance USD-M | same, `LAYERUSDT` | 383 | 95 / 96 / 99 | 974 | 20 and 20 |
| binance COIN-M | `dapi.binance.com/dapi/v1/depth?symbol=BTCUSD_PERP&limit=20` | 6,286 | 244 / 245 / 252 | 812 | 20 and 20 |
| bybit | `api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=25` | 420 | 161 / 181 / 182 | 1,222 | 25 and 25 |
| bybit | same, `LAYERUSDT` | 438 | 170 / 171 / 192 | 134 | 0 and 0, see 1c |
| okx | `www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=20` | 227 | 134 / 150 / 152 | 1,181 | 20 and 20 |
| okx | same, `LAYER-USDT-SWAP` | 226 | 131 / 150 / 152 | 1,175 | 20 and 20 |
| krakenfutures | `futures.kraken.com/derivatives/api/v3/orderbook?symbol=PF_XBTUSD` | 439 | 151 / 174 / 405 | 45,013 | 1,720 bids and 1,020 asks |
| krakenfutures | same, `PF_LAYERUSD` | 445 | 145 / 148 / 154 | 588 | 21 bids and 9 asks |
| coinbase | `api.coinbase.com/api/v3/brokerage/market/product_book?product_id=BTC-PERP-INTX&limit=20` | 342 | 12 / 13 / 112 | 1,692 | 20 and 20, cached, see 1c |
| coinbase | same, `S-PERP-INTX` | 413 | 12 / 13 / 15 | 1,185 | 19 bids and 9 asks |

Cold is the first request of the process and pays DNS and TLS.
Warm is on the connection that request left open.
Binance COIN-M was slow from this host on both runs, 6.3 s and then 2.3 s cold, and 0.7 to 1.0 s after ten or thirty idle seconds, where every other host stayed at its warm figure.
The quote family drops an inverse contract whenever the venue lists a USDT linear on the same pair, so COIN-M books are the exception and not the rule.

### 1b. Idle keep-alive

The default Node `fetch` kept every connection warm across the idle gaps tested.
Milliseconds, one request each after the stated idle time.

| venue | cold | warm | after 3 s idle | after 10 s idle | after 30 s idle |
|---|---:|---:|---:|---:|---:|
| binance USD-M | 298 | 97 | 101 | 106 | 110 |
| binance COIN-M | 2,311 | 244 | 252 | 736 | 974 |
| bybit | 254 | 181 | 163 | 185 | 182 |
| okx | 262 | 149 | 149 | 153 | 148 |
| krakenfutures | 149 | 146 | 158 | 179 | 177 |
| coinbase | 113 | 14 | 106 | 121 | 91 |

Episodes open minutes apart, so a fetcher without a warm connection would pay the cold column on most requests.
Every host answered with `connection: keep-alive` and no `keep-alive` timeout header, and the measurements say the connection survives at least thirty seconds.
A request every thirty seconds per host, or simply accepting one cold request per episode, are both acceptable, and the design picks between them.

### 1c. Four things the shape does not tell you

1. Kraken returns its bids ascending, worst price first.
   `PF_XBTUSD` bids ran from `[1, 42]` to `[79918, 0.03]` and asks from `[79919, 0.5486]` to `[364324, 0.0002]`, both strictly ascending, on two instruments.
   The best bid is the last element.
   A parser that copies the first twenty bids gets the twenty worst, and `Engine.updateDepth` rejects them as `bids_out_of_order`.
   Kraken's WebSocket `book_snapshot` is best first on both sides, so the two Kraken shapes disagree with each other.
   Kraken's own REST reference says the bids are "sorted descending by bid price", which is the opposite of what the wire sent on both instruments, so neither the documentation nor the wire order can be trusted and a parser has to sort.
2. Coinbase serves `product_book` through Cloudflare with `cache-control: public, max-age=14400`.
   Four plain requests 300 ms apart read `EXPIRED` at 209 ms, then `HIT` at 14 ms twice with the identical `time` of `02:02:48.784561Z`, then `EXPIRED` again at 114 ms with a new `time` 1.6 s later.
   So the edge holds a book for about a second and two reads inside that second are the same book.
   A nonce query parameter, `&_=<ms>`, read `MISS` on all four requests at 113 to 221 ms, each with a fresh `time`.
   The 13 ms figure in 1a is the cache, not Coinbase.
   Coinbase documents this, in two sentences: "Public responses are cached for 1 second."
   And: "For live data, use the WebSocket, send `cache-control: no-cache`, or call the private product endpoints."
   The documented header did not work from this host: ten requests carrying `cache-control: no-cache`, interleaved with ten plain ones, all read `HIT` with the same `time` of `02:11:27.407204Z` at 12 to 18 ms.
   The nonce is therefore the only bypass this probe could confirm.
3. Bybit answers a closed instrument with `retCode: 0` and an empty book.
   `LAYERUSDT` is listed with `status: "Closed"` in `instruments-info`, and its orderbook is `{"s":"LAYERUSDT","b":[],"a":[],"ts":0,"u":0,"seq":0,"cts":0}`.
   An unknown symbol is different: `retCode: 10001, retMsg: "params error: symbol invalid"`.
   A `ts` of zero is therefore the sign of a book that does not exist, and it must not be written as an empty book.
   The connector already drops inactive markets at boot, so this arrives only when an instrument closes during a run.
4. Kraken has no depth parameter and always returns the whole book.
   For `PF_XBTUSD` that is 45 KB and 2,740 levels for the twenty the block keeps.
   It is still 150 to 175 ms warm, so it costs bandwidth and not time.

### 1d. Shapes, one captured level per side

Prices and sizes are decimal strings everywhere except Kraken, where they are JSON numbers.

| venue | envelope | one bid, one ask | venue clock |
|---|---|---|---|
| binance | `{ lastUpdateId, E, T, bids, asks }` | `["79909.40", "7.590"]`, `["79909.50", "6.728"]` | `T` engine ms, `E` event ms |
| bybit | `{ retCode, retMsg, result: { s, b, a, ts, u, seq, cts } }` | `["79911.00", "1.099"]`, `["79911.10", "7.071"]` | `cts` engine ms, `ts` publish ms |
| okx | `{ code, msg, data: [{ asks, bids, ts }] }` | `["79912.9", "109.91", "0", "34"]`, `["79913", "359.37", "0", "31"]` | `ts` ms as a string |
| krakenfutures | `{ result: "success", serverTime, orderBook: { bids, asks } }` | `[79918, 0.03]` last in the array, `[79919, 0.5486]` first | `serverTime` RFC 3339 |
| coinbase | `{ pricebook: { product_id, time, bids, asks } }` | `{ "price": "79942.5", "size": "1.5448" }`, `{ "price": "79942.6", "size": "4.6573" }` | `time` RFC 3339 with microseconds |

Sizes are in the unit the venue counts, as the cluster already expects.
In the same concurrent run near 79,905 dollars the BTC touch read 7.590 coins on binance, 1.099 coins on bybit, 109.91 contracts on okx and 1.5448 coins on coinbase, and kraken's best ask, the one kraken touch that run captured best first, read 0.0247 coins.
The okx figure is contracts of 0.01 BTC, which the cluster's `sizeMul` already converts, so depth sizes go into the block raw exactly like the layer 1 sizes.
Okx's third element is a deprecated field fixed at `"0"` and the fourth is the order count.

## 2. WebSocket depth channels

Connect is the time to the open event.
First snapshot is measured from the subscribe frame.

| channel | connect ms | first snapshot ms | snapshot | traffic in the window | local book needed |
|---|---:|---|---|---|---|
| binance `<symbol>@depth20@100ms` | 1,556 | 314 BTC, 518 LAYER | 20 and 20 levels, 1,002 bytes | 64 BTC and 17 LAYER snapshots in 7.5 s, 82 KB | No, every message is the top twenty |
| bybit `orderbook.50` | 636 | 165 BTC, none for the closed LAYER | 50 and 50 levels, 2,257 bytes | 1 snapshot then 208 deltas in 8.4 s, 51 KB | Yes, deltas at about 25 per second |
| okx `books5` | 362 | 257 and 258 | 5 and 5 levels, 410 bytes | 78 BTC and 14 LAYER snapshots in 8.6 s, 39 KB | No, but five levels only |
| okx `books` | 354 | 264 and 265 | 400 and 400 levels, 21,914 bytes | 2 snapshots then 112 updates in 8.6 s, 142 KB | Yes |
| krakenfutures `book` | 493 | 134 LAYER, 398 XBT | whole book, 1,726 bids and 1,008 asks, 83,377 bytes for XBT | 2,074 XBT deltas and 38 LAYER deltas in 8.5 s, 347 KB | Yes, one level per delta, about 244 per second on XBT |
| coinbase `level2` | 391 | 78 and 79 | whole book, 482 bids and 322 offers, 84,622 bytes for BTC | 110 BTC updates in 8.6 s, 187 KB | Yes, sides are `bid` and `offer` |

Captured first levels, for fixtures:

- binance: `{"e":"depthUpdate","s":"BTCUSDT","U":11493080425500,"u":11493080433094,"pu":11493080425283,"E":1788746280299,"T":1788746280297,"b":[["79909.30","23.163"],...],"a":[["79909.40","4.611"],...]}` with exactly twenty entries per side.
- bybit: `{"topic":"orderbook.50.BTCUSDT","type":"snapshot","ts":1788746279128,"cts":1788746279122,"data":{"s":"BTCUSDT","b":[["79909.40","2.189"],...],"a":[["79909.50","0.652"],...],"u":126652252,"seq":806353894408}}` followed by `"type":"delta"` frames.
- okx `books5`: `{"arg":{"channel":"books5","instId":"BTC-USDT-SWAP"},"data":[{"bids":[["79904.6","362.46","0","52"],...],"asks":[["79904.7","42.95","0","16"],...],"ts":"1788746279107","seqId":338340340019}]}` with no `action` field.
- okx `books`: the same tuple shape with `"action":"snapshot"`, `"prevSeqId":-1` on the snapshot, then `"action":"update"`.
- kraken: `{"feed":"book_snapshot","product_id":"PF_XBTUSD","timestamp":1788746279044,"seq":186304944,"tickSize":null,"bids":[{"price":79943,"qty":0.0062},...],"asks":[{"price":79944,"qty":0.048},...]}` then `{"feed":"book","product_id":"PF_XBTUSD","side":"buy","seq":186304945,"price":79930,"qty":0.1356,"timestamp":...}`.
- coinbase: `{"channel":"l2_data","sequence_num":0,"events":[{"type":"snapshot","product_id":"BTC-PERP-INTX","updates":[{"side":"bid","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79943.9","new_quantity":"3.0105"},...]}]}` then `"type":"update"` events.

Only binance publishes a stream that is a complete top-twenty on every message with nothing to maintain.
Okx's maintenance-free channel is five levels deep.
Bybit, kraken and coinbase publish a snapshot and then deltas, so a reader has to keep a book per instrument, and kraken's XBT book alone ran at 244 deltas per second.

## 2b. Load across the whole universe

The load probe took the live perpetual list from each venue's own REST catalog: 571 on binance USD-M, 815 on bybit linear, 472 on okx, 276 on kraken, 131 on coinbase, 2,265 in all.
The feeds today stream 2,107 of these after cluster filtering, so the figures below are a slight overstatement of production.
Each run subscribed everything with the same connection plan the feeds use, waited four seconds, then measured for twenty.
The probe uses Node's built in `WebSocket`, which dispatches DOM style events per message and is heavier than the `ws` package the feeds use, so the process CPU column is an upper bound and the `JSON.parse` column is the portable figure.

Layer 1, the channels the feeds run today:

| venue and channel | connections | msgs per s | KB per s | avg bytes | parse ms per s | first message p50 / p90 ms |
|---|---:|---:|---:|---:|---:|---|
| binance `bookTicker` | 3 | 1,543 | 247 | 164 | 5.0 | 1,099 / 2,886, on change |
| bybit `orderbook.1` | 5 | 2,020 | 381 | 193 | 9.2 | 332 / 349 |
| okx `bbo-tbt` | 2 | 1,616 | 278 | 176 | 7.7 | 379 / 471 |
| krakenfutures `ticker` | 3 | 188 | 120 | 654 | 1.0 | 266 / 393 |
| coinbase `ticker` | 2 | 92 | 39 | 434 | 0.9 | 145 / 147 |
| total | 15 | 5,459 | 1,065 | | 23.8 | |

Process CPU 29.5 percent of one core, event loop delay p99 5.9 ms against a 5 ms sampling floor, RSS 112 to 115 MB.
Two of the three binance connections closed during this run and coverage was 485 of 571, which did not repeat in the depth run, and the cause was not chased.

Depth, the channels that give twenty or more levels:

| venue and channel | connections | msgs per s | KB per s | avg bytes | parse ms per s | first snapshot p50 / p90 ms | form |
|---|---:|---:|---:|---:|---:|---|---|
| binance `depth20@100ms` | 3 | 1,585 | 1,564 | 1,011 | 36.8 | 760 / 1,443 | complete top twenty per message, 570 of 571 covered |
| bybit `orderbook.50` | 5 | 6,118 | 1,459 | 244 | 32.8 | 662 / 705 | 815 snapshots then 166,047 deltas in twenty seconds |
| okx `books` | 2 | 1,835 | 891 | 497 | 16.5 | 595 / 786 | 472 snapshots then 49,698 updates |
| krakenfutures `book` | 3 | 6,690 | 800 | 123 | 11.4 | 417 / 686 | 276 whole book snapshots then 191,145 one level deltas |
| coinbase `level2` | 2 | refused | | | | | `too many L2 streams requested in a single session` at 100 products per connection |
| total | | 16,230 | 4,714 | | 97.5 | | |

Process CPU 56.3 percent of one core, event loop delay p99 5.9 ms, RSS 145 to 148 MB with no books maintained.
Depth for everything is three times today's message rate and 4.4 times today's bytes, which is about 400 GB a day inbound against about 90 today.
`JSON.parse` alone is about a tenth of one core.

Coinbase's cap was found by asking for descending product counts on fresh connections: 60, 50 and 40 were refused with the message above, 30 was accepted with 26 acknowledged because four guessed ids did not exist, and 25, 20, 15, 10 and 5 were accepted in full.
The cap is therefore between 30 and 39 products per connection, and 131 products need five connections.

The cost of keeping a book from deltas was measured separately: a sorted array of `[price, size]` with binary search and `splice`, prices on a tick grid so the book stays near its size, 300,000 updates.

| book size | per update |
|---|---:|
| 50 levels, bybit | 0.19 µs |
| 400 levels, okx | 0.34 µs |
| 800 levels, coinbase BTC | 0.27 µs |
| 2,700 levels, kraken BTC | 4.03 µs |

At the delta rates above that is about 5 ms of work per second for the whole universe, so maintaining books costs nothing next to parsing them.
Copying the top twenty into the block is 0.02 to 0.04 µs.

## 2c. What the traffic scales with

Three measurements bound the traffic a depth stream would really cost.

Compression is already on.
The `ws` client the feeds use offers `permessage-deflate` by default, and four venues accept it.
Wire bytes were read from the TLS socket and compared with decoded bytes over eight seconds on two liquid instruments.

| venue and channel | negotiated | wire bytes over decoded bytes |
|---|---|---:|
| binance `bookTicker` | permessage-deflate | 0.70 |
| binance `depth20@100ms` | permessage-deflate | 0.34 |
| bybit `orderbook.1` | permessage-deflate | 0.76 |
| bybit `orderbook.50` | permessage-deflate | 0.64 |
| okx `bbo-tbt` | permessage-deflate | 1.02 |
| okx `books` | permessage-deflate | 0.37 |
| krakenfutures `book` | none | 1.01 |
| coinbase `level2` | permessage-deflate | 0.20 |

So the 4.7 MB a second of decoded depth in 2b is about 2.6 MB a second on the wire, about 225 GB a day, and kraken is the one venue that sends every byte uncompressed.
The `JSON.parse` figures in 2b are unaffected, because parsing runs on decoded text.

Episodes are few at any moment.
Over the third run's 745 episodes, the number open at the same instant, computed from every open and close event:

| | max | p50 | p90 | p99 |
|---|---:|---:|---:|---:|
| all episodes | 11 | 5 | 8 | 10 |
| episodes at least one second old | 10 | 5 | 7 | |

So a depth stream that follows open episodes carries at most about 22 legs at once and usually about 10.

The legs that ever mattered are a small set.
Across 2 hours 46 minutes, 250 distinct markets appeared as a leg of some episode: 82 on bybit, 79 on binance, 45 on okx, 24 on krakenfutures and 20 on coinbase.
That is 12 percent of the 2,107 markets the feeds stream, and the set is what a watchlist subscription would carry.

## 3. Rate limits and shapes from the official documentation

The probe cannot measure a limit, so a separate documentation pass read the official pages on 2026-09-06 and this section records what it found.
Where a figure is marked not found, the pass looked and the current documentation does not publish it, and the design treats the row as a comment in the fetcher and not as a cap it enforces.
The one figure the probe saw on the wire is binance's `x-mbx-used-weight-1m` header, which read 2 on one response and 4 on a concurrent sibling, consistent with the documented weight of 2 per `limit=20` request without being an isolated measurement of it.

| venue | book endpoint limit | window and penalty | rate header | depth parameter | source |
|---|---|---|---|---|---|
| binance USD-M and COIN-M | weight 2 at `limit` 5 to 50, 5 at 100, 10 at 500, 20 at 1,000 | 2,400 weight per minute per IP, 429 then a 418 IP ban of 2 minutes to 3 days on repeats | `X-MBX-USED-WEIGHT-1M` on every response | `limit` in 5, 10, 20, 50, 100, 500, 1000, default 500 | developers.binance.com, derivatives Order Book and General Info pages |
| bybit | no per endpoint weight published for market endpoints | 600 requests per 5 seconds per IP, 403 "access too frequent" and a 10 minute ban above it | `X-Bapi-Limit` family documented for UID limits, absent on public responses in the probe | `limit` 1 to 1,000 for linear and inverse, default 25 | bybit-exchange.github.io/docs/v5/market/orderbook and /v5/rate-limit |
| okx | 40 requests per 2 seconds per IP | the endpoint answers from a server side cache refreshed every 50 ms | not found | `sz` up to 400, default 1 | okx.com/docs-v5, Get order book |
| krakenfutures | public endpoints "do not have a cost and therefore do not count against any rate limiting budget" | per IP window for public endpoints not found, authenticated `/derivatives` endpoints spend 500 per 10 seconds | not found | none, "the entire non-cumulative order book" | docs.kraken.com futures Get orderbook and futures rate limits guide |
| coinbase | not found in the current documentation, the old REST rate limits page redirects | "Public responses are cached for 1 second" | not found | `limit`, maximum not found, omitting it returned 1,000 per side | docs.cdp.coinbase.com Advanced Trade public product book and the OpenAPI spec |

Shape claims the pass confirmed against the probe:

- Bybit documents `b` as price descending and `a` as ascending, `u` as always in sequence, `cts` as the matching engine time, and the response as "the snapshot format".
- Okx documents the tuple as price, quantity, a deprecated field fixed at `"0"`, and the order count, and derivative quantity in contracts.
- Kraken documents bids "sorted descending by bid price", which the wire contradicted in 1c.
- Coinbase documents `pricebook.time` as RFC 3339 and the endpoint as public with an empty security list.

WebSocket facts the pass confirmed:

- Binance partial depth takes levels 5, 10 or 20 at 100, 250 or 500 ms, and the payload carries `e`, `E`, `T`, `s`, `U`, `u`, `pu`, `b`, `a`, with `ps` and `st` after the COIN-M migration.
  The documentation has no sentence that says each message replaces the top levels, and the probe's twenty entries on every message is the evidence for that.
- Okx `books5` pushes a five level snapshot on subscribe and again every 100 ms when the five levels change, with no `action` field.
- Bybit linear depths are 1, 50, 200 and 1,000, level 1 is snapshot only, and every other depth is a snapshot then deltas, with `u` equal to 1 as the restart signal.
- Kraken `book` has no depth parameter, and the pass saw a `book_snapshot` of 1,708 bids and 1,021 asks against a REST book of 1,705 and 1,023 seconds earlier.
- Coinbase `level2` has no depth parameter, and a spot `BTC-USD` snapshot carried 44,275 updates, while WebSocket connections and unauthenticated messages are limited to 8 per second per IP.

## 4. What this settles

- A twenty level REST snapshot is 100 to 250 ms away on a warm connection from every venue, and 230 to 450 ms cold, with binance COIN-M as the one slow outlier.
- Two legs fetched in parallel land together in the time of the slower one, so an episode's snapshot pair is about a quarter of a second after it is asked for.
- Five parsers are needed and each is a few lines, but two of them have a trap: kraken's bids arrive in the opposite order from its documentation, and coinbase's one second edge cache ignores the bypass header its documentation names.
- Okx allows 40 book requests per 2 seconds per IP and bybit bans an IP for ten minutes above 600 per 5 seconds, so a burst of requests has to be spaced per venue and not merely capped.
- A stream is not a shortcut to depth on four of the five venues, because it means maintaining a book from deltas, and the design keeps that as a later option for binance alone.
- One Node process keeps up with depth streams for every market: about a tenth of a core in `JSON.parse`, about 5 ms a second applying deltas, and an event loop that did not move.
  The costs are elsewhere: about 225 GB a day on the wire even with the compression that is already negotiated, four delta protocols with four resync rules, and five coinbase connections for its cap of about thirty products.
- Depth for every market is the wrong unit.
  At most 11 episodes were open at once and usually 5, and only 250 of 2,107 markets were ever a leg, so a depth stream that follows open episodes or a watchlist is one to two orders of magnitude cheaper than the whole universe.
- The same maintained book that gives kraken and coinbase depth also gives them a live top of book, which their tickers do not: kraken throttles to one per second and coinbase emits on trades.
