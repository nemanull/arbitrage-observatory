# BitoPro WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:15 and 03:39 UTC on 2026-09-23.

This profile covers the public WebSocket streams of BitoPro (CCXT id `bitopro`), with the order book stream in detail.
BitoPro lists no perpetual, see [`fees.md`](./fees.md) section 3, so this is its spot market.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
The first pass ran at 03:18 (`book`), 03:22 (`errors`), 03:23 (`batch`, 60 s), 03:24 (`session`, 120 s) and 03:26 UTC (`deflate`), and the second pass at 03:33, 03:35, 03:36 (`batch`, 30 s), 03:37 (`session`, 75 s) and 03:38 UTC.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, every pair | base `wss://stream.bitopro.com:443/ws`, S2. Streams at `/ws/v1/pub/order-books/{pair}`, `/ws/v1/pub/tickers/{pair}` and `/ws/v1/pub/trades/{pair}`, each also taking `?pairs=` with a comma list, S1, S3, S4 | 35 handshakes opened in 290 to 460 ms, median 306 ms |
| private | `wss://stream.bitopro.com:443/ws/v1/pub/auth/...`, S6 | not probed |

There is no subscribe message: the URL names the stream and its pairs, and the server starts pushing once the upgrade completes.
One socket carries any mix of pairs, whatever their quote.
All 35 pairs on one `order-books?pairs=` URL of 469 characters delivered on one socket in both `batch` runs.
`stream.bitopro.com` resolved to `15.197.251.122` and `3.33.217.164`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| stream | path | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| order book | `order-books/BTC_USDT:20`, or `order-books?pairs=BTC_USDT:20,ETH_USDT:20` | limit 1, 5, 10, 20, 30 or 50, default 5. "Order book pushed all data every second when updated.", S1 | a whole snapshot of the requested depth in every frame, on a 200 ms grid, recommended |
| ticker | `tickers/BTC_USDT`, or `tickers?pairs=` | "Ticker pushed 24hr rollwing window statistics when updated.", S3 | 1 frame in 10 s on `BTC_USDT` in both runs, and 3 and 2 frames on two pairs. `high24hr` and `low24hr` equalled `lastPrice` in the four ticker frames printed, while REST `tickers/btc_usdt` gave a real range |
| trades | `trades/BTC_USDT`, or `trades?pairs=` | "Trade pushed full data when updated.", S4 | 1 frame in 10 s in both runs, carrying a list of recent trades whose `timestamp` is in seconds |
| best bid and ask | none | | the order book at limit 1 serves |
| mark, index, funding | none | | spot only |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one path per stream kind, pairs in the path or in `pairs`, S1 | one socket served pairs of all three quotes, USDT, TWD and BTC |
| subscribe frame shape | none, the URL is the subscription, S1 | the server ignored three client text frames, `hello`, a JSON subscribe object and `ping`: no reply, no close, no new pair, in both `errors` runs |
| unknown symbol expectation | Not publicly specified | `order-books/NOPE_USDT:20` refuses the upgrade with HTTP 200 and an empty body, so no socket opens. `order-books?pairs=BTC_USDT:20,NOPE_USDT:20` opens and serves `BTC_USDT` only, dropping the unknown pair without a word |
| chunk unit and budget | Not publicly specified | 35 pairs in one URL, every pair delivered |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping with an empty payload every 1,000 ms, 928 to 1,074 ms apart, the first about 1 s after the open |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 120 s on a socket that answered pings. No notice frame exists in the documentation |
| handshake and operation rate limits | Not publicly specified for the socket. REST allows 600 requests per minute per IP, S2 | no refusal of a well formed URL over the 35 handshakes that opened, up to three opened at once in `session` |
| public market data authentication | none | none |
| message parse and routing | one JSON object per frame with `event` and `pair`, S1 | every frame was one JSON text object for one pair. Route on `event` (`ORDER_BOOK`, `TICKER`, `TRADE`), then on `pair` |
| subscribe acknowledgement shape | none | none. The first book frame arrived 1 to 3 ms after the open event |
| symbol identifier format | "Uppercase string literal of a pair", `BTC_TWD`, S1 | frames spell `BTC_USDT`. CCXT `market.id` and every REST call spell `btc_usdt`. The socket accepted `order-books/btc_usdt:20` and answered with `"pair":"BTC_USDT"` |
| number representation | `price`, `amount`, `total` strings, `count` integer, S1 | as documented, plus `limit` and `scale` as integers |
| timestamp representation | `timestamp` Unix ms and `datetime` "ISO8601 datetime string with milliseconds", S1 | `timestamp` is UTC ms, and the frame arrived 45 to 168 ms after it, median 47 to 51 ms. `datetime` is Taiwan time, UTC+8, written with a `Z` suffix, 8 hours ahead of `timestamp` on every frame |
| size unit | Not publicly specified | base currency, CCXT `contractSize` is undefined, section 4 |
| sequence semantics | none documented | no sequence field. `eventID` is a random UUID, never repeated. Every frame is a whole snapshot |
| idle repeat behaviour | "pushed all data every second when updated", S1 | frames identical to the previous one do come: 4 to 6 of 62 to 69 `BTC_USDT` frames and 21 to 27 of 40 to 56 `USDT_TWD` frames. A quiet pair went 84 s without a frame |

## 4. The book channel in detail

`order-books` at limit 20 is the channel this profile describes, and every row is about it unless it says otherwise.

### Snapshot on subscribe

Every frame is a snapshot of exactly the requested depth.
The first frame came 1 to 3 ms after the open event in the two `book` runs, and there is nothing else to align it with.
All 35 pairs sent a first frame in both `batch` runs.

### Delta semantics

None.
Each frame replaces the whole book of its pair, which is what CCXT Pro does with `orderbook.reset(snapshot)` at `server/node_modules/ccxt/js/src/pro/bitopro.js` line 120.

### Sequence and gap rule

```text
frame arrives         resetBook with its bids and asks
frame lost            the next frame restores the whole book, no resync needed
no frame for a pair   either the book did not change or the stream stalled, and the socket cannot tell which
```

There is no sequence number, and `eventID` is a UUID that never repeated on any pair.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| socket | best first, descending, on every frame of every run, 0 out of order | best first, ascending, 0 out of order |
| REST `order-book` | descending at every limit | ascending |

### Cadence

The documentation says a pair is pushed "every second when updated".
The wire pushes on a 200 ms grid when the book changed, and sometimes when it did not.

| pair, second `book` run | frames in 60 s | gap between frames | gaps within 25 ms of a multiple of 200 ms |
|---|---:|---|---:|
| `BTC_USDT` | 69 | min 20, median 601, p90 2,199, max 3,002 ms | 67 of 68 |
| `ETH_USDT` | 51 | min 193, median 801, max 3,201 ms | 50 of 50 |
| `USDT_TWD` | 40 | min 133, median 994, max 6,070 ms | 36 of 39 |
| `TON_USDT` | 5 | max 26,582 ms | 4 of 4 |

Over all 35 pairs, 2,083 of 2,275 gaps in the 60 s `batch` run and 753 of 810 in the 30 s rerun sat on the grid.
The first `book` run gave `BTC_USDT` 62 frames with a median gap of 800 ms and a max of 3,001 ms.

### Amounts: exact first, rounded after

The first frame of a pair carries exact amounts, and every later frame rounds each amount to the pair's `amountPrecision` from the REST catalog.
On `BTC_USDT`, `ETH_USDT`, `USDT_TWD` and `TON_USDT` the first frame had amounts with 8 decimals and the later frames at most 4, in the second `book` run, the first to count decimals.
In the `batch` runs every pair with a later frame stayed within its `amountPrecision`, 34 of 34 and 31 of 31, and 28 of 35 first frames were finer than it.
Against the REST book at the same prices, 11 to 13 of 38 to 40 `BTC_USDT` amounts matched exactly, 27 matched once the REST amount was rounded to 4 decimals, and 0 differed otherwise, in the second `book` run.
The rounding is to the nearest unit: `0.00097067` became `0.0010` in the frames quoted in section 6.
No level with a zero amount appeared in the second `book` run or either `batch` run, so what the server does with a level smaller than half a unit is Not verified.

`total` is the running sum of `amount` from the touch.
It is exact in the first frame, on all 35 pairs.
In later frames it is the rounded running sum of the exact amounts, so it can differ from the sum of the rounded amounts in the last decimal: the later frame in section 6 has asks `0.1753`, `0.0010` and `0.0003` with totals `0.1753`, `0.1763` and `0.1765`.

### Level window

Every frame of every pair in the `book` runs held exactly 20 bids and 20 asks.
Limits 30 and 50 held 30 and 50 levels a side.
A limit the server does not know falls back to 5 without an error, see the table below, and CCXT Pro's `watchOrderBook` accepts 100, 500 and 1000 at `server/node_modules/ccxt/js/src/pro/bitopro.js` line 67, which the server would serve as 5.

### Size unit against CCXT `contractSize`

CCXT sets `contractSize` undefined on every BitoPro market at `server/node_modules/ccxt/js/src/bitopro.js` line 484, so the engine would take 1.
The amount is in the base currency: the `BTC_USDT` touch read `0.2169` BTC at `86678.76` USDT, and the REST book carried the same price with the unrounded amount.
So a size multiplier of 1 is right, and only the rounding above differs from the REST book.

### One-sided and empty books

No frame had an empty side in any run, including those of `ETH_BTC`, `TON_USDT` and `BITO_USDT`, the quietest pairs in `batch`.
What the stream sends for an empty side is Not verified.

### Idle repeats

A frame identical to the one before it was sent 373 times in 2,310 frames over 35 pairs in the 60 s `batch` run, and 105 times in 845 frames in the rerun.
A quiet pair sends nothing for long spells: `TON_USDT` went 84 s without a frame in the first `session` run and 21 s in the second, and `BITO_USDT` sent 1 frame in 60 s.

### Unknown, closed and wrong requests

| request | reply | then |
|---|---|---|
| `order-books/NOPE_USDT:20` | the upgrade answered HTTP 200 with an empty body | no socket |
| `order-books` with no pair | HTTP 200, empty body | no socket |
| `nope/BTC_USDT` | HTTP 200, empty body | no socket |
| `order-books?pairs=BTC_USDT:20,NOPE_USDT:20` | 101 | `BTC_USDT` frames only |
| `order-books/btc_usdt:20` | 101 | frames spelled `BTC_USDT` |
| `order-books/BTC_USDT:20,ETH_USDT:20` | 101 | both pairs, so the path also takes a comma list |
| `order-books/BTC_USDT:100` or `:7` | 101 | frames with `"limit":5` and 5 levels a side |
| `order-books/BTC_USDT` | 101 | `"limit":5`, the documented default |
| `order-books/ETH_BTC:20`, one of the quietest pairs in `batch` | 101 | 1 and 3 frames in 5 s, 20 levels a side |
| text frames `hello`, a JSON subscribe, `ping` | nothing | the socket stays open and unchanged |

No pair was under maintenance, since all 35 had `maintain` false, so a paused pair was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | the server sends a protocol ping every 1,000 ms. The `ws` library answers it by default. [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97 counts a ping as traffic |
| silence the server tolerates | Not publicly specified | a socket that never answered a ping was closed 60.0 s after its open, at 60,311 and 60,304 ms from creation after 60 pings, with code 1006 and no close frame, in both `session` runs. Sockets that answered pings stayed open for the whole 120 s and 75 s, whether their pair was busy or quiet |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none on the socket. A status page at `https://status.bitopro.com` answered 200 |
| compression | Not publicly specified | offered permessage-deflate, the server negotiated `permessage-deflate; server_no_context_takeover; client_no_context_takeover`. Without the offer, as the engine opens, every frame arrived as plain text, 0 binary frames |
| handshake | | 290 to 460 ms to open, median 306 ms, over 35 sockets |
| subscription limits | Not publicly specified | 35 pairs on one socket, no cap reached |
| throughput | | all 35 pairs at limit 20: 2,310 frames in 60 s, median 37 and max 65 per second, 110.7 KB per second, 2,876 bytes per frame, `JSON.parse` median 45 µs. The 30 s rerun: 845 frames, median 31 and max 62 per second, 81.2 KB per second, 2,881 bytes per frame, median 42 µs |

## 6. Captured frames

Trimmed, from the second `book` run at 03:33 UTC, three levels a side kept.

Request: the URL is the subscription, and nothing is sent after the handshake.

```text
wss://stream.bitopro.com:443/ws/v1/pub/order-books?pairs=BTC_USDT:20,ETH_USDT:20,USDT_TWD:20,TON_USDT:20
```

First frame of `BTC_USDT`, exact amounts, and a `datetime` 8 hours ahead of `timestamp`.

```json
{"event":"ORDER_BOOK","timestamp":1790134426936,"datetime":"2026-09-23T11:33:46.936Z","eventID":"85eba3f9-5b40-4041-bc80-63c710ed7609","pair":"BTC_USDT","limit":20,"scale":0,"bids":[{"price":"86662.64","amount":"0.2205","count":1,"total":"0.2205"},{"price":"86644.39","amount":"0.6935","count":1,"total":"0.914"},{"price":"86625.00","amount":"0.00212753","count":1,"total":"0.91612753"}],"asks":[{"price":"86714.65","amount":"0.0175","count":1,"total":"0.0175"},{"price":"86799.99","amount":"0.1753","count":1,"total":"0.1928"},{"price":"86800.00","amount":"0.00097067","count":2,"total":"0.19377067"}]}
```

The next frame, 86 ms later, with amounts rounded to 4 decimals.

```json
{"event":"ORDER_BOOK","timestamp":1790134427022,"datetime":"2026-09-23T11:33:47.022Z","eventID":"020159e2-0616-487a-9347-2d8efb55d119","pair":"BTC_USDT","limit":20,"scale":0,"bids":[{"price":"86644.39","amount":"0.6935","count":1,"total":"0.6935"},{"price":"86625.00","amount":"0.0021","count":1,"total":"0.6956"},{"price":"86600.00","amount":"0.0011","count":1,"total":"0.6967"}],"asks":[{"price":"86799.99","amount":"0.1753","count":1,"total":"0.1753"},{"price":"86800.00","amount":"0.0010","count":2,"total":"0.1763"},{"price":"86807.67","amount":"0.0003","count":1,"total":"0.1765"}]}
```

Ticker, whose `high24hr` and `low24hr` equal `lastPrice`.

```json
{"event":"TICKER","timestamp":1790134488210,"datetime":"2026-09-23T11:34:48.210Z","eventID":"b9e154cd-ed34-4ce8-808d-27e3b85d146d","pair":"BTC_USDT","lastPrice":"86715.88","lastPriceUSD":"86549.5121","lastPriceTWD":"2751841","isBuyer":false,"priceChange24hr":"1.34","volume24hr":"37.5239","volume24hrUSD":"3246984.6092","volume24hrTWD":"103237875","high24hr":"86715.88","low24hr":"86715.88"}
```

Trades, from the first run at 03:19 UTC, with `data` cut to two of its entries.

```json
{"event":"TRADE","timestamp":1790133554958,"datetime":"2026-09-23T11:19:14.958Z","eventID":"93dbd33c-2896-45ab-971f-08ea01f01c57","pair":"BTC_USDT","data":[{"timestamp":1790133455,"price":"86553.49","amount":"0.0066","isBuyer":false},{"timestamp":1790133436,"price":"86503.53","amount":"0.0160","isBuyer":true}]}
```

Keepalive: a protocol ping frame with an empty payload every second, which carries no JSON.

Error: `order-books/NOPE_USDT:20` got an HTTP 200 answer to the upgrade with an empty body, which the `ws` library reports as an unexpected response.

## 7. Private channels

Named for a future execution stage, from S6, not probed.
They sit under `wss://stream.bitopro.com:443/ws/v1/pub/auth/` and authenticate with headers on the upgrade, as CCXT Pro builds them at `server/node_modules/ccxt/js/src/pro/bitopro.js` lines 382 to 413.

- `auth/orders`, open orders.
- `auth/orders/histories`, history orders.
- `auth/account-balance`, balances.
- `auth/user-trades`, own trades.

No order entry exists on the socket.

## 8. Recommended feed shape

BitoPro has no perpetual, so the engine has no use for this feed today.
The shape below is what a spot feed would be, as a recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://stream.bitopro.com:443/ws/v1/pub/order-books?pairs=<PAIR>:20,…` with every tracked pair | one socket carried all 35 pairs |
| pairs | only the 15 USDT pairs could join the USD, USDC and USDT family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md). The 19 TWD pairs and `ETH_BTC` stand apart | [`rest.md`](./rest.md) section 2 |
| subscribe frames | none, `getSubscribeFrames` returns an empty list | the URL is the subscription |
| URL hygiene | build the URL from catalog ids only | an unknown pair in the path refuses the upgrade, and in the query it is dropped without a word |
| limit | 20 | the engine holds 20 levels a side, and an unknown limit falls back to 5 silently |
| keepalive | none from the client, answer the server's pings, which `ws` does by default | a client that does not answer is closed at 60 s |
| `maxSilenceMs` | 5,000 | the server pings every second and the feed counts pings as traffic, while a quiet pair can go 84 s without a book frame |
| routing | `pair.toLowerCase()` gives the `rawMarketId` | CCXT and REST spell ids in lowercase, the socket in uppercase |
| every frame | `resetBook` with its bids and asks, then `publish` | whole snapshots, no deltas, no sequence |
| resync | none | nothing can gap, and a lost frame is replaced by the next |
| staleness | not detectable per pair | a silent pair looks the same whether its book is still or its stream stalled |
| sizes | `Number(amount)`, a multiplier of 1 | base currency amounts, rounded to `amountPrecision` after the first frame |
| receive time | stamp on arrival, never from `datetime` | `datetime` is UTC+8 marked as UTC |
| deflate | keep `perMessageDeflate: false` | the server would negotiate it if offered |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitoPro OrderBook Stream | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/ws/public/order_book_stream.md | 2026-09-22 | BitoPro | paths, `pairs` query, limits, default 5, push rule, frame fields, sections 1 to 4 |
| S2 | BitoPro Official Open API Document, README | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/README.md | 2026-09-22 | BitoPro | WebSocket base endpoint, REST rate limit, stream list, sections 1 and 3 |
| S3 | BitoPro Ticker Data Stream | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/ws/public/ticker_stream.md | 2026-09-22 | BitoPro | ticker path and push rule, section 2 |
| S4 | BitoPro Trade Stream | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/ws/public/trade_stream.md | 2026-09-22 | BitoPro | trade path and push rule, section 2 |
| S5 | CCXT Pro 4.5.68 `bitopro.js` | `server/node_modules/ccxt/js/src/pro/bitopro.js` | 2026-09-22 | CCXT | URLs at lines 30 and 31, limit check at line 67, reset on every frame at line 120, private authentication at lines 382 to 413, sections 4 and 7 |
| S6 | BitoPro private stream pages: Open Orders, History Orders, Account Balance, User Trade | https://github.com/bitoex/bitopro-offical-api-docs/tree/master/ws/private | 2026-09-22 | BitoPro | private stream URLs, section 7 |
| P1 | `ws-probe.mjs book`, runs at 03:18 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs) | 2026-09-22 | this host | cadence, level order, amounts, REST compare, ticker and trades, sections 2 to 6 |
| P2 | `ws-probe.mjs errors`, runs at 03:22 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs) | 2026-09-22 | this host | unknown pairs, limits, paths, client text, sections 3 and 4 |
| P3 | `ws-probe.mjs batch`, 60 s at 03:23 and 30 s at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs) | 2026-09-22 | this host | 35 pairs on one socket, throughput, grid, rounding, sections 3 to 5 |
| P4 | `ws-probe.mjs session`, 120 s at 03:24 and 75 s at 03:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs) | 2026-09-22 | this host | pings, the 60 s close, quiet pair gaps, section 5 |
| P5 | `ws-probe.mjs deflate`, runs at 03:26 and 03:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs) | 2026-09-22 | this host | negotiated extension, section 5 |
