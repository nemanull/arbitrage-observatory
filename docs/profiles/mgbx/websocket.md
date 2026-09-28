# MGBX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-22 Pacific time, which is 06:52 to 07:12 UTC on 2026-09-23, and again on 2026-09-23 Pacific time, which is 06:46 to 07:02 UTC on 2026-09-24, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market socket of MGBX Global for its only perpetual family, the USDT-margined perpetuals, with the book channel in detail.
MGBX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The socket URL and every request frame below are the ones the futures web app at www.mgbx.com sends, read from its JavaScript bundle, S1 and S2.
None of it is a published interface, so any of it can change without notice.
The User Agreement forbids automated data collection without MGBX's written consent, see [`fees.md`](./fees.md) section 1.
Every probed number comes from [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs), run from `server/`.
Run 1 is the first researcher's run on 2026-09-23 UTC, and run 2 is the second pass on 2026-09-24 UTC.
The "documented" column below holds what the web app does, because nothing else exists.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals, public market data | `wss://www.mgbx.com/ws/market`, S1 | open in 655 to 765 ms in run 1 and 622 to 734 ms in run 2 |
| public, purpose unknown | `wss://www.mgbx.com/ws/public`, S1 | not probed |
| private | `wss://www.mgbx.com/ws/private` and `wss://www.mgbx.com/ws/user`, S1 | not probed |
| coin-M perpetuals | none: the web app's coin-M catalog path returns `data: []`, see [`rest.md`](./rest.md) section 2 | |

One socket carries one contract, see section 5.
`www.mgbx.com` resolved to 15.197.93.79 and 15.197.214.70 in both runs, see [`rest.md`](./rest.md) section 1.
The TLS handshake to that host stalls often from this exit.
Opening 30 sockets needed 13 retried handshakes in run 1 and 20 in run 2, where one socket still failed five tries of 6 s each.
In the first book attempt of run 2, two of four sockets failed three tries each.

## 2. Channel matrix for public market data

| request | pushes | cadence | probed |
|---|---|---|---|
| `{"req":"sub_symbol","symbol":"btc_usdt"}` | `push.deep.full` | a 100-level snapshot per side, a median of 595 to 600 ms apart on BTC and ETH and 698 to 710 ms on quiet contracts, at most 1,398 ms | run 1 and run 2, recommended |
| same | `push.deep` | one level per frame, a median of 39 to 41 per snapshot interval on BTC and ETH and 2 on quiet contracts | run 1 and run 2 |
| same | `push.deal` | one trade per frame | run 1 and run 2 |
| same | `push.ticker` | 24 h statistics, 485 to 701 ms apart on BTC | run 2 |
| same | `push.agg.ticker` | the ticker plus index `i`, mark `m`, best bid `bp` and best ask `ap`, with the ticker's cadence | run 2 |
| same | `push.index.price` and `push.mark.price` | every 500 ms on a fixed grid, 27 of 27 BTC stamps sat in the same 50 ms slot of each half second | run 2 |
| `{"req":"sub_tickers"}` | `push.tickers` | every 3.1 s, 266 rows in both runs, statistics only, no index, mark or book | run 1 and run 2 |
| `{"req":"sub_mark_prices"}` | `push.mark.prices` | every 3.1 s, 266 rows in run 1 and 268 in run 2, each `{s, p, t}` | run 1 and run 2 |
| `{"req":"sub_kline", …}` and `{"method":"subscribe","params":["kline@btc_usdt,1m"]}` | kline | S1 names both | the second answered `{"code":0,"msg":"success"}` and pushed no kline frame in 4 s |
| `{"req":"sub_prediction"}` | `push.prediction` | named in S1, probably the event contracts | not probed |

`sub_symbol` is all or nothing.
It subscribes every per-contract channel at once, and there is no request for the book alone.
No funding channel exists on the socket, so funding comes only from REST, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
MGBX documents none of them, so the middle column is what the web app does, S1 and S2.

| axis | the web app | probed |
|---|---|---|
| endpoint split axis | one market URL for everything public | one family exists, so there is nothing to split |
| subscribe frame shape | `{"req": <event>, …params}`, for example `{"req":"sub_symbol","symbol":"btc_usdt"}` | a second `sub_symbol` on the same socket replaces the first: BTC sent at most five more frames and stopped, and ETH started, in both runs |
| unknown symbol expectation | Not publicly specified | `nope_usdt`, `BTC_USDT` and the dead `burger_usdt` are each acknowledged with `succeed` and `{"code":0,"msg":"success"}` and then send nothing |
| chunk unit and budget | one contract per socket | one contract per socket, so there is no chunk. 30 sockets from one address were not refused |
| keepalive mechanism | text `ping` every 15 s, and a reconnect after 40 s without a frame. A server `ping` is answered with `pong` | text `ping` is answered with text `pong`. No server ping, text or protocol, was seen on any socket in 120 s |
| connection lifetime and maintenance notice | none | no close on a subscribed socket in 120 s, and no notice |
| handshake and operation rate limits | Not publicly specified | none met at 30 sockets. The TLS handshake stalls often, section 1 |
| public market data authentication | none | none |
| message parse and routing | the handler turns `push.x.y` into `sub_x_y` and routes on `data.s` | every push is `{"channel", "data"}`, and every per-contract push carries `data.s` |
| subscribe acknowledgement shape | not handled | two frames: the bare text `succeed`, which is not JSON, then `{"code":0,"msg":"success"}` |
| symbol identifier format | `btc_usdt` | lower case, identical to the REST `symbol` and `s`, see [`rest.md`](./rest.md) section 2 |
| number representation | strings | prices and sizes are strings. Snapshot sizes are often scientific notation such as `"1.39E+3"`, section 4 |
| timestamp representation | ms | `t` in ms on deltas, trades, tickers, index and mark. The snapshot has no `t`. The delta `id` also encodes its time, section 4 |
| size unit | contracts | contracts of the catalog's `contractSize`, section 4 |
| sequence semantics | the snapshot resets the book and stores its `id` as the book id, S2 | `id` rises strictly on each socket but not by one, and each snapshot's `id` is the `id` of the last delta it includes, section 4 |
| idle repeat behaviour | not handled | no two consecutive snapshots were identical, and a quiet contract still gets a snapshot every 0.4 to 1.4 s |

## 4. The book channel in detail

### Snapshot on subscribe

The first `push.deep.full` arrived 972 to 1,412 ms after the socket was created in run 2, and 1,102 to 1,577 ms in run 1.
Every snapshot on every contract in both runs held exactly 100 bids and 100 asks: 156, 155, 90 and 76 snapshots on BTC, ETH, VST and XAU in the second book attempt of run 2, and 223 on BTC in the first.
The snapshot keeps coming about every 600 ms for as long as the subscription lasts.
Its keys are `s`, `id`, `a` and `b`, with asks first on the wire, and it carries no timestamp.

### Delta semantics

A `push.deep` frame carries one level: `id`, `s`, `ba` (1 for a bid, 2 for an ask), `p`, `q` and `t`.
A `q` of `"0"` deletes the level.
BTC sent 5,469 deltas in run 2, 2,908 bids and 2,561 asks.

### Sequence and gap rule

The `id` is a Snowflake identifier.
The `id` shifted right by 22 bits, plus 1,629,702,000,000, gives the delta's `t` in ms.
That held on 859 of 859 captured deltas, 853 exactly and 6 one ms later, and the epoch is 2021-08-23 07:00 UTC.
The low 22 bits are a counter that is not per contract, so `id` steps by one on only 1,049 of 5,468 BTC steps in run 2, and the largest step was 926,941,228.
No `id` ever went backwards, in either run.

Each snapshot's `id` equals the `id` of a delta already received on the same socket: 156 of 156, 155 of 155, 90 of 90 and 76 of 76 snapshots in run 2, and 223 of 223 on BTC in the first book attempt of run 2.
No delta received after a snapshot carried an `id` at or below it, and no delta received before a snapshot carried a larger `id`, on any contract.
So a snapshot is exactly the book after the delta whose `id` it carries.

The replay check applies the deltas with an `id` at or below the next snapshot's `id` to the previous snapshot and compares the top 20 levels per side.
In run 2 it matched 155 of 155, 154 of 154, 89 of 89 and 75 of 75 snapshots, and 222 of 222 on BTC in the first attempt.
Run 1's replay keyed levels by the raw price string and matched 128 of 187 BTC snapshots, 186 of 187 ETH and all on the quiet contracts.
The cause of those mismatches was not established.

```text
push.deep.full           replace the book, last = BigInt(id)
push.deep, id > last     apply by price, last = BigInt(id)
push.deep, id <= last    drop, it is already in the snapshot
```

No gap can be detected from `id`, because consecutive deltas of one contract are not consecutive ids.
The next snapshot heals any lost delta within about 0.6 s on a busy book and 1.4 s on a quiet one.

### Checksum

None exists in any frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of both runs | best first, ascending, on every snapshot |
| delta | one level per frame | one level per frame |
| REST `q/depth` | descending on 5 of 5 contracts in both runs | ascending on 5 of 5 |

No snapshot was crossed.

### Size unit against the catalog `contractSize`

MGBX has no CCXT class, so the unit is checked against the catalog's own `contractSize`, see [`rest.md`](./rest.md) section 2.
In run 2 the REST book was read while each socket was open, 174 to 995 ms after that socket's last snapshot.
The REST `u` equalled the snapshot `id` on 4 of 4 contracts, and all 40 of 40 top sizes were equal on each.

| contract | `contractSize` | snapshot size at the bid | REST size at the same price | coins |
|---|---:|---|---|---|
| `btc_usdt` | 0.0001 | `"115817"` | `"115817"` | 11.5817 BTC |
| `eth_usdt` | 0.01 | `"76175"` | `"76175"` | 761.75 ETH |
| `vst_usdt` | 0.001 | `"1.39E+3"` | `"1390"` | 1.39 VST |
| `xau_usdt` | 0.0001 | `"493"` | `"493"` | 0.0493 XAU |

The unit is contracts of `contractSize` base units, as on the REST book.
Snapshot sizes switch to scientific notation freely: 8,355 of 31,200 BTC sizes and 13,155 of 31,000 ETH sizes in run 2 were written that way.
`Number()` parses both spellings, and no REST size in either run used scientific notation.
All 1,717 captured delta sizes were plain integers.

### One-sided and empty books

None was seen.
All four contracts in both runs had 100 levels on each side of every snapshot.

### Idle repeats

Nothing is repeated.
0 of 89 and 0 of 75 consecutive snapshot pairs on the two quiet contracts were identical in run 2, and they still had at least 2 deltas between snapshots.
The longest gap between book frames was 964 ms on `vst_usdt` and 1,083 ms on `xau_usdt`.

### Unknown, closed and wrong-case symbols

| request | reply | then |
|---|---|---|
| `sub_symbol` `nope_usdt` | `succeed`, then `{"code":0,"msg":"success"}` | nothing in 2.5 s, both runs |
| `sub_symbol` `BTC_USDT` | the same | nothing in 2.5 s, both runs |
| `sub_symbol` `burger_usdt`, a contract missing from the catalog whose last ticker is from 2025-03-21 | the same | nothing in 60 s, in the first book attempt of run 2 |
| `sub_nope`, an unknown request | the same | |
| `unsub_symbol` | the same | every push stops |
| text that is not JSON, `hello` | the text `Invalid parameter` | the server closed the socket with code 1005 right after it, both runs |

The REST book of `burger_usdt` still answers with a frozen book whose `u` decodes to 2025-03-21 07:07:46 UTC, see [`rest.md`](./rest.md) section 5.
Because the socket acknowledges a contract it will never serve, the feed has to notice a contract with no snapshot on its own.

### Delay against the venue clock and against Binance

Deltas arrived a median of 313 and 318 ms after their `t` on BTC and ETH in run 2, and 265 and 314 ms on the quiet contracts, with a minimum of 132 ms.
The host clock was within 4 ms of Binance's server time and MGBX's server time was within 3 ms of the host clock, see [`rest.md`](./rest.md) section 7.
Half the warm REST round trip is about 85 ms, so roughly 200 ms of that delay is spent before the frame leaves MGBX, which is an inference from these three numbers.

The WS mirror mode compared each MGBX snapshot touch with Binance USDT-M `bookTicker` for 60 s, in run 1 only.
It was not rerun, to keep the second pass near the socket budget.

| contract | snapshots | bid equal to Binance's at arrival | best delay | median mid gap | snapshots crossing Binance's touch at arrival | cross size |
|---|---:|---:|---|---|---:|---|
| BTC | 97 | 23 | 26 at 750 to 1,500 ms | 1 ppm at every delay | 26 | median 47 ppm, max 382 ppm |
| ETH | 98 | 28 | 37 at 1,000 ms | 5 ppm at arrival, 2 ppm at 250 to 1,500 ms | 45 | median 36 ppm, max 178 ppm |

MGBX's median spread was 2 ppm on BTC and 7 ppm on ETH, against 1 and 4 ppm on Binance.
The REST mirror read found 22 of 40 BTC levels and 38 of 40 ETH levels at a price present in Binance's 20-level book in run 1, and 0 of 40 and 28 of 40 in run 2, see [`rest.md`](./rest.md) section 4.
A book that tracks Binance's mid to 1 ppm yet crosses Binance's touch on a quarter to a half of its snapshots is the pattern of [`lagging-view.md`](../../bestiary/lagging-view.md).

## 5. Session

| item | the web app | probed |
|---|---|---|
| keepalive | text `ping` every 15 s, reconnect after 40 s without any frame, answer a server `ping` with `pong`, S1 | `ping` got `pong` in both runs. `{"ping": <ms>}` and `{"method":"PONG","E": <ms>}` each got `{"code":0,"msg":"success"}`. No server ping on any socket |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 60.7 s with 1006 in run 1 and at 82.8 s with 1005 in run 2. A subscribed socket with no client frame stayed open for the full 120 s in both runs, as did one sending `ping` every 10 s, which got 11 `pong` replies |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | none | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in either run |
| handshake | | 622 to 765 ms to open over both runs, when the TLS handshake did not stall |
| subscription limits | one contract per socket | confirmed: `sub_symbol` replaces the socket's contract. 29 of 30 sockets from one address opened and ran in run 2, the 30th failed on handshake stalls |
| throughput | | the 30 busiest contracts, one socket each, for 30 s: 19,880 frames at a median of 662 per second in run 1, and 18,767 at a median of 636 per second in run 2 |
| frame size and parse cost | | 303 and 315 bytes per frame on average, so about 196 KB per second in run 2, and 18.5 and 10.3 µs `JSON.parse` per frame |

The byte rate is frames per second times bytes per frame.
The probe's own `kbPerSecond` field in both runs divided bytes counted from the first socket's open by the 30 s window, so it overstated the rate, and it is fixed in the script for the next run.

## 6. Captured frames

Trimmed, from the probe runs.
Snapshot arrays are cut to three levels per side.

Subscribe, and the two acknowledgement frames, the first of which is not JSON.

```json
{"req": "sub_symbol", "symbol": "vst_usdt"}
```

```text
succeed
```

```json
{"code":0,"msg":"success"}
```

The last two deltas before a snapshot, and that snapshot, whose `id` is the second delta's `id`.
Run 2, `vst_usdt`, first three levels per side kept.

```json
{"channel":"push.deep","data":{"id":"673314116332447296","s":"vst_usdt","ba":1,"p":"137.67","q":"0","t":1790232594905}}
```

```json
{"channel":"push.deep","data":{"id":"673314116332447297","s":"vst_usdt","ba":2,"p":"137.82","q":"0","t":1790232594905}}
```

```json
{"channel":"push.deep.full","data":{"s":"vst_usdt","id":"673314116332447297","a":[["137.73","1286"],["137.75","1386"],["137.77","1283"]],"b":[["137.69","1.35E+3"],["137.63","1393"],["137.61","1294"]]}}
```

Index, mark, trade and the aggregated ticker on `btc_usdt`, run 2.

```json
{"channel":"push.index.price","data":{"s":"btc_usdt","p":"84076.3","t":1790232705636}}
```

```json
{"channel":"push.mark.price","data":{"s":"btc_usdt","p":"84076.3","t":1790232705637}}
```

```json
{"channel":"push.deal","data":{"s":"btc_usdt","p":"84076.5","a":"7193","m":"BID","t":1790232705538}}
```

```json
{"channel":"push.agg.ticker","data":{"s":"btc_usdt","o":"86402.5","c":"84063.5","h":"86473.4","l":"83465.2","a":"272748188","v":"2309133048.91270","r":"-0.0270","i":"84076.4","m":"84076.4","bp":"84063.5","ap":"84063.7","t":1790232705097}}
```

The market-wide mark push, first three of 268 rows, run 2.

```json
{"channel":"push.mark.prices","data":[{"s":"btc_usdt","p":"83968.7","t":1790233314637},{"s":"eth_usdt","p":"2681.67","t":1790233314637},{"s":"xrp_usdt","p":"1.4971","t":1790233314638}]}
```

Keepalive, text in both directions.

```text
ping
pong
```

Error: the client sent `hello`, and the server answered with text and closed with code 1005.

```text
Invalid parameter
```

## 7. Private channels

Named for a future execution stage, from S1 and S2, not probed.

- `wss://www.mgbx.com/ws/user` with `{"req":"sub_user","listenKey": <key>}` and `{"req":"unsub_user"}`.
- The trade page handles `user.balance`, `user.position` and `user.trade` pushes, S2.
- `wss://www.mgbx.com/ws/private` is opened by the web app, and its frames were not traced.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It only applies if MGBX grants consent for automated access, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://www.mgbx.com/ws/market`, one socket per contract, 267 sockets for the 267 trading contracts of 2026-09-24 | `sub_symbol` replaces the socket's contract |
| markets per connection | 1 | same |
| connect | staggered, with a 6 s handshake timeout and a retry | TLS handshakes stall from this exit, section 1 |
| subscribe frame | `{"req":"sub_symbol","symbol":"<rawMarketId>"}` once per socket | the web app's frame |
| keepalive | text `ping` every 15 s, and answer a text `ping` with `pong` | the web app's rule. A subscribed socket survived 120 s without it, but an idle one died at 60.7 to 82.8 s |
| `maxSilenceMs` | 5,000 | index and mark push every 500 ms and the quietest snapshot gap was 1.4 s, so every frame counts as traffic |
| parse | accept the bare text frames `succeed`, `pong` and `Invalid parameter` before `JSON.parse` | they are not JSON |
| routing | `data.s` is the `rawMarketId` | every per-contract push carries it |
| snapshot | every `push.deep.full`: `resetBook`, and store `BigInt(id)` | a snapshot is the exact book after its `id` |
| delta | apply only when `BigInt(id)` is above the stored id, then store it | deltas at or below the snapshot are already in it |
| resync | none on `id`, since no gap is visible. Terminate the socket when no snapshot arrives for 5 s | the next snapshot heals a lost delta |
| unserved contract | log a contract with no snapshot 10 s after `succeed` | the socket acknowledges contracts it never serves |
| receive time | stamp on arrival | frames arrive about 300 ms after their `t` |
| book age | `(BigInt(id) >> 22n) + 1629702000000n` is the venue time of the last change a snapshot includes | the snapshot has no `t` |
| sizes | `Number()` of the string, times `contractSize` | scientific notation appears in snapshots |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The engine's `VenueFeed` opens one socket per endpoint plan with no headers, at [`VenueFeed.ts`](../../../old_ts_server/src/feeds/book/VenueFeed.ts) line 81, so 267 plans of one market each fit its shape, and MGBX asked for no header.
267 sockets to one host were not tested, only 30.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | MGBX trade web app bundle `_app-2a873338ef1ad054.js` | https://www.mgbx.com/trade/_next/static/chunks/pages/_app-2a873338ef1ad054.js | 2026-09-23 | MGBX Global | socket URLs, request names, `ping` every 15 s, 40 s reconnect, `pong` reply, kline subscribe, sections 1 to 3, 5 and 7 |
| S2 | MGBX trade page chunk `[symbolId]-3244f2d8a8f02602.js` | https://www.mgbx.com/trade/_next/static/chunks/pages/contract/trade/%5BsymbolId%5D-3244f2d8a8f02602.js | 2026-09-23 | MGBX Global | snapshot resets the book with `id` as its id, `user.*` pushes, sections 3 and 7 |
| S3 | MGBX help center, all 75 English articles through the Zendesk articles API | https://support.mgbx.com/api/v2/help_center/en-us/articles.json | 2026-09-22 | MGBX Global | no API or WebSocket documentation exists, the preamble |
| P1 | `ws-probe.mjs book`, `control`, `silence`, `fanout`, `deflate`, `bulk` and `mirror`, run 1 | [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs) | 2026-09-23 06:52 to 07:12 UTC | this host | sections 1 to 6, the run 1 readings, and the WS mirror |
| P2 | `ws-probe.mjs book`, two attempts, run 2 | [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs) | 2026-09-24 06:46 to 06:51 UTC | this host | section 4, the id rule, the replay and the size unit |
| P3 | `ws-probe.mjs control`, `silence`, `fanout`, `bulk` and `deflate`, run 2 | [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs) | 2026-09-24 06:51 to 07:02 UTC | this host | sections 2, 3, 5 and 6, the run 2 readings |
| P4 | `rest-probe.mjs clock` and `mirror`, run 2 | [`rest-probe.mjs`](../../../scripts/probes/venues/mgbx/rest-probe.mjs) | 2026-09-24 06:45 to 07:04 UTC | this host | clock offsets and the REST mirror, section 4 |
