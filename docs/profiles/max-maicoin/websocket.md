# MAX (MaiCoin) WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:20 to 03:29 UTC, and the second pass 03:35 to 03:39 UTC, from the development host near Seattle.

This profile covers the public spot WebSocket of MAX Exchange, which has no CCXT class, with the `book` channel in detail.
MAX lists no perpetual, so the survey plan's template change 1 applies and the spot book is profiled on the same axes, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/max-maicoin/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every market and quote | `wss://max-stream.maicoin.com/ws`, S1 | open in 646 to 710 ms on every socket timed, 74 of 74 markets deliver on one socket |
| perpetuals, dated futures, options | none, MAX lists none | |

One URL carries every spot market, the M-wallet pool channel and, after `auth`, the private channels.
`max-stream.maicoin.com` resolved to `18.138.159.68`, `13.251.131.139` and `13.229.245.96`, whose reverse names are `ec2-…ap-southeast-1.compute.amazonaws.com`, so the socket is served from AWS Singapore and not through Cloudflare like the REST host.

## 2. Channel matrix for public market data

| channel | subscription | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `book` | `{"channel": "book", "market": "btcusdt", "depth": 50}` | depth 1, 5, 10, 20 or 50, default 50, S2. Pushed on change, no documented interval | snapshot then updates, recommended |
| `trade` | `{"channel": "trade", "market": "btcusdt"}` | on trade | a snapshot of past trades, the oldest about 1 h 40 min old, then 1, 12 and 0 updates in three 60 s runs on `btcusdt` |
| `ticker` | `{"channel": "ticker", "market": "btcusdt"}` | OHLC and volume only, no best bid or ask, S3 | 12 updates in 60 s in each of three runs, and consecutive updates repeated the same values |
| `kline` | `{"channel": "kline", "market": "btcusdt", "resolution": "1m"}` | `1m` to `1d`, S4 | not probed |
| `market_status` | `{"channel": "market_status"}` | every market's state, S5 | one snapshot of all markets, fields `M`, `st`, `bu`, `bup`, `mba`, `qu`, `qup`, `mqa`, `mws`, `gs`, `gsm`, `ds` |
| `pool_quota` | `{"channel": "pool_quota"}` | M-wallet loan pool, S6 | not probed |

No mark, index or funding channel exists, because MAX lists no perpetual.
The best bid and ask come only from `book` at depth 1 or deeper.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | 74 markets of three quote currencies on one socket, section 1 |
| subscribe frame shape | `{"action": "sub", "subscriptions": [{"channel": "book", "market": "btctwd", "depth": 1}, …], "id": "client1"}`, S7 | 74 book subscriptions in one frame got one `subscribed` reply listing all 74, and all 74 snapshots arrived within 835, 875 and 865 ms of the frame in three runs |
| unknown symbol expectation | an error `{"e": "error", "E": [...], "i": ..., "T": ...}`, S1 | `{"e":"error","E":["market nopeusdt does not exist"],"i":"unknown-market","T":…,"co":0}` |
| chunk unit and budget | "rate limit when your request message over 20 per second", "over 200 per minute", "when your ip connection over 600 per hour", S1, and "over 1440 per day", changelog 6.66.0, S8 | one frame of 74 subscriptions was one request and was accepted. No limit was reached |
| keepalive mechanism | a client protocol ping frame. "If server doesn't receive your ping for 130 seconds, the connection will be closed", S1 | the server sent no ping on any socket. A quiet socket with no client traffic closed at 60 s, see section 5. `{"action": "ping"}`, which is not documented, is answered by `{"e":"pong",…}` |
| connection lifetime and maintenance notice | Not publicly specified. The REST system status API at `https://status-api-max.maicoin.com/api/status/max-api` which the documentation says may not show brief outages or WebSocket disconnects in real time, S9 | no lifetime cap met in 90 s, no notice seen |
| handshake and operation rate limits | see the chunk row. A 429 on connect carries `Retry-After` as a Unix time in seconds, and repeating during the penalty extends it, S1 | 20 opens between 03:20 and 03:39 UTC, no refusal |
| public market data authentication | none | none |
| message parse and routing | `c` channel, `e` event, `M` market, S1 | book frames route on `c` and `M`. They carry no `depth`, so two depths of one market on one socket cannot be told apart, section 4 |
| subscribe acknowledgement shape | `{"e": "subscribed", "s": [...], "i": "client1", "T": ...}`, S7 | the same, 211 to 230 ms after the frame was sent. The first snapshots arrived within 2 ms of it, except `gsttwd` at 450 ms in the second pass |
| symbol identifier format | lower case, `btctwd` | the REST `markets` `id`, the REST `depth` `market` parameter and the socket `M` are the same string on all 74 markets |
| number representation | "price and volume should be string", "timestamp and depth should be number", S1 | prices and sizes are strings, `T`, `fi`, `li` and `v` are JSON numbers |
| timestamp representation | `T` in ms | `T` in ms. On the busy `btcusdt` and `btctwd` books, arrival minus `T` was 107 ms at least, 108 to 109 ms at the median and 111 to 113 ms at p90, over two runs. On a snapshot it is the time of the book's last change, 4 h 12 min and 4 h 25 min old on `gsttwd` |
| size unit | base currency | base currency, the same string as the REST book at the same price, section 4 |
| sequence semantics | per market `fi` and `li` with a version `v`. Drop `fi <= li`, the first applied update must satisfy `fi <= li + 1 <= its li`, a different `v` means resubscribe, S2 | on four markets, `fi` equalled the previous `li` plus one on all 1,175 and 1,164 updates of two runs. On 74 markets subscribed in one frame, one run of 6,785 updates was clean, and two runs had 5 and 3 updates skip exactly one id plus 6 and 3 other anomalies, section 4 |
| idle repeat behaviour | Not publicly specified | `book` repeats nothing and sends no empty update. `ticker` repeats unchanged values |

## 4. The book channel in detail

`book` at depth 50 is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first book frame for each subscription is `"e": "snapshot"` with up to 50 bids and 50 asks and the stream's `fi`, `li` and `v`.
Four markets each got exactly one snapshot 215 to 231 ms after the subscribe frame, 450 ms once for `gsttwd`, and no further snapshot in about 60 s, in three runs.
74 markets each got exactly one snapshot in each of three 40 s batch runs.
The snapshot carries `fi` equal to `li`, for example `33590535` on `btcusdt`.
The documentation says a snapshot replaces the local book whenever it comes, and an empty snapshot means clear the book and wait for the next one, S2.

### Delta semantics

An update carries `a` and `b` arrays of `[price, size]` string pairs, and a size of `"0"` removes the level, S2.
An update can batch several ids: `fi` equalled `li` on 256 of 736 `btcusdt` updates, 291 of 419 `btctwd` and 20 of 20 `usdttwd` in the second run, and on 210 of 718, 313 of 426 and 20 of 20 in the third.
No update arrived with both arrays empty, 0 of 23,514 updates over all runs.
Removals of a level the local book did not hold arrived 24 and 27 times on `btcusdt` and 11 and 2 times on `btctwd` in two runs, which the documentation calls normal, S2.

### Sequence and gap rule

```text
e = snapshot                       replace the book, store li and v
e = update, v differs              resubscribe (documented)
e = update, li <= stored li        drop
e = update, fi = stored li + 1     apply, store li
e = update, fi > stored li + 1     gap: resubscribe (documented), or terminate the socket (the engine's resync)
```

The documented rule also accepts `fi <= stored li + 1 <= li`, an update overlapping the stored id, and none arrived.
Four markets subscribed in one frame gave 0 gaps and 0 version changes in two clean runs, 1,175 and 1,164 updates.
A third four market run at 03:20 UTC had 1 gap on `btcusdt`, after the probe subscribed the same market a second time at depth 5, see the last table of this section.

74 markets subscribed in one frame behaved differently in two of three runs.

| run, UTC | updates | `fi` skipped one id | update before its snapshot | version change | other |
|---|---:|---:|---:|---:|---:|
| 03:23 | 6,595 | 5: `arbusdt`, `bnbusdt`, `ondousdt`, `ondotwd`, `bnbtwd` | 6 in total with the version column, which that version of the probe did not split | | 0 |
| 03:24 | 6,785 | 0 | 0 | 0 | 0 |
| 03:37 | 6,513 | 3: `linktwd`, `ondotwd`, `ondousdt` | 3 | 0 | 0 |

In the 03:37 run every skip was the first update after the market's snapshot, with `fi` equal to the snapshot's `li` plus two, and two of them arrived 1 ms after the snapshot.
The 03:23 run did not record which update skipped.
So the skips cluster at subscribe time on a large subscribe frame, and the updates before a snapshot are what the documentation's step 2, "Buffer the events you receive", is for, S2.
A socket level resync on a skip would resubscribe all 74 markets and could meet the same race again, so a per market `unsub` and `sub` is the safer repair.
Whether a skipped id carried a change inside the 50 level window is Not verified, and the 51 level book side in two of these runs suggests it can, as an inference.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | ascending, worst first and best last, on 4 of 4 markets in three runs | ascending, best first, on 4 of 4 |
| update | mostly descending, not sorted: on `btcusdt` 373 descending, 8 ascending and 34 mixed of the arrays with two or more levels, and 332, 4 and 40 in the next run | mostly ascending, not sorted: 354 ascending and 66 mixed, then 358 and 109, never descending |
| REST `depth`, default `sort_by_price=true` | descending, best first | descending, best last |
| REST `depth`, `sort_by_price=false` | descending, best first | ascending, best first |

A feed applies levels by price and never by position, and it cannot take `b[0]` of a snapshot as the best bid.

### Level window

The server keeps the stream at the subscribed depth.
A book kept from the snapshot and every update never held more than 50 levels per side on `btcusdt`, `btctwd` or `usdttwd` in any four market run, and no more than 50 on 74 markets in the clean batch run.
The two batch runs with skipped ids each saw one side reach 51 levels, which fits a removal lost with a skipped id, and that is an inference.
A thin market holds fewer: `gsttwd` had 17 bids and 50 asks.

### Size unit

Sizes are base currency, as strings with up to eight decimals, for example `"0.1102606"` BTC on `btctwd`.
The REST book read with `limit=50&sort_by_price=false` right after the socket had the same `last_update_id` as the socket's `li` on four of six reads and one id apart on the other two, over `btcusdt`, `usdttwd` and `btctwd` in two runs.
The top 20 levels per side matched the socket's size at the same price string on 37, 34 and 34 of 40 levels in one run and 35, 37 and 35 in the other, and the best bid and ask matched on all six reads.
The misses are levels that changed between the two reads, or prices the two sources spell differently: REST sent the `btctwd` best bid as `"2750938.0"` where the socket sent `"2750938"`.
So a feed keys levels by the numeric price, never by the string.
A spot market has no contract size, so an engine `sizeMul` of 1 would be right.

### One-sided and empty books

No one-sided or empty book was seen on any of the 74 markets, and the thinnest snapshot side held 1 level.
The documentation asks a client to clear the book on an empty snapshot, S2.

### Idle repeats

Nothing is repeated on `book`.
`usdttwd` went 11.1 s, 12.2 s and 7.7 s without a book frame in three runs, and across the three 74 market runs the longest silence of one market was 31.5 s, 29.3 s and 23.9 s.
11, 6 and 8 markets sent no update at all in 40 s.
The `ticker` channel sent the same open, high, low, close and volume again in consecutive updates.

### Unknown, duplicate and malformed requests

| request | reply | then |
|---|---|---|
| `book` on `nopeusdt` | `"E":["market nopeusdt does not exist"]` | the socket stays open |
| `book` at depth 30 | `"E":["depth 30 is not supported"]` | |
| channel `nope` | `"E":["channel nope does not exist"]` | |
| action `nope` | `"E":["E-1004: invalid action"]` | |
| text that is not JSON | `"E":["E-1005: invalid json"]`, with `"i":""` | the socket stays open |
| `book` on `btcusdt` depth 50 again on the same socket | `subscribed`, and a fresh snapshot | no update id arrived twice in the next 3 s |
| `book` on `btcusdt` depth 5 beside depth 50 | `subscribed`, and a snapshot of 5 levels per side | both streams deliver with the same `M` and no depth field, and 2 and 3 update ids arrived twice in 3 s in two runs |

Every error frame carried `"co":0`.
A closed or suspended market was not available to probe, since all 74 were `active`.
A feed therefore subscribes each market once, at one depth, per socket.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client protocol ping, server answers pong, 130 s allowed without a ping, S1 | no server ping on any socket. A protocol ping was answered in 211 to 262 ms. `{"action":"ping","id":"app-ping"}` was answered with `{"e":"pong","i":"app-ping","T":…}` |
| silence the server tolerates | 130 s without a client ping, S1 | a socket subscribed to the quiet `gsttwd` book, which sent nothing after its snapshot, closed with code 1006 and no close frame at 60.21 to 60.22 s in three runs, and a socket with no subscription closed at 60 s. A socket on the busy `btcusdt` book with no client ping stayed open for the full 90 s in two runs. A quiet socket with a protocol ping or an application ping every 40 s stayed open for the full 90 s in two runs, each ping answered at 40.2 and 80.2 s |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | text JSON frames when the client refuses deflate. A client that offered permessage-deflate got `permessage-deflate; server_no_context_takeover; client_no_context_takeover` back, so the server negotiates it when asked |
| handshake | | 646 to 710 ms to open from this host |
| subscription limits | Not publicly specified | 74 book subscriptions on one socket, every market listed, with no refusal |
| throughput | | 74 markets at depth 50 over three runs: median 159, 170 and 163 frames a second, peak 272, 282 and 295, 27.0 to 28.2 KB a second, 164 to 166 bytes a frame, 10.7 to 11.8 µs `JSON.parse` a frame |

The 60 s close is what matters for a feed.
It fits an idle timeout on traffic in either direction rather than the documented 130 s ping rule, because a busy book kept a socket without pings alive and a ping every 40 s kept a quiet one alive.
An AWS load balancer's default idle timeout is 60 s, which would explain it, and that is an inference.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe.

```json
{"action": "sub", "subscriptions": [{"channel": "book", "market": "btcusdt", "depth": 50}, {"channel": "book", "market": "usdttwd", "depth": 50}, {"channel": "ticker", "market": "btcusdt"}, {"channel": "trade", "market": "btcusdt"}, {"channel": "market_status"}], "id": "probe-book"}
```

Acknowledgement, cut to the first two entries of `s`.

```json
{"e":"subscribed","s":[{"channel":"book","market":"btcusdt","depth":50},{"channel":"book","market":"usdttwd","depth":50}],"i":"probe-book","T":1790133751867}
```

Snapshot, cut to the first three asks and the first two and last two bids.
The bids run from the worst up to the best, `86698.67`.

```json
{"c":"book","M":"btcusdt","e":"snapshot","a":[["86709.43","0.023069"],["86709.57","0.023069"],["86710.2","0.011534"]],"b":[["86168.22","0.010628"],["86172.41","0.000798"],["86664.79","0.081978"],["86698.67","0.009002"]],"T":1790134556654,"fi":33590535,"li":33590535,"v":1789119123083}
```

Update, bids arriving in descending order here.

```json
{"c":"book","M":"btcusdt","e":"update","a":[],"b":[["86353.01","0"],["86043.83","0.000231"]],"T":1790133752143,"fi":33564338,"li":33564345,"v":1789119123083}
```

Ticker update, which carries no bid or ask.

```json
{"c":"ticker","M":"btcusdt","e":"update","tk":{"M":"btcusdt","O":"85400.0","H":"86775.51","L":"85114.3","C":"86618.11","v":"15.7087","V":"15.7087"},"T":1790133756019}
```

Application ping and its answer.

```json
{"action": "ping", "id": "app-ping"}
```

```json
{"e":"pong","i":"app-ping","T":1790133799666}
```

Errors.

```json
{"e":"error","E":["market nopeusdt does not exist"],"i":"unknown-market","T":1790133796867,"co":0}
```

```json
{"e":"error","E":["E-1005: invalid json"],"i":"","T":1790133800368,"co":0}
```

## 7. Private channels

Named for a future execution stage, from S10, not probed.
They use the same URL after `{"action": "auth", "apiKey": "...", "nonce": 1591690054859, "signature": "....", "id": "client-id"}`, with an optional `filters` array.

- Filters `order`, `trade`, `account`, `trade_update` and `fast_trade_update`, with `order`, `trade` and `account` as the default.
- M-wallet filters `mwallet_order`, `mwallet_trade`, `mwallet_fast_trade_update`, `mwallet_account`, `ad_ratio` and `borrowing`, which have to be named explicitly, S11.

## 8. Recommended feed shape

None for the engine, because MAX lists no perpetual and the engine trades perpetual legs only.
If a later design adds spot legs, the shape the probes support is the following, as a recommendation and not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://max-stream.maicoin.com/ws` | one URL serves every market |
| channel | `book`, depth 50 | snapshot on subscribe, an id chain, 50 levels covers the engine's 20 at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61 |
| markets per connection | all 74 on one socket | 74 ran on one socket at a median 159 to 170 frames a second |
| subscribe frames | frames of four markets, `{"action": "sub", "subscriptions": [{"channel": "book", "market": "<id>", "depth": 50}, …], "id": "<slice>"}`, one every 100 ms, 19 frames for 74 markets | four market frames gave no skip, and one 74 market frame gave 3 to 5 skipped first updates in two of three runs. Nineteen frames in 1.9 s stay under 20 a second and 200 a minute. Frames between 4 and 74 markets are untested |
| keepalive | `{"action": "ping", "id": "<slice>"}` every 20 s | the socket dies after 60 s without traffic, and the `{"e":"pong"}` reply is a message frame the silence watch sees |
| `maxSilenceMs` | 45,000 | two missed pongs. A quiet book can go more than 30 s without a frame, so the pong has to count |
| routing | `c === "book"`, key `M` | `M` equals the REST market id |
| snapshot | `e === "snapshot"`: `resetBook` from both arrays by price, store `li` and `v` | snapshot bids arrive worst first |
| update before the snapshot | buffer it, then apply it after the snapshot by the same rule | documented step 2, and 3 such updates arrived in one 74 market run |
| update | drop when `li <= stored`, apply when `fi <= stored + 1 <= li`, then store `li` | documented rule, 0 gaps in 2,339 updates of the two clean four market runs |
| resync | `fi > stored + 1` or a different `v`: `unsub` and `sub` that one market, and fall back to `resync`, which terminates the socket and resubscribes, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 296, only if the market fails again | documented as resubscribe. The skips cluster on the first update after a snapshot, so a socket wide resync of every market could meet the same race again. The per market path is a change to the engine's resync, which today works per socket |
| receive time | stamp on arrival, never from `T` | a snapshot's `T` is the last change, hours old on a quiet market |
| deflate | keep `perMessageDeflate: false`, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 | the server negotiates deflate only when the client offers it |
| depth | subscribe each market once at one depth | frames carry no depth, so a second depth on one socket interleaves |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | MAX Exchange WebSocket API, introduction | https://maicoin.github.io/max-websocket-docs/ | 2026-09-22 | MAX | endpoint, rate limits, ping rule, `Retry-After`, key aliases, error shape, sections 1 to 5 |
| S2 | Order book subscription | https://maicoin.github.io/max-websocket-docs/public_orderbook.md | 2026-09-22 | MAX | depths, snapshot and update, the `fi`, `li` and `v` rule, empty snapshot, section 4 |
| S3 | Ticker subscription | https://maicoin.github.io/max-websocket-docs/public_ticker.md | 2026-09-22 | MAX | ticker fields, section 2 |
| S4 | Kline subscription | https://maicoin.github.io/max-websocket-docs/public_kline.md | 2026-09-22 | MAX | resolutions, section 2 |
| S5 | Market status subscription | https://maicoin.github.io/max-websocket-docs/public_market_status.md | 2026-09-22 | MAX | states `active`, `suspended`, `cancel-only`, section 2 |
| S6 | MWallet pool quota subscription | https://maicoin.github.io/max-websocket-docs/public_mwallet_pool_quota.md | 2026-09-22 | MAX | channel name, section 2 |
| S7 | Public channel subscription | https://maicoin.github.io/max-websocket-docs/public_channels.md | 2026-09-22 | MAX | subscribe and acknowledgement shapes, section 3 |
| S8 | WebSocket changelog | https://maicoin.github.io/max-websocket-docs/changelog.md | 2026-09-22 | MAX | 1,440 connections a day, `Retry-After` from 25.14.0, the `v` check from 25.12.0, section 3 |
| S9 | MAX V3 RESTful API List, section on the system status API | https://max-api.maicoin.com/doc/v3.html | 2026-09-22 | MAX | status endpoint and its WebSocket caveat, section 3 |
| S10 | Authentication for private channels | https://maicoin.github.io/max-websocket-docs/authentication.md | 2026-09-22 | MAX | `auth` frame and filters, section 7 |
| S11 | MWallet private channels subscription | https://maicoin.github.io/max-websocket-docs/private_channels_mwallet.md | 2026-09-22 | MAX | M-wallet filters, section 7 |
| P1 | `ws-probe.mjs book`, two runs at 03:20 and 03:22 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/max-maicoin/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs batch`, two runs at 03:23 and 03:24 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/max-maicoin/ws-probe.mjs) | 2026-09-23 UTC | this host | 74 markets on one socket, the one id skips, sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, at 03:25 UTC with an earlier two socket version, and at 03:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/max-maicoin/ws-probe.mjs) | 2026-09-23 UTC | this host | the 60 s idle close, section 5 |
| P4 | `ws-probe.mjs deflate` at 03:20 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/max-maicoin/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, section 5 |
| P5 | second pass: `ws-probe.mjs book` at 03:35, `deflate` at 03:36, `batch` at 03:37 and `silence` at 03:37 to 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/max-maicoin/ws-probe.mjs) | 2026-09-23 UTC | this host | the third book run, the third batch run with its skips, the snapshot frame, the second silence and deflate readings, sections 2 to 6 |
