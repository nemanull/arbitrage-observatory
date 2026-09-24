# BTSE WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:27 to 03:47 UTC), from the development host near Seattle.

This profile covers the public futures WebSocket of BTSE for its one perpetual family, with the book channel in detail.
CCXT has no BTSE WebSocket class, since `ts/src/btse.ts` in CCXT master sets `'pro': false`, see [`fees.md`](./fees.md) section 8.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/btse/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| endpoint | documented URL | probed |
|---|---|---|
| futures OSS, book topics only | `wss://ws.btse.com/ws/oss/futures`, S1, S2 | open in 374 to 446 ms over 9 sockets, every perpetual delivers |
| futures main, trades and private topics | `wss://ws.btse.com/ws/futures`, S1 | open in 325 and 353 ms. `tradeHistoryApiV3:BTC-PERP` delivers. `update:BTC-PERP_0` and `snapshotL1:BTC-PERP` sent to it are left out of the acknowledgement and never deliver |
| spot OSS and spot main | `wss://ws.btse.com/ws/oss/spot`, `wss://ws.btse.com/ws/spot`, S1 | not probed |
| testnet | `wss://testws.btse.io/ws/oss/futures`, S1 | not probed |

There is one perpetual family, so one OSS URL carries every perpetual and the four dated futures.
`ws.btse.com` resolved through `ws.btse.com.cdn.cloudflare.net` to four addresses in `3.165.160.0/24` on 2026-09-23.
No socket was refused from this host.

## 2. Channel matrix for public market data

| topic | endpoint | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `update:<symbol>_<grouping>` | OSS | snapshot of up to 50 levels, then deltas, grouping `0` to `8`, S2 | snapshot then deltas, recommended. `BTC-PERP` sent 1,665 and 1,714 frames in two 50 s runs |
| `snapshotL1:<symbol>` | OSS | the whole best bid and ask on each change, no sequence, S2 | 282 and 927 frames in 50 s on `ETH-PERP` |
| `tradeHistoryApiV3:<symbol>` | main | trades | 6 and 2 frames in 15 s on `BTC-PERP`, the first a batch of recent trades |
| mark, index, funding or ticker topic | | none documented, S1 | none exists, so the anchor comes from REST, see [`rest.md`](./rest.md) section 3 |
| `notificationApiV4`, `fillsV2`, `allPositionV4`, `positionsV3` | main | private, S1 | not probed |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | book topics on the OSS URL, everything else on the main URL, S1 | a book topic sent to the main URL is dropped from the acknowledgement and stays silent, section 1 |
| subscribe frame shape | `{"op": "subscribe", "args": ["topic1", "topic2"]}`, S1 | one frame with 111 topics got one acknowledgement listing all 111 |
| unknown symbol expectation | error code 1000 "Market pair not supported", S1 | `update:NOPE-PERP_0` answers `{"severity":"ERROR","errors":[{"arg":"update:NOPE-PERP_0","error":{"code":1000,…}}]}`. The CCXT spelling `update:BTC-PERP-USDT_0` is accepted and served under the other spelling, section 4 |
| chunk unit and budget | "Max subscriptions per connection: 100 topics" and "Max connections per IP: 50", S1 | 111 topics on one socket were all acknowledged and all delivered in three runs, so the 100 topic cap was not enforced |
| keepalive mechanism | client sends plain text `ping` every 15 s and gets `pong`, S1. The legacy page says the server sends a ping frame every 3 minutes, S3 | text `pong` came back in 97 to 108 ms. The server sent one protocol ping, at 41.1 s on a main socket, and none on any OSS socket in 110 s |
| connection lifetime and maintenance notice | "Connections idle for 60 seconds without a ping are dropped", S1. No maintenance message is documented | a socket with no subscription and no ping closed at 60.3 s with 1006. A subscribed socket with no ping stayed open 110 s. No lifetime cap was reached in 110 s |
| handshake and operation rate limits | 50 connections per IP, S1 | no refusal at 5 sockets at once, or at 111 topics in one frame |
| public market data authentication | none | none |
| message parse and routing | `{"topic", "data": {...}}`, S2 | route on `data.symbol`, since the topic of a delta can differ from the topic subscribed, section 4. `pong` is not JSON |
| subscribe acknowledgement shape | `{"event": "subscribe", "channel": [...]}`, S1 | as documented. The channel list comes in a different order from the request, and the first snapshot arrived about 90 ms before the acknowledgement in one run |
| symbol identifier format | `BTC-PERP`, S2 | `BTC-PERP` in `data.symbol` whichever spelling was subscribed. CCXT's `market.id` is `BTC-PERP-USDT`, section 4 |
| number representation | price and size as strings, S2 | strings on every level, with the price keeping its trailing zeros, as `"86626.0"` where the REST book prints `"86626"` |
| timestamp representation | `timestamp` in ms, S2 | integer ms. Arrival minus `timestamp` had a median of 50 to 52 ms on the book in every run |
| size unit | Not publicly specified | contracts, equal to CCXT `contractSize` in coins, section 4 |
| sequence semantics | `seqNum` is one after `prevSeqNum`, and on a break unsubscribe and resubscribe, S2 | 0 gaps on every single-topic run. Across every perpetual, 8 gaps in 37,001 deltas on one run and 0 in 39,634 and 41,423 on the next two, section 4 |
| idle repeat behaviour | not documented | no repeated `seqNum`. A quiet book sends nothing between changes, up to 11.6 s on one topic |

## 4. The book channel in detail

`update:<symbol>_0` on the OSS URL is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each topic is `"type": "snapshot"` with up to 50 bids and 50 asks and a `seqNum`.
All 211 perpetuals sent exactly one snapshot each in all three batch runs, and no second snapshot followed within 45 s.
Subscribing again to a topic the socket already holds is acknowledged and sends a fresh snapshot, and the `seqNum` chain carries on across it.
The documentation's reconnect advice relies on that: "the first message after re-subscribe is always a full `snapshot`", S1.
The snapshot's `timestamp` was 56 to 101 ms before its arrival on nine topics of the second book run, and 628 ms on the quiet `1KCAT-PERP`.

### Delta semantics

A delta carries `bids` and `asks` arrays of `[price, size]` string pairs, `seqNum`, `prevSeqNum`, `type` `delta`, `symbol` and `timestamp`.
A size of `"0"` deletes the level.
Deltas are heavy with deletions: 43,081 zero sizes in 1,663 BTC deltas in one run and 68,830 in 1,712 in the other.
One side of one delta can carry more than 50 entries, as an `ETH-PERP` delta with 63 bids did.
No empty delta was seen.

### Sequence and gap rule

```text
type = snapshot                     replace the book, last = seqNum
type = delta, prevSeqNum = last     apply, last = seqNum
type = delta, prevSeqNum ≠ last     gap: resubscribe the topic (documented), or terminate the socket (the engine's resync)
best bid ≥ best ask after applying  resubscribe (documented)
```

The first delta after every snapshot had `prevSeqNum` equal to the snapshot's `seqNum`, and `seqNum` was always `prevSeqNum + 1`.
The first batch run saw 8 gaps in 20,598 deltas on the 100 busiest perpetuals, on `ETH-PERP`, `SOL-PERP` and `SUI-PERP`.
That probe version kept applying deltas after a gap, so those three books later read crossed 966 times and grew to 99 levels.
The second and third batch runs and every book run saw 0 gaps and 0 crossed books.
The size of the jump in the first run was not recorded, and the probe now logs it.
Each grouping keeps its own chain: `update:BTC-PERP_1` ran near `seqNum` 77,452,397 while `_0` was near 86,555,495.
`update:BTC-PERP` without a grouping is its own topic, and it carries the same `seqNum` values as `_0`.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every topic of every run | worst first, descending, so the best ask is the last element, on every topic of every run |
| delta | unordered: 1,307 of 1,663 and 1,357 of 1,712 BTC deltas had two or more bids out of descending order | unordered: 1,182 of 1,663 and 1,451 of 1,712 BTC deltas had asks in neither ascending nor descending order |
| REST `public-api/market/v1/orderbook` | descending | descending, best last, see [`rest.md`](./rest.md) section 5 |

The documentation says nothing about order, and its example frame lists asks descending too, S2.
A feed applies levels by price and never by position.

### Level window

The server keeps each topic at 50 levels per side.
A book kept from the snapshot and every delta held at most 50 levels per side on every gap-free topic, so a level leaving the window arrives as `"0"`.
A thin book holds fewer: `1KCAT-PERP` snapshotted 50 bids and 15 asks, and 48 bids and 18 asks in the next run.

### Size unit against CCXT `contractSize`

| contract | `contractSize` in the markets reply and in CCXT | socket size at the top bid | REST size at the same price | coins |
|---|---:|---|---|---|
| `BTC-PERP` | 0.00001 | `"141500"`, then `"12850"` in the second run | the same | 1.415 BTC, then 0.1285 BTC |

20 of the 20 top socket bid sizes equalled the REST book at the same prices in both runs, read right after each 50 s run.
The unit is contracts, and one contract is `contractSize` coins, which CCXT copies from the markets reply at `ts/src/btse.ts` line 738 of master.
So the engine's `sizeMul` converts BTSE sizes correctly.
The legacy `market_summary` reports the same `contractSize` for all 211 perpetuals, see [`rest.md`](./rest.md) section 2.

### Symbol spelling

The socket names a perpetual by its `tradeCurrency`, `BTC-PERP`, and CCXT's `market.id` is the markets reply's `symbol`, `BTC-PERP-USDT`.
The server accepts both spellings and folds them into one subscription.
On a fresh socket subscribed only to `update:SOL-PERP-USDT_0`, over 10 s:

| frame | count |
|---|---:|
| acknowledgement listing `update:SOL-PERP-USDT_0` | 1 |
| snapshot on topic `update:SOL-PERP-USDT_0`, `data.symbol` `SOL-PERP` | 1 |
| delta on topic `update:SOL-PERP_0`, `data.symbol` `SOL-PERP` | 259 |

`snapshotL1:XRP-PERP-USDT` behaved the same way: one frame on the subscribed topic, then 175 on `snapshotL1:XRP-PERP`.
Adding `update:SOL-PERP_0` on the same socket sent a new snapshot on that topic, and the deltas went on as one stream, 219 in 8 s.
Unsubscribing `update:SOL-PERP-USDT_0` then stopped the deltas of `update:SOL-PERP_0` as well: 3 arrived in the next 8 s, all in flight.
The book run shows the same fold, since `update:ETH-PERP_0` delivered 253 frames and then stopped when the probe unsubscribed `update:ETH-PERP-USDT_0` 7.4 s after subscribing.

So a feed that subscribes with the CCXT spelling and routes by topic sees a snapshot and then nothing, with no error.
A feed that routes by `data.symbol + '-USDT'` receives every frame whichever spelling it subscribed.
`symbol` equals `tradeCurrency + '-USDT'` on 211 of 211 perpetuals, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

`1KCAT-PERP` held 48 to 50 bids and 15 to 20 asks, the thinnest side seen.
No one-sided or empty book was seen, so what the channel sends for a side with no orders is Not verified.

### Idle repeats

Nothing is repeated on `update`.
A quiet book sends nothing until a level changes, and the longest silence on one topic was 11.6 s, 5.0 s and 3.3 s in the three batch runs.
On `snapshotL1:ETH-PERP` one run saw a 6.9 s silence and a frame whose `timestamp` was 14.4 s old, while `update:ETH-PERP_0` never went more than 225 ms without a frame.
In the other run the oldest L1 frame was 153 ms old.
So the L1 topic can stall where the book topic does not.

### Unknown, closed and malformed requests

| request | reply |
|---|---|
| `update:NOPE-PERP_0` | `{"severity":"ERROR","errors":[{"arg":"update:NOPE-PERP_0","error":{"code":1000,"message":"Market pair provided is currently not supported."}}]}` |
| `foo:BTC-PERP` | code 1005 `Topic provided does not exist.`, in the same error frame as the one above |
| `update:BTC-PERP_9`, grouping out of range | acknowledged, then silent for 45 s |
| `snapshotL1:ETH-PERP_0`, a grouping on L1 | acknowledged and delivered the same frames as `snapshotL1:ETH-PERP`, while S1 and S3 say it answers 1009 |
| `{"op": "nope", ...}` | code 1001 `Operation provided is currently not supported` |
| `hello`, not JSON | code 1002 `Invalid request. Please check again your request and provide all information required.` |
| `{"op": "subscribe"}` with no `args` | no reply |
| `{"op": "unsubscribe", "args": ["update:ETH-PERP-USDT_0"]}` | `{"event":"unsubscribe","channel":["update:ETH-PERP-USDT_0"]}` |

A delisted perpetual was not available to probe, since all 211 were active.
Because a grouping out of range is acknowledged and then stays silent, the feed has to notice a topic with no snapshot on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | text `ping` every 15 s, answer `pong`, S1. Legacy: server ping frame every 3 minutes, client pong within 10 minutes, S3 | `pong` in 97 to 108 ms. One server protocol ping in each silence run on the main socket that sent pings, at 41.1 s in the second, and none on OSS sockets in 110 s |
| silence the server tolerates | 60 s without a ping, S1 | an OSS and a main socket with nothing subscribed and nothing sent closed at 60.34 to 60.35 s, in both runs, with 1006 and no close frame. An OSS socket subscribed to `1KCAT-PERP` with no ping stayed open 110 s in both runs, so book traffic counts as activity |
| forced disconnect | a full outbound buffer closes with 1007, S1 | none in 110 s |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified | text JSON frames when the client offers nothing. A client that offered permessage-deflate got `permessage-deflate;client_max_window_bits=15` on both URLs, so the server negotiates it and does not force it |
| handshake | | 325 to 446 ms to open from this host |
| subscription limits | 100 topics per connection, 50 connections per IP, S1 | 111 topics on one socket all delivered |
| throughput | | all 211 perpetuals over two sockets in three 45 s runs: a mean of 460 to 530 frames per second on the 100 busiest, peak 1,066, and 367 to 395 on the other 111, peak 893. 761 to 838 bytes per frame and 26 to 31 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book levels are cut to the first three per side, and `…` marks a cut array.

Subscribe and acknowledgement.

```json
{"op": "subscribe", "args": ["update:BTC-PERP_0", "update:ETH-PERP_0", "update:1KCAT-PERP_0", "update:SNDK-PERP_0"]}
```

```json
{"event":"subscribe","channel":["update:ETH-PERP_0","snapshotL1:ETH-PERP","update:BTC-PERP-USDT_0","update:BTC-PERP_0","update:SNDK-PERP_0","update:ETH-PERP-USDT_0","snapshotL1:ETH-PERP_0","update:1KCAT-PERP_0"]}
```

Snapshot, first three levels per side of 50 and 50.
The asks shown are the three worst, since asks come worst first.

```json
{"topic":"update:SNDK-PERP_0","data":{"bids":[["1876.90","44"],["1876.89","122"],["1876.87","35"]],"asks":[["1880.19","900"],["1880.00","450"],["1879.70","450"]],"seqNum":8896865,"prevSeqNum":8896864,"type":"snapshot","symbol":"SNDK-PERP","timestamp":1790134937297}}
```

Delta, untrimmed.

```json
{"topic":"update:BTC-PERP_0","data":{"bids":[["86540.6","60672"],["86540.5","4400"]],"asks":[],"seqNum":86511210,"prevSeqNum":86511209,"type":"delta","symbol":"BTC-PERP","timestamp":1790133628076}}
```

Best bid and ask.

```json
{"topic":"snapshotL1:ETH-PERP","data":{"bids":[["2766.67","165900"]],"asks":[["2766.68","2366"]],"type":"snapshotL1","symbol":"ETH-PERP","timestamp":1790134133193}}
```

Keepalive, as plain text in both directions.

```text
ping
pong
```

Errors.

```json
{"severity":"ERROR","errors":[{"arg":"foo:BTC-PERP","error":{"code":1005,"message":"Topic provided does not exist."}},{"arg":"update:NOPE-PERP_0","error":{"code":1000,"message":"Market pair provided is currently not supported."}}]}
```

```json
{"severity":"ERROR","errors":[{"error":{"code":1001,"message":"Operation provided is currently not supported"}}]}
```

Trade on the main URL, first element of a batch.

```json
{"topic":"tradeHistoryApiV3:BTC-PERP","data":[{"price":86641.9,"size":70,"side":"SELL","symbol":"BTC-PERP","tradeId":57971633,"timestamp":1790134428345}]}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the main URL after an `authKeyExpires` login signed with HMAC-SHA384 over the path and a nonce.

- `notificationApiV4`, `fillsV2`, `allPositionV4`, `positionsV3`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.btse.com/ws/oss/futures` | one family, and book topics exist only on the OSS URL |
| channel | `update:<tradeCurrency>_0`, where `tradeCurrency` is `rawMarketId` without `-USDT` | snapshot on subscribe, a strict `seqNum` chain, 50 levels covers the engine's 20, and the topic of every frame then matches the topic subscribed |
| markets per connection | 100 | the documented cap. 111 worked, but 211 perpetuals fit in 3 sockets, so respecting the cap costs little |
| subscribe frames | one frame per slice, `{"op": "subscribe", "args": ["update:BTC-PERP_0", …]}` | a 111 topic frame was acknowledged as one |
| keepalive | text `ping` every 15 s | the documented interval, and an idle socket dies at 60 s |
| `maxSilenceMs` | 45,000 | three missed pongs. A quiet book went 11.6 s without a frame, so the `pong` has to count as traffic |
| routing | `data.symbol + '-USDT'` gives the `rawMarketId` | the socket spells the contract without the quote, and a delta can arrive on the other spelling's topic |
| snapshot | `type === 'snapshot'`: `resetBook` and store `seqNum` | documented replace semantics |
| delta | apply only when `prevSeqNum === last`, then store `seqNum` | documented rule, gaps seen in 1 run out of 3 |
| resync | `prevSeqNum !== last`, a delta before any snapshot, or a crossed book after applying: `resync`, which terminates the socket and resubscribes | the engine's existing path, and the documentation asks for a resubscribe on both conditions |
| one spelling only | never subscribe or unsubscribe the `-USDT` spelling beside the plain one | the two share one subscription, and unsubscribing either stops both |
| unserved topic | log a topic with no snapshot 10 s after its acknowledgement | an out of range grouping is acknowledged and then silent |
| receive time | stamp on arrival, never from `timestamp` | the L1 `timestamp` was 14.4 s old on one frame |
| level order | apply by price | asks arrive worst first in snapshots and unordered in deltas |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTSE WebSocket Guide | https://docs.btse.com/websocket-guide/ | 2026-09-22 | BTSE, global | endpoints, heartbeat, connection limits, subscription format, error codes, private topic names |
| S2 | BTSE Futures WebSocket, Orderbook Incremental Updates and OSS L1 Snapshot | https://docs.btse.com/futures/websocket/orderbook-incremental-updates/ | 2026-09-22 | BTSE, global | topic format, grouping, snapshot then delta, sequence and crossed book rules |
| S3 | BTSE Futures API v2.3 (legacy), WebSocket sections and changelog 1.0.2 | https://btsecom.github.io/docs/futuresV2_3/en/ | 2026-09-22 | BTSE, global | server ping every 3 minutes, error 1009 for a grouping on L1 |
| S4 | BTSE futures WebSocket AsyncAPI spec | https://docs.btse.com/specs/futures-websocket.asyncapi.yaml | 2026-09-22 | BTSE, global | field types, snapshot of at most 50 levels |
| S5 | CCXT master `ts/src/btse.ts`, commit `1d8b674` | https://github.com/ccxt/ccxt/blob/master/ts/src/btse.ts | 2026-09-22 | CCXT | `'pro': false`, `contractSize` copied from the markets reply |
| P1 | `ws-probe.mjs book`, runs at 03:27, 03:28 and 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btse/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:29, 03:31 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btse/ws-probe.mjs) | 2026-09-23 UTC | this host | cap, throughput, gaps |
| P3 | `ws-probe.mjs spelling` at 03:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btse/ws-probe.mjs) | 2026-09-23 UTC | this host | symbol spelling, section 4 |
| P4 | `ws-probe.mjs silence`, `deflate` and `main` at 03:31 to 03:34 and 03:45 to 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btse/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
