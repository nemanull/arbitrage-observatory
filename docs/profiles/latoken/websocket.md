# LATOKEN WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, from the development host near Seattle, between 04:22 and 04:31 UTC on 2026-09-23, and again between 04:39 and 04:46 UTC in the second pass, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public spot WebSocket of LATOKEN (CCXT id `latoken`), because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
The socket speaks STOMP 1.2 over WebSocket, not JSON frames, and that shapes most rows below.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Canada is on LATOKEN's list of restricted countries, and this host's Canadian VPN exit was still served on every socket, see [`fees.md`](./fees.md) section 1.
CCXT 4.5.68 ships no Pro class for LATOKEN, since `server/node_modules/ccxt/js/src/pro/latoken.js` does not exist.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, every public and private channel | `wss://api.latoken.com/stomp`, S1 | 101 through Cloudflare, open in 455 to 580 ms, STOMP `CONNECTED` 648 to 778 ms after the socket was created |
| perpetuals, futures, options | none | none exist |

One socket carries every pair and every channel.
The destination in each `SUBSCRIBE` frame selects the pair and the channel.
The server names itself `vertx-stomp/3.9.6` in the `CONNECTED` frame.

## 2. Channel matrix for public market data

| destination | payload | depth and speed | probed on 2026-09-23 UTC, 15 s per channel, two runs |
|---|---|---|---|
| `/v1/book/{baseId}/{quoteId}` | `{ask, bid}` of `{price, quantityChange, costChange, quantity, cost}` | a snapshot of up to 100 levels per side, then every change, with no depth or speed parameter | recommended, section 4 |
| `/v1/trade/{baseId}/{quoteId}` | trade rows | on trade | 33 and 21 frames on ETH/USDT, the first carrying 100 past trades |
| `/v1/ticker` | every pair's `{baseCurrency, quoteCurrency, volume24h, volume7d, change24h, change7d, lastPrice, updateTimestamp}` | on change | 8 frames in each run, 920,786 and 918,540 bytes, up to 2,825 rows in a frame |
| `/v1/ticker/{baseId}/{quoteId}` | one pair's ticker, same fields | on change | 8 and 7 frames on ETH/USDT |
| `/v1/rate/{baseId}/{quoteId}` | `{symbol, rate}` | on change | 6 frames in each run on ETH/USDT, `"rate":2781.63` and `2782.38` |
| `/v1/rate/{quote}` | documented as rates for one quote | | `/v1/rate/USDT` sent one frame with no `payload` key and nothing after, in both runs |
| `/v1/pair` | the pair catalog | on change | 7 and 4 frames, 592,894 and 591,679 bytes, up to 1,246 rows |
| `/v1/currency` | the currency catalog | on change | 1 frame in each run, 1,296,020 bytes, 5,073 rows |

The destinations and field lists are from S1, and the counts are P5.
No best bid and ask channel exists, and the ticker channels carry no bid or ask, unlike the REST ticker.
No mark, index or funding channel exists, since there is no derivative.
The `rate` stream is a reference price whose formula is Not publicly specified, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL carries every pair and channel |
| subscribe frame shape | STOMP `SUBSCRIBE` with `destination`, `id` and `ack:auto`, one destination per frame, in the Python example of S1 | `SUBSCRIBE\nid:0\ndestination:/v1/book/<baseId>/<quoteId>\nack:auto\n\n\0`, one frame per destination. A frame sent before any `CONNECT` was also served, in four runs |
| unknown symbol expectation | "If the authorization process is incorrect or in case of any WebSocket server error, there is no reply data, not even a byte!", S1 | an unknown or tag-form book destination answers one empty snapshot `{"payload":{"ask":[],"bid":[]},"nonce":0,…}` and then nothing. An unknown channel `/v1/nope` answers nothing. No `ERROR` frame for either |
| chunk unit and budget | Not publicly specified | 100 book destinations in 100 frames on one socket, every one served, in two runs |
| keepalive mechanism | not documented beyond the STOMP client in the example of S1 | STOMP heart-beats. The server offers `heart-beat:1000,1000` and closes a client that asked for heart-beats and sends none, section 5 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in the longest sockets, about 67 s and 75 s, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 100 subscribe frames sent in one burst |
| public market data authentication | none for channels without `{user}`, S1 | none, and `CONNECT` itself was not required |
| message parse and routing | STOMP `MESSAGE` with `destination`, `message-id`, `content-length` and `subscription` headers, and a JSON body `{payload, nonce, timestamp}`, S1 | as documented. No WebSocket message held more than one STOMP frame in the 462, 515 and 583 messages of three book runs, and every message was a binary WebSocket frame. Route on the `subscription` header, which echoes the client's `id` |
| subscribe acknowledgement shape | none, since `receipt` is not documented | no receipt. The book snapshot is the only sign a subscription took |
| symbol identifier format | currency ids, `/v1/book/{base}/{quote}` with ids in the example, S1 | `/v1/book/620f2019-…/0c3a106d-…` is ETH/USDT. The tag form `/v1/book/ETH/USDT` gets an empty snapshot and no delta. CCXT `market.id` is the pair id, which the socket does not use, see [`rest.md`](./rest.md) section 2 |
| number representation | prices and sizes as strings, S1 | strings, `"price":"2782.3992"`, `"quantity":"6.68550"`. `nonce` and `timestamp` are JSON numbers |
| timestamp representation | `timestamp`, unit not stated | integer ms. On the busy book pairs of three runs a delta arrived 90 to 94 ms after its `timestamp` at the least and 96 to 102 ms at the median, and a snapshot 260 to 667 ms after. On the 100 pair batch the median was 107 and 105 ms, the p90 239 and 152 ms, and the max 1,874 and 946 ms |
| size unit | `quantity` | base currency, the same unit as the REST book `quantity` and as CCXT's spot amount, section 4 |
| sequence semantics | the example keeps `nonce` per destination from -1 and treats any `nonce` other than the previous plus one as a mismatch that needs an unsubscribe and a resubscribe, S1 | `nonce` 0 on the snapshot and plus one on every later frame. 0 gaps and 0 repeats on 5 pairs over 60 s in three runs, and on 100 pairs over 45 s in two runs |
| idle repeat behaviour | not documented | nothing is repeated. BTC/USDT and LA/USDT sent only the snapshot in each 60 s run, and the socket carried only heart-beats for them |

## 4. The book channel in detail

`/v1/book/{baseId}/{quoteId}` is the only book channel, and every row below is about it.

### Snapshot on subscribe

The first frame for each subscription carries `nonce` 0 and up to 100 levels per side, in the same level shape as a delta, with `quantityChange` equal to `quantity` on every level.
In the three book runs the snapshot came 357 to 785 ms after the subscribe frame, P1.
In the two batch runs it came 360 to 2,518 ms and 389 to 1,390 ms after, with medians of 1,192 and 1,205 ms, P2.
All 100 pairs of each batch got a snapshot, and 96 and 93 of them had at least 20 levels on each side.
ETH/USDT snapshots held 100, 98 and 100 bids against 100 asks, HBAR/USDT 100 and 100 in each run, USDC/USDT 100 bids against 58, 60 and 59 asks, and LA/USDT 67 bids against 100 asks.
A snapshot's `timestamp` was 260 to 667 ms older than its arrival, against about 100 ms for a delta.
An `UNSUBSCRIBE` followed by a `SUBSCRIBE` of the same destination under a new id got a fresh snapshot with `nonce` 0 in three runs, and the old id delivered 0 to 2 frames more after the `UNSUBSCRIBE`, P3.

### Delta semantics

A delta carries only the changed levels.
`quantity` is the new absolute size at that price and `quantityChange` the signed difference, so a feed sets the level to `quantity` and never adds `quantityChange`.
A `quantity` of `"0.00000"` deletes the level.
A delta may name the same price more than once, as consecutive changes in one frame, and the last entry is the level's size.
In the third book run 85 of 287 ETH/USDT deltas, 42 of 242 HBAR/USDT deltas and 17 of 37 USDC/USDT deltas did so, P1.
The delta of `nonce` 3 in section 6 deletes a bid and then sets the same price again.
So a feed applies each side's entries in array order and never sorts or deduplicates them first.
No delta with both arrays empty was seen in 445, 498 and 566 book deltas over three runs.

### Sequence and gap rule

```text
nonce = 0                 snapshot: replace the book, last = 0
nonce = last + 1          apply in array order, last = nonce
nonce ≠ last + 1          gap: unsubscribe and resubscribe the destination (the documented example), or terminate the socket (the engine's resync)
```

The rule held on every frame of every run, with 0 gaps.
The nonce belongs to the subscription, not to the pair, since a resubscribe restarts it at 0.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of every run | best first, ascending, on every snapshot |
| delta | unordered: 55, 29 and 46 ETH/USDT deltas and 66, 50 and 49 HBAR/USDT deltas per 60 s run had bids out of descending order | unordered: 51, 92 and 113 ETH/USDT and 69, 60 and 90 HBAR/USDT |
| REST `/v2/book` | descending | ascending |

The unordered counts include the deltas that repeat a price.
A feed applies deltas by price in array order and never by position.

### Level window

The snapshot stops at 100 levels per side, but deltas cover the whole book.
A book kept from the snapshot and every delta reached 113 bids and 107 asks on ETH/USDT in the first 60 s run, and 109 asks in the second, so levels beyond the first 100 arrive when they change and are never trimmed by the server.
The whole REST book was 107 bids and 133 asks on ETH/USDT, and 146 bids and 157 asks on BTC/USDT, see [`rest.md`](./rest.md) section 5.
A feed that holds 20 levels takes the best 20 after each frame, which is what the engine's `depthLevels` of 20 does, at [`../../../server/src/engine/Engine.ts`](../../../server/src/engine/Engine.ts) line 61.

### Size unit against CCXT

| pair | socket `quantity` at the touch, first run | REST `quantity` at the same price | unit |
|---|---|---|---|
| ETH/USDT | `1.74088` bid at 2787.0306 | `"1.74088"` | ETH |
| HBAR/USDT | `748.83` bid at 0.10061993 | `"748.83"` | HBAR |
| BTC/USDT | `0.03957` bid at 77000 | `"0.0395700"` | BTC |

At the end of each 60 s book run the kept top 20 levels were compared by position with a REST book read a second or so later.
They matched on 20 of 20 levels in 29 of the 30 side comparisons over three runs.
The exception was HBAR/USDT asks in the third run at 0 of 20, which is what a position compare gives when one new level shifts every index, and that cause is an inference, P1.
The unit is the base currency, and CCXT's spot markets have no `contractSize`, which the connector would turn into 1, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) line 175.

### One-sided and empty books

No live pair was one sided in the runs.
An unknown pair, a tag-form destination and an all-zero currency id each answered `{"payload":{"ask":[],"bid":[]},"nonce":0,…}`, so an empty snapshot is how the server says it has nothing, P3.

### Idle repeats

Nothing is repeated.
A quiet pair sends its snapshot and then nothing until a level changes.
BTC/USDT, whose best bid of 77,000 and best ask of 79,000 USDT did not move during any run, sent 1 frame in each 60 s run, and USDC/USDT went 7.9, 4.9 and 5.5 s without a frame.
The socket's own traffic in those gaps is the STOMP heart-beat.

### Unknown, closed and wrong-form destinations

| request | reply | then |
|---|---|---|
| `/v1/book/ETH/USDT`, tags instead of ids | empty snapshot, `nonce` 0 | nothing in 6 s, while the id form delivered 13 to 29 frames in the same 6 s over four runs |
| `/v1/book/00000000-0000-0000-0000-000000000000/<USDT id>` | empty snapshot | nothing |
| `/v1/book/NOPE/USDT` | empty snapshot | nothing |
| `/v1/nope` | nothing | nothing |
| `SUBSCRIBE` with an `id` already in use | `ERROR` with header `message:Invalid subscription` and body `'id' already used by this connection.` | the server closed the socket with 1000 within 9 to 15 ms, three runs |
| a text frame that is not STOMP | nothing | the socket stayed open and kept delivering, three runs. In one of them the next frame on that socket, a reused id that otherwise ends the session, drew no error |
| `SUBSCRIBE` before `CONNECT` | served, the book arrived | normal delivery |

The 15 inactive pairs of `/v2/pair` were not subscribed, so what a closed pair sends is Not verified.
Because an unknown destination answers an empty snapshot rather than an error, the feed has to notice a pair that stays empty on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified beyond STOMP | the server's `CONNECTED` frame says `heart-beat:1000,1000`. With a client `heart-beat:5000,5000` the server sent a bare EOL every 4,859 to 5,208 ms over three runs, and with `10000,10000` every 10 s |
| silence the server tolerates | Not publicly specified | two runs agreed. A client that asked for `10000,10000` and then sent nothing was closed with 1000 at 30.7 and 30.8 s, right after the third server heart-beat. A socket that sent no `CONNECT`, and one that asked for `0,0`, were each closed with 1006 at 60.5 to 60.6 s. A socket that asked for `0,0`, subscribed ETH/USDT and never sent again stayed open for the full 75 s with 308 book frames. A client that sent an EOL every 5 s stayed open for every 60 s book run |
| forced disconnect | Not publicly specified | none seen besides the silence closes |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | none unless offered. A client that offered permessage-deflate got `sec-websocket-extensions: permessage-deflate` back in two runs, and one that did not offer it got no extension, so the engine's `perMessageDeflate: false` gets plain frames |
| handshake | STOMP `CONNECT`, with API key headers only for private channels, S1 | 455 to 580 ms to open, and 193 to 240 ms more to `CONNECTED` |
| subscription limits | Not publicly specified | no cap reached at 100 book destinations on one socket |
| throughput | | the 100 most traded two-sided pairs: 9,165 and 9,416 messages in 45 s, median 215 and 213 per second, peak 544 and 475, 156 and 157 KB per second, 31 and 25 µs per message to parse the frame and apply it to the probe's book |

The 60 s close with 1006 looks like an idle timeout on traffic in either direction, since server book frames alone kept a `0,0` socket open.
That reading is an inference.
A slice of quiet pairs could see no book frame for 60 s, so the feed still needs heart-beats.

## 6. Captured frames

Trimmed, from `ws-probe.mjs frames` at 04:44 UTC and the other modes of 2026-09-23 UTC.
STOMP frames end with a NUL byte, written `\0` here, and bodies are shown after the header block.

Connect, as sent.

```text
CONNECT
accept-version:1.1,1.2
heart-beat:5000,5000
host:api.latoken.com

\0
```

Connected.

```text
CONNECTED
server:vertx-stomp/3.9.6
heart-beat:1000,1000
session:74496e46-ff90-4279-b78f-5c1803ba0b9d
version:1.2

\0
```

Subscribe, as sent.

```text
SUBSCRIBE
id:0
destination:/v1/book/620f2019-33c0-423b-8a9d-cde4d7f8ef7f/0c3a106d-bde3-4c13-a26e-3fd2394529e5
ack:auto

\0
```

Snapshot headers, then the body cut to two levels per side.
The full body held 100 bids and 100 asks in 22,679 bytes.

```text
MESSAGE
destination:/v1/book/620f2019-33c0-423b-8a9d-cde4d7f8ef7f/0c3a106d-bde3-4c13-a26e-3fd2394529e5
message-id:7f205e7f-f447-47eb-9a5c-89c090485523
content-length:22679
subscription:0
```

```json
{"payload":{"ask":[{"price":"2782.3992","quantityChange":"6.68550","costChange":"18601.7298516","quantity":"6.68550","cost":"18601.7298516"},{"price":"2783.3266","quantityChange":"16.16637","costChange":"44996.287646442","quantity":"16.16637","cost":"44996.287646442"}],"bid":[{"price":"2782.1108","quantityChange":"4.00043","costChange":"11129.639507644","quantity":"4.00043","cost":"11129.639507644"},{"price":"2781.6509","quantityChange":"2.03951","costChange":"5673.204827059","quantity":"2.03951","cost":"5673.204827059"}]},"nonce":0,"timestamp":1790138646391}
```

The three deltas that followed it, whole.
The best bid 2782.1108 falls from 4.00043 to 2.87863 and then 1.48850 inside one frame, rises to 4.03511, and is deleted and set again to 2.42741 inside another.

```json
{"payload":{"ask":[{"price":"2789.8184","quantityChange":"16.88408","costChange":"47103.517051072","quantity":"21.96982","cost":"61291.808080688"}],"bid":[{"price":"2782.1108","quantityChange":"-1.12180","costChange":"-3120.97189544","quantity":"2.87863","cost":"8008.667612204"},{"price":"2782.1108","quantityChange":"-1.39013","costChange":"-3867.495686404","quantity":"1.48850","cost":"4141.1719258"}]},"nonce":1,"timestamp":1790138646575}
```

```json
{"payload":{"ask":[],"bid":[{"price":"2782.1108","quantityChange":"2.54661","costChange":"7084.951184388","quantity":"4.03511","cost":"11226.123110188"}]},"nonce":2,"timestamp":1790138646774}
```

```json
{"payload":{"ask":[],"bid":[{"price":"2782.1108","quantityChange":"-4.03511","costChange":"-11226.123110188","quantity":"0.00000","cost":"0.0000"},{"price":"2782.1108","quantityChange":"2.42741","costChange":"6753.323577028","quantity":"2.42741","cost":"6753.323577028"}]},"nonce":3,"timestamp":1790138647026}
```

Empty snapshot for a tag-form destination, from `errors`.

```json
{"payload":{"ask":[],"bid":[]},"nonce":0,"timestamp":1790137727015}
```

Error for a reused subscription id, after which the server closed the socket, from `errors`.

```text
ERROR
destination:/v1/book/620f2019-33c0-423b-8a9d-cde4d7f8ef7f/0c3a106d-bde3-4c13-a26e-3fd2394529e5
ack:auto
content-length:37
content-type:text/plain
id:9
message:Invalid subscription

'id' already used by this connection.\0
```

The heart-beat is a WebSocket message holding only `\n`, and the client answers the same way.

Rate, from `channels`.

```json
{"payload":{"symbol":"620f2019-33c0-423b-8a9d-cde4d7f8ef7f/0c3a106d-bde3-4c13-a26e-3fd2394529e5","rate":2782.38},"nonce":0,"timestamp":1790138630264}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL, a `CONNECT` carrying `X-LA-APIKEY`, `X-LA-SIGNATURE`, `X-LA-DIGEST` and `X-LA-SIGDATA`, and the user id in the destination.

- `/user/{user}/v1/order`, `/user/{user}/v1/account`, `/user/{user}/v1/account/total`, `/user/{user}/v1/transaction`, `/user/{user}/v1/transfer`.
- P2P: `/user/{user}/v2/p2p/merchant/orders/active` and `/v2/p2p/config`, with more P2P destinations in the same document.
- Order entry is REST only, `POST /v2/auth/order/place`, see [`rest.md`](./rest.md) section 9.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only relevant if a spot leg is ever wanted.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://api.latoken.com/stomp`, one plan per slice | one URL serves everything |
| destination and routing key | `/v1/book/<baseId>/<quoteId>`, with `rawMarketId` set to `<baseId>/<quoteId>` rather than CCXT's pair id | the socket spells the pair by currency ids, and CCXT `market.id` is a third id the socket never uses |
| markets per connection | 100 | 100 ran with 0 gaps at a median 213 to 215 messages per second in two runs, and no cap is published |
| subscribe frames | send STOMP text from the feed itself: `CONNECT` with `heart-beat:5000,5000`, then one `SUBSCRIBE` per market with `id` equal to its index in the slice, on `CONNECTED` | `VenueFeed` sends each subscribe frame through `JSON.stringify`, at [`../../../server/src/feeds/book/VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 141 to 161, which would quote a STOMP string, so `getSubscribeFrames` returns an empty list and `startKeepalive` sends the text |
| keepalive | an `\n` every 5,000 ms | a silent client that asked for heart-beats is closed at 30 s, and a socket with no traffic at all at 60 s |
| `maxSilenceMs` | 15,000 | the server heart-beat arrives every 5 s at that setting, and a quiet pair can be silent for minutes, so only the heart-beat can prove the socket alive |
| parse | split each message on `\0`, skip bare EOLs, read the `subscription` header and parse the JSON body | STOMP framing, one frame per message on the wire, binary WebSocket frames |
| snapshot | `nonce === 0`: `resetBook` | the first frame of a subscription is the book |
| delta | apply only when `nonce === last + 1`, set each entry's price to its `quantity` in array order, delete at zero | 0 gaps observed, and one frame can change a price twice |
| resync | a gap, or a delta before a snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path, and the documented unsubscribe and resubscribe is the same thing per destination |
| unserved pair | log a pair whose snapshot is empty on both sides | unknown destinations answer an empty snapshot, not an error |
| duplicate ids | never reuse an `id` on one socket | a reused id ends the session |
| receive time | stamp on arrival | the snapshot's `timestamp` lags arrival by up to 0.7 s |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Latoken Public WebSocket API V1, OpenAPI file behind the documentation page | https://api.latoken.com/doc/ws/swagger.json, rendered at https://api.latoken.com/doc/ws/ | 2026-09-22 | LATOKEN, global | URL, destinations and fields, nonce example, signed channel headers, private channels, sections 1 to 7 |
| S2 | CCXT 4.5.68, `server/node_modules/ccxt/js/src/` | `server/node_modules/ccxt/js/src/latoken.js` | 2026-09-22 | CCXT | no Pro class, market id form, sections 1 and 3 |
| P1 | `ws-probe.mjs book`, five pairs for 60 s, at 04:24, 04:39 and 04:44 UTC, the last with the repeated price count | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | snapshot, deltas, nonce, order, window, REST compare, heart-beats, sections 3 to 5 |
| P2 | `ws-probe.mjs batch`, 100 pairs for 45 s, at 04:25 and 04:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | throughput, snapshot delay and depth, gaps, sections 3 to 5 |
| P3 | `ws-probe.mjs errors`, four runs from 04:27 to 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | unknown destinations, duplicate id, garbage, resubscribe, subscribe before connect, section 4 |
| P4 | `ws-probe.mjs silence` at 04:26 and 04:42 UTC, the second with the subscribed `0,0` socket, and `deflate` at 04:24 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | silence closes and compression, section 5 |
| P5 | `ws-probe.mjs channels` at 04:29 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | other public channels, section 2 |
| P6 | `ws-probe.mjs frames` at 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | captured frames, section 6 |
