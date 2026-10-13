# GRVT WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:26 to 22:34 UTC for the first pass and from 22:47 to 22:51 UTC for the second, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market data socket of GRVT (CCXT id `grvt`), with the book channel in detail.
GRVT lists one perpetual family, linear perpetuals quoted and settled in USDT, and one socket carries all of them.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/grvt/ws-probe.py), and the capture is quoted beside the documented value.
P1 is the first pass of each mode and P2 the second pass, listed in section 9.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC.
Fees and access are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).
The documentation host `api-docs.grvt.io` refuses curl's and httpx's default clients with a Cloudflare 403, so S1 and S2 were read with a browser user agent, see [`rest.md`](./rest.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every perpetual, full field names | `wss://market-data.grvt.io/ws/full`, S1 and S2 | upgrade 101 from Cloudflare edges `YVR` and `SEA`, `server: cloudflare`, P1 and P2 |
| the same with short field names | `wss://market-data.grvt.io/ws/lite`, S1 | not probed |
| the legacy subscribe format | `wss://market-data.grvt.io/ws`, used by the official Python SDK, S5 | not probed |
| testnet | `wss://market-data.testnet.grvt.io/ws/full`, S3 | not probed |

One socket carried crypto, equity and commodity perpetuals together in the batch mode, P1 and P2.
The overview page, S2, says "GRVT's services are hosted in AWS Tokyo (ap-northeast-1)", and the socket terminates at a Cloudflare edge near this host.

## 2. Channel matrix for public market data

Rates are the `rate` part of the selector, "The minimal rate at which we publish feeds (in milliseconds)", S1.
Cadences are over 40 s per run, and pairs of numbers are P1 and P2.

| channel | selector | payload | documented rates, S1 | probed |
|---|---|---|---|---|
| `v1.book.d` | `<instrument>@<rate>` | a whole-book snapshot on subscribe, then changed levels | 50, 100, 500, 1,000 ms, depth unlimited | at 100 ms: `BTC` 302 and 281 frames in 40 s, event step p50 100 ms and max 800 and 1,100 ms, about 300 KB. At 50 ms on `SOL`: step min 48.1 and 49.8 ms and p50 100 ms |
| `v1.book.s` | `<instrument>@<rate>-<depth>` | a whole snapshot every push | 500 or 1,000 ms, depth 10, 50, 100 or 500 | `BTC@500-50`: 80 and 79 frames in 40 s, step p50 500 ms, 50 levels per side, about 5.2 KB a frame |
| `v1.ticker.d` | `<instrument>@<rate>` | a full ticker on subscribe, then changed fields only | 100, 200, 500, 1,000, 5,000 ms | `BTC@100`: 96 and 104 frames in 40 s, `mark_price` changed 55 and 46 times and `index_price` 49 and 41 times, `funding_rate` never |
| `v1.ticker.s` | `<instrument>@<rate>` | the full ticker every push | 500, 1,000, 5,000 ms | `ETH@500`: 63 and 57 frames in 40 s, step p50 500 ms, about 880 bytes a frame. `BCH@5000`, the thinnest market, sent 22 frames in 100 s, one every 5 s after its acknowledgement and snapshot, silence mode |
| `v1.mini.d` | `<instrument>@<rate>` | mark, index, last, mid and the touch, changed fields only | 0 (raw), 50, 100, 200, 500, 1,000, 5,000 ms | `BTC@0`: 325 and 308 frames in 40 s, step p50 6.3 and 11.1 ms, `mark_price` changed 62 and 48 times |
| `v1.mini.s` | `<instrument>@<rate>` | the mini ticker every push | 200, 500, 1,000, 5,000 ms | not probed alone, and a frame pairing `BTC_USDT_Perp@1000` with an unknown name was refused, P1 and P2 errors mode |
| `v1.trade` | `<instrument>@<limit>` | trades | limit 50, 200, 500, 1,000 | not probed |
| `v1.candle` | `<instrument>@<interval>-<type>` | candles | | not probed |

No channel carries mark, index or funding alone.
`v1.ticker.d` and `v1.ticker.s` carry `mark_price`, `index_price`, `funding_rate`, `next_funding_time`, `status` and `session`, and their first frame also carries `funding_interval_hours`, P1 and P2.
`v1.mini.*` carries `mark_price` and `index_price` but no funding, S1 and P1.
The socket also answers REST methods as JSON-RPC calls, such as `{"method":"v1/ticker"}`, and the help center counts such calls against the REST limits, S1 and S4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market data URL per encoding, `full` or `lite`, S2 | one socket carried every asset class, P1 |
| subscribe frame shape | `{"jsonrpc":"2.0","method":"subscribe","params":{"stream":"v1.book.d","selectors":["BTC_USDT_Perp@100"]},"id":1}`, a list of selectors per frame, S1 | 50 selectors in one frame were acknowledged as one request, P1 and P2 batch mode |
| unknown symbol expectation | error 3000 "Instrument is invalid", HTTP status 400, S1 | `{"jsonrpc":"2.0","error":{"code":3000,"message":"Instrument is invalid"},"id":11,"method":"subscribe"}`, and the socket stayed open. A frame with one valid and one unknown selector was refused whole, with no feed for the valid one, P1 and P2 |
| chunk unit and budget | 150 concurrent streams and 300 subscriptions a minute for market data at every tier, S4 | 100 selectors on one socket, two thirds of the cap, all acknowledged and served, P1 and P2. Whether the cap counts per socket or per address is not stated, and the probe tried nothing above 100. On 2026-10-12 the adapter held 368 streams from this host on four sockets, see section 8 |
| keepalive mechanism | none documented for market data | the server sends a protocol ping with an empty payload every 5.0 s, and the client answers with a pong, P1 and P2 |
| connection lifetime and maintenance notice | not documented | no forced close within 100 s on a socket that answered pings, P1 and P2 silence mode |
| handshake and operation rate limits | not documented beyond S4 | three sockets opened together with no refusal, P1 and P2 |
| public market data authentication | none, S2 | none |
| message parse and routing | `{stream, selector, sequence_number, feed, prev_sequence_number}` for data and the JSON-RPC envelope for replies, S1 | route a frame with `result` or `error` as a reply, and every other frame on `stream`, then `selector` or `feed.instrument` |
| subscribe acknowledgement shape | `result` with `stream`, `subs`, `unsubs`, `num_snapshots` and `first_sequence_number`, one entry per selector in `subs` order, S1 | as documented, plus an undocumented `latest_sequence_number` that is one less than `first_sequence_number` on every selector, P1 and P2 |
| symbol identifier format | `BTC_USDT_Perp`, S1 | the instrument name of the catalog, which is CCXT's `market.id`, spelled the same in `selector` and in `feed.instrument`. A lowercase name is refused with 3000, P1 |
| number representation | prices and sizes as decimal strings, `num_orders` as an integer, S1 | as documented, and sequence numbers are strings, P1 |
| timestamp representation | `event_time` in Unix nanoseconds, a string, "stamped by our core cluster", S2 | as documented. A snapshot's `event_time` is the time of the book's last change, not of the push, see section 4 |
| size unit | "The number of assets offered, expressed in base asset decimal units", S1 | coins of the base, which matches CCXT's `contractSize` 1. `KBONK`, `KPEPE` and `KSHIB` quote 1,000 coins, see [`rest.md`](./rest.md) section 2 |
| sequence semantics | per stream and selector, snapshots carry 0, deltas count up by 1, and "If it decreases, or increases by more than 1. Please reconnect", S2 | per selector as documented, with `prev_sequence_number` equal to the previous delta's number. No gap, duplicate or mismatch in 2,273 book deltas, 1,095 ticker frames after their snapshots and 12,730 batch frames, P1 and P2 |
| idle repeat behaviour | not documented | `v1.book.d` and `v1.ticker.d` send nothing while nothing changes: `BCH` went 5,000 ms without a delta, and three or four equity books sent none in 60 s. `v1.book.s` and `v1.ticker.s` push on their clock, P1 and P2 |

## 4. The book channel in detail

### Snapshot and deltas

`v1.book.d` sends one snapshot per selector right after the acknowledgement, with `sequence_number` and `prev_sequence_number` both `"0"`, P1 and P2.
The snapshot holds the whole book: 226 bids and 101 asks on `BTC`, 120 and 239 on `ETH`, 256 and 227 on `SOL`, and 21 and 21 on `BCH` in P1, and 230 and 68, 121 and 247, 247 and 227, and 24 and 22 in P2.
Each delta carries only the levels that changed, each with its new absolute size, and a size of `"0.0"` with `num_orders` 0 removes the level, S1 and P1.
A delta can carry an empty side, `"asks":[]`, P1.
`BTC` deltas carried a median of 5 to 7 levels, and 2,296 to 2,372 of their levels were removals in 40 s, P1 and P2.

### Sequence and gap rule

The acknowledgement lists `first_sequence_number` per selector, and the first delta of each selector carried exactly that number in every run, P1 and P2.
Every later delta carried the previous number plus 1, with `prev_sequence_number` equal to the previous delta's `sequence_number`, P1 and P2.
The numbers count per selector: `BTC`, `ETH` and `BCH` on one socket started at 1,279,687, 1,113,455 and 265,019, P1.
S2 adds that duplicates "are possible due to network retries" and should be ignored, and none arrived, P1 and P2.
`v1.book.s` frames after the first also carry rising numbers, although S1 says all snapshot payloads carry 0, P1 and P2.

### Delta book against the snapshot channel

Each of the 80 `BTC@500-50` snapshots in P1 and the 79 in P2 matched the top 20 levels of the book rebuilt from `BTC@100` deltas.
24 and 23 matched the delta book as of the last delta at or before the snapshot's `event_time`, and 56 in each pass matched it one delta later.
No snapshot matched neither, and no rebuilt book was ever crossed, P1 and P2.

### Checksum

None is documented, S1, and no frame carries one, P1 and P2.

### Level order on the wire

Snapshots list bids from the highest price down and asks from the lowest up, P1 and P2.
Delta levels are applied by price, so their order does not matter.

### Size unit against CCXT `contractSize`

Sizes are coins of the base asset, S1, and CCXT 4.5.68 sets `contractSize` to 1 with the comment "tbd, vague response from support" at `grvt.js` line 724, S6.
The `BTC` snapshot's sizes, such as 4.167 at the touch, read as coins beside a `min_size` of 0.001, see [`rest.md`](./rest.md) section 2.

### What the API book leaves out

Retail Price Improvement orders rest in the matching engine but "are excluded from the API order book and market data", and orders sent through the API cannot match them, S7.
So the socket's book is the book an API taker can hit.

### Age at arrival

`event_time` to arrival on this host was a median of 56.5 to 58.9 ms on deltas, with a minimum of 53.3 ms, P1 and P2.
A snapshot's `event_time` is the last change of that book, so a quiet equity book's snapshot arrived 71.5 s and 139.3 s "old" in the batch mode, P1 and P2.
A feed should stamp arrival as the book's time.

### One-sided, empty and quiet books

None of the four books of the `book` mode was one-sided or empty, P1 and P2.
`BCH`, the thinnest crypto perpetual by 24 h quote volume, held 21 to 24 levels a side and traded 550.76 USDT in 24 h, P1 and P2.
`CRWD`, `CSCO` and `DIS` in P1, and `BMNR`, `BRKB`, `BX` and `CSCO` in P2, sent their snapshot and no delta in 60 s, between 18:31 and 18:50 New York time.

### Unknown, delisted and malformed subscriptions

| case | reply | socket |
|---|---|---|
| unknown instrument `NOPE_USDT_Perp@100` | error 3000 "Instrument is invalid" | stays open |
| delisted instrument `TON_USDT_Perp@100` | acknowledged, with `first_sequence_number` `"1"` and `latest_sequence_number` `"0"`, and one snapshot frame followed, P2. The REST book of the same name was empty with `event_time` `"0"`, see [`rest.md`](./rest.md) section 6 | stays open |
| lowercase `btc_usdt_perp@100` | error 3000 | stays open |
| unknown stream `v1.nope` | error 1100 "Stream not supported on this gateway" | stays open |
| delta rate 20 | error 3030 "Feed rate is invalid" | stays open |
| snapshot depth 20 | error 3031 "Depth is invalid" | stays open |
| a selector without `@rate` | error 3030 | stays open |
| one valid and one unknown selector in one frame | error 3000, and no feed for the valid one | stays open |
| method `ping` | error 1200 "RPC method not found" | stays open |
| the text `hello` | error 1003 "Request could not be processed due to malformed syntax", with `id` 0 | stays open |

Every other row is P1 and P2, errors mode.

## 5. Session

| item | documented | probed |
|---|---|---|
| server keepalive | none documented | a protocol ping with an empty payload every 5.0 s on every socket, subscribed or idle, P1 and P2 |
| client keepalive | none documented. CCXT Pro sets `keepAlive` 300,000 ms at `pro/grvt.js` line 49, S6 | not needed: a socket that sent nothing but pongs stayed open 100 s, P1 and P2 |
| unanswered pings | not documented | a subscribed socket that left every ping unanswered was dropped after 26.1 s and five pings, with code 1006 and no close frame, in both passes, P1 and P2 |
| idle socket | not documented | a socket with no subscription that answered pings stayed open 100 s, P1 and P2 |
| compression | not documented | none: a handshake that offered permessage-deflate got no `Sec-WebSocket-Extensions` header back, P1 and P2 |
| stream caps | 150 concurrent streams and 300 subscriptions a minute, S4 | 100 streams on one socket held for 60 s, 6,651 and 6,079 frames at 110.8 and 101.3 frames a second and 45 and 37 KB a second, P1 and P2 |
| forced disconnects and maintenance notices | not documented | none seen |
| replacing a subscription | "When subscribing to the same primary selector again, the previous secondary selector will be replaced", S2 | not probed |
| unsubscribe | `method` `unsubscribe` with the same `params`, S1 | `{"jsonrpc":"2.0","result":{"stream":"v1.ticker.s","unsubs":["BTC_USDT_Perp@500"]},"id":21,"method":"unsubscribe"}`, and no frame followed in 2.5 s, P1 and P2 |

## 6. Captured frames

All from P1, trimmed where marked.

Subscribe acknowledgement for three delta books:

```json
{"jsonrpc":"2.0","result":{"stream":"v1.book.d","subs":["BTC_USDT_Perp@100","ETH_USDT_Perp@100","BCH_USDT_Perp@100"],"unsubs":[],"num_snapshots":[1,1,1],"first_sequence_number":["1279687","1113455","265019"],"latest_sequence_number":["1279686","1113454","265018"]},"id":1,"method":"subscribe"}
```

Snapshot, trimmed to two levels a side, the other 224 bids and 99 asks dropped:

```json
{"stream":"v1.book.d","selector":"BTC_USDT_Perp@100","sequence_number":"0","feed":{"event_time":"1791844182200000000","instrument":"BTC_USDT_Perp","bids":[{"price":"82565.6","size":"4.167","num_orders":9},{"price":"82564.6","size":"2.422","num_orders":1}],"asks":[{"price":"82565.7","size":"0.023","num_orders":1},{"price":"82567.8","size":"0.036","num_orders":1}]},"prev_sequence_number":"0"}
```

The first delta of that selector, whose number is the acknowledgement's `first_sequence_number`, with one removal:

```json
{"stream":"v1.book.d","selector":"BTC_USDT_Perp@100","sequence_number":"1279687","feed":{"event_time":"1791844182300029019","instrument":"BTC_USDT_Perp","bids":[{"price":"82525.5","size":"0.004","num_orders":1},{"price":"82503.6","size":"0.023","num_orders":1}],"asks":[{"price":"82573.7","size":"0.018","num_orders":1},{"price":"82578.6","size":"0.0","num_orders":0}]},"prev_sequence_number":"1279686"}
```

A ticker delta, which carries only what changed:

```json
{"stream":"v1.ticker.d","selector":"BTC_USDT_Perp@100","sequence_number":"84163","feed":{"event_time":"1791844223100026485","instrument":"BTC_USDT_Perp","best_bid_size":"2.424","best_ask_size":"3.187"},"prev_sequence_number":"84162"}
```

The keepalive is a WebSocket protocol ping, opcode 9, with an empty payload, every 5.0 s, and the client's pong is the answer, so no text frame shows it.

Error, an unknown instrument:

```json
{"jsonrpc":"2.0","error":{"code":3000,"message":"Instrument is invalid"},"id":11,"method":"subscribe"}
```

## 7. Private channels

For a later execution stage only, and none was opened.

| item | value | source |
|---|---|---|
| endpoint | `wss://trades.grvt.io/ws/full` | S1, S5, S6 |
| authentication | a `gravity` session cookie from `POST https://edge.grvt.io/auth/api_key/login` or the EIP-712 wallet login, and the `X-Grvt-Account-Id` header | S2 |
| streams | `v1.order`, `v1.state`, `v1.cancel`, `v1.position`, `v1.fill`, `v1.transfer`, `v1.deposit`, `v1.withdrawal` | S5 |
| orders over the socket | JSON-RPC methods such as `v1/create_order` on the trading socket, counted against the REST limits | S4, S5 |

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://market-data.grvt.io/ws/full` for every plan | one URL carries every asset class, section 1 |
| book channel | `v1.book.d`, selector `<market.id>@100` | full depth with a snapshot on subscribe and a strict sequence, verified against the snapshot channel, section 4. `@50` also works and was probed on one market only |
| anchor channel | `v1.ticker.s`, selector `<market.id>@500`, feeding `SocketAnchors` | no REST call returns every market at once, see [`rest.md`](./rest.md) section 3, and a `v1.ticker.s` frame carries every field on its clock, while a `v1.ticker.d` delta leaves out unchanged prices and would let a quiet market's row age past the 10 s limit |
| markets per connection | at most 60, which is 120 streams with the ticker | under the 150 concurrent streams of S4 per socket, while P1 held 100 |
| streams per address | at least 368 | S4 does not say whether 150 counts per socket or per address. 184 markets need 368 streams. On 2026-10-12 the adapter's 90 s live smoke held all 368 from this host on four sockets of 92, with no refusal and no close, so the cap does not count per address at that level |
| subscribe frames | one frame per market and channel, `{"jsonrpc":"2.0","method":"subscribe","params":{"stream":"v1.book.d","selectors":["BTC_USDT_Perp@100"]},"id":<n>}` | one unknown name refuses its whole frame, so a frame per market keeps the damage to one market |
| pacing | `subscribe_gap` 250 ms, and `connect_stagger` at least one connection's subscribe phase, 30 s for 60 markets | four selectors a second is 240 a minute, under the 300 subscriptions a minute of S4 if it counts selectors per address |
| keepalive | `ping_every` none, and let the runtime answer the server's pings | the server pings every 5 s and drops a client that leaves five unanswered, section 5 |
| `max_silence` | 15 s | the server's pings arrive every 5 s and count as traffic at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 621, while a quiet book sends no delta for minutes |
| resync rule | on each acknowledgement, store `first_sequence_number[i]` as the expected number of `subs[i]`. A snapshot, number 0, replaces the book. A delta below the expected number is a duplicate and is dropped. A delta above it calls `resync` | S2's rule, which held with no gap in P1 |
| routing | frames with `result` or `error` are replies, and data frames route on `stream`, then the instrument before `@` in `selector` | section 3 |
| replies | log every `error` with its `id`, since a refused frame sends no data and closes nothing | section 4 |
| receive time | stamp on arrival through `frame_recv_ts` | a snapshot's `event_time` is its book's last change, section 4 |
| deflate | nothing to do | the server does not negotiate it, section 5 |

This fits `BookVenue` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 78 with no new runtime piece.
`plan` cuts the markets into connections of 60, `subscribe_frames` returns two frames per market, and `handle` keeps the expected numbers in its `State`.
The `v1.ticker.s` frames write `SocketAnchors` at [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs) lines 46 to 69, as decision 13 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) describes, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Market Data Websocket Streams, fetched with a browser user agent | https://api-docs.grvt.io/market_data_streams/ | 2026-10-12 | GRVT, API docs | streams, selectors, rates, depths, fields, error codes, sections 2 to 5 |
| S2 | Overview, WebSocket Subscription, Sequence Number and Event Time | https://api-docs.grvt.io/ | 2026-10-12 | GRVT, API docs | hosting in AWS Tokyo, envelope, sequence rule, `event_time`, replacement, sections 1 to 5 |
| S3 | grvt-pysdk `grvt_ccxt_env.py` at commit `bb77839`, the testnet socket URLs at lines 78 to 81 | https://github.com/gravity-technologies/grvt-pysdk/blob/bb77839ea25f8476a830fe6453ed4de5ebb4829e/src/pysdk/grvt_ccxt_env.py | 2026-10-12 | GRVT, official SDK | testnet socket, section 1 |
| S4 | What are the rate limitations on Grvt?, dated June 26, 2026 | https://help.grvt.io/en/articles/9636566-what-are-the-rate-limitations-on-grvt | 2026-10-12 | GRVT, help center | 150 streams and 300 subscriptions a minute, socket calls counted as REST, sections 2, 3, 5 and 8 |
| S5 | grvt-pysdk at commit `bb77839`, `grvt_raw_env.py`, `grvt_ccxt_env.py` and `grvt_ccxt_ws.py` | https://github.com/gravity-technologies/grvt-pysdk | 2026-10-12 | GRVT, official SDK | the `/ws` endpoint, stream names, selector shapes, sections 1 and 7 |
| S6 | CCXT Pro 4.5.68 `pro/grvt.js` and `grvt.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/grvt.js` | 2026-10-12 | CCXT | URL at line 32, `keepAlive` at line 49, `v1.book.d` default at line 513, snapshot by number at line 583 with no gap check before line 604, `contractSize` at `grvt.js` line 724, sections 4, 5 and 7 |
| S7 | What are Retail Price Improvement (RPI) Orders? | https://help.grvt.io/en/articles/11410051-what-are-retail-price-improvement-rpi-orders | 2026-10-12 | GRVT, help center | RPI orders are out of the API book, section 4 |
| P1 | `ws-probe.py` first pass: `deflate` and `errors` at 22:26, `book` at 22:27 and again with the snapshot comparison at 22:29, `ticker` at 22:30, `batch` at 22:31, `silence` at 22:32 | [`ws-probe.py`](../../../scripts/probes/venues/grvt/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 and 8 |
| P2 | `ws-probe.py` second pass of every mode from 22:47 to 22:51 UTC, with a delisted name added to `errors` | [`ws-probe.py`](../../../scripts/probes/venues/grvt/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 5 |
