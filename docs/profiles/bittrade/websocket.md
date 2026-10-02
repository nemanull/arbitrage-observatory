# BitTrade WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:19 to 03:41 UTC), from the development host near Seattle.

This profile covers the public spot market WebSocket of BitTrade (CCXT id `bittrade`), because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bittrade/ws-probe.mjs), and the capture is quoted beside the documented value.
The documentation S1 is the Huobi v1 protocol with BitTrade hosts, and it documents only the `depth.step*` book.
The `mbp` book that CCXT Pro uses is not in S1, and the probe shows it works.

## 1. Endpoints

| use | documented URL | probed |
|---|---|---|
| public market data | `wss://api-cloud.bittrade.co.jp/ws`, S1 | opened in 427 to 503 ms over 29 sockets, every public topic tried delivered except `mbp.5` and `mbp.20` |
| private account data | `wss://api-cloud.bittrade.co.jp/ws/v2`, S1 | not probed |
| dealer (販売所) prices | `wss://api-cloud.bittrade.co.jp/retail/ws`, S1 | not probed |

One socket carries every spot pair.
The host is fronted by Cloudflare, see [`rest.md`](./rest.md) section 1.
CCXT Pro builds the same public URL from `hostname`, at `server/node_modules/ccxt/js/src/pro/bittrade.js` line 29.

## 2. Channel matrix for public market data

| topic | documented | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `market.<symbol>.depth.step0` | yes, `step0` to `step5`, S1 | whole book snapshot, 150 levels per side | a snapshot on subscribe, then a whole snapshot with a median gap of 1,000 ms on busy pairs and 2 to 5 s on quiet ones, up to 15 s |
| `market.<symbol>.mbp.150` | no | deltas, 100 ms batches | deltas chained by `prevSeqNum`, no snapshot on subscribe, snapshot by `req`, recommended |
| `market.<symbol>.mbp.5`, `market.<symbol>.mbp.20` | no | | acknowledged `ok`, then no frame in 73 s, in three runs |
| `market.<symbol>.mbp.refresh.20` | no | whole 20 level snapshot on change, 100 ms grid | 618 and 605 frames in 73 s on `btcjpy`, median gap 100 and 101 ms, and 21 and 19 frames on `batjpy` |
| `market.<symbol>.bbo` | yes, S1 | best bid and ask on change | 458, 1,064 and 753 frames in 73 s on `btcjpy` over three runs, median gap 62 to 78 ms |
| `market.<symbol>.trade.detail` | yes, S1 | on trade | not probed |
| `market.<symbol>.detail` | yes, S1 | 24 h summary | not probed |
| `market.<symbol>.kline.<period>` | yes, S1 | | not probed |

No mark, index or funding topic exists, since the venue has no derivative on the API.
The `freq-ms` field of a subscription accepts `1000` to `5000` in S1, and the server refused `1000` on `depth.step0` with "valid: 5000", P1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one socket served every pair, 45 of 45 online pairs on one connection |
| subscribe frame shape | `{"sub": "market.ethbtc.depth.step0", "id": "id1"}`, one topic per frame, S1 | one topic per frame, and 45 frames sent in one burst were acknowledged 45 of 45, on each of two sockets |
| unknown symbol expectation | `{"id": "id2", "status": "error", "err-code": "bad-request", "err-msg": "invalid topic market.invalidsymbol.kline.1min", ...}`, S1 | `"err-msg":"invalid symbol nopejpy"` for an unknown or `offline` pair, and `"symbol:tonjpy trade not open now "` for the `suspend` pair |
| chunk unit and budget | Not publicly specified for the public socket | 45 `sub` frames in a burst passed. 45 `req` frames in a burst got 21 refusals `"429 too many request topic is market.<symbol>.mbp.150"` and 23 snapshots. Paced at one every 100 ms, 44 of 45 were answered with no refusal in two runs |
| keepalive mechanism | server `{"ping": <ms>}` every 5 s, client answers `{"pong": <same>}`, two missed pings close the socket. The client may send `{"ping": <long>}` instead, S1 | server pings every 5,000 ms. Unanswered, it pings every 1,000 ms after the first miss and closes 15.5 to 16.3 s after the open with code 1003 `ping check expired`. A client ping every 5 s kept a socket that never answered open for 90 s |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 90 s, and no notice frame seen |
| handshake and operation rate limits | 10 public REST requests per second per IP. For the private socket, 50 connections and requests per second, and 100 connections per second per IP, S1 | 29 public sockets opened over the runs with no refusal, up to five at once |
| public market data authentication | none | none |
| message parse and routing | `{ch, ts, tick}` for pushes, `{id, status, subbed, ts}` for acknowledgements, `{id, status, ts, rep, data}` for a `req` reply, S1 | as documented, routing on `ch` for pushes and `rep` for snapshots |
| subscribe acknowledgement shape | `{"id": "id1", "status": "ok", "subbed": "market.ethbtc.depth.step0", "ts": 1489474081631}`, S1 | identical. On `depth.step0` the snapshot arrived in the same millisecond as the acknowledgement |
| symbol identifier format | lower case base and quote joined, `btcjpy` | identical to CCXT `market.id` and to the REST `symbol` on 95 of 95 symbols |
| number representation | JSON numbers | JSON numbers written by a Java formatter: `1.3640078E7` for a price and `3.6E-4` for a size, which `JSON.parse` reads |
| timestamp representation | `ts` in ms | envelope `ts` in ms. `depth.step0` also carries `tick.ts`, which was up to 6.6 s older than the frame's arrival on a quiet pair |
| size unit | base currency | base currency, section 4 |
| sequence semantics | not documented | `mbp.150`: each delta's `prevSeqNum` equals the previous delta's `seqNum`, 0 gaps in 1,233, 1,250 and 1,251 applied deltas on three pairs over three runs. Over 45 pairs, 0 gaps in 2,392 and 4,019 deltas, and 1 gap in 3,964 whose cause was not captured |
| idle repeat behaviour | not documented | nothing is repeated on `mbp`. `depth.step0` pushed one identical snapshot once on `soljpy`, in 23 frames of one run of three |

## 4. The book channel in detail

`market.<symbol>.mbp.150` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

There is none.
The first frame after the acknowledgement is a delta, in three runs on three pairs.
The snapshot comes from a request on the same socket, `{"req": "market.btcjpy.mbp.150", "id": "..."}`, which answered in 103 to 133 ms, P1, P3 and P4.
CCXT Pro does the same, a `sub` and then a `req`, at `server/node_modules/ccxt/js/src/pro/bittrade.js` lines 280 to 308 and 351 to 375.

The snapshot is older than the stream.
The first `req` reply, 2 s after the subscription, was behind 14 of 19, 14 of 21 and 10 of 20 cached `btcjpy` deltas in three runs, and 9 of 15 `ethjpy` deltas in each.
A second `req` 33 s later returned `seqNum` 204675235507 while the local book was already at 204675235560, then 204675268179 against 204675268188, and 204675291580 against 204675291581.
So a feed caches deltas from the subscription, drops those with `seqNum` at or below the snapshot's, and applies the rest.

`req` frames are rate limited.
45 of them in one burst got 21 replies `"429 too many request topic is market.<symbol>.mbp.150"`, P2.
Paced at one every 100 ms, 45 requests got 44 snapshots and no refusal in each of two runs, P4.
In the second paced run the pair that never answered was `daijpy`, which also sent no delta in 60 s, and the first paced run did not record which pair it was.
The limit itself was not measured further.

### Delta semantics

A delta carries `seqNum`, `prevSeqNum`, and `bids` and `asks` arrays of `[price, size]`.
A size of `0` deletes the level.
A delta may carry one side only, and no delta with both sides empty was seen in any run.
Deltas arrive in 100 ms batches: the median gap on `btcjpy` was 99, 99 and 100 ms in three runs, with a minimum of 4 ms and a maximum of 320 ms.

### Sequence and gap rule

```text
snapshot (req reply)             replace the book, last = data.seqNum
delta, seqNum <= last            before the snapshot: drop
first delta after the snapshot   prevSeqNum <= last < seqNum, apply, last = seqNum
later delta, prevSeqNum = last   apply, last = seqNum
later delta, prevSeqNum ≠ last   gap: resubscribe and request a new snapshot
```

`seqNum` is not contiguous: one delta stepped it by 1 to 54 on `btcjpy`, and by 1 to 81 over 45 pairs.
On every stream of the three book runs the first delta after the snapshot had `prevSeqNum` equal to the snapshot's `seqNum`.
0 gaps in 704, 513 and 16 deltas in the first run, 699, 539 and 12 in the second, and 711, 527 and 13 in the third.
Over 45 pairs, 0 gaps in 2,392 deltas in the burst run and 4,019 in the last paced run, and 1 gap in 3,964 in the first paced run, which that run did not record the detail of.
CCXT Pro applies a delta when `prevSeqNum <= nonce < seqNum` and never detects a gap, at `server/node_modules/ccxt/js/src/pro/bittrade.js` lines 418 to 423.

The sequence is shared across the venue's feeds.
The `version` of 71 of 74 and 68 of 74 `btcjpy` `depth.step0` frames in two runs was a `seqNum` seen on the `mbp.150` stream, P3 and P4.
The REST book's `version` read the same `seqNum` as the local book when both were at 204675270517, and its top 20 levels matched on 20 of 20 per side.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `mbp.150` snapshot | descending on 3 of 3 pairs in both runs | ascending |
| `mbp.150` delta | descending on every delta with two or more bids | ascending on every delta with two or more asks |
| `depth.step0` | descending on every frame, 74 of 74 on `btcjpy` | ascending |
| `mbp.refresh.20` | descending | ascending |
| REST `depth` | descending | ascending |

A feed still applies deltas by price and not by position.

### Level window

The server keeps `mbp.150` at 150 levels per side.
A book kept from the snapshot and every delta held at most 150 bids and 150 asks on `btcjpy`, and a delta sends far levels leaving the window with size `0`.
Thin pairs hold fewer: `batjpy` at most 50 bids and 64 asks, `soljpy` 50 and 47.

### Size unit against CCXT `contractSize`

Sizes are in the base currency.
CCXT sets `contractSize` to `undefined` for every BitTrade market, at `server/node_modules/ccxt/js/src/bittrade.js` line 585, and the engine turns a missing contract size into 1, so the socket size would be read correctly.
The local `btcjpy` book matched the REST book at the same `version` on 20 of 20 bid and 20 of 20 ask sizes in the second run.
In the other two runs the reads were not at the same `seqNum`, and 19 and 19, then 18 and 20, of the 20 sizes per side matched.

### One-sided and empty books

No one-sided or empty book was seen on the 45 online pairs.
What `mbp.150` sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated on `mbp.150`, and a quiet pair sends nothing: `batjpy` went 10.0 s and 15.0 s without a delta, and `soljpy` up to 12 s without a `depth.step0` frame.
`depth.step0` skipped most slots in which the book did not change, and one identical snapshot was pushed once on `soljpy`.

### Unknown, closed and wrong-level symbols

| request | reply |
|---|---|
| `sub` `market.nopejpy.depth.step0` or `mbp.150` | `"err-code":"bad-request","err-msg":"invalid symbol nopejpy"` |
| `sub` an `offline` pair, `market.mvjpy.depth.step0` or `market.adaeth.depth.step0` | `invalid symbol mvjpy`, `invalid symbol adaeth` |
| `sub` the `suspend` pair, `market.tonjpy.mbp.150` | `"err-msg":"symbol:tonjpy trade not open now "` |
| `sub` `market.btcjpy.mbp.30` | `invalid topic market.btcjpy.mbp.30` |
| `sub` `market.btcjpy.mbp.5` or `mbp.20` | `"status":"ok"`, then silence |
| `sub` `market.btcjpy.depth.step9` | `invalid topic market.btcjpy.depth.step9` |
| `sub` `market.btcjpy.nope` | `invalid topic market.btcjpy.nope` |
| `sub` the same topic twice | two `ok` acknowledgements and two snapshots, then one push per update |
| `unsub` a topic never subscribed | `unsub with not subbed topic` |
| `req` `market.nopejpy.mbp.150` | `invalid symbol nopejpy` |
| `sub` with `"freq-ms": 1000` on `depth.step0` | `sub topic market.btcjpy.depth.step0 with invalid freq-ms 1000, valid: 5000` |
| text that is not JSON | `"err-msg":"not json, is not json string"`, and the socket stays open |
| `{"ping": "abc"}` | no reply, while S1 documents `invalid ping` |
| `req` `market.daijpy.mbp.150`, an `online` pair | no reply in 58 s |

Unlike some venues, BitTrade refuses an unknown symbol, so a feed can log it from the error frame.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `{"ping": <ms>}` every 5 s, "変更の可能性がある", client answers `{"pong": <ms>}` with the same value | ping every 5,000 ms, gaps 4,959 to 5,039 ms over every socket that answered |
| silence the server tolerates | two missed pings close the socket | after the first unanswered ping the server pings every 1,000 ms, and closed 15.51 to 16.29 s after the open with code 1003 and reason `ping check expired, session: …`, with or without a subscription, four sockets over two runs. A socket answering pings with no subscription stayed open 90 s |
| client ping | `{"ping": <long>}` answered by `{"pong": <same>}`, and one client ping in the last two messages keeps the socket | answered with the same value, as a gzip frame like every other. A socket that sent `{"ping": <ms>}` every 5 s and never answered the server stayed open 90 s, in two runs |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | "WebSocket API 経由で返されるデータはすべてGZIP圧縮されており", S1 | every frame is a binary frame holding a gzip member, magic `1f 8b`, including pings. A client offering permessage-deflate got no extension back, so the server does not negotiate it |
| handshake | | 427 to 503 ms to open from this host over 29 sockets |
| subscription limits | Not publicly specified | 45 topics on each of two sockets passed, and a `req` burst of 45 got 21 refusals |
| throughput | | 45 pairs on `mbp.150` plus 45 on `depth.step0`, three runs: 72 or 73 `mbp` frames per second median, peak 102 to 149, and 19.0 to 19.4 `depth` frames per second, 28.0 to 28.4 KB per second on the wire and 63.9 to 64.7 KB per second of JSON. Each frame cost 51 to 61 µs to gunzip and 15 to 18 µs to parse over every run |

The gunzip costs about three times the parse, so it is the larger part of the per frame cost on the event loop.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut.
Numbers are as they came off the wire.

Subscribe and acknowledgement.

```json
{"sub": "market.btcjpy.mbp.150", "id": "m-btcjpy"}
```

```json
{"id":"m-btcjpy","status":"ok","subbed":"market.btcjpy.mbp.150","ts":1790134136991}
```

The first frame after the acknowledgement, a delta.
The last bid deletes a level far below the touch.

```json
{"ch":"market.btcjpy.mbp.150","ts":1790134136934,"tick":{"seqNum":204675265972,"prevSeqNum":204675265969,"bids":[[1.3640078E7,3.6E-4],[1.3638902E7,1.7E-4],[1.1001001E7,0.0]],"asks":[]}}
```

Snapshot request and reply, first three levels per side kept.

```json
{"req": "market.batjpy.mbp.150", "id": "r-batjpy"}
```

```json
{"id":"r-batjpy","status":"ok","ts":1790134138994,"rep":"market.batjpy.mbp.150","data":{"seqNum":200333109135,"bids":[[14.46,13.39],[14.42,17.48],[14.4,21.76]],"asks":[[14.64,2.53],[14.68,5.83],[14.72,9.49]]}}
```

`depth.step0` snapshot of the same pair, whose `version` is the same `seqNum`.

```json
{"ch":"market.batjpy.depth.step0","ts":1790134135805,"tick":{"bids":[[14.46,13.39],[14.42,17.48],[14.4,21.76]],"asks":[[14.64,2.53],[14.68,5.83],[14.72,9.49]],"version":200333109135,"ts":1790134135542}}
```

`mbp.refresh.20`, first three levels per side kept.

```json
{"ch":"market.batjpy.mbp.refresh.20","ts":1790134135640,"tick":{"seqNum":200333109135,"bids":[[14.46,13.39],[14.42,17.48],[14.4,21.76]],"asks":[[14.64,2.53],[14.68,5.83],[14.72,9.49]]}}
```

Best bid and ask.

```json
{"ch":"market.btcjpy.bbo","ts":1790134136971,"tick":{"seqId":204675265973,"ask":1.3640736E7,"askSize":0.00361,"bid":1.3639421E7,"bidSize":1.7E-4,"quoteTime":1790134136965,"symbol":"btcjpy"}}
```

Keepalive, the server's ping and the reply to a client ping.

```json
{"ping":1790134139501}
```

```json
{"pong":1790134136940}
```

Errors.

```json
{"status":"error","ts":1790134136995,"id":"e11-suspend","err-code":"bad-request","err-msg":"symbol:tonjpy trade not open now "}
```

```json
{"status":"error","ts":1790133833180,"id":"r-btcjpy","err-code":"bad-request","err-msg":"429 too many request topic is market.btcjpy.mbp.150"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://api-cloud.bittrade.co.jp/ws/v2` after an `auth` request signed with HmacSHA256 and `signatureVersion` 2.1.

- `orders#${symbol}`, order creation, triggers, cancels and fills.
- `trade.clearing#${symbol}#${mode}`, fills and cancels as they clear.
- `accounts.update#${mode}`, balance changes.

The private socket uses `{"action": "ping", "data": {"ts": ...}}` and `{"action": "pong", ...}` instead of the bare ping.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only relevant if the engine ever takes a spot leg.
Today the connector would skip BitTrade before any feed opens, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api-cloud.bittrade.co.jp/ws` | one socket serves every pair |
| channel | `market.<rawMarketId>.mbp.150` | deltas in 100 ms batches with a strict `prevSeqNum` chain, 150 levels covers the engine's 20 |
| simpler alternative | `market.<rawMarketId>.mbp.refresh.20`, `resetBook` on every frame | a whole 20 level book on change at 100 ms, no snapshot request and no gap rule, and it matched the `mbp.150` top 20 at the same `seqNum` on 20 of 20 levels per side in two runs |
| markets per connection | all 45 online pairs | 45 ran on one socket at 72 or 73 frames per second, with 0 gaps in two runs of three and 1 in the other |
| subscribe frames | one `{"sub": "market.<id>.mbp.150", "id": "<id>"}` per pair | one topic per frame |
| snapshot | one `{"req": "market.<id>.mbp.150", "id": "<id>"}` per pair, paced at about 10 a second, after the `sub`, and a pair with no snapshot after 10 s is logged | a burst of 45 got 21 refusals with 429, paced requests got none, and `daijpy` never answered |
| decode | `zlib.gunzipSync` on every binary frame before `JSON.parse` | the server gzips every frame, and `VenueFeed` hands `handleMessage` the raw buffer at [`../../../server/src/feeds/book/VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 209 |
| keepalive | answer every `{"ping": n}` with `{"pong": n}` | two missed pings, about 16 s, close the socket |
| `maxSilenceMs` | 15,000 | the server's ping every 5 s arrives as a message and counts as traffic, since `VenueFeed` stamps `lastMessageAt` on every frame at line 205, so three missed pings is a dead socket |
| routing | `ch.split('.')[1]` gives the `rawMarketId` of a delta, and `rep` of a snapshot | the topic wraps the symbol |
| delta | cache until the snapshot, drop `seqNum <= last`, then apply only when `prevSeqNum === last` | section 4 |
| resync | `prevSeqNum !== last` after alignment: `resync`, which terminates the socket, resubscribes and requests the snapshot again | the engine's existing path |
| unknown symbol | log the `err-msg` of the error frame | the server refuses unknown and closed pairs |
| receive time | stamp on arrival, never from `ts` | a quiet pair's `tick.ts` was seconds old |
| numbers | `Number()` or `JSON.parse` as is | the wire uses exponent notation such as `1.3640078E7` |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it, and the payload is gzip anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitTrade API documentation, sections Websocket (Public) and Websocket (Private) | https://api-doc.bittrade.co.jp/ | 2026-09-22 | BitTrade Inc., Japan | URLs, gzip, heartbeat, `req`, `sub`, `unsub`, topic list, error shapes, private topics and limits, sections 1 to 7 |
| C1 | CCXT Pro 4.5.68 `bittrade.js` | `server/node_modules/ccxt/js/src/pro/bittrade.js` | 2026-09-22 | CCXT | URL at line 29, gunzip at line 40, `mbp.150` only at lines 280 to 308, snapshot by `req` at lines 351 to 375, delta rule at lines 418 to 423 |
| C2 | CCXT 4.5.68 `bittrade.js` | `server/node_modules/ccxt/js/src/bittrade.js` | 2026-09-22 | CCXT | `contractSize` undefined at line 585, section 4 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/bittrade/ws-probe.mjs) `book` at 03:20 UTC | | 2026-09-23 UTC | this host | sections 2 to 6, the first readings |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/bittrade/ws-probe.mjs) `batch` at 03:23 UTC, which then sent every `req` at once as `batch burst` does now, `silence` at 03:22 UTC and `deflate` at 03:19 UTC | | 2026-09-23 UTC | this host | the 429 burst, throughput, silence and compression, sections 3 and 5 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/bittrade/ws-probe.mjs) `book` at 03:29 UTC | | 2026-09-23 UTC | this host | `version` against `seqNum`, `mbp.refresh.20` against `mbp.150`, the suspended pair, sections 2 to 6 |
| P4 | [`ws-probe.mjs`](../../../scripts/probes/venues/bittrade/ws-probe.mjs) second pass: `book` at 03:35 UTC, `batch` paced at 03:36 and 03:38 UTC, `silence` at 03:39 UTC and `deflate` at 03:40 UTC | | 2026-09-23 UTC | this host | the third readings, paced snapshots, `daijpy`, sections 2 to 5 |
