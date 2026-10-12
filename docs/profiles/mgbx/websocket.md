# MGBX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time, which is 02:29 to 03:10 UTC on 2026-10-10, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.
Earlier runs on 2026-09-23 and 2026-09-24 UTC used [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs), which stays as frozen evidence.

This profile covers the public market socket of MGBX Global for its only perpetual family, the USDT-margined perpetuals, with the book channel in detail.
MGBX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The socket URL and every request frame below are the ones the futures web app at www.mgbx.com sent when the first run read its JavaScript bundle, S1 and S2.
Those bundle chunks answered HTTP 404 on 2026-10-09 because the web app was redeployed, but the socket and every frame below still worked on 2026-10-10 UTC.
None of it is a published interface, so any of it can change without notice.
The User Agreement forbids automated data collection without MGBX's written consent, see [`fees.md`](./fees.md) section 1.
Run 1 is the first researcher's run on 2026-09-23 UTC and run 2 its second pass on 2026-09-24 UTC, both with the frozen `.mjs` probe.
Run 3 is this check with [`ws-probe.py`](../../../scripts/probes/venues/mgbx/ws-probe.py) on 2026-10-10 UTC, and run 4 its second pass.
The "web app" column below holds what the web app did, because nothing else exists.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals, public market data | `wss://www.mgbx.com/ws/market`, S1 | open in 627 to 742 ms in runs 3 and 4, 622 to 765 ms in runs 1 and 2 |
| public, purpose unknown | `wss://www.mgbx.com/ws/public`, S1 | not probed |
| private | `wss://www.mgbx.com/ws/private` and `wss://www.mgbx.com/ws/user`, S1 | not probed |
| coin-M perpetuals | none: the web app's coin-M catalog path returns `data: []`, see [`rest.md`](./rest.md) section 2 | |

One socket carries one contract, see section 5.
`www.mgbx.com` resolved to 15.197.93.79 and 15.197.214.70 in every run, see [`rest.md`](./rest.md) section 1.
The TLS handshake to that host stalls often from this exit.
The four book sockets needed 6 retried handshakes of 6 s each between them in run 3 and 1 in run 4, P1.
Opening 30 sockets needed 13 retried handshakes in run 1 and 20 in run 2, where one socket still failed five tries, P5.

## 2. Channel matrix for public market data

| request | pushes | cadence in runs 3 and 4 | probed |
|---|---|---|---|
| `{"req":"sub_symbol","symbol":"btc_usdt"}` | `push.deep.full` | a 100-level snapshot per side, a median of 598 to 600 ms apart on BTC and ETH and 614 to 652 ms on the quiet contracts, at most 1,251 ms | runs 1 to 3, recommended |
| same | `push.deep` | one level per frame, 3,074 to 3,110 on BTC and 3,500 to 3,584 on ETH in 60 s, and 308 to 431 on the quiet contracts | runs 1 to 3 |
| same | `push.deal` | one trade per frame | runs 1 to 3 |
| same | `push.ticker` | 24 h statistics, 99 or 100 in 60 s | runs 2 and 3 |
| same | `push.agg.ticker` | the ticker plus index `i`, mark `m`, best bid `bp` and best ask `ap`, with the ticker's cadence | runs 2 and 3 |
| same | `push.index.price` and `push.mark.price` | 119 or 120 of each in 60 s, one every 500 ms | runs 2 and 3 |
| `{"req":"sub_tickers"}` | `push.tickers` | every 3.0 to 3.1 s, 273 rows, statistics only, no index, mark or book | runs 1 to 3 |
| `{"req":"sub_mark_prices"}` | `push.mark.prices` | every 2.9 to 3.1 s, 272 rows in run 3 and 273 in run 4, each `{s, p, t}` | runs 1 to 3 |
| `{"req":"sub_kline", ...}` and `{"method":"subscribe","params":["kline@btc_usdt,1m"]}` | kline | S1 names both | in run 1 the second answered `{"code":0,"msg":"success"}` and pushed no kline frame in 4 s |
| `{"req":"sub_prediction"}` | `push.prediction` | named in S1, probably the event contracts | not probed |

Cadences and counts are from P1 and P3.
`sub_symbol` is all or nothing.
It subscribes every per-contract channel at once, and there is no request for the book alone.
No funding channel exists on the socket, so funding comes only from REST, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
MGBX documents none of them, so the middle column is what the web app did, S1 and S2.

| axis | the web app | probed |
|---|---|---|
| endpoint split axis | one market URL for everything public | one family exists, so there is nothing to split |
| subscribe frame shape | `{"req": <event>, ...params}`, for example `{"req":"sub_symbol","symbol":"btc_usdt"}` | a second `sub_symbol` on the same socket replaces the first: BTC sent 28 more frames in run 3, 6 in run 4 and at most five in runs 1 and 2, then stopped, and ETH started, P2 |
| unknown symbol expectation | Not publicly specified | `nope_usdt`, `BTC_USDT` and the delisted `burger_usdt` are each acknowledged with `succeed` and `{"code":0,"msg":"success"}` and then send nothing, P2 |
| chunk unit and budget | one contract per socket | one contract per socket, so there is no chunk. 30 sockets from one address were not refused in runs 1 and 2, P5 |
| keepalive mechanism | text `ping` every 15 s, and a reconnect after 40 s without a frame. A server `ping` is answered with `pong` | text `ping` is answered with text `pong`. No server ping, text or protocol, was seen in 120 s, P2 and P4 |
| connection lifetime and maintenance notice | none | no close on a subscribed socket in 120 s, and no notice, P4 |
| handshake and operation rate limits | Not publicly specified | none met. The TLS handshake stalls often, section 1 |
| public market data authentication | none | none |
| message parse and routing | the handler turns `push.x.y` into `sub_x_y` and routes on `data.s` | every push is `{"channel", "data"}`, and every per-contract push carries `data.s` |
| subscribe acknowledgement shape | not handled | two frames: the bare text `succeed`, which is not JSON, then `{"code":0,"msg":"success"}` |
| symbol identifier format | `btc_usdt` | lower case, identical to the REST `symbol` and `s`, see [`rest.md`](./rest.md) section 2 |
| number representation | strings | prices and sizes are strings. Snapshot sizes are often scientific notation such as `"5.254E+4"`, section 4 |
| timestamp representation | ms | `t` in ms on deltas, trades, tickers, index and mark. The snapshot has no `t`. The delta `id` also encodes its time, section 4 |
| size unit | contracts | contracts of the catalog's `contractSize`, section 4 |
| sequence semantics | the snapshot resets the book and stores its `id` as the book id, S2 | `id` rises strictly on each socket but not by one, and each snapshot's `id` is the `id` of the last delta it includes, section 4 |
| idle repeat behaviour | not handled | no two consecutive snapshots were identical, and a quiet contract still gets a snapshot every 0.6 to 1.2 s |

## 4. The book channel in detail

### Snapshot on subscribe

The first `push.deep.full` arrived 177 to 916 ms after the subscribe frame in runs 3 and 4, P1.
Every snapshot on every contract held exactly 100 bids and 100 asks: 100, 99, 68 and 69 snapshots on BTC, ETH, VST and XAU in 60 s in run 3, and 100, 100, 69 and 68 in run 4.
The snapshot keeps coming about every 600 ms for as long as the subscription lasts.
Its keys are `s`, `id`, `a` and `b`, with asks first on the wire, and it carries no timestamp.

### Delta semantics

A `push.deep` frame carries one level: `id`, `s`, `ba` (1 for a bid, 2 for an ask), `p`, `q` and `t`.
A `q` of `"0"` deletes the level.
BTC sent 3,110 deltas in 60 s, 1,568 bids and 1,542 asks, P1.

### Sequence and gap rule

The `id` is a Snowflake identifier.
The `id` shifted right by 22 bits, plus 1,629,702,000,000, gives the delta's `t` in ms.
That held on 7,434 of 7,434 deltas over the four contracts in run 3, 7,381 exactly and 53 one ms later, and on 7,303 of 7,303 in run 4, 7,247 exactly and 56 one ms later, P1.
The epoch is 2021-08-23 07:00 UTC.
The low 22 bits are a counter that is not per contract, so `id` steps by one on only 373 of 3,109 BTC steps in run 3 and 296 of 3,073 in run 4, and the largest BTC step was 926,941,222.
No `id` ever went backwards, in any run.

Each snapshot's `id` equals the `id` of a delta already received on the same socket.
In run 3 that held on 100 of 100, 99 of 99, 68 of 68 and 68 of 68 snapshots that came after the first delta, and in run 4 on 99 of 99, 100 of 100, 68 of 68 and 68 of 68, P1.
No delta received after a snapshot carried an `id` at or below it, and no delta received before a snapshot carried a larger `id`, on any contract.
So a snapshot is exactly the book after the delta whose `id` it carries.

The replay check applies the deltas with an `id` above a snapshot's `id` to that snapshot until the next one arrives, and compares the top 20 levels per side with the next snapshot.
In run 3 it matched 99 of 99, 98 of 98, 67 of 67 and 68 of 68 snapshots, and in run 4 99 of 99, 99 of 99, 68 of 68 and 67 of 67, P1.
Run 2 matched every snapshot too, and run 1's replay keyed levels by the raw price string and matched 128 of 187 BTC snapshots, P5 and P6.
Runs 3 and 4 key levels by the numeric price, which is what a feed should do.

```text
push.deep.full           replace the book, last = id as u64
push.deep, id > last     apply by price, last = id
push.deep, id <= last    drop, it is already in the snapshot
```

No gap can be detected from `id`, because consecutive deltas of one contract are not consecutive ids.
The next snapshot heals any lost delta within about 0.6 s on a busy book and 1.2 s on a quiet one.

### Checksum

None exists in any frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of runs 3 and 4 | best first, ascending, on every snapshot |
| delta | one level per frame | one level per frame |
| REST `q/depth` | descending, see [`rest.md`](./rest.md) section 5 | ascending |

No snapshot was crossed.

### Size unit against the catalog `contractSize`

MGBX has no CCXT class, so the unit is checked against the catalog's own `contractSize`, see [`rest.md`](./rest.md) section 2.
In runs 3 and 4 the REST book was read while each socket was still open.
The REST `u` equalled the `id` of a snapshot on the socket on BTC and VST in run 3 and on BTC and ETH in run 4, and all 40 of 40 top levels were equal on each of those four, P1.
On the other four reads the REST `u` matched no snapshot on the socket, so the books were of different instants.
Run 2 matched 4 of 4 contracts the same way, P6.

| contract | `contractSize` | snapshot size at the bid | REST size at the same price | coins |
|---|---:|---|---|---|
| `btc_usdt` | 0.0001 | `"71711"` | `"71711"` | 7.1711 BTC |
| `vst_usdt` | 0.001 | `"1438"` | `"1438"` | 1.438 VST |

The unit is contracts of `contractSize` base units, as on the REST book.
Snapshot sizes switch to scientific notation freely: 10,695 of 20,000 BTC sizes and 10,150 of 19,800 ETH sizes in run 3, and 10,094 and 9,795 of 20,000 in run 4, were written that way, for example `"5.254E+4"`.
A float parser reads both spellings.
No delta size used scientific notation, 0 of 7,434 in run 3 and 0 of 7,303 in run 4.

### One-sided and empty books

None was seen.
All four contracts had 100 levels on each side of every snapshot in every run.

### Idle repeats

Nothing is repeated.
0 consecutive snapshot pairs were identical on any of the four contracts in runs 3 and 4.
The longest gap between book frames was 1,078 ms on `vst_usdt` and 1,069 ms on `xau_usdt`, P1.

### Unknown, closed and wrong-case symbols

| request | reply | then |
|---|---|---|
| `sub_symbol` `nope_usdt` | `succeed`, then `{"code":0,"msg":"success"}` | nothing in 3 s |
| `sub_symbol` `BTC_USDT` | the same | nothing in 3 s |
| `sub_symbol` `burger_usdt`, a contract missing from the catalog | the same | nothing in 5 s in run 3, and nothing in 60 s in run 2 |
| `sub_nope`, an unknown request | the same | |
| `{"ping": <ms>}` | `{"code":0,"msg":"success"}` | |
| `unsub_symbol` | `succeed` and `{"code":0,"msg":"success"}`, inside a 3 s window that also held 6 pushes in run 3 and 46 in run 4 | every push stopped in run 2 |
| text that is not JSON, `hello` | the text `Invalid parameter` | the server closed the socket with code 1005 right after it |

All rows are from P2.
The REST book of `burger_usdt` answered with a frozen book from 2025-03-21 in run 2, see [`rest.md`](./rest.md) section 2.
Because the socket acknowledges a contract it will never serve, the feed has to notice a contract with no snapshot on its own.

### Delay against the venue clock

Deltas arrived a median of 266 to 287 ms after their `t` on BTC and ETH in runs 3 and 4, and 205.5 to 311 ms on the quiet contracts, with a minimum of 114 ms, P1.
MGBX's server time was within 10 ms of the host clock in the same hour, see [`rest.md`](./rest.md) section 7.
Half the warm REST round trip is about 80 to 90 ms, so roughly 120 to 200 ms of that delay is spent before the frame leaves MGBX, which is an inference from these numbers.

Run 1 compared each MGBX snapshot touch with Binance USDT-M `bookTicker` for 60 s, P5.
The BTC and ETH books tracked Binance's mid to 1 to 5 ppm, yet 26 of 97 BTC and 45 of 98 ETH snapshots crossed Binance's touch at arrival.
That is the pattern of [`lagging-view.md`](../../bestiary/lagging-view.md).
This mirror was not rerun in run 3, to stay inside the socket budget.

## 5. Session

| item | the web app | probed |
|---|---|---|
| keepalive | text `ping` every 15 s, reconnect after 40 s without any frame, answer a server `ping` with `pong`, S1 | `ping` got `pong`, and `{"ping": <ms>}` got `{"code":0,"msg":"success"}`, P2. No server ping on any socket |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame was dropped at 60.0 s without a close frame in runs 3 and 4, and at 60.7 s and 82.8 s in runs 1 and 2. A subscribed socket with no client frame stayed open for the full 120 s and received 1,715 and 1,716 frames, P4 |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | none | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in runs 1 to 4, P2 |
| handshake | | 627 to 742 ms to open in runs 3 and 4, when the TLS handshake did not stall |
| subscription limits | one contract per socket | confirmed: `sub_symbol` replaces the socket's contract. 29 of 30 sockets from one address opened and ran in run 2, the 30th failed on handshake stalls, P5 |
| throughput | | the 30 busiest contracts, one socket each, for 30 s: a median of 662 frames per second in run 1 and 636 in run 2, P5 |
| frame size | | 303 and 315 bytes per frame on average in runs 1 and 2, P5 |

## 6. Captured frames

Trimmed, from run 3.
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

Index, mark and the aggregated ticker on `vst_usdt`, where index `i` and mark `m` are the same number.

```json
{"channel":"push.index.price","data":{"s":"vst_usdt","p":"161.04","t":1791599533348}}
```

```json
{"channel":"push.mark.price","data":{"s":"vst_usdt","p":"161.04","t":1791599533349}}
```

```json
{"channel":"push.agg.ticker","data":{"s":"vst_usdt","o":"157.85","c":"161.02","h":"162.02","l":"155.98","a":"285811","v":"45562.10044","r":"0.0200","i":"161.04","m":"161.04","bp":"161.02","ap":"161.06","t":1791599532596}}
```

The last two deltas before a snapshot, and that snapshot, whose `id` is the second delta's `id`.
Run 2, `vst_usdt`, first three levels per side kept, P6.

```json
{"channel":"push.deep","data":{"id":"673314116332447296","s":"vst_usdt","ba":1,"p":"137.67","q":"0","t":1790232594905}}
```

```json
{"channel":"push.deep","data":{"id":"673314116332447297","s":"vst_usdt","ba":2,"p":"137.82","q":"0","t":1790232594905}}
```

```json
{"channel":"push.deep.full","data":{"s":"vst_usdt","id":"673314116332447297","a":[["137.73","1286"],["137.75","1386"],["137.77","1283"]],"b":[["137.69","1.35E+3"],["137.63","1393"],["137.61","1294"]]}}
```

The market-wide mark push, first three of 272 rows, run 3, P3.

```json
[{"s": "btc_usdt", "p": "82589.9", "t": 1791599495317}, {"s": "eth_usdt", "p": "2492.00", "t": 1791599495319}, {"s": "xrp_usdt", "p": "1.4063", "t": 1791599495320}]
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
- The trade page handled `user.balance`, `user.position` and `user.trade` pushes, S2.
- `wss://www.mgbx.com/ws/private` was opened by the web app, and its frames were not traced.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It only applies if MGBX grants consent for automated access, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://www.mgbx.com/ws/market`, one socket per contract, 274 sockets for the 274 contracts of 2026-10-10 UTC | `sub_symbol` replaces the socket's contract |
| markets per connection | 1 | same |
| connect | staggered, with a 6 s handshake timeout and a retry | TLS handshakes stall from this exit, section 1 |
| subscribe frame | `{"req":"sub_symbol","symbol":"<rawMarketId>"}` once per socket | the web app's frame |
| keepalive | text `ping` every 15 s, and answer a text `ping` with `pong` | the web app's rule. A subscribed socket survived 120 s without it, but an idle one died at 60 to 83 s |
| `max_silence` | 5 s | index and mark push every 500 ms and the longest book frame gap was about 1.1 s, so every frame counts as traffic |
| parse | accept the bare text frames `succeed`, `pong` and `Invalid parameter` before JSON parsing | they are not JSON |
| routing | `data.s` is the `rawMarketId` | every per-contract push carries it |
| snapshot | every `push.deep.full`: reset the book, and store `id` as a u64 | a snapshot is the exact book after its `id` |
| delta | apply only when `id` is above the stored id, then store it | deltas at or below the snapshot are already in it |
| resync | none on `id`, since no gap is visible. Drop the socket when no snapshot arrives for 5 s | the next snapshot heals a lost delta |
| unserved contract | log a contract with no snapshot 10 s after `succeed` | the socket acknowledges contracts it never serves |
| receive time | stamp on arrival | frames arrive a median of about 200 to 310 ms after their `t` |
| book age | `(id >> 22) + 1629702000000` is the venue time of the last change a snapshot includes | the snapshot has no `t` |
| sizes | parse the string as a float, times `contractSize` | scientific notation appears in snapshots |
| deflate | refuse it | the server does not negotiate it anyway |

The Rust feed builds one socket per `EndpointPlan`, which holds a URL and its markets, at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 40, and the venue sets `max_silence` at line 48.
274 plans of one market each fit that shape, and MGBX asked for no header.
274 sockets to one host were not tested, only 30 in runs 1 and 2.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | MGBX trade web app bundle `_app-2a873338ef1ad054.js`, HTTP 404 on 2026-10-09 | https://www.mgbx.com/trade/_next/static/chunks/pages/_app-2a873338ef1ad054.js | 2026-09-23 | MGBX Global | socket URLs, request names, `ping` every 15 s, 40 s reconnect, `pong` reply, kline subscribe, sections 1 to 3, 5 and 7 |
| S2 | MGBX trade page chunk `[symbolId]-3244f2d8a8f02602.js` | https://www.mgbx.com/trade/_next/static/chunks/pages/contract/trade/%5BsymbolId%5D-3244f2d8a8f02602.js | 2026-09-23 | MGBX Global | snapshot resets the book with `id` as its id, `user.*` pushes, sections 3 and 7 |
| S3 | MGBX help center, all 75 English articles through the Zendesk articles API | https://support.mgbx.com/api/v2/help_center/en-us/articles.json | 2026-10-09 | MGBX Global | no API or WebSocket documentation exists, the preamble |
| P1 | `ws-probe.py book`, run 3 and run 4 | [`ws-probe.py`](../../../scripts/probes/venues/mgbx/ws-probe.py) | 2026-10-10 02:31 UTC and the second pass | this host | sections 1, 2 and 4 |
| P2 | `ws-probe.py control`, run 3 and run 4 | [`ws-probe.py`](../../../scripts/probes/venues/mgbx/ws-probe.py) | 2026-10-10 02:29 UTC and the second pass | this host | sections 3 to 6 |
| P3 | `ws-probe.py bulk`, run 3 and run 4 | [`ws-probe.py`](../../../scripts/probes/venues/mgbx/ws-probe.py) | 2026-10-10 02:31 UTC and the second pass | this host | sections 2 and 6 |
| P4 | `ws-probe.py silence`, run 3 and run 4 | [`ws-probe.py`](../../../scripts/probes/venues/mgbx/ws-probe.py) | 2026-10-10 02:33 UTC and the second pass | this host | sections 3 and 5 |
| P5 | `ws-probe.mjs book`, `control`, `silence`, `fanout`, `deflate`, `bulk` and `mirror`, run 1 | [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs) | 2026-09-23 06:52 to 07:12 UTC | this host | the run 1 readings, the 30-socket fan-out and the Binance mirror |
| P6 | `ws-probe.mjs` all modes, run 2 | [`ws-probe.mjs`](../../../scripts/probes/venues/mgbx/ws-probe.mjs) | 2026-09-24 06:46 to 07:02 UTC | this host | the run 2 readings, the four-contract REST match and the delta and snapshot frames |
