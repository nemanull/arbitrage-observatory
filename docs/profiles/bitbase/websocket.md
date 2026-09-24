# Bitbase WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 06:44 to 07:08 UTC, which is the evening of 2026-09-22 on the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, edges `YVR` and `SEA`).

This profile covers the public futures WebSocket of Bitbase (www.bitbase.com, no CCXT class) for its two perpetual families, with the book channel in detail.
Bitbase publishes no API documentation, so every URL, channel and rule below was taken from the Bitbase web app and then captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs).
The web app is the XT.com code base: its bundle names its socket clients `@xtbase/XtSocket` and `@xtbase/XtSocketFuture` and logs `【WS XT4 open】`, S1.
The wire protocol matches what CCXT Pro 4.5.68 implements for XT futures, S2, so that file is quoted in the documented column as the nearest reference, and every such cell says so.
The REST side of the same host refuses this host with a Cloudflare challenge, see [`rest.md`](./rest.md) section 1, and the sockets do not.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M and USDC-M perpetuals, public | `wss://fstream.bitbase.com/ws/market`, built by the web app as `getOrigin("fstream",{ws:!0})+"/ws/market"`, S1 | open in 420 to 466 ms over eight opens, HTTP 101 with no extension header |
| perpetuals, private | `wss://fstream.bitbase.com/ws/user`, S1 | HTTP 101 on a bare upgrade with curl, not subscribed |
| spot, public | `wss://stream.bitbase.com/public`, S1 | open in 413 to 430 ms, one `depth@btc_usdt,20` subscribe answered, context only |
| spot, private | `wss://stream.bitbase.com/private`, S1 | a bare upgrade got HTTP 403 with `cf-mitigated: challenge`, not pursued |

One socket carries both perpetual families.
The `agg_tickers` stream on one `/ws/market` socket carried 761 `_usdt` and 34 `_usdc` rows in every frame, P1.
No USDC book stream was subscribed, so a USDC book on the same socket is Not verified.
Every other socket path tried answered a Cloudflare challenge or HTTP 404, P7.
On `stream.bitbase.com`, `/ws/future` and `/ws/public` gave 404, and `/market` and `/futures` gave 403 with `cf-mitigated: challenge`, and the bare `https://fstream.bitbase.com/` gave the same challenge.
`fstream.bitbase.com` and `stream.bitbase.com` are Cloudflare CNAMEs on 104.18.4.232 and 104.18.5.232, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `depth_update@<symbol>` | deltas `{s, pu, fu, u, a, b, t}` | default `100ms`, also `250ms` and `1000ms` as `depth_update@<symbol>,<speed>` | 407 to 533 deltas per book in 60 s, chained by `pu`, recommended |
| `depth@<symbol>,<levels>` | full book `{s, id, a, b, t}` | levels 5, 10, 20 or 50, one frame a second | exactly 50 levels per side on every snapshot, recommended beside the deltas |
| `ticker@<symbol>` | 24 h stats `{s, o, c, h, l, a, v, r, t}` | about once a second | 1 or 2 frames in each 1.2 to 1.5 s case window on BTC |
| `agg_ticker@<symbol>` | the ticker plus index `i`, mark `m`, best bid `bp`, best ask `ap` | about once a second, gap median 998 ms | 47 frames in 45 s and 67 in 65 s per symbol |
| `tickers` | ticker rows for the symbols that changed | about every 3 s | 278 to 550 rows per frame |
| `agg_tickers` | agg_ticker rows for every perpetual | every 2.8 to 3.0 s | all 795 perpetuals in every one of 15 and 21 frames |
| `index_price@<symbol>` | `{s, p, t}` | about once a second, each value sent twice about 30 ms apart | 130 frames and 59 to 64 changes in 65 s |
| `mark_price@<symbol>` | `{s, p, t}` | on change | gap median 287 to 1,040 ms, longest 7,530 ms |
| `fund_rate@<symbol>` | `{s, r, t}` | once a minute | pushed at 07:05:00.53 and 07:06:00.53 UTC on `btc_usdt` |
| `trade@<symbol>`, `kline@<symbol>,<interval>` | | | named in CCXT Pro `xt.js` lines 438 and 393, S2, not probed |

`mark_price` without a symbol answers `Invalid method`, P3, and `index_price` without a symbol did the same in a first exploratory connect, so no all-symbol mark or index topic exists.
`agg_tickers` is the only bulk topic with index and mark, and [`rest.md`](./rest.md) section 3 treats it as the anchor source.
No topic carries the funding interval or the next settlement time.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Bitbase documents none of them, so the documented column quotes the XT reference in CCXT Pro 4.5.68 where it has one.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none published. XT reference: one contract URL `wss://fstream.xt.com/ws` plus `/market` or `/user`, S2 lines 36, 37 and 196 to 203 | one public URL for USDT-M and USDC-M, one private URL, section 1 |
| subscribe frame shape | none published. XT reference: `{"method": "SUBSCRIBE", "id": <id>, "params": [<topic>]}`, S2 lines 172 to 188 | `{"id":"p1","method":"SUBSCRIBE","params":[…]}` with 150 topics in one frame got one ack and all 150 delivered. Lower case `subscribe` also works |
| unknown symbol expectation | none published | a bare text frame `Invalid method` with no id, and the socket stays open |
| chunk unit and budget | none published | 150 topics in one frame, one ack in 102 and 103 ms, all delivering. No cap reached |
| keepalive mechanism | none published. XT reference: the client sends text `ping`, S2 line 1438, and the server answers an event `pong`, line 1403 | text `ping` answered by text `pong` in 99 to 115 ms. No server protocol ping on any socket |
| connection lifetime and maintenance notice | none published. Maintenance is announced in the help center, see [`fees.md`](./fees.md) section 7 | a socket with no client frame closed with 1006 and no close frame at 31.8, 35.7, 35.7, 40.1 and 41.2 s. Sockets that pinged every 15 or 20 s stayed open 60 to 100 s. No notice frame seen |
| handshake and operation rate limits | none published | no refusal at 150 topics in one frame, or at 15 invalid subscribes in 7.5 s |
| public market data authentication | none | none |
| message parse and routing | none published. XT reference: `{topic, event, data}`, routed on `topic` and `data.s`, S2 lines 1401 to 1436 | `{"topic","event","data"}`. `event` is `<topic>@<symbol>[,<param>]` and `data.s` is the symbol |
| subscribe acknowledgement shape | none published | `{"code":0,"msg":"success","id":"p1","sessionId":"…"}` for success. A frame with no `method` got `{"code":1,"id":"nm","sessionId":"…"}` |
| symbol identifier format | none published | lower case `btc_usdt`, `eth_usdc`. `BTC_USDT` is refused with `Invalid method` |
| number representation | none published | prices and sizes are strings, and one price can arrive spelled two ways, `"2753.7"` in a snapshot and `"2753.70"` in a delta |
| timestamp representation | none published | `data.t` in integer ms. Book frames arrive a median 250 to 300 ms after their `t` |
| size unit | none published | contracts, one contract being the archived `contractSize` in coins, section 4 |
| sequence semantics | none published. XT reference: CCXT Pro caches deltas and loads a REST snapshot, S2 lines 1074 to 1082 | `pu` equals the previous `u` on every delta, and `fu` is `pu` plus one. 0 gaps in 3,843 deltas on eight book streams and in 98,264 frames on 150 streams |
| idle repeat behaviour | none published | no book was idle. The quietest book probed, `toad_usdt` with 11,720 USD of 24 h volume, sent 305 frames in 35.7 s and never went 310 ms without one |

## 4. The book channel in detail

The recommended pair is `depth_update@<symbol>` for deltas and `depth@<symbol>,50` for a snapshot, on one socket.
Every row below is about that pair unless it says otherwise.

### Snapshot on subscribe

`depth_update` sends no snapshot, only deltas, from 121 to 320 ms after the subscribe frame.
`depth@<symbol>,50` sends a full 50 level book with its update `id` once a second, whether or not anything changed nearby.
The first snapshot came 332 to 1,338 ms after the subscribe frame in the two runs, since the topic pushes on its own one second grid.
The snapshot gap had a median of 1,000 ms, a minimum of 988 to 989 ms and a maximum of 1,012 to 1,013 ms in the two runs, and reached 2,008 ms once in a development run at 06:47 UTC.
A trailing speed on the snapshot topic is ignored: `depth@xrp_usdt,50,100ms` was acknowledged and delivered as `depth@xrp_usdt,50` once a second, P3.

### Delta semantics

A delta carries `pu`, `fu` and `u` as decimal strings, and `a` and `b` arrays of `[price, size]` strings.
A size is the absolute size at that price, and `"0"` deletes the level.
No delta was empty in either run.
One delta held up to 80 to 111 levels on a side on BTC and ETH, and up to 5 to 34 on the thinner books.

### Sequence and gap rule

```text
keep the deltas as they arrive, and wait for the first depth snapshot, id = S
drop buffered deltas with u <= S
the first remaining delta must have fu <= S + 1, else the snapshot is older than the buffer: wait for the next snapshot
apply it and every later delta while pu = last u
pu != last u: gap, resync
```

The snapshot `id` is always either equal to some delta's `u` or inside one delta's range, `fu <= id < u`.
Of 59 BTC snapshots, 7 equalled a `u` and 52 fell inside a delta in the first run, and 12 and 47 in the second, P2.
On the thinner books most snapshots equalled a `u`, 44 to 47 of 59.
Applying the delta that straddles the snapshot is safe, because each level carries its absolute size as of that delta's `u`.

A book seeded once from the first snapshot and then fed every delta was compared with each later snapshot at the same `id`, top 20 levels per side by numeric price.
It matched on every comparison, 104 of 104 over four books in the first run and 110 of 110 in the second, P2.
One ETH book in the second run had to reseed once, because its first snapshot arrived 332 ms after the subscribe and predated the first buffered delta.
`pu` equalled the previous `u` on every delta: 0 gaps in 1,939 deltas in the first run and 1,904 in the second, on BTC, ETH and two thinner books.

### Checksum

None, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of eight books | best first, ascending, on every snapshot |
| delta | descending within the frame, 0 exceptions | ascending within the frame, 0 exceptions |

A feed still applies deltas by price, because a delta names only the levels that changed.

### Price spelling

The same price is not always spelled the same way.
ETH snapshot `id` 1790129066451 spelled a level `"2753.7"`, and the delta with `u` 1790129066377 spelled it `"2753.70"`, P2.
Over 60 s, ETH had 161 and 315 such second spellings, `tfuel_usdt` 135, and BTC none.
A book keyed by the price string keeps two levels for one price, so a feed parses the price with `Number()` before it keys the level.

### Level window

Every snapshot held exactly 50 bids and 50 asks, on BTC and ETH and on `flex_usdt` and `tfuel_usdt`, which traded 39,000 and 28,000 USD in 24 h.
The deltas keep the kept book equal to the snapshot through the top 20, see the gap rule above.

### Size unit against the contract size

The size is in contracts.
The archived web app catalog gives `contractSize` `"0.0001"` for `btc_usdt`, `"0.001"` for `eth_usdt` and `"0.01"` for `sol_usdt`, see [`rest.md`](./rest.md) section 2.
The live `tickers` stream agrees: 24 h turnover in USDT over 24 h amount over the last price gives 0.0000996 to 0.0000998 BTC and 0.000997 to 0.000999 ETH per contract, P1.
The same estimate agreed within a factor of two with the archived `contractSize` for 678 and 644 symbols, and disagreed for none, see [`rest.md`](./rest.md) section 2.
A BTC touch of `"32273"` contracts at 86,415.2 is therefore 3.2273 BTC.
Contract sizes run from 0.0001 to 1,000,000 coins across the catalog, so a feed cannot work without a per contract size.

### One-sided and empty books

No live book was one-sided or empty.
The delisted `icx_usdt` and `rcat_usdt` were acknowledged as success and then sent a sentinel delta every few seconds with `"b":[["0","0"]]` and `"a":[]`, P3.
A feed that applies it deletes a level at price 0 that does not exist, which is harmless, but the stream is acknowledged and dead.

### Idle repeats

No repeat was seen, since no book was idle.
The snapshot `id` never repeated in 59 or 60 snapshots per book.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `depth_update@nope_usdt` | `Invalid method`, a bare text frame | nothing |
| `depth@nope_usdt,50` | `Invalid method` | nothing |
| `depth_update@BTC_USDT` | `Invalid method` | nothing |
| `depth@sol_usdt,30` and `depth@sol_usdt,100` | `Invalid method` | nothing |
| `nonsense@btc_usdt` | `Invalid method` | nothing |
| `mark_price`, no symbol | `Invalid method` | nothing |
| `depth_update@icx_usdt`, delisted 2026-09-18 | success | one sentinel delta every few seconds |
| `depth_update@pipedog_usdt`, close-only until 2026-09-25 | success | a normal book, 17 and 18 deltas in 2.2 s |
| `["depth_update@ltc_usdt", "depth_update@nope_usdt", "depth_update@link_usdt"]` in one frame | `Invalid method` | `ltc_usdt` delivers and `link_usdt` does not |
| the same topic twice | success | one stream |
| a frame with no `method` | `{"code":1,"id":"nm","sessionId":"…"}` | |
| `hello`, not JSON | `Invalid parameter` | the socket stays open |
| 15 invalid subscribes, one per 500 ms | 15 `Invalid method` | the socket stays open |

An unknown symbol inside a batch drops every topic after it and names nothing, since `Invalid method` carries no id.
So a feed has to screen its topics against a live symbol list before it subscribes, and notice a topic that never delivers.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | none published | text `ping`, answered by text `pong` in 99 to 115 ms. No protocol ping from the server |
| silence the server tolerates | none published | a socket that sends no frame after its subscribe closes with 1006 and no close frame at 31.8 to 41.2 s, subscribed and busy or not, five sockets over three runs. A text ping every 15 or 20 s kept every socket open, subscribed or not, including one that unsubscribed its only topic |
| forced disconnect | none published | none in 100 s |
| maintenance notice | help center announcements, six futures windows in September 2026 at 23:00 UTC | no frame announcing one was seen |
| compression | none published | text JSON frames. The server grants `permessage-deflate; client_no_context_takeover; server_no_context_takeover` when a client offers it, and nothing when the client does not, P6 |
| handshake | none published | 420 to 466 ms to open a futures socket |
| subscription limits | none published | 150 topics in one frame, all delivering. No cap reached |
| throughput | | 150 USDT perpetuals, every fifth by 24 h volume, `depth_update` at 100 ms: 1,116 and 1,067 frames per second, peak 1,235, 343 and 301 KB per second, 307 and 282 bytes per frame, 11.0 and 7.8 µs `JSON.parse` per frame, P5 |
| event lag | | book frames arrive a median 250 to 300 ms after `data.t`, p90 350 to 767 ms. Medians for `mark_price` 94 to 120 ms, `agg_ticker` 221 to 243 ms, `index_price` 407 to 648 ms. The local clock is NTP synchronised |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
The `sessionId` values are cut to `…`.

Subscribe, deltas and a 50 level snapshot for one symbol in one frame.

```json
{"id": "p1", "method": "SUBSCRIBE", "params": ["depth_update@btc_usdt", "depth@btc_usdt,50"]}
```

Acknowledgement, one per frame.

```json
{"code": 0, "msg": "success", "id": "p1", "sessionId": "…"}
```

Snapshot, first three levels per side kept.

```json
{"topic":"depth","event":"depth@btc_usdt,50","data":{"s":"btc_usdt","id":"1790128649832","a":[["86415.2","32273"],["86415.3","2082"],["86415.4","4080"]],"b":[["86415.1","46205"],["86415.0","1280"],["86414.9","3299"]],"t":1790146221416}}
```

Delta, with a deleted ask.

```json
{"topic":"depth_update","event":"depth_update@btc_usdt,100ms","data":{"s":"btc_usdt","pu":"1790128665379","fu":"1790128665380","u":"1790128665411","a":[["86440.6","0"],["86440.7","5419"]],"b":[["86440.5","9783"],["86440.4","4790"]],"t":1790146265805}}
```

Delta spelling `2753.70`, which the next ETH snapshot spelled `2753.7`.

```json
{"topic":"depth_update","event":"depth_update@eth_usdt,100ms","data":{"s":"eth_usdt","pu":"1790129066340","fu":"1790129066341","u":"1790129066377","a":[["2753.53","49853"],["2753.54","4808"],["2753.70","6635"]],"b":[["2753.52","49286"],["2753.51","9727"]],"t":1790146218155}}
```

Sentinel delta of a delisted contract.

```json
{"topic":"depth_update","event":"depth_update@icx_usdt,100ms","data":{"s":"icx_usdt","pu":"1790147211666","fu":"1790147211667","u":"1790147211667","a":[],"b":[["0","0"]],"t":1790147211666}}
```

Keepalive, both text frames.

```text
ping
pong
```

Errors, each a bare text frame.

```text
Invalid method
Invalid parameter
```

Anchor topics.

```json
{"topic":"agg_ticker","event":"agg_ticker@btc_usdt","data":{"s":"btc_usdt","o":"85401.7","c":"86464.3","h":"87247.3","l":"85136.8","a":"38954673","v":"38954673","r":"0.0124","i":"86505.903314400000","m":"86464.3","bp":"86464.3","ap":"86464.4","t":1790146287610}}
```

```json
{"topic":"index_price","event":"index_price@btc_usdt","data":{"s":"btc_usdt","p":"86427.273872900000","t":1790147099242}}
```

```json
{"topic":"mark_price","event":"mark_price@eth_usdt","data":{"s":"eth_usdt","p":"2750.95","t":1790147100080}}
```

```json
{"topic":"fund_rate","event":"fund_rate@btc_usdt","data":{"s":"btc_usdt","r":"-0.00000257","t":1790147100532}}
```

## 7. Private channels

Named for a future execution stage, not probed.

- Futures: `wss://fstream.bitbase.com/ws/user`, S1, subscribed in the XT scheme with `<topic>@<listenKey>` for `order`, `trade`, `balance` and `position`, S2 lines 183, 535, 562, 586 and 614.
- Spot: `wss://stream.bitbase.com/private`, S1.
- The listen key comes from an authenticated REST call, which on Bitbase would sit behind the same Cloudflare challenge as every other REST path.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only useful once the catalog and anchor blockers in [`rest.md`](./rest.md) section 8 are solved.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fstream.bitbase.com/ws/market`, for both USDT-M and USDC-M | one socket carries both families |
| channels | `depth_update@<rawMarketId>` and `depth@<rawMarketId>,50` | deltas every 100 ms chained by `pu`, and a 50 level snapshot every second to seed and reseed |
| markets per connection | 150 | 150 streams ran with 0 gaps at about 1,100 frames per second. Two topics per market double the topic count, which is untested beyond 8 topics |
| subscribe frames | one frame per slice, `{"id": <n>, "method": "SUBSCRIBE", "params": [...]}`, built only from symbols seen in `agg_tickers` | an unknown symbol silently drops the rest of its frame |
| keepalive | text `ping` every 15 s | the server sends no ping and drops a socket that has not sent a frame for 31.8 to 41.2 s |
| `maxSilenceMs` | 10,000 | every book, even at 11,720 USD of daily volume, sent a frame at least every 310 to 400 ms, and the pong adds traffic every 15 s |
| routing | `data.s` is the `rawMarketId`, and `topic` picks snapshot or delta | the event string also carries the speed suffix |
| snapshot | seed from the first `depth` frame whose `id` is at or after the first buffered delta's `pu`, then drop deltas with `u <= id` | section 4 |
| delta | apply only when `pu === lastU`, then store `u` | 0 gaps in every run |
| resync | a delta whose `pu` is not the last `u`, or no snapshot after 5 s: `resync`, which terminates the socket and resubscribes | the engine's existing path. A snapshot every second also bounds any drift |
| prices | `Number()` before keying a level | one price arrives in two spellings |
| sizes | `Number()` times the contract size | sizes are contracts |
| receive time | stamp on arrival, never from `t` | frames arrive 250 to 300 ms after `t` |
| deflate | keep `perMessageDeflate: false` | the server only compresses when asked |
| dead streams | drop symbols missing from `agg_tickers` before subscribing, and log a topic with no frame 5 s after its ack | a delisted symbol is acknowledged and sends only a sentinel |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbase web app bundle `_app-39a7415dfa07af57.js`, 1.8 MB | https://www.bitbase.com/cdn/assets/ssr-web-trade/_next/static/chunks/pages/_app-39a7415dfa07af57.js | 2026-09-23 | Bitbase | socket URLs through `getOrigin`, the XT code base names, the private URLs |
| S2 | CCXT Pro 4.5.68 `xt.js` | `server/node_modules/ccxt/js/src/pro/xt.js` | 2026-09-23 | CCXT, XT.com | the XT protocol used as the nearest documented reference |
| S3 | Wayback Machine copy of the Bitbase trade page, 2026-08-16 | https://web.archive.org/web/20260816173033/https://www.bitbase.com/en/trade/portal_usdt | 2026-09-23 | Bitbase | the name of the bundle in S1 |
| P1 | `ws-probe.mjs catalog`, runs at 06:44 and 07:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | families on one socket, `tickers` and `agg_tickers` cadence, contract size by turnover |
| P2 | `ws-probe.mjs book`, runs at 06:50 and 07:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | section 4 |
| P3 | `ws-probe.mjs errors`, runs at 06:54, 06:56 and 07:06 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | levels, speeds, error replies, delisted symbols, spot socket |
| P4 | `ws-probe.mjs anchor`, runs at 06:51 and 07:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | index, mark, funding and `agg_tickers` topics |
| P5 | `ws-probe.mjs batch`, runs at 06:59 and 07:07 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | throughput, 150 streams |
| P6 | `ws-probe.mjs silence` at 06:57 and 07:08 UTC, and `deflate` at 07:00 and 07:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbase/ws-probe.mjs) | 2026-09-23 | this host | keepalive, silence, compression |
| P7 | curl upgrade requests to candidate paths, 06:36 to 06:40 UTC | not scripted | 2026-09-23 | this host | which socket paths exist, section 1 |
