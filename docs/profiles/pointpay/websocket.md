# PointPay WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:27 to 03:43 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public WebSocket that PointPay's futures terminal uses for its USDT perpetuals, with the book channel in detail.
PointPay documents no futures WebSocket.
The terminal reads its host from `FUTURES_WS_HOST` in the public `https://back.pointpay.io/systemParams` reply, `wss://ws-futures.pointpay.io`, appends `/v5/public/linear`, and falls back to `wss://stream.bybit.com/v5/public/linear` when that fails, S2.
The probe [`ws-probe.mjs`](../../../scripts/probes/venues/pointpay/ws-probe.mjs) opened that socket beside Bybit's own and found it to be a relay of Bybit's public linear stream: the same protocol, the same errors, the same update ids, and in the first run the same frame and byte counts, about 70 to 80 ms later.
The documented WebSocket is the spot one, and it is named here only for the coverage matrix.

## 1. Endpoints

| family | URL | source | probed |
|---|---|---|---|
| USDT-M perpetuals | `wss://ws-futures.pointpay.io/v5/public/linear` | S2, not in the API documentation | open in 988 to 1,046 ms, against 533 to 561 ms for Bybit's own URL, P1 to P4 |
| fallback in the terminal | `wss://stream.bybit.com/v5/public/linear` | S2 | Bybit's own socket, used here as the reference |
| spot | `wss://exchange.pointpay.io/ws` in S1, `wss://ws.pointpay.io/` in the web bundle, `wss://ws.pointech.cloud/` in `systemParams` `WS_URL` | S1, S2 | all three open in 485 to 818 ms and answer `server.ping`, `server.time` and `depth.subscribe`, P5 |

`ws-futures.pointpay.io` resolves to the Cloudflare addresses `104.20.40.21` and `172.66.171.190`, the same pair as every other PointPay host, see [`rest.md`](./rest.md) section 1.
The handshake came back with `server: cloudflare` and a `cf-ray` ending in `YVR` or `SEA`.
The socket carries only USDT perpetuals, because PointPay lists no other family.
It also serves Bybit linear topics PointPay does not list: `orderbook.50.1000PEPEUSDT` was acknowledged and delivered 319 and 425 frames in two runs, section 4.

## 2. Channel matrix for public market data

The topic names are Bybit v5's, and every row below was probed on the PointPay URL.

| channel | topic | depth and speed | probed |
|---|---|---|---|
| order book | `orderbook.50.<symbol>` | 50 levels | one snapshot then deltas on four perpetuals, recommended, section 4 |
| order book | `orderbook.200.<symbol>` | 200 levels | one snapshot then deltas on `BTCUSDT`, 618 and 599 frames in 60 s |
| order book | `orderbook.1.<symbol>` | best bid and ask | a snapshot on every frame, 581 and 1,002 frames in 60 s on `BTCUSDT` |
| order book | `orderbook.30.<symbol>` | not offered | `error:handler not found` |
| ticker | `tickers.<symbol>` | snapshot then deltas | 373 and 444 frames in 60 s on `BTCUSDT`, carrying `markPrice`, `indexPrice`, `fundingRate`, `nextFundingTime`, `fundingIntervalHour` and `fundingCap` |
| trades and klines | the terminal builds them from topic constants named `PublicTrade` and `Kline`, S2 | | not probed |

The ticker channel carries every `AnchorRow` field, and on this socket it reports Bybit's full volume and open interest, not the one hundredth that PointPay's REST replies show, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
PointPay documents nothing about this socket, so the documented column names what the web terminal does, S2, or says Not publicly specified.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one path for linear, `/v5/public/linear`, S2 | only the linear path was probed |
| subscribe frame shape | the terminal sends Bybit's `{"op": "subscribe", "args": [...]}`, S2 | `{"req_id": "…", "op": "subscribe", "args": ["orderbook.50.BTCUSDT", …]}` with seven topics in one frame got one ack covering all seven |
| unknown symbol expectation | Not publicly specified | `{"success":false,"ret_msg":"error:handler not found,topic:orderbook.50.NOPEUSDT",…}` |
| chunk unit and budget | Not publicly specified | 172 topics sent as 18 frames of up to 10 got 18 acks and 172 snapshots in 1,147 and 1,153 ms |
| keepalive mechanism | the terminal sends `{"op":"ping"}` every 20 s, S2 | `{"success":true,"ret_msg":"pong",…,"op":"ping"}` in 318 to 322 ms, against 169 and 170 ms on Bybit's URL. No server protocol ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | no close in 120 s on a subscribed socket, and no notice frame |
| handshake and operation rate limits | Not publicly specified | no refusal at 18 subscribe frames sent at once |
| public market data authentication | none, S2 | none |
| message parse and routing | Bybit v5 envelope `{topic, type, ts, data, cts}` | route on `topic`, spelled `orderbook.<depth>.<symbol>` |
| subscribe acknowledgement shape | Not publicly specified | `{"success":true,"ret_msg":"","conn_id":"…","req_id":"…","op":"subscribe"}` |
| symbol identifier format | `BTCUSDT` | identical to the `pair` field of the REST pairs list, to Bybit's symbol, and to CCXT `bybit` `market.id`. Case sensitive: `btcusdt` is refused |
| number representation | Not publicly specified | price and size as decimal strings |
| timestamp representation | Not publicly specified | `ts` and `cts` in Unix ms, Bybit's values |
| size unit | Not publicly specified | base coin, as on Bybit linear, section 4 |
| sequence semantics | Not publicly specified | `data.u` rises by exactly one per delta. 0 gaps in 5,042 and 5,495 deltas over 60 s on five book topics, and 0 in 43,168 and 50,406 deltas over 30 s on 172 topics |
| idle repeat behaviour | Not publicly specified | no frame repeated an update id in the 60 s of the second run. A quiet book went 3.3 to 5.1 s without a frame |

## 4. The book channel in detail

`orderbook.50.<symbol>` is the channel this profile would recommend, and every row below is about it unless it says otherwise.

### It is Bybit's stream

The probe subscribed the same seven topics on the PointPay URL and on Bybit's URL at the same time, for 60 s, twice, P1 and P3.

| topic | frames on PointPay | frames on Bybit | PointPay update ids never seen on Bybit | PointPay arrival minus Bybit arrival, median and p90 |
|---|---|---|---|---|
| `orderbook.50.BTCUSDT` | 1,841 and 1,873 | 1,841 and 1,877 | 0 and 0 | 69 and 70 ms, then 81 and 82 ms |
| `orderbook.50.ETHUSDT` | 1,818 and 2,132 | 1,818 and 2,155 | 0 and 0 | 69 and 70 ms, then 81 and 82 ms |
| `orderbook.50.ALGOUSDT` | 696 and 821 | 696 and 822 | 0 and 0 | 69 and 71 ms, then 80 and 82 ms |
| `orderbook.50.AAPLUSDT` | 74 and 75 | 74 and 75 | 0 and 0 | 69 and 70 ms, then 80 and 82 ms |
| `orderbook.200.BTCUSDT` | 618 and 599 | 618 and 600 | 0 and 0 | 69 and 71 ms, then 80 and 82 ms |
| `orderbook.1.BTCUSDT` | 581 and 1,002 | 581 and 1,007 | 0 and 0 | 69 and 70 ms, then 80 and 82 ms |

In the first run the byte count of every topic was equal on both sockets, for example 457,211 bytes of `orderbook.50.BTCUSDT` on each.
In the second run the PointPay socket counted up to 23 fewer frames than Bybit's with no gap in its own chain, so the missing frames lie at the start or the end of the window and not inside it.
The earliest PointPay frame beat its Bybit twin by up to 166 ms, and the latest trailed it by up to 314 ms.
A PointPay book therefore adds no information to a Bybit book, and it arrives about 70 to 80 ms later on this host.

### Snapshot on subscribe

The first frame of each book topic is `"type":"snapshot"` with the full depth, 50 or 200 levels per side, and no other snapshot followed in 60 s.
`orderbook.1` sends every frame as a snapshot.
All 172 listed perpetuals delivered their snapshot within 1,153 ms of the subscribe burst.

### Delta semantics

A delta carries `b` and `a` arrays of `[price, size]` string pairs, and a size of `"0"` deletes the level.
No delta arrived with both arrays empty in either run.

### Sequence and gap rule

```text
type = snapshot            replace the book, last = data.u
type = delta, u = last + 1 apply, last = data.u
type = delta, u ≠ last + 1 gap: resync
```

The rule is the one the engine's Bybit feed already applies at [`bybit.ts`](../../../server/src/venues/bybit/bybit.ts), and it held on every delta of every run, with 0 gaps.
`data.seq` is Bybit's cross-sequence and is not needed for the gap rule.

### Checksum

None, and no frame carries one.

### Level order on the wire

Snapshot bids were descending and asks ascending on every topic.
Delta arrays were also ordered on every one of the deltas checked, 0 unordered bid or ask arrays in either run.
A feed still applies deltas by price.

### Level window

A book kept from the snapshot and every delta reached but never passed 50 levels per side on `orderbook.50` and 200 on `orderbook.200`, so a level leaving the window arrives as a `"0"` size.

### Size unit against CCXT `contractSize`

Sizes are base coin: the `BTCUSDT` snapshot best bid `["86723.40","0.194"]` is 0.194 BTC, and the REST `qtyStep` is `0.001`, see [`rest.md`](./rest.md) section 2.
PointPay has no CCXT class.
The CCXT `bybit` class sets `contractSize` 1 on every linear market at `server/node_modules/ccxt/js/src/bybit.js` line 2199, which is the right `sizeMul` for these books.

### One-sided and empty books

None was seen on 172 perpetuals, among them 89 stock perpetuals probed at 03:28 and 03:40 UTC, outside US market hours.
What an empty side looks like on this socket is Not verified.

### Idle repeats

No frame repeated the previous update id on any topic in the 60 s of the second run, the one that counted it.
The quiet `AAPLUSDT` book went 3.3, 3.5, 3.9 and 5.1 s without a frame in four runs.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `orderbook.50.NOPEUSDT` | `"success":false`, `"ret_msg":"error:handler not found,topic:orderbook.50.NOPEUSDT"` | nothing |
| `orderbook.50.1000PEPEUSDT`, a Bybit perpetual PointPay does not list | `"success":true` | 319 and 425 frames in about 15 s |
| `orderbook.30.BTCUSDT` | `error:handler not found,topic:orderbook.30.BTCUSDT` | nothing |
| `orderbook.50.btcusdt` | `error:handler not found,topic:orderbook.50.btcusdt` | nothing |
| `orderbook.1.ETHUSDT` twice | the second answers `error:already subscribed,topic:orderbook.1.ETHUSDT` | the first keeps delivering |
| `{"op": "nope"}` | `error:invalid op` | |
| `hello` | `Failed to decode incoming data:readObjectStart: expect { or n, but found h, …` | the socket stays open |
| private topic `order` | `error:handler not found,topic:order` | |

A closed or delisted contract was not available, since all 172 listed contracts were `Trading`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the terminal sends `{"op":"ping"}` every 20 s, S2 | pong in 318 to 322 ms on PointPay against 169 and 170 ms on Bybit. No server protocol ping in 120 s |
| silence the server tolerates | Not publicly specified. The spot socket documents "closed by the server in case of inactivity from the client after 60 seconds", S1 | a socket with nothing subscribed and nothing sent closed at 60.98 and 61.03 s with code 1006 and no close frame. A socket subscribed to `orderbook.50.AAPLUSDT` that never pinged stayed open the full 120 s, twice |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | offered permessage-deflate, the server answered `permessage-deflate; server_no_context_takeover; client_no_context_takeover`. Not offered, it sent plain text frames |
| handshake | | 988 to 1,046 ms to open over the ten sockets that logged it, about twice Bybit's 533 and 561 ms |
| subscription limits | Not publicly specified | 172 topics on one socket, no refusal |
| throughput | | 172 perpetuals at 50 levels: 1,445 and 1,686 frames per second on average, peak 2,427 and 3,707, 374 and 468 KB per second, 259 and 278 bytes per frame, 9.1 and 10.3 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the second run at 03:38 UTC.
Book arrays are cut to three levels per side.

Subscribe.

```json
{"req_id": "probe-pp", "op": "subscribe", "args": ["orderbook.50.BTCUSDT", "orderbook.50.ETHUSDT", "orderbook.50.ALGOUSDT", "orderbook.50.AAPLUSDT", "orderbook.200.BTCUSDT", "orderbook.1.BTCUSDT", "tickers.BTCUSDT"]}
```

Acknowledgement.

```json
{"success":true,"ret_msg":"","conn_id":"da7tou12ob6fpjtusqi0-8f1rr","req_id":"probe-pp","op":"subscribe"}
```

Snapshot.

```json
{"topic":"orderbook.50.BTCUSDT","type":"snapshot","ts":1790134712130,"data":{"s":"BTCUSDT","b":[["86723.40","0.194"],["86723.30","0.002"],["86722.30","0.001"]],"a":[["86723.50","5.959"],["86723.60","0.320"],["86723.80","0.870"]],"u":173678160,"seq":814547787693},"cts":1790134712126}
```

Delta.

```json
{"topic":"orderbook.50.AAPLUSDT","type":"delta","ts":1790134716101,"data":{"s":"AAPLUSDT","b":[["340.82","3.37"]],"a":[],"u":29443257,"seq":301632783305},"cts":1790134716094}
```

Keepalive.

```json
{"req_id": "ping-pp", "op": "ping"}
```

```json
{"success":true,"ret_msg":"pong","conn_id":"da7tou12ob6fpjtusqi0-8f1rr","req_id":"ping-pp","op":"ping"}
```

Errors.

```json
{"success":false,"ret_msg":"error:handler not found,topic:orderbook.50.NOPEUSDT","conn_id":"da7tmhs21nld3jk6lb70-8csm4","req_id":"e1","op":"subscribe"}
```

```json
{"success":false,"ret_msg":"error:already subscribed,topic:orderbook.1.ETHUSDT","conn_id":"da7tmhs21nld3jk6lb70-8csm4","req_id":"e6","op":"subscribe"}
```

Ticker delta.

```json
{"topic":"tickers.BTCUSDT","type":"delta","data":{"symbol":"BTCUSDT","markPrice":"86716.30","indexPrice":"86756.70","openInterestValue":"5250990127.10","singleOpenInterestValue":"2625495106.91"},"cs":814547789569,"ts":1790134712383}
```

Spot socket, for the coverage matrix only.

```json
{"id":2,"params":[],"result":1790134831,"error":null}
```

## 7. Private channels

The terminal posts to `/api/internal/v1/futures/profile/ws_auth` on `https://back.pointpay.io`, then opens `wss://ws-futures.pointpay.io/v5/private`, and falls back to `wss://stream.bybit.com/v5/private`, S2.
The documented private socket methods are the spot ones, under "Private methods | WEBSOKET", S1.
Neither was probed.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The recommendation is not to build a PointPay feed, because every book it would carry is already in the engine through the Bybit feed, sooner.
If one were built anyway, it would be the Bybit feed with another URL.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws-futures.pointpay.io/v5/public/linear` | the only futures socket, used by PointPay's own terminal |
| channel | `orderbook.50.<rawMarketId>` | snapshot on subscribe, a strict `u` chain, 50 levels covers the engine's 20 |
| markets per connection | 172, all listed perpetuals | one socket carried all 172 with 0 gaps. The engine's Bybit feed uses 200 per connection at [`bybit.ts`](../../../server/src/venues/bybit/bybit.ts) line 23 |
| subscribe frames | frames of up to 10 topics, `{"req_id": "<id>", "op": "subscribe", "args": [...]}` | 18 such frames were all acknowledged |
| keepalive | `{"op": "ping"}` every 20 s | the terminal's own cadence, S2, and an idle socket dies at 61 s |
| `maxSilenceMs` | 60,000 | a quiet book went 5.1 s without a frame, and the pong counts as traffic. The Bybit feed uses the same 60,000 at [`bybit.ts`](../../../server/src/venues/bybit/bybit.ts) line 30 |
| routing | `topic` after the second dot gives the `rawMarketId` | `orderbook.50.BTCUSDT` |
| snapshot | `type === 'snapshot'`: `resetBook`, store `data.u` | |
| delta | apply only when `data.u === last + 1` | 0 gaps observed |
| resync | a gap, or a delta before any snapshot: `resync` | the engine's existing path |
| symbol filter | subscribe only the PointPay pairs list | the socket also serves Bybit symbols PointPay does not list |
| receive time | stamp on arrival | |
| deflate | keep `perMessageDeflate: false` | the server negotiates it when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Knowledge Base, "Basic structure \| WEBSOKET", "Public methods \| WEBSOKET", "Depth methods" and "Ping-Pong" | https://pointpay.gitbook.io/base/documentation/developers/exchange-api-documentation/basic-structure-or-websoket | 2026-09-22 | PointPay, global | spot socket URL and methods, 60 s inactivity rule, sections 1, 5 and 7 |
| S2 | PointPay web app: `systemParams` reply and the futures terminal bundle `/_nuxt/2381caf.js` | https://back.pointpay.io/systemParams and https://exchange.pointpay.io/_nuxt/2381caf.js | 2026-09-23 | PointPay, global | `FUTURES_WS_HOST` `wss://ws-futures.pointpay.io`, the `/v5/public/linear` path, the Bybit fallback URL, `orderbook.200` in the terminal, `{"op":"ping"}` every 20 s, `ws_auth`, sections 1 to 8 |
| S3 | CCXT 4.5.68 `bybit.js` | `server/node_modules/ccxt/js/src/bybit.js` | 2026-09-23 | CCXT | `contractSize` 1 on linear markets at line 2199, section 4 |
| P1 | `ws-probe.mjs book`, first run at 03:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pointpay/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, `batch`, `silence` and `deflate`, first run at 03:27 to 03:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pointpay/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| P3 | `ws-probe.mjs book`, `errors`, `batch`, `silence` and `deflate`, second run at 03:38 to 03:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pointpay/ws-probe.mjs) | 2026-09-23 UTC | this host | the second readings of sections 3 to 6 |
| P4 | handshake times of every socket in P1 to P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/pointpay/ws-probe.mjs) | 2026-09-23 UTC | this host | section 1 |
| P5 | `ws-probe.mjs spot`, at 03:31 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pointpay/ws-probe.mjs) | 2026-09-23 UTC | this host | spot socket reachability, sections 1 and 6 |
