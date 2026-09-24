# Kinesis WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:55 to 05:16 UTC in two runs, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

Kinesis lists no perpetual, so this profile covers the spot book, per the survey plan's spot variant.
Kinesis documents no public WebSocket.
Its documented API at `client-api.kinesis.money` is REST only and signs every call with an account key, see [`rest.md`](./rest.md) section 1.
The sockets below are the ones the web app at `kms.kinesis.money` opens for a visitor who is not logged in, found in its JavaScript bundle and then captured by [`ws-probe.mjs`](../../../scripts/probes/venues/kinesis/ws-probe.mjs).
They are undocumented, so the "documented" column below is empty except where the bundle's client code fixes a value.
Terms Schedule 7 clauses 5.1.4 and 5.1.6 forbid "Data feed or data stream services that make use of any market data from Kinesis" and any "robot" or "script" access without written consent, see [`rest.md`](./rest.md) section 8.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot depth, one pair per socket | `wss://fastapi.kinesis.money/notifications/market-data/v2/depth/?symbolId=<pair>&EIO=4&transport=websocket` | open in 460 to 513 ms on four sockets over two runs, and 472 to 694 ms on 40 sockets |
| spot price snapshots, every pair | `wss://fastapi.kinesis.money/notifications/market-data/v2/snapshots/?EIO=4&transport=websocket` | open in 481 to 522 ms over three sockets |
| spot trades, one pair per socket | `wss://fastapi.kinesis.money/notifications/order-data/executions/?symbolId=<pair>&EIO=4&transport=websocket` | open in 476 to 515 ms over three sockets |
| perpetuals, futures, options | none listed | |

The protocol is Socket.IO 5 over Engine.IO 4.
The bundle's client sets `transports:["websocket"]`, `EIO=4`, the socket.io `path` to the notification path, and `symbolId` as a query parameter, in `socketIo-BMpcfRL9.js` and `useDepthLoading-Bv2CFafN.js`, B1.
`fastapi.kinesis.money` resolved to `166.117.2.180` and `166.117.239.99`, AWS Global Accelerator addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | how it is chosen | depth and speed | probed |
|---|---|---|---|
| depth `onInit` | socket path `…/v2/depth/`, query `symbolId` | the whole book, both sides | one per socket, 0 to 7 ms after the namespace ack |
| depth `onChange` | same socket | one whole side, bid or ask, at most about once a second per side | 0.03 to 1.01 frames a second per pair over 75 s |
| snapshots `onInit` and `onChange` | socket path `…/v2/snapshots/`, no query | a map from pair to mid, bid, ask, 24 h high, low and volume | about 5 `onChange` frames a second, 7.3 and 7.5 pairs each in two runs |
| executions `onInit` and `onChange` | socket path `…/order-data/executions/`, query `symbolId` | the last 50 trades, then each new trade | 50 trades on connect, no new trade in 30 s on `KAU_C1USD` |
| best bid and ask alone | none | | |
| index, mark, funding | none | | spot venue |

The web app reads no other public market socket.
The names `onInit` and `onChange` are the only events the app listens for on these paths, B1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Not publicly specified" means Kinesis documents no socket at all.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified. The bundle opens one socket per pair and per channel, B1 | one pair per depth socket, chosen by `symbolId` in the URL. Emitting `subscribe` or `join` events for `KAG_C1USD` on a `KAU_C1USD` socket brought no `KAG_C1USD` frame in 13 s |
| subscribe frame shape | Not publicly specified. The client sends only the Socket.IO namespace connect, B1 | the pair is in the URL, and the only client frame is `40` after the server's `0{…}` open packet |
| unknown symbol expectation | Not publicly specified | `NOPE_C1USD` gets the ack and `onInit` with `"bid":[],"ask":[]`, then nothing. A lowercase `kau_c1usd` gets the same empty book. No `symbolId` gets the ack and no `onInit` |
| chunk unit and budget | Not publicly specified | one pair per socket, and 40 sockets opened at once all delivered |
| keepalive mechanism | Engine.IO 4: the server sends `2`, the client answers `3`. The open packet says `"pingInterval":25000,"pingTimeout":20000` | server pings at 25.5, 50.6 and 75.8 s after open in both runs. No client ping exists in Engine.IO 4 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 90 s, and no notice event |
| handshake and operation rate limits | Not publicly specified | 40 sockets opened in one burst with no refusal |
| public market data authentication | none in the web app for a visitor who is not logged in, B1 | none |
| message parse and routing | Socket.IO event frames `42["<event>",<data>]` | route by socket, since each depth socket carries one pair. The `onChange` payload also carries `symbolId` |
| subscribe acknowledgement shape | Socket.IO namespace ack `40{"sid":…}` | `40{"sid":"pAkGjnYIc1PX3rCaAGfD"}` at 609 to 690 ms after the socket was created |
| symbol identifier format | `BASE_QUOTE`, as the app builds `${base}_${quote}`, B1 | `KAU_C1USD`, identical to the REST catalog `id` and depth `symbolId`, and case sensitive |
| number representation | not specified | prices and amounts are JSON numbers. The REST book, which matched the socket level for level, carried up to 8 price decimals and up to 17 amount decimals |
| timestamp representation | not specified | depth and snapshot frames carry no timestamp. Executions carry an ISO 8601 `date` |
| size unit | not specified | base currency units, since the REST book and the socket agree level by level and `BTC_C1USD` shows sizes such as `3.65245374` BTC at 87,216.96 |
| sequence semantics | none | no sequence number, no update id and no checksum on any frame |
| idle repeat behaviour | not specified | no idle repeats: 0 identical side frames in the first 75 s on four pairs, and 1 on `KAU_C1USD` in the rerun. `IMX_C1USD` sent one frame per side 41.3 s after its snapshot, and in the rerun two ask frames and no bid frame in 75 s |

## 4. The book channel in detail

### Snapshot on subscribe

Each depth socket gets one `onInit` right after the namespace ack, 0 to 7 ms later on four pairs over two runs.
Its data is an array holding one object `{symbolId, bid, ask}`, and each level is `{amount, price, ownedAmount}`, where `ownedAmount` was 0 on every level of every pair read without a login.
`KAU_C1USD` held 81 bids and 55 asks, `KAG_C1USD` 104 and 83, `BTC_C1USD` 45 and 22, and `IMX_C1USD` 10 and 10, the same in both runs.
No second `onInit` arrived in 75 s.

### Delta semantics

There are no deltas.
Each `onChange` is `{symbolId, direction, depth}`, where `direction` is `bid` or `ask` and `depth` is the whole side, and the web app replaces that side wholesale with `setAll`, B1.
Every `onChange` on the four pairs carried the full side: `KAU_C1USD` bids ran 80 or 81 levels and asks 54 or 55, `KAG_C1USD` 104 and 83, `BTC_C1USD` 45 and 22, `IMX_C1USD` 10 and 10.
`onChange` levels omit `ownedAmount`.
A bid frame for `KAU_C1USD` at 81 levels was 2,816 bytes, and one for `KAG_C1USD` at 104 levels was 3,751 bytes.

### Sequence and gap rule

```text
onInit                         replace both sides
onChange, direction = "bid"    replace the bid side
onChange, direction = "ask"    replace the ask side
```

No frame carries a sequence, so a lost frame cannot be detected, and none needs detecting, since the next frame for that side replaces it.
A frame lost on one side leaves that side stale until the side changes again, which on `IMX_C1USD` took 41 s, and its bid side did not change at all in the rerun's 75 s.

### Checksum

None.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `onInit` | descending, best first, on 4 of 4 pairs | ascending, best first, on 4 of 4 |
| `onChange` | descending on every bid frame, 71 in the first run and 75 in the rerun | ascending on every ask frame, 75 and 74 |
| REST depth | descending on 162 of 162 pairs | ascending on 162 of 162 |

### Level window

The socket sends every level.
`KAG_C1USD` held 104 bids on the socket, while the REST depth at the same moment returned 100, so the REST call caps at 100 levels per side and the socket does not.
Across all 162 pairs the REST book held 8 to 100 bids and 9 to 83 asks, with a median of 10 on each side, see [`rest.md`](./rest.md) section 5.
So most pairs carry about 10 levels, and 15 pairs carry 20 bids or more.

### Update rate

Frames for one side arrive at most about once a second.
The shortest gap between two frames of the same side was 692 ms on `KAG_C1USD` asks in the first run's captured frames, and 711 ms on `KAU_C1USD` asks in the rerun.
The median gap between any two frames on `KAU_C1USD` was 1,000 ms and 928 ms.
Over 75 s `KAU_C1USD` sent 26 bid and 26 ask frames, `KAG_C1USD` 35 and 41, `BTC_C1USD` 9 and 7, and `IMX_C1USD` 1 and 1.
In the rerun they sent 29 and 27, 37 and 36, 9 and 9, and 0 and 2.
The longest silence between book frames was 11.2 s on `KAU_C1USD`, 14.1 s on `KAG_C1USD`, 24.0 s on `BTC_C1USD` and 41.3 s on `IMX_C1USD`, and 9.0, 7.0, 23.2 and 13.7 s in the rerun.
The pairs do not share one wall-clock tick.
In the rerun `KAG_C1USD` frames arrived 834 to 877 ms past each wall-clock second, while `KAU_C1USD` frames arrived anywhere from 6 to 998 ms past it.
A silent depth socket therefore does not mean a stale book, because Kinesis pushes only a side that changed, so a feed has to count the server's ping as traffic.

### Size unit

The unit is the base currency, grams for KAU, troy ounces for KAG, and coins for crypto.
After 75 s the socket's top 10 levels equalled the REST top 10 in both price and amount on both sides of all four pairs, in both runs.
A spot book needs no contract size, and CCXT has no Kinesis class to supply one, see [`fees.md`](./fees.md) section 8.

### One-sided and empty books

No listed pair had an empty or one-sided REST book on 2026-09-23 UTC, 0 of 162 in both runs.
An unknown or wrongly cased pair returns an empty book, `"bid":[],"ask":[]`, which a feed cannot tell apart from a real empty book.

### Idle repeats

Nearly none.
The first run saw 0 identical side frames in 75 s on four pairs, and the rerun saw 1 on `KAU_C1USD` among 56 frames.

### Unknown and closed symbols

| request | reply | then |
|---|---|---|
| `symbolId=NOPE_C1USD` | ack, then `42["onInit",[{"symbolId":"NOPE_C1USD","bid":[],"ask":[]}]]` | nothing in 15 s |
| `symbolId=kau_c1usd` | ack, then `onInit` with an empty book | nothing in 15 s |
| no `symbolId` | ack only | nothing in 15 s |
| path `/notifications/market-data/v2/nope/` | HTTP 502 on the upgrade | no socket |
| `42["subscribe",{"symbolId":"KAG_C1USD"}]`, `42["subscribe","KAG_C1USD"]` and `42["join","KAG_C1USD"]` on a `KAU_C1USD` socket | no reply | only `KAU_C1USD` frames |

A delisted pair was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO 4 ping from the server every `pingInterval` 25,000 ms, answer within `pingTimeout` 20,000 ms | server `2` at 25.5, 50.6 and 75.8 s. Answering `3` kept a socket open for 90 s |
| silence the server tolerates | the open packet's `pingInterval` plus `pingTimeout`, 45 s | a socket that did not answer the ping closed at 45.47 and 45.51 s, and at 45.56 s twice in the rerun, with code 1005 and no reason, whether or not it had joined the namespace |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | | 454 to 694 ms to open over every socket of both runs |
| payload limit | `"maxPayload":1000000` in the open packet | the largest frame seen was the snapshots `onInit` at 77,834 bytes |
| subscription limits | one pair per socket | 40 sockets at once, no refusal |
| throughput | | 40 depth sockets, the first 40 pairs of the catalog: 25.5 and 28.3 `onChange` frames a second, 30.9 and 33.7 frames a second in all, 21,097 and 26,291 bytes a second, 684 and 781 bytes a frame, 7.1 and 8.0 µs to `JSON.parse` a frame of about 1,710 bytes |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Engine.IO open packet, and the client's namespace connect.

```text
0{"sid":"NBDF0mSOFgHSzju9AGfK","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40
```

Namespace acknowledgement.

```text
40{"sid":"uBmcxqqMewJxgT0wAGfL"}
```

Snapshot of `IMX_C1USD`, first two of its 10 levels per side kept.
On the wire each event frame is the JSON shown prefixed with `42`.

```json
["onInit",[{"symbolId":"IMX_C1USD","bid":[{"amount":2060806.11,"price":0.1545783,"ownedAmount":0},{"amount":414844.67,"price":0.1535784,"ownedAmount":0}],"ask":[{"amount":1377108.6,"price":0.1570489,"ownedAmount":0},{"amount":103290.64,"price":0.1580489,"ownedAmount":0}]}]]
```

Side replacement, a full 10 level side of a quiet pair.

```json
["onChange",{"symbolId":"IMX_C1USD","direction":"bid","depth":[{"amount":2060690.13,"price":0.154587},{"amount":414821.17,"price":0.1535871},{"amount":208769.74,"price":0.1525872},{"amount":168117.46,"price":0.1515873},{"amount":126925.32,"price":0.1505874},{"amount":106478.11,"price":0.1495875},{"amount":85755.71,"price":0.1485876},{"amount":64752.53,"price":0.1475877},{"amount":43462.81,"price":0.1465878},{"amount":21880.65,"price":0.1455879}]}]
```

Keepalive, the server's ping and the client's pong.

```text
2
3
```

Unknown pair.

```json
["onInit",[{"symbolId":"NOPE_C1USD","bid":[],"ask":[]}]]
```

Snapshots `onChange`, one pair of the map kept.

```json
["onChange",{"KAU_C1CAD":{"symbolId":"KAU_C1CAD","latestMidPrice":196.86719655000002,"dailyChange":0.0047,"dailyVolume":1324.77954580596,"dailyVolumeUsd":941.7851829626612,"dailyVolumeGrowth":0,"timeFrameVolume":{"5":0,"15":0,"60":0,"240":0,"1440":0},"bidPrice":196.3863892,"askPrice":197.3480039,"highestPrice":197.3059527,"lowestPrice":196.7566805}}]
```

Executions `onInit`, newest trade first, one of 50 kept.

```json
["onInit",[{"date":"2026-09-23T01:09:06.543Z","amount":0.2,"price":140.04,"symbolId":"KAU_C1USD"}]]
```

### The snapshots channel

Its `onInit` is a map of 210 pairs: the 162 listed pairs and 48 pairs ending in `_USD`, such as `KAU_USD`, that the catalog does not list.
Its rows carry `bidPrice` and `askPrice`, and those were crossed, bid above ask, on 10 of 210 `onInit` rows and 16 of 1,100 `onChange` rows in 30 s, and on 6 of 210 and 17 of 1,127 in the rerun, for example `BTC_C1EUR` at bid 76,154.89 and ask 76,080.62.
The depth books of the same pairs were not crossed, see [`rest.md`](./rest.md) section 5.
So the snapshot bid and ask are not the book's touch, and a feed must not read the touch from this channel.

## 7. Private channels

Named for a future execution stage, from the web app bundle, B1, not probed.
They use the same host and a logged-in session.

- `/notifications/order-data/orders`, `/notifications/balances/v4`, `/notifications/accounts/status-change`, `/notifications/accounts/persona-status-change`, `/notifications/accounts/kyc-version-change`.
- The documented key-signed API has no socket, and places orders with `POST /v1/exchange/orders`, S2.

## 8. Recommended feed shape

Kinesis should not get a feed, for the reasons in [`rest.md`](./rest.md) section 8.
The shape below records what a feed would have to be if written consent and a spot use case ever existed.

| item | value | reason |
|---|---|---|
| URL plan | one socket per pair, `wss://fastapi.kinesis.money/notifications/market-data/v2/depth/?symbolId=<id>&EIO=4&transport=websocket` | the pair is fixed by the URL, and no subscribe event exists |
| markets per connection | 1 | an emitted subscribe for a second pair was ignored |
| subscribe frames | `40` after the `0{…}` open packet | Socket.IO namespace connect |
| keepalive | answer every `2` with `3` | Engine.IO 4 closes a socket that misses one pong, at 45 s |
| `maxSilenceMs` | 60,000 | the server pings every 25 s, so a live socket is never quiet for 45 s, while a book can be quiet for 41 s |
| snapshot | `onInit`: `resetBook` with both sides | whole book |
| update | `onChange`: `resetBook` with the new side and the kept other side | whole side, no deltas |
| resync | on reconnect only | there is no sequence to check |
| unknown pair | treat an `onInit` with two empty sides as a pair to log, not a live book | the server does not reject an unknown or wrongly cased pair |
| receive time | stamp on arrival | frames carry no timestamp |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

The 162 listed pairs would need 162 sockets, and 40 of them cost 21 to 26 KB a second.
Updates at most once a second per side make this a slow feed next to the engine's other venues.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| B1 | kms.kinesis.money web app bundle: `config-DXqbasct.js` (`defaultApiRoot`), `socketIo-BMpcfRL9.js` (socket.io client, `EIO=4`, `transports:["websocket"]`), `useDepthLoading-Bv2CFafN.js` (depth path, `onInit`, `onChange`, `setAll`), `socket-kbnyLZAA.js` (snapshots path), `useDeviationAmount-CD27VBCy.js` (executions path), `exchange-view.slice-BKDVzBjP.js` (`${base}_${quote}`) | https://kms.kinesis.money/_assets/ | 2026-09-22 | Kinesis, global | sections 1 to 4 and 7 |
| S1 | Kinesis Terms of Use, Schedule 7 clauses 5.1.4 and 5.1.6 | https://kinesis.money/about-us/documents/terms-of-use/ | 2026-09-22 | Kinesis Cayman | data use restriction, introduction |
| S2 | Kinesis API example repository, `v1/kinesis_api_example.py` | https://github.com/bullioncapital/kinesis-api | 2026-09-22 | Kinesis | documented API is REST with key signing, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, `errors`, `streams`, `silence`, `batch` and `deflate`, first run 04:55 to 05:04 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kinesis/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `rest-probe.mjs books` at 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kinesis/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | REST level counts and order, section 4 |
| P3 | `ws-probe.mjs all`, the rerun, 05:11 to 05:16 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kinesis/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6, the second readings |
