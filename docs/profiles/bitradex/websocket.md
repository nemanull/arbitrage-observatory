# BitradeX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 between 06:48 and 06:53 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which Cloudflare placed at loc=CA, colo=YVR.

This profile covers the public futures socket of BitradeX, which carries its USDT-margined perpetuals.
BitradeX publishes no socket documentation, so the "documented" column below means what the www.bitradex.ai web app bundle does, S1.
Every probed value comes from [`ws-probe.mjs`](../../../scripts/probes/venues/bitradex/ws-probe.mjs), and topic names were found by trying candidates and keeping the ones that answered.

## 1. Endpoints

| family | URL, from the bundle | probed |
|---|---|---|
| USDT-M perpetuals, public | `wss://fws.bitradex.ai/public` | opened in 226 to 257 ms over six sockets, P1 to P4 |
| USDT-M perpetuals, private | `wss://fws.bitradex.ai/private` | not probed |
| spot, public and private | `wss://sws.bitradex.ai/public` and `/private` | not probed |

The bundle builds these as `getOrigin("fws",{ws:!0})+"/public"`, where `getOrigin` prefixes the page's own registrable domain, S1.
`fws.bitradex.ai` resolved to Cloudflare, 104.18.14.240 and 104.18.15.240 plus two IPv6 addresses, see [`rest.md`](./rest.md) section 1.
The handshake was accepted from the Canadian exit with no refusal.
The same host refuses the user agent `curl/8.14.1` on HTTPS with status 456 and body `xxx`, and a `curl` upgrade request to `/public` got the same 456, while `ws` from Node was accepted.

## 2. Channel matrix for public market data

| topic | payload | cadence probed | notes |
|---|---|---|---|
| `depth@<symbol>,20` | full book, 20 bids and 20 asks, `id` | about one frame a second per symbol, P1, P2 | snapshot, repeats the same `id` when nothing changed |
| `depth_update@<symbol>,100ms` | `pu`, `fu`, `u`, changed levels | only when the book changes, 34 frames in 45 s on `btc_usdt`, 146 on `xmr_usdt` | deltas, no snapshot |
| `depth_update@<symbol>` | acked | no frame arrived under its own event name in 20 s | |
| `depth_update@<symbol>,1000ms`, `depth@<symbol>,20,1000ms`, `depth@<symbol>,50,100ms` | no ack and no frame | | treated as unknown |
| `mark_price@<symbol>` | `{s, p, t}` | 22 frames in 20 s | |
| `index_price@<symbol>` | `{s, p, t}` | 22 frames in 20 s | |
| `agg_ticker@<symbol>` | last, 24 h fields, `i` index, `m` mark, `bp` and `ap` best prices | 22 frames in 20 s | |
| `agg_tickers` | the same for every symbol | 6 frames in 20 s | |
| `ticker@<symbol>`, `tickers` | last and 24 h fields | 21 and 6 frames in 20 s | |
| `trade@<symbol>` | `{s, p, a, m, t}` | 31 frames in 20 s on `btc_usdt` | |
| `fund_rate@<symbol>` | acked | no frame in 20 s | funding not verified on the socket |
| `funding_rate@<symbol>` | no ack | | |

All counts are from the `topics` run, P1, except the depth counts from the `book` run, P2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented (web app bundle, S1) | probed |
|---|---|---|
| endpoint split axis | one host per product line, `fws` futures and `sws` spot | only `fws` probed, all USDT-M symbols served on one socket |
| subscribe frame shape | `{"method":"subscribe","params":[topic]}` | `{"method":"subscribe","params":[...],"id":"1"}` with 20 topics in one frame got one ack, and all delivered, P3 |
| unknown symbol expectation | Not publicly specified | `depth_update@nope_usdt` and `nope@btc_usdt` got no reply at all, P1 |
| chunk unit and budget | Not publicly specified | 112 topics over 6 frames on one socket, all acked, P3 |
| keepalive mechanism | client sends text `ping` every 15 s, answers a server `ping` with `pong`, and reconnects after 40 s without traffic | text `pong` answered each `ping`. No server ping and no protocol ping seen in 70 s, P4 |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap reached in 70 s, no notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 6 subscribe frames in 600 ms |
| public market data authentication | none | none |
| message parse and routing | `event` routes, and a `depth_update` event is cut at its first comma | `{"topic","event","data"}`, `event` is the full topic, for example `depth_update@btc_usdt,100ms`, `data.s` is the symbol |
| subscribe acknowledgement shape | not read | `{"code":0,"msg":"success","id":"1"}` |
| symbol identifier format | lower case with underscore | `btc_usdt`, identical to REST `symbol` in `symbol/list` and to `s` in `q/agg-tickers` |
| number representation | not read | prices and sizes are strings. `id`, `pu`, `fu` and `u` are strings on the socket, while REST `q/depth` sends `u` as a JSON number |
| timestamp representation | not read | `t` in ms on deltas, marks, indexes and tickers. The `depth` snapshot carries no `t` |
| size unit | not read | contracts of `contractSize` coins, inferred, section 4 |
| sequence semantics | not read | `pu` equals the previous `u` and `fu` equals `pu` plus one, 0 gaps in 225 deltas on 3 symbols over 45 s and in 1,111 deltas on 49 symbols over 30 s, P2, P3 |
| idle repeat behaviour | not read | the `depth` snapshot repeats with an unchanged `id`, 71 of 135 snapshots in P2 and 1,215 of 1,704 in P3. `depth_update` sends nothing while the book is still, up to 15.9 s on `eth_usdt` |

## 4. The book channel in detail

The recommended pair is `depth@<symbol>,20` for the snapshot and `depth_update@<symbol>,100ms` for the deltas, both on one socket.

### Snapshot on subscribe

`depth_update` sends no snapshot, and its first frame arrived 0.6 to 2.7 s after the subscribe, P2.
`depth@<symbol>,20` sends a full 20 by 20 book about once a second, with an `id` that is the `u` of the last applied update.
On all three symbols of P2 the first delta had `pu` equal to the first snapshot's `id`, so the snapshot joins the delta chain directly, without a REST call.
A REST `q/depth?level=20` read 5 s into P2 returned `u` equal to the socket's last `u` on `btc_usdt` and `eth_usdt`, so the REST book is a second join point.

### Delta semantics

A delta carries `s`, `pu`, `fu`, `u`, `a`, `b` and `t`.
A size of `"0"` deletes the level.
No empty delta was seen, 0 of 225 in P2 and 0 of 1,111 in P3.

### Sequence and gap rule

```text
depth snapshot            replace the book, last = id
delta, pu = last          apply, last = u
delta, pu ≠ last          gap: resync
```

`fu` was `pu` plus one on every delta, and the rule held with 0 gaps in P2 and P3.
Whether the server ever skips ids between `pu` and `fu` is not known, because the socket does not document it.

### Checksum

None seen in any frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `depth` snapshot | descending on 3 of 3 symbols, P2 | ascending on 3 of 3 |
| `depth_update` | descending within each delta, 0 unordered arrays in P2 and P3 | ascending, 0 unordered |
| REST `q/depth` | descending at levels 5, 20, 50 and 1000 | ascending |

### Size unit against the catalog `contractSize`

`btc_usdt` has `contractSize` 0.0001, `quantityPrecision` 0 and `minQty` 1 in `symbol/list`, see [`rest.md`](./rest.md) section 2.
Its book sizes are whole numbers such as `"19488"` and `"20276"` at a price near 84,100, which is 1.95 and 2.03 BTC if the unit is contracts, and about 1.6 billion USDT if the unit were coins.
So the unit is contracts of `contractSize` coins.
That is an inference from the catalog, not a published rule.

### One-sided and empty books

No one-sided or empty book was seen among the 56 trading symbols.
7 of 56 symbols sent no delta in 30 s in P3, among them `trx_usdt`, `dydx_usdt` and `bera_usdt`, while their snapshots kept arriving.

### Idle repeats

The snapshot repeats once a second whether or not the book changed.
A feed that resets on every snapshot costs one reset a second per symbol and never goes silent.

### Unknown and closed symbols

| request | reply |
|---|---|
| `depth_update@nope_usdt` | nothing |
| `nope@btc_usdt` | nothing |
| `depth@btc_usdt,50,100ms` and other unknown forms | nothing |
| text `not json` | text `Invalid parameter`, and the socket stays open |

A closed symbol was not tried on the socket.
Because a bad topic is simply ignored, the feed has to notice a symbol with no snapshot on its own.

### Is the book the venue's own

At 06:56 UTC the best bid and ask in `q/agg-tickers` equalled Binance USDT-M `bookTicker` exactly on `btc_usdt`, `eth_usdt` and `sol_usdt`, and the median gap over 62 common symbols was 98 ppm on the bid and 203 ppm on the ask, see [`rest.md`](./rest.md) section 4.
The BTC book on BitradeX changed only 34 times in 45 s, while Binance BTC changes many times a second.
A touch that matches Binance to the tick while moving far less often suggests a book quoted by one maker off Binance prices.
That reading is an inference, and it would make any cross against Binance a lag artefact rather than a tradable edge.

## 5. Session

| item | bundle, S1 | probed |
|---|---|---|
| keepalive | text `ping` every 15 s, reconnect if nothing arrived for 40 s | text `pong` to each `ping`, P2, P4 |
| silence the server tolerates | Not publicly specified | a socket that subscribed nothing and sent nothing closed at 59,994 ms with code 1006. A socket that sent `ping` every 15 s stayed open for the full 70 s, P4 |
| forced disconnect | Not publicly specified | none in 70 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON only. A client offering permessage-deflate got no extension back, P5 |
| handshake | | 226 to 257 ms |
| subscription limits | Not publicly specified | 112 topics on one socket, no cap reached |
| throughput | | 56 symbols, both topics: 94 frames and 58.6 KB per second, P3 |

## 6. Captured frames

Trimmed, from P1 and P2 on 2026-09-24.

Subscribe and its acknowledgement.

```json
{"method": "subscribe", "params": ["depth_update@btc_usdt,100ms", "depth@btc_usdt,20"], "id": "1"}
```

```json
{"code": 0, "msg": "success", "id": "1"}
```

Snapshot, arrays cut to three levels.

```json
{"topic": "depth", "event": "depth@xmr_usdt,20", "data": {"s": "xmr_usdt", "id": "1452643518997", "a": [["560.11", "500"], ["560.12", "596"], ["560.13", "600"]], "b": [["559.92", "3120"]]}}
```

The first delta after it, with `pu` equal to the snapshot `id`.

```json
{"topic": "depth_update", "event": "depth_update@xmr_usdt,100ms", "data": {"s": "xmr_usdt", "pu": "1452643518997", "fu": "1452643518998", "u": "1452643519000", "a": [["560.11", "0"], ["560.12", "0"]], "b": [["559.92", "3120"]], "t": 1790232604578}}
```

Mark and index.

```json
{"topic": "mark_price", "event": "mark_price@btc_usdt", "data": {"s": "btc_usdt", "p": "84095.4", "t": 1790232541832}}
```

```json
{"topic": "index_price", "event": "index_price@btc_usdt", "data": {"s": "btc_usdt", "p": "84130.8", "t": 1790232541832}}
```

The keepalive is the bare text `ping`, answered by the bare text `pong`, and a non-JSON frame is answered by the bare text `Invalid parameter`.

## 7. Private channels

`wss://fws.bitradex.ai/private` is in the bundle with a listen key, S1, and was not probed.
The bundle's REST paths for orders sit under `/v1/future-u/trade/`, for example `order/create` and `order/cancel`.
Whether a user API key may call them is unclear, because `symbol/list` marks only 4 of 72 perpetuals `isOpenApi` true, see [`rest.md`](./rest.md) section 2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fws.bitradex.ai/public` | all USDT-M perpetuals on one host |
| topics | `depth@<id>,20` and `depth_update@<id>,100ms` per symbol | the snapshot joins the delta chain, 20 levels meets the engine's 20 |
| markets per connection | 56, all trading perpetuals | 112 topics ran with 0 gaps at 94 frames a second |
| subscribe frames | 10 symbols, 20 topics, per frame | the size P3 used |
| keepalive | text `ping` every 15 s | the web app's own period, and a silent socket dies at 60 s |
| `maxSilenceMs` | 20,000 | the snapshot arrives about every second, and `pong` counts as traffic |
| routing | `data.s` | the symbol id is plain |
| snapshot | on `topic` `depth`, `resetBook` from `a` and `b` and store `id` | joins the chain on 3 of 3 symbols |
| delta | apply only when `pu === last`, then store `u` | 0 gaps observed |
| resync | `pu !== last`, or a delta before any snapshot: `resync` | the engine's existing path |
| ids | compare as strings or `BigInt`, never add | ids are strings near 1.45e12 |
| unserved topic | log a symbol with no snapshot 5 s after subscribe | bad topics get no reply |
| receive time | stamp on arrival | the snapshot has no timestamp |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| user agent | send one that is not `curl` | the HTTPS side answers `curl/<version>` with 456 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | www.bitradex.ai `_app` bundle, socket class and URL builder | `https://static3.bitradex.mobi/web/web/_next/static/chunks/pages/_app-759ef86c4e08dba3.js` and `_app-162d08fa1081a2f4.js` | 2026-09-24 | BitradeX | URLs, subscribe frame, ping period, 40 s reconnect, routing on `event` |
| P1 | `ws-probe.mjs topics` at 06:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitradex/ws-probe.mjs) | 2026-09-24 | this host | sections 2, 3, 4, 6 |
| P2 | `ws-probe.mjs book` at 06:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitradex/ws-probe.mjs) | 2026-09-24 | this host | sections 3, 4, 6 |
| P3 | `ws-probe.mjs batch` at 06:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitradex/ws-probe.mjs) | 2026-09-24 | this host | sections 3, 4, 5 |
| P4 | `ws-probe.mjs silence` at 06:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitradex/ws-probe.mjs) | 2026-09-24 | this host | section 5 |
| P5 | `ws-probe.mjs deflate`, two runs at 06:51 and 06:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitradex/ws-probe.mjs) | 2026-09-24 | this host | section 5 |
