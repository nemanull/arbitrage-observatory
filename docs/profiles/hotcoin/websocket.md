# Hotcoin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:23 to 03:51 UTC in two passes, from the development host near Seattle.

This profile covers the public perpetual WebSocket of Hotcoin for every perpetual family, with the book channel in detail.
CCXT 4.5.68 has no Hotcoin class, and CCXT Pro has none either, see [`fees.md`](./fees.md) section 8.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hotcoin/ws-probe.mjs), labelled P1 with its mode, and the capture is quoted beside the documented value.
The documentation is the "Subscribe to contract push" section of the official API site, S1.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M, USDC-M and coin-M perpetuals | `wss://wss-ct.hotcoin.fit`, S1 "WebSocket Domain Name" | open in 556 to 697 ms on the 14 sockets whose open was logged. `btcusdt`, `ethusdt`, `sophusdt`, `jpn225usdt`, `qcomusdt`, `btcusdc` and `xrpusd` all delivered on one socket |
| dated futures | none documented | not probed |

One socket carries every family, crypto and TradFi alike.
`wss-ct.hotcoin.fit` resolved to `8.214.79.123` on 2026-09-23.
The upgrade reply carried only `date`, `connection`, `upgrade`, `sec-websocket-accept` and `strict-transport-security`, and no `sec-websocket-extensions`.
Nothing refused this US host.

## 2. Channel matrix for public market data

Every subscription is `{"event": "subscribe", "params": {"biz": "perpetual", "type": <type>, "contractCode": <code>, "zip": false, "serialize": false}}`, one topic per frame, S1.

| `type` | scope | payload | probed on 2026-09-23 UTC over 45 s |
|---|---|---|---|
| `depth` | one contract | `{"asks": [[price, size, cumulative]…], "bids": […]}`, 50 levels a side, a whole window every push | 3.96 and 3.98 frames a second on `btcusdt`, 0.40 and 0.49 on `jpn225usdt`, section 4. Recommended |
| `ticker` | one contract | one array of 15 fields, which read against the catalog as time, high, low, 24 h contracts, 24 h turnover, open, last, and more | 144 and 142 frames on `btcusdt`, median gap 207 and 311 ms |
| `tickers` | all contracts | arrays of the same 15 fields | 18 and 17 frames, median gap 3,025 and 2,996 ms, 21,169 to 124,150 bytes |
| `fund_rate` | one contract | one array of 19 fields, below | 18 and 20 frames on `btcusdt`, median gap 2,176 and 2,155 ms, max 4,787 and 4,724 ms |
| `fund_rates` | all contracts | arrays of the same 19 fields, 968 rows | 17 and 16 frames, gaps 2,546 to 3,538 ms, median 3,023 and 2,993, 131,022 to 131,267 bytes |
| `fills` | one contract | `[[price, size, side, time, 0]…]` | 193 and 220 frames on `btcusdt` |
| `candles`, `mark_candles` | one contract, with `granularity` | | not probed |

The `fund_rates` rows are keyed by the lowercase contract code, and S1 names their fields: "[0] Contract Code, [1] Marked Price, [2] Indexed Price, [3] Funding Rate, [4] Estimated Funding Rate, [5] Next Settlement Time, [6] Current Open Interest, [7] Indexed Price Converted to CNY, [8] Marked Price Converted to CNY, [9] ENV, [10] Base Currency, [11] Quote Currency, [12] Settlement Currency, [13] to [15] display names".
The wire rows have 19 fields, and fields 16 to 18 are undocumented, P1 `channels`.

| field | documented | probed against REST read in the same run |
|---|---|---|
| 3 | "Funding Rate" | equalled the catalog `fund`, the last settled rate, on 585 of 585 listed contracts in both runs |
| 4 | "Estimated Funding Rate" | equalled `estimateFeeRate` of `premiumIndex` on `btcusdt` in both runs: −0.00011118132712528001, then −0.00011342294343242668 |
| 5 | "Next Settlement Time" | a countdown in ms: frame `timestamp` plus field 5 fell within 1 s of the catalog `liquidationTime` on 585 of 585 in both runs |
| 17 | not documented | 2 on all 585 listed contracts in both runs |
| 18 | not documented | equalled the catalog last price on 240 and 278 of 585, read at a different instant, so it reads as the last price |

The 383 rows beyond the catalog are delisted contracts, and all 383 carry a negative countdown, P1 `channels`.
The last frame's `timestamp` was 473 ms old on arrival, and 98 ms in the rerun.
The `btcusdt` mark and index changed on 13 of 16 consecutive frame pairs, and on 13 of 15 in the rerun, P1 `channels`.
So `fund_rates` is a bulk anchor push of mark, index, settled rate, upcoming rate and next settlement, every 3 s, see [`rest.md`](./rest.md) section 3.
It has no interval field.
S1 lists `fund_rate` and `fund_rates` a second time under "need to log in", but both delivered on a socket that never signed in.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one domain, S1 | one socket delivered USDT-M, USDC-M, coin-M and TradFi contracts, section 1 |
| subscribe frame shape | `{"event": "subscribe", "params": {"biz": "perpetual", "type": "depth", "contractCode": "ethusdt", "zip": false, "serialize": false}}`, one topic per frame, S1 | as documented, 300 frames each with one topic, all acked |
| unknown symbol expectation | Not publicly specified | `depth` on `nopeusdt` is acked with `"result":true` and then sends nothing. A `depth` with no `contractCode` is acked and then answered `{"error_code":500,"error_msg":"exception","result":false}` |
| chunk unit and budget | Not publicly specified | 150 subscribe frames in one burst, then 150 more on the same socket 30 s later, all 300 acked and all 300 delivering |
| keepalive mechanism | client sends `{"event": "ping"}` and gets `{"event": "pong"}`. "Otherwise, after 5 minutes, the user will not receive any pushes", S1 "Maintenance" | pong in 180 and 210 ms. No server ping on any socket. A protocol ping got a protocol pong. A socket that neither subscribed nor sent closed at 59,996 and 60,002 ms with 1006. The 5 minute rule was not tested, since no socket was held past 120 s |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 120 s, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | opens took 556 to 697 ms, and 300 subscribe frames drew no refusal in either run |
| public market data authentication | none | none |
| message parse and routing | pushes carry `biz`, `type`, `contractCode`, `env`, `timestamp` and `data`, S1 | as documented. A push has no `channel` key, and an ack has `"channel": "subscribe"`, so route on `channel`, then `type`, then `contractCode` |
| subscribe acknowledgement shape | `{"biz", "data": {"result": true}, "channel": "subscribe", "type", "env", "contractCode"}`, S1 | as documented. The unsubscribe ack drops `contractCode` and adds `"subType":"depth","subResult":true`. On `depth` the first snapshot arrived 0 to 1 ms after the ack on seven of seven streams |
| symbol identifier format | examples show `ethusdt` in requests and `LTCUSDT` in a push, S1 | pushes echo the lowercase catalog `code`. A subscription sent as `BTCUSDT` is acked as `BTCUSDT`, its first frame echoes `BTCUSDT`, and the later frames echo `btcusdt`, 1 against 5 frames and 1 against 6 in the rerun |
| number representation | `String[]`, S1 | price, size and cumulative size are strings, `timestamp` is an integer |
| timestamp representation | `timestamp` in ms, S1 | arrival minus `timestamp` was 84 to 267 ms with a median of 85 to 86 ms on every contract, and 92 to 275 ms with a median of 93 to 94 ms in the rerun. A frame identical to its predecessor still carried a new `timestamp`, so it is the push time and not the time of the book |
| size unit | "(Cont)", S1 | contracts of `unitAmount` coins, or of `unitAmount` USD on coin-M, section 4 |
| sequence semantics | none documented | no sequence or update id in any frame, and every frame is a whole 50-level window |
| idle repeat behaviour | not documented | a frame identical to the one before it came 10 times in 178 `btcusdt` frames, 11 in 55 `sophusdt`, 17 in 114 `btcusdc`, and 1 in 18 `jpn225usdt`, and 5, 8, 16 and 0 times in the rerun. The quiet `jpn225usdt` went up to 4,540 and 4,581 ms without a frame |

## 4. The book channel in detail

`depth` is the only book channel, and every row below is about it.

### Snapshot on subscribe

Every frame is a snapshot.
The first frame for a stream arrived 0 to 1 ms after its ack in the rerun, which timed it, and every later frame again carries the whole 50-level window with running totals, P1 `book`.
A feed therefore calls `resetBook` on every frame and needs no delta logic.

### Delta semantics

There are no deltas.
The level count held at exactly 50 bids and 50 asks on every one of 1,623 frames across seven contracts in two 45 s runs, including the thin `jpn225usdt` and the closed-market `qcomusdt`, P1 `book`.

### Sequence and gap rule

There is none, since no frame carries an id.
A missed frame costs nothing, because the next one replaces the book.
What a feed cannot see is a stream that stops, so staleness can only be found by silence on the stream.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket, every frame | best first, descending, 0 unordered frames in 1,623 | best first, ascending, 0 unordered |
| REST `orderbook` | descending, 100 levels | ascending, 100 levels |

The third element of each level is the running sum of the sizes from the touch, on every level of every frame, P1 `book`.

### Level window

The socket holds 50 levels a side, and the REST book holds 100.
At 03:25 and 03:47 UTC the socket's 50th bid and 50th ask equalled the REST book's 50th on `btcusdt`, `sophusdt` and `xrpusd`, so the socket is the top half of the same book, P1 `book`.
50 levels covers the engine's 20, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61.

### Push cadence

| contract | family | frames a second | gap min | gap median | gap max |
|---|---|---:|---:|---:|---:|
| `btcusdt` | USDT-M | 3.96 | 152 | 223 | 487 |
| `ethusdt` | USDT-M | 4.02 | 148 | 238 | 475 |
| `xrpusd` | coin-M | 3.38 | 2 | 282 | 965 |
| `btcusdc` | USDC-M | 2.53 | 1 | 464 | 888 |
| `qcomusdt` | USDT-M TradFi | 2.51 | 43 | 406 | 685 |
| `sophusdt` | USDT-M | 1.22 | 186 | 940 | 1,516 |
| `jpn225usdt` | USDT-M TradFi | 0.40 | 468 | 2,829 | 4,540 |

Gaps in ms, from P1 `book`, 45 s each, first run.
The rerun gave 3.98, 4.09, 2.93, 2.73, 2.56, 1.27 and 0.49 frames a second in the same order, and a longest gap of 4,581 ms on `jpn225usdt`.
A busy book pushes about every 250 ms, so the socket shows a book up to a quarter second old plus about 85 ms in transit.

### Size unit against the catalog `unitAmount`

| contract | `unitAmount` | socket touch | REST touch at the same moment | top 40 socket sizes equal to REST |
|---|---:|---|---|---|
| `btcusdt` | 0.001 BTC | `["86645.0","4954"]`, `["86645.1","6597"]` | the same | 38 of 40, and 40 of 40 in the rerun |
| `sophusdt` | 1,000 SOPH | `["0.003842","496"]`, `["0.003845","641"]` | the same | 40 of 40 in both runs |
| `xrpusd` | 10 USD | `["1.6023","114"]`, `["1.6024","137"]` | the same | 40 of 40 in both runs |

The unit is contracts, the same as the REST book, and one contract is `unitAmount` coins on a linear contract and `unitAmount` US dollars on coin-M, see [`rest.md`](./rest.md) section 2.
So a loader that sets `contractSize` to `unitAmount` lets `sizeMul` convert linear sizes to coins.
On coin-M the engine would take `unitAmount` USD as that many coins, the same inverse caveat as on other venues, and the quote family ranks the nine inverse contracts after their USDT-M twins.

### One-sided and empty books

None was seen.
The eight contracts with the lowest 24 h turnover all held 100 levels a side on REST, see [`rest.md`](./rest.md) section 5, and no socket frame was one-sided or crossed.
What `depth` sends for an empty side is Not verified.

### Idle repeats

A frame with the same levels as the one before it is sent again with a new `timestamp`, 3 to 17 times per 113 to 184 frames on the busy contracts over the two runs.
A quiet contract simply pushes less often, up to 4.5 s apart.

### Unknown, closed and wrong-case symbols

| request | reply | then |
|---|---|---|
| `depth` `nopeusdt` | `{"channel":"subscribe",…,"contractCode":"nopeusdt","env":0,"data":{"result":true}}` | nothing |
| `depth` `BTCUSDT` | ack echoing `BTCUSDT` | one frame echoing `BTCUSDT`, then frames echoing `btcusdt` |
| `depth` with no `contractCode` | ack with `"result":true`, then `{"error_code":500,"error_msg":"exception","result":false}` | |
| `type` `nope` | ack with `"result":true` | nothing |
| `biz` `spot` | ack, then the 500 `exception` error | |
| `event` `nope`, or text that is not JSON | `{"error_code":500,"error_msg":"exception","result":false}` | the socket stays open |
| `depth` `btcusdt` subscribed again, after `BTCUSDT` | ack | the stream is not doubled, 3.8 to 4.5 frames a second in three runs |
| `unsubscribe` `depth` `btcusdt` | `{"channel":"unsubscribe","biz":"perpetual","type":"depth","env":0,"subType":"depth","subResult":true,"data":{"result":true}}` | 0 frames in the next 3 s, including the stream first subscribed as `BTCUSDT` |

All from P1 `errors`.
A delisted contract was not subscribed, since the probe named none, but the delisted codes still appear in `fund_rates`, section 2.
Because an unknown code is acked as a success, the feed has to notice a stream with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"event": "ping"}` "regularly", else no pushes after 5 minutes, S1 | `{"event":"pong"}` 180 and 210 ms after the ping. No server protocol ping in 120 s on four sockets, nor in 75 s on four more |
| silence the server tolerates | 5 minutes without a heartbeat stops pushes, S1 | a socket with no subscription and no client frame closed at 59,996 ms, and at 60,002 ms in the rerun, with code 1006 and no close frame. A socket with no subscription and a ping every 20 s, and a subscribed socket with or without pings, all stayed open for the whole run, 120 s and then 75 s |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | `zip` "Compress or Not" and `serialize` "Serialize or Not", both default false, S1 | a client offering permessage-deflate got no extension back. `zip: true` alone still sent text JSON of 2,711 to 2,713 bytes. `serialize: true`, with or without `zip`, sent binary gzip frames of a protobuf `type.googleapis.com/DepthPbMsg`, 1,081 to 1,094 bytes |
| handshake | | 556 to 697 ms to open from this host |
| subscription limits | Not publicly specified | 300 streams on one socket, no refusal in two runs, section 3 |
| throughput | | 150 USDT perpetuals, every other one by 24 h turnover: 285 frames a second, median 279, peak 529, 754 KB a second, 2,711 bytes a frame, 98 µs `toString` and `JSON.parse` per frame. At 300: 554 frames a second, 1,475 KB a second, 97.8 µs a frame. The rerun read 277 and 562 frames a second, 731 and 1,498 KB a second, and 113 and 106 µs a frame |

At that rate the 585 perpetuals would push about 1,100 whole-window frames a second, about 2.9 MB a second, and cost about 0.1 s of parsing per second of wall time, an extrapolation from the 300-stream run.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` in prose are cut, and each JSON block below parses as shown.

Subscribe.

```json
{"event": "subscribe", "params": {"biz": "perpetual", "type": "depth", "contractCode": "btcusdt", "zip": false, "serialize": false}}
```

Acknowledgement.

```json
{"channel":"subscribe","biz":"perpetual","type":"depth","contractCode":"btcusdt","env":0,"data":{"result":true}}
```

Depth push, the first three of 50 levels kept per side.
Sizes are contracts of 0.001 BTC, and the third element is the running total.

```json
{"data":{"asks":[["86672.5","7373","7373"],["86672.9","199","7572"],["86673.2","216","7788"]],"bids":[["86672.4","4164","4164"],["86672.0","1070","5234"],["86671.7","861","6095"]]},"biz":"perpetual","type":"depth","contractCode":"btcusdt","env":0,"timestamp":1790133937693}
```

Per contract funding push, whose fields are listed in section 2.

```json
{"data":["btcusdt","86658.1","86658.0","-0.0001213795555556","-0.00011118132712528001",16406619,"5357","580591.44","580592.11",0,"usdt","btc","usdt","USDT","BTC","USDT","0",2,"86658.1"],"biz":"perpetual","type":"fund_rate","contractCode":"btcusdt","env":0,"timestamp":1790133995270}
```

Ticker.

```json
{"data":[[1790133990184,"86806.2","85075.7","50147855","4318789845","85500.0","86658.1","1158","1.36","86658","86658.1","btcusdt","580592.11",0,"1737853375718.22"]],"biz":"perpetual","type":"ticker","contractCode":"btcusdt","env":0,"timestamp":1790133995270}
```

Fills.

```json
{"data":[["86658.0","4","short",1790133995420,0]],"biz":"perpetual","type":"fills","contractCode":"btcusdt","env":0,"timestamp":1790133995434}
```

Keepalive.

```json
{"event": "ping"}
```

```json
{"event":"pong"}
```

Error, the same for a missing contract, a bad `biz`, an unknown event and text that is not JSON.

```json
{"error_code":500,"error_msg":"exception","result":false}
```

Unsubscribe acknowledgement.

```json
{"channel":"unsubscribe","biz":"perpetual","type":"depth","env":0,"subType":"depth","subResult":true,"data":{"result":true}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after a `{"event": "signin", "params": {"apiKey", "timestamp", "signature"}}` frame.

- `assets`, `orders` and `position`, each subscribed with `"biz": "perpetual"`.
- S1 also lists `fund_rate` and `fund_rates` under "need to log in", though both are public on the wire, section 2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://wss-ct.hotcoin.fit`, for every family | one socket serves all three families |
| channel | `depth`, with `zip` and `serialize` false | a whole 50-level window every push, text JSON |
| markets per connection | 150 | 150 and then 300 streams ran with no refusal, and no cap is published, so a larger slice is untested |
| subscribe frames | one frame per market, `{"event": "subscribe", "params": {"biz": "perpetual", "type": "depth", "contractCode": <rawMarketId>, "zip": false, "serialize": false}}` | the protocol takes one topic per frame, and 150 in one burst were all acked |
| keepalive | `{"event": "ping"}` every 20 s | the server sends no ping, an idle unsubscribed socket dies at 60 s, S1 asks for regular heartbeats, and the pong counts as traffic |
| `maxSilenceMs` | 45,000 | two missed pongs, and a quiet contract went 4.5 s without a frame |
| routing | skip frames with a `channel` key, then key the book by `contractCode.toLowerCase()` | an uppercase subscription echoes uppercase once |
| every frame | `resetBook` with levels `[Number(p), Number(q)]`, ignoring the third element | each frame is the whole window |
| resync | none on sequence, since there is none. Resubscribe a stream that has sent nothing for 30 s while its socket is alive | staleness shows only as silence on one stream |
| unserved stream | log a stream with no frame 10 s after its ack | unknown codes are acked as successes |
| receive time | stamp on arrival, never from `timestamp` | `timestamp` is the push time, and it runs about 85 ms behind arrival here |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |
| anchor alternative | a second socket on `fund_rates` | one 131 KB frame every 3 s carries the upcoming rate and next settlement for every contract, which the REST catalog lacks, see [`rest.md`](./rest.md) section 8 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hotcoin Global API, Perpetual Futures, WebSocket: "Subscribe to contract push" | https://hotcoinex.github.io/en/swap/websocket.html | 2026-09-23 03:08 UTC | Hotcoin, global | URL, subscribe shape, channel list, `fund_rates` fields, ping and pong, private channel names, sections 1 to 7 |
| P1 | `ws-probe.mjs book` at 03:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hotcoin/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3 and 4 |
| P1 | `ws-probe.mjs channels` at 03:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hotcoin/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 and 6 |
| P1 | `ws-probe.mjs errors` at 03:31 and 03:32 UTC, the first run before the echo count was added | [`ws-probe.mjs`](../../../scripts/probes/venues/hotcoin/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 6 |
| P1 | `ws-probe.mjs batch`, `silence` and `deflate` at 03:32 to 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hotcoin/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| P1 | every mode rerun at 03:46 to 03:51 UTC, `silence` with `PROBE_SILENCE_MS=75000` | [`ws-probe.mjs`](../../../scripts/probes/venues/hotcoin/ws-probe.mjs) | 2026-09-23 UTC | this host | the second readings |
