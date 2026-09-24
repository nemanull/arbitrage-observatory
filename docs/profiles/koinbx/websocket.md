# KoinBX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 05:08 to 06:28 UTC, the evening of 2026-09-22 local time, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public futures socket that the koinbx.com/futures web app reads, for every KoinBX perpetual, with the book channel in detail.
KoinBX documents no WebSocket, so every protocol claim below comes from the web app's script bundle, S1, and from [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs).
The socket speaks Socket.IO 4 over Engine.IO 4, and Azure Web PubSub for Socket.IO serves it.
Its book channel is Binance USD-M's `@depth20@100ms` frame, one in five, with every price moved away from the touch by a fixed number of steps per contract and a few extra levels merged in, see section 4.
Access results are from the Canadian VPN exit and may differ from a direct connection.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| every perpetual, quoted in USDT or INR, crypto and TradFi | `wss://kbx-futures-prod.webpubsub.azure.com/clients/socketio/hubs/KoinBX_Trade_Hub/?EIO=4&transport=websocket` | upgrade 101 on every socket, open in 702 to 805 ms, namespace connect answered at 936 to 1,057 ms |
| private, for a future execution stage | the same host, path `/clients/socketio/hubs/KoinBX_Private_Hub`, with a token | not probed |

The web app builds the public socket from `url:"https://kbx-futures-prod.webpubsub.azure.com"` and `path:"/clients/socketio/hubs/KoinBX_Trade_Hub"`, S1, and a Socket.IO client turns those into the URL above.
One socket carries every family.
`BTCUSDT`, `BTCINR` and the TradFi contract `XAUUSDT` delivered side by side on one socket, and all 329 USDT-quoted contracts delivered on one socket, P1 and P2.
The host resolved to `57.159.87.133` and `2603:1040:a06:3::10d` on 2026-09-23, see [`rest.md`](./rest.md) section 1.
The Azure region is Not verified.
A Socket.IO `ping` came back in 238 to 261 ms from this exit, P1 and P4.

## 2. Channel matrix for public market data

A topic goes in the `params` array of a `subscribe` event, and its frames arrive as the Socket.IO event in the second column.

| topic | event | payload | cadence | probed |
|---|---|---|---|---|
| `<pair>@depth_<depthGrouping[0]>`, as `btcusdt@depth_0.1` | `depthUpdate` | 20 bids and 20 asks, the whole window in every frame | about every 500 ms on a busy contract, less often on a quiet one | section 4 |
| `<pair>@markPrice` | `markPriceUpdate` | `p` mark, `ap` unrounded mark, `i` index, `P` estimated settle price, `r` funding rate, `T` next funding, `lr`, `st` | one frame a second, 74 to 77 in 75 s | read against Binance in [`rest.md`](./rest.md) sections 3 and 4 |
| `<pair>@ticker` | `24hrTicker` | Binance's 24 h ticker fields plus `ps` and `st` | 6 and 5 frames in about 8 s on `BTCUSDT` | P4 |
| `<pair>@aggTrade` | `aggTrade` | Binance's aggregate trade plus `nq` and `st` | on trade, 7 and 8 frames in about 7 s | P4 |
| `<pair>@kline_<interval>` | `kline` | `"e":"continuous_kline"` | 9 and 11 frames in about 5 s at `1m` | P4 |
| `<pair>@mpKline_<interval>` | `mpKline` | `"e":"mark_price_kline"` | 4 frames in about 3 s at `1m` | P4 |
| `tickerArr` | `tickerArr` | an array of 592 `24hrTicker` objects: the 558 catalog contracts and 34 symbols the catalog does not list, such as `LAUSDT`, `LAINR` and `LUNA2USDT` | 2 frames between the subscribe and the unsubscribe acknowledgement | P4 |
| `!markPrice@arr` | none | | | acknowledged and silent in four runs |

The web app subscribes the first seven rows, S1.
It has no best bid and ask channel and no dedicated index or funding channel.
Every one of the 558 contracts has exactly one `depthGrouping` value, and the web app always subscribes `depthGrouping[0]`, S1 and [`rest.md`](./rest.md) section 2.
Another grouping, `ethusdt@depth_1`, and no grouping, `solusdt@depth`, were acknowledged and never delivered, P4.
So the book channel has one depth, 20 levels, and one speed, about 500 ms.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
KoinBX publishes no WebSocket documentation, so the documented column names the web app's code, S1, or the protocol, S2 and S3.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public hub in the web app, S1 | one socket carries USDT, INR and TradFi contracts, section 1 |
| subscribe frame shape | `socket.emit("subscribe", {params: [...topics]})`, S1 | `42["subscribe",{"params":[...]}]` with 2, 10 and 329 topics, each answered by one acknowledgement |
| unknown symbol expectation | Not publicly specified | acknowledged in `subscribed` and then silent: `nopeusdt@depth_0.1`, `BNBUSDT@depth_0.01`, `ethusdt@depth_1`, `solusdt@depth` and `btcusdt@nope` |
| chunk unit and budget | Not publicly specified | 329 topics in one 8,088-byte frame, all acknowledged in one reply and all delivering, in two runs |
| keepalive mechanism | Engine.IO: the server sends ping `2` every `pingInterval` and expects pong `3` within `pingTimeout`, S3. The handshake gives 25,000 and 20,000 ms | a server `2` every 25 s. A socket that never answered closed at 45.9 to 46.0 s with 1000 in three runs. The Socket.IO event `ping` is answered by `pong` in 238 to 261 ms |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 110 s, and no maintenance event |
| handshake and operation rate limits | Not publicly specified | no refusal in any run, the largest being one 329-topic subscribe |
| public market data authentication | none: the public hub's client has no `authFn`, S1 | none |
| message parse and routing | the event name, then the payload, S1 | strip `42`, parse `[event, payload]`, route on the event name and then on `s`. `ps` names the Binance contract |
| subscribe acknowledgement shape | Not publicly specified | `42["subscriptionStatus",{"action":"subscribe","subscribed":[...],"alreadySubscribed":[...]}]`, 238 to 282 ms after the subscribe. The first book frame can arrive before it |
| symbol identifier format | topic `${pair.toLowerCase()}@depth_${grouping}`, S1 | the topic is lowercase and case-sensitive. Frame `s` is the catalog `pair`, as `BTCUSDT` or `BTCINR` |
| number representation | Not publicly specified | price and size as strings. Prices drop trailing zeros, as `"86518"`. Sizes keep Binance's string, as `"0.130"` |
| timestamp representation | Not publicly specified | `E` and `T` in Unix ms, equal to Binance's event and transaction times for the same `u` |
| size unit | Not publicly specified | base coin, Binance's own sizes, section 4 |
| sequence semantics | Not publicly specified | `U`, `u` and `pu` are Binance's ids. `pu` equalled the previous frame's `u` on 0 or 1 of about 150 `BTCUSDT` frames per run, so no chain exists |
| idle repeat behaviour | Not publicly specified | no repeat on a timer. `IRYSUSDT` went up to 13.0 s without a frame. A frame identical to the one before came once in each of two of five runs |

## 4. The book channel in detail

`<pair>@depth_<depthGrouping[0]>` is the only book channel.
The rows below come from five 75 s runs, P1, on `BTCUSDT`, `ETHUSDT`, `DOGEUSDT`, `XAUUSDT`, `BTCINR` and the quietest USDT perpetual by volume, `IRYSUSDT`, beside Binance's `@depth20`, `@depth20@100ms` and `@depth20@500ms` streams.

### Snapshot on subscribe

Every frame is a whole 20-level book, so there is no separate snapshot.
The first frame arrived 234 to 250 ms after the subscribe frame in the five runs.
The web app replaces its displayed book with every frame, S1.

### Delta semantics

None.
A level missing from the next frame is gone.

### Sequence and gap rule

```text
every frame           replace the book with its 20 bids and 20 asks
U, u, pu              Binance's ids of the copied frame, for logging only
pu != previous u      normal, since four of five Binance frames are skipped
```

On the busy contracts `pu` equalled the previous frame's `u` on 1 of 150 frames once and on 0 in every other run.
On `IRYSUSDT` it did on 22 to 39 of 31 to 61 frames, because a quiet book skips no Binance frame.
Whether `u` ever goes backwards was not checked.

### Checksum

None documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket `depthUpdate` | ascending, best last, on every frame of every run | ascending, best first, on every frame |
| REST `orderBook` | ascending, best last | ascending, best first, [`rest.md`](./rest.md) section 5 |
| Binance `@depth20@100ms` | descending, best first | ascending, best first |

### How a frame is made from Binance's

Each frame is Binance's `@depth20@100ms` frame with the same `u`.
In the 06:22 run, `U` and `pu` equalled those of Binance's `@depth20@100ms` frame with the same `u` on every frame: 152 on `BTCUSDT` and `BTCINR`, 151 on `ETHUSDT` and `DOGEUSDT`, 149 on `XAUUSDT` and 55 on `IRYSUSDT`, P1.
In all five runs every KoinBX frame's `u` was also sent by one of Binance's `@depth20` streams.
Frames arrive every 498 to 503 ms at the median on a busy contract, so KoinBX forwards one Binance frame in five.

The prices are not Binance's.
KoinBX lays the levels on a contiguous grid of one `depthGrouping` step, starting a fixed number of steps outside Binance's touch, and keeps Binance's sizes in order.
The first `BTCUSDT` frame of the 06:11 run shows it, with Binance's frame of the same `u`, P1.

| level | size | KoinBX bid | Binance bid | size | KoinBX ask | Binance ask |
|---:|---|---|---|---|---|---|
| 1 | `6.602` | 86519.7 | 86519.90 | `3.096` | 86520.2 | 86520.00 |
| 2 | `0.130` | 86519.6 | 86519.80 | `0.008` | 86520.3 | 86520.10 |
| 3 | `0.019` | 86519.5 | 86519.70 | `0.002` | 86520.4 | 86520.20 |
| 4 | `0.002` | 86519.4 | 86519.60 | `0.004` | 86520.5 | 86520.30 |
| 5 | `0.011` | 86519.3 | 86519.50 | `0.057` | 86520.6 | 86520.40 |
| 6 | `0.024` | 86519.2 | 86519.20 | `0.002` | 86520.7 | 86520.60 |

Binance had no bid at 86519.40 or 86519.30 and no ask at 86520.50.
KoinBX closed those gaps, so a Binance size deep in the book appears closer to the touch than Binance quotes it.
Every `BTCUSDT` frame of the 06:11 and 06:22 runs sat on the grid, while Binance's 20 levels were contiguous on 0 of 303 frames.
At the 20th level KoinBX's price was 1 to 30 ppm better than Binance's for the same size, with a median of 8 to 12 ppm, P1.

| contract | step | steps outside Binance's touch, each side | ppm |
|---|---|---:|---:|
| `BTCUSDT` | 0.1 | 2 | 2.3 |
| `ETHUSDT` | 0.01 | 10 | 36 |
| `XAUUSDT` | 0.01 | 20 | 46 |
| `DOGEUSDT` | 0.00001 | 6 | 589 to 593 |
| `IRYSUSDT` | 0.00001 | 2 | 1,202 to 1,233 |
| `BTCINR` | 0.1 USDT | 5 | 5.8 |

The shift held on every frame of the 06:11 and 06:22 runs whose touch was not an extra level, on all six contracts, P1.
So KoinBX's spread is Binance's widened by twice the shift, which is the 6 against 1 ppm and 1,260 against 97 ppm of [`rest.md`](./rest.md) section 5.

### Extra levels

Some levels are not in Binance's frame.
A level is either inserted in front of the copied touch, or its size exceeds Binance's size at the same level.
These levels sit at a fixed price and size for minutes, often at a round price, which is what resting limit orders placed on KoinBX would look like.
That reading is an inference, and the source is Not publicly specified.

| contract | extra levels in the 06:22 run, price, size and frames | frames with any |
|---|---|---|
| `BTCUSDT` | ask 86480 plus 0.002 on 20, ask 86474.6 of 0.008 inserted on 14, bid 86456.5 of 0.036 inserted on 11 | 46 of 152 |
| `ETHUSDT` | ask 2759 of 0.009 inserted on 20, bid 2757.39 of 0.009 inserted on 13 | 43 of 151 |
| `DOGEUSDT` | ask 0.102 of 57 on every frame | 151 of 151 |
| `XAUUSDT` | 19 distinct, such as bid 4332.43 of 0.002 inserted on 44 | 139 of 149 |
| `BTCINR` and `IRYSUSDT` | none | 0 |

The `ETHUSDT` bid of 0.009 at 2757.39 was already in the first frame of the 06:11 run.
`BTCINR` matched Binance's sizes on every level of every frame in all five runs, while `BTCUSDT` did not, so an extra level belongs to one KoinBX contract and not to the Binance book behind it.
An inserted level takes one of the 20 slots.
It can sit past Binance's touch: an `XAUUSDT` bid 19 steps, about 44 ppm, above Binance's best bid, and an `ETHUSDT` bid 10 steps, about 36 ppm, above it.
Extra sizes in the 06:22 run were 0.002 to 0.036 BTC, 0.009 to 0.011 ETH and 57 DOGE, and the ten most frequent on `XAUUSDT` were 0.002 to 0.054 XAU.
No frame was crossed or locked in the 06:11 and 06:22 runs.

### INR contracts

An INR frame is the USDT contract's Binance frame converted to rupees.
`BTCINR` carries `"ps":"BTCUSDT"`, its sizes are Binance's `BTCUSDT` sizes in BTC, and its `U` and `pu` are that Binance frame's, P1.
Every level, divided by 95.55, lay on the 0.1 USDT grid 5 steps outside Binance's touch, within 1.05 rupees, on 152 of 152 frames in the 06:22 run.
The 95.55 factor is the one of [`rest.md`](./rest.md) section 4.
With 0.57 rupees of tolerance the same test failed on all 149 frames of the 06:11 run, so a level is not always the nearest rupee.

### Level window

20 bids and 20 asks on every frame of every run, including `IRYSUSDT` and the INR contract.

### Size unit against the catalog

KoinBX has no CCXT class, so there is no CCXT `contractSize`, see [`fees.md`](./fees.md) section 8.
The catalog has no contract size, and its quantities are base units, see [`rest.md`](./rest.md) section 2.

| contract | `quantityPrecision` | socket size, best bid, first frame of the 06:11 run | Binance size at the same level | unit |
|---|---:|---|---|---|
| `BTCUSDT` | 3 | `"6.602"` | `"6.602"` | BTC |
| `DOGEUSDT` | 0 | `"86385"` | equal on every level of the run | DOGE |
| `BTCINR` | 3 | `"4.616"` | equal on every level of the run | BTC |

No size carried more decimals than `quantityPrecision` and no price more than `pricePrecision`, over 5,960 to 6,080 levels per busy contract in each of the 06:11 and 06:22 runs.
So the unit is one coin, and the engine's `sizeMul` would be 1.

### One-sided and empty books

None was seen, so what a side with no orders looks like is Not verified.

### Idle repeats

Nothing repeats on a timer.
`IRYSUSDT` sent 32 to 62 frames in 75 s with gaps up to 13.0 s.
In the first 329-contract run the quietest contract sent 1 frame in 60 s, and in the rerun the quietest, `WMTUSDT`, sent 4, P2.

### Unknown, closed and wrong-grouping topics

| request | reply | then |
|---|---|---|
| `nopeusdt@depth_0.1` | `subscribed: ["nopeusdt@depth_0.1"]` | nothing |
| `BNBUSDT@depth_0.01`, uppercase | acknowledged | nothing |
| `ethusdt@depth_1`, a grouping not in the catalog | acknowledged | nothing |
| `solusdt@depth`, no grouping | acknowledged | nothing |
| `btcusdt@nope` | acknowledged | nothing |
| `btcusdt@depth_0.1` twice in one frame | `subscribed` and `alreadySubscribed` both list it | one stream |
| `unsubscribe` of seven topics | `{"action":"unsubscribe","unsubscribed":[...],"notSubscribed":[]}` | the streams stop |
| `subscribe` with `topics` in place of `params` | `42["error","params is required for subscribe."]` | the socket keeps serving |
| text that is not a packet, `hello` | none | the server closed the socket 464 to 511 ms later with 1000 |

All 558 contracts were `Open`, see [`rest.md`](./rest.md) section 2, so a closed contract could not be probed.
Because an unknown topic is acknowledged as a success, a feed has to notice a topic with no frame on its own.

### Against Binance USD-M

The engine already reads Binance's `@depth20@100ms` directly, at `server/src/venues/binance/binance.ts` line 25, beside `@depth@0ms` diffs at line 21.

| item | Binance USD-M | KoinBX |
|---|---|---|
| protocol | plain WebSocket JSON, see [`../binance/websocket.md`](../binance/websocket.md) section "USD-M public book channels" | Socket.IO 4 over Engine.IO 4 |
| book | 20 levels every 100 ms, and diffs as they happen | Binance's 20 levels, one frame in five |
| prices | the matching engine's | shifted outward by 2 to 20 steps and regridded |
| sizes | the matching engine's | Binance's, plus extra levels |
| ids | `pu` chains to the previous `u` on the diff stream | Binance's ids, with no chain |
| arrival at this host | | 131 to 872 ms after the Binance frame of the same `u`, with a median of 209 to 255 ms on busy contracts and 329 to 402 ms on `IRYSUSDT` |
| mark, index and funding time | `premiumIndex` | the same numbers, rounded, with the same `E` and `T`, see [`rest.md`](./rest.md) section 4 |

A KoinBX book beside Binance's can only show KoinBX's widening, about 240 ms late, and never a cross, except through an extra level past Binance's touch.
The furthest an extra level reached was the `XAUUSDT` bid about 44 ppm above Binance's best bid, on 0.002 XAU, far under the 500 ppm taker of [`fees.md`](./fees.md) section 2.

## 5. Session

| item | documented | probed |
|---|---|---|
| handshake | Engine.IO open packet `0{sid, upgrades, pingInterval, pingTimeout, maxPayload}`, then the client joins with `40`, S3 | `0{"sid":…,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}` on open, and `40{"sid":…}` about 240 ms after the client's `40` |
| keepalive | the server pings every 25,000 ms and waits 20,000 ms for the pong, S2 and S3. The web app also emits `ping` every 8 s, and `ping` plus a full re-subscribe every 30 s, S1 | four server `2` frames in 110 s, one every 25 s. The client answer `3` is enough, and no re-subscribe was needed: a socket that answered pings and never re-subscribed got 116, 134 and 120 book frames after 60 s in three runs |
| silence the server tolerates | Not publicly specified | a joined socket with no subscription stayed open 110 s when it answered pings, in three runs. A socket that did not answer closed at 45,937 to 45,983 ms with 1000 |
| namespace join timeout | Socket.IO's `connectTimeout` defaults to 45,000 ms, S2 | a socket that never sent `40` closed at 45,941 to 46,009 ms with 1000, in three runs |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | text frames only. A client offering permessage-deflate got no `sec-websocket-extensions` back in four runs |
| upgrade headers | | `connection`, `upgrade`, `sec-websocket-accept`, `strict-transport-security` and `date`, with no server or region header |
| subscription limits | Engine.IO `maxPayload` 1,000,000 bytes for a client packet, from the handshake | 329 topics in one socket and one frame, no refusal |
| throughput | | 329 USDT-quoted contracts: 24,545 and 26,813 frames in 60 s, a median of 426 and 456 frames per second, peaks of 543 and 584, 395 and 432 KB per second, 966 bytes per frame, 36 and 38 µs of `JSON.parse` per frame, P2 |
| malformed subscribe | Not publicly specified | see below |
| access | | every socket upgraded with 101 from the Canadian exit, and none was refused |

A `subscribe` whose `params` was a string stalled the hub for this host.
At 05:08 and 05:41 UTC it went out on the socket under test, which then got no pong and no unsubscribe acknowledgement for the rest of its life, about 9 s, P4.
At 05:41 that socket's book stream delivered 16 frames from 8.7 s, where about 24 were due before its unsubscribe at 20.5 s, which fits the stream stopping near the malformed frame at 16.0 s.
At 05:08 the stream went on, with 27 frames where about 24 were due, so the unsubscribe was not applied.
At 06:14 UTC it went out on a socket of its own, and three other open sockets of this host got no reply to any of 19 emits over the next 26 s, until the probe closed them.
A new socket 39 s after the frame subscribed and was served normally.
Whether other KoinBX clients were stalled too is Not verified, and the probe no longer sends that frame.
An unknown event name went out beside it in all three runs, so its own effect is Not verified.

## 6. Captured frames

Captured by P1 and P4 on 2026-09-23.
Book frames keep the three best levels per side, which for bids are the last three.
Each frame is shown as it crossed the wire, with its Engine.IO and Socket.IO prefix.

Open packet and namespace join.

```text
0{"sid":"Cv1gE4eqzUoUsTfUdil6ZgwcPcrAw02","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
```

```text
40{"sid":"aY3wfz-2a5_NGIPeAAEf"}
```

Subscribe, as sent, and an acknowledgement.

```text
42["subscribe",{"params":["btcusdt@depth_0.1","btcusdt@markPrice"]}]
```

```text
42["subscriptionStatus",{"action":"subscribe","subscribed":["btcusdt@depth_0.1","ethusdt@depth_0.01","dogeusdt@depth_0.00001","irysusdt@depth_0.00001","xauusdt@depth_0.01","btcinr@depth_0.1","btcusdt@markPrice","ethusdt@markPrice","btcinr@markPrice","irysusdt@markPrice"],"alreadySubscribed":[]}]
```

Book frame, the first `BTCUSDT` frame of the 06:11 run, whose Binance twin is the table in section 4.

```text
42["depthUpdate",{"e":"depthUpdate","E":1790143908674,"T":1790143908673,"s":"BTCUSDT","ps":"BTCUSDT","U":11633556069952,"u":11633556076016,"pu":11633556069840,"b":[["86519.5","0.019"],["86519.6","0.130"],["86519.7","6.602"]],"a":[["86520.2","3.096"],["86520.3","0.008"],["86520.4","0.002"]],"st":1}]
```

Book frame with an extra level: the best bid 2757.39 of 0.009 ETH sits 20 steps above the copied bid at 2757.19.

```text
42["depthUpdate",{"e":"depthUpdate","E":1790143909606,"T":1790143909605,"s":"ETHUSDT","ps":"ETHUSDT","U":11633556130919,"u":11633556141063,"pu":11633556130836,"b":[["2757.18","0.065"],["2757.19","79.484"],["2757.39","0.009"]],"a":[["2757.4","218.924"],["2757.41","6.817"],["2757.42","0.055"]],"st":1}]
```

INR book frame, which names the Binance contract in `ps`.

```text
42["depthUpdate",{"e":"depthUpdate","E":1790143909718,"T":1790143909717,"s":"BTCINR","ps":"BTCUSDT","U":11633556143979,"u":11633556151726,"pu":11633556143978,"b":[["8266910","0.012"],["8266920","0.090"],["8266929","4.616"]],"a":[["8267034","5.280"],["8267044","0.008"],["8267053","0.002"]],"st":1}]
```

Mark frame.

```text
42["markPriceUpdate",{"e":"markPriceUpdate","E":1790143909000,"s":"BTCUSDT","p":"86520","ap":"86520.00000000","P":"86595.6","i":"86561","r":"0.00000837","T":1790150400000,"st":1,"lr":"0.000009189"}]
```

Keepalive: the server's Engine.IO ping and the client's answer, then the Socket.IO ping and its pong.

```text
2
3
42["ping"]
42["pong"]
```

Unsubscribe acknowledgement, a duplicate, and an error.

```text
42["subscriptionStatus",{"action":"unsubscribe","unsubscribed":["btcusdt@depth_0.1","btcusdt@ticker","btcusdt@aggTrade","btcusdt@kline_1m","btcusdt@mpKline_1m","!markPrice@arr","tickerArr"],"notSubscribed":[]}]
```

```text
42["subscriptionStatus",{"action":"subscribe","subscribed":["btcusdt@depth_0.1"],"alreadySubscribed":["btcusdt@depth_0.1"]}]
```

```text
42["error","params is required for subscribe."]
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- Hub `KoinBX_Private_Hub` on the same host, joined with `auth: {token}` from the web app's stored token, and with no topic subscribe.
- Events `newOrder`, `updateOrder`, `orderFilled`, `orderPartiallyFilled`, `orderCancelled`, `orderFailed`, `newTrade`, `newPosition`, `updatePosition`, `closePosition`, `balanceUpdate`, `privateSubscriptionStatus`, `subscribed`, `sessionExpired` and `__keepalive__`.

## 8. Recommended feed shape

Do not build a KoinBX book feed.

| reason | evidence |
|---|---|
| the book is Binance's `@depth20@100ms`, one frame in five, about 240 ms later than the engine already reads it | section 4 |
| its prices are moved outward by a fixed shift and regridded, so beside Binance it shows KoinBX's markup and never a cross, except through small extra levels | section 4 |
| no contract settles in the engine's USD family | [`rest.md`](./rest.md) section 2 |
| only Indian residents may trade | [`fees.md`](./fees.md) section 1 |
| the socket is undocumented, and one malformed subscribe stalled it | sections 3 and 5 |

If a later design wanted KoinBX's book anyway, as its own markup, this is the shape the probes support.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://kbx-futures-prod.webpubsub.azure.com/clients/socketio/hubs/KoinBX_Trade_Hub/?EIO=4&transport=websocket` | one socket serves every family |
| framing | answer `0` with `40`, answer every `2` with `3`, parse `42` as `[event, payload]` | Engine.IO and Socket.IO over a plain `ws` socket, as the probe does |
| markets per connection | 329 | tested twice with every contract delivering, and no cap is published |
| subscribe frames | `42["subscribe",{"params":["btcusdt@depth_0.1", ...]}]`, spelled from `pair` and `depthGrouping[0]` | one acknowledgement per frame |
| keepalive | the Engine.IO answer, plus `42["ping"]` every 15 s so that traffic never depends on the book | a quiet contract sent 1 frame in 60 s |
| `maxSilenceMs` | 60,000 | the server pings every 25 s, and the web app itself tears down after 60 s without an event |
| routing | the event `depthUpdate`, then `s`, which is the catalog `pair` | `ps` is the Binance contract, and it is `BTCUSDT` for `BTCINR` |
| snapshot | `resetBook` on every frame, bids reversed so the best is first | every frame is the whole window, bids ascending |
| resync | never from `U`, `u` or `pu`. On silence past `maxSilenceMs`, terminate and resubscribe | the ids skip by design |
| re-subscribe | send the full `subscribe` again every 30 s, as the web app does | cheap insurance, since the hub ignored this host's events for at least 26 s once |
| unserved topic | log a topic with no frame 10 s after its acknowledgement | unknown topics are acknowledged as success |
| malformed frames | build `params` as an array only | a string `params` stalled the hub for this host |
| receive time | stamp on arrival, never from `E` | `E` is Binance's event time, 200 to 935 ms before arrival |
| sizes | `Number()` of the string, base coin | section 4 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KoinBX futures web app script bundle: `SocketManager` and `getPublicSocket` in `ccb08803e1e36662.js`, the order book and private hub in `4883b6c18c2eeee9.js`, the mark subscription in `d24cc93158cfcc0d.js` | https://koinbx.com/futures/btcusdt, scripts under `/futures/_next/static/chunks/` | 2026-09-23 | KoinBX | hub URL and path, topic spellings, event names, keepalive, re-subscribe and staleness timers, whole-book replacement, private hub, sections 1 to 8 |
| S2 | Socket.IO v4 server options | https://socket.io/docs/v4/server-options/ | 2026-09-23 | Socket.IO | `connectTimeout` 45,000, `pingInterval` 25,000 and `pingTimeout` 20,000 defaults, section 5 |
| S3 | Engine.IO protocol v4 | https://socket.io/docs/v4/engine-io-protocol/ | 2026-09-23 | Socket.IO | the server sends ping, the client answers pong, open packet fields, sections 3 and 5 |
| S4 | Binance USD-M public streams and `premiumIndex`, and [`../binance/websocket.md`](../binance/websocket.md) | `wss://fstream.binance.com/stream?streams=<symbol>@depth20@100ms` and https://fapi.binance.com/fapi/v1/premiumIndex | 2026-09-23 | Binance | the comparison frames, section 4 |
| P1 | `ws-probe.mjs book`, at 05:09, 05:14 and 05:16 UTC, and reruns with the grid test at 06:11 and 06:22 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, 100 contracts at 05:11 and 05:38 UTC, and all 329 USDT-quoted contracts at 06:18 and 06:24 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 1, 3, 4, 5 and 8 |
| P3 | `ws-probe.mjs silence`, at 05:12, 05:39 and 06:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 3 and 5 |
| P4 | `ws-probe.mjs errors`, at 05:08 and 05:41 UTC with the string `params` on the socket under test, at 06:14 UTC with it on its own socket, and at 06:16 and 06:27 UTC without it, plus one 8 s subscribe by hand at 06:15 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 2 to 6 |
| P5 | `ws-probe.mjs deflate`, at 05:08, 05:42, 06:17 and 06:28 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | section 5 |
