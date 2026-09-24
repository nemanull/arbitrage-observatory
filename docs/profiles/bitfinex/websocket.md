# Bitfinex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:22 to 03:34 UTC on 2026-09-23 for the first pass and 03:34 to 03:45 UTC for the second, from the development host near Seattle.

This profile covers the public WebSocket API v2 of Bitfinex (CCXT id `bitfinex`) for the perpetual contracts, whose symbols end in `F0`, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation was read as Markdown from `https://docs.bitfinex.com/<page>.md`, which the docs site offers for every page.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| public market data, every family | `wss://api-pub.bitfinex.com/ws/2`, S1 | open in 509 to 572 ms over all runs, info frame `{"event":"info","version":2,…,"platform":{"status":1}}` first |
| authenticated channels | `wss://api.bitfinex.com/ws/2`, S1 | not probed |

One socket carries every perpetual family.
In the book run the same socket served `tBTCF0:USTF0` and five other USDt contracts, the BTC-settled `tETHF0:BTCF0` and the paper trading `tTESTXTZF0:TESTUSDTF0`, each with a snapshot and passing checksums.
`api-pub.bitfinex.com` resolves to five Cloudflare addresses, see [`rest.md`](./rest.md) section 1, and the socket upgrade answers with `server: cloudflare`.

## 2. Channel matrix for public market data

| channel | subscribe fields | depth and speed | probed |
|---|---|---|---|
| `book` | `symbol`, `prec` `P0` to `P4`, `freq` `F0` realtime or `F1` every 2 s, `len` `1`, `25`, `100` or `250`, S2 | `P0` keeps 5 significant figures, `P4` keeps 1 | `P0` `F0` at 25 and 100 levels, snapshot then single level updates, recommended at 25 |
| `book` raw, `prec` `R0` | `symbol`, `len`, S3 | one entry per order with its id | 25 levels on BTC, snapshot then per order updates |
| `status` | `key` `deriv:<symbol>` or `liq:global`, S4 | pushes the derivative status row | one frame every 380 to 1,043 ms with a median of 1,000 ms, whose content changes every 3 s, section 4 |
| `ticker` | `symbol`, S5 | best bid and ask with their sizes, last price, daily figures | 6 and 5 data frames per run on BTC, a median of 14,950 and 14,828 ms apart |
| `trades`, `candles` | `symbol` or `key` | | not probed |

No mark, index or funding channel exists apart from `status`, which carries the same row as the REST status call without the key column.
The `status` channel is a per symbol subscription and counts against the per connection cap, so it cannot carry 75 contracts on one socket, see section 5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for every symbol, S1 | USDt, BTC-settled and paper contracts all served on one socket, section 1 |
| subscribe frame shape | `{"event":"subscribe","channel":"book","symbol":"tBTCUSD","prec":"P0","freq":"F0","len":"25"}`, one channel per frame, S2 | as documented, and a `conf` frame `{"event":"conf","flags":<sum>}` before the first subscribe sets checksum and sequence flags |
| unknown symbol expectation | error codes 10300 generic and 10001 unknown pair, S1 | `{"event":"error","msg":"symbol: invalid","code":10300,…}`, the socket stays open |
| chunk unit and budget | 30 public market data subscriptions per connection in S1, and 25 channels per connection in S6 | 36 subscriptions accepted on one socket, the 37th to the 75th each refused with `{"event":"error","msg":"subscribe: limit","code":10305}`, the socket stays open |
| keepalive mechanism | server heartbeat `[CHANNEL_ID,"hb"]` every 15 s, and a client `{"event":"ping","cid":…}` answered by `pong`, S1 | heartbeats 14,997 to 15,003 ms apart on every subscribed channel, busy or quiet. `pong` in 166 to 200 ms. No protocol level ping from the server in either run |
| connection lifetime and maintenance notice | `info` codes 20051 reconnect, 20060 maintenance start, 20061 maintenance end with a resubscribe advised, S1 | none seen. A socket with no subscription and no client frame closed with 1006 about 60 s after it opened |
| handshake and operation rate limits | 20 connections per minute on `api-pub`, then 60 s rate limited, S6 | 3 sockets opened within one second without refusal. The limit was not provoked |
| public market data authentication | none, S6 | none |
| message parse and routing | events are JSON objects, data is `[CHANNEL_ID, payload]`, S1 | as documented. The `chanId` of the `subscribed` event is the only link from a frame to a symbol |
| subscribe acknowledgement shape | `{"event":"subscribed","channel":"book","chanId":…,"symbol":…,"prec":…,"freq":…,"len":…,"subId":…,"pair":…}`, S2 | as documented without `subId` when none was sent. The snapshot follows the ack 0 to 33 ms later |
| symbol identifier format | `t` plus the pair, `tBTCF0:USTF0`, S1 and S7 | identical to CCXT `market.id` on 93 of 93 swaps and to the REST status key, see [`rest.md`](./rest.md) section 2. A symbol sent without the `t` was accepted and acked as `tBTCF0:USTF0` |
| number representation | JSON numbers, S2 | prices and amounts are JSON numbers, never strings, and a checksum built from JavaScript's `String()` of each number matched every time |
| timestamp representation | milliseconds, S1. Book frames carry none unless the `TIMESTAMP` flag is set | no time in book frames by default. With `TIMESTAMP` every array frame ends in a millisecond time |
| size unit | `AMOUNT`, positive for a bid and negative for an ask, S2 | base currency units, which is CCXT `contractSize` 1, section 4 |
| sequence semantics | none per channel. The `SEQ_ALL` flag "Adds sequence numbers to each event", marked beta, and `OB_CHECKSUM` sends a CRC32 of the top 25 levels, S1 and S8 | `SEQ_ALL` numbers every array frame of a socket from 1, across channels, heartbeats and checksums, 0 gaps in 647, 67, 1,310 and 111 frames. Checksums matched on 152 of 152 in the first book run, 108 of 108 in the second, and 533, 591 and 179 in the batches |
| idle repeat behaviour | not documented | books never repeat a level. The `status` channel re-sends an unchanged row about every second and changes it every 3 s, section 4 |

## 4. The book channel in detail

`book` with `prec` `P0`, `freq` `F0` and `len` `25` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first data frame of each channel is the snapshot, an array of `[PRICE, COUNT, AMOUNT]` entries.
It arrived 0 to 2 ms after the `subscribed` ack on every channel of the book runs and of the first two batches, and up to 33 ms after it when 40 subscriptions went out in one burst.
BTC, ETH, DOGE and `ETHF0:BTCF0` got 25 bids and 25 asks, and ETH at `len` 100 got 100 and 100.
Thin contracts get what exists: `XTZF0:USTF0` got 18 and 21, then 19 and 21, and `EUROPE50IXF0:USTF0` got 2 bids and 1 ask.
No second snapshot came on any channel in 75 s, so a snapshot is sent only on subscribe.

### Update semantics

An update is one entry `[CHANNEL_ID, [PRICE, COUNT, AMOUNT]]`, S2.
The documented rule, which the probe applied to every update:

```text
COUNT > 0, AMOUNT > 0    set the bid at PRICE to AMOUNT
COUNT > 0, AMOUNT < 0    set the ask at PRICE to -AMOUNT
COUNT = 0, AMOUNT = 1    delete the bid at PRICE
COUNT = 0, AMOUNT = -1   delete the ask at PRICE
```

Every delete carried exactly 1 or -1, with 0 exceptions over 19,627 `P0` updates in the two book runs.
The first book run saw 1,967 BTC updates, 1,780 ETH and 3,159 DOGE in 75 s, and a thin contract like XTZ still sent 1,354.

With `BULK_UPDATES` an update is an array of entries instead, which batched 221 updates into 59 bulk frames in 12 s, and 1,662 into 99 in the second pass.
A feed that enables it must tell a bulk update from a snapshot by order of arrival, since both are arrays of entries.

### Sequence and gap rule

The channel carries no per symbol sequence, S2.
Two integrity tools exist, and both held on every frame probed.

```text
conf flags = OB_CHECKSUM (131072) + SEQ_ALL (65536) = 196608, sent before subscribing
every array frame ends in seq, one counter per socket starting at 1
seq = last + 1    apply, last = seq
seq ≠ last + 1    gap on the socket: resync
[CHANNEL_ID, "cs", CHECKSUM]   compare with CRC32 of the local top 25, mismatch: resync
```

The conf ack is `{"event":"conf","status":"OK","flags":196608}`.
With `SEQ_ALL` alone the number is the last element of every frame, snapshots included, as in `[288922,[86644,0,1],3]`.
With `TIMESTAMP` as well it is the second to last, followed by the time, as in `[853691,[…],2,1790134414850]`.
647 frames on one socket with two books were numbered 1 to 647 with 0 gaps, and 67 bulk frames on the other were numbered 1 to 67, and the second pass numbered 1,310 and 111 frames with 0 gaps.
`SEQ_ALL` is marked "_BETA FEATURE_" in S1.

### Checksum

The checksum is a signed CRC32 over the 25 best bids and 25 best asks, interleaved as `bid price:bid amount:ask price:ask amount` from the best level down, with the ask amount negative as on the wire, S8.
For `R0` the order id replaces the price, and orders at one price are sorted by id.
A book with fewer than 25 levels on a side contributes only the levels it has.
Checksum frames came a median of 2,516 to 2,694 ms apart on a changing book, with single gaps up to 8,008 ms, and none at all on `EUROPE50IXF0:USTF0`, whose book barely changed.
So the checksum catches a bad book within about 2.5 s on a live contract, and the sequence catches a lost frame on the next frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | first in the array, best first, descending, on every channel of both runs | after the bids, best first, ascending |
| update | one level per frame, so no order | |
| REST `book` | first, descending, see [`rest.md`](./rest.md) section 5 | after the bids, ascending |

### Level window

The server holds the stream at `len` levels per side.
A book kept from the snapshot and every update never held more than 25 levels on either side at `len` 25, and never more than 100 at `len` 100, so a level leaving the window arrives as a delete.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket amount at a price | REST amount at the same price |
|---|---:|---|---|
| `tBTCF0:USTF0` bid | 1 | `0.03459748` at 86724 | `0.03459747` at 86724, read about 3 s later |
| `tBTCF0:USTF0` ask | 1 | `-0.00054604` at 86739 | `-0.00054604` at 86739 |

The unit is the base currency, so a BTC amount is bitcoin, and CCXT's `contractSize` of 1 converts it correctly, at `server/node_modules/ccxt/js/src/bitfinex.js` line 692.
Of the top 20 socket levels per side, 36 and 38 of 40 prices were in the REST book read about 3 s later, and 32 and 36 of 40 had the same amount, so the rest moved between the reads.
The best bid and ask on BTC held 0.035 and 0.0005 BTC, which is a thin touch.

### One-sided and empty books

No one-sided book was seen.
The thinnest were `FRANCE40IXF0:USTF0` with 1 bid and 2 asks and `HONGKONG50IXF0:USTF0` with 1 bid and 2 asks, from the 36 contract batch.
What a side with no orders looks like on the wire is Not verified, and the engine's `resetBook` accepts an empty side.

### Idle repeats

A book never repeats itself.
A quiet book sends only heartbeats: the paper contract `TESTXTZF0` and `EUROPE50IX` went 15 s between frames.
The `status` channel is different: it sent 49 frames in 45 s, and only 17 had a new time, so about two in three are exact repeats of the previous row.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `book` `tNOPEF0:USTF0` | `{"channel":"book","symbol":"tNOPEF0:USTF0","prec":"P0","len":"25","event":"error","msg":"symbol: invalid","code":10300,"pair":"NOPEF0:USTF0"}` |
| `book` `BTCF0:USTF0` without the `t` | acked as `tBTCF0:USTF0` and served |
| `len` `7` | code 10300 `length: invalid` |
| `prec` `P9` | code 10300 `precision: invalid` |
| channel `nope` | code 10300 `channel: unknown` |
| the same book twice | code 10301 `subscribe: dup` with the `chanId` of the first. In both runs this error arrived before the first subscription's own ack, and in the second that ack came after the error replies to requests sent up to 2 s later |
| `status` `deriv:tNOPEF0:USTF0` | no reply at all in 4.5 s |
| `unsubscribe` of an unknown `chanId` | code 10400 `unsubscribe: invalid` |
| event `nope` | code 10000 `event: invalid (nope)` |
| text that is not JSON | no reply, the socket stays open |
| the 37th subscription on a socket | code 10305 `subscribe: limit` |

A delisted contract was not available to probe.
Two conf listed paper contracts, `TESTAPTF0` and `TESTXTZF0`, are missing from the status reply, and `TESTXTZF0` still serves a live book.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | heartbeat every 15 s per channel, client `ping` optional, S1 | heartbeats 14,997 to 15,003 ms apart. `{"event":"pong","ts":…,"cid":…}` in 166 to 200 ms |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed with 1006 and no close frame 60.0 s after it opened, in both runs. A socket with one subscription and no client frame, and a socket that only sent a ping every 20 s, both stayed open for the full hold of 120 s, and of 65 s in the second pass |
| forced disconnect | `info` 20051 asks for a reconnect, S1 | none in the longest hold of 120 s |
| maintenance notice | `info` 20060, then 20061 within "120 seconds at most", S1 | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 509 to 572 ms to open |
| subscription limits | 30 per connection in S1, 25 in S6 | 36 accepted, then 10305 |
| connection rate | 20 per minute on `api-pub`, and a 60 s block when exceeded, S6 | not provoked |
| throughput | | 31 book channels on one socket: 894 frames per second, 24.7 KB per second, 28 bytes per frame, about 1 µs of `JSON.parse` per frame. 36 channels: 966 frames per second, and 1,082 frames and 30.7 KB per second in the second pass |

## 6. Captured frames

Trimmed, from the probe runs.
Arrays marked `…` are cut.

Info, conf acknowledgement and subscribe acknowledgement.

```json
{"event":"info","version":2,"serverId":"fb5877a3-ded1-4754-b9bf-fda9cc751d37","platform":{"status":1}}
```

```json
{"event":"conf","status":"OK","flags":196608}
```

```json
{"event":"subscribed","channel":"book","chanId":943592,"symbol":"tBTCF0:USTF0","prec":"P0","freq":"F0","len":"25","pair":"BTCF0:USTF0"}
```

Snapshot, first three bids kept, with the checksum flag only.

```json
[759362,[[86704,1,0.03460649],[86701,2,0.07296393],[86697,1,0.03650034]]]
```

An ask update, a bid delete, a checksum and a heartbeat.

```json
[759362,[86719,2,-0.03483509]]
```

```json
[759362,[86664,0,1]]
```

```json
[759362,"cs",1330055495]
```

```json
[765277,"hb"]
```

A delete with `SEQ_ALL`, and a bulk update with `TIMESTAMP` and `SEQ_ALL`.

```json
[288922,[86644,0,1],3]
```

```json
[853691,[[86717,0,1],[86816,0,-1],[86647,3,0.05388802],[86735,1,-0.00047262]],2,1790134414850]
```

A snapshot of a thin index perpetual.

```json
[765277,[[6050,1,0.001],[5845.1,1,0.00171083],[6861.7,1,-0.00145736]]]
```

Status row, which carries the anchor fields at the REST positions minus one.

```json
[759363,[1790133734000,null,86710.46123944,86670.5,null,62210384.95685668,null,1790150400000,0.00015317,3873,null,0,null,null,86676.3172,null,null,8851.89352831,null,null,null,0.0005,0.0025]]
```

Ticker.

```json
[761045,[86697,14.34954787,86723,14.75896594,1060,0.01237494,86717,544.3267938,86898,85156,null]]
```

Errors.

```json
{"channel":"book","symbol":"tDOGEF0:USTF0","prec":"P0","len":"25","event":"error","msg":"subscribe: dup","code":10301,"chanId":722711,"pair":"DOGEF0:USTF0"}
```

```json
{"channel":"book","symbol":"tICPF0:USTF0","prec":"P0","freq":"F0","len":"25","event":"error","msg":"subscribe: limit","code":10305,"pair":"ICPF0:USTF0"}
```

Keepalive, as the probe sends it and as S1 documents the answer, since neither frame was written to the capture.

```text
{"event":"ping","cid":<Date.now()>}
{"event":"pong","ts":<server ms>,"cid":<the same cid>}
```

## 7. Private channels

Named for a future execution stage, not probed.
They use `wss://api.bitfinex.com/ws/2` and an `auth` event, S1, and the account stream arrives on channel 0.
CCXT Pro routes the order events `os`, `on`, `ou`, `oc`, the wallet events `ws`, `wu` and the trade event `tu` at `server/node_modules/ccxt/js/src/pro/bitfinex.js` lines 1292 to 1298.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://api-pub.bitfinex.com/ws/2`, for every family kept | one socket serves every family |
| markets kept | the USDt contracts, without the 14 `TESTUSDT` paper contracts | see [`rest.md`](./rest.md) section 2 |
| channel | `book`, `prec` `P0`, `freq` `F0`, `len` `25` | snapshot on subscribe, 25 covers the engine's 20, and `P0` keeps full price precision |
| markets per connection | 25 | the lower documented cap, S6. The wire took 36, so 25 leaves room and matches both documents |
| first frame after open | `{"event":"conf","flags":196608}` | turns on the checksum and the socket sequence |
| subscribe frames | one frame per market, `{"event":"subscribe","channel":"book","symbol":"<rawMarketId>","prec":"P0","freq":"F0","len":"25"}` | one channel per frame is the documented shape |
| routing | a per socket map from `chanId` to `rawMarketId`, filled from each `subscribed` event | data frames carry only the `chanId` |
| snapshot | the first data frame of a `chanId`: `resetBook` | the only snapshot the channel sends |
| update | the COUNT and AMOUNT rule of section 4, then `publish` | documented and matched every checksum |
| gap | `seq !== last + 1` on any array frame: `resync` the socket | `SEQ_ALL` is one counter per socket, so a gap cannot be pinned to one market |
| checksum | compare on every `cs` frame, and `resync` on a mismatch | the only check the documentation promises, since `SEQ_ALL` is beta |
| keepalive | `{"event":"ping","cid":<ms>}` every 20 s | a subscribed socket already gets a heartbeat per channel every 15 s, and the ping costs nothing |
| `maxSilenceMs` | 35,000 | two missed heartbeats plus margin, and an idle socket is closed by the server at 60 s |
| info events | on 20051 reconnect. On 20060 pause, and on 20061 resubscribe every channel | S1 |
| reconnect pacing | at most 20 new sockets per minute across the venue | S6, a breach blocks `api-pub` for 60 s |
| receive time | stamp on arrival | book frames carry no time unless `TIMESTAMP` is set |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |
| bulk updates | leave off | fewer frames, but a bulk update has the snapshot's shape |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitfinex API docs, WebSocket General, updated 2025-09-26 | https://docs.bitfinex.com/docs/ws-general | 2026-09-22 | Bitfinex, global | URLs, subscribe and error codes, 30 subscription limit, info codes, ping, heartbeat, conf flags, sections 1 to 5 and 8 |
| S2 | Bitfinex API docs, Books, updated 2025-06-12 | https://docs.bitfinex.com/reference/ws-public-books | 2026-09-22 | Bitfinex, global | book request fields, precision and length, update rule, bulk updates, sections 2 to 4 |
| S3 | Bitfinex API docs, Raw Books, updated 2025-06-12 | https://docs.bitfinex.com/reference/ws-public-raw-books | 2026-09-22 | Bitfinex, global | `R0` entries, price 0 deletes an order, section 2 |
| S4 | Bitfinex API docs, Status, updated 2026-02-19 | https://docs.bitfinex.com/reference/ws-public-status | 2026-09-22 | Bitfinex, global | `deriv:` and `liq:global` keys, status row fields, section 2 |
| S5 | Bitfinex API docs, Ticker | https://docs.bitfinex.com/reference/ws-public-ticker | 2026-09-22 | Bitfinex, global | ticker channel, section 2 |
| S6 | Bitfinex API docs, Requirements and Limitations, updated 2025-06-10 | https://docs.bitfinex.com/docs/requirements-and-limitations | 2026-09-22 | Bitfinex, global | 20 connections per minute, 25 channels per connection, block times, sections 3, 5 and 8 |
| S7 | Bitfinex API docs, API Derivatives Trading, updated 2025-06-10 | https://docs.bitfinex.com/docs/derivatives | 2026-09-22 | Bitfinex, global | perpetual symbol spelling, section 3 |
| S8 | Bitfinex API docs, WebSocket Checksum, updated 2025-06-10 | https://docs.bitfinex.com/docs/ws-websocket-checksum | 2026-09-22 | Bitfinex, global | checksum construction, section 4 |
| S9 | CCXT Pro 4.5.68 `bitfinex.js` | `server/node_modules/ccxt/js/src/pro/bitfinex.js` | 2026-09-22 | CCXT | public URL at line 36, checksum on by default at line 45, conf flag at line 73, private event names, section 7 |
| P1 | `ws-probe.mjs book`, 75 s at 03:22 UTC, and 45 s at 03:34 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch` with 31 and with 75 subscriptions at 03:23 and 03:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs) | 2026-09-22 | this host | cap, throughput, thin books, sections 3 to 5 |
| P3 | `ws-probe.mjs flags` at 03:26 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs) | 2026-09-22 | this host | `SEQ_ALL`, `TIMESTAMP`, `BULK_UPDATES`, section 4 |
| P4 | `ws-probe.mjs silence`, `errors` and `deflate` at 03:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P5 | second pass: `book` for 45 s at 03:34, `batch` with 40 subscriptions for 20 s, `flags`, `errors`, `deflate`, and `silence` for 65 s, 03:42 to 03:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitfinex/ws-probe.mjs) | 2026-09-22 | this host | the second readings in sections 3 to 5 |
