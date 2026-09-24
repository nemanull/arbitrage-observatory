# Delta Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 21:12 and 21:42 Pacific time, which is 2026-09-23 04:12 to 04:42 UTC.

This profile covers the public WebSocket of Delta Exchange global (CCXT id `delta`) for its one perpetual family, USDT-settled linear perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/delta/ws-probe.mjs), and the capture is quoted beside the documented value.
Access results are from this laptop's Surfshark WireGuard exit, which geolocates to Canada, and every socket opened without a refusal.
Delta Exchange global excludes residents of Canada from trading, see [`fees.md`](./fees.md) section 1, so an open socket here says nothing about who may trade.

The global API documentation site linked from the global fee page, `https://docs-global.delta.exchange/`, did not resolve in DNS from this host on 2026-09-22, and a WebFetch of it failed with `ENOTFOUND` as well.
Its last Wayback Machine capture, of 2026-01-30, is the documentation of record here and is cited as S1.
`https://docs.delta.exchange/` now documents the separate Delta Exchange India platform, whose April 2026 changelog moved public channels to a compact format on a new public endpoint, S2.
The global platform serves both formats today, on two URLs, section 1, and the compact format is not in S1.

## 1. Endpoints

| URL | documented | channel names it serves | probed on 2026-09-23 UTC |
|---|---|---|---|
| `wss://socket.delta.exchange` | the global production URL, public and private, S1 | legacy names: `l2_updates`, `l2_orderbook`, `l1_orderbook`, `v2/ticker`, `mark_price`, `funding_rate`, `v2/spot_price`, `all_trades` | opened in 404 to 577 ms over seven opens, every legacy channel delivered |
| `wss://public-socket.delta.exchange` | not in S1, the India twin `wss://public-socket.india.delta.exchange` is the "Production public channel endpoint" of S2 | compact names: `ob_updates`, `ob_l2`, `ob_l1`, `ticker`, `mark_price`, `funding_rate`, `spot_price`, `trades`, `system_status` | opened in 405 to 454 ms over eight opens, every compact channel delivered |
| `wss://testnet-socket.delta.exchange` | testnet, S1 | | not probed |

A subscribe frame whose channels all belong to the other URL is refused as a whole with `{"message":"Subscription forbidden: Invalid channel array","type":"error"}`, on both URLs, P1.
A frame that mixes a valid channel with one of the other URL's gets the valid one subscribed and a per channel error for the other, P3.
`mark_price` and `funding_rate` keep their names on both URLs, and the payloads differ, section 6.
Both hostnames are CloudFront names, `dvh76wfnav1n7.cloudfront.net` and `d3ll98yxlgwrsi.cloudfront.net`, and the servers answer the upgrade as `nginx/1.14.2`, P4.
S1 says the data centers are in AWS Tokyo.

The perpetual family is one: six USDT-settled linear perpetuals, and every channel carries them on one socket together with options and spot, see [`rest.md`](./rest.md) section 2.

## 2. Channel matrix for public market data

Channel names, cadences and caps are from S1 for the legacy names and from S2 for the compact names, and the last column is what the probe saw on 2026-09-23 UTC.

| legacy name, compact name | payload | documented depth and speed | probed |
|---|---|---|---|
| `l2_updates`, `ob_updates` | symbol list, no `all`, at most 100 symbols per connection | snapshot, then updates every 100 ms, "update messages wont be published till there is an orderbook change" | snapshot of the whole book on subscribe, then diffs with `seq` and a CRC32 `cs`, recommended, section 4 |
| `l2_orderbook`, `ob_l2` | symbol list, at most 20 (legacy) or 100 (compact) per connection | legacy: whole book every 1 s, at most 10 s apart. Compact: top 15 levels every 500 ms | `l2_orderbook` sent 13 BTC frames in 12 s and 9 in 8 s, with `buy` and `sell` objects. `ob_l2` sent 15 levels per side, 24 frames in 12 s and 16 in 8 s |
| `l1_orderbook`, `ob_l1` | symbol list, category names or `all` | every 100 ms, at most 5 s apart | `l1_orderbook` 27 BTC frames in 12 s and 14 in 8 s. `ob_l1` 119 in 12 s and 79 in 8 s |
| `v2/ticker`, `ticker` | symbol list | every 5 s | `v2/ticker` 3 frames in 12 s and 1 in 8 s, `ticker` 2 and 1. The compact ticker carries `m` (mark), `sp` (index) and no funding |
| `mark_price` | `MARK:<symbol>` | every 2 s | every 2,023 or 2,024 ms at the median and 2,047 ms at most, and the price changed on 28 or 29 of 29 or 30 frames per symbol in each 60 s run |
| `v2/spot_price`, `spot_price` | index symbol such as `.DEXBTUSDT` | legacy every 1 s | every 249 to 251 ms at the median for BTC, ETH and XRP, 500 to 601 ms for SOL and DOGE, 1,000 ms for PAXG, at most 1,050 ms apart |
| `funding_rate` | symbol list or `all` | "real time" | legacy URL: a frame per symbol on subscribe holding the last computed value, stamped 59 s earlier, then a new one whose stamp is 60 s later. Compact URL: no frame on subscribe, the first 10 and 31 s after it, and no second one within the 60 s runs. Carries the interval and the next settlement, section 6 |
| `all_trades`, `trades` | symbol list | on trade, with a snapshot of the last 50 trades | one snapshot, not studied further |
| `product_updates`, `system_status` | none | market disruption and auction events, maintenance events | `system_status` sent a snapshot with `"status":"live"` on subscribe |
| `candlestick_<resolution>` | symbol list | last candle | not probed |

The anchor fields are all on sockets: the index on `spot_price`, the mark on `mark_price` and the funding rate with interval and next settlement on `funding_rate`.
The engine reads anchors from REST, and [`rest.md`](./rest.md) section 3 records that the bulk ticker is republished only every 2.5 to 3.2 s.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column is for `wss://public-socket.delta.exchange` with compact names unless it says otherwise.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all products, S1. The India docs split public and private onto two URLs, S2 | one URL per channel naming scheme, not per product. Perpetuals, options and spot share a socket |
| subscribe frame shape | `{"type": "subscribe", "payload": {"channels": [{"name": "l2_updates", "symbols": ["BTCUSDT"]}]}}`, S1 | as documented. Four channels with six symbols each in one frame got one ack |
| unknown symbol expectation | not documented. The diff channel documents an `"action":"error"` frame "Snapshot load failed. Verify if product is live and resubscribe after a few secs." | `NOPEUSDT` is acked in the channel list and never delivers. The `error` action was not seen |
| chunk unit and budget | 100 symbols per connection on the diff channel, 20 on legacy `l2_orderbook`, S1 and S2 | 101 symbols in one frame were acked and all 101 snapshots came. A second frame adding 6 more got `"subscription forbidden on this channel with more than 100 symbols"` |
| keepalive mechanism | `{"type":"enable_heartbeat"}` makes the server send a heartbeat "every 30 seconds", or the client sends `{"type":"ping"}` and gets `{"type":"pong"}`, S1 | heartbeats came every 5,000 ms, not every 30 s. The pong came 97 to 101 ms after the ping. No server protocol ping on eight sockets over two runs, each held up to 70 s |
| connection lifetime and maintenance notice | "You will be disconnected, if there is no activity within 60 seconds after making connection." Maintenance on `system_status`, S2, or `announcements`, S1 | a socket that neither subscribes nor sends closed at 59,996 and 60,002 ms with 1006. No lifetime cap met in 70 s. `system_status` snapshot read `live` |
| handshake and operation rate limits | 150 connections per 5 minutes per IP, then HTTP 429, S1 | not approached, at most 4 connections at once |
| public market data authentication | none | none |
| message parse and routing | a flat object with `type` and the symbol | compact frames route on `type` and `sy`. Legacy frames route on `type` and `symbol` |
| subscribe acknowledgement shape | `{"type":"subscriptions","channels":[…]}`, a refused channel carries `error`, S1 | as documented, 97 to 112 ms after the subscribe frame. A refused channel reads `{"error":"subscription forbidden on this invalid channel","name":"nope_channel"}` |
| symbol identifier format | `BTCUSDT` | identical to CCXT `market.id`, to the REST product `symbol` and to the REST ticker `symbol` on 6 of 6 perpetuals |
| number representation | prices and sizes as strings in the diff channel | strings on both URLs, with sizes as integer strings of contracts. The legacy `l2_orderbook` sends `size` as a JSON number and `depth` as a string |
| timestamp representation | microseconds | `ts` in µs on compact frames and `timestamp` in µs on legacy frames. `spot_price` sent `"ts":null` |
| size unit | "size is number of contracts at this price", S1 | contracts of CCXT `contractSize` coins, section 4 |
| sequence semantics | `seq` must be the last plus one, else resubscribe, S1 and S2 | 0 gaps on 6 perpetuals over two 60 s runs on the compact URL and one 30 s run on the legacy URL |
| idle repeat behaviour | the diff channel publishes only on a change | a quiet book still sent an update about every 5 or 10 s, and PAXG went 15 s without one, section 4 |

## 4. The book channel in detail

`ob_updates` on `wss://public-socket.delta.exchange` is the channel this profile recommends, and every row below is about it unless it says otherwise.
The legacy `l2_updates` on `wss://socket.delta.exchange` behaved the same on every axis in a 30 s run, with longer key names.

### Snapshot on subscribe

The first frame per symbol is `"action":"snapshot"` with the whole book, "All levels of orderbook" in the words of S2, the symbol's `seq` and a `cs`.
Six perpetuals got exactly one snapshot each, 105 to 115 ms after the subscribe frame, and no further snapshot in 60 s, in two runs.
The snapshot held 20 levels per side on BTCUSDT, 51 bids and 50 asks on ETHUSDT, 49 or 50 bids and 50 asks on SOLUSDT, 50 per side on XRPUSDT, 33 and 42 on DOGEUSDT and 34 and 47 on PAXGUSDT.
The REST book returns at most 20 levels, see [`rest.md`](./rest.md) section 5, so the socket snapshot is the deeper source.
A second subscribe of a symbol already on the socket is acked again and sends no new snapshot.

### Delta semantics

An update carries `a` and `b` arrays of `["price", "size"]` string pairs, and a size of `"0"` deletes the level.
An update can carry an empty array for one side, `"a":[]`, and no update in the runs had both sides empty.
Updates are frequent on BTCUSDT, 212 and 229 in 60 s, and on ETHUSDT, 85 and 60, and sparse elsewhere, 10 to 12 in 60 s.

### Sequence and gap rule

```text
action snapshot                 replace the book, last = seq
action update, seq = last + 1   apply, last = seq
action update, seq ≠ last + 1   gap: resubscribe the symbol (documented), or terminate the socket (the engine's resync)
action error                    resubscribe after a few seconds (documented, not seen)
```

The first update after a snapshot had `seq` equal to the snapshot's plus one on every symbol.
The rule held on every update of both runs, with 0 gaps.

### Checksum

`cs` is the CRC32 of the top ten asks ascending and the top ten bids descending, written `price:size` joined by commas, the two sides joined by `|`, with the price and size strings exactly as sent, S1.
The probe computed it with `zlib.crc32` after every frame and matched 213 of 213 and 230 of 230 BTCUSDT frames, 86 of 86 and 61 of 61 ETHUSDT frames and every frame of the other four symbols in both 60 s runs, snapshots included.
An update that only touches levels below the tenth repeats the previous `cs`.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, 6 of 6 symbols in both runs | best first, ascending, 6 of 6 |
| update | descending on every update of both runs | ascending on every update of both runs |
| REST `l2orderbook` | descending | ascending |

S1 states the update order as well.
A feed still applies updates by price.

### Size unit against CCXT `contractSize`

| perpetual | CCXT `contractSize` | socket size at the best bid | REST size at the same price | coins |
|---|---:|---|---|---|
| `BTCUSDT` | 0.001 | `"23"` | `23` | 0.023 BTC |
| `ETHUSDT` | 0.01 | `"1069"` | `1069` | 10.69 ETH |
| `SOLUSDT` | 1 | `"17"` | `17` | 17 SOL |

The unit is contracts, one contract is `contract_value` coins, and CCXT reports `contract_value` as `contractSize`, see [`rest.md`](./rest.md) section 2.
The engine's `sizeMul` therefore converts Delta sizes correctly.
At two instants in each of three runs, the probe matched the maintained book's top ten levels per side against the REST book.
BTCUSDT and SOLUSDT had 20 of 20 sizes equal at the same price in eleven of twelve compares and 14 in one.
ETHUSDT had 20 of 20 in four compares and 0 in two, where only 10 of the 20 prices were still shared, because its quote ladder had moved during the REST call, which takes 100 to 450 ms here.
The socket book's checksum matched on every frame of those runs, so the misses are the REST read arriving later.
A spot symbol on the same channel, `BTC_USDT`, sends sizes in the base asset with decimals such as `"0.023292"`, which the engine does not use.

### One-sided and empty books

No one-sided or empty perpetual book was seen.
What the channel sends for a side with no orders is Not verified.

### Idle repeats and quiet books

No `seq` was repeated.
Quiet books still sent an update about every 5 s: the longest silence was 5,002 to 10,003 ms on SOLUSDT, XRPUSDT and DOGEUSDT, and 10,006 and 14,997 ms on PAXGUSDT, in the two 60 s runs.
BTCUSDT never went more than 707 ms without an update.

### Unknown, closed and wrong-channel symbols

| request | reply | then |
|---|---|---|
| `ob_updates` `NOPEUSDT` | ack listing `NOPEUSDT` | nothing |
| `ob_updates` `all` | ack listing `all` | nothing, as S1 says `all` is not accepted |
| `ob_updates` with no `symbols` key | `{"error":"subscription forbidden without symbol array on this channel","name":"ob_updates"}` | |
| unknown channel `nope_channel` | `{"error":"subscription forbidden on this invalid channel","name":"nope_channel"}` | |
| a frame naming only the other URL's channels | `{"message":"Subscription forbidden: Invalid channel array","type":"error"}` | nothing from the frame is subscribed |
| `ob_updates` `XRPUSDT` and `l2_updates` `XRPUSDT` in one frame | the ack lists `ob_updates` and adds `{"error":"subscription forbidden on this invalid channel","name":"l2_updates"}` | `ob_updates` delivers |
| text that is not JSON | no reply | the socket stays open |
| a 101st to 107th symbol | `"subscription forbidden on this channel with more than 100 symbols"` | the first 101 keep delivering |

No perpetual was closed or delisted, so a closed symbol could not be probed.
Because an unknown symbol is acked, the feed has to notice a symbol with no snapshot on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `enable_heartbeat`, heartbeat every 30 s, reconnect after 35 s without one. Or `{"type":"ping"}` about every 30 s, reconnect after 5 s without a pong, S1 | heartbeat `{"ts_origin":…,"ts_publish":…,"type":"heartbeat"}` about 100 ms after `enable_heartbeat` and then every 5,000 ms. Pong `{"type":"pong"}` 97 to 101 ms after the ping |
| silence the server tolerates | 60 s without activity after connecting, S1 | no subscription and no client frame: closed at 59,996 and 60,002 ms, code 1006, in two runs. A subscription to the quiet DOGEUSDT book alone, heartbeats alone, or a ping every 25 s each kept a socket open for the full 70 s and 62 s |
| forced disconnect | not documented | none in 70 s |
| maintenance notice | `system_status` events `maintenance_scheduled`, `maintenance_started`, `maintenance_finished`, `maintenance_cancelled`, S2 | snapshot `"status":"live"` on subscribe, no event in the runs |
| compression | not documented | the compact URL negotiates no extension when offered permessage-deflate. The legacy URL answers `permessage-deflate; client_max_window_bits=15` when offered. Both send text JSON when not offered |
| handshake | | 404 to 577 ms to open from this host over fifteen opens |
| subscription limits | 100 symbols per connection on the diff channel, 150 connections per 5 minutes per IP | the symbol cap confirmed, section 4 |
| throughput | | six perpetuals with mark, index and funding for 60 s on the compact URL, two runs: 1,589 and 1,486 frames, median 26 and 25 and peak 36 and 34 per second, 263 and 243 bytes per frame, 28 and 18 µs `JSON.parse` per frame. The legacy URL for 30 s: 679 bytes per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book arrays are cut to three levels, so the `cs` no longer matches the arrays shown.

Subscribe, the book with the anchor channels, on the compact URL, with the anchor symbol lists cut to one.

```json
{"type": "subscribe", "payload": {"channels": [{"name": "ob_updates", "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "PAXGUSDT"]}, {"name": "mark_price", "symbols": ["MARK:BTCUSDT"]}, {"name": "spot_price", "symbols": [".DEXBTUSDT"]}, {"name": "funding_rate", "symbols": ["BTCUSDT"]}]}}
```

Acknowledgement, symbol lists cut.

```json
{"channels":[{"name":"ob_updates","symbols":["BTCUSDT","ETHUSDT"]},{"name":"mark_price","symbols":["MARK:BTCUSDT"]},{"name":"spot_price","symbols":[".DEXBTUSDT"]},{"name":"funding_rate","symbols":["BTCUSDT"]}],"type":"subscriptions"}
```

Snapshot.

```json
{"a":[["86776.0","45"],["86776.5","58"],["86777.0","74"]],"action":"snapshot","b":[["86775.5","231"],["86775.0","295"],["86774.5","378"]],"cs":2595577411,"seq":7344412,"sy":"BTCUSDT","ts":1790137076553910,"type":"ob_updates"}
```

Updates, the second with an empty ask array.

```json
{"a":[["87052.5","0"],["87053.0","30184"],["87229.0","0"]],"action":"update","b":[["86758.5","5718"],["86758.0","0"],["86699.5","11997"]],"cs":2595577411,"seq":7344413,"sy":"BTCUSDT","ts":1790137077059023,"type":"ob_updates"}
```

```json
{"a":[],"action":"update","b":[["4338.70","2423"]],"cs":3657398415,"seq":326035,"sy":"PAXGUSDT","ts":1790137077548989,"type":"ob_updates"}
```

Legacy `l2_updates` update on `wss://socket.delta.exchange`, arrays cut to three levels.

```json
{"action":"update","asks":[["86810.5","453"],["86811.0","580"],["86811.5","742"]],"bids":[["86810.0","158"],["86809.5","202"],["86809.0","259"]],"cs":1347906885,"sequence_no":7344110,"symbol":"BTCUSDT","timestamp":1790137001889751,"type":"l2_updates"}
```

Keepalive, the ping and its answer, and a heartbeat after `enable_heartbeat`.

```json
{"type": "ping"}
```

```json
{"type":"pong"}
```

```json
{"ts_origin":1790137294966147,"ts_publish":1790137294966147,"type":"heartbeat"}
```

Errors.

```json
{"channels":[{"error":"subscription forbidden on this invalid channel","name":"nope_channel"}],"type":"subscriptions"}
```

```json
{"message":"Subscription forbidden: Invalid channel array","type":"error"}
```

```json
{"channels":[{"error":"subscription forbidden on this channel with more than 100 symbols","name":"ob_updates"}],"type":"subscriptions"}
```

Anchor channels on the compact URL: funding with interval `fi` in seconds, rate `fr` in percent and next settlement `nfr` in µs, the mark, and the index.

```json
{"fi":14400,"fr":0.0034196409293933104,"nfr":1790150400000000,"sy":"PAXGUSDT","ts":1790137086034896,"type":"funding_rate"}
```

```json
{"p":86783.8,"sy":".DEXBTUSDT","ts":null,"type":"spot_price"}
```

Legacy `funding_rate` and `mark_price`, which add the 8 h equivalent, a predicted rate equal to the current one, and the mark's annualised basis.

```json
{"timestamp":1790137387108316,"type":"funding_rate","symbol":"PAXGUSDT","product_id":277715,"funding_rate":0.003389249067119949,"funding_interval":14400,"funding_rate_8h":0.006778498134239898,"next_funding_realization":1790150400000000,"predicted_funding_rate":0.003389249067119949,"predicted_funding_rate_8h":0.006778498134239898}
```

```json
{"timestamp":1790137000924266,"type":"mark_price","symbol":"MARK:BTCUSDT","delta":null,"theta":null,"product_id":139,"price":"86810.52169903","price_band":{"upper_limit":"91151.06673384","lower_limit":"82470.01275918"},"spot":null,"vega":null,"rho":null,"gamma":null,"best_bid_mm":"86810","best_bid":"86810","best_ask_mm":"86810.5","best_ask":"86810.5","annualized_basis":"-0.4722562887180012711981503670"}
```

Compact ticker, where `m` is the mark and `sp` the index.

```json
{"d":[{"g":[null,null,null,null,null],"i":139,"m":"86751.43476156","m24hc":"1.4621","ohlc":[85545.0,86865.5,85110.5,86710.5],"oi":["5023","-59091.3900"],"pb":["82398.64937345","91072.19141276"],"q":["86755","84","86754.5","231",null],"qiv":[null,null,"-0.47368585"],"s":"BTCUSDT","to":[1472406.7160000005,1472406.7160000005]}],"sp":"86783.5","sy":"BTCUSDT","ts":1790137040736556,"type":"ticker"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://socket.delta.exchange` after an `auth` frame signed with the API secret, S1.
S2 says the India platform replaced that frame with `key-auth`, and that the old frame would stop working after 2025-12-31.

- `margins`, `positions`, `orders`, `user_trades`, `v2/user_trades`, `portfolio_margins`, `mmp_trigger`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://public-socket.delta.exchange`, one connection | the compact frames are 243 to 263 bytes against 679 on the legacy URL, and India's twin of the legacy public channels was scheduled for removal on 2026-07-31, S2 |
| channel | `ob_updates` | a snapshot of the whole book on subscribe, a strict `seq` chain, a CRC32 of the top ten |
| markets per connection | all six perpetuals | the cap is 100 symbols, and six ran with 0 gaps |
| subscribe frames | one frame, `{"type": "subscribe", "payload": {"channels": [{"name": "ob_updates", "symbols": ["BTCUSDT", …]}]}}` | one ack covered every symbol |
| keepalive | `{"type": "ping"}` every 15 s | pongs count as traffic, and a quiet book can go 15 s without an update |
| `maxSilenceMs` | 45,000 | three missed pongs, and the server's own limit is 60 s |
| routing | `sy` is the `rawMarketId` | identical to CCXT `market.id` |
| snapshot | `action === "snapshot"`: `resetBook` and store `seq` | documented replace semantics |
| update | apply only when `seq === last + 1`, then store `seq` | documented rule, 0 gaps observed |
| resync | `seq !== last + 1`, an update before any snapshot, or `action === "error"`: `resync` | the engine's path, and resubscribing is what the documentation asks for |
| checksum | optional, CRC32 of the top ten per side as sent | matched every frame, and a mismatch is a reason to resync |
| unserved symbol | log a symbol with no snapshot 10 s after its ack | an unknown symbol is acked and silent |
| receive time | stamp on arrival | `ts` is the server's publish time, 49 to 55 ms at the median before arrival here |
| sizes | `Number()` of the integer string, in contracts | `contractSize` converts to coins |
| deflate | keep `perMessageDeflate: false` | the compact URL does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Delta Exchange Global API documentation, Wayback Machine capture of 2026-01-30 | https://web.archive.org/web/20260130043054/https://docs-global.delta.exchange/ | 2026-09-22 | Delta Exchange global | legacy URL, channel names, cadences and caps, `l2_updates` recipe and checksum, heartbeat and ping, 60 s rule, 150 connections per 5 minutes, private channels, sections 1 to 7 |
| S2 | Delta Exchange India API documentation, changelog 17.04.26, 11.12.25 and 08.10.25 | https://docs.delta.exchange/ | 2026-09-22 | Delta Exchange India | compact channel names and payloads, the public endpoint split, `system_status`, the 2026-07-31 removal plan, `key-auth`, sections 1 to 8 |
| S3 | `docs-global.delta.exchange` link on the global fee page | https://global.delta.exchange/fees | 2026-09-22 | Delta Exchange global | the documentation host that no longer resolves, introduction |
| P1 | `ws-probe.mjs survey` at 04:16 and 04:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/delta/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 3 and 6 |
| P2 | `ws-probe.mjs book` for 60 s on the compact URL at 04:17 and 04:38 UTC, and for 30 s on the legacy URL at 04:23 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/delta/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P3 | `ws-probe.mjs errors` at 04:20 and 04:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/delta/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 6 |
| P4 | `ws-probe.mjs silence` for 70 s at 04:21 UTC and for 62 s at 04:40 UTC, and `deflate` at 04:21 and 04:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/delta/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
