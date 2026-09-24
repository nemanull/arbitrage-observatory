# CoinZoom WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:26 to 04:52 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public spot WebSocket of CoinZoom, because CoinZoom lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs), and the capture is quoted beside the documented value.
The first run of each mode was at 04:30 to 04:36 UTC, the second pass at 04:39 to 04:47 UTC, and a third `deflate` run at 04:51 UTC logged the upgrade headers.
Two short exploratory sockets at 04:26 and 04:27 UTC, from a scratch script that was not kept, only count toward the opens below.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
CoinZoom has no CCXT class, so CCXT Pro has nothing to compare with.

## 1. Endpoints

| use | documented URL | probed |
|---|---|---|
| production, public and private | `wss://api.coinzoom.com/api/v1/public/market/data/stream`, S1 | HTTP 101 on all 14 probe opens, the 11 timed ones in 242 to 361 ms, no refusal |
| testing | `wss://api.stage.coinzoom.com/api/v1/public/market/data/stream`, S1 | not probed |

One socket carries every pair, both quote currencies and every channel.
The batch mode held 29 pairs quoted in USD and USDT on one socket, and the channels mode held the ticker, trades and candles beside each other.
The upgrade reply came through Cloudflare, `server: cloudflare` with `cf-ray` ending in `YVR`, and set a `__cf_bm` cookie and a stray `sec-websocket-location: ws://api.coinzoom.com/api/v1/public/market/data/stream` header, in the third `deflate` run.
The host resolves to Cloudflare addresses, see [`rest.md`](./rest.md) section 1.
These results are from the Canadian VPN exit, and Canada is a country CoinZoom does not serve, see [`fees.md`](./fees.md) section 1.
The socket did not refuse that exit.

## 2. Channel matrix for public market data

| channel | subscribe frame | payload | probed |
|---|---|---|---|
| order book | `{"OrderBookRequest":{"requestId":"BTC/USD","action":"subscribe","symbol":"BTC/USD","aggregate":false,"depth":0}}` | `ob` full book, then `oi` increments, each entry `[id, price, amount]` | snapshot then deltas about every 260 ms, recommended |
| ticker | `{"MarketSummaryRequest":{"action":"subscribe","symbol":"BTC/USD"}}` | `ms`: symbol, open, high, low, mid, volume, best bid, best ask, over a moving 24 h window | 142 and 179 frames in the book runs, median gap 273 and 272 ms, and 77 frames in the channels run |
| trades | `{"TradeSummaryRequest":{"action":"subscribe","symbol":"BTC/USD"}}` | `ts`: symbol, weighted price, summed quantity, time, and a side the documentation does not name | replays the last 60 trades on subscribe, then trades as they happen |
| candles | `{"CandleRequest":{"action":"subscribe","symbol":"BTC/USD","interval":"M1"}}` | `cu`, `i`, and `c` rows of time, open, low, high, close, volume | 15 frames in about 20 s on `M1` |
| mark, index, funding | none | | spot only |

The channel names, frames and payload orders are from S1.
The documentation says a `ts` frame summarises "all trades over a time period of approximately half a second" and is not sent when nothing traded, S1.
In the channels run the 60 replayed trades all arrived within 1 s of the acknowledgement, the oldest from `2026-09-21T19:16:19.163031Z`, with 30 `BUY` and 30 `SELL`.
The ticker's fifth value equalled the midpoint of its best bid and ask on 77 of 77 frames.
The documentation lists `M1`, `M5`, `M15`, `M30`, `H1`, `H2`, `H4`, `D1`, `W1` and `L1` as candle intervals, S1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | 29 pairs across USD and USDT on one socket, section 1 |
| subscribe frame shape | one JSON object keyed by the request type, one `symbol` per frame, S1 | the same, no list form exists, so a pair costs one frame |
| unknown symbol expectation | Not publicly specified | `{"OrderBookResponse":{"requestId":"NOPE/USD","result":"failed"}}`, and the same for `BTC_USD`, `btc/usd` and a missing `symbol` |
| chunk unit and budget | "Streaming Websocket API: 30 RPM", S1 | 29 subscribe frames 2.5 s apart all acknowledged, and two frames sent back to back both acknowledged. A faster rate was not tried |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping every 10 s. A client that does not answer is closed with code 4000 `Pong Timeout` at 35.7 s and 36.2 s |
| connection lifetime and maintenance notice | Not publicly specified. "Our firewalls may block repeated opening and closing of socket connections and may result in an automatic IP ban.", S1 | no forced close in 92.9 s, the longest socket, and no maintenance frame seen |
| handshake and operation rate limits | 30 requests per minute on the streaming API, S1 | 16 opens from 04:26 to 04:51 UTC, 14 by the probe and 2 exploratory, never two at once except the silence pair, with no refusal |
| public market data authentication | "This is unsecured request so the API and secret keys are not needed.", S1 | none |
| message parse and routing | the first key names the message: `ob`, `oi`, `ms`, `ts`, `cu`, S1 | the same, plus `OrderBookResponse`, `MarketSummaryResponse`, `TradeSummaryResponse` and `CandleResponse` for acknowledgements. `ob` and `oi` carry the symbol as their value |
| subscribe acknowledgement shape | Not publicly specified | `{"OrderBookResponse":{"requestId":"BTC/USD","result":"subscribed"}}`, where `requestId` echoes the request and is absent when the request had none. The ticker, trades and candle acknowledgements carry `symbol`, and the candle one `interval` too. The acknowledgement arrived before the snapshot on every book stream |
| symbol identifier format | `BTC/USD`, S1 | `BTC/USD`, as the REST `instruments` call spells it, while the REST ticker, summary and book path spell it `BTC_USD`, see [`rest.md`](./rest.md) section 2 |
| number representation | prices and amounts as JSON numbers, ids as strings, S1 | the same, with trailing zeros kept on the wire, as in `63.70` and `10.0` |
| timestamp representation | the examples carry none on `ob`, `oi` and `ms`, and ISO 8601 strings on `ts` and `cu`, S1 | the same. `ts` times carry microseconds for older trades and whole seconds for recent ones |
| size unit | Not publicly specified | base asset units, since the socket amount at the BTC/USD touch, `0.07`, equalled the REST book, section 4 |
| sequence semantics | Not publicly specified, and the examples carry none, S1 | none: no sequence number, no update id, no checksum, no time on any book frame |
| idle repeat behaviour | Not publicly specified | active pairs send a delta about every 260 ms whether or not the book changed, section 4. Quiet pairs send nothing for up to 46 s, or not at all in the window |

## 4. The book channel in detail

`OrderBookRequest` with `aggregate` false and `depth` 0, or with neither key, is the only book request that delivers, and every row below is about it unless it says otherwise.

### Flags

| request | acknowledgement | then |
|---|---|---|
| `aggregate` false, `depth` 0 | `subscribed` | snapshot and deltas, on every pair tried |
| no `aggregate` and no `depth` key | `subscribed` | snapshot and deltas, as above, on ADA/USD |
| `aggregate` true, `depth` 0 | `subscribed` | nothing, on XRP/USD for about 50 s in both runs |
| `aggregate` false, `depth` 10 | none | nothing, on SOL/USD in both runs |
| `aggregate` true, `depth` 20 | none | nothing, on DOGE/USD in the channels run |
| the same pair a second time | `{"OrderBookResponse":{"requestId":"BTC/USD#2","result":"failed"}}` | the first subscription keeps delivering |
| `action` `unsubscribe` | `{"OrderBookResponse":{"requestId":"ETH/USD","result":"unsubscribed"}}` | 0 frames for that pair in the next 10 s, in both runs |

The documentation shows `aggregate` false and `depth` 0 and does not describe other values, S1.
A feed has to send exactly those, because the other values fail silently.

### Snapshot on subscribe

The first frame for each pair is `ob`, a full book of order entries `[id, price, amount]` on `b` for bids and `s` for asks.
Every pair that delivered got exactly one snapshot, and none was repeated: 8 pairs in the first book run and 9 in the second over about 65 s, and 29 pairs over up to 92 s in each batch run.
The snapshot followed the acknowledgement on all 9 streams of the second book run and on the 7 whole ones of the first, by `ws-probe.mjs analyze` over each run's capture.

### Delta semantics

An `oi` frame carries `b` and `s` arrays of entries.
An entry with only an id deletes that order, and an entry with an id, price and amount adds it, S1.
The documentation says a full entry is "an instruction to add it to the book or update it if it is already there", S1.
On the wire no add ever named an id that was live on its side, in 1,435 deltas on nine pairs of the second book run and 1,188 deltas on seven pairs of the first, so every change arrives as a delete and an add.
A side key can be missing: 18 and 21 deltas, all on BTC/USDT, carried only `b` or only `s`.
The counts in this subsection come from `ws-probe.mjs analyze` over the two book captures, P7.

Ids are short integer strings that the server recycles.
The highest id seen per pair was 141 on BTC/USD and 89 on ETH/USD.
In the second book run 11,329 of 23,154 adds reused an id last seen on the other side and 11,619 one last seen on the same side, and the first run gave 9,831 and 10,214 of 20,225.
A feed therefore keys orders by side and id, and applies each delete before it reads a later add of the same id.
Applied that way, no delete named an unknown id on any stream of both book runs and both batch runs, and no id was live on both sides at once in either book run.

Most deltas cancel orders and place them again at the same price and amount with new ids.
In the second book run an add re-placed an order deleted in the same frame at the same price and amount 1,424 times in 2,994 ETH/USD adds, the lowest share, and 1,846 times in 1,873 USDT/USD adds, the highest.
177 of 184 USDT/USD deltas and 137 of 203 BTC/USD deltas left the top 20 aggregated levels unchanged, and on the other six active pairs 1 to 52 of 161 to 210 did.
The first run gave the same picture on the pairs its capture kept whole, with 171 of 179 USDT/USD deltas unchanged.

### Sequence and gap rule

```text
ob                replace both sides
oi                apply deletes and adds per side, in frame order
gap               cannot be detected: there is no sequence, no update id, no checksum and no time
```

The only consistency checks a feed can run are a delete of an unknown id, a crossed book, and a comparison with the `ms` ticker or the REST book.
None fired in the probes.
The book kept from the snapshot and every delta matched the `ms` ticker's best bid and ask on 142 of 142 ticker frames in the first book run and 179 of 179 in the second.
Its top 20 aggregated levels equalled the REST level 2 book read at nearly the same instant, section 5 of [`rest.md`](./rest.md): BTC/USD 20 of 20 bid levels and 15 of 15 ask levels, the whole ask side, and ETH/USD 20 of 20 on both sides, in both runs.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every stream of both book runs | best first, ascending, on every stream |
| delta adds | descending within a frame on every delta of both book runs | ascending within a frame on every delta |
| REST book | descending | ascending |

The order is not documented, so a feed applies entries by id and never by position.

### Level window

The socket carries at most 100 orders per side.
BTC/USD held exactly 100 bid orders, 67 price levels, on the socket, while the REST level 3 book held 214 bid orders and the level 2 book 106 or 107 levels, in both runs.
JGGL/USD, TEKI/USDT, ZOOM/USD and ZOOM/USDT each held exactly 100 asks in the batch runs.
Orders past the window are not sent.
On BTC/USD the 100 orders spanned 67 levels, more than the 20 per side the engine holds, `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 17, read into [`Engine.ts`](../../../server/src/engine/Engine.ts) lines 72 and 73.
On thin pairs the whole book is shorter than 20 levels: TRX/USD held 9 bid orders and 9 asks, and BNB/USD 8 and 7.

### Size unit

| pair | socket amount at the touch | REST amount at the same price | unit |
|---|---|---|---|
| BTC/USD | `0.07` bid, `0.1` ask | `0.07`, `0.1` | BTC |
| ETH/USD | `1` bid, `1` ask | `1`, `1` | ETH |

The amount is in the base asset, which is what a spot market means by size.
There is no contract size to convert.

### One-sided and empty books

USG/USD had no asks on 2026-09-23, and its snapshot sent `"s":[]` with five bids, then no delta in about 40 s.
The REST summary showed the same pair, and USG/USDT, with a null `lowest_ask`, see [`rest.md`](./rest.md) section 3.
So an empty side arrives as an empty array.

### Idle repeats

Active pairs send a delta about every 260 ms, median gap 260 to 272 ms across the eight active pairs of each book run, with the longest gap 327 to 652 ms.
Many of those deltas re-place the same orders, so the book is unchanged, see Delta semantics.
Quiet pairs are the opposite: JGGL/USD went 24.5 s and 46.0 s without a frame in the two batch runs, TEKI/USDT 36.6 s in the first and nothing after its snapshot in the second, and ZOOM/USD, ZOOM/USDT and TBB/USD sent nothing after the snapshot in the second batch run, within windows of about 20 to 90 s after each subscribe.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `NOPE/USD` | `"result":"failed"` | nothing |
| `BTC_USD` | `"result":"failed"` | nothing |
| `btc/usd` | `"result":"failed"` | nothing |
| no `symbol` | `"result":"failed"` | nothing |
| `action` `bogus` on `BTC/USD` | `"result":"unsubscribed"` | nothing |
| `{"FooRequest":{…}}` | no reply | the socket stays open |
| text that is not JSON | no reply | the socket stays open |
| no `requestId` on `DOGE/USD` | `{"OrderBookResponse":{"result":"subscribed"}}` | snapshot and 31 or 32 deltas |

A closed or frozen pair was not available, because every pair read `isFrozen` `"0"`, see [`rest.md`](./rest.md) section 2.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | protocol pings every 10.0 s on every socket, whether subscribed or not. The `ws` library answers them by default |
| silence the server tolerates | Not publicly specified | a socket with no subscription that answered pings stayed open for the full 75 s, in both runs. One that did not answer was closed 10 s after its third unanswered ping, at 35.7 s and 36.2 s, with code 4000 and reason `Pong Timeout` |
| forced disconnect | Not publicly specified | none, longest socket 92.9 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, in both runs |
| handshake | "Our firewalls may block repeated opening and closing of socket connections", S1 | 242 to 361 ms to open over the 11 timed probe opens, and 101 on all 14 |
| subscription limits | 30 requests per minute, S1 | one pair per frame, 29 pairs per socket tested, one subscription per pair per socket |
| throughput | | 29 pairs: 85.0 and 83.2 frames per second, 38.6 and 37.6 KB per second, 474 and 460 bytes per frame, 28.7 and 22.7 µs `JSON.parse` per frame. The book runs, 8 and 9 pairs plus the ticker: 1,561 frames in 64.2 s and 1,636 in 66.5 s, 24.5 and 23.7 µs per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked with a trailing `…` in the text are cut, and the JSON blocks show the kept entries only.

Subscribe and acknowledgement.

```json
{"OrderBookRequest":{"requestId":"BTC/USD","action":"subscribe","symbol":"BTC/USD","aggregate":false,"depth":0}}
```

```json
{"OrderBookResponse":{"requestId":"BTC/USD","result":"subscribed"}}
```

Snapshot, first three orders per side kept out of 40 bids and 23 asks.

```json
{"ob":"ETH/USD","b":[["72",2781.4,1],["6",2781.3,5],["85",2780.97,1]],"s":[["81",2782,1],["66",2782.1,5],["44",2782.32,1]]}
```

Delta, whole: four deletes and four adds per side, where the adds re-place orders at nearby prices.

```json
{"oi":"LTC/USD","b":[["64"],["37"],["52"],["26"],["38",63.71,10.0],["57",63.71,2.0],["61",63.70,100.0],["63",63.70,50.0]],"s":[["45"],["25"],["18"],["1"],["5",63.80,10.0],["68",63.80,50.0],["76",63.80,2.0],["62",63.81,100.0]]}
```

One-sided snapshot, whole.

```json
{"ob":"USG/USD","b":[["1",51.11,0.02],["2",51.1,0.01],["3",51,0.89],["4",50,0.01],["5",1,0.01]],"s":[]}
```

Ticker, whole, where 87138.22 is the midpoint of 87125.65 and 87150.8.

```json
{"ms":["BTC/USD",85554.74,87284.3,85084.24,87138.22,1.924442,87125.65,87150.8]}
```

Trade replay, first of 60, and a candle.

```json
{"ts":["BTC/USD",86076.8,0.000581,"2026-09-21T19:16:19.163031Z","BUY"]}
```

```json
{"cu":"BTC/USD","i":"M1","c":[["2026-09-23T04:46:00Z",87155.88,87147.35,87163,87163,0]]}
```

Other acknowledgements.

```json
{"MarketSummaryResponse":{"symbol":"BTC/USD","result":"subscribed"}}
```

```json
{"CandleResponse":{"symbol":"BTC/USD","interval":"M1","result":"subscribed"}}
```

Errors.

```json
{"OrderBookResponse":{"requestId":"NOPE/USD","result":"failed"}}
```

```json
{"OrderBookResponse":{"requestId":"BTC/USD#2","result":"failed"}}
```

```json
{"OrderBookResponse":{"requestId":"bogus","result":"unsubscribed"}}
```

The pong timeout arrives as a close frame, code 4000, reason `Pong Timeout`, with no JSON message before it.

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- `OrderUpdateRequest` on the same URL, whose subscribe frame carries `apiKey` and `secretKey` in clear inside the JSON, answered by `OrderResponse` and `OrderCancelResponse` messages.
- Orders are placed over REST, `POST /api/v1/public/orders/new`, not over the socket, S1.

## 8. Recommended feed shape

A recommendation for a later spot stage, not a decision.
The engine trades perpetuals, so CoinZoom has no place in it today, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket on `wss://api.coinzoom.com/api/v1/public/market/data/stream` | one URL carries every pair, and the venue warns against repeated opens |
| markets per connection | every tracked pair on one socket, up to the 73 listed | 29 pairs ran on one socket at 83 to 85 frames per second with no anomaly, and 73 pairs is about 2.5 times that |
| subscribe frames | one `{"OrderBookRequest":{"requestId":"<pair>","action":"subscribe","symbol":"<pair>","aggregate":false,"depth":0}}` per pair, with `subscribeGapMs` 2,500 at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 27 | the documented cap is 30 requests per minute, and 24 per minute was accepted. 73 pairs take about 3 minutes to subscribe |
| opens | `connectStaggerMs` of several seconds at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 25, and a long reconnect jitter | the documented IP ban on repeated open and close |
| keepalive | send nothing, and let `ws` answer the protocol ping | the server pings every 10 s and closes a client that does not answer at about 36 s |
| `maxSilenceMs` | 30,000 | a server ping counts as traffic at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97, so three missed pings is a dead socket, and quiet pairs cannot be judged by book frames |
| routing | `msg.ob` or `msg.oi` is the pair, spelled like the instruments `symbol` | section 3 |
| book state | per side, a map of id to `[price, amount]` and a map of price to total amount | the wire carries orders, and the engine's `setBid` and `setAsk` take levels |
| snapshot | on `ob`, rebuild both maps and call `resetBook` with the aggregated levels | full replace semantics, S1 |
| delta | on `oi`, per side in frame order, delete or add by id, then `setBid` or `setAsk` each touched price with its new total, 0 removing it at [`OrderBook.ts`](../../../server/src/feeds/book/OrderBook.ts) line 90, then `publish` | recycled ids cross sides, section 4 |
| resync | `resync` on a delete of an unknown id, an add of a live id, or a crossed book | no sequence or checksum exists, so these are the only detectable breaks |
| unserved stream | log a pair with no snapshot some seconds after its acknowledgement, and never send `aggregate` true or a nonzero `depth` | those are acknowledged or ignored and never deliver |
| receive time | stamp on arrival | no book frame carries a time |
| deflate | keep `perMessageDeflate: false`, as [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 does | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinZoom Public API, Postman documentation, section "Streaming (websocket)" and the rate limit table, collection JSON | https://api-docs.coinzoom.com/ and https://api-docs.coinzoom.com/api/collections/8443211/SW7XbVjM?segregateAuth=true&versionTag=latest | 2026-09-23 UTC | CoinZoom, Inc. | URLs, channel frames and payloads, delete and add semantics, 30 requests per minute, the open and close warning, private channel, sections 1 to 7 |
| P1 | `ws-probe.mjs book`, runs at 04:30 and 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | flags, snapshots, deltas, ids, window, order, ticker and REST agreement, one-sided book, sections 2 to 6 |
| P2 | `ws-probe.mjs errors`, runs at 04:32 and 04:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | unknown and wrong symbols, bad requests, sections 3 and 4 |
| P3 | `ws-probe.mjs silence`, runs at 04:32 and 04:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | server ping, pong timeout, section 5 |
| P4 | `ws-probe.mjs batch`, runs at 04:33 and 04:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | 29 pairs on one socket, window, quiet pairs, throughput, sections 3 to 5 |
| P5 | `ws-probe.mjs deflate`, runs at 04:35, 04:44 and 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | compression and the upgrade headers, sections 1 and 5 |
| P6 | `ws-probe.mjs channels`, one run at 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | ticker, trade replay, candles, the aggregated book with a depth, sections 2 to 4 |
| P7 | `ws-probe.mjs analyze`, offline over the frames P1 kept, where the first run's capture cut the BTC/USD snapshot | [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs) | 2026-09-23 UTC | this host | snapshot order, id reuse, re-placed orders, unchanged levels, one-sided deltas, section 4 |
