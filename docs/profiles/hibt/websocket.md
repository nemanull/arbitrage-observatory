# HIBT WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:15 to 20:51 PDT (2026-09-23 03:15 to 03:51 UTC), from the development host near Seattle.

This profile covers the public contract WebSocket of HIBT, which serves the USDT-M perpetuals, the venue's only perpetual family.
CCXT has no HIBT class, so there is no CCXT Pro reference either, see [`fees.md`](./fees.md) section 8.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://fapi.hibt0.com/v2/ws`, S1 | HTTP 101 through Cloudflare, open in 391 to 616 ms, 82 of 82 contracts deliver |
| spot | none documented, S1 | not probed |

One URL carries every contract.
The socket host is the REST host, which resolves to Cloudflare addresses, see [`rest.md`](./rest.md) section 1.
No refusal was seen from this host, and no header or frame named a region.

## 2. Channel matrix for public market data

| topic | payload | depth and speed | probed |
|---|---|---|---|
| `<symbol>.5deep`, `.10deep`, `.20deep` | `{"event":"sub","topic":"btc_usdt.20deep"}` | 5, 10 or 20 levels, cadence not documented | a whole book every 200 ms on `btc_usdt` and `eth_usdt`, every 500 ms on quieter contracts, recommended at 20 |
| `<symbol>.ticker` | `{"event":"sub","topic":"btc_usdt.ticker"}` | on trade | 158 and 177 frames in 45 s on BTC, gaps 75 ms to 2.0 s |
| `<symbol>.index` | `{"event":"sub","topic":"btc_usdt.index"}` | not documented | one frame a second, 46 or 47 in 45 s, and the price equals the REST `index_price` and the REST mark |
| `<symbol>.trade` | `{"event":"sub","topic":"btc_usdt.trade"}` | on trade | 158 and 177 frames in 45 s on BTC, the same instants as the ticker |
| `<symbol>.candle.<period>` | periods `M1` to `W1` | | not probed |

The topic names, payloads and supported depths are from S1.
No mark, funding or best bid and offer topic is documented, and the `.index` topic is the only anchor number on the socket.
The REST poll remains the source for funding and the next settlement, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL served crypto, commodity and equity contracts alike |
| subscribe frame shape | `{"event":"sub", "topic":"Topic Content"}`, one topic per frame, S1 | several topics joined by commas in one `topic` string were acked as one and each delivered. A JSON array in `topic` answered `"data":"error topic"` |
| unknown symbol expectation | Not publicly specified | `nope_usdt.20deep`, `BTC_USDT.20deep` and the non-trading `sse_usdt.20deep` are acked `"status":"ok"` and then send nothing |
| chunk unit and budget | Not publicly specified | 82 topics in 82 frames on one socket, all acked, every contract delivered |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping every 54 s, and the `ws` library's automatic pong kept every socket open for 120 s. `{"event":"ping"}` and the text `ping` get no reply |
| connection lifetime and maintenance notice | maintenance is announced in the help center, 22:00 UTC, S16 | no socket closed in 120 s, including one with no subscription, and no in-band notice exists |
| handshake and operation rate limits | Not publicly specified | no refusal at 82 subscribe frames in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | `{"type": "<topic>", "ts": <ms>, "data": {...}}`, S1 | route on `type`, which is the full topic string. Acks are `type` `sub` and `unsub`, and the first frame is `type` `hello` |
| subscribe acknowledgement shape | not documented | `{"type":"sub","ts":…,"data":{"topic":"btc_usdt.20deep","status":"ok"}}`, 185 and 197 ms after the frame was sent |
| symbol identifier format | lowercase `btc_usdt`, S1 | lowercase, identical to the REST `ticker_id` and `symbol`, and six commodity ids carry no underscore: `gold`, `crude`, `silver`, `lco`, `platinumu`, `chiwheat` |
| number representation | strings, S1 | strings in flat `[price, size, price, size, …]` arrays, and small numbers in exponent form: `shib_usdt` sent `"6.178e-06"` and `"1.3929399588e+10"`, and exponent form appeared in every `shib_usdt` frame of both runs, 93 and 92 |
| timestamp representation | `ts` in ms | envelope `ts` in ms, 88 to 207 ms before arrival, with the server clock -2 to 87 ms from this host, see [`rest.md`](./rest.md) section 7. The index frame adds `data.time` in ms |
| size unit | "Trade Volume (BTC)" on trades, S1 | base asset units, for example 0.722 BTC, section 4 |
| sequence semantics | none documented | no sequence field exists. Every book frame is a whole book |
| idle repeat behaviour | not documented | 73 to 80 of 232 or 233 book frames on BTC and ETH repeated the previous frame exactly in two runs. `crude` kept the same best bid and ask prices on every frame, and only its sizes changed |

## 4. The book channel in detail

`<symbol>.20deep` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

Every frame is a whole book of up to 20 bids and 20 asks.
The first one arrived 195 to 675 ms after the subscribe frame, and the stream repeats at a fixed cadence.

| contract | frames in 45 s | gap between frames | levels per side |
|---|---:|---|---|
| `btc_usdt`, `eth_usdt` | 232 and 233 | median 200 ms, 120 to 317 ms | 20 and 20 on every frame |
| `shib_usdt`, `unitree_usdt` | 92 and 93 | median 500 ms | 20 and 20 |
| `gold`, `crude` | 92 and 93 | median 500 ms | 1 and 1 |

On one socket with all 82 contracts, the frames per contract in 30 s ranged from 37 to 150, median 60, so the cadence is between 200 ms and about 800 ms per contract, P5.
`btc_usdt.5deep` and `.10deep` arrived at the same instants as `.20deep` and held 5 and 10 levels.

### Delta semantics

There are no deltas.
A feed resets the whole book on every frame.

### Sequence and gap rule

No sequence, update id or checksum exists on any book frame.
A lost frame costs nothing, because the next frame is a whole book 200 to 800 ms later.
A frozen book cannot be told from a quiet one by the frame alone, see the idle repeats below.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket, every contract probed | best first, descending, on 100 % of frames | best first, ascending, on 100 % of frames |
| REST `/v2/market/depth` | descending | ascending |

No frame was crossed.

### Level window

The server holds each side at the topic's depth.
`btc_usdt.20deep` carried exactly 20 levels per side on every frame, and the REST book at `limit=100` or `200` returned 50, see [`rest.md`](./rest.md) section 5.
The documented depths are 5, 10 and 20, and `50deep` or `15deep` are acked and silent, see the last table of this section.

### Size unit

Sizes are base asset units, not contracts.
The documentation writes the trade size as "Trade Volume (BTC)", S1, the fee example in S3 of [`fees.md`](./fees.md) sizes an order as "0.1 BTC", and the catalog's minimum order for `btc_usdt` is `0.008` with 3 decimals, see [`rest.md`](./rest.md) section 2.
The socket book and the REST book agree: 18 to 20 of the top 20 BTC bid levels were identical in price and size in each of eight compares over two runs, taken 3 to 209 ms after the last socket frame, P1.
A catalog built outside CCXT therefore sets `contractSize` to 1.

### One-sided and empty books

No one-sided or empty book was seen, neither on the six contracts the book mode watched nor in the bulk REST book of all 82, see [`rest.md`](./rest.md) section 5.
Six commodity contracts show a single level per side: `gold`, `crude`, `silver`, `lco`, `platinumu` and `chiwheat`, see [`rest.md`](./rest.md) section 5.
Their frames add `allAskAmount` and `allBidAmount`, which the book frames of the crypto contracts do not carry.

### Idle repeats

A busy book is resent unchanged when nothing moved: 73 and 74 `btc_usdt` frames and 80 and 79 `eth_usdt` frames, of 232 or 233 in each of two runs, were exact repeats of the previous frame, P1.
`crude` kept its best bid at 7,583.6 and its best ask at 7,585.2 on every frame of both runs, while its sizes, `allAskAmount` and `allBidAmount` changed on every frame, and its REST `last_price` is `0`.
`gold` moved its prices, with 26 distinct best bid and ask pairs in 93 frames.
A feed that publishes on every frame republishes the same book up to five times a second.

### Freshness against other venues

The book trails the market it follows.
In the busier of two 40 s runs beside Binance, the HIBT book mid matched Binance spot best when shifted 1 s on BTC and 1.3 s on ETH, while the HIBT index kept pace, P6 and [`rest.md`](./rest.md) section 4.
A feed stamps HIBT books on arrival, so this second is invisible to it.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `nope_usdt.20deep` | `{"type":"sub",…,"data":{"topic":"nope_usdt.20deep","status":"ok"}}` | nothing in 4 s |
| `BTC_USDT.20deep` | ok | nothing in 4 s |
| `sse_usdt.20deep`, listed with `supportTrade` false | ok | nothing in 4 s |
| `btc_usdt.50deep`, `btc_usdt.15deep` | ok | nothing in 4 s |
| `eth_usdt.20deep` a second time | ok | one stream, still 5 frames a second |
| `{"event":"unsub","topic":"eth_usdt.20deep"}` | `{"type":"unsub",…,"data":{"topic":"eth_usdt.20deep","status":"ok"}}` | one more frame, then silence |
| `{"event":"subscribe",…}` | nothing | the socket stays open |
| `{"event":"sub","topic":[…]}` | `{"type":"sub",…,"data":"error topic"}` | |
| `{"op":"ping"}`, a JSON object with no `event` | nothing | the server drops the socket with 1006 and no close frame, 183 and 185 ms later |
| the text `ping` | nothing | the socket stays open |

Because every wrong topic is acked `ok`, a feed has to notice a topic with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | a protocol ping from the server at 54.4 s and 108.4 s after open, on each of the five sockets of the second run, and two per socket in the first. The `ws` library answers it automatically, and a client protocol ping every 10 s got a pong each time, 11 of 11 |
| silence the server tolerates | Not publicly specified | five sockets held 120 s: one with no subscription and no client frame, two subscribed with a silent client, one sending protocol pings and one sending `{"event":"ping"}`. None closed |
| forced disconnect | Not publicly specified | none in 120 s. A JSON frame without `event` drops the socket at once |
| maintenance notice | help center notices, the latest a 15 minute futures maintenance at 22:00 UTC on 2026-09-22, S16, and 16 dated 2026, see [`fees.md`](./fees.md) section 7 | no in-band notice exists |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 391 to 616 ms to open from this host over all runs |
| subscription limits | Not publicly specified | 82 contracts on one socket were accepted |
| throughput | | all 82 contracts at `20deep`: median 204 frames a second, 165 KB a second, 815 bytes a frame, 37 and 41 µs `JSON.parse` a frame in two runs, P5 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22.
Arrays marked `…` are cut.

Greeting, sent on open before any subscription.

```json
{"data":"success","ts":1790133935518,"type":"hello"}
```

Subscribe and acknowledgement.

```json
{"event":"sub","topic":"btc_usdt.20deep"}
```

```json
{"type":"sub","ts":1790133935705,"data":{"topic":"btc_usdt.20deep","status":"ok"}}
```

Book, `btc_usdt.5deep` in full.

```json
{"type":"btc_usdt.5deep","ts":1790133935716,"data":{"symbol":"btc_usdt","asks":["86711","0.722","86711.2","0.406","86711.4","0.193","86711.5","0.153","86711.7","0.475"],"bids":["86710.8","0.441","86710.5","0.381","86710.2","0.472","86709.9","0.151","86709.7","0.321"]}}
```

Book of a commodity contract, one level per side and two totals.

```json
{"type":"crude.20deep","ts":1790133935963,"data":{"symbol":"crude","asks":["7585.2","4.765"],"bids":["7583.6","3.512"],"allAskAmount":"3208.541","allBidAmount":"8020.744"}}
```

Book with exponent notation, first two levels per side kept.

```json
{"type":"shib_usdt.20deep","ts":1790133935957,"data":{"symbol":"shib_usdt","asks":["6.178e-06","1.3929399588e+10","6.179e-06","2.480734077e+09"],"bids":["6.176e-06","7.676950204e+09","6.174e-06","3.988867834e+09"]}}
```

Index, ticker and trade.

```json
{"type":"btc_usdt.index","ts":1790133936005,"data":{"symbol":"btc_usdt","price":"86708.979","time":1790133936001}}
```

```json
{"type":"btc_usdt.ticker","ts":1790133935941,"data":{"symbol":"btc_usdt","amount":"33697.769","volume":"2898605410.9002","open":"85606.6","close":"86710.9","high":"86827.6","low":"85102.9","lastPrice":"86710.9","lastAmount":"0.122","lastTime":1790133935931,"change":"1.28"}}
```

```json
{"type":"btc_usdt.trade","ts":1790133935941,"data":["86710.9","2","0.122","1790133935931"]}
```

Unsubscribe and an error.

```json
{"type":"unsub","ts":1790134113549,"data":{"topic":"eth_usdt.20deep","status":"ok"}}
```

```json
{"type":"sub","ts":1790134116959,"data":"error topic"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after `{"event":"auth","accessKey":…,"timestamp":…,"signature":…}`.

- `user.entrust` for conditional order triggers, and the position, order execution and account balance topics documented beside it.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fapi.hibt0.com/v2/ws` | one URL serves every contract |
| channel | `<rawMarketId>.20deep` | a whole 20 level book on every frame covers the engine's 20 levels |
| markets per connection | 82, all on one socket | 82 ran with every contract delivering at 204 frames a second, and no cap is published |
| subscribe frames | one frame per slice, `{"event":"sub","topic":"btc_usdt.20deep,eth_usdt.20deep,…"}`, or one frame per topic | comma-joined topics were acked as one and each delivered, and single topics are the documented form |
| keepalive | none needed beyond answering protocol pings, which `ws` does. A client protocol ping every 15 s adds a pong the silence watch can count | no socket closed in 120 s without one |
| never send | a JSON frame without an `event` key | it drops the socket |
| `maxSilenceMs` | 10,000 | the slowest contract still sends a whole book about every 800 ms, so 10 s of silence on a socket is a dead socket |
| routing | `type.slice(0, type.lastIndexOf('.'))` gives the `rawMarketId` | the topic wraps the contract id |
| book | `resetBook` on every frame, then `publish` only when the frame differs from the last one | whole books, and about a third of busy frames are exact repeats |
| resync | not needed for gaps. A topic with no frame 5 s after its ack is logged | there is no sequence to break, and wrong topics are acked `ok` |
| receive time | stamp on arrival, never from `ts` | a repeated frame carries a new `ts` |
| numbers | `Number()` of each string, which parses the exponent form | `shib_usdt` prices and sizes arrive in exponent form on the socket and in the REST catalog |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| skip | `gold`, `crude`, `silver`, `lco`, `platinumu`, `chiwheat` | one-level books, zero open interest and zero 24 h volume, see [`rest.md`](./rest.md) section 2 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hibt OpenApi Doc, Perpetual Contract Trading, section "Contract WebSocket API" | https://apidoc.hibt.co/hibt-openapi-en/perpetual-contract-trading, full text at https://apidoc.hibt.co/hibt-openapi-en/llms-full.txt | 2026-09-22 | HIBT | URL, topics, depths, auth frame, private topics, sections 1 to 4, 7 |
| S16 | Hibt Futures Trading Service Upgrade and Maintenance Notice (2026-09-22 22:00 UTC) | https://support.hibt.com/hc/en-us/articles/17712567390479 | 2026-09-22 | HIBT | maintenance, sections 3 and 5 |
| P1 | `ws-probe.mjs book`, runs at 03:25 and 03:43 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 4, 6 |
| P2 | `ws-probe.mjs errors`, runs at 03:27 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4, 6 |
| P3 | `ws-probe.mjs session`, runs at 03:28 and 03:45 UTC, the second with ping times | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 5 |
| P4 | `ws-probe.mjs deflate`, runs at 03:31 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P5 | `ws-probe.mjs batch`, runs at 03:31 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host | sections 4, 5, 8 |
| P6 | `ws-probe.mjs mirror`, runs at 03:26 and 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host, Binance public streams | [`rest.md`](./rest.md) section 4 |
