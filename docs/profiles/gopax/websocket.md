# GoPax WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:30 to 04:55 UTC), from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare trace `loc=CA`, `colo=SEA`).

This profile covers the public WebSocket API of GoPax, whose markets are KRW spot and a small USDC spot market, with the order book channel in detail.
GoPax lists no perpetual, so the spot book channel is profiled on the same axes, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/gopax/ws-probe.mjs), and the capture is quoted beside the documented value.
The probe ran every mode twice, the second time for the second pass, and both readings are written where they differ.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Every access result here is from the Canadian VPN exit.

## 1. Endpoints

| market | documented URL | probed |
|---|---|---|
| KRW and USDC spot | `wss://wsapi.gopax.co.kr`, S1 | 101 on all 16 opens of the two probe runs without a query string or any API key, open in 732 to 834 ms |

One socket carries every pair of both quote markets.
`ETH-USDC` and the KRW pairs delivered snapshots on the same socket in both runs.
The documentation's examples sign an API key into the URL, and since the changelog entry of 2022-10-25 the public section says "Public APIs don't need authentication. There is no need to set Query String.", S1.
`wsapi.gopax.co.kr` is an AWS load balancer in Seoul, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| request `n` | payload `o` | depth and speed | probed |
|---|---|---|---|
| `SubscribeToOrderBook` | `{"tradingPairName": "BTC-KRW"}`, optional `limit` of 20 or more | the whole book on subscribe, then every change | recommended, section 4 |
| `SubscribeToOrderBook` with `limit` | `{"tradingPairName": "XRP-KRW", "limit": 20}` | a 20 level snapshot, then every change at any depth | 20 bids and 20 asks, then 14 of 107 and 11 of 92 deltas fell outside that window |
| `SubscribeToTradingPair` | `{"tradingPairName": "XRP-KRW"}` | the same snapshot and `OrderBookEvent`, plus `PublicTradeEvent` | a 113,559 byte snapshot and 167 book deltas in 30 s, no trade in that window |
| `SubscribeToTickers` | `{}` | all tickers on subscribe, then `TickerEvent` "in 1 second aggregates" | a 73,403 byte reply with 368 rows, then 2 and 3 events in 30 s, 4,001 to 8,001 ms apart |

The request names are from S1.
No best bid and ask channel, no mark, index or funding channel exists, and no depth-limited channel keeps a window.
`TickerEvent` carries `highestBid` and `lowestAsk`, but only 2 and 3 events came in 30 s while `XRP-KRW` alone sent 167 book deltas, and the `WOORI-KRW` event quoted in section 6 arrived 0.7 s after that pair's last trade.
So the ticker channel cannot stand in for the book.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | KRW and USDC pairs on one socket |
| subscribe frame shape | `{"i": 1, "n": "SubscribeToOrderBook", "o": {"tradingPairName": "BCH-KRW"}}`, `i` "can be omitted", one pair per frame, S1 | one pair per frame, `i` may be a number or a string and is echoed on the reply |
| unknown symbol expectation | error codes listed on the REST page, S2 | `{"result": false, "errCode": 10058, "errData": "NOPE"}` for an unknown asset, 10059 for the delisted `ZEC-KRW`, and 10058 with `errData` `btc` for a lower case pair |
| chunk unit and budget | "A single connection can subscribe to order books for up to 50 market pairs.", S1 | the 51st pair was refused with 10321 `Too many order books are subscribed` in both runs, and 50 frames sent in one burst were all answered |
| keepalive mechanism | the server sends `"primus::ping::<ms>"` every 30 s and the client must send `"primus::pong::<ms>"` within 30 s, S1 | a ping every 30,000 ms, the first 7.3 to 29.2 s after the socket was created on 14 sockets, no protocol level ping |
| connection lifetime and maintenance notice | "Each connection has a maximum age of 24 hours", and a service update may disconnect "without any notice", S1 | no forced close in 100 s, no in-band notice. Maintenance is announced in the REST notices, for example notice 2471, S3 |
| handshake and operation rate limits | 20 concurrent connections per API key, and no more than 20 opens per second, else 429, S1 | no refusal, at most three sockets open at once. The limit for keyless sockets is Not publicly specified |
| public market data authentication | none since 2022-10-25, S1 | none |
| message parse and routing | an object with `i`, `n` and `o` keys | route on `n`, then on `o.tradingPairName` |
| subscribe acknowledgement shape | the reply to a subscribe is the whole book, S1 | the snapshot is the acknowledgement: `n` repeats the request name and `i` echoes the request id. A refusal is `o.result` false with `errCode` and `errData` |
| symbol identifier format | `BCH-KRW` | identical to the REST `name` on the 50 pairs of the batch run and the 6 of the book run, see [`rest.md`](./rest.md) section 2 |
| number representation | JSON numbers | `entryId`, `price`, `volume` and `updatedAt` are all JSON numbers. The REST book sends the id and the time as strings |
| timestamp representation | `updatedAt` "entry last update time" | Unix seconds with a millisecond fraction, `1790138146.302`. Frames carry no envelope time |
| size unit | "entry volume" | base asset units, identical to the REST book size on 20 of 20 levels per side on four pairs in both runs |
| sequence semantics | `entryId` is the "entry update sequence (+1 incremental)", and the update order is "order by updatedAt, entryId", S1 | `entryId` is one counter for the whole exchange, not per pair. All six snapshots taken together carried the same `maxEntryId`, and a pair's consecutive deltas jumped by a median of 2 or 3 on the busy pairs, 130 and 195 on `SAND-KRW`, and up to 315 |
| idle repeat behaviour | not documented | nothing is repeated. `USDT-KRW` and `ETH-USDC` sent no delta in 75 s in either run |

## 4. The book channel in detail

`SubscribeToOrderBook` with no `limit` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The reply to the subscribe frame is the whole book, every resting level on both sides, with `maxEntryId`.
It came 694 to 992 ms after the subscribe frame was sent, over both runs.
`BTC-KRW` held 421 or 422 bids and 565 or 566 asks, `XRP-KRW` 481 or 483 bids and 1,006 or 1,009 asks, and `USDT-KRW` 65 bids and 381 asks.
Through `SubscribeToTradingPair`, which sends the same snapshot, the `XRP-KRW` book was 113,559 bytes and the `USDT-KRW` book 33,762 bytes.
The documentation says "Intermittently, a delta arrives before the response", and advises a new connection or ordering the delta against the response, S1.
No delta arrived before its snapshot in either run.

### Delta semantics

A delta is `OrderBookEvent` with `i` -1 and `ask` and `bid` arrays of entries.
Each entry has `entryId`, `price`, `volume` and `updatedAt`, and it replaces the level at that price.
A `volume` of 0 deletes the level.
Of 408 and 305 deltas on six pairs in the two runs, all but one carried exactly one entry, and that one, on `XRP-KRW` in the first run, carried two.
No delta was empty.

### Sequence and gap rule

`entryId` counts every book change on the exchange, so a pair's own deltas skip the ids of other pairs.
The six snapshots of one run all carried `maxEntryId` 84,553,130 in the first run and 84,563,415 in the second, although each pair's own largest level id was lower.
So a feed cannot detect a lost delta from the ids.

```text
snapshot                              replace the book, keep maxEntryId
delta, entryId > maxEntryId           apply by price, a volume of 0 deletes
delta, entryId ≤ maxEntryId           skip, assumed to be in the snapshot already
gap                                   not detectable, since the id is global
```

The skip rule assumes the snapshot reflects every change up to its `maxEntryId`, which the documentation implies and does not state.
One capture bears on it.
In the first run a `BTC-KRW` delta with `entryId` equal to that snapshot's `maxEntryId` arrived 289 ms after the snapshot, and it deleted the level at 122,770,000.
The largest level id inside that snapshot was 84,552,944, below the deletion's 84,553,130, which fits a snapshot taken after the deletion.
The second run saw no such delta.
The documentation's own rule is to keep, per price, the entry with the larger `(updatedAt, entryId)`, and applying it to every delta of both runs found no entry older than the level it replaced.
A book built from the snapshot and every delta equalled the REST book at level 2 on the top 20 levels of both sides, prices and sizes, on `BTC-KRW`, `USDT-KRW`, `XRP-KRW` and `ETH-KRW` in both runs, read 0.7 to 4.6 s after the socket.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 6 of 6 pairs in both runs | best first, ascending, on 6 of 6 |
| delta | one entry, so no order | one entry |
| REST `book` | descending at all three levels | ascending |

### Level window

There is none.
The unlimited subscription keeps every level, so the kept book grows and shrinks with the market, 14 to 1,009 levels per side on the probed pairs.
With `limit` 20 the snapshot held 20 levels per side, but the channel kept sending changes outside that window, 11 of 92 and 14 of 107 `XRP-KRW` deltas.
A resting level beyond the first 20 is known to the client only once a delta for it arrives, so a limited book loses depth each time a top level is removed, which is an inference that matches the documentation's warning that with a limit "you may find difficulty in maintaining your local order book", S1.
A feed that keeps only 20 levels trims the full book itself.

### Size unit

Sizes are base asset units, and a spot `contractSize` of 1 converts them correctly.
Socket and REST sizes agreed on 20 of 20 levels per side, price and size, on `BTC-KRW`, `USDT-KRW`, `XRP-KRW` and `ETH-KRW` in both runs.
For example the `BTC-KRW` snapshot of the second run held a best bid of 0.0015 at 115,010,000 KRW, and the REST ticker read about 30 s earlier gave the same `bid` and `bidVolume`.
At that price 0.0015 BTC is 172,515 KRW, which is plausible for one order in BTC and not in any other unit.

### One-sided and empty books

No listed pair had an empty side in `/tickers` on either run, see [`rest.md`](./rest.md) section 2.
The thinnest probed book, `SAND-KRW`, held 14 bids and 123 asks with a best bid of 29.5 against a best ask of 49.9.
What the channel sends for an empty side is Not verified, and the engine's `resetBook` accepts one.

### Idle repeats

Nothing is repeated.
A quiet pair sends nothing: `USDT-KRW`, the busiest pair by 24 h volume, and `ETH-USDC` sent no delta in 75 s in either run, and `SAND-KRW` sent 6 in each run.
The socket still carries the ping every 30 s.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `SubscribeToOrderBook` `NOPE-KRW` | `{"i":3,"n":"SubscribeToOrderBook","o":{"result":false,"errCode":10058,"errData":"NOPE"}}` |
| `SubscribeToOrderBook` `ZEC-KRW`, delisted | `errCode` 10059, `errData` `ZEC-KRW` |
| `SubscribeToOrderBook` `btc-krw` | `errCode` 10058, `errData` `btc` |
| `SubscribeToOrderBook` `XRP-KRW` twice | the second answers `errCode` 10325 `Already subscribed`, and the first keeps delivering |
| `SubscribeToOrderBook` with `limit` 10 | `errCode` 10329 `Invalid limit` |
| the 51st pair on one socket | `errCode` 10321 `Too many order books are subscribed` |
| unknown request name `SubscribeToNothing` | `errCode` 10001 `No such endpoint` |
| text that is not JSON | no reply, and the socket stays open |

Every refusal names the request by `i`, so a feed that sets `i` to the pair can log which subscription failed.

## 5. Session

| item | documented, S1 | probed |
|---|---|---|
| keepalive | a primus ping every 30 s, to be answered within 30 s | pings 30,000 ms apart to within 1 ms, the first 7.3 to 29.2 s after the socket was created. The pong is the ping text with `ping` replaced by `pong`, sent as a text frame |
| silence the server tolerates | the connection is dropped when no pong comes within 30 s | a socket that did not answer was closed with code 1000 and an empty reason 30.2 s after the unanswered ping, four times over two runs, at 39.2 to 56.8 s after it was created. A subscribed socket receiving book deltas was closed the same way, so data does not replace the pong. A socket that answered and subscribed nothing stayed open for 100 s |
| forced disconnect | after 24 h, or on a service update without notice | none in 100 s |
| maintenance notice | none in-band | none seen. Scheduled maintenance is announced in the REST notices, for example 2026-06-29 23:30 to 2026-06-30 02:00 KST in notice 2471, S3 |
| compression | not documented | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, twice |
| handshake | | 732 to 834 ms to open from this host |
| subscription limits | 50 order books per connection | confirmed by error 10321 |
| throughput | | the 50 most recently traded pairs on one socket: 335 deltas in 60 s over 17 pairs, then 607 over 14 pairs, 5.6 and 10.1 per second, with `XRP-KRW` 187 and 419 of them. The socket carried 1.29 and 1.33 MB in 60 s, almost all of it the 50 snapshots, which arrived 729 to 1,789 ms after the burst |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays trimmed are named in the sentence before each frame.

Subscribe, one pair per frame, with `i` set to the pair.

```json
{"i": "BTC-KRW", "n": "SubscribeToOrderBook", "o": {"tradingPairName": "BTC-KRW"}}
```

Snapshot, which is also the acknowledgement, cut to the first two of 566 asks and 422 bids.
The best ask is a dust order of 0.00000858 BTC.

```json
{"i":"BTC-KRW","n":"SubscribeToOrderBook","o":{"ask":[{"entryId":84469259,"price":117020000,"volume":0.00000858,"updatedAt":1790130106.866},{"entryId":84469237,"price":117030000,"volume":0.00000858,"updatedAt":1790130104.34}],"bid":[{"entryId":84563015,"price":115010000,"volume":0.0015,"updatedAt":1790138962.965},{"entryId":84563244,"price":115000000,"volume":0.008,"updatedAt":1790138983.5}],"tradingPairName":"BTC-KRW","maxEntryId":84563415}}
```

Delta.

```json
{"i":-1,"n":"OrderBookEvent","o":{"ask":[{"entryId":84564675,"price":2217,"volume":196.50812855,"updatedAt":1790139101.814}],"bid":[],"tradingPairName":"XRP-KRW"}}
```

The deletion that arrived after its snapshot, with `entryId` equal to that snapshot's `maxEntryId` of 84553130.

```json
{"i":-1,"n":"OrderBookEvent","o":{"ask":[{"entryId":84553130,"price":122770000,"volume":0,"updatedAt":1790138146.302}],"bid":[],"tradingPairName":"BTC-KRW"}}
```

Keepalive, a JSON string from the server and the same string with `pong` from the client.

```json
"primus::ping::1790139005374"
```

```json
"primus::pong::1790139005374"
```

Errors.

```json
{"i":4,"n":"SubscribeToOrderBook","o":{"result":false,"errCode":10325,"errData":"Already subscribed"}}
```

```json
{"i":"MVL-KRW","n":"SubscribeToOrderBook","o":{"result":false,"errCode":10321,"errData":"Too many order books are subscribed"}}
```

```json
{"i":6,"n":"SubscribeToNothing","o":{"result":false,"errCode":10001,"errData":"No such endpoint"}}
```

Ticker event, one pair.

```json
{"i":-1,"n":"TickerEvent","o":{"WOORI-KRW":{"lastTraded":1790139116758,"high":267,"low":262,"open":264,"last":264,"lowestAsk":265,"highestBid":264,"baseVolume":60292.8383377,"quoteVolume":15951517.61339619,"tradingPairName":"WOORI-KRW"}}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL with `apiKey`, `timestamp` and `signature` in the query string, and a legacy 36 character key cannot be used.

- `SubscribeToOrders` with `OrderEvent` deltas, `SubscribeToBalances` with `BalanceEvent`, and `SubscribeToTrades` with `TradeEvent`.
- The socket has no order entry, and orders are placed with `POST /orders` over REST, S2.
- The site says a foreign or corporate customer cannot use the API, see [`fees.md`](./fees.md) section 1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
GoPax lists no perpetual and has no CCXT class, so no feed is recommended for the engine as it stands.
If a spot feed is ever built, the shape below follows from the capture.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://wsapi.gopax.co.kr` with no query string | one URL for every pair, no key needed |
| markets per connection | 50, so 3 sockets for all 122 pairs | the documented cap, enforced by error 10321 |
| subscribe frames | one frame per pair, `{"i": "<pair>", "n": "SubscribeToOrderBook", "o": {"tradingPairName": "<pair>"}}` | one pair per request, and `i` names the pair in a refusal |
| keepalive | none sent by the client. `handleMessage` answers each `"primus::ping::<ms>"` text frame with `"primus::pong::<ms>"` | the server pings and closes 30 s after an unanswered ping, even while data flows |
| `maxSilenceMs` | 65,000 | the ping is the only traffic a quiet pair gets, it comes every 30 s, and this tolerates one lost ping |
| routing | `n` then `o.tradingPairName`, which equals `rawMarketId` | |
| snapshot | the reply named `SubscribeToOrderBook`: `resetBook` and store `maxEntryId` | the reply is the whole book |
| delta | `OrderBookEvent`: skip entries with `entryId` at or below the stored `maxEntryId`, then set each level by price | the entry id is global, section 4 |
| depth | keep the full book, hand the engine the best 20 per side, and never subscribe with `limit` | a limited subscription cannot be maintained |
| resync | none can be triggered by a gap, since none is detectable. Reconnect on close, and consider a periodic REST level 2 comparison, at most one book call per second for the whole IP | the id is global and REST allows one book call per second |
| delta before snapshot | buffer it, then apply the rule above once the snapshot arrives | documented race, not observed |
| receive time | stamp on arrival | frames carry no envelope time, and `updatedAt` is per level |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GoPax WebSocket API documentation, English | https://gopax.github.io/wsapi/index.en.html | 2026-09-22 | Streami | URL, authentication, primus ping, 24 h lifetime, connection limits, 50 pair cap, request and event names, snapshot and delta shapes, update order, limit warning, changelog, sections 1 to 8 |
| S2 | GoPax REST API documentation, English | https://gopax.github.io/API/index.en.html | 2026-09-22 | Streami | error codes 10058 and 10059, order entry over REST, sections 3 and 7 |
| S3 | Notice 2471, server upgrade maintenance | https://www.gopax.co.kr/notice/detail?id=2471 | 2026-09-22 | Streami, Korea | maintenance announced in the notices, sections 3 and 5 |
| P1 | `ws-probe.mjs book` at 04:35 and 04:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gopax/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs tickers` at 04:37 and 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gopax/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 and 6 |
| P3 | `ws-probe.mjs batch` at 04:38 and 04:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gopax/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| P4 | `ws-probe.mjs silence` at 04:39 and 04:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gopax/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| P5 | `ws-probe.mjs deflate` at 04:35 and 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gopax/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
