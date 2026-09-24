# Bitbank WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 01:34 to 01:50 UTC), from the development host near Seattle.

This profile covers the public stream of Bitbank (CCXT id `bitbank`), which serves spot pairs only, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
The stream is Socket.IO 4 over Engine.IO 4, so every frame carries an Engine.IO packet type before any JSON, and the probe speaks that framing over a raw `ws` socket.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitbank/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written.
CCXT 4.5.68 ships no Pro class for bitbank, since `server/node_modules/ccxt/js/src/pro/` holds no `bitbank.js`.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every pair | `wss://stream.bitbank.cc`, connected as `wss://stream.bitbank.cc/socket.io/?EIO=4&transport=websocket`, S1 | open in 307 to 392 ms over all runs, 62 pairs served |
| legacy Engine.IO 3 | Socket.IO 2 was retired on 2022-07-26, S1 | `EIO=3` still opens and answers the same open packet as `EIO=4`, P5 |

One socket carries every pair, JPY-quoted and BTC-quoted alike.
There is no perpetual family, so there is no second URL.
`stream.bitbank.cc` resolved to four addresses in `18.65.238.0/24` on 2026-09-23 UTC, see [`rest.md`](./rest.md) section 1.
The upgrade reply came through CloudFront, `via: … (CloudFront)` and `x-amz-cf-pop: SEA73-P1`, with `server: nginx`, P5.
No refusal, geoblock or challenge was seen from this host.

## 2. Channel matrix for public market data

Channels are Socket.IO rooms joined with the event `join-room`, S1.

| room | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `depth_whole_{pair}` | 200 levels per side around the best price, S1 | one on join, then every 15 s | 6 frames per pair in 75 s, the first 98 to 203 ms after the join, median interval 14,899 to 15,009 ms, P1 |
| `depth_diff_{pair}` | changed levels within about 200 of the best, absolute sizes, S1 | batched | median interval 349 to 367 ms per pair, 0 to 68 levels per frame, P1 |
| `ticker_{pair}` | best bid and ask, 24 h stats | on new data | 58 to 76 frames in 75 s on `btc_jpy`, median interval 1,006 to 1,024 ms, max 2,049 ms, P1 |
| `transactions_{pair}` | trades | on trade | 2 to 6 frames in 75 s on `btc_jpy`, P1 |
| `circuit_break_info_{pair}` | mode, trigger prices, fee type, S1 | on join, then on change | 1 or 2 frames in 75 s on `btc_jpy`, the second 42 s and 56 s after the first, P1 |

No mark, index or funding channel exists, because the venue has no derivative.
The only reference price is the circuit breaker's, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every pair, S1 | 124 rooms over all 62 pairs on one socket, P2 |
| subscribe frame shape | `42["join-room","depth_diff_xrp_jpy"]`, one room per frame, after the Socket.IO connect `40`, S1 | as documented. The frame is not JSON until the `42` prefix is removed |
| unknown symbol expectation | Not publicly specified | `join-room` on `depth_diff_nope_jpy` gets no reply at all, and the socket stays open, P3 |
| chunk unit and budget | Not publicly specified | 124 `join-room` frames sent in one burst, every pair served, P2 |
| keepalive mechanism | Engine.IO: `pingInterval` 25,000 and `pingTimeout` 60,000 in the sample open packet, S1 | the server sends `2` every 25 s and the client must answer `3`. The open packet on the wire says `"pingTimeout":20000`. A socket that does not answer is closed at 45.3 to 45.7 s, P4 |
| connection lifetime and maintenance notice | "The specification of disconnection after 6 hours is abolished.", S1. Maintenance is announced on the blog tag `service`, S3 | a socket that answered pings stayed open for the full 120 s. No in-band maintenance message exists |
| handshake and operation rate limits | Not publicly specified | none met: five sockets opened at once in `silence`, and 124 joins in one burst |
| public market data authentication | none | none |
| message parse and routing | `42["message",{"room_name":…,"message":{"data":…}}]`, S1 | as documented. Route on `room_name`, then strip the `depth_whole_` or `depth_diff_` prefix to get the pair |
| subscribe acknowledgement shape | none documented | none. The first data frame is the only sign a join worked |
| symbol identifier format | `btc_jpy`, S1 and S2 | identical to CCXT `market.id`, to the REST path segment and to `spot/pairs` `name` on 62 of 62 pairs, see [`rest.md`](./rest.md) section 2 |
| number representation | prices and sizes as strings, S1 | as documented. `depth_whole` `sequenceId` is a string such as `"34423876296"`, although S1 types it as a number. `depth_diff` `s` is a string as documented |
| timestamp representation | `t` and `timestamp` in ms, S1 | integer ms. Arrival minus `t` was 48 to 543 ms on diffs, median 51 to 69 ms per pair and run, P1 |
| size unit | base currency amount | base currency amount, section 4 |
| sequence semantics | "sequence id, increased monotonically but not always consecutive", shared between `depth_diff` `s` and `depth_whole` `sequenceId`, S1 | one counter across all pairs, so a pair's consecutive diffs step by 2 to 6,213 and never by 1. 0 decreases in 2,209 diffs over three runs. No gap can be detected, section 4 |
| idle repeat behaviour | not documented | `depth_whole` repeats every 15 s even for an unchanged or empty book. `depth_diff` sends nothing while nothing changes, up to 28,824 ms on `bat_jpy` |

## 4. The book channel in detail

The book is the pair of rooms `depth_whole_{pair}` and `depth_diff_{pair}`, used together as the documented recipe asks, S1.

### Snapshot on subscribe

Joining `depth_whole_{pair}` delivers a full book 98 to 203 ms later, on all four pairs in each of three P1 runs, and on all 62 pairs in P2.
The next whole followed 6.4 s, 13.2 s and 12.9 s later in the three runs, and then one arrived every 15 s, 5 per pair in 60 s in P2.
So the join snapshot is off the 15 s cycle, and the periodic wholes run on a common clock.
S1 warns that a whole "sometimes be sent delayed from `depth_diff_{pair}` messages", so the recipe buffers diffs and applies those with `s` above the whole's `sequenceId`.
On `btc_jpy`, `xrp_jpy` and `eth_jpy` in all three P1 runs, and on `bat_jpy` in two of them, the `sequenceId` of every whole after the first equalled the `s` of the last diff already received for that pair, so no buffered diff was ever needed.
In the other `bat_jpy` run one whole carried a `sequenceId` 846 above the pair's last diff, most likely the shared counter moving on while the pair was idle.

### Delta semantics

A diff carries `a` and `b` arrays of `[price, amount]` strings, where "The amount of `a` (asks) and `b` (bids) is absolute, and its 0 means its price level has gone.", S1.
A diff also carries `t` and `s`, and optionally `ao`, `bu`, `au`, `bo`, `am` and `bm`, the quantities outside the window and at market, S1.
Only `ao` and `bu` appeared in P1.
Diffs are batched: the median interval per pair was 349 to 367 ms and the minimum 36 to 271 ms, and a diff held up to 68 levels, P1.
Two of 211 `btc_jpy` diffs in the first run, and two of 212 in the second, had no level at all and only moved `s` and the outside quantities.

### Sequence and gap rule

```text
whole, seq = sequenceId      replace the book, apply buffered diffs with s > seq in ascending s, last = seq
diff, s <= last              drop
diff, s > last               apply, last = s
```

`s` is one counter shared by every pair.
The first diff of the four pairs in the first P1 run had `s` of 34423855161, 34423855172, 34423855171 and 34423855383, and a pair's consecutive diffs stepped by 27 to 139 on `btc_jpy` and by 5 to 6,213 on `bat_jpy` over three runs.
A step of exactly 1 never occurred in 2,209 diffs, so a missing diff cannot be told from another pair's traffic.
Only order is guaranteed, and `s` never went backwards.
The periodic whole is the only repair.
S1 says "you must refresh your local order book with each `depth_whole_{pair}` message", because diffs cover only about 200 levels from the best price.

The recipe was checked on the wire.
The previous whole plus every diff with `s` in the interval up to the next whole's `sequenceId` rebuilt that next whole exactly, top 20 levels per side, on 59 of 59 intervals over four pairs and three runs, P1.
The 60th interval, on `bat_jpy`, held no diff and was not compared.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `depth_whole` | descending, 72 of 72 wholes over three runs | ascending, 72 of 72 |
| `depth_diff` | unordered: 160, 183 and 191 of about 211 `btc_jpy` bid arrays per run were not descending | unordered: 132, 158 and 173 ask arrays per run were not ascending |
| REST `/{pair}/depth` | descending | ascending |

A feed applies diffs by price and never by position.

### Level window

S1 says a whole holds 200 entries per side from the best price in normal mode, and up to 400 around the auction price in a circuit break.
On the wire the three liquid pairs held 186 to 210 bids and 194 to 206 asks per whole over three runs, so the cap is near 200 and not exact, P1.
`bat_jpy` held 118 to 122 bids, all its book has, and 199 to 201 asks.
The engine keeps 20 levels per side, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61, which the window covers.

### Size unit against CCXT `contractSize`

Sizes are amounts of the base currency: the best `btc_jpy` bid in the REST read was `["13640000","0.0026"]`, 0.0026 BTC.
CCXT sets `contractSize` to `undefined` for every bitbank market, at `server/node_modules/ccxt/js/src/bitbank.js` line 337, and the connector turns a missing contract size into 1, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 175 and 188 to 194.
So the size unit would be read correctly, as base units.
A book rebuilt from the socket at the REST reply's `sequenceId` matched the REST top 20 levels exactly, price and size on both sides, in 6 of 12 comparisons over three runs, P1.
In the other 6, 1 to 33 of the 40 positions differed, so a REST snapshot's `sequenceId` does not fall exactly on a diff boundary.
The socket's own whole does, see the recipe check above, so a feed should seed from the whole and never from REST.

### One-sided and empty books

The 18 suspended pairs publish a whole with empty `asks` and `bids`, and they keep publishing it every 15 s.

```json
{"asks":[],"bids":[],"asks_over":"0.0000","bids_under":"0.0000","asks_under":"0.0000","bids_over":"0.0000","ask_market":"0.0000","bid_market":"0.0000","timestamp":1790127390344,"sequenceId":"34423876296"}
```

That is `depth_whole_mkr_jpy`, P3.
Such a pair sends no diff at all, and 20 and 21 of 62 pairs sent no diff in the 60 s of the two P2 runs.
The engine's `resetBook` accepts an empty side.

### Idle repeats

`depth_whole` repeats every 15 s whether or not the book changed.
`depth_diff` repeats nothing, and a quiet `bat_jpy` went 8,095, 28,824 and 5,992 ms between diffs in the three P1 runs.
The ticker room pushed about once a second on `btc_jpy`.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `42["join-room","depth_diff_nope_jpy"]` | nothing | socket stays open |
| `depth_whole_mkr_jpy`, a suspended pair | an empty whole | repeats every 15 s |
| the same room joined twice | nothing extra | frames keep their single cadence, no duplicates |
| `42["leave-room","depth_diff_btc_jpy"]` | nothing | the room stops, with 0 and 1 frames in the next 2.5 s in two runs, the 1 already in flight |
| `42["nope","depth_diff_btc_jpy"]`, unknown event | nothing | socket stays open |
| `hello`, not an Engine.IO packet | close code 1005, no close frame reason | |
| `42["join-room"`, broken JSON | close code 1005 within about 125 ms | |

Because an unknown room is silent, a feed has to notice a pair with no whole on its own.
The engine's first-book watch already logs `book_unserved` for that.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO ping and pong, S1 | the server sends `2` at about 25.3, 50.4, 75.6 and 100.7 to 100.9 s, and the client answers `3`. The client never has to ping |
| silence the server tolerates | `pingInterval` 25,000, `pingTimeout` 60,000 in S1's sample | the open packet says `"pingTimeout":20000`. A socket that ignores the ping is closed at 45.3 to 45.7 s with code 1005, whether it had joined a busy room or none. A socket that answers pings but never sends the Socket.IO connect `40` is also closed at 45.3 s. A socket that answers pings and sent `40` stayed open for 120 s with no room, in both runs, P4 |
| forced disconnect | the 6 h cut was abolished, S1 | none in 120 s |
| maintenance notice | blog tag `service`, S3 | not observed |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it. Frames are plain text, P5 |
| handshake | | socket open 307 to 392 ms. The Engine.IO open packet arrives with the open, and the Socket.IO `40{"sid":…}` 97 or 98 ms after the client sends `40` |
| subscription limits | Not publicly specified | 124 rooms on one socket, no refusal |
| message size | `maxPayload` 1,000,000 bytes in the open packet | the largest frame is a 200 level whole of about 9 KB |
| throughput | | all 62 pairs, whole and diff, two runs: 79 frames per second on average, per second median 77 to 79 and peak 145 to 148, 43.4 to 43.9 KB per second, 549 to 554 bytes per frame, median 9 to 10 µs `JSON.parse` per frame, P2 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
`>` is sent by the client and `<` by the server, and each line is one WebSocket text frame.

Handshake, connect and join.

```text
< 0{"sid":"Fqxpf1PqISvnQiX_Bftk","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
> 40
< 40{"sid":"0owQaFFDanTLHmpXBftl"}
> 42["join-room","depth_whole_btc_jpy"]
> 42["join-room","depth_diff_btc_jpy"]
```

Keepalive.

```text
< 2
> 3
```

Whole on join, the first three levels per side kept, from the second run.
The zero quantities come as `"0"` here and as `"0.0000"` on `bat_jpy` and in the REST depth.

```json
["message",{"room_name":"depth_whole_btc_jpy","message":{"data":{"asks":[["13594932","0.0926"],["13595038","0.0579"],["13595039","0.0541"]],"bids":[["13592268","0.0368"],["13592266","0.0147"],["13592256","0.0033"]],"asks_over":"65.8744","bids_under":"4712.6367","asks_under":"0","bids_over":"0","ask_market":"0","bid_market":"0","timestamp":1790127887663,"sequenceId":"34423989141"}}}]
```

Diff, with the outside quantities `ao` and `bu`.

```json
["message",{"room_name":"depth_diff_btc_jpy","message":{"data":{"a":[["13642554","0"],["13641185","0.0006"],["13641186","0"],["13645741","0.0439"],["13642647","0.002"],["13642582","0"],["13641270","0.003"]],"b":[["13634294","0"],["13635632","0"],["13634347","0"],["13635717","0.003"]],"t":1790127295169,"s":"34423855352","ao":"65.7738","bu":"4711.7088"}}}]
```

Ticker, which carries no `pid`, although the sample in S1 does.

```json
["message",{"room_name":"ticker_btc_jpy","message":{"data":{"sell":"13638336","buy":"13638000","open":"13470001","high":"13655000","low":"13368518","last":"13638335","vol":"91.1477","timestamp":1790127292650}}}]
```

Trade.

```json
["message",{"room_name":"transactions_btc_jpy","message":{"data":{"transactions":[{"transaction_id":1237940856,"side":"sell","price":"13638000","amount":"0.0001","executed_at":1790127300894}]}}}]
```

Circuit break info.

```json
["message",{"room_name":"circuit_break_info_btc_jpy","message":{"data":{"mode":"NONE","estimated_itayose_price":null,"estimated_itayose_amount":null,"itayose_upper_price":null,"itayose_lower_price":null,"upper_trigger_price":"16368002","lower_trigger_price":"10912000","fee_type":"NORMAL","reopen_timestamp":null,"timestamp":1790127270282}}}]
```

The Engine.IO prefix `42` is removed from the five JSON blocks above.

## 7. Private channels

Named for a future execution stage, from S4, not probed.
Private data does not use this socket.
It goes through PubNub, with a channel and token fetched from the authenticated `GET /v1/user/subscribe`.
The methods are `asset_update`, `spot_order_new`, `spot_order`, `spot_order_invalidation`, `spot_trade`, `dealer_order_new`, `withdrawal` and `deposit`.

## 8. Recommended feed shape

A recommendation for a later spot design, not a decision, since bitbank cannot join the engine as a perpetual leg.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://stream.bitbank.cc/socket.io/?EIO=4&transport=websocket` | one socket serves every pair |
| markets per connection | all 44 tradable JPY pairs on one socket | 62 pairs and 124 rooms ran at 79 frames per second |
| subscribe frames | `getSubscribeFrames` returns `[]`, and `handleMessage` sends the text `40` on the open packet `0{…}`, then `42["join-room","depth_whole_<id>"]` and `42["join-room","depth_diff_<id>"]` per market on `40{…}` | the base class sends `JSON.stringify` of each subscribe object, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 143, and a Socket.IO frame is not JSON. This is the one named change |
| keepalive | `startKeepalive` does nothing, and `handleMessage` answers the text `2` with `3` | the server drives the ping, and an unanswered ping closes the socket at 45 s |
| `maxSilenceMs` | 60,000 | the server ping arrives every 25 s and counts as traffic, and every joined pair also gets a whole every 15 s |
| routing | strip `42`, parse, then `room_name.slice(12)` for `depth_whole_` and `room_name.slice(11)` for `depth_diff_` gives the `rawMarketId` | the room name wraps the pair id |
| snapshot | every whole: `resetBook`, store `sequenceId`, apply buffered diffs with larger `s` | documented recipe, and a whole is the only repair |
| delta | apply when `s` is above the stored id, else drop, then `publish` | the id is global and not consecutive |
| resync | none on sequence, since no gap is detectable. A diff before the first whole is buffered, not a resync | the 15 s whole bounds how long a lost diff can corrupt the book |
| unserved pair | the existing `book_unserved` watch | an unknown room is silent |
| receive time | stamp on arrival | the diff `t` is the venue's clock |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The weak point is the 15 s repair window.
A diff lost in transit leaves a wrong level in the book until the next whole, and nothing on the wire says it was lost.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Web Socket Streams for Bitbank, `public-stream.md` | https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-stream.md | 2026-09-22 | bitbank, Japan | URL, Socket.IO 4, rooms, fields, sequence rule, local book recipe, sections 1 to 5 |
| S2 | Pair list, `pairs.md` | https://github.com/bitbankinc/bitbank-api-docs/blob/master/pairs.md | 2026-09-22 | bitbank, Japan | pair ids, section 3 |
| S3 | bitbank API docs README, maintenance announcements | https://github.com/bitbankinc/bitbank-api-docs | 2026-09-22 | bitbank, Japan | blog tag `service`, sections 3 and 5 |
| S4 | Private stream, `private-stream.md` | https://github.com/bitbankinc/bitbank-api-docs/blob/master/private-stream.md | 2026-09-22 | bitbank, Japan | PubNub and method names, section 7 |
| S5 | CCXT 4.5.68 `bitbank.js` | `server/node_modules/ccxt/js/src/bitbank.js` | 2026-09-22 | CCXT | `contractSize` line 337, section 4 |
| P1 | `ws-probe.mjs book`, three runs of 75 s at 01:34, 01:44 and 01:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbank/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 4 and 6 |
| P2 | `ws-probe.mjs batch`, 60 s at 01:37 and 01:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbank/ws-probe.mjs) | 2026-09-23 UTC | this host | throughput, every pair served, sections 3 to 5 |
| P3 | `ws-probe.mjs errors` at 01:36 and 01:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbank/ws-probe.mjs) | 2026-09-23 UTC | this host | unknown room, empty book, leave, bad frames, section 4 |
| P4 | `ws-probe.mjs silence`, 120 s at 01:36 and 01:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbank/ws-probe.mjs) | 2026-09-23 UTC | this host | ping cadence and the 45.3 s close, sections 3 and 5 |
| P5 | `ws-probe.mjs handshake` at 01:34 and 01:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbank/ws-probe.mjs) | 2026-09-23 UTC | this host | open packet, EIO=3, deflate, sections 1 and 5 |
