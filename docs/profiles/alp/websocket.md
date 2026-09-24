# ALP.COM WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:45 to 05:03 UTC, and the second pass 05:07 to 05:12 UTC, from the development host near Seattle, through a VPN exit in Canada.

This profile covers the public WebSocket of ALP.COM, the former BTC-Alpha, on its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
About 12 minutes of socket time were spent on this venue in total, including two early scratch runs that the probe's `limits` mode now repeats.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every pair | `wss://www.alp.com/ws`, S1 and S2 | upgrade 101 behind Cloudflare, open in 533 to 647 ms over seven book sockets, welcome frame within 2 ms of the open |

One URL carries every pair and every channel.
The upgrade reply carried `server: cloudflare` and a `cf-ray` ending in `SEA` or `YVR`, and one upgrade carried `server-timing: cfEdge;dur=8,cfOrigin;dur=494`, so almost all of the open time is the leg from the edge to the origin.
No permessage-deflate was negotiated, see section 5.

## 2. Channel matrix for public market data

| channel | topic | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| market depth | `market_depth.<PAIR>` | whole book of up to 20 levels per side, message type `p` | pushed only when the book changed, on a whole second grid: 164 and 216 frames on 22 pairs in two 75 s runs, 12 pairs active and the same 10 pairs silent in both |
| depth diff | `diff.<PAIR>` | price and quantity differences, message type `d`, S3 | acknowledged, and 0 frames on 20 pairs over 75 s in both runs, and 0 on `BTC_USDT`, `BTC_USDC` and `ETH_USDC` in two earlier runs of 30 s and 38 s |
| ticker | `ticker.*` only, S4 | message type `tk`, one row per pair that changed | 65 and 71 frames in 75 s, and in the first run 1 to 6 rows each and 962 to 3,002 ms apart, each row carrying bid and ask |
| ticker for one pair | `ticker.BTC_USDC` | "will not receive any data", S4 | acknowledged, and no frame in the 9 s the socket then stayed open |
| trades | `trade.*` or `trade.<PAIR>` | message type `t`, S4 | 64 and 67 frames in 75 s on `trade.*` |
| mark, index, funding | none | | ALP.COM publishes none, see [`rest.md`](./rest.md) section 3 |

The channel names and message types are from S3 and S4.
The only book channel that delivered anything is `market_depth`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for all 22 pairs quoted in USDT and USDC |
| subscribe frame shape | `["subscribe", "topic1", "topic2", ...]`, S2 | as documented. Frames of 1 to 12 topics were each acknowledged by one frame. A JSON object, a non-JSON text or an empty array closes the socket with 1006 |
| unknown symbol expectation | `["error",1586857703.901509,"Topic does not exist"]`, S2 | `["error",1790139264,"Invalid topic: diff.NOPE_USDT","subscribe"]`. The same for `market_depth.NOPE_USDT`, the lower case `market_depth.btc_usdc` and the unknown channel `nope.BTC_USDC` |
| chunk unit and budget | Not publicly specified | 20 valid topics per connection, counted across frames. The 21st single-topic frame, and a third frame of 8 after two of 8, each got `["error",…,"Too many topics","subscribe"]` and none of that frame was added. An unsubscribe frees its topics. A frame naming 21 topics is refused with `Too many topics` even when every topic is invalid. A frame of 800 bytes was read, and one of 850 bytes made the server close with 1009 |
| keepalive mechanism | the server sends the text `1` every 20 s, the client answers the text `2`, and the server closes a client that has not answered within 30 s, S2 | the server never sent a text `1`. It sent a WebSocket protocol ping 20 s after the last frame it had sent, and again every 20 s while it had nothing else to send. A text `1` or `2` from the client closed the socket with 1006 about 170 ms later, one round trip to the origin |
| connection lifetime and maintenance notice | not documented | no forced close in 120 s on any of six silence sockets, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | none reached. Six sockets opened one after another in the `errors` mode and five in the `limits` mode, each within about 2 s of the last, and none was refused |
| public market data authentication | none, S1 | none |
| message parse and routing | JSON arrays whose first element is the type, S2 to S4 | as documented. Route `p` on `frame[2].Symbol`, `d` on `frame[2]`, `t` on `frame[3]`, and each `tk` row on `row[0]` |
| subscribe acknowledgement shape | `["subscribe",1586857703.901509,"topic1","topic1"]`, S2 | `["subscribe",1790139140,"market_depth.ZEC_USDC","trade.*","ticker.*"]`, one per frame, listing the topics of that frame. A repeated subscribe is acknowledged again, and an unsubscribe of a topic never subscribed is acknowledged |
| symbol identifier format | `BTC_USDT`, S3 | identical to the REST `pairs` `name` on 22 of 22 pairs, upper case only |
| number representation | strings in the examples, S3 and S4 | `p` levels, `TotalAsks` and `TotalBids` as decimal strings. `tk` fields as strings. `t` amount and price as strings and the trade id as a JSON number |
| timestamp representation | "A floating-point number" for the welcome frame, and floats in the acknowledgement example, S2 | integer Unix seconds at index 1 of every frame received, including the welcome frame |
| size unit | "quantity", S3 | base currency. The last `p` frame equalled the REST book level for level on 40 of 40 levels in 12 of 12 compares per run, both runs |
| sequence semantics | none documented | none on the wire. No `p` frame carries a sequence or update id, and each one is a whole book |
| idle repeat behaviour | not documented | 35 of 164 and 27 of 216 `p` frames repeated the previous frame's levels exactly. A book that does not change sends nothing: 10 of 22 pairs sent no frame in 75 s in either run, and the longest gap between frames of an active pair was 25 s and 64 s |

## 4. The book channel in detail

`market_depth` is the only book channel that delivered data, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

There is none.
The acknowledgement comes alone, and the first `p` frame waits for the next second in which the book changes.
Over the two runs the first frame of an active pair came 383 ms to 20.4 s after the subscribe frame, and 10 pairs sent none in 75 s.
Among those 10 are `EURQ_USDC`, whose REST book holds 20 levels a side, and `USDT_USDC`, whose ticker showed a bid of 0.11 and an ask of 140, see [`rest.md`](./rest.md) section 2.
So a feed that relies on the socket alone has no book for a quiet pair until someone changes it, and the REST book is the only way to seed it.

### Delta semantics

There are no deltas on the wire.
Every `p` frame is the whole top of the book, up to 20 levels a side, and replaces the previous one.
`TotalAsks` and `TotalBids` equalled the sum of the 20 sizes sent in 164 of 164 frames of the first run.
The documented example of S3 shows a `TotalAsks` far above the levels it lists, which the wire did not reproduce.

The documented `diff` channel would carry `[price, quantity difference]` pairs, S3, but it sent no frame in any run.

### Sequence and gap rule

```text
p frame        resetBook with every level of the frame, then publish
d frame        never observed
gap            not detectable, since no frame carries a sequence
```

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `p` | best first, descending, in every frame of both runs | best first, ascending, in every frame of both runs |
| REST `orderbook` | descending | ascending |

### Level window

The server sends at most 20 levels a side.
Every `p` frame of an active pair held 20 and 20, except `DOGE_USDT`, whose bid side held 4 levels in every frame of both runs.
Those 4 bids ran from 0.0671 down to 0.00004, against a last price near 0.1037.
Its best ask of 0.08368 is a standing order about 19 % below where the pair trades, and no trade touched it, see [`rest.md`](./rest.md) section 2.

### Size unit

Sizes are in the base currency, for example `"0.86616571"` BTC on `BTC_USDC`.
The REST book reports the same amounts as JSON numbers, and the socket and REST agreed on 40 of 40 levels in all 24 compares, including compares where the socket's last frame was 16 s old, which means the book had not changed.
A spot pair has no contract size, so there is nothing to reconcile with CCXT `contractSize`, and CCXT has no class for this venue anyway, see [`fees.md`](./fees.md) section 8.

### One-sided and empty books

`ZEC_USDC` had an empty REST book, `{"buy":[],"sell":[]}`, and its `market_depth` topic was acknowledged and sent nothing.
`ALP_USDT`, `GRDR_USDT` and `DCY_USDT` hold stub quotes, see [`rest.md`](./rest.md) section 2, and sent nothing either.
No `p` frame with an empty side was seen, so what the server sends when a side empties is Not verified.

### Idle repeats

35 of 164 and 27 of 216 `p` frames repeated the previous frame's levels exactly.
The cause is not published, and a change beyond the 20 levels sent would explain it.
A book with no change sends nothing at all.

### Timing

Every gap between two `p` frames of one pair was within 100 ms of a whole number of seconds, 152 of 152 and 204 of 204, with a minimum of 962 ms.
Each frame arrived 589 to 641 ms after the whole second written at its index 1.
The server clock agrees with this host to within about a second, see [`rest.md`](./rest.md) section 7, so how much of that 0.6 s is transit and how much is the server's own delay is not known.
The book is therefore at best a one second snapshot that is about half a second old on arrival.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `["subscribe","diff.NOPE_USDT"]` | `["error",…,"Invalid topic: diff.NOPE_USDT","subscribe"]` | socket stays open |
| `["subscribe","market_depth.NOPE_USDT"]` | `Invalid topic: market_depth.NOPE_USDT` | socket stays open |
| `["subscribe","market_depth.btc_usdc"]` | `Invalid topic: market_depth.btc_usdc` | socket stays open |
| `["subscribe","nope.BTC_USDC"]` | `Invalid topic: nope.BTC_USDC` | socket stays open |
| `market_depth.ZEC_USDC` twice | acknowledged twice | nothing, the book is empty |
| `["unsubscribe","diff.ETH_USDC"]`, never subscribed | acknowledged | |
| 21 topics in one frame | `Too many topics` | socket stays open |
| 46 topics in one frame, 934 bytes | none | the server closes with 1009 |
| `{"op":"subscribe","args":[…]}` | none | closed with 1006 |
| `hello` | none | closed with 1006 |
| `[]` | none | closed with 1006 |
| `1` or `2` | none | closed with 1006 |

No pair was closed or delisted on 2026-09-22, since the catalog has no status field, see [`rest.md`](./rest.md) section 2.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | text `1` from the server every 20 s, text `2` back, S2 | protocol pings only, 20 s after the server's last frame: at 20.5, 40.5, 60.5, 80.5 and 100.5 s on a socket with no subscription, at 20.7, 40.7 and 60.7 s on the `diff` socket that received no data, and never on the two `market_depth` sockets of each book run, which received data every few seconds |
| silence the server tolerates | 30 s without a pong closes the connection, S2 | a socket with `autoPong` off, which never answered a ping, stayed open for the full 120 s and then 60 s in the rerun. A subscribed socket on the quiet `USDC_USDT` book with `autoPong` off also stayed open 120 s and 60 s, with a longest gap of 21.0 s and 23.6 s between data frames |
| forced disconnect | not documented | none in 120 s |
| maintenance notice | not documented | none seen |
| compression | not documented | a client that offered permessage-deflate got no `sec-websocket-extensions` header back in either run, so the server does not negotiate it. Frames are text JSON |
| handshake | | 533 to 647 ms to open from this host |
| subscription limits | not documented | 20 valid topics per connection, and an inbound frame over about 800 bytes closes the socket with 1009, section 3 |
| access | | every upgrade answered 101 from this host through the Canadian VPN exit, and nothing was refused for location |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 between 04:52 and 04:55 UTC.
Arrays marked `…` are cut.

Welcome, sent on open.

```json
["welcome",1790139140,20000,30000,"ec9a0e3f-31af-43ab-9317-89e06728a641"]
```

Subscribe and its acknowledgement.

```json
["subscribe","market_depth.ZEC_USDC","trade.*","ticker.*"]
```

```json
["subscribe",1790139140,"market_depth.ZEC_USDC","trade.*","ticker.*"]
```

Market depth, the first three levels per side kept of 20.

```json
["p",1790139143,{"Asks":[["87164","0.43276442"],["87257.69","0.03212722"],["87283.83","0.04572394"]],"Bids":[["87163","0.86616571"],["85996.41","0.04583607"],["85970.23","0.04591895"]],"Symbol":"BTC_USDC","TotalAsks":"1.2654544","TotalBids":"1.69687843"}]
```

The `BTC_USDC` book above holds 0.87 BTC on the best bid and 0.43 BTC on the best ask, and its second bid sits 1,166.59 USDC below the first.

Ticker, one frame with two changed pairs.

```json
["tk",1790139141,["XRP_USDC","1.6453","236114.566","388479.2954398","8.9025681758009002","1.6564","1.4946","1.6449","1.645"],["DOGE_USDC","0.10382","7372551.33457393","765418.2795554654126","2.8939544103072349","0.10435","0.09746","0.10379","0.10381"]]
```

Trade.

```json
["t",1790139142,427582820,"USDC_USDT","23723.9","1","sell"]
```

Errors.

```json
["error",1790139264,"Invalid topic: diff.NOPE_USDT","subscribe"]
```

```json
["error",1790139281,"Too many topics","subscribe"]
```

Keepalive is a WebSocket protocol ping with no text frame, so there is no JSON to show.

## 7. Private channels

Named for a future execution stage, from S5, not probed.
They use the same URL after an `["auth", "<JWT>"]` frame, where the JWT comes from `POST https://www.alp.com/api/v3/auth` with an API key and secret.

- Order updates, message type `o`.
- Account trade updates, message type `ta`.
- Balance updates, message type `w`, whose index 4 holds the isolated margin pair or null for spot.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only relevant if spot legs are ever wanted, because the venue has no perpetual.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://www.alp.com/ws` for every pair | one URL |
| channel | `market_depth.<rawMarketId>` | the only book channel that sends data, and `diff` sent nothing |
| markets per connection | 11, so two sockets for the 22 pairs | 20 topics per connection is a hard cap, and 11 leaves room for a trade or ticker topic |
| subscribe frames | one frame per slice, `["subscribe","market_depth.BTC_USDC", …]`, kept under 800 bytes | a frame over about 800 bytes is closed with 1009 |
| seed | one REST `orderbook` call per pair right after the acknowledgement | no snapshot on subscribe, and a quiet pair may send nothing for over a minute |
| keepalive | send nothing, and keep the `ws` default `autoPong` | the server pings with protocol frames, and a text `1` or `2` from the client drops the socket |
| `maxSilenceMs` | 45,000 | the server pings 20 s after its last frame, and the engine counts a ping as traffic at `server/src/feeds/book/VenueFeed.ts` line 97, so two missed pings is a dead socket |
| routing | `frame[0] === 'p'`, pair from `frame[2].Symbol` | the topic is not echoed in data frames |
| book | `resetBook` with all levels of every `p` frame, then `publish` | each frame is a whole book |
| resync | none beyond the engine's reconnect | there is no sequence to break |
| receive time | stamp on arrival, never from index 1 | integer seconds only |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The feed would still be a one second, 20 level snapshot that arrives about 0.6 s after its second, which is coarse next to the engine's other feeds.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ALP.COM API v3, Introduction | https://docs.alp.com/introduction | 2026-09-22 | ALP.COM, global | WebSocket URL, section 1 |
| S2 | ALP.COM API v3, WebSocket Overview & Connection | https://docs.alp.com/ws-overview | 2026-09-22 | ALP.COM, global | ping and pong, subscribe and error shapes, welcome frame, sections 3 and 5 |
| S3 | ALP.COM API v3, WebSocket Orderbook | https://docs.alp.com/ws-orderbook | 2026-09-22 | ALP.COM, global | `diff` and `market_depth` topics and fields, sections 2 to 4 |
| S4 | ALP.COM API v3, WebSocket Market Data | https://docs.alp.com/ws-market-data | 2026-09-22 | ALP.COM, global | `ticker.*` only, `trade` topics, sections 2 and 3 |
| S5 | ALP.COM API v3, WebSocket Private Channels and Authorization | https://docs.alp.com/ws-private-channels and https://docs.alp.com/authorization | 2026-09-22 | ALP.COM, global | private message types and JWT, section 7 |
| P1 | `ws-probe.mjs book`, two runs at 04:52 and 05:07 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 4 and 6 |
| P2 | `ws-probe.mjs errors` and `deflate`, two runs at 04:54 and 05:09 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 to 5 |
| P3 | `ws-probe.mjs limits` at 05:11 UTC, repeating scratch runs at 04:49 and 04:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | topic budget and frame size, sections 3 and 5 |
| P4 | `ws-probe.mjs silence`, 120 s at 04:55 UTC with `autoPong` on everywhere, 120 s at 04:58 UTC and 60 s at 05:09 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | keepalive and silence, section 5 |
