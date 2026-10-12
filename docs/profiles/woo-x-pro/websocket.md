# WOO X Pro WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 02:23 to 02:32 UTC on 2026-10-10 and again from 02:37 to 02:42 UTC in the second pass, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures WebSocket of WOO X Pro (no CCXT class) for every perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/woo-x-pro/ws-probe.py), run with `uv run scripts/probes/venues/woo-x-pro/ws-probe.py <mode>`, and the capture is quoted beside the documented value.
The protocol is BitMart's futures v2 socket under another host name, and the axes below match what [`../bitmart/websocket.md`](../bitmart/websocket.md) recorded for BitMart on 2026-09-22, with one exception.
BitMart kept a silent socket open for 75 s, and WOO X Pro closed one at 60 s, see section 5.
The socket is live, while the documented REST book is frozen on most contracts, see [`rest.md`](./rest.md) section 5, so the socket is the only public source of a usable book.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all public futures data | `wss://cloud-ws.wooxpro.com/api?protocol=1.1`, S1 | opens in 256 to 357 ms over both runs, through Cloudflare (`Server: cloudflare`) |
| private | `wss://cloud-ws.wooxpro.com/user?protocol=1.1`, S1 | not probed |

One socket carries every family.
`BTCUSDT`, `BTCUSD` (coin-M) and `BTCUSDC` all delivered on the same socket in the `book` mode.
`cloud-ws.wooxpro.com` resolved to `104.18.16.209` and `104.18.17.209`, the same Cloudflare addresses as the REST host.

## 2. Channel matrix for public market data

| channel | topic | depth and speed | probed on 2026-10-10 UTC |
|---|---|---|---|
| `futures/depthIncrease{5,20,50}` | `futures/depthIncrease50:BTCUSDT@100ms` | 5, 20 or 50 levels, `@100ms` or `@200ms` | snapshot then updates with `version`, one push a second at either speed, recommended |
| `futures/depthAll{5,20,50}` | `futures/depthAll50:BTCUSDT@100ms` | whole book each push | 11 and 12 frames in 12 s in two runs |
| `futures/depth{5,20,50}` | `futures/depth50:BTCUSDT@100ms` | one frame per side, marked `way` 1 bid or 2 ask | 22 and 24 frames in 12 s, a bid frame and an ask frame each second |
| `futures/bookticker` | `futures/bookticker:BTCUSDT` | best bid and ask | 11 and 12 frames in 12 s, one a second, although S2 says "Real-time push" |
| `futures/ticker` | `futures/ticker:BTCUSDT`, or `futures/ticker` alone for every contract | carries `mark_price` and `index_price` | 4 frames in 12 s for one contract in both runs, 95.3 and 96.6 frames a second across 299 and 305 contracts without a symbol |
| `futures/fundingRate` | `futures/fundingRate:BTCUSDT` | rate, estimate, cap | a frame on subscribe and, in the first run, one 4.35 s later, against "pushed every minute" in S3. In the second run no second frame came in 12 s |
| `futures/trade` | `futures/trade:BTCUSDT` | each trade | 18 and 12 frames in 12 s |
| `futures/klineBin1m` and other kline channels | | | not probed |

The channel names, topics and speeds are from S2 and S3.
No dedicated mark or index channel exists.
`futures/ticker` without a symbol is the only bulk source of the mark price, see section 4 and [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | USDT-M, USDC-M and coin-M on one socket, section 1 |
| subscribe frame shape | `{"action":"subscribe","args":["<channel>:<symbol>@<speed>"]}`, several topics in `args`, S4 | seven topics in one frame each got their own acknowledgement and each delivered |
| unknown symbol expectation | `success` false with `group [...] not exist`, S4 | `{"action":"subscribe","group":"futures/depthIncrease50:NOPEUSDT@100ms","success":false,"error":"Invalid channel: not found futures/depthIncrease50:NOPEUSDT@100ms",...}`. A delisted symbol (`CKBUSDT`), a lowercase symbol, the speed `@50ms` and the channel `futures/depth30` answer the same |
| chunk unit and budget | "the total length of multiple channels cannot exceed 4096 bytes", S5 | a 1,992 byte frame of 64 topics was accepted with 64 acknowledgements in both runs. Every frame from 2,085 to 4,486 bytes closed the socket, with code 1009 or with no close frame, and which one varied between runs |
| keepalive mechanism | send a ping frame or the text `ping` after N < 20 s of quiet, expect `pong`, S6 | the text `ping` is refused with `{"success":false,"error":"Invalid message: message must be JSON: ping"}`. `{"action":"ping"}` answers `{"group":"System","data":"pong+<uuid>"}`, and a protocol ping got a protocol pong in 165 to 257 ms over two runs |
| connection lifetime and maintenance notice | a socket with no data is "automatically disconnected after 20s", and one that subscribes nothing "within 5 seconds" is closed, S6 | a socket that never subscribed and never sent closed at 60.0 s, and one that subscribed a quiet book and never sent closed at 60.2 s, both with no close frame, the same in both runs. Sockets that pinged every 10 s were still open at 75 s. No maintenance message was seen |
| handshake and operation rate limits | "A maximum of 500 connections can be maintained between each IP", S6 | not approached, at most five sockets at once |
| public market data authentication | none | none |
| message parse and routing | `{"group": "<topic>", "data": {...}}`, S4 | route on `group`, which repeats the topic with its `@100ms`, or on `data.symbol` |
| subscribe acknowledgement shape | `{"action":"subscribe","group":"<topic>","success":true,"request":{...}}`, S4 | as documented, one acknowledgement per topic, each echoing the whole `request` with every topic of the frame |
| symbol identifier format | `BTCUSDT` | identical to the REST catalog `symbol` on all 100 subscribed contracts |
| number representation | prices and volumes as strings, S2 | `{"price":"82587.8","vol":"17713"}` objects. `version` and `ms_t` are JSON integers |
| timestamp representation | `ms_t` in ms, S2 | `ms_t` in ms on a one second grid, for example `1791599055017`, `1791599056018`, `1791599057021` |
| size unit | "volume", S2 | contracts, on the same scale as the web front end's own book and the catalog `contract_size`, section 4 |
| sequence semantics | `version` must be local plus one, else request a new snapshot, S2 | 0 gaps and 0 repeats in 4,890 and 4,984 updates on 100 contracts over 60 s in two runs, and `version` rises by one per push |
| idle repeat behaviour | not documented | a quiet book sends updates with empty `bids` and `asks` that still advance `version`, 82 of 4,890 and 57 of 4,984 updates |

## 4. The book channel in detail

`futures/depthIncrease50:<symbol>@100ms` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Cadence

Every book channel pushed once a second, whatever the speed suffix.
Over 100 contracts in 60 s the step between consecutive `ms_t` values had a median of 1,000 ms in both runs, a minimum of 321 and 468 ms, and a maximum of 8,001 and 20,998 ms.
`BTCUSDT` and `ETHUSDT` each sent 59 and then 60 updates in 60 s, with steps of 332 to 1,034 ms.
So a quiet contract can go 21 s without a frame, while a socket carrying all live contracts receives frames every second.
`depthIncrease20@200ms`, `depthAll50@100ms` and `bookticker` all arrived on the same one second beat in the `channels` mode.

### Snapshot on subscribe

All 100 contracts sent `type` `snapshot` first, and for `BTCUSDT` it arrived within 10 ms of the acknowledgement.
No second snapshot arrived in 60 s.
S2 documents a `request` action that sends a fresh snapshot without resubscribing.
The probe sent one, but on a socket that also carried `depthAll50` and `depth50` its reply could not be told apart from their full books, so the action is documented and not confirmed.

### Delta semantics

An update carries absolute sizes per price, and `"vol":"0"` removes the level, S2.
Updates carry both sides in one frame, `bids` and `asks`, either of which may be empty.

### Sequence and gap rule

S2: an update whose `version` is at most the local one is dropped, one that is exactly one higher is applied, and anything higher means a gap.
On a gap the documented remedy is a `request` for a new snapshot, and the engine's `resync` that reopens the socket serves as well.
The probe saw 0 gaps and 0 repeated versions in 4,890 and 4,984 updates.

### Checksum

None is documented or sent.

### Level order on the wire

Snapshots list bids from the highest price down and asks from the lowest up, on all 100 snapshots.
Updates list only the changed levels.

### Level window

Snapshots carried a median of 34 and 35 bid levels in two runs and a maximum of 50.
`BTCUSDT`, `ETHUSDT` and `BTCUSD` carried 50 a side.
S2 warns that levels outside the first snapshot that never change are never sent, so a long-lived local book may differ from the venue's beyond the window.

### Size unit against the catalog contract size

`vol` counts contracts.
The `BTCUSDT` best ask on the socket read 17,713 at 82,587.8, and the web front end's own depth call read 19,316 at 82,602.2 a minute earlier, on the same scale.
The catalog gives `BTCUSDT` a `contract_size` of `0.001` BTC, so 17,713 contracts are 17.7 BTC.
The documented REST book cannot serve as a check, because it is frozen, see [`rest.md`](./rest.md) section 5.

### One-sided and empty books

`ASTEROIDETHUSDT` sent a snapshot with 1 bid and 0 asks and no update in 60 s.
`THETAUSDT`, `Trading` with no 24 h volume, was acknowledged and sent `{"symbol":"THETAUSDT","asks":[],"bids":[],"ms_t":1791599231055,"version":3,"type":"snapshot"}`.

### Idle repeats

82 of 4,890 and 57 of 4,984 updates had empty `bids` and `asks` and still advanced `version`.
A feed should apply them as no-ops and treat them as liveness.

### Unknown, closed and wrong-level symbols

All five refusals in the axes table name the topic, and the socket stays open after each.
A delisted symbol is refused like an unknown one.
A frame that is not JSON gets `{"success":false,"error":"Invalid message: message must be JSON: not json"}` and the socket stays open.

## 5. Session

| item | probed |
|---|---|
| keepalive | `{"action":"ping"}` every 10 s kept a socket open for 75 s in both runs, each answered with `{"group":"System","data":"pong+<uuid>"}`. A protocol ping also kept one open. So did the refused text `ping`, since each refusal is a frame, which makes it a poor liveness check |
| silence tolerated | about 60 s, not the documented 20 s or 5 s. A socket with nothing subscribed, and a socket whose only subscription was an idle book, both closed at 60 s without a close frame |
| compression | none. Permessage-deflate was not negotiated even when the client offered it, and every frame was plain text JSON |
| forced disconnects | none in 75 s on a pinged socket |
| maintenance notices | none seen and none documented |
| subscribe frame cap | about 2,000 bytes on the wire, about half the documented 4,096 |

## 6. Captured frames

Subscribe acknowledgement, from the `channels` mode:

```json
{"action":"subscribe","group":"futures/depthIncrease20:BTCUSDT@100ms","success":true,"request":{"action":"subscribe","args":["futures/depthIncrease20:BTCUSDT@100ms","futures/ticker:BTCUSDT","futures/bookticker:BTCUSDT"]}}
```

Snapshot from the second run of the `book` mode, trimmed to two levels a side:

```json
{"data":{"symbol":"BTCUSDT","asks":[{"price":"82620","vol":"18035"},{"price":"82620.1","vol":"735"}],"bids":[{"price":"82619.9","vol":"19064"},{"price":"82619.8","vol":"759"}],"ms_t":1791599886539,"version":6624119,"type":"snapshot"},"group":"futures/depthIncrease50:BTCUSDT@100ms"}
```

Update, whole frame, from the quick check before the probes:

```json
{"data":{"symbol":"BTCUSDT","asks":[{"price":"82587.8","vol":"17197"}],"bids":[{"price":"82587.7","vol":"9801"}],"ms_t":1791599055017,"version":6623288,"type":"update"},"group":"futures/depthIncrease20:BTCUSDT@100ms"}
```

Ticker without a symbol, the mark source:

```json
{"data":{"symbol":"BTCUSDT","last_price":"82592","volume_24":"47068870","range":"0.0084517910910649","mark_price":"82592.21328986","index_price":"82633.1423913","ask_price":"82592.1","ask_vol":"15778","bid_price":"82592","bid_vol":"1751"},"group":"futures/ticker:BTCUSDT"}
```

Funding rate, the frame on subscribe:

```json
{"data":{"symbol":"BTCUSDT","fundingRate":"0.0001034","fundingTime":1791599215000,"nextFundingRate":"0.0000804","nextFundingTime":1791619200000,"funding_upper_limit":"0.0375","funding_lower_limit":"-0.0375","ts":1791599215669},"group":"futures/fundingRate:BTCUSDT"}
```

`fundingTime` was the current second, not the upcoming settlement S3 describes.
`nextFundingTime` was 08:00 UTC, the next settlement.

Keepalive answer to `{"action":"ping"}`:

```json
{"group":"System","data":"pong+96c3d496-4456-48c8-a068-694b28336ecc"}
```

Error, the answer to the text `ping`:

```json
{"success":false,"error":"Invalid message: message must be JSON: ping"}
```

## 7. Private channels

`wss://cloud-ws.wooxpro.com/user?protocol=1.1` with `{"action":"access","args":[apiKey, timestamp, sign, "web"]}`, then `futures/asset`, `futures/position` and `futures/order`, S1 and S4.
Not probed.

## 8. Recommended feed shape

| item | value |
|---|---|
| URL plan | one URL, `wss://cloud-ws.wooxpro.com/api?protocol=1.1`, for every family |
| channel | `futures/depthIncrease50:<symbol>@100ms`, 50 levels, snapshot on subscribe |
| markets per connection | all live contracts fit one connection. The 100 live contracts went out in 3 subscribe frames of at most 1,799 bytes |
| subscribe frames | keep each frame under about 1,900 bytes, since 2,085 bytes closed the socket |
| keepalive | `{"action":"ping"}` every 15 s. The text `ping` is refused |
| `maxSilenceMs` | 10,000 for a connection that carries all live contracts, which receives frames every second. A single quiet contract went up to 20,998 ms without a frame, so a per contract silence rule must be looser, about 30,000 |
| resync | on `version` not equal to the local one plus one, resync. A `version` at or below the local one is dropped |
| skip | contracts whose snapshot is empty or one-sided, which the engine treats as no book |
| mark source | a second socket, or the same one, on `futures/ticker` without a symbol, see [`rest.md`](./rest.md) section 8 |

## 9. Source ledger

| id | source | url | retrieved | applies to | used for |
|---|---|---|---|---|---|
| S1 | Developer docs: WebSocket Overview and Login | https://developer.wooxpro.com/english/websocket/overview.md and https://developer.wooxpro.com/english/websocket/login.md | 2026-10-09 | futures socket | URLs, private login |
| S2 | Developer docs: Depth Channel, Depth-All, Depth-Increase, Book Ticker | https://developer.wooxpro.com/english/websocket/depth.md | 2026-10-09 | futures socket | book channels, version rule |
| S3 | Developer docs: Ticker and Funding Rate channels | https://developer.wooxpro.com/english/websocket/ticker.md and https://developer.wooxpro.com/english/websocket/funding-rate.md | 2026-10-09 | futures socket | mark, index, funding |
| S4 | Developer docs: Format | https://developer.wooxpro.com/english/websocket/format.md | 2026-10-09 | futures socket | frame shapes, errors |
| S5 | Developer docs: Subscription | https://developer.wooxpro.com/english/websocket/subscribe.md | 2026-10-09 | futures socket | 4,096 byte limit |
| S6 | Developer docs: Stay Connected And Limit | https://developer.wooxpro.com/english/websocket/limit.md | 2026-10-09 | futures socket | keepalive, silence, connections |
| P1 | `ws-probe.py book` at 02:27 and 02:38 UTC | [`ws-probe.py`](../../../scripts/probes/venues/woo-x-pro/ws-probe.py) | 2026-10-09 | this host | sections 3 and 4 |
| P2 | `ws-probe.py channels`, `framecap` and `deflate` at 02:26 and 02:27 UTC, and 02:37 UTC in the second pass | [`ws-probe.py`](../../../scripts/probes/venues/woo-x-pro/ws-probe.py) | 2026-10-09 | this host | sections 2, 3, 5 and 6 |
| P3 | `ws-probe.py ticker` at 02:28 and 02:39 UTC | [`ws-probe.py`](../../../scripts/probes/venues/woo-x-pro/ws-probe.py) | 2026-10-09 | this host | the mark source |
| P4 | `ws-probe.py silence` at 02:30 and 02:40 UTC | [`ws-probe.py`](../../../scripts/probes/venues/woo-x-pro/ws-probe.py) | 2026-10-09 | this host | section 5 |
