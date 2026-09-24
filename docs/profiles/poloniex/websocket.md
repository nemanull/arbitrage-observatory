# Poloniex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, which was 2026-09-23 03:31 to 03:44 UTC, from the development host near Seattle.

This profile covers the public Futures v3 WebSocket of Poloniex (CCXT id `poloniex`) for its one perpetual family, USDT-M, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/poloniex/ws-probe.mjs), and the capture is quoted beside the documented value.
Each mode ran twice, and a pair of numbers is the first run then the second.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, public | `wss://ws.poloniex.com/ws/v3/public`, W1 | open in 400 to 429 ms over twelve opens, all 18 perpetuals deliver |
| USDT-M perpetuals, private | `wss://ws.poloniex.com/ws/v3/private`, W1 | not probed |
| spot, public | `wss://ws.poloniex.com/ws/public`, as CCXT Pro uses it at `server/node_modules/ccxt/js/src/pro/poloniex.js` line 42 | not probed |

One socket carries the whole perpetual family, since there is only one.
A spot symbol on the futures URL is refused: `BTC_USDT` answered `{"message":"no valid symbols","event":"error"}`.
`ws.poloniex.com` resolved to the CloudFront name `d38h5mbjnwt2j4.cloudfront.net` and four addresses in `99.86.101.0/24` on 2026-09-22.
CCXT Pro 4.5.68 implements the spot socket only, so it offers no reference code for this one.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `book_lv2` | `{"event": "subscribe", "channel": ["book_lv2"], "symbols": [...]}` | 20 levels, "Real Time", snapshot then updates chained by `lid` and `id`, W2 | 2,016 to 10,239 updates per contract in 61 s, recommended |
| `book` | the same frame plus `"depth": 5`, `10` or `20`, default 5 | a whole book each push, "fastest interval 100 millisecond", W3 | at depth 20: 181 and 209 frames in 35 s on BTC, 66 and 78 on FIL, every frame a full book of 20 levels a side except FIL frames with 18 asks in the second run |
| `tickers` | contract list | "fastest interval 100 ms", best bid and ask with sizes, W4 | 29 to 256 frames per contract in 35 s |
| `trades` | contract list | real time, W4 | not probed |
| `index_price` | contract list | "Every 1 second", W4 | 35 to 39 frames per contract in 35 s |
| `mark_price` | contract list | "Every 1 second", W4 | 35 to 38 frames per contract in 35 s |
| `funding_rate` | contract list | "Every 1 minute", with `fR`, `fT`, `nFR`, `nFT`, W4 | 1 frame per contract in the first 35 s run and 2 in the second, the first one at subscribe |
| `symbol`, `limit_price`, `open_interest`, `liquidation_orders`, `candles_minute_1` and the other candle channels | | W4 | not probed |

The index, mark and funding channels together carry every `AnchorRow` column, see [`rest.md`](./rest.md) section 3.
The engine's anchor is a REST poll, so this profile recommends the REST calls and names these channels as the alternative.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | public and private URLs, and "the private endpoint only allows access to private channels", W1 | one public URL serves all 18 perpetuals. A spot symbol answers `no valid symbols` |
| subscribe frame shape | `{"event": "subscribe", "channel": ["<channel>"], "symbols": ["<symbol1>", ...]}`, or `"symbols": ["all"]`, W1 | 18 symbols in one frame got one ack and 18 snapshots. `"symbols": ["all"]` on `book_lv2` answered `{"message":"All symbols subscription is not allowed","event":"error"}` |
| unknown symbol expectation | `{"event": "error", "message": "Error Message"}`, W1 | `{"message":"no valid symbols","event":"error"}` in both runs |
| chunk unit and budget | "each connection is limited to 500 requests per second", W1 | 18 streams in one frame, no refusal |
| keepalive mechanism | client `{"event": "ping"}`, server `{"event": "pong"}`. "The server will not send ping requests." A plain text `ping` also works, W1 | `{"event":"pong"}` in 101 to 108 ms, to both the JSON and the plain text ping. No server ping on any socket |
| connection lifetime and maintenance notice | "The WebSockets server expects a message or a ping every 30 seconds or it will end the client's session without warning", W1 | a socket with nothing sent closed at 29.99 s in both runs, and a busy subscription with nothing sent closed at 30.73 and 30.96 s, all with code 1006. A ping every 20 s held a socket for the full 100 s. No maintenance channel is documented and none was seen |
| handshake and operation rate limits | "A single IP is limited to 2000 simultaneous connections on each of the public and private channels", W1 | opens took 400 to 429 ms. Limits not approached |
| public market data authentication | none on `/ws/v3/public`, W5 | none |
| message parse and routing | `{channel, data: [...], action}`, W2 | `channel` names the channel, each `data[i].s` names the contract, and `action` is `snapshot` or `update` on `book_lv2`. Other channels carry no `action` |
| subscribe acknowledgement shape | `{"event": "subscribe", "channel": <channel>}`, W1 | `{"event":"subscribe","channel":"book_lv2","symbols":[...]}`, one per channel even when a frame names several channels |
| symbol identifier format | `BTC_USDT_PERP` | identical to CCXT `market.id` and to every REST reply on 18 of 18 contracts |
| number representation | `[price, quantity]` string pairs | strings for price and size on `book_lv2`, `book`, `index_price`, `mark_price` and `funding_rate`. `fT` and `nFT` are JSON numbers on the socket and strings over REST |
| timestamp representation | `ts` push time and `cT` create time, both ms, W2 | integer ms. On the captured snapshots `ts` led `cT` by 83 and 1,211 ms |
| size unit | Not publicly specified on the channel pages | contracts of `ctVal` coins, which is CCXT `contractSize`, section 4 |
| sequence semantics | "If id of the last message does not match lid of the current message then the client has lost connection with the server and must re-subscribe", W2 | `lid` equals the previous `id` on every update after the snapshot: 0 gaps in 50,763 and 61,811 updates. Ids advance by more than 1 |
| idle repeat behaviour | not documented | no update repeated an id and no update was empty. The quietest contract went at most 2.0 and 2.1 s without a `book_lv2` frame |

## 4. The book channel in detail

`book_lv2` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each contract is `"action": "snapshot"` with exactly 20 bids and 20 asks, 18 of 18 contracts in both runs.
The first snapshot arrived 104 and 107 ms after the subscribe frame was sent.
No further snapshot came in 61 s on any contract.
The documentation says a later snapshot resets the book, W2, so a feed resets on every snapshot.
A second subscribe to the same contract was acknowledged as a success and, in the second run, followed by a new snapshot.

### Update semantics

An update carries `lid`, `id`, `ts`, `cT`, `s`, and `bids` and `asks` arrays of `[price, size]` string pairs.
A size of `"0"` deletes the level.
One side is often an empty array, and no update had both sides empty.

### Sequence and gap rule

```text
action = snapshot                 replace the book, last = id
action = update, lid = last       apply, last = id
action = update, lid ≠ last       gap: re-subscribe (documented), or terminate the socket (the engine's resync)
action = update, no snapshot yet  seen once, see below
```

The rule held on every update after a snapshot in both runs.
The first update after each snapshot had `lid` equal to the snapshot's `id`.
In the first run one update for `1000SHIB_USDT_PERP` arrived before that contract's snapshot, and the stream chained cleanly from its snapshot on.
The second run had no such update.
The ids inside the pre-snapshot update were not logged, because the probe learned to log them only after that run.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 18 of 18 in both runs | best first, ascending, on 18 of 18 |
| update | descending on every update with two or more bid levels, in both runs | ascending on every update with two or more ask levels |
| REST `orderBook` | descending at 5, 10, 20, 100 and 150 | ascending |

The update order held on every frame seen, but it is not documented, so a feed applies updates by price.

### Level window

The server keeps the stream at 20 levels per side.
A book built from the snapshot and every update held exactly 20 bids and 20 asks at its largest on 18 of 18 contracts in both runs.
So a level leaving the window arrives as a `"0"` size, and the engine's `depthLevels` of 20 is covered exactly, with no spare level.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the level | REST size at the same price | coins |
|---|---:|---|---|---|
| `BTC_USDT_PERP` | 0.001 | `"1101"` at the 86,660.52 ask | `"1101"` at the same ask, in the 40 s compare of the first run | 1.101 BTC |
| `FIL_USDT_PERP` | 1 | `"4549"` at the 1.0416 bid | `"4549"`, 10 s compare of the first run | 4,549 FIL |
| `ETH_USDT_PERP` | 0.01 | `"2"` at the 2,765.93 bid | `"2"`, 10 s compare of the first run | 0.02 ETH |

The unit is contracts, and one contract is `ctVal` coins, which CCXT reports as `contractSize` on 18 of 18 contracts, see [`rest.md`](./rest.md) section 2.
The engine's `sizeMul` therefore converts Poloniex sizes correctly.
Against the REST book read at 10 s and 40 s, FIL matched on 20 of 20 top levels in all four reads, and ETH on 20 of 20 in one.
The other reads matched on 3 to 18 of 20 where the touch had moved between the two reads.

### One-sided and empty books

No snapshot was one-sided and no maintained book lost a side after its snapshot, on 18 contracts over two 61 s runs.
The only one-sided moment was the pre-snapshot update above.
What the channel sends for a side with no orders is Not verified.

### Idle repeats

Nothing is repeated on `book_lv2`.
The `book` channel does resend: 1 to 5 of its frames per contract in 35 s were identical to the previous one, with a new `id`.

### Unknown, closed and wrong-family symbols

| request | reply | then |
|---|---|---|
| `book_lv2` `NOPE_USDT_PERP` | `{"message":"no valid symbols","event":"error"}` | nothing |
| `book_lv2` `BTC_USDT`, a spot symbol | `{"message":"no valid symbols","event":"error"}` | nothing |
| channel `nope` | `{"message":"Invalid channel values [\"nope\"]","event":"error"}` | |
| `book` with `"depth": 30` | `{"message":"Invalid depth: 30","event":"error"}` | |
| `book_lv2` `"symbols": ["all"]` | `{"message":"All symbols subscription is not allowed","event":"error"}` | |
| `book_lv2` `FIL_USDT_PERP` twice | the second is acknowledged like the first, not with the documented "Already subscribed" | a new snapshot in the second run |
| unsubscribe a contract not subscribed | `{"event":"unsubscribe","channel":"book_lv2","symbols":["FIL_USDT_PERP"]}`, not the documented "Not subscribed" | |
| text that is not JSON | `{"message":"Not JSON string：hello","event":"error"}` | the socket stays open |
| `{"event": "list_subscriptions"}` | `{"subscriptions":["book_lv2"]}` | |

A closed contract was not available to probe, since all 18 were `OPEN`.
An unknown symbol is refused by name, so a feed can log it from the error frame.
The error frame does not name the symbol it refused.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"event": "ping"}` or plain `ping`, server `{"event": "pong"}`, W1 | pong in 101 to 108 ms over six pings in the book runs |
| silence the server tolerates | 30 s without a client message, W1 | closed at 29.99 s with nothing subscribed, and at 30.73 and 30.96 s with a busy `book_lv2` stream and nothing sent, code 1006 and no close frame. Server traffic does not count |
| forced disconnect | Not publicly specified | none in 100 s with a ping every 20 s, in both runs |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no extension back, in both runs |
| handshake | | 400 to 429 ms |
| subscription limits | 2,000 connections per IP, 500 requests per second per connection, W1 | 18 streams on one socket, no refusal |
| throughput | | all 18 perpetuals on one socket for 61 s: 50,785 and 61,833 frames, median 808 and 969 per second, peak 1,298 and 2,004, 159 and 194 KB per second, 190 and 191 bytes per frame, 5.9 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays are cut to three levels.

Subscribe and its acknowledgement, which repeats the frame's symbols.

```json
{"event": "subscribe", "channel": ["book_lv2"], "symbols": ["BTC_USDT_PERP", "FIL_USDT_PERP"]}
```

```json
{"event":"subscribe","channel":"book_lv2","symbols":["BNB_USDT_PERP","ADA_USDT_PERP","TRX_USDT_PERP"]}
```

Snapshot.

```json
{"channel":"book_lv2","data":[{"asks":[["86657.22","1098"],["86660.60","1089"],["86665.80","1092"]],"bids":[["86651.86","1"],["86620.61","1636"],["86614.11","1642"]],"lid":6284171741,"id":6284171742,"ts":1790134293641,"s":"BTC_USDT_PERP","cT":1790134293558}],"action":"snapshot"}
```

Update, whose `lid` is the previous frame's `id`, with a deleted level.

```json
{"channel":"book_lv2","data":[{"asks":[],"bids":[["86581.72","545"],["86571.74","0"]],"lid":6284171742,"id":6284171757,"ts":1790134293834,"s":"BTC_USDT_PERP","cT":1790134293821}],"action":"update"}
```

Keepalive.

```json
{"event": "ping"}
```

```json
{"event":"pong"}
```

Errors.

```json
{"message":"no valid symbols","event":"error"}
```

```json
{"message":"All symbols subscription is not allowed","event":"error"}
```

Book at depth 20, cut to two levels, which carries no `lid` and no `action`.

```json
{"channel":"book","data":[{"asks":[["1.0477","9070"],["1.0483","11345"]],"bids":[["1.0451","4536"],["1.0445","22687"]],"id":157604038,"ts":1790134382550,"s":"FIL_USDT_PERP","cT":1790134382538}]}
```

Anchor channels.

```json
{"channel":"index_price","data":[{"ts":1790134383036,"s":"SUI_USDT_PERP","iPx":"1.0287"}]}
```

```json
{"channel":"mark_price","data":[{"ts":1790134383047,"s":"LTC_USDT_PERP","mPx":"63.54"}]}
```

```json
{"channel":"funding_rate","data":[{"ts":1790134382872,"s":"LINK_USDT_PERP","nFR":"0.0001","fR":"0.0001","fT":1790121600000,"nFT":1790150400000}]}
```

## 7. Private channels

Named for a future execution stage, from W5, not probed.
They use `wss://ws.poloniex.com/ws/v3/private` after an `auth` subscribe with a key, a timestamp and an HMAC-SHA256 signature.

- `account`, `orders`, `positions` and `trade`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.poloniex.com/ws/v3/public` | one family, one URL |
| channel | `book_lv2` | snapshot on subscribe, a strict `lid` chain, 20 levels |
| markets per connection | all 18 on one socket | 18 streams ran with 0 gaps at up to 2,004 frames per second, and the documented caps are 500 requests per second and 2,000 sockets |
| subscribe frames | one frame, `{"event": "subscribe", "channel": ["book_lv2"], "symbols": ["BTC_USDT_PERP", …]}` | a multi symbol frame gets one ack. `"all"` is refused |
| keepalive | `{"event": "ping"}` every 15 s, which is also CCXT Pro's `keepAlive` for the spot socket at `server/node_modules/ccxt/js/src/pro/poloniex.js` line 75 | the server closes a socket that sent nothing for 30 s, whatever it is streaming |
| `maxSilenceMs` | 30,000 | two ping intervals. The socket as a whole is never quiet for long, since the quietest contract sent a frame at least every 2.1 s |
| routing | `msg.channel === 'book_lv2'`, then each `data[i].s` is the `rawMarketId` | the contract id is carried as is |
| snapshot | `action === 'snapshot'`: `resetBook` and store `id` | documented replace semantics |
| update | apply only when `lid === last`, then store `id` | documented rule, 0 gaps observed |
| update before the contract's first snapshot | drop it and wait for the snapshot, without a resync | seen once on 1 of 36 subscriptions, and the snapshot followed. A resync would re-subscribe all 18 contracts for a condition the snapshot repairs |
| resync | `lid !== last` after a snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path, and re-subscribing is what the documentation asks for |
| error frames | log `event === 'error'` with its `message` | the error does not name the contract |
| receive time | stamp on arrival | `ts` is the push time and was not compared with the arrival clock |
| sizes | `Number()` of the string, in contracts | `contractSize` converts them |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| W1 | Futures Websocket API, Introduction | https://api-docs.poloniex.com/v3/futures/websocket/ | 2026-09-22 | Poloniex, global | URLs, 30 s rule, connection and request limits, ping and pong, subscribe, unsubscribe and error shapes, sections 1, 3 and 5 |
| W2 | Futures Websocket API, Order Book Level 2 | https://api-docs.poloniex.com/v3/futures/websocket/public/get-order-book-v2 | 2026-09-22 | Poloniex, global | `book_lv2`, 20 levels, `lid` and `id` rule, sections 2 to 4 |
| W3 | Futures Websocket API, Order Book | https://api-docs.poloniex.com/v3/futures/websocket/public/get-order-book | 2026-09-22 | Poloniex, global | `book` depths and 100 ms push, section 2 |
| W4 | Futures Websocket API, public channel pages for `tickers`, `trades`, `index_price`, `mark_price`, `funding_rate`, `symbol`, `limit_price`, `open_interest`, `liquidation_orders` and candles | https://api-docs.poloniex.com/v3/futures/websocket/public/symbol and its sibling pages | 2026-09-22 | Poloniex, global | channel names and push frequencies, section 2 |
| W5 | Futures Websocket API, Authentication, and the private `account`, `orders`, `positions` and `trade` pages | https://api-docs.poloniex.com/v3/futures/websocket/private/authentication | 2026-09-22 | Poloniex, global | private URL and channel names, sections 3 and 7 |
| W6 | CCXT Pro 4.5.68 `poloniex.js` | `server/node_modules/ccxt/js/src/pro/poloniex.js` | 2026-09-22 | CCXT | spot URL at line 42, `keepAlive` at line 75, sections 1 and 8 |
| P1 | `ws-probe.mjs book`, runs at 03:31 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/poloniex/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 6 and 8 |
| P2 | `ws-probe.mjs channels`, runs at 03:33 and 03:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/poloniex/ws-probe.mjs) | 2026-09-22 | this host | sections 2 and 6 |
| P3 | `ws-probe.mjs errors` and `deflate`, runs at 03:31 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/poloniex/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence`, runs at 03:33 and 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/poloniex/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
