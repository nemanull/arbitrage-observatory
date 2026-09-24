# One Trading WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:20 and 20:55 local time, which is 2026-09-23 03:20 to 03:55 UTC.

This profile covers the public WebSocket of One Trading (CCXT id `onetrading`) for its USD 5-Year Crypto Dated Futures, the funded contracts One Trading calls perpetual futures, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/onetrading/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation pages are small and were read in full, S1 to S9.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every product: spot, dated futures, equity futures, the closed EUR perpetuals | `wss://streams.fast.onetrading.com`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/onetrading.js` line 30 | HTTP 101 on every open, 354 to 479 ms to open, served by Cloudflare with `cf-ray` ending `-SEA` or `-YVR` |

One URL carries every instrument type, and a socket may mix them.
The probe subscribed the dated futures and the closed `BTC_EUR_P` on one socket without an error.
Private and public channels share the URL, and a login upgrades the socket, S2.

## 2. Channel matrix for public market data

| channel | subscribe payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `ORDER_BOOK` | `{"name": "ORDER_BOOK", "instrument_codes": [...]}`, and CCXT Pro adds `"depth"`, `pro/onetrading.js` line 336 | the whole book as the venue shows it, at most 16 levels per side seen, pushed on change | snapshot then updates, recommended |
| `BOOK_TICKER` | `instrument_codes` required on the wire, although S8 says the channel covers "all symbols" | best bid and ask on change | `BOOK_TICKER_SNAPSHOT` per instrument, then 237 and 276 `BOOK_TICK` frames in 52 s in two runs for `BTC_USD_P` and `ETH_USD_P` |
| `PRICE_TICKS` | `instrument_codes` | on trade, after a history of the last 80 trades | `PRICE_TICK_HISTORY` of 80 trades spanning 13:18 to 03:22 UTC on `BTC_USD_P`, and 13:21 to 03:42 in the rerun, about 6 trades an hour |
| `MARKET_TICKER` | `instrument_codes`, `price_points_mode` `INLINE` as CCXT Pro sends it, line 159 | every few seconds | carries `mark_price`, `funding_rate` and `next_funding_payment`, no index, 10 and 11 frames in 40 s in two runs |
| `CANDLESTICKS` | `properties`, CCXT Pro line 1111 | | not probed |
| `SYSTEM` | none, always on | `HEARTBEAT` every 10 s | 9,984 to 10,059 ms apart on every socket of every run |

No dedicated mark, index or funding channel exists.
`MARKET_TICKER` carries the mark and the preliminary funding rate, and no channel or REST call carries an index price, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for every instrument type, section 1 |
| subscribe frame shape | `{"type": "SUBSCRIBE", "channels": [{"name": "ORDER_BOOK", "instrument_codes": ["BTC_EUR", "ETH_EUR"]}]}`, and "You can only subscribe to **one** channel in a single `SUBSCRIBE` message", S3 | ten instruments in one frame got one ack. Two channels in one frame answered `{"error":"INVALID_MESSAGE_FORMAT"}` and the socket stayed open |
| unknown symbol expectation | Not publicly specified | `{"channel_name":"ORDER_BOOK","error":"INVALID_INSTRUMENT_CODES","invalid_instruments":["NOPE_USD_P"]}`, socket stays open. The closed `BTC_EUR_P` is acknowledged and then silent |
| chunk unit and budget | Not publicly specified | ten instruments in one frame, the whole active dated futures list, all acked with snapshots in 105 to 212 ms |
| keepalive mechanism | server `HEARTBEAT`, client protocol ping answered with a protocol pong, S4 | `HEARTBEAT` every 10 s on every socket, subscribed or not. Protocol ping answered 5 of 5 and 2 of 2 times. No server protocol ping |
| connection lifetime and maintenance notice | Not publicly specified | no close in 120 s on four sockets, one of which never sent a byte, nor in 60 s on four more in the rerun. No notice seen |
| handshake and operation rate limits | Not publicly specified | none reached with four sockets opened at once and 14 frames sent on one socket in 55 s |
| public market data authentication | none | none |
| message parse and routing | `channel_name`, `type`, `instrument_code`, S5 to S7 | book frames route on `instrument_code`, control frames on `type`, errors carry `error` and no `type` |
| subscribe acknowledgement shape | `{"type": "SUBSCRIPTIONS", "channels": [...], "time": ...}`, S3 | as documented, `time` in ns, and the ack drops the `depth` field it was sent. `UPDATE_SUBSCRIPTION` answers `{"type":"SUBSCRIPTION_UPDATED","channel_name":"ORDER_BOOK"}` |
| symbol identifier format | `BTC_EUR` in the examples | `BTC_USD_P`, identical to CCXT `market.id`, to REST `instrument_code` and to the funding calls on 10 of 10 dated futures |
| number representation | prices and amounts as strings, S6 and S7 | strings, and `unum_bids` and `unum_asks` as JSON integers |
| timestamp representation | `time` in ns, S6 | `time` in ns as a JSON number beyond 2^53, so a double parse rounds it to a multiple of 256 ns |
| size unit | Not publicly specified | base asset units, `"0.49"` on `BTC_USD_P` is 0.49 BTC, section 4 |
| sequence semantics | Not publicly specified, the examples show no counter | `unum_bids` rises by exactly 1 on every update of an instrument, and equals `unum_asks` on every frame. The snapshot's own `unum` is unreliable, section 4 |
| idle repeat behaviour | not documented | no repeated or empty update, a quiet book sends nothing and the heartbeat is the only traffic |

## 4. The book channel in detail

`ORDER_BOOK` is the channel this profile recommends, and every row below is about it.

### Snapshot on subscribe

The first frame for each instrument is `ORDER_BOOK_SNAPSHOT` with every bid and ask level and a `unum_bids` and `unum_asks`, which S6 does not show.
Ten dated futures each got exactly one snapshot, 123 to 212 ms after the subscribe frame in the first run, 105 to 193 ms in the second and 126 to 128 ms in the third, and none after it in 75 s.
The snapshot's `time` was 58 to 546 ms older than its arrival.
A second `SUBSCRIBE` or an `UPDATE_SUBSCRIPTION` sends a fresh snapshot for each instrument it names, including one already streaming.

### Delta semantics

An `ORDER_BOOK_UPDATE` carries `changes`, an array of `[side, price, amount]` with side `BUY` or `SELL`.
An amount of `"0"` removes the level, S7.
Every update carried at least one change: 20,134 changes in 4,129 updates in the first run, 34,567 in 6,318 in the second, and 23,204 in 4,909 in the third.

### Sequence and gap rule

Within the update stream `unum_bids` rose by exactly 1 from one update of an instrument to the next on 15,344 of 15,344 steps over three runs.
The step from the snapshot to the first update did not always hold.

| run | instruments whose first update was the snapshot's `unum` plus 1 | the others, first update minus snapshot |
|---|---|---|
| first, 03:22 UTC | 4 of 10 | `BTC_USD_P` +12,143, `ETH_USD_P` +9,401, `XRP_USD_P` -3,226, `LTC_USD_P` +3,469, `SUI_USD_P` +4,306, `ADA_USD_P` -2,467 |
| second, 03:24 UTC | 7 of 10 | `ETH_USD_P` +9,402, `TAO_USD_P` +3,867, `LINK_USD_P` +1,765 |
| third, 03:50 UTC | 7 of 10 | `LTC_USD_P` +3,473, `LINK_USD_P` +1,763, `ADA_USD_P` -2,460 |
| channels run, 03:28 UTC | | `SOL_USD_P` -16,999 |

The snapshot's content was right even when its counter was not.
In the second and third runs the book built from the snapshot and every update equalled the REST level 2 book at the same `unum` on 36 of 36 reads, twelve each on `BTC_USD_P`, `ETH_USD_P` and `ADA_USD_P`, top ten levels per side compared.
`ETH_USD_P` in the second run and `ADA_USD_P` in the third were among the instruments whose snapshot counter was off.
REST carries the same counter as the update stream, see [`rest.md`](./rest.md) section 5.

```text
ORDER_BOOK_SNAPSHOT            replace the book, last = unknown
first ORDER_BOOK_UPDATE after  apply, last = unum_bids
later update, unum = last + 1  apply, last = unum_bids
later update, unum ≠ last + 1  gap: resync
```

No gap was seen, so what the server does after dropping an update is Not verified.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 10 of 10 instruments in all three runs | best first, ascending, on 10 of 10 |
| update | the `BUY` entries of a frame were descending and the `SELL` entries ascending in every one of 15,356 updates | |
| REST `order-book` | descending | ascending |

A feed still applies updates by price.

### Level window

`ORDER_BOOK` ignored the `depth` field.
Sockets subscribed at depth 5, 20 and 0 each received the same 16 bids and 14 asks on `BTC_USD_P`, and each held at most 16 and 14 over 30 s, in both runs.
No snapshot and no maintained book held more than 16 levels on either side of any instrument.
The REST book also stops at 16, its `depth` enum tops out at 16, and the spot books `BTC_USDC` and `ETH_USDC` held exactly 16 and 16 with bids down to 73,095.98 and asks up to 175,000, see [`rest.md`](./rest.md) section 5.
So a cap of 16 levels per side is likely, and it was not proven, because no dated future's book was seen deeper.
That is fewer than the engine's 20 levels.

### Size unit against CCXT `contractSize`

Amounts are base asset units.
The contract has no multiplier: S12 section 5.2 values a 0.2 BTC position at 0.2 times the price, and the increments are per base asset, S13 section 5.

| instrument | CCXT 4.5.68 `contractSize` | socket amount at the touch | REST amount at the same `unum` |
|---|---|---|---|
| `BTC_USD_P` | undefined, since CCXT types it spot | `"0.49"`, the best bid of the first run's snapshot at 86,606 | identical on 6 of 6 compares |
| `ETH_USD_P` | undefined | `"9.5971"` | identical on 6 of 6 |
| `ADA_USD_P` | undefined | `"92000"` | identical on 6 of 6 |

The engine turns a missing contract size into 1, at `server/src/ccxt/connector.ts` lines 175 and 188 to 194, which is correct here.
CCXT would give 1 if it typed the market as a swap, at `server/node_modules/ccxt/js/src/onetrading.js` line 561.

### One-sided and empty books

None was seen: every book held both sides on every frame of both runs, and no book crossed.

### Idle repeats

Nothing is repeated.
The longest silence of one instrument was 553 to 4,296 ms in the first run, 650 to 2,800 ms in the second and 898 to 4,550 ms in the third.
Books are thin and re-quoted often, so a quiet book is not expected, but a feed must not treat a silent instrument as dead, since only the socket's heartbeat is guaranteed.

### Unknown, closed and repeated subscriptions

| request | reply | then |
|---|---|---|
| `ORDER_BOOK` `NOPE_USD_P` | `{"channel_name":"ORDER_BOOK","error":"INVALID_INSTRUMENT_CODES","invalid_instruments":["NOPE_USD_P"]}` | socket open |
| `ORDER_BOOK` `BTC_EUR_P`, state `CLOSED` | `SUBSCRIPTIONS` naming `BTC_EUR_P` | no snapshot, nothing |
| a second `SUBSCRIBE` to `ORDER_BOOK` with `BTC_USD_P` while `SOL_USD_P` streams | `SUBSCRIPTIONS` naming only `BTC_USD_P`, and a `BTC_USD_P` snapshot | both stream: 29 `SOL_USD_P` and 30 `BTC_USD_P` updates in the next 5 s, and 7 and 6 in the rerun |
| `UPDATE_SUBSCRIPTION` to `BTC_USD_P` and `ETH_USD_P` | `SUBSCRIPTION_UPDATED`, and a snapshot for each | `SOL_USD_P` stops, after 1 update in flight in the first run and at once in the rerun, and sent none in the next 14 s |
| `BOOK_TICKER` with no `instrument_codes` | `{"channel_name":"BOOK_TICKER","error":"INVALID_INSTRUMENT_CODES_LIST"}` | socket open |
| unknown channel `FOO` | `{"error":"INVALID_CHANNEL"}` | socket open |
| `UNSUBSCRIBE` `["PRICE_TICKS"]` | `{"type":"UNSUBSCRIBED","channel_name":"PRICE_TICKS"}` | |
| `{"type": "HELLO"}` | nothing | socket open |
| text that is not JSON | `{"error":"INVALID_MESSAGE_FORMAT"}` | the server closes the socket with code 4000, reason `INVALID_MESSAGE_FORMAT` |

A second `SUBSCRIBE` adds instruments and `UPDATE_SUBSCRIPTION` replaces the list, so a feed sends one `SUBSCRIBE` per socket with its whole slice.
CCXT Pro sends `UPDATE_SUBSCRIPTION` for every later symbol, at `pro/onetrading.js` line 1322.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | "The server sends a periodic heartbeat message", and "Upon receiving a heartbeat, the client sends a ping request", S4 | `{"channel_name":"SYSTEM","subscription":"SYSTEM","time":…,"type":"HEARTBEAT"}` every 9,984 to 10,059 ms, first one 1.1 to 9.7 s after open. A protocol ping every 20 s got a protocol pong every time |
| silence the server tolerates | Not publicly specified | four sockets held 120 s without a close: bare, bare with protocol pings, subscribed, subscribed with protocol pings. The rerun held the same four for 60 s, shortened to stay inside the socket budget |
| forced disconnect | Not publicly specified | none in 120 s, except the close on a non-JSON frame |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 354 to 479 ms to open from this host |
| subscription limits | one channel per `SUBSCRIBE`, S3 | confirmed. No cap reached at 10 instruments on one socket |
| throughput | | 10 dated futures on one socket: 55.3, 84.5 and 65.7 frames per second in three 75 s runs, 1,181, 1,895 and 1,388 KB, 14.4 to 21 µs `JSON.parse` per frame |
| delivery lag | | arrival minus the frame's `time`: minimum 48 to 49 ms, median 49 to 52 ms, maximum 74 to 182 ms per instrument over three runs. The server clock read 8.5 and 10 ms ahead of this host at the fastest REST reads, with an error bound near 190 ms, see [`rest.md`](./rest.md) section 7, so how the 48 ms floor splits between transit and clock offset is not known |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays are cut to three levels.

Subscribe, the whole slice in one frame.

```json
{"type": "SUBSCRIBE", "channels": [{"name": "ORDER_BOOK", "depth": 0, "instrument_codes": ["BTC_USD_P", "ETH_USD_P", "XRP_USD_P", "SOL_USD_P", "LTC_USD_P", "SUI_USD_P", "TAO_USD_P", "DOGE_USD_P", "LINK_USD_P", "ADA_USD_P"]}]}
```

Acknowledgement.

```json
{"type":"SUBSCRIPTIONS","channels":[{"name":"ORDER_BOOK","instrument_codes":["BTC_USD_P","ETH_USD_P","XRP_USD_P","SOL_USD_P","LTC_USD_P","SUI_USD_P","TAO_USD_P","DOGE_USD_P","LINK_USD_P","ADA_USD_P"]}],"time":1790133754838659000}
```

Snapshot, whose `unum` is 9,401 below the first update that followed it.

```json
{"channel_name":"ORDER_BOOK","time":1790133754657000000,"type":"ORDER_BOOK_SNAPSHOT","instrument_code":"ETH_USD_P","bids":[["2767.38","9.5971"],["2767.35","6.6035"],["2767.3","16.5"]],"asks":[["2768.52","9.46"],["2768.62","10.83"],["2768.64","9.5971"]],"unum_bids":27112930,"unum_asks":27112930}
```

Update.

```json
{"type":"ORDER_BOOK_UPDATE","channel_name":"ORDER_BOOK","time":1790133754857000000,"instrument_code":"ETH_USD_P","changes":[["BUY","2766.89","10.7866"],["BUY","2766.79","0"]],"unum_bids":27122331,"unum_asks":27122331}
```

Keepalive.

```json
{"channel_name":"SYSTEM","subscription":"SYSTEM","time":1790133756435892700,"type":"HEARTBEAT"}
```

Errors.

```json
{"channel_name":"ORDER_BOOK","error":"INVALID_INSTRUMENT_CODES","invalid_instruments":["NOPE_USD_P"]}
```

```json
{"error":"INVALID_MESSAGE_FORMAT"}
```

Best bid and ask.

```json
{"type":"BOOK_TICK","time":1790134127409046712,"instrument_code":"ETH_USD_P","data":{"best_bid":"2766.85","bid_amount":"6.9271","best_ask":"2767.43","ask_amount":"10.0359"}}
```

Market ticker, one instrument kept, which carries the mark and the preliminary funding rate.

```json
{"channel_name":"MARKET_TICKER","time":1790134057912906800,"type":"MARKET_TICKER_UPDATES","ticker_updates":[{"instrument":"BTC_USD_P","last_price":"86606.00","high":"86675.99","low":"85081.69","price_change":"1128.00","price_change_percentage":"1.32","volume":"148970.76","global_volume":"36347259512","price_points":[],"state":"ACTIVE","type":"DATED_FUTURE","open_interest":"3.63754","open_interest_usd":"315459.77","mark_price":"86606.00","funding_rate":"0.00001790868992910422","next_funding_payment":"2026-09-23T04:00:00.000Z"}]}
```

## 7. Private channels

Named for a future execution stage, from S2, S9 and CCXT Pro, not probed.
They use the same URL after an `AUTHENTICATE` frame, S2.

- The `TRADING` channel, S3, which carries order entry and the events Create Order, Cancel All Orders, Cancel Order by Client ID, Cancel Order by Order ID, Margin Update, Settlement, Funding Payment, Order Booked, Order Rejected, Order Closed, Trade Executed, Order Fully Filled, Move Order and Balance Adjustment, S9.
- CCXT Pro also handles `ACTIVE_ORDERS_SNAPSHOT`, `INACTIVE_ORDERS_SNAPSHOT`, `ACCOUNT_UPDATE`, `BALANCES_SNAPSHOT`, `FILL`, `DONE`, `BOOKED`, `UPDATE`, `TRACKED` and `TRIGGERED` frames, at `pro/onetrading.js` lines 1236 to 1261.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It only matters once the catalog and the anchor are solved, see [`rest.md`](./rest.md) sections 2 and 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://streams.fast.onetrading.com` | one URL for everything |
| channel | `ORDER_BOOK` | snapshot on subscribe, a per instrument counter, the whole visible book |
| markets per connection | all 10 dated futures on one socket | 10 ran at 55 to 85 frames per second with no gap in three runs, and no cap is published |
| subscribe frames | one `SUBSCRIBE` per socket with the whole slice, `{"type": "SUBSCRIBE", "channels": [{"name": "ORDER_BOOK", "instrument_codes": [...]}]}` | a second `SUBSCRIBE` adds and `UPDATE_SUBSCRIPTION` replaces, so one frame is the simple case |
| keepalive | a protocol ping every 15 s | S4 asks for a ping on each heartbeat, the pong came back every time, and the server sends a heartbeat every 10 s anyway |
| `maxSilenceMs` | 25,000 | the heartbeat arrives every 10 s on every socket, so two missed heartbeats is a dead socket |
| routing | `instrument_code` is the `rawMarketId` | identical to CCXT `market.id` and REST |
| snapshot | `ORDER_BOOK_SNAPSHOT`: `resetBook`, mark the counter unknown | the snapshot's own `unum` failed to chain on 12 of 30 instrument snapshots |
| first update | apply, and store `unum_bids` | it cannot be checked against the snapshot |
| later update | apply only when `unum_bids === last + 1`, then store it | 15,344 of 15,344 steps held |
| resync | a step that is not `+1`, or an update before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path |
| unserved instrument | log an instrument with no snapshot 10 s after the ack | a closed instrument is acknowledged and stays silent |
| frames to send | JSON only | one malformed frame closes the socket with 4000 |
| receive time | stamp on arrival | `time` is a ns JSON number that loses precision, and a snapshot's `time` can be 400 ms old |
| sizes | `Number()` of the string, base units | no multiplier |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WebSocket Introduction | https://docs.onetrading.com/websocket | 2026-09-22 | One Trading API | URL, section 1 |
| S2 | WebSocket Authenticate | https://docs.onetrading.com/websocket/authenticate | 2026-09-22 | One Trading API | login on the same socket, sections 1 and 7 |
| S3 | WebSocket Subscribe | https://docs.onetrading.com/websocket/subscribe | 2026-09-22 | One Trading API | frame shape, one channel per frame, ack, `TRADING` example, sections 3 and 7 |
| S4 | Ping / Pong | https://docs.onetrading.com/ping-pong-347234m0 | 2026-09-22 | One Trading API | heartbeat and protocol ping, sections 3 and 5 |
| S5 | Orderbook Introduction | https://docs.onetrading.com/websocket/orderbook/introduction | 2026-09-22 | One Trading API | `ORDER_BOOK` subscribe and ack, sections 2 and 3 |
| S6 | Orderbook Snapshot | https://docs.onetrading.com/websocket/orderbook/snapshot | 2026-09-22 | One Trading API | snapshot shape with no counter, sections 3 and 4 |
| S7 | Orderbook Update | https://docs.onetrading.com/websocket/orderbook/update | 2026-09-22 | One Trading API | `changes` and the zero amount, sections 3 and 4 |
| S8 | Book Ticker Introduction | https://docs.onetrading.com/websocket/book-ticker/introduction | 2026-09-22 | One Trading API | "for all symbols", section 2 |
| S9 | One Trading API docs index | https://docs.onetrading.com/llms.txt | 2026-09-22 | One Trading API | channel and trading event list, sections 2 and 7 |
| S10 | CCXT Pro 4.5.68 `onetrading.js` | `server/node_modules/ccxt/js/src/pro/onetrading.js` | 2026-09-22 | CCXT | URL, `depth`, `price_points_mode`, `UPDATE_SUBSCRIPTION`, private frame types, sections 1, 2, 4 and 7 |
| S11 | CCXT 4.5.68 `onetrading.js` | `server/node_modules/ccxt/js/src/onetrading.js` | 2026-09-22 | CCXT | `contractSize` only for `PERP`, section 4 |
| S12 | ONEX Crypto Futures, Product Specifications, April 2026 | https://www.onetrading.com/futures-specifications | 2026-09-22 | ONEX | position valued in base units, section 4 |
| S13 | Supplemental Information to ONEX Rulebook and ONEX Futures, June 2026 | https://www.onetrading.com/supplemental_information_to_onex_rulebook_and_onex_futures | 2026-09-22 | ONEX | increments per base asset, section 4 |
| P1 | `ws-probe.mjs book`, three runs at 03:22, 03:24 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/onetrading/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 3 to 6 |
| P2 | `ws-probe.mjs depth` at 03:26 and 03:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/onetrading/ws-probe.mjs) | 2026-09-23 UTC | this host | level window, section 4 |
| P3 | `ws-probe.mjs channels`, three runs at 03:27, 03:28 and 03:52 UTC, the first with an earlier step list | [`ws-probe.mjs`](../../../scripts/probes/venues/onetrading/ws-probe.mjs) | 2026-09-23 UTC | this host | channel matrix, errors, subscription semantics, sections 2 to 4 and 6 |
| P4 | `ws-probe.mjs silence` and `deflate` at 03:29 and 03:53 UTC, the rerun with `SILENCE_MS=60000` | [`ws-probe.mjs`](../../../scripts/probes/venues/onetrading/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
