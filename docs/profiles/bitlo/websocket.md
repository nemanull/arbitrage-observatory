# Bitlo WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:24 to 03:53 UTC, from the development host near Seattle.

Bitlo lists no perpetual, so this profile covers the public spot WebSocket, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The socket speaks STOMP 1.2 over a Spring SockJS endpoint, which no venue in the engine uses today.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs), and the capture is quoted beside the documented value.
The API document gives an endpoint, two channel names and a Java client, and nothing else about the protocol, S1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, raw WebSocket | not documented. The website connects to `wss://api4.bitlo.com/ws/websocket`, S2 | 101 in 707 to 749 ms, subprotocol `v12.stomp` when offered, STOMP `CONNECTED` 158 to 176 ms after open |
| spot, SockJS base | `wss://api4.bitlo.com/ws`, S1 | a WebSocket upgrade answers HTTP 400 with an empty body, W5 |
| spot, SockJS session | `wss://api4.bitlo.com/ws/<server>/<session>/websocket`, the SockJS convention | opens and sends the SockJS open frame `o`, so every STOMP frame would arrive wrapped in SockJS `a[...]` arrays, W5 |
| SockJS info | `https://api4.bitlo.com/ws/info` | `{"entropy":-2060051076,"origins":["*:*"],"cookie_needed":true,"websocket":true}`, and `entropy` changes on every read, P5 |

One socket carries every market, TRY and USDT alike.
`api4.bitlo.com` resolves to Cloudflare addresses, see [`rest.md`](./rest.md) section 1.
The server accepts a client that asks for no subprotocol, which is how [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 opens sockets: `CONNECTED` came back and `/topic/market/*` delivered 102 frames in 5 s, and 74 in the rerun, W7.

## 2. Channel matrix for public market data

| destination | payload | cadence | probed |
|---|---|---|---|
| `/topic/market/<market>` | order book deltas for one market, `{timestamp, market, beginSequenceId, endSequenceId, bids, asks}` | on change | deltas only, recommended as the book channel, section 4 |
| `/topic/market/*` | the same deltas for every market | on change | 57 markets and 167 frames in 15 s, then 76 markets and 375 frames in the rerun, 0 gaps in both, W3 |
| `/topic/market/all` | | | no frame in 15 s in either run, W3 |
| `/topic/ticker/all` | the 378 row bulk ticker of `GET /market/ticker/all` | every 1,002 to 1,003 ms, median of two runs | 101,454 and 101,514 bytes a push, and `bid` and `ask` are `"0.00"` on every row of all 40 pushes counted over two runs, W4 |
| `/topic/ticker/<market>` | one market's last price, 24 h change, high, low, VWAP and volume, no bid and no ask | `BTC-TRY` every 1,903 and 1,812 ms, median of two runs | 377 destinations through `/topic/ticker/*`, `/topic/ticker/all` among them, W3 |
| `/topic/ticker-price` | one asset's `{symbol, price, tryPrice}` per frame | 18 to 1,688 ms apart, median 256 to 295 ms | 42 to 52 frames and 42 to 50 distinct symbols per 20 s over three runs, W4 |
| trades | none public | | the website's `/topic/fill/<id>` and `/topic/state/<id>` are per order, S2 |
| mark, index, funding | none | | spot only |

The API document names only `/topic/ticker` and `/topic/market`, S1.
The other destinations are those the website subscribes, S2.
No channel carries a best bid and ask on its own, so the book channel is the only live touch.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one endpoint, S1 | one socket serves TRY and USDT markets alike |
| subscribe frame shape | STOMP `SUBSCRIBE` with a destination, shown only as Java calls, S1 | `SUBSCRIBE\nid:sub-0\ndestination:/topic/market/BTC-TRY\n\n\0`, one destination per frame, after a STOMP `CONNECT` |
| unknown symbol expectation | Not publicly specified | `/topic/market/NOPE-TRY`, `/topic/market/btc-try`, `/topic/nope` and `/queue/nope` get no `RECEIPT`, no `ERROR` and no frame, and the socket stays open, W5 |
| chunk unit and budget | Not publicly specified | 299 `SUBSCRIBE` frames sent in 4 to 5 ms on one socket, and the 126 and 140 markets that changed in two 45 s runs all delivered, W2 |
| keepalive mechanism | none documented. The Java example keeps its own `lastMessageTime`, S1 | the server answers `heart-beat:0,0` to any offer, sends no WebSocket ping and no STOMP heart-beat, and closes a socket silent in both directions after 60.7 to 61.2 s. A client EOL every 10 s kept a socket open 121 s, and 91 s in the shorter rerun, W6 |
| connection lifetime and maintenance notice | Not publicly specified | none seen, and a socket receiving deltas stayed open 65 s and 73 s until the probe closed it, W1 |
| handshake and operation rate limits | Not publicly specified | no refusal at 299 subscriptions or across about 30 sockets opened over 30 minutes |
| public market data authentication | "publicly available and does not require authentication", S1 | none |
| message parse and routing | STOMP frames with a JSON body and a `content-type` header, S1 | one STOMP `MESSAGE` per WebSocket text message, routed by the `destination` header or by `market` in the body |
| subscribe acknowledgement shape | Not publicly specified | none. A `receipt` header on `SUBSCRIBE` is never answered, W1 and W5 |
| symbol identifier format | `BTC-TRY`, S1 | identical to the catalog `code` and the REST `market` parameter, and case sensitive |
| number representation | not documented for the socket | price and size as decimal strings, `[["4228509.00","0.00000000"]]`, and sequence ids and `timestamp` as JSON numbers |
| timestamp representation | not documented | `timestamp` in Unix ms, 77 to 102 ms before arrival at this host, with the clocks 0.5 to 15.5 ms apart, W1 |
| size unit | not documented | base asset units, the same as the REST book, section 4 |
| sequence semantics | not documented | per market. `beginSequenceId` equals the previous `endSequenceId` plus one, and the first delta after a REST snapshot starts at its `sequenceId` plus one, W1 |
| idle repeat behaviour | not documented | nothing is repeated, and a quiet market sends nothing: `BTC-TRY` went 41.5 s and `ETH-TRY` 48.4 s without a frame, W1 |

## 4. The book channel in detail

`/topic/market/<market>` is the only book channel, and every row below is about it.

### Snapshot on subscribe

There is none.
The first frame for each of five markets was a delta, 15.8 to 48.2 s after the subscribe in the first run and 2.9 to 38.3 s in the rerun, W1.
A feed must seed each book from `GET https://api4.bitlo.com/market/orderbook?market=<market>`, which returns 50 levels per side and a `sequenceId`, see [`rest.md`](./rest.md) section 5.
No book feed in the engine seeds from REST today.

### Delta semantics

A frame carries `bids` and `asks` arrays of `[price, size]` string pairs, and the size is the new absolute size at that price.
A size of `"0.00000000"` deletes the level.
Every frame carried one sequence id, with `beginSequenceId` equal to `endSequenceId`, in both runs of five markets and in the whole catalog rerun, W1 and W2.
Every frame changed one level, except one `BTC-TRY` frame of the rerun, which changed two levels under one id.
All 625 frames of the whole catalog rerun changed one level, W2.

### Sequence and gap rule

```text
seed from REST          book = snapshot, last = sequenceId
endSequenceId <= last   drop, the snapshot already holds it
beginSequenceId = last + 1   apply, last = endSequenceId
beginSequenceId > last + 1   gap: reseed from REST, or terminate the socket and resubscribe
```

The rule held on every frame of both runs: 0 gaps over five markets in 60 s, 0 over 299 markets in 45 s, and 0 over the wildcard in 15 s, W1, W2 and W3.
The first delta applied after each REST seed had `beginSequenceId` equal to the seed's `sequenceId` plus one on all five markets in both runs.
Deltas that arrive before the REST reply must be buffered and replayed through the same rule.
In the rerun two `ETH-TRY` deltas arrived before its seed and were dropped by the second line, since the seed already held them.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| REST snapshot | best first, descending, 0 violations on five markets | best first, ascending, 0 violations |
| socket delta | one level per frame, except one two level frame that broke no order, W1 and W2 | same |

A feed applies deltas by price and never by position.

### Size unit

Sizes are base asset units on the socket and in REST: `BTC-TRY` levels read `"0.13641900"` BTC.
After seeding from REST and applying every delta for 60 s, the local book equalled a fresh REST book at the same `sequenceId` on the top 20 levels of both sides, or every level of a thinner side, on all five markets, in both runs, W1.
There is no CCXT class, so no `contractSize` exists to compare, and a spot market would carry 1.

### Level window

The REST seed holds 50 levels per side, and the socket sends changes only.
After 60 s of deltas the local `BTC-TRY` book held 50 bids and 50 asks in the first run, and 51 bids and 49 asks in the rerun, while REST always returned 50 and 50.
So a level that sat below the seed's 50th and never changed does not arrive when a level above it goes, and a level pushed below the window stays in the local book.
The top 20 still matched in every case, which is the depth the engine holds.

### One-sided and empty books

`USDT-TRY` held 23 bids and 21 asks, and `CHR-TRY` 16 or 17 bids and 26 or 27 asks, W1.
80 of 378 rows of the REST bulk ticker had no bid or no ask: the 77 disabled markets, `AI-TRY` and `BEAM-TRY`, which are not in the catalog, and the trading market `CROF-TRY` with an ask and no bid, see [`rest.md`](./rest.md) section 2.
No delta that empties a side was captured, so its shape is Not verified.

### Idle repeats

Nothing is repeated, and a quiet market is silent.
Over 45 s on all 299 trading markets, 126 delivered at least one frame in the first run and 140 in the rerun.
The socket as a whole went at most 940 ms without a frame in the rerun, at 03:49 UTC, W2.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `/topic/market/NOPE-TRY` | nothing | nothing in 10 s |
| `/topic/market/btc-try` | nothing | nothing in 10 s |
| `/topic/nope`, `/queue/nope` | nothing | nothing |
| `SUBSCRIBE` without `id` | nothing | socket stays open |
| two `SUBSCRIBE` of one destination with two ids | nothing | both deliver every frame, 55 each in 10 s, and 132 each in the rerun |
| text that is not STOMP | nothing | socket stays open and keeps delivering, 62 and 110 frames in the next 5 s |
| `SUBSCRIBE` before `CONNECT` | nothing | no frame and no close in 2.5 s |

A disabled market was not probed on the socket.
Because the server acknowledges nothing, a feed has to notice an unserved market on its own, for instance by its REST seed returning an empty body, see [`rest.md`](./rest.md) section 6.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | STOMP `heart-beat:0,0` from the server whether the client offers `0,0` or `10000,10000`. No WebSocket ping in any run. A lone EOL from the client is legal STOMP, and the server ignores it without an answer, W6 |
| silence the server tolerates | Not publicly specified | a socket with no client frame closed with 1006 and no close frame at 60.84 and 60.75 s with no `CONNECT`, 60.74 and 60.77 s after `CONNECT` alone, and 60.93 and 61.20 s subscribed to the quiet `LIT-TRY`. The socket that sent an EOL every 10 s was open at 121 s, and at 91 s when the rerun ended, W6. Server frames also count, since a socket receiving deltas lived 65 s and 73 s with no client frame after the subscribe, W1 |
| forced disconnect | Not publicly specified | none |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text frames only. Offered permessage-deflate, the server negotiates `permessage-deflate;client_max_window_bits=15`, and without the offer it sends plain text, W7 |
| handshake | | 707 to 749 ms to open, `CONNECTED` 866 to 970 ms after the socket was created |
| subscription limits | Not publicly specified | 299 destinations on one socket, no refusal |
| throughput | | 299 markets for 45 s: median 12 and 13 frames per second, p90 35 and 21, peak 44 and 36, about 2.1 KB of JSON a second, and 12.5 and 13.7 µs of `JSON.parse` per frame, in two runs, W2 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
STOMP separates headers with newlines and ends a frame with a NUL byte, written here as `\n` and `\0`.

Connect, and the server's answer.

```text
CONNECT\naccept-version:1.1,1.2\nheart-beat:10000,10000\nhost:api4.bitlo.com\n\n\0
CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0
```

Subscribe.

```text
SUBSCRIBE\nid:sub-0\ndestination:/topic/market/BTC-TRY\n\n\0
```

Delta, a level removed and a level set.

```text
MESSAGE\ndestination:/topic/market/BTC-TRY\ncontent-type:application/json\nsubscription:sub-0\nmessage-id:cac104b3-7ba8-2589-ca38-58c277a3e474-97914708\ncontent-length:159\n\n{"timestamp":1790133849034,"market":"BTC-TRY","beginSequenceId":100000018675703,"endSequenceId":100000018675703,"bids":[],"asks":[["4228509.00","0.00000000"]]}\0
```

```json
{"timestamp":1790133854540,"market":"BTC-TRY","beginSequenceId":100000018675706,"endSequenceId":100000018675706,"bids":[],"asks":[["4229304.00","0.01676300"]]}
```

Per market ticker, which has no bid or ask.

```json
{"marketCode":"BTC-TRY","currentQuote":"4224309.00","change24h":"56842.00","change24hPercent":"1.3600","highestQuote24h":"4229307.00","lowestQuote24h":"4148976.00","weightedAverage24h":"4195025.99","volume24h":"0.78","notionalVolume24h":"3313123.0470073400"}
```

First row of a `/topic/ticker/all` push, with the zero touch every row carries.

```json
{"marketCode":"BTC-TRY","currentQuote":"4224309.00","change24h":"56842.00","change24hPercent":"1.36","highestQuote24h":"4229307.00","lowestQuote24h":"4148976.00","weightedAverage24h":"4195782.16","volume24h":"0.97647279","notionalVolume24h":"4097067.11","ask":"0.00","bid":"0.00"}
```

Reference price, two frames.

```json
{"symbol":"JUP","price":"0.3","tryPrice":"14.77"}
```

```json
{"symbol":"BTC","price":"86820","tryPrice":"4230739"}
```

Keepalive and errors have no frame to show, since the server sends neither.

## 7. Private channels

Named for a future execution stage, from the website bundle, S2, not probed.

- `/topic/state/<id>`, `/topic/fill/<id>`, `/topic/notification` and `/topic/feed` on the same endpoint, after a login the public document does not describe.
- Order entry is REST only in the API document: `POST https://api.bitlo.com/market/order` and `POST https://api.bitlo.com/market/cancel`, signed with `x-pubkey`, `x-nonce` and `x-signature`, S1.

## 8. Recommended feed shape

A recommendation for the record, not a decision, since the venue is spot only and does not fit the engine.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://api4.bitlo.com/ws/websocket`, no subprotocol needed | the server speaks STOMP 1.2 without one, W7 |
| handshake | send `CONNECT` with `accept-version:1.2` and `heart-beat:0,0`, subscribe after `CONNECTED` | a `SUBSCRIBE` before `CONNECT` is ignored |
| channel | `/topic/market/<rawMarketId>`, one `SUBSCRIBE` per market | the only book channel |
| markets per connection | every tracked market on one socket, 299 today | 0 gaps in two runs, at a peak of 44 frames per second |
| seed | `GET /market/orderbook?market=<rawMarketId>` after subscribing, buffer deltas until it returns | no snapshot on the socket |
| delta | apply only when `beginSequenceId === last + 1`, drop when `endSequenceId <= last` | 0 gaps observed, and the seed aligns at `sequenceId + 1` |
| resync | on a gap, reseed that market from REST, or terminate the socket and resubscribe everything | the engine's `resync` terminates the socket, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 296, so every market would need a fresh REST seed |
| keepalive | send `"\n"` every 10 s | the server sends no ping and closes a socket silent both ways at 60.7 to 61.2 s, and 10 s is what kept one open |
| `maxSilenceMs` | 60,000 | the server never answers the EOL, so only deltas count as traffic. The whole catalog socket went at most 940 ms without one at 03:49 UTC, and quiet hours were not probed |
| unserved market | log a market whose REST seed body is empty | the socket never refuses a destination |
| receive time | stamp on arrival | `timestamp` runs 77 to 102 ms before arrival from this host |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitlo API Documentation, "WebSocket Feed" | https://docs.bitlo.com/ | 2026-09-22 | Bitlo, Türkiye | endpoint, `/topic/ticker` and `/topic/market`, STOMP over SockJS, no authentication, private REST order calls |
| S2 | website bundle: `socketBaseUrl`, STOMP client settings and destinations | https://www.bitlo.com/resources/bitlo-frontend/chunk-OVZ4F74R.js and chunk-USC7LYYO.js | 2026-09-22 | Bitlo | the `/ws/websocket` URL, `heartbeatIncoming:0`, `heartbeatOutgoing:2e4`, `reconnectDelay:1e3`, `/topic/ticker-price`, private destinations. Chunk names change with each deploy |
| P5 | `rest-probe.mjs limits` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitlo/rest-probe.mjs) | 2026-09-23 | this host | `/ws/info`, section 1 |
| W1 | `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 6 |
| W2 | `ws-probe.mjs batch` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 5 |
| W3 | `ws-probe.mjs wildcard` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | section 2 |
| W4 | `ws-probe.mjs ticker` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | section 2 |
| W5 | `ws-probe.mjs errors` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | sections 1, 3 and 4 |
| W6 | `ws-probe.mjs silence`, held 120 s in the first run and 90 s in the rerun | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 5 |
| W7 | `ws-probe.mjs handshake` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitlo/ws-probe.mjs) | 2026-09-23 | this host | sections 1 and 5 |
