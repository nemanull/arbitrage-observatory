# Bitget WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

Every probed number here comes from [`../../../scripts/probes/bitget-ws-probe.mjs`](../../../scripts/probes/bitget-ws-probe.mjs), run from `server/` between 07:15 and 07:31 UTC and again in the second pass between 18:52 and 19:05 UTC, with `ws` and `perMessageDeflate: false` as the engine opens its sockets.
Rates and cadences are one host on one date, and where the second pass differs from the morning both are given.
The catalog, anchor and REST book are in [`rest.md`](./rest.md), and fees are in [`fees.md`](./fees.md).

## 1. Endpoints

Bitget documents two account systems, and each has its own public socket.
The classic docs open with "The Classic Account is in maintenance mode and receives only essential updates", and they recommend the Unified Trading Account (UTA), see the [Introduction](https://www.bitget.com/docs/classic/Introduction).
The old `https://www.bitget.com/api-doc/...` pages now answer `301` to the UTA introduction, so links from older code and from CCXT comments no longer reach the classic pages.
The classic docs still live under `https://www.bitget.com/docs/classic/`.

| generation | public socket | book arguments | documented book push |
| --- | --- | --- | --- |
| Classic, v2 | `wss://ws.bitget.com/v2/ws/public` | `instType` `USDT-FUTURES`, `channel`, `instId` | `books`, `books5`, `books15` every 150 ms, `books1` every 10 ms |
| UTA, v3 | `wss://ws.bitget.com/v3/ws/public` | `instType` `usdt-futures`, `topic`, `symbol` | `books` every 50 ms, `books50` 20 ms, `books5` 10 ms, `books1` 1 ms |

CCXT 4.5.68 Pro lists both URLs at `server/node_modules/ccxt/js/src/pro/bitget.js:48` to `:51` and uses v2 unless the `uta` option is set, at `pro/bitget.js:820`.
Probed: both sockets serve the same books.
For BTCUSDT on 2026-09-15, 1,432 sequence numbers appeared on both sockets, and the top 20 levels of the two local books were identical at all 1,432.
The second pass repeated it with 1,488 shared sequence numbers and 1,488 identical top 20 books.

| family | v2 socket and `instType` | v3 socket and `instType` | one socket carries several families |
| --- | --- | --- | --- |
| USDT-M perpetual | v2, `USDT-FUTURES` | v3, `usdt-futures` | Yes, Probed on v2 and v3 |
| USDC-M perpetual | v2, `USDC-FUTURES` | v3, `usdc-futures` | Yes, Probed on v2 and v3 |
| Coin-M perpetual | v2, `COIN-FUTURES`, ids such as `BTCUSD` | v3, `coin-futures`, ids such as `BTCUSD_CM` | Yes on v2, Probed |

Probed: one v2 connection streamed `books` for BTCUSDT under `USDT-FUTURES`, BTCPERP under `USDC-FUTURES` and BTCUSD under `COIN-FUTURES` at once.
On v3, `coin-futures` with symbol `BTCUSD` answered `30001 doesn't exist`, because the UTA Coin-M ids end in `_CM`, see [`rest.md`](./rest.md) section 2.
The VIP line hosts `vip-ws.bitget.com` and the Lo-La hosts are Account-gated and were not probed, see the [UTA Quick Start](https://www.bitget.com/docs/uta/quick-start).
The demo socket `wss://wspap.bitget.com` is for demo keys and was not probed.

## 2. Channel matrix for public market data

| channel | v2 | v3 | probed on 2026-09-15 |
| --- | --- | --- | --- |
| full book, snapshot then deltas | `books` | `books` | v2 BTCUSDT snapshot 500 levels a side, median push 100 ms in both runs. v3 snapshot 1,000 a side, median push 51 ms, and 64 ms in the second pass. |
| 50 levels, snapshot every push | not offered | `books50` | v2 answered `30016 Param error`. v3 median push 20 ms, 4,861 frames and 10.8 MB for one symbol in 150 s. |
| 15 levels, snapshot every push | `books15` | not documented | v2 BTCUSDT median push 104 ms, and 148 ms in the second pass. |
| 5 levels, snapshot every push | `books5` | `books5` | v2 MAVUSDT delivered. |
| best bid and ask | `books1` | `books1` | v2 BTCUSDT median push 23 ms, v3 3 ms. |
| trades | `trade` | a New Trades Channel page in the UTA list, not probed | v2 delivered. |
| ticker with mark, index, funding rate and next funding time | `ticker` | `ticker` | Both delivered every 105 ms median, see below. |
| mark price or funding channel | none | none | v2 `markPrice` and `funding` answered `30016 Param error`. |
| RPI book | not documented | an RPI OrderBook Channel page in the UTA list, not probed | |

Sources: [classic Depth Channel](https://www.bitget.com/docs/classic/websocket/contract/public/Order-Book-Channel), [classic Market Channel](https://www.bitget.com/docs/classic/websocket/contract/public/Tickers-Channel), [UTA Depth Channel](https://www.bitget.com/docs/uta/websocket/public/Order-Book-Channel), [UTA Tickers Channel](https://www.bitget.com/docs/uta/websocket/public/Tickers-Channel).

The ticker is a usable anchor stream.
The v2 `ticker` frame carries `markPrice`, `indexPrice`, `fundingRate` and `nextFundingTime`, and over 25 s BTCUSDT showed 23 distinct marks and 46 distinct indices in 238 frames.
It carries no funding interval, so a poller still needs the REST funding call for that column.
The classic doc says the ticker pushes "When there is a change (deal, buy, sell, issue): 300ms to 400ms", and the wire pushed every 48 to 198 ms even on MAVUSDT, whose mark and index did not change.

## 3. The sixteen axes

The axes are those of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column quotes the classic docs unless it says UTA.

| axis | documented | probed |
| --- | --- | --- |
| endpoint split axis | One public URL per generation, the family is `instType` inside each argument. | One v2 connection carried USDT-M, USDC-M and Coin-M books together. |
| subscribe frame shape | `{"op":"subscribe","args":[{"instType","channel","instId"}]}`. UTA uses `topic` and `symbol` and a lowercase `instType`. | Both shapes accepted as documented. |
| unknown symbol expectation | An error event, code `30001` in CCXT's table at `pro/bitget.js:88`. | v2 `{"event":"error","arg":{...},"code":30001,...}` naming the argument. v3 `{"event":"error","code":30001,...}` with no `arg`. A real symbol under the wrong `instType`, BTCPERP under `USDT-FUTURES`, was acknowledged and then delivered nothing. |
| chunk unit and budget | "the total length of multiple channels cannot exceed 4096 bytes at a time", max 1000 channel subscriptions per connection, 240 subscription requests per hour per connection, fewer than 50 channels per connection recommended. | Morning: a 60 argument frame of 3,957 bytes on v2 and a 62 argument frame on v3 were fully acknowledged, and 150 `books` channels on one connection were acknowledged on both. Second pass: v2 again took 60 arguments in one frame, but v3 closed the connection with code 1006 and no error frame within 0.8 s of opening, right after a `books` frame of 25, 50 or 62 arguments, in four tries, having acknowledged only part of the frame. v3 frames of 10, 15 and 20 arguments worked, and 150 channels sent as frames of 10 one second apart streamed 106,222 updates with zero gaps. The 4096 byte cap and the 240 per hour cap were not tested at their edge. |
| keepalive mechanism | Client sends the text `ping` every 30 s and expects the text `pong`. The server disconnects if no `ping` arrives for 2 min. | `pong` came back 96 to 125 ms after each `ping`. A connection that never sent `ping` was closed with code 1006 at 127 s in the morning and at 142 s in the second pass, while book data was still flowing to it. |
| connection lifetime and maintenance notice | Not publicly specified. | No forced close or notice in 150 s. Longer lifetimes Not verified. |
| handshake and operation rate limits | 300 connection requests per IP per 5 min, 100 connections per IP, 10 messages per second per connection counting `ping` and JSON. Over the limit the connection is closed, and an IP disconnected repeatedly "may be blocked". | Not tested at the edge. The probe never exceeded 4 client messages in one second. |
| public market data authentication | None for public channels. | None needed on v2 or v3. |
| message parse and routing | `{action, arg:{instType, channel, instId}, data:[...], ts}`. | As documented. Route on `arg.instId` plus `arg.channel`, or `arg.symbol` plus `arg.topic` on v3. The keepalive answer is the bare text `pong`, which is not JSON. |
| subscribe acknowledgement shape | `{"event":"subscribe","arg":{...}}`. UTA adds `connId`. | One acknowledgement per argument on both. An acknowledgement is not proof of data, see the wrong `instType` row. |
| symbol identifier format | `instId` is the symbol, as `BTCUSDT`. | `BTCUSDT`, `BTCPERP` for USDC-M, `BTCUSD` on v2 Coin-M. Every REST ticker id equalled a CCXT `market.id`, and the 150 ids subscribed in the batch came back under the same spelling on both sockets. Three ids are non-ASCII, such as `牛来USDT`. |
| number representation | Prices and sizes are strings. `seq` is Long in the classic table and String in the UTA table. | Prices and sizes arrive as JSON strings. `seq` and `pseq` arrive as bare JSON integers. On Coin-M BTCUSD they exceed 2^53, as `1483653649791156272`, so `JSON.parse` rounds them. |
| timestamp representation | `data[0].ts` is milliseconds as a string, the outer `ts` is the push time. | As documented. The outer `ts` is a JSON number and `data[0].ts` a string. |
| size unit | Not stated on the channel page. Contract config calls `minTradeNum` a base currency amount. | Base coin. The WebSocket top 5 of MAVUSDT equalled REST `merge-depth` level for level, and CCXT reports `contractSize` 1 on all 851 swaps. |
| sequence semantics | Classic: "The seq of update incremental messages is incrementing except during symbol maintenance", and `pseq` is "The serial number of the previous push". UTA: the previous update's `seq` equals the next update's `pseq`, a snapshot's `seq` falls inside `[pseq, seq]` of the first update, and a restart may reset with `pseq=0`. | Every update's `pseq` equalled the previous frame's `seq`, and every first update's `pseq` equalled the snapshot's `seq`. Zero gaps in 1,530 BTCUSDT, 233 MAVUSDT, 183 CELRUSDT, 1,438 BTCPERP and 1,309 BTCUSD updates, in 73,474 updates over 150 perps on v2, and in 107,218 updates over the same 150 on v3. The second pass again had zero gaps, in 1,531 BTCUSDT, 1,137 MAVUSDT, 706 CELRUSDT, 1,517 BTCPERP and 1,320 BTCUSD updates on v2, 2,063 BTCUSDT updates on v3, and 102,945 updates over 150 perps on v2. No `pseq` of 0 on an update in either run. |
| idle repeat behaviour | Not stated. | `books` repeats nothing, with gaps up to 7.7 s on CELRUSDT and no empty updates. The fixed depth channels push snapshots and sometimes repeat one unchanged, 112 of 1,233 on v2 `books15` BTCUSDT in the morning and 1 of 1,086 in the second pass. |

## 4. The book channel in detail

This section describes `books`, which is the channel section 8 recommends, on both sockets.

- Snapshot on subscribe: Yes.
  The first data frame is `action` `snapshot`, which arrived 90 ms after the acknowledgement on BTCUSDT.
- Snapshot depth: up to 500 levels a side on v2 and 1,000 on v3.
  The v2 snapshots of BTCPERP and BTCUSD held 200 a side.
  Thin books send every level they have, 61 bids and 71 asks on MAVUSDT, and 64 and 74 in the second pass.
  Over 150 busy perps the smaller side of the v2 snapshot held 85 to 500 levels, median 200, and 78 to 500, median 200, in the second pass.
- Delta semantics: each level carries the new absolute size at that price, and size `"0"` removes it.
  Not stated in the docs.
  Probed indirectly: a book built this way never crossed in more than 180,000 updates, its MAVUSDT top 5 matched the REST book, and its BTCUSDT top 20 matched the other socket's book.
- Sequence and gap rule: an update is in order when its `pseq` equals the last applied `seq`.
  Anything else is a gap and needs a new snapshot, which on this venue means resubscribing or reconnecting.
- Checksum: none.
  The old classic `checksum` field is absent from the current classic and UTA pages, and no frame in the run carried the key.
  CCXT still checks one only "when the exchange actually sends one", at `pro/bitget.js:921` to `:927`.
- Level order on the wire: bids descending and asks ascending in every snapshot and every update, 0 out of order frames.
  The UTA page documents this order.
- Size unit: base coin, the same as CCXT's `contractSize` of 1.
- One-sided and empty books: not observed in the run.
  The UTA page does not describe them.
- Idle repeats: none on `books`.
  A quiet book is simply silent, so liveness has to come from `pong`.
- Unknown symbol: an error event, and no data.
  A wrong `instType` for a real symbol: an acknowledgement, and no data.
- Closed or delisted symbol: Not verified, since no symbol changed status during the run.
- Push cadence: v2 BTCUSDT median 100 ms and p90 105 ms, where the classic page says 150 ms. v3 median 51 ms, where the UTA page says 50 ms.
  The second pass read 100 and 109 ms on v2 and a 64 ms median on v3.
- Load: 150 busiest crypto perps on one connection gave 1,063 messages and 395 KB per second on v2, and 1,541 messages and 468 KB per second on v3.
  The largest frame was 20.7 KB on v2 and 54.4 KB on v3.
  The first snapshots of the 150 totalled 1.08 MB on v2 and 2.82 MB on v3.
  The second pass read 1,491 messages and 704 KB per second on v2, with a 20.8 KB largest frame and 1.07 MB of first snapshots.

## 5. Session

- Keepalive: send the text `ping` about every 30 s.
  The server answers `pong` and closes a connection that sends no `ping` for about 2 minutes, even while it streams data to it.
  Probed close at 127 s and at 142 s, with code 1006 both times.
- Silence the server tolerates from the client: 2 minutes without `ping`, as above.
- Forced disconnects and maintenance notices: none documented and none seen.
- Compression: none.
  The server offered no `sec-websocket-extensions`, every frame was text, and no frame was compressed inside.
  The engine's refusal of permessage deflate costs nothing here.
- Transport: the socket is served through CloudFront.
  The upgrade response read `server: OrEdge-Nginx` and `x-amz-cf-pop: SEA900-P4`, a Seattle edge, in both runs, and the handshake took 297 to 338 ms in the morning and 300 to 745 ms in the second pass.
- Handshake and subscription limits: 300 connection attempts per IP per 5 minutes, 100 open connections per IP, 10 client messages per second, 240 subscription requests per hour per connection, 1000 channels per connection, 4096 bytes of arguments per request.
- Undocumented v3 close: in the second pass the v3 socket dropped a connection with code 1006, and no error event, right after a `books` subscribe frame of 25 or more arguments, while 20 or fewer worked.
  The morning run did not see it.
  See section 3, chunk unit.
- Consequence for resync: a gap resync that resubscribes on the same connection spends that connection's 240 per hour budget.
  Terminating and reopening spends one of 300 connection attempts per 5 minutes instead.

## 6. Captured frames

Captured from `wss://ws.bitget.com/v2/ws/public` on 2026-09-15 unless marked v3.
Level arrays are trimmed to two entries, and nothing else is changed.

Subscribe, as sent:

```json
{"op":"subscribe","args":[{"instType":"USDT-FUTURES","channel":"books","instId":"BTCUSDT"},{"instType":"USDT-FUTURES","channel":"books","instId":"MAVUSDT"},{"instType":"USDT-FUTURES","channel":"books","instId":"CELRUSDT"}]}
```

Acknowledgement, one per argument:

```json
{"event":"subscribe","arg":{"instType":"USDT-FUTURES","channel":"books","instId":"BTCUSDT"}}
```

Snapshot, MAVUSDT, 71 asks and 61 bids on the wire, `pseq` 0:

```json
{"action":"snapshot","arg":{"instType":"USDT-FUTURES","channel":"books","instId":"MAVUSDT"},"data":[{"asks":[["0.01039","4499.23"],["0.0104","116536.86"]],"bids":[["0.01038","4311.15"],["0.01037","175152.28"]],"ts":"1789456510736","seq":427583461144,"pseq":0}],"ts":1789456511968}
```

The next two MAVUSDT updates, whose `pseq` chains to the snapshot `seq` and then to each other:

```json
{"action":"update","arg":{"instType":"USDT-FUTURES","channel":"books","instId":"MAVUSDT"},"data":[{"asks":[],"bids":[["0.00519","30828.52"]],"ts":"1789456512452","seq":427583480559,"pseq":427583461144}],"ts":1789456512453}
```

```json
{"action":"update","arg":{"instType":"USDT-FUTURES","channel":"books","instId":"MAVUSDT"},"data":[{"asks":[["0.0104","116536.86"],["0.01042","382403.68"]],"bids":[["0.01036","463711.3"],["0.01035","175053.47"]],"ts":"1789456512458","seq":427583480664,"pseq":427583480559}],"ts":1789456512511}
```

The same MAVUSDT update on v3, where the keys are `a` and `b` and `maxdepth` is added, spelled in lowercase on the wire although the UTA page documents `maxDepth`:

```json
{"action":"update","arg":{"instType":"usdt-futures","topic":"books","symbol":"MAVUSDT"},"data":[{"a":[],"b":[["0.00519","30828.52"]],"seq":427583480559,"pseq":427583461144,"ts":"1789456512452","maxdepth":"1000"}],"ts":1789456512454}
```

Keepalive, the client sends the text `ping` and the server answers:

```text
pong
```

Unknown symbol on v2:

```json
{"event":"error","arg":{"instType":"USDT-FUTURES","channel":"books","instId":"NOPEUSDT"},"code":30001,"msg":"instType:USDT-FUTURES,channel:books,instId:NOPEUSDT,precision:null doesn't exist","op":"subscribe"}
```

Unknown symbol on v3:

```json
{"event":"error","code":30001,"msg":"{\"instType\":\"usdt-futures\",\"symbol\":\"NOPEUSDT\",\"topic\":\"books\"} doesn't exist","connId":"0ac601fffe2331d1-0000b8a2-02ec8f7d-12be2501ca6d557e-522cdcdf"}
```

A channel the v2 socket does not offer:

```json
{"event":"error","arg":{"instType":"USDT-FUTURES","channel":"books50","instId":"BTCUSDT"},"code":30016,"msg":"Param error","op":"subscribe"}
```

Coin-M sequence numbers beyond 2^53, as written on the wire:

```text
"pseq":1483653649371725838,"seq":1483653649791156272
```

## 7. Private channels

Names only, for a future execution stage.
None was subscribed.

| generation | private socket | channels |
| --- | --- | --- |
| Classic, v2 | `wss://ws.bitget.com/v2/ws/private`, after `op` `login` | `account`, `positions`, `orders`, `fill`, and a plan order channel |
| UTA, v3 | `wss://ws.bitget.com/v3/ws/private`, after `op` `login` | `account`, `position`, `order`, `fill` |

Login signs `timestamp + "GET" + "/user/verify"` with HMAC SHA256 and Base64, and the timestamp expires after 30 s, per the [UTA Quick Start](https://www.bitget.com/docs/uta/quick-start) and the [classic WebSocket API](https://www.bitget.com/docs/classic/websocket/intro).
The UTA changelog also names WebSocket `place-order` and `cancel-order` channels, see [UTA changelog September 2026](https://www.bitget.com/docs/uta/changelog/2026-09).

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

- Market filter: keep `linear === true` with settle `USDT` or `USDC`.
  That drops the 9 Coin-M contracts, every one of which has a USDT-M twin that `marketRank` would pick anyway, and the 7 demo markets CCXT loads as active swaps.
- Channel: `books` on `wss://ws.bitget.com/v3/ws/public`.
  It is the documented current generation, it pushes every 50 to 65 ms against 100 ms on v2, it uses the CCXT market ids for USDT-M and USDC-M unchanged, and its sequence chain held with zero gaps over 107,218 updates in the morning and 106,222 in the second pass.
  The v2 `books` channel is a drop-in fallback with the same chain and the same books, at about 70 % of the messages and 85 % of the bytes in the morning run.
- API generation: CCXT 4.5.68 loads the catalog from the classic v2 contracts call, and the recommended poller in [`rest.md`](./rest.md) section 8 also reads classic v2 calls.
  The v3 socket spells every USDT-M and USDC-M id exactly as those v2 calls do, so the three agree on the linear perps.
  They disagree only on Coin-M ids, which the market filter below drops.
- URL plan: one URL for both linear families, with `instType` `usdt-futures` for settle USDT and `usdc-futures` for settle USDC.
  A wrong `instType` is acknowledged and silent, so it must come from settle and never be guessed.
- Markets per connection: 50, as Bitget recommends, which is 17 connections for 835 linear perps. 150 per connection worked in the probe, and 1000 is the documented cap.
- Subscribe frames: at most 10 `books` arguments per v3 frame, sent about 1 s apart, so 50 markets are five frames.
  A v3 frame of 25 or more arguments closed the connection in the second pass, see section 5.
  Ten arguments are about 0.7 KB, far inside the 4096 byte cap the classic page documents.
  On the v2 fallback one frame of 50 arguments worked.
- Connect stagger: 1 s between opens keeps a cold start of 17 connections far under 300 attempts per 5 minutes.
- Keepalive: send the text `ping` every 25 s.
  Check for the raw text `pong` before `JSON.parse`, or `handleMessage` throws and `VenueFeed` logs an error on every keepalive.
- `maxSilenceMs`: 60,000.
  A thin `books` channel can be silent for several seconds, and the 25 s `pong` is what proves the socket alive.
- Routing: `arg.symbol` against `accepts`, snapshot on `action` `snapshot`, deltas on `action` `update`, and `event` `error` logged with its `msg`.
- Resync rule: an update before any snapshot, an update whose `pseq` differs from the last `seq`, or an update with `pseq` 0 terminates the connection, and the reconnect resubscribes and receives fresh snapshots.
  Terminating spends a connection attempt rather than the per connection subscription budget.
- Sequence type: compare `seq` and `pseq` as exact integers.
  Linear sequences sat near 10^12 in the run, which a double holds exactly, but Coin-M sequences above 2^53 do not.
- Depth: the engine's 20 levels come from the local book, and the snapshot always holds more than 20 on a live market.

## 9. Source ledger

| title | URL | retrieved | entity or region | sections supported |
| --- | --- | --- | --- | --- |
| Introduction, classic and UTA API docs | https://www.bitget.com/docs/classic/Introduction | 2026-09-15 | Bitget, global API | 1 |
| Websocket API, classic | https://www.bitget.com/docs/classic/websocket/intro | 2026-09-15 | Bitget, global API | 3, 5, 7 |
| Depth Channel, classic contract | https://www.bitget.com/docs/classic/websocket/contract/public/Order-Book-Channel | 2026-09-15 | Bitget, global API | 1, 2, 3, 4 |
| Market Channel, classic contract | https://www.bitget.com/docs/classic/websocket/contract/public/Tickers-Channel | 2026-09-15 | Bitget, global API | 2 |
| Depth Channel, UTA | https://www.bitget.com/docs/uta/websocket/public/Order-Book-Channel | 2026-09-15 | Bitget, global API | 1, 2, 3, 4 |
| Tickers Channel, UTA | https://www.bitget.com/docs/uta/websocket/public/Tickers-Channel | 2026-09-15 | Bitget, global API | 2 |
| Quick Start, UTA | https://www.bitget.com/docs/uta/quick-start | 2026-09-15 | Bitget, global API | 1, 3, 5, 7 |
| Order, Account, Positions and Fill channels, UTA | https://www.bitget.com/docs/uta/websocket/private/Order-Channel | 2026-09-15 | Bitget, global API | 7 |
| Order, Account, Positions and Fill channels, classic contract | https://www.bitget.com/docs/classic/websocket/contract/private/Order-Channel | 2026-09-15 | Bitget, global API | 7 |
| UTA changelog, September 2026 | https://www.bitget.com/docs/uta/changelog/2026-09 | 2026-09-15 | Bitget, global API | 7 |
| CCXT Pro bitget class 4.5.68 | `server/node_modules/ccxt/js/src/pro/bitget.js` | 2026-09-15 | installed package | 1, 3, 4 |
| Probe script | [`../../../scripts/probes/bitget-ws-probe.mjs`](../../../scripts/probes/bitget-ws-probe.mjs) | 2026-09-15 | this host | every Probed value |
