# DigiFinex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:16 to 03:39 UTC, and the second pass 03:47 to 03:53 UTC, from the development host near Seattle.

This profile covers the public swap WebSocket v2 of DigiFinex (CCXT id `digifinex`) for its USDT-margined and coin-margined perpetuals, with the depth channel in detail.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
CCXT Pro 4.5.68 has no `digifinex` class, so there is no second implementation to compare against.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-margined perpetuals | `wss://openapi.digifinex.com/swap_ws/v2/`, S1 | 101 upgrade, open in 632 to 696 ms, Cloudflare edge `SEA` or `YVR` in `cf-ray` |
| coin-margined perpetuals | the same URL | `BTCPERP` delivered on the socket that also carried `BTCUSDTPERP` |
| spot | a separate spot WebSocket API, S2 | not probed |

One socket carries both perpetual families.
`openapi.digifinex.com` resolved to 104.18.16.167 and 104.18.17.167, Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe frame | depth and speed | probed |
|---|---|---|---|
| `depth` | `{"id":1,"event":"depth.subscribe","instrument_ids":["BTCUSDTPERP"],"level":20}` | `level` 10, 20 or 100, no speed option, S1 | snapshot then deltas at all three levels, recommended |
| `ticker` | `ticker.subscribe` with `instrument_id` or `instrument_ids` | best bid, ask, sizes, last, 24 h stats | 766 and 807 frames over four contracts in 75 s in two runs |
| `all_ticker` | `{"id":4,"event":"all_ticker.subscribe"}` | every contract in one frame | 20 or 21 frames in 40 s, 172 rows, 55.6 KB inflated per frame |
| `trades` | `trades.subscribe` | cadence Not publicly specified | not probed |
| `cur_candle`, `mark_candle` | | | not probed |
| `index_price` | `index_price.subscribe` | cadence Not publicly specified | BTC 23, 49 and 28 pushes in 40 s over three runs, `XAUTUSDTPERP` 1, 2 and 1 |
| `mark_price` | `mark_price.subscribe` | cadence Not publicly specified | BTC 46, 89 and 40 pushes in 40 s, `MANAUSDTPERP` 2, 3 and 1 |
| `fund_rate` | `fund_rate.subscribe` | the live rate for the upcoming settlement | one push on subscribe, then one every 15.7 to 16.9 s, and once a gap of 33.6 s |
| `price_range` | `price_range.subscribe` | the order price band, `highest` and `lowest` | not probed |
| `estimated_settle_price` | | for dated contracts, the example names `BTC2-MOVE-20220909` | not probed, no dated contract is listed |
| `server.time`, `server.ping` | request and reply, not channels | | ping probed, section 5 |

The channel names, payloads and enums are from S1.
"One single instrument means one public channel, a single connection can not subscribe over 30 public channels.", S1.
So every per instrument channel above counts toward the same 30.
`all_ticker` pushes 61 rows that the instruments call does not list, among them the simulated `BTCUSDT2PERP` and `ETH2PERP` and the delisted `TORNUSDTPERP` and `UMAUSDTPERP`, so a consumer filters it by the catalog.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all perpetuals, S1 | linear and inverse on one socket, section 1 |
| subscribe frame shape | `{"event":"depth.subscribe","id":1,"instrument_ids":["BTCUSDTPERP","ETHUSDTPERP"],"level":10}`, `id` required, S1 | 30 instruments in one `instrument_ids` array got one ack and all 30 delivered. A request without `id` answers code 2 |
| unknown symbol expectation | error code 2 `ParamInvalid`, S1 | `{"event":"depth.subscribe","id":12,"code":2,"msg":"invalid param"}` for `NOPEUSDTPERP`, the delisted `TORNUSDTPERP`, the spot spelling `BTC_USDT`, and a missing instrument |
| chunk unit and budget | 30 public channels per connection, one instrument is one channel, S1 | enforced by closing the socket: 31 in one frame closed with 1006 and no reply about 180 ms after the open, and a 31st channel on a socket holding 30 closed it with 1006 about 150 ms after the send, with no reply |
| keepalive mechanism | `{"id":1,"event":"server.ping"}`, answer `"data":"pong"`, a timer under 60 s, S1 | pong in 149 to 178 ms over 12 pings in two runs. No server protocol ping on any socket, the longest open 100 s |
| connection lifetime and maintenance notice | "A single connection is only valid for 24 hours", S1. No maintenance channel | not reached, no notice seen |
| handshake and operation rate limits | Not publicly specified beyond the 30 channels | no refusal at 14 request frames sent 400 ms apart on one socket |
| public market data authentication | none | none |
| message parse and routing | every response is zlib deflated, S1. Pushes carry `event` `depth.update` and `data.instrument_id` | every frame is a binary message whose payload starts with the zlib header `78da`, and inflates to JSON. Route on `data.instrument_id` and `data.level` |
| subscribe acknowledgement shape | `{"event":"depth.subscribe","id":1,"code":1,"msg":"success"}`, S1 | identical, and one ack per request frame whatever the number of instruments |
| symbol identifier format | `BTCUSDTPERP` | identical to CCXT `market.id` and to the REST `instrument_id` on 109 of 109 CCXT swap markets |
| number representation | depth levels `[string price, number amount]`, S1 | as documented on the socket: `["86658.1",2284]`. The REST book sends both as JSON numbers, see [`rest.md`](./rest.md) section 5 |
| timestamp representation | `timestamp` in ms | integer ms, 81 to 190 ms before arrival after the clock offset, never backwards on any stream |
| size unit | amount, unit not stated | contracts of `contract_value` coins, which is CCXT `contractSize`, section 4 |
| sequence semantics | none documented | no sequence field and no checksum. A lost delta cannot be detected from the stream |
| idle repeat behaviour | not documented | 0 identical consecutive depth frames. A quiet book goes silent: `MANAUSDTPERP` for 18.3 and 15.5 s, and the quietest of 30 books for 30.3 and 32.1 s |

## 4. The depth channel in detail

`depth` at level 20 is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame of every stream is a full book with a top level `"full_data": true` beside `event` and `data`, and no later frame carries that key.
That held on the 8 book streams of each of two runs, at levels 10, 20 and 100, and on the extra stream of the first run's error socket, and the flag is not in the documentation.
The snapshot held exactly `level` bids and `level` asks on every stream with a deep enough book, and a thin book sent what it had: `MANAUSDTPERP` at level 100 sent 74 bids and 63 asks in one run, and 75 and 60 in the other.
All eight streams of the book run had delivered within 2 s of the subscribe in both runs, and the acks arrived 816 to 886 ms after the sockets were created.

### Delta semantics

Every later frame carries only the levels that changed, as `[price, amount]` pairs, and an amount of `0` deletes the level.
A frame may carry an empty side, `"asks":[]`, and no frame in the runs was empty on both sides.
The server keeps the window at `level` per side: a book maintained from the snapshot and every delta never held more than 20, 10 or 100 levels over 75 s, so a level leaving the window arrives as a `0`.
In the first batch run, which the 31st channel ended after 3.8 s, one book briefly held 21 levels on one side, and in the two full batch runs none did, so a feed trims to the engine's depth anyway.
At the end of each run, the maintained book was compared with a REST read taken right after it.
It matched on 40 of 40 prices and sizes on every level 20 book, except `ETHUSDTPERP` in the second run at 38 of 40 sizes.
It matched on 200 of 200 on `BTCUSDTPERP` at level 100 in both runs, and on 136 of 137 and 140 of 140 sizes on the thin `MANAUSDTPERP` at level 100.
Every miss is a size or price that moved between the two reads.
No maintained book crossed after any frame: 0 in 2,101 and 2,245 depth frames in the two book runs, and 0 in the 4,612 and 4,528 frames of the two full batch runs.

### Sequence and gap rule

```text
full_data = true       replace the book
full_data absent       apply each level by price, amount 0 deletes
                       no sequence, no checksum: a gap is invisible
```

Nothing in a frame lets a feed detect a lost delta.
TCP keeps order within a socket, so a loss would come from the venue, and the checks available are a crossed book after a frame, and a comparison with the REST book.
The ticker channel's best bid and ask equalled the maintained book's at the moment the ticker frame arrived on 684 of 766 frames and 698 of 807, and the rest differed by one move, because the two channels are pushed separately.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every stream | best first, ascending, on every stream |
| delta | ascending by price, on 394 of 394 deltas with more than one bid on one socket in the first run, and 1,063 of 1,063 on two sockets in the second | ascending by price |
| REST `depth` | descending | ascending |

A feed applies deltas by price and never by position, and a delta's bids arrive worst first.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | `contract_value` | a socket size | coins |
|---|---:|---|---|---|
| `BTCUSDTPERP` | 0.001 | `0.001 BTC` | `124` | 0.124 BTC |
| `ETHUSDTPERP` | 0.01 | `0.01 ETH` | `6334` at 2764.68 | 63.34 ETH |
| `PEPEUSDTPERP` | 10,000,000 | `10000000 PEPE` | not captured | |
| `BTCPERP`, inverse | 1 | `1 USD` | `69966` at 86635.8 | 69,966 USD, not BTC |

The unit is contracts, and one contract of a linear perpetual is `contract_value` coins, which is exactly CCXT's `contractSize` on 109 of 109 swap markets, see [`rest.md`](./rest.md) section 2.
The socket sizes equalled the REST book sizes, which are in the same unit, on 40 of 40 levels.
The eight inverse contracts carry 1 USD per contract and CCXT reports `contractSize` 1, so the engine would read 69,966 contracts as 69,966 BTC.
Those contracts have to be kept out by a `marketFilter` on `linear`, see section 8.

### One-sided and empty books

No one-sided or empty book was seen.
`MANAUSDTPERP` at level 100 was shallower than the window, 74 and 63 levels, and the engine's `resetBook` accepts a short side.

### Idle repeats

Nothing is repeated.
0 identical consecutive frames on any stream.
A quiet book simply goes silent: `MANAUSDTPERP` sent 10 and 21 frames in 75 s in two runs, with longest gaps of 18.3 and 15.5 s.
In the 30 contract batch, `GOOGLUSDTPERP` sent 22 frames in 60 s and `QQQUSDTPERP` 10 in the rerun, and the longest gap on any of the 30 books was 30.3 and 32.1 s.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `depth.subscribe` `NOPEUSDTPERP` level 20 | code 2 `invalid param` | nothing |
| `depth.subscribe` `BTCUSDTPERP` level 30, and level 50 in the second run | code 2 `invalid param` | nothing |
| `depth.subscribe` `TORNUSDTPERP`, delisted and still in `all_ticker` | code 2 `invalid param` | nothing |
| `depth.subscribe` `BTCUSDT2PERP`, simulated | code 1 `success` | depth frames arrive, so a simulated contract is served on the same socket |
| `depth.subscribe` `BTC_USDT` level 20 | code 2 `invalid param` | nothing |
| `depth.subscribe` with no instrument | code 2 `invalid param` | |
| `depth.subscribe` `BTCUSDTPERP` level 20 twice | the second answers code 5 `repeat subscribe` | the first keeps delivering |
| `ticker.subscribe` `NOPEUSDTPERP` | code 2 `invalid param` | |
| unknown event `nope.subscribe` | code 2 `invalid param` | |
| `depth.unsubscribe` of a stream never subscribed | code 7 `unsubscribe fail` | |
| `server.time` without `id` | code 2 `invalid param` | |
| text that is not JSON | `{"event":"","code":2,"msg":"invalid param"}` | the socket stays open |

Unlike Gate, the channel refuses a symbol it will not serve, so a feed can log the refusal by its `id`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `server.ping` with an `id`, answered `"data":"pong"`, "you should set a timer less than 60 second and send a ping", S1 | pong in 149 to 178 ms over 12 pings. No server protocol ping in 100 s |
| silence the server tolerates | "The connection will break automatically if the subscription is not established or data has not been pushed for more than 60 seconds", S1 | the server times the client, not the pushes. A socket that sent nothing closed at 60.6 and 60.7 s in two runs, and a socket subscribed to `SATSUSDTPERP` that received 183 and 202 depth frames but sent nothing after its subscribe closed at 60.8 s both times, all with 1006 and no close frame. A socket that pinged every 20 s stayed open for the full 100 s, subscribed or not |
| forced disconnect | 24 h per connection, S1 | not reached |
| maintenance notice | none documented | none seen |
| compression | "All response use zlib deflate to compress data.", S1 | every frame binary and zlib wrapped, header `78da`. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, and the frames were still zlib inside |
| handshake | | 632 to 696 ms to open from this host |
| subscription limits | 30 public channels per connection | the 31st closes the socket, section 3 |
| throughput, 30 busiest contracts at level 20 | | two runs: 76 and 74 frames per second median, 121 and 122 peak, 12.0 and 11.5 KB per second on the wire median, 19.2 and 21.2 KB peak, 160 and 158 bytes per frame compressed and 205 and 201 inflated |
| decode cost on this host | | `zlib.inflateSync` median 38 and 47 µs and p90 75 and 115 µs per frame in the two batch runs, then `JSON.parse` median 11 and 13 µs, so the inflate costs three to four times the parse |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC, each inflated from its zlib payload.
Arrays marked as trimmed keep their first levels only.

Subscribe, several instruments in one frame.

```json
{"id": 1, "event": "depth.subscribe", "instrument_ids": ["BTCUSDTPERP", "ETHUSDTPERP", "XAUTUSDTPERP", "MANAUSDTPERP"], "level": 20}
```

Acknowledgement.

```json
{"event":"depth.subscribe","id":1,"code":1,"msg":"success"}
```

Snapshot, trimmed to three levels per side, with the undocumented `full_data` flag.

```json
{"event":"depth.update","data":{"instrument_id":"BTCUSDTPERP","level":20,"timestamp":1790133997263,"asks":[["86658.1",2284],["86658.2",13405],["86658.3",10255]],"bids":[["86658.0",124],["86657.9",10971],["86657.8",15210]]},"full_data":true}
```

Snapshot of the inverse contract, trimmed to two levels per side, sizes in 1 USD contracts.

```json
{"event":"depth.update","data":{"instrument_id":"BTCPERP","level":20,"timestamp":1790133997239,"asks":[["86635.9",24589],["86653.3",20]],"bids":[["86635.8",69966],["86616.7",10935]]},"full_data":true}
```

Deltas: one with both sides, and one with an empty ask side and bids in ascending order.

```json
{"event":"depth.update","data":{"instrument_id":"BTCUSDTPERP","level":20,"timestamp":1790134073578,"asks":[["86625.4",0],["86671.3",4177]],"bids":[["86555.2",0],["86625.4",140]]}}
```

```json
{"event":"depth.update","data":{"instrument_id":"ETHUSDTPERP","level":20,"timestamp":1790133997324,"asks":[],"bids":[["2764.68",6334],["2764.93",7354],["2768.38",0],["2768.39",0]]}}
```

Keepalive.

```json
{"id": 7, "event": "server.ping"}
```

```json
{"event":"server.ping","id":7,"code":1,"msg":"success","data":"pong"}
```

Errors.

```json
{"event":"depth.subscribe","id":12,"code":2,"msg":"invalid param"}
```

```json
{"event":"depth.subscribe","id":15,"code":5,"msg":"repeat subscribe"}
```

```json
{"event":"depth.unsubscribe","id":20,"code":7,"msg":"unsubscribe fail"}
```

Index, mark and funding pushes.

```json
{"event":"index_price.update","data":{"instrument_id":"BTCUSDTPERP","index_price":"86777.2","timestamp":1790134702360}}
```

```json
{"event":"mark_price.update","data":{"instrument_id":"BTCUSDTPERP","mark_price":"86737.4","timestamp":1790134702361}}
```

```json
{"event":"fund_rate.update","data":{"instrument_id":"BTCUSDTPERP","funding_rate":"-0.00003","funding_time":1790150400000,"next_funding_rate":"-3e-05","next_funding_time":1790179200000}}
```

Ticker.

```json
{"event":"ticker.update","data":{"instrument_id":"BTCUSDTPERP","best_bid":"86658.0","best_bid_size":"124.000000","best_ask":"86658.1","best_ask_size":"2269.000000","high_24h":"86814.0","open_24h":"85514.4","low_24h":"85080.1","last":"86658.1","last_qty":"47.000000","volume_24h":"127958869","volume_token_24h":"127958.869","open_interest":"-","timestamp":1790133997205}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after `{"event":"server.auth","id":1,"apikey":…,"timestamp":…,"signature":…}`, where the signature is a base64 HMAC-SHA256 of the timestamp.

- `account.subscribe`, `position.subscribe`, `order.subscribe`.
- The page index also names `OrderAlgo` and `Token`, with no section of their own on 2026-09-22.
- CCXT has no WebSocket implementation for DigiFinex to reuse.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan on `wss://openapi.digifinex.com/swap_ws/v2/` for the 103 USDT-margined contracts | both families share the URL, and the inverse ones are filtered out of the catalog |
| catalog filter | `marketFilter` keeping `linear === true`, and a pick among the three ETH contracts, see [`rest.md`](./rest.md) section 2 | inverse sizes are USD, and CCXT keeps only `OETHUSDTPERP` for `ETH/USDT:USDT` |
| channel | `depth` at level 20 | snapshot on subscribe, the window is kept by the venue, and 20 matches the engine's `depthLevels` |
| markets per connection | 25, never above 30 | the 31st channel closes the socket with every book on it, and 25 keeps room for one extra channel added by mistake. 103 contracts need 5 sockets at 25 |
| subscribe frames | one frame per slice: `{"id": <n>, "event": "depth.subscribe", "instrument_ids": [...], "level": 20}` | a 30 instrument array was acked as one and all delivered |
| decode | `zlib.inflateSync(raw)` in `handleMessage`, then `JSON.parse` | every frame is zlib inside a binary message, and `handleMessage` already receives a `Buffer` at `server/src/feeds/book/VenueFeed.ts` lines 209 and 390 to 393 |
| keepalive | `{"id": <n>, "event": "server.ping"}` every 20 s | the server closes a socket whose client sent nothing for 60 s, even while it pushes |
| `maxSilenceMs` | 60,000 | a quiet book went 32.1 s without a frame, and the pong every 20 s is the traffic the watch relies on |
| routing | `data.instrument_id` is the `rawMarketId` | identical to CCXT `market.id` |
| snapshot | `full_data === true`: `resetBook` | the flag marks the first frame and only the first frame |
| delta | apply each level by price, amount 0 deletes, then `publish` | a delta's bids arrive ascending, worst first, so position means nothing |
| resync | a delta before a snapshot, or a crossed book after a frame: `resync` | no sequence exists, so these are the only observable faults, and 0 crossed books were seen in about 13,500 depth frames over four runs |
| refusals | log any reply with `code` other than 1, keyed by `id` | the venue answers code 2 for an unknown symbol and code 5 for a repeat |
| receive time | stamp on arrival | the frame `timestamp` ran 81 to 190 ms behind arrival |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it, and the zlib inside the frame is not optional |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | DigiFinex swap WebSocket API v2 | https://docs.digifinex.com/en-ww/swap/v2/websocket.html | 2026-09-22 | DigiFinex, global | URL, 24 h lifetime, 60 s rule, 30 channel cap, zlib, error codes, channel names and pushes, private channels, sections 1 to 7 |
| S2 | DigiFinex API documentation index | https://docs.digifinex.com | 2026-09-22 | DigiFinex, global | separate spot and swap APIs, section 1 |
| S3 | CCXT 4.5.68 `digifinex.js` | `server/node_modules/ccxt/js/src/digifinex.js` | 2026-09-22 | CCXT | `contractSize` from `contract_value` at line 710, section 4 |
| P1 | `ws-probe.mjs book` at 03:26 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs) | 2026-09-23 UTC | this host | snapshot, deltas, order, window, REST compare, ticker compare, errors, pong, sections 3 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:28, 03:29 and 03:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs) | 2026-09-23 UTC | this host | 30 channel cap, throughput, decode cost, quiet gaps, sections 3 to 5 |
| P3 | `ws-probe.mjs silence` at 03:30 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs) | 2026-09-23 UTC | this host | client silence close, section 5 |
| P4 | `ws-probe.mjs anchor`, runs at 03:32, 03:37, 03:38 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs) | 2026-09-23 UTC | this host | index, mark, fund_rate and all_ticker pushes, section 2 |
| P5 | `ws-probe.mjs deflate` at 03:26 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digifinex/ws-probe.mjs) | 2026-09-23 UTC | this host | no permessage-deflate negotiation, section 5 |
