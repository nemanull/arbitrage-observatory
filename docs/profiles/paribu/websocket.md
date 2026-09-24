# Paribu WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:34 to 04:50 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

This profile covers the public spot WebSocket of Paribu, which has no CCXT class, because Paribu lists no perpetual on its own exchange, see [`fees.md`](./fees.md) section 3.
Two public endpoints exist: the "WebSocket API" of 2026, which the documentation marks as beta, and the older "Stream API".
The newer one is the book feed this profile recommends, and the older one is recorded for completeness.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) and is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Total socket wall time for this venue was about eleven minutes over both passes.

## 1. Endpoints

| endpoint | URL | documented | probed |
|---|---|---|---|
| public, newer | `wss://api.paribu.com/v1/wapi/stream` | "Beta: This WebSocket API is under active development. The wire format and channel names may change before general availability.", S1 | opened in 484 to 747 ms on 17 sockets, answered with 101 through Cloudflare's `SEA` edge |
| public, older | `wss://api.paribu.com/stream` | "Up to 100 hub connections per client", ping every 30 s, S3 | opened in 506 and 622 ms |
| private, newer | `wss://api.paribu.com/v1/wapi/user` | API key headers on the upgrade, S1 | not probed |
| private, older | `wss://api.paribu.com/stream/user` | S3 | not probed |

There is one product, spot, so there is no split by family.
One socket carries TRY and USDT markets alike, P1.
The CCXT pull request that adds Paribu uses the newer public endpoint for books and the older one for the 24 h ticker, which the newer one lacks, see [`fees.md`](./fees.md) section 8.

## 2. Channel matrix for public market data

| endpoint | channel | payload | documented cadence | probed |
|---|---|---|---|---|
| newer | `orderbook:<market>` | snapshot, then diffs, then heartbeats while idle | one diff per book change, heartbeat about every 5 s while idle, S2 | snapshot of up to 100 levels per side, 0 gaps, section 4. Recommended |
| newer | `book-ticker:<market>` | best bid and ask with sizes and a state id `u` | on change at most once per second, plus a re-send about every 5 s, S2 | 10 to 43 frames per market in 45 s, busy markets about 1 per s, quiet ones every 5 s |
| newer | `match-price:<market>` | last trade price and time | after each trade, S2 | one frame per trade, 0 to 7 per market in 45 s |
| newer | `matches:<market>` | one frame per fill, with an id, price, size and taker side | per trade, S2 | arrives 6 or 7 ms before the matching `match-price` frame |
| older | `orderbook-diff:<market>` | diffs keyed by price, synchronised with the REST book `seq` | not stated, S4 | 130 and 17 diffs on `btc_tl` in 20 s, 0 gaps and 0 duplicates in the second run |
| older | `ticker24h:<market>` | 24 h statistics | "updated every second", S3 | 42 and 41 frames in 20 s on `btc_tl` |
| older | `book-ticker:<market>` | best bid and ask, no sizes, RFC 3339 time | on change, S3 | 97 and 1 frames in 20 s on `btc_tl` |
| older | `matches:<market>` | one frame per trade | on trade, S3 | 2 and 0 frames in 20 s |
| older | `orderbook:<market>` | not described | "Order book for USDT/TRY, updated every 100ms", S3 | refused with code 201 in both runs, read from the order of the replies, section 6 |

No channel carries an index, a mark or a funding rate, since there is no derivative.
`trades:<market>` on the newer endpoint answers code 2001 `unknown channel`, P3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md), for the newer public endpoint.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for every market, S1 | TRY and USDT markets on one socket, P1 |
| subscribe frame shape | `{"method": "subscribe", "channels": ["orderbook:btc_tl"], "id": "req_1"}`, at most 64 channels per frame, S1 | 64 channels per frame acknowledged, 65 answered code 3006 `channels list too long`, P3 and P4 |
| unknown symbol expectation | code 2003 `unknown market: <channel>`, permanent, S1 | `orderbook:nope_tl` answered 5004 `market inventory unavailable` in the first run and 2003 `unknown market` in the second. `orderbook:nope2_tl` and the suspended `orderbook:agix_tl` answered 5004 in both. The pre-launch `orderbook:ton_tl` was acknowledged and sent an empty snapshot, P3 |
| chunk unit and budget | 256 subscriptions per connection by default (code 2005), 64 channels per frame, 10 subscribe requests per second (code 3007), S1 | 331 channels on one socket, 267 books and 64 book tickers, were all acknowledged with no 2005. Twelve subscribe frames sent in one burst were all acknowledged with no 3007, P3 and P4 |
| keepalive mechanism | "Server sends a ping every 20 seconds. If no pong is received within 30 seconds, the connection is closed with WS close code `4002`.", S1 | protocol pings 30.5 to 30.7 s after the socket was created and every 30 s after that, on every socket that logged them. A socket that did not answer the first ping closed about 11 s later, at 41.5 and 41.6 s, with code 1006 and no close frame, four times over two runs, P5 |
| connection lifetime and maintenance notice | "A connection can close at any time, sometimes with no status code", code 5003 `server shutting down` before a routine restart, S1 | no forced close and no 5003 seen in sockets held up to 110 s |
| handshake and operation rate limits | 10 subscribe requests per second, S1 | no refusal seen, opens took 484 to 747 ms |
| public market data authentication | none, S1 | none |
| message parse and routing | flat envelope `{e, E, s, r}` with the sub-type in `r.t`, S1 | as documented. Book frames carry `e` `orderbook`, and `matches` frames carry `e` `order`, so routing on `r.t` and `s` is the safe key |
| subscribe acknowledgement shape | `{"e": "status", "E": …, "r": {"t": "subscribed", "id": "req_1", "channels": […]}}`, S1 | as documented. One acknowledgement covers every accepted channel of a frame, and each failed channel adds its own error frame |
| symbol identifier format | `base_quote` lowercase, TRY spelled `tl`, S5 | `btc_tl`, `btc_usdt`. Uppercase `orderbook:BTC_TL` answers 2002 `malformed channel string`, P3 |
| number representation | decimal strings, S2 | prices and sizes are strings, `sq`, `u`, `E` and `T` are JSON integers |
| timestamp representation | `E` in Unix ms, S1 | `E` in ms. Local receive time minus `E` had a median of 83 to 85 ms in the first book run and 100 to 102 ms in the second, P1 |
| size unit | base currency quantity, S2 | base currency, 20 of 20 top bids equal the REST book at the same price, section 4 |
| sequence semantics | `sq` per market, `r.sq == localSeq + 1` applies, `<=` drops, `>` is a gap, S2 | 0 gaps and 0 drops over 1,193 and 994 diffs in the book runs and over 24,140 and 25,741 diffs in the batch runs, P1 and P4 |
| idle repeat behaviour | a heartbeat restating `sq` about every 5 s while a book is idle, S2 | heartbeats with median gaps of 5,011 to 5,015 ms on quiet books, every heartbeat `sq` equal to the local sequence, P1 |

## 4. The book channel in detail

`orderbook:<market>` on `wss://api.paribu.com/v1/wapi/stream` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame per market is `r.t` `"snapshot"` with `b`, `a` and `sq`, S2.
In the two book runs every one of five markets got exactly one snapshot, 179 to 198 ms after the subscribe frame was sent, except `wal_tl` at 336 ms in the first run, and no later snapshot in 75 s, P1.
The snapshot can arrive before the acknowledgement: the first run's acknowledgement came 336 ms after the subscribe frame, after four of the five snapshots.
The batch runs received all 257 and all 267 snapshots within 1,152 and 1,189 ms of the first subscribe frame, P4.

### Delta semantics

A diff carries `b` and `a` arrays of `[price, size]` string pairs and the next `sq`.
A size of `"0"` deletes the level, and any other size replaces it, S2.
No diff arrived with both arrays empty, and no deletion named a price the local book did not hold, P1.
A single diff often carries several levels: 1,126 of 1,195 captured diffs of the first book run had more than one level, up to 15.

### Sequence and gap rule

```text
snapshot                   replace the book, last = sq
diff, sq = last + 1        apply, last = sq
diff, sq <= last           drop (documented overlap or redelivery)
diff, sq > last + 1        gap: the server closes with 4003, resubscribe for a fresh snapshot
heartbeat, sq = last       the book is current, apply nothing
heartbeat, sq != last      a diff was missed, resubscribe
close 4003 on any orderbook subscription   resubscribe
```

The rule held on every frame of every run, with 0 gaps, 0 drops and 0 heartbeat mismatches.
The first diff after each snapshot had `sq` equal to the snapshot's `sq` plus one on all ten book-run markets, P1.
The `sq` of this channel is not the REST book's `seq`: at the end of the first run `btc_tl` read `sq` 47,063,651 on the socket and `seq` 34,081,280 on REST, and `usdt_tl` read 1,949,189 against 1,508,873.
The REST `seq` belongs to the older `orderbook-diff` stream, whose diffs read `seq` 34,082,237 and 34,083,997 in the two legacy runs while REST read 34,081,280 to 34,084,059 over the same half hour, P6 and [`rest.md`](./rest.md) section 5.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 5 of 5 markets in both book runs and on all 267 in the second batch run | best first, ascending |
| diff | unordered: 50 and 44 `btc_tl` bid arrays of more than one level were not descending, and 117 and 143 on `eth_tl` | unordered: 135 and 146 on `btc_tl`, 158 and 185 on `eth_tl` |
| REST `/orderbook` | descending at 20 and 100 levels | ascending |

A feed applies diffs by price and never by position.

### Level window

Snapshots held at most 100 levels per side.
`btc_tl`, `eth_tl` and `btc_usdt` snapshots were 100 and 100, `usdt_tl` 100 bids and 82 then 81 asks, and `wal_tl` 30 then 31 bids and 100 asks, P1.
A book kept from the snapshot and every diff never held more than 100 levels on a side over 75 s, so the stream maintains a 100 level window and sends a level leaving it as a deletion.
Across all 267 open markets the snapshot bid count had a median of 43 and a minimum of 21, and the ask count a median of 100 and a minimum of 19, P4.
One market of 267 had fewer than 20 levels on a side.

### Size unit

Sizes are base currency quantities, and a spot market has no contract size.
At the end of both book runs the top 20 bids of the socket book equalled the REST `/orderbook?limit=100` book in price and size on 20 of 20 levels, on `btc_tl` and `usdt_tl`, and the price strings were identical, P1.

### One-sided and empty books

No open market had an empty side at the end of the second batch run, and none was crossed, P4.
The pre-launch `ton_tl` answered with a snapshot whose `b` and `a` were both empty arrays, P3.
The documentation says a book that has no diff stream yet gets no heartbeat, S2.

### Idle repeats

No diff is repeated.
A quiet book sends a heartbeat about every 5 s, and the heartbeat restates `sq`: `usdt_tl` sent 14 and 11 heartbeats in 75 s, `wal_tl` 7 and 11, all equal to the local sequence, with median gaps of 5,011 to 5,015 ms and a minimum of 5,000 ms, P1.
The longest silence of any market in the batch runs was 5,070 ms, so the heartbeat caps silence per market near 5 s, P4.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `orderbook:nope_tl` | first run 5004 `market inventory unavailable: orderbook:nope_tl`, second run 2003 `unknown market: orderbook:nope_tl` | nothing |
| `orderbook:nope2_tl` beside `book-ticker:eth_tl` | an acknowledgement for `book-ticker:eth_tl` only, and 5004 for the book | the book ticker delivers |
| `orderbook:agix_tl`, suspended and unlisted | 5004 `market inventory unavailable` | nothing |
| `orderbook:ton_tl`, pre-launch | acknowledged | an empty snapshot |
| `orderbook:BTC_TL` | 2002 `malformed channel string` | nothing |
| `trades:btc_tl` | 2001 `unknown channel` | nothing |
| `orders` on the public URL | 2004 `channel not available on this endpoint` | nothing |
| a channel already subscribed | acknowledged again with no error, as documented | |
| unsubscribe of a channel never subscribed | acknowledged as `unsubscribed` | |

The documentation calls 2003 permanent and 5004 transient, S1, and the probe saw both codes for the same unknown id, so a feed treats either as "not served" and logs it.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 20 s, pong within 30 s or close `4002`, S1 | server protocol ping every 30 s, the first 30.5 to 30.7 s after the socket was created. The `ws` library answers it automatically. A socket with its automatic pong turned off closed at 41.5 and 41.6 s with code 1006, not 4002, and with or without a subscription, P5 |
| silence the server tolerates | not stated beyond the pong rule | a socket that answered pings and subscribed nothing stayed open for 110 s in the first run and 70 s in the second, closed by the client. So the only idle rule seen is the pong |
| forced disconnect | may happen with no code, and 4003 on an unreadable book stream, S1 and S2 | none in sockets held up to 110 s |
| maintenance notice | code 5003 `server shutting down`, S1 | not observed |
| compression | not stated | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back on either endpoint, P7 |
| handshake | none | 484 to 747 ms to open, `server: cloudflare`, edge `SEA` |
| subscription limits | 256 per connection, 64 per frame, 10 requests per second, S1 | 331 per connection, 64 per frame and 12 frames in one burst were accepted, section 3 |
| backpressure | code 5002 `backpressure dropped`, resubscribe, S1 | not observed |
| throughput | | all 267 open books on one socket: median 454 frames per second, p90 572, peak 702, 75 KB per second, 159 bytes per frame, 12.2 µs `JSON.parse` per frame. The 257 book run: median 407, peak 666, 68 KB per second, 14.0 µs, P4 |

The older endpoint sent no ping in either 20 s run, which fits its documented 30 s interval, P6.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked with fewer levels than the frame had are cut, and the counts are given.

Subscribe, five books in one frame.

```json
{"method": "subscribe", "channels": ["orderbook:btc_tl", "orderbook:eth_tl", "orderbook:usdt_tl", "orderbook:btc_usdt", "orderbook:wal_tl"], "id": "book1"}
```

Acknowledgement.

```json
{"r":{"channels":["orderbook:btc_tl","orderbook:eth_tl","orderbook:usdt_tl","orderbook:btc_usdt","orderbook:wal_tl"],"id":"book1","t":"subscribed"},"e":"status","E":1790138681905}
```

Snapshot, first three levels per side kept of 31 bids and 100 asks.

```json
{"e":"orderbook","s":"wal_tl","r":{"t":"snapshot","b":[["1.7","587.647"],["1.69","21931.466"],["1.52","563.085"]],"a":[["1.71","133131.36"],["1.77","260.085"],["1.8","56.666"]],"sq":4063693},"E":1790138681905}
```

Diffs, one of one level and one of two levels.

```json
{"e":"orderbook","s":"eth_tl","r":{"t":"diff","b":[["133053","1.50123"]],"a":[],"sq":44477931},"E":1790138682182}
```

```json
{"e":"orderbook","s":"eth_tl","r":{"t":"diff","b":[],"a":[["135765","0.23594"],["135760","0"]],"sq":44475328},"E":1790138115882}
```

Heartbeat on an idle book.

```json
{"e":"orderbook","s":"usdt_tl","r":{"t":"heartbeat","sq":1949182},"E":1790138116460}
```

Empty snapshot of a pre-launch market.

```json
{"e":"orderbook","s":"ton_tl","r":{"t":"snapshot","b":[],"a":[],"sq":5718466},"E":1790138918713}
```

The keepalive is a WebSocket protocol ping from the server and a protocol pong from the client, so there is no application frame to show.

Errors.

```json
{"r":{"code":2003,"id":"e1","msg":"unknown market: orderbook:nope_tl","t":"error"},"e":"status","E":1790138916710}
```

```json
{"r":{"code":5004,"id":"e1","msg":"market inventory unavailable: orderbook:nope_tl","t":"error"},"e":"status","E":1790138096644}
```

```json
{"r":{"code":3006,"id":"e11","msg":"channels list too long","t":"error"},"e":"status","E":1790138100651}
```

```json
{"r":{"code":3001,"msg":"invalid JSON","t":"error"},"e":"status","E":1790138102252}
```

Best bid and ask, a trade, and its match price.

```json
{"e":"orderbook","s":"btc_tl","r":{"b":"4245403","bq":"0.002355","a":"4245919","aq":"0.002355","t":"book-ticker","u":271919999},"E":1790138268380}
```

```json
{"e":"order","s":"btc_tl","r":{"i":"e87160d018156d44cd642d0a9c48159f","p":"4244106","q":"0.088609","t":"match","S":"SELL","T":1790138281578},"E":1790138281578}
```

```json
{"e":"orderbook","s":"btc_tl","r":{"p":"4244106","t":"match-price","T":1790138281584},"E":1790138281584}
```

The older endpoint: an acknowledgement, whose `id` is empty although the request carried `"id": "l1"`, an error, and a diff.

```json
{"channel":"orderbook","method":"subscribe","id":"","status":"success","code":100}
```

```json
{"error":"subscription error","status":"error","code":201}
```

```json
{"data":{"action":"merge","last_offset":271935919,"seq":34083997,"payload":{"buy":{},"sell":{"4250011":"0.005733","4250120":"0"}}},"event":"diff","market":"btc_tl"}
```

On the older endpoint `orderbook-diff:nope_tl` was acknowledged with code 100, and `orderbook:btc_tl` and `nope:btc_tl` got code 201, read from the order of the replies, since the reply carries no channel market and no id, P6.

## 7. Private channels

Named for a future execution stage, from S1, S3 and S6, not probed.

- Newer endpoint `wss://api.paribu.com/v1/wapi/user`, authenticated with `Authorization`, `X-Signature` and `X-Timestamp` headers on the upgrade, channels `orders` (with `conditional-order` events) and `ledger`, whose commission frames carry the applied `rate`, S6.
- Older endpoint `wss://api.paribu.com/stream/user`, channels `user-matches:<market>`, `user-matches-with-fee:<market>` and `orders`, S3.
- An API key needs the read-only scope set for socket access, S7.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It applies only if the engine ever takes a spot leg, since Paribu has no perpetual, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.paribu.com/v1/wapi/stream` | one public endpoint for every market |
| channel | `orderbook:<rawMarketId>`, where `rawMarketId` is the catalog id such as `btc_usdt` | snapshot on subscribe, a strict `sq` chain, a heartbeat, 100 levels |
| markets per connection | 64 to 128 | 331 channels ran on one socket with 0 gaps, but the documented default cap is 256 and the endpoint is beta |
| subscribe frames | one frame of at most 64 channels, `{"method":"subscribe","channels":["orderbook:btc_usdt", …],"id":"<slice>"}`, frames at least 100 ms apart | documented limits of 64 channels per frame and 10 requests per second |
| keepalive | none from the client, leave the `ws` library's automatic pong on | the server pings every 30 s and closes about 11 s after an unanswered ping |
| `maxSilenceMs` | 15,000 | each book sends a heartbeat within about 5 s of idling, so three missed heartbeats is a dead feed, and the documentation says silence past two intervals means the feed has stopped |
| routing | `frame.s` is the `rawMarketId`, and `frame.r.t` selects snapshot, diff or heartbeat | flat envelope |
| snapshot | `r.t === "snapshot"`: `resetBook` and store `r.sq` | documented replace semantics |
| diff | apply only when `r.sq === last + 1`, drop when `r.sq <= last` | documented rule, 0 gaps observed |
| heartbeat | resync when `r.sq !== last` | documented |
| resync | a forward gap, a diff before any snapshot, a heartbeat mismatch, a 5002 `backpressure` frame naming the market, or a close with 4003: `resync`, which terminates the socket and resubscribes | the engine's existing path, and what the documentation asks for |
| unserved stream | log a 2003 or 5004 error and drop the market from the slice | both codes came back for unknown ids |
| receive time | stamp on arrival, never from `E` | `E` is the server's event time, documented as "Event time" on data frames and "Server send-time" on control frames |
| sizes | `Number()` of the base currency string | spot quantities |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WebSocket API Overview | https://docs.paribu.com/api/streams-v2/overview | 2026-09-23 | Paribu | endpoints, beta notice, keepalive, subscribe and acknowledgement shapes, error codes 2001 to 5004, sections 1 to 5 |
| S2 | Public Streams | https://docs.paribu.com/api/streams-v2/public-streams | 2026-09-23 | Paribu | `orderbook`, `book-ticker`, `match-price`, `matches`, the sync rule and heartbeat cadence, sections 2 to 4 |
| S3 | Streams | https://docs.paribu.com/api/streams/streams | 2026-09-23 | Paribu | the older endpoint, its channels, 100 hub connections, 30 s ping, status codes 100, 200 and 201, sections 1, 2 and 7 |
| S4 | Orderbook Sync via Streams | https://docs.paribu.com/api/streams/orderbook-sync-via-streams | 2026-09-23 | Paribu | `orderbook-diff` and the REST `seq` recipe, section 2 |
| S5 | Orderbook | https://docs.paribu.com/api/market-data/orderbook | 2026-09-23 | Paribu | market id format, section 3 |
| S6 | Private Streams | https://docs.paribu.com/api/streams-v2/private-streams | 2026-09-23 | Paribu | `orders`, `ledger`, commission `rate`, section 7 |
| S7 | Obtaining API Keys | https://docs.paribu.com/api/getting-started/obtaining-api-keys | 2026-09-23 | Paribu | scopes needed for socket access, section 7 |
| P1 | `ws-probe.mjs book`, runs at 04:35 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | sections 3, 4 and 6 |
| P2 | `ws-probe.mjs channels`, a 30 s run on two markets at 04:36 UTC with no trade, and 45 s runs on four markets at 04:37 and 04:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | sections 2 and 6 |
| P3 | `ws-probe.mjs errors`, runs at 04:34 and 04:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | sections 3, 4 and 6 |
| P4 | `ws-probe.mjs batch`, 257 books at 04:38 UTC and 267 books plus 64 book tickers at 04:46 UTC, 60 s each | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | sections 3, 4 and 5 |
| P5 | `ws-probe.mjs silence`, 110 s at 04:40 UTC and 70 s at 04:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 5 |
| P6 | `ws-probe.mjs legacy`, runs at 04:42 and 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | sections 2, 4, 5 and 6 |
| P7 | `ws-probe.mjs deflate`, runs at 04:34 and 04:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paribu/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
