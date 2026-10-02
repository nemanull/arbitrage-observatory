# CoinTR WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:41 UTC, from the development host near Seattle.

This profile covers CoinTR's public WebSocket v2, spot only, with the `books` channel in detail.
CoinTR serves no perpetual, see [`fees.md`](./fees.md) section 3, so the spot book is profiled as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs), and the capture is quoted beside the documented value.
The protocol is Bitget's V2 public socket in its shape, channel names and error codes, so [`../bitget/websocket.md`](../bitget/websocket.md) is the nearest profile to compare.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, public | `wss://ws.cointr.com/v2/ws/public` (S1) | open in 779 to 993 ms, delivers for every online spot pair |
| private | `wss://ws.cointr.com/v2/ws/private` (S1) | not probed |
| futures | none: the docs use the same public URL with `instType` `USDT-FUTURES`, `COIN-FUTURES` or `USDC-FUTURES` (S2) | `USDT-FUTURES` answers code 30001 "doesn't exist", and `MC` answers 30016 "Param error" |
| legacy CoinTR Pro | `wss://stream.cointr.pro/ws` (S7) | the host does not resolve |

One socket carries every spot pair, TRY and USDT alike, and each subscribe argument names its product line in `instType`.
`ws.cointr.com` is a CNAME to `ws.cointr.com.cloudscdn.net`, which resolved to 104.18.0.223 and 104.18.1.223, Cloudflare.

## 2. Channel matrix for public market data

| channel | argument | depth and speed (S3, S4) | probed on 2026-09-22 |
|---|---|---|---|
| `books` | `{"instType":"SPOT","channel":"books","instId":"BTCUSDT"}` | full book, snapshot then updates, "200-300ms" | one snapshot then updates with a CRC32 checksum, recommended |
| `books15`, `books5`, `books1` | same shape | 15, 5 or 1 levels, a snapshot every push | a `snapshot` frame on the same beat as the `books` updates: 31 frames each in 60 s on `BTCUSDT` beside its 1 snapshot and 30 updates, and 1 frame each in a minute when `BTCUSDT` sent no update |
| `ticker` | same shape | "100ms ~ 300ms" | 197 frames in 60 s on `BTCUSDT` in both runs, median 305 ms apart, every one `action` `snapshot`, carrying `bidPr`, `askPr`, `bidSz`, `askSz` |
| `trade` | same shape | on trade | one `snapshot` of recent trades, then `update` frames, median 1,016 and 1,038 ms apart on `BTCUSDT` |
| `candle1m` and the other intervals | same shape | | not probed |
| mark, index, funding | none | | no such channel exists for spot |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, the product line in `instType` of each argument (S1, S2) | one URL serves every spot pair. Futures `instType` values are refused, section 1 |
| subscribe frame shape | `{"op":"subscribe","args":[{"instType","channel","instId"}, …]}`, and "the total length of multiple channels cannot exceed 4096 bytes at a time" (S1) | 45 arguments per frame, 2,572 to 2,629 bytes, all acknowledged |
| unknown symbol expectation | `event` `error` with `code` and `msg` (S1) | `{"event":"error","arg":{…,"instId":"NOPEUSDT"},"code":30001,"msg":"instType:SPOT,channel:books,instId:NOPEUSDT doesn't exist","op":"subscribe"}` |
| chunk unit and budget | 1,000 streams per connection, 240 subscriptions per hour, 10 messages per second, 4,096 bytes per subscribe message (S1) | 134 streams in 3 frames on one socket, 134 acknowledgements, no error |
| keepalive mechanism | send the string `ping` every 30 s and expect `pong` (S1) | `pong` came back in 186 and 205 ms. `{"op":"ping"}` answers code 30002 `Unrecognized request`. The server sent no protocol ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | none seen, and a pinged socket stayed open for the full 120 s |
| handshake and operation rate limits | 100 connections per IP, 10 messages per second, and "IPs that are repeatedly disconnected may be blocked" (S1) | opens took 779 to 993 ms. No refusal at 3 subscribe frames 300 ms apart |
| public market data authentication | none | none |
| message parse and routing | `{action, arg: {instType, channel, instId}, data: [ … ], ts}` (S3) | route on `arg.channel` and `arg.instId`. `action` is `snapshot` or `update` |
| subscribe acknowledgement shape | `{"event":"subscribe","arg":{…}}` (S1) | one acknowledgement per argument, in about 200 ms. The `books` snapshot follows 0 to 2 ms after its acknowledgement |
| symbol identifier format | `BTCUSDT` | identical to the REST `symbol` on every pair. A lowercase `btcusdt` is acknowledged as `BTCUSDT` and delivers |
| number representation | strings (S3) | price and size are strings. The socket keeps trailing zeros (`"86618.70"`, `"190000.00"`), and REST drops them (`"86714.4"`, `"2762"`), see [`rest.md`](./rest.md) section 5 |
| timestamp representation | `data[0].ts` string ms, envelope `ts` number ms (S3) | as documented. Arrival minus `ts` had a median of 100 to 104 ms, about half the round trip |
| size unit | base coin (S3) | base coin: `"0.33347"` BTC at the touch, equal to REST at the same price |
| sequence semantics | none documented: the push parameters are `asks`, `bids`, `ts` and `checksum` (S3) | no `seq` or `pseq` key on any frame. The checksum is the only integrity check |
| idle repeat behaviour | not documented | some pairs send updates with no levels, 118 and 115 of 132 on `ETHUSDT`. Others send nothing, `MOCAUSDT` for 50.7 s, `PLUMEUSDT` for 36.4 s and `RVVUSDT` for 120 s |

## 4. The book channel in detail

`books` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each pair is `"action":"snapshot"` with the whole book, up to 200 levels per side.
`BTCUSDT` arrived with 90 bids and 200 asks in both runs, `USDTTRY` with 166 and 126, then 165 and 132, `EDUUSDT` with 50 and 53, and over 134 USDT pairs the snapshot sides ranged from 3 to 200 levels.
Each of the 134 pairs got exactly one snapshot in 60 s in both `batch` runs, and none got a second one.
The snapshot frame carries `"checksum":0`, so the check starts with the first update.

### Delta semantics

An update carries `bids` and `asks` arrays of `[price, size]` string pairs, and a size of `"0"` deletes the level (S3).
A new price is inserted, and a known price has its size replaced (S3).
An update may carry no level at all and still a checksum: 118 and 115 of 132 `ETHUSDT` updates in 60 s were empty, and 560 of 24,547 updates over 134 pairs.
Updates can be large: the median `USDTTRY` update held 57 and 58 levels, which looks like a market maker requoting a ladder.

### Sequence and gap rule

```text
action = snapshot   replace the book
action = update     apply every level, then compare the CRC32 of the top 25 levels with data[0].checksum
checksum differs    the book is wrong: resync, which terminates the socket and resubscribes
```

There is no sequence number, so a lost frame shows only as a checksum mismatch on the next update.
The rule held on every update of every run, all with a matching checksum: 778 and 807 updates on four pairs in the two `book` runs, 24,629 and 24,547 updates on 134 pairs in the two `batch` runs, and 178, 164 and 252 updates on two pairs in three `sync` runs.

### Checksum

The documented recipe is CRC32 as a signed 32-bit integer over the first 25 bids and 25 asks, interleaved as `bid1:ask1:bid2:ask2:…`, each level written `price:size` in its original text, with a missing level skipped (S3).
The probe computed it exactly that way over the socket's own strings and matched every update, see the counts above.
Trailing zeros matter: a book rebuilt from REST text, which drops them, would not match.
The fixed-depth channels `books1`, `books5` and `books15` send `"checksum":0`.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, 0 out-of-order levels on the 134 USDT pairs and `USDTTRY` | best first, ascending, 0 out of order |
| update | descending, 0 out of order on the same pairs, in both `book` runs and the second `batch` run | ascending, 0 out of order |
| REST `orderbook` | descending | ascending |

A feed still applies updates by price, since the documentation only promises the local sort.

### Level window

The largest side seen was 200 levels, on `BTCUSDT` asks, in every snapshot of both runs.
One `BTCUSDT` update deleted the ask at 86784.80 and in the same frame added an ask of 0.00001 BTC at 190000.00, far beyond the rest, which reads as a 200-level window refilling itself, see section 6.
A side below 200 levels can grow: `ETHUSDT` asks went from 128 to 130, and from 131 to 132, within a minute.
The engine keeps 20 levels per side, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, so any book deeper than 20 serves it.

### Size unit against CCXT `contractSize`

There is no CCXT class, see [`fees.md`](./fees.md) section 8.
Sizes are in the base coin, so a contract size of 1 would be right.
At the end of each `book` run the socket touch on `BTCUSDT` equalled a REST read, `["86568.32","0.33347"]` and then `["86711.04","0.46379"]`, and 10 and 9 of the top ten socket bids were in the REST top ten.
In the two corrected `sync` runs the REST top five equalled the socket top five, as numbers, on 59 and 59 of 60 `BTCUSDT` reads and 60 and 58 of 60 `ETHUSDT` reads.

### One-sided and empty books

The gray pair `REEFTRY` was acknowledged and sent a snapshot, and its ticker had no bid or ask, see [`rest.md`](./rest.md) section 2.
What that snapshot held on each side was not recorded, so the shape of an empty side is Not verified.

### Idle repeats

Nothing is repeated verbatim.
`ETHUSDT` sent level-free updates about every 513 and 515 ms while its book was still, and `BTCUSDT` sent no update at all in one 60 s window and 21 to 58 in four later ones, with one gap of 27.6 s.
A quiet pair can be silent for longer than the server's idle close: `RVVUSDT` sent its snapshot and then nothing for 120 s in one run, and one update in the other.
The ticker channel does repeat, one `snapshot` about every 305 ms whether or not the touch moved.

### Unknown, closed and wrong-form streams

| request | reply | then |
|---|---|---|
| `books` `NOPEUSDT` | code 30001 `instType:SPOT,channel:books,instId:NOPEUSDT doesn't exist` | the socket stays open |
| `books` `REEFTRY`, status `gray` | acknowledged | a snapshot |
| `instType` `USDT-FUTURES` on `BTCUSDT` | code 30001 `instType:USDT-FUTURES,channel:books,instId:BTCUSDT doesn't exist` | |
| `instType` `MC` | code 30016 `Param error` | |
| channel `books400` | code 30016 `Param error` | |
| `books5` `btcusdt` | acknowledged as `BTCUSDT` | a snapshot |
| `books5` `ETHUSDT` twice | acknowledged twice, the second time with an immediate snapshot | the stream stays at one snapshot about every 500 ms, not two |
| unsubscribe | `{"event":"unsubscribe","arg":{…}}` | |
| text `hello` | code 30002 `Unrecognized request:hello` | the socket stays open |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | send `ping` every 30 s, expect `pong` within 30 s (S1) | `pong` in 186 and 205 ms. No server protocol ping on any socket |
| silence the server tolerates | "The connection will break automatically if the subscription is not established or data has not been pushed for more than 30 seconds." (S1) | in both runs, a socket that never sent anything closed at 59,997 ms with code 1006, and one subscribed to a quiet pair that never pinged closed at 59,997 and 59,999 ms with 1006. A socket that sent `ping` every 20 s stayed open for the full 120 s |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | | 779 to 993 ms to open from this host |
| subscription limits | 1,000 streams per connection, 240 subscriptions per hour, 4,096 bytes per message (S1) | 134 streams in 3 frames were all served |
| throughput | | 134 USDT pairs on one socket, two runs: 415 and 414 frames per second on average, median 408 and 407, peak 1,176 and 1,294, about 1.0 MB per second, 2,448 and 2,396 bytes per frame, 58.8 and 62.6 µs of `JSON.parse` per frame |

The idle close came at 60 s, twice the documented 30 s, so the documented 30 s is the safe figure for a keepalive.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22 local time.
Book arrays are cut to their first three levels, and `levelsOnWire` is added by the probe to say how many there were.

Subscribe, several arguments in one frame.

```json
{"op":"subscribe","args":[{"instType":"SPOT","channel":"books","instId":"BTCUSDT"},{"instType":"SPOT","channel":"books","instId":"USDTTRY"}]}
```

Acknowledgement, one per argument.

```json
{"event":"subscribe","arg":{"instType":"SPOT","channel":"books","instId":"BTCUSDT"}}
```

`books` snapshot, which came with 90 bids and 200 asks.

```json
{"action":"snapshot","arg":{"instType":"SPOT","channel":"books","instId":"BTCUSDT"},"data":[{"asks":[["86726.09","0.70559"],["86731.48","0.75321"],["86734.53","0.37246"]],"bids":[["86689.57","0.48748"],["86688.04","0.39635"],["86687.53","0.35273"]],"checksum":0,"ts":"1790134564685","levelsOnWire":[90,200]}],"ts":1790134564685}
```

`books` update, untrimmed apart from `levelsOnWire`: one ask deleted, and a far ask added in the same frame.

```json
{"action":"update","arg":{"instType":"SPOT","channel":"books","instId":"BTCUSDT"},"data":[{"asks":[["86784.80","0"],["190000.00","0.00001"]],"bids":[],"checksum":-945116999,"ts":"1790134567554","levelsOnWire":[0,2]}],"ts":1790134567554}
```

`books15` snapshot from the first run, first two levels kept.

```json
{"action":"snapshot","arg":{"instType":"SPOT","channel":"books15","instId":"BTCUSDT"},"data":[{"asks":[["86613.81","0.81785"],["86618.70","0.30171"]],"bids":[["86568.32","0.33347"],["86567.43","0.44066"]],"checksum":0,"ts":"1790133569526"}],"ts":1790133569526}
```

A level-free update, which still carries a checksum.

```json
{"action":"update","arg":{"instType":"SPOT","channel":"books","instId":"ETHUSDT"},"data":[{"asks":[],"bids":[],"checksum":245772194,"ts":"1790133571447"}],"ts":1790133571447}
```

Trade update, and the ticker read 228 ms earlier with a best bid of 86568.32 and a best ask of 86613.81, so the print sits inside the spread.

```json
{"action":"update","arg":{"instType":"SPOT","channel":"trade","instId":"BTCUSDT"},"data":[{"ts":"1790133569757","price":"86586.73","size":"0.00010","side":"buy","tradeId":"1486493420166930434"}],"ts":1790133569760}
```

```json
{"action":"snapshot","arg":{"instType":"SPOT","channel":"ticker","instId":"BTCUSDT"},"data":[{"instId":"BTCUSDT","lastPr":"86579.08","open24h":"86415.71","high24h":"86914.22","low24h":"85098.11","change24h":"0.01301","bidPr":"86568.32","askPr":"86613.81","bidSz":"0.33347","askSz":"0.81785","baseVolume":"52.37544","quoteVolume":"4507713.17765","openUtc":"86209.59","changeUtc24h":"0.00429","ts":"1790133569529"}],"ts":1790133569529}
```

Keepalive: the client sends the four characters `ping` and the server answers the four characters `pong`, neither of them JSON.

Errors.

```json
{"event":"error","arg":{"instType":"USDT-FUTURES","channel":"books","instId":"BTCUSDT"},"code":30001,"msg":"instType:USDT-FUTURES,channel:books,instId:BTCUSDT doesn't exist","op":"subscribe"}
```

```json
{"event":"error","code":30002,"msg":"Unrecognized request:{\"op\":\"ping\"}"}
```

## 7. Private channels

Named for a future execution stage, from S5, not probed.
They use `wss://ws.cointr.com/v2/ws/private` and an `op` `login` with an API key, passphrase, timestamp in seconds and an HMAC SHA256 signature over `timestamp + "GET" + "/user/verify"` (S1).

- Spot channels `account`, `orders`, `fill` and `orders-algo`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only if the engine ever takes a spot leg, since CoinTR has no perpetual.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.cointr.com/v2/ws/public`, USDT pairs only | one socket serves every spot pair, and TRY sits outside the quote family |
| channel | `books`, argument `{"instType":"SPOT","channel":"books","instId":<rawMarketId>}` | a snapshot on subscribe, and a checksum on every update |
| markets per connection | 134, all USDT pairs on one socket | 134 ran twice with 0 checksum mismatches at 414 to 415 frames per second, and the documented cap is 1,000 |
| subscribe frames | 45 arguments per frame, 300 ms apart | a frame must stay under 4,096 bytes and the socket under 10 messages per second |
| keepalive | the string `ping` every 20 s | the server sends no ping and closed a socket with no client traffic at 60 s, and documents 30 s |
| `maxSilenceMs` | 45,000 | the pong counts as traffic, and a quiet pair sent nothing for 120 s |
| routing | `arg.instId` is the `rawMarketId` | the socket and REST spell the pair the same way |
| snapshot | `action === "snapshot"`: `resetBook` | documented replace semantics |
| update | apply every level by price, then check the CRC32 of the top 25 against `data[0].checksum` | no sequence number exists |
| resync | a checksum mismatch, or an update before any snapshot: `resync` | the checksum is the only way to see a lost frame |
| checksum text | keep the wire strings of price and size for the check, and never rebuild them from numbers | the recipe hashes the original text, trailing zeros included |
| receive time | stamp on arrival | `ts` trails arrival by about half the round trip |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The checksum costs a sort of the top 25 levels per update, which at 415 frames per second is small beside the 59 to 63 µs parse.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinTR API docs, Websocket API | https://www.cointr.com/api-doc/common/websocket-intro | 2026-09-22 | CoinTR | URLs, limits, ping, subscribe and error shapes, login, sections 1, 3, 5 and 7 |
| S2 | CoinTR API docs, futures intro and futures order book channel | https://www.cointr.com/api-doc/contract/intro | 2026-09-22 | CoinTR | futures `instType` values, section 1 |
| S3 | CoinTR API docs, Depth Channel: Spot | https://www.cointr.com/api-doc/spot/websocket/public/depth-channel | 2026-09-22 | CoinTR | channel names, snapshot and update, checksum recipe, push fields, sections 2 to 4 |
| S4 | CoinTR API docs, Tickers Channel: Spot | https://www.cointr.com/api-doc/spot/websocket/public/tickers-channel | 2026-09-22 | CoinTR | ticker push frequency, section 2 |
| S5 | CoinTR API docs, spot private channels | https://www.cointr.com/api-doc/spot/websocket/private/fill-channel | 2026-09-22 | CoinTR | private channel names, section 7 |
| S7 | CoinTR Pro API reference | https://cointr-ex.github.io/openapis/ | 2026-09-22 | CoinTR Pro | legacy socket URL, section 1 |
| P5 | `ws-probe.mjs book` at 03:19 and 03:36 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P6 | `ws-probe.mjs errors` at 03:18 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | sections 1, 3, 4 and 6 |
| P7 | `ws-probe.mjs batch` at 03:23 and 03:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 and 8 |
| P8 | `ws-probe.mjs silence` at 03:24 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P9 | `ws-probe.mjs sync`, runs at 03:21, 03:22 and 03:37 UTC, the first before the probe compared REST and socket prices as numbers | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | REST against socket and trade prints, section 4 |
| P10 | `ws-probe.mjs deflate` at 03:18 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cointr/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
