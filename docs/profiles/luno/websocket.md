# Luno WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 01:30 to 01:39 UTC, from the development host near Seattle.

This profile covers the Luno market stream (CCXT id `luno`) for spot pairs, because Luno lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

The documentation says the market stream needs an API key.
The client "must start by sending API key credentials", S1.
This probe sent no credential of any kind.
A socket that stayed silent was closed after 10 s with `auth_timeout`, and a socket that sent text that is not JSON was closed at once with `invalid_credentials`.
A socket whose first frame was the empty JSON object `{}` got the whole book and every update after it, on all 11 sockets that tried it on a listed pair.
That keyless path is undocumented, so section 8 does not build on it, and the book facts in section 4 come from it.

## 1. Endpoints

| stream | documented URL | probed |
|---|---|---|
| market stream, one pair per socket | `wss://ws.luno.com/api/1/stream/:pair`, S1 | HTTP 101 in 606 to 748 ms over 23 opens, served by Cloudflare edges `YVR` and `SEA` |
| user stream, private | `wss://ws.luno.com/api/1/userstream`, S1 | not opened |

The pair is part of the URL, so one socket carries exactly one market.
There is no settlement family split, since every market is spot.
`ws.luno.com` resolved to the same two Cloudflare IPv4 addresses as `api.luno.com`, `104.18.34.135` and `172.64.153.121`, see [`rest.md`](./rest.md) section 1.
The changelog dates the host to 2017-07-02: "Updated websocket server to wss://ws.luno.com.", S1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| market stream | every resting order with its id, then create, delete, trade and status updates | the whole book, no depth option, updates sent "as quickly as possible", S1 | snapshot then updates on every listed pair tried |
| best bid and ask | none | | the REST `tickers` call carries bid and ask, see [`rest.md`](./rest.md) section 3 |
| trades | inside the market stream as `trade_updates` | | 5 trades in 4 frames on `XBTZAR` in 45 s, and none in the second pass |
| ticker, mark, index, funding | none | | |

CCXT Pro 4.5.68 builds `watchOrderBook` and `watchTrades` on this one stream and marks `watchTicker` false, at `server/node_modules/ccxt/js/src/pro/luno.js` lines 16 to 23.
It calls `checkRequiredCredentials` before it connects, at line 149, and sends `api_key_id` and `api_key_secret`, at lines 159 to 162.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per pair, S1 | one URL per pair. An unknown pair still gets HTTP 101 |
| subscribe frame shape | no subscribe frame. The first client message is `{"api_key_id": "abcdef", "api_key_secret": "api_key_secret_goes_here"}`, S1 | `{}` in its place was answered with the book on 11 of 11 sockets on listed pairs |
| unknown symbol expectation | Not publicly specified | `NOPEUSDT` opens with 101. After `{}` it answers `{"error_code":"invalid_market","error":"NOPEUSDT"}` and closes with 1000 in 178 and 196 ms. Left silent, it times out like any socket |
| chunk unit and budget | one pair per socket. "The streaming API is limited to 50 sessions open simultaneously. Calls in excess of this limit will receive a `session limit exceeded` message.", S2 | 12 sockets opened in one burst in the second pass, none refused. The 50 session cap itself was not probed |
| keepalive mechanism | "Both the client and server must send regular keep alive messages to avoid disconnection during periods of low update message activity." "An empty message is a keep alive message. Ping/Pong messages are supported.", S1 | the server sent a protocol ping every 13.5 s, at 14.1, 27.6 and 41.1 s after the socket was created on all four book sockets of the second pass. A quiet pair also got the text frame `""` every 20.0 s. A client protocol ping got its pong in 150 to 160 ms |
| connection lifetime and maintenance notice | a `status_update` per market, for example `POSTONLY` during a halt, S1 | no forced close within the 45 s and 60 s caps, and no `status_update` seen |
| handshake and operation rate limits | 50 sessions, S2. "It is important that clients implement some kind of backoff to avoid being rate limited in case of errors.", S1 | 12 opens in one burst were accepted |
| public market data authentication | an API key is required, S1 | not enforced for a client that sends `{}`. A silent client is closed at 10.0 s with `auth_timeout`, and a frame that is not JSON is refused with `invalid_credentials` |
| message parse and routing | a snapshot has `asks` and `bids`, an update has `sequence` and the four update fields, S1 | same. No frame names its pair, so routing is by connection |
| subscribe acknowledgement shape | none, the snapshot comes first | the snapshot arrived 156 to 175 ms after the socket opened on small books, and 1,097 and 1,171 ms on the 1.1 MB `XBTZAR` book |
| symbol identifier format | `XBTZAR`, base then counter with no separator, and bitcoin spelled `XBT` | identical to CCXT `market.id`, to REST `market_id` and to REST ticker `pair` on 145 of 145 markets. CCXT maps `XBT` to `BTC` through `commonCurrencies` at `server/node_modules/ccxt/js/src/base/Exchange.js` line 2419 |
| number representation | "Prices and volumes are always represented as a decimal strings", S2 | strings, at the market's price scale on the stream (`"2765.00"`) and with 18 decimals on REST `orderbook_top` (`"2765.000000000000000000"`). The message `sequence` is a string and a trade's own `sequence` is a JSON number |
| timestamp representation | milliseconds since the epoch, S2, although the stream example shows `1469031991` | integer milliseconds on every frame, never decreasing. Wall clock at arrival minus `timestamp` was 86 to 93 ms at minimum and 134 to 154 ms at the median in the second pass |
| size unit | `volume` in the base currency | base currency. The top five price levels summed from the stream equalled REST `orderbook_top` on 5 of 5 levels per side in 13 of 16 side comparisons, and the misses were books that moved during the 160 to 228 ms REST read |
| sequence semantics | "The message with sequence number n can be applied to state sequence n-1 to produce state sequence n." An out of sequence update means the client "cannot continue and must reinitialise the state", S1 | 0 gaps in 9,653 updates over eight sockets. The first update was the snapshot sequence plus one. Updates with all four fields empty exist and advance the sequence |
| idle repeat behaviour | not documented | nothing is repeated. A quiet pair sends only `""` every 20 s and the server pings. `PAXGUSDT` sent no update in 45 s, and between the two runs five minutes apart its sequence moved from 1386130 to 1386131 and its book `timestamp` from 01:30:00.562 to 01:35:00.561 UTC |

The 9,653 updates are 2,471 and 366 on `XBTUSDT` in the `{}` socket of the two refusal runs, then 1,457 and 867 on `XBTUSDT`, 43 and 39 on `ETHUSDT`, and 2,281 and 2,129 on `XBTZAR` in the two book runs.
`PAXGUSDT` sent none in either book run.

## 4. The book channel in detail

### Snapshot on subscribe

The first frame after `{}` is the whole book, one entry per resting order: `{"sequence", "asks": [{"id", "price", "volume"}], "bids": [...], "status", "timestamp"}`.
It carries no pair name and no depth limit.

| pair | orders, bids and asks | distinct prices, bids and asks | bytes | after open |
|---|---|---|---:|---:|
| `XBTUSDT` | 163 and 99, then 163 and 97 | 113 and 78, then 113 and 76 | 16,251 and 16,127 | 157 and 163 ms |
| `ETHUSDT` | 48 and 107, then 48 and 106 | 28 and 86, then 27 and 85 | 9,620 and 9,558 | 157 and 156 ms |
| `PAXGUSDT` | 17 and 14 | 14 and 12 | 2,021 | 158 and 163 ms |
| `XBTZAR` | 17,172 and 1,428, then 17,173 and 1,431 | 1,850 and 775, then 1,849 and 776 | 1,112,542 and 1,112,804 | 1,097 and 1,171 ms |
| `ETHAUD` | 0 and 0 | | 88 | 160 ms |

Bids were in descending price and asks in ascending price in all ten non-empty snapshots captured.
Several orders often share a price, so the snapshot is not a level list.
A snapshot is sent once per connection, and the documentation gives no way to ask for another except reconnecting, S1.

### Delta semantics

Each update message holds a `sequence`, a `timestamp`, and four fields: `trade_updates`, an array, and `create_update`, `delete_update` and `status_update`, each null or one object, S1.

| update | effect, from S1 | seen |
|---|---|---|
| create | add an order `{order_id, type: "BID" or "ASK", price, volume}` | 4,827 frames |
| delete | remove the order `{order_id}` | 4,820 frames |
| trade | "Reduce the outstanding volume of an Order in the Order Book (`maker_order_id`)", with `base` in the base currency | 4 frames holding 5 trades, all on `XBTZAR` |
| status | set the market status, for example `POSTONLY` | none |
| none of the four | nothing, but the sequence still advances | 2 frames on `XBTZAR` in the second pass |

The counts cover all eight sockets that carried updates.
No frame carried more than one kind in the 9,653 updates, and the documentation allows several: "A message may contain multiple updates which must be applied atomically and in order.", S1.
A market order that fills at once sends only trade updates, and a partly filled limit order sends trades plus one create holding the remaining volume, S1.

A fully filled maker order leaves the book through its trade updates alone.
Two `XBTZAR` bids of 0.021775 at 1407088 were each filled by two trades, 0.006532 and 0.015243, and 0.006523 and 0.015252, and no delete for either followed before the capture ended.
A 0.0004 bid hit for 0.000399 did get a delete, 409 sequence numbers later.
So a feed subtracts each trade's `base` from its maker order and drops the order at zero.
CCXT Pro's `handleDelta` applies creates and deletes and ignores `trade_updates`, at `server/node_modules/ccxt/js/src/pro/luno.js` lines 252 to 315, so a CCXT Pro book keeps filled volume until a delete arrives.

### Sequence and gap rule

```text
snapshot                     replace every order, last = sequence
update, sequence = last + 1  apply creates, deletes and trades in order, last = sequence
update, sequence ≠ last + 1  gap: close the socket and reconnect for a new snapshot (documented)
""                           keepalive, no sequence, ignore
```

The rule held on all 9,653 updates, with 0 gaps.
On error or timeout "the client should close the connection and reconnect in order to reinitialise its state", S1, which is what the engine's `resync` does at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 296 to 315.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | orders in descending price, 10 of 10 | orders in ascending price, 10 of 10 |
| update | one order per create or delete, so no order applies | same |
| REST `orderbook_top` | descending, aggregated per price, S2 | ascending |
| REST `orderbook` | descending, one entry per order, S2 | ascending |

### Level window

None.
The stream carries every order in the book.
The engine keeps `depthLevels` per side, 20 by default, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, so a feed would aggregate orders by price and hand over the best 20 levels.
On `XBTZAR` that means holding about 18,600 orders to publish 40 levels.

### Size unit against CCXT `contractSize`

The `volume` is in the base currency, S1.
CCXT returns `contractSize` undefined for every Luno market, at `server/node_modules/ccxt/js/src/luno.js` line 552, which the connector turns into 1, see [`rest.md`](./rest.md) section 2.

| pair | run | stream top 5 equal to REST, bids | asks | REST read |
|---|---|---:|---:|---:|
| `XBTUSDT` | first | 4 | 5 | 228 ms |
| `ETHUSDT` | first | 5 | 5 | 169 ms |
| `XBTZAR` | first | 5 | 5 | 189 ms |
| `PAXGUSDT` | first | 5 | 5 | 160 ms |
| `XBTUSDT` | second | 5 | 1 | 219 ms |
| `ETHUSDT` | second | 5 | 5 | 172 ms |
| `XBTZAR` | second | 0 | 5 | 176 ms |
| `PAXGUSDT` | second | 5 | 5 | 163 ms |

Each miss is a price or size that changed between the two reads, since the stream kept moving while the REST reply was in flight.
On the second `XBTZAR` read the stream's best bid was 1403128 and REST's was 1403129.

### One-sided and empty books

`ETHAUD` has no order on either side, and its snapshot was `{"sequence":"149205858","asks":[],"bids":[],"timestamp":1790127301388,"status":"ACTIVE"}`.
The REST ticker shows the same empty sides as `"0.00"`, see [`rest.md`](./rest.md) section 3.
A one-sided book was not captured on the stream.

### Idle repeats

Nothing is repeated.
A quiet pair sends `""` about every 20 s: at 20,785 and 40,794 ms after the socket was created on `PAXGUSDT` in the first run, and 19,999 ms apart in the second.
The server's protocol pings came every 13.5 s on busy and quiet pairs alike.
A quiet book's `timestamp` moves at each five minute mark with no change at the touch.
`PAXGUSDT` snapshots read 01:30:00.562 and 01:35:00.561 UTC with sequences 1386130 and 1386131, and the `ETHAUD` snapshot read 01:35:01.388.
So a quiet market likely gets one sequenced update with nothing in it every five minutes, which is an inference from two readings.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `NOPEUSDT`, first frame `{}` | `{"error_code":"invalid_market","error":"NOPEUSDT"}` | close 1000 |
| `NOPEUSDT`, no frame | `{"error_code":"auth_timeout","error":"you took too long to provide credentials"}` at 10.0 s | close 1000 |
| `XBTUSDT`, no frame, with or without protocol pings | `auth_timeout` at 10.0 s | close 1000 |
| `XBTUSDT`, first frame `hello` | `{"error_code":"invalid_credentials","error":"you provided an invalid credentials message"}` | close 1000 |
| `ETHAUD`, an empty book | a snapshot with two empty arrays | stays open |

All 145 markets were `ACTIVE`, so a closed or suspended market could not be probed.
The documentation says a halted market reports `POSTONLY` through `status_update`, S1, and the circuit breaker halts a market for 5 minutes, see [`fees.md`](./fees.md) section 7.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | both sides send keep alive messages, empty messages and protocol ping and pong, S1 | server protocol ping every 13.5 s, which the `ws` library answers. Server text `""` every 20 s on a quiet pair. The probe sent no keepalive of its own after `{}`, and every book socket stayed open to its cap |
| silence the server tolerates | Not publicly specified | before credentials, 10.0 s, then `auth_timeout`, close 1000, on eight sockets over two runs, whether the client sent protocol pings or not. After `{}`, at least 59 s with only the automatic pong replies |
| forced disconnect | Not publicly specified | none within 60 s |
| maintenance notice | Not publicly specified beyond `status_update` | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs |
| handshake | | 606 to 748 ms to open over 23 opens, which include the TLS setup to a Cloudflare edge |
| subscription limits | 50 simultaneous sessions, S2 | not reached, 12 at once was the most opened |
| throughput | | `XBTUSDT` 24 to 33 frames a second at the median and 47 to 50 at peak, 3.5 to 5.9 KB a second without the snapshot. `XBTZAR` 51 frames a second at the median and 70 to 74 at peak, 8.8 to 9.4 KB a second without its 1.1 MB snapshot. `ETHUSDT` 1 to 3 a second. `JSON.parse` took a median of 5 to 20 µs per frame on the three busy pairs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22 local time.
Arrays marked `…` are cut.

First client frame, which the documentation says must carry an API key and which the probe sent empty.

```json
{}
```

Snapshot, first three orders per side kept.

```json
{"sequence":"74538167","asks":[{"id":"BXFE5AZB7UUXWPT","price":"2765.00","volume":"3.925038"},{"id":"BXHXHWTVVN6GYRE","price":"2766.00","volume":"0.30"},{"id":"BXMESRG8ESH3VTG","price":"2766.00","volume":"0.20"}],"bids":[{"id":"BXCPTNDKTTBQ3K4","price":"2762.00","volume":"0.026792"},{"id":"BXMW35EHZ7VEVW5","price":"2761.00","volume":"0.30"},{"id":"BXHERKBTV65VPHP","price":"2760.00","volume":"0.20"}],"status":"ACTIVE","timestamp":1790127197639}
```

Delete, then a create of the same price and volume under a new id.

```json
{"sequence":"74538168","trade_updates":[],"create_update":null,"delete_update":{"order_id":"BXFE5AZB7UUXWPT"},"status_update":null,"timestamp":1790127201650}
```

```json
{"sequence":"74538169","trade_updates":[],"create_update":{"order_id":"BXJHJ5MXAAQNYCQ","type":"ASK","price":"2765.00","volume":"3.925038"},"delete_update":null,"status_update":null,"timestamp":1790127203186}
```

Trade, which reduces the maker order and carries the deprecated `order_id` beside `maker_order_id`.

```json
{"sequence":"4530030191","trade_updates":[{"sequence":33279896,"base":"0.000399","counter":"561.409758","maker_order_id":"BXCSZDNQKCDCDBN","taker_order_id":"BXD7C9SRW79V6B2","order_id":"BXCSZDNQKCDCDBN"}],"create_update":null,"delete_update":null,"status_update":null,"timestamp":1790127208094}
```

An update with nothing in it, which still takes a sequence number.

```json
{"sequence":"4530047084","trade_updates":[],"create_update":null,"delete_update":null,"status_update":null,"timestamp":1790127540407}
```

Keepalive text frame, two bytes, a JSON empty string.

```json
""
```

Empty book.

```json
{"sequence":"149205858","asks":[],"bids":[],"timestamp":1790127301388,"status":"ACTIVE"}
```

Errors.

```json
{"error_code":"auth_timeout","error":"you took too long to provide credentials"}
```

```json
{"error_code":"invalid_credentials","error":"you provided an invalid credentials message"}
```

```json
{"error_code":"invalid_market","error":"NOPEUSDT"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- `wss://ws.luno.com/api/1/userstream` sends `order_status`, `order_fill` and `balance_update` messages after the same API key frame.
- The user stream replays what a client missed, S1: "The server keeps a cache of all messages sent in the last 5 minutes."
  "When reconnecting, messages generated while the client was disconnected will be resent."
- Orders are placed over REST only, `POST /api/1/postorder` and `POST /api/1/marketorder`, as CCXT lists them at `server/node_modules/ccxt/js/src/luno.js` lines 190 and 191.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Luno cannot join the engine today, because the connector keeps swap markets only and Luno has none, see [`fees.md`](./fees.md) section 9.
The shape below is what a spot feed would need if spot legs were ever admitted.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket per pair, `wss://ws.luno.com/api/1/stream/<rawMarketId>`, 16 sockets for the USDT and USDC pairs | the pair is in the URL, and 16 is under the 50 session cap |
| first frame | an API key frame `{"api_key_id", "api_key_secret"}` from a key with no trading permission | the documented contract, S1. The keyless `{}` worked on 2026-09-22 but is not documented and may stop |
| markets per connection | 1 | fixed by the protocol |
| book state | a map from order id to side, price and volume, aggregated per price into `setBid` and `setAsk` for the prices an update touched | the stream is order by order, and the engine's book is by price level |
| trades | subtract `base` from `maker_order_id` and drop the order at zero | a filled order gets no delete |
| sequence | apply only when `sequence === last + 1`, including updates with nothing in them | documented rule, 0 gaps observed |
| resync | a gap, or an update before the snapshot: `resync`, which terminates the socket and reconnects | the documentation asks for a reconnect, and a new snapshot only comes with a new connection |
| keepalive | a protocol ping every 15 s | the documentation asks the client to send keepalives, and a ping is answered in about 150 ms |
| `maxSilenceMs` | 45,000 | the server pings every 13.5 s and sends `""` every 20 s, so 45 s is three missed keepalives |
| routing | by connection | no frame names its pair |
| receive time | stamp on arrival | the frame `timestamp` trails arrival by 86 ms or more |
| sizes | `Number()` of the string, base currency, `contractSize` 1 | spot volume |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |
| large books | expect a 1.1 MB snapshot on a pair like `XBTZAR` | the snapshot holds every order |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Luno API documentation, section "Streaming API" and "Changelog", OpenAPI 1.2.5 embedded in the page | https://www.luno.com/en/developers/api | 2026-09-22 | Luno, all regions | URLs, credentials frame, snapshot and update formats, sequence rule, keepalive, user stream, sections 1 to 8 |
| S2 | Luno API documentation, sections "Rate Limiting", "Conventions" and "Market" | https://www.luno.com/en/developers/api | 2026-09-22 | Luno, all regions | 50 sessions, decimal strings, millisecond timestamps, REST book order, sections 3 and 4 |
| S3 | CCXT Pro 4.5.68 `luno.js` | `server/node_modules/ccxt/js/src/pro/luno.js` | 2026-09-22 | CCXT | URL, credential check, `handleDelta`, sections 2 and 4 |
| S4 | CCXT 4.5.68 `luno.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/luno.js` | 2026-09-22 | CCXT | `contractSize`, `XBT` mapping, order calls, sections 3, 4 and 7 |
| P3 | `ws-probe.mjs refusal` at 01:30 UTC on 2026-09-23, with the `{}` socket held 60 s | [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs) | 2026-09-22 | this host | refusals, keepalive, deflate, the first book, sections 1, 3, 5 and 6 |
| P4 | `ws-probe.mjs book` at 01:33 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs) | 2026-09-22 | this host | snapshot, updates, trades, REST compare, keepalive, sections 3 to 6 |
| P7 | `ws-probe.mjs refusal`, second pass at 01:38 UTC on 2026-09-23, with the `{}` socket held 15 s | [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs) | 2026-09-22 | this host | the same refusals, second reading |
| P8 | `ws-probe.mjs book`, second pass at 01:38 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs) | 2026-09-22 | this host | ping times, update age, the empty `ETHAUD` book, no-op updates, second readings |

The first `refusal` run held the `{}` socket for 60 s, and the script now caps that socket at 15 s, which is the version the second pass ran.
Socket time over the four runs was about 9 minutes.
