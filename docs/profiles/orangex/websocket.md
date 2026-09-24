# OrangeX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:30 to 03:50 UTC, from the development host near Seattle.

This profile covers the public JSON-RPC WebSocket of OrangeX for its one perpetual family, the USDT-margined perpetuals, with the book channel in detail.
OrangeX has no CCXT class, so no CCXT Pro source was available to compare.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/orangex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is S1, a single page in the Deribit shape whose examples date from 2020 and 2021.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, and spot on the same socket | `wss://api.orangex.com/ws/api/v1`, S1 | open in 541, 196 and 191 ms for the book runs, 547 and 212 ms for the batch runs, 176 to 207 ms for the silence sockets, and 548 and 555 ms for the deflate checks |
| the website's JSON socket | `wss://www.orangex.com/api/ws/api/v1`, found in the website bundle, not documented | not probed |
| the website's binary stream | `wss://api.orangex.com/data/stream`, found in the website bundle as `WS_BIN_HOST`, not documented | not probed |

One socket carries every perpetual, because there is only one family.
The batch run subscribed all 578 perpetuals on one socket and every one delivered, see section 5.
The two website endpoints were read from the Next.js bundle of `www.orangex.com` and are named only so that nobody mistakes them for the documented API.

## 2. Channel matrix for public market data

| channel | documented | probed on 2026-09-23 UTC |
|---|---|---|
| `book.{instrument_name}.{interval}` | interval enum `raw` only, S1 | `raw` delivers deltas with no snapshot. `100ms` and `none.20.100ms` are refused with code 3401 |
| `ticker.{instrument_name}.{interval}` | `raw` | a frame every 107 to 658 ms on BTC, median 296, 271 and 260 ms in three runs. Carries best bid and ask, `mark_price`, `underlying_price` and `last_price`. `100ms` is refused with 3401 |
| `markprice.{kind}.{currency}` | `markprice.perpetual.PERPETUAL` | one frame about every second, median gap 999, 1,000 and 1,000 ms, with 738 entries: all 578 live perpetuals plus 160 others, see section 4 |
| `price_index.{index_name}` | enum `btc_usdt`, `eth_usdt` | `price_index.btc_usdt` about every second, median gap 1,001 and 1,002 ms. `price_index.chr_usdt` and `price_index.BTC-USDT` are refused with 3401 |
| `trades.{instrument_name}.{interval}` | `raw` | each trade, and every trade carries `mark_price` |
| `chart.trades.{instrument_name}.{resolution}` | candles | not probed |
| funding | no channel | none |
| best bid and ask only | no channel | none beyond `ticker` |

The channel names and parameters are from S1.
The `markprice` channel carries every perpetual's mark and index in one frame a second, which makes it the only socket source for the anchor, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL, 578 perpetuals on one socket |
| subscribe frame shape | `{"jsonrpc": "2.0", "id": 1, "method": "/public/subscribe", "params": {"channels": [...]}}`, S1 | as documented. The method needs its leading slash, and `public/subscribe` answers code 1000 `No service found` |
| unknown symbol expectation | Not publicly specified | error code 3401 `channel regex not match` naming the channel. One bad channel fails the whole frame, section 4 |
| chunk unit and budget | Not publicly specified | 150 channels in one frame acked in 138 ms in both batch runs, then 428 more in one frame, all delivering |
| keepalive mechanism | "send a "PING" string or call the /public/ping command", "every 5 seconds", S1 | `PING` answers the text `PONG`. `/public/ping` answers `{"id":"1001",…,"result":{}}` in 132 to 154 ms. The server sent no protocol ping |
| connection lifetime and maintenance notice | Not publicly specified | no forced disconnect in 58 s of a pinged socket. A socket that sends nothing for 30 s is closed, section 5 |
| handshake and operation rate limits | "no more than 5 times per minute" for new sockets, "keep the number of concurrent WebSocket connections below 10", "Otherwise, risk control rules may be triggered, resulting in IP and account bans", S1 | the probe stayed under both, so no limit was reached |
| public market data authentication | none for `/public/subscribe`, S1 | none |
| message parse and routing | notification `{"jsonrpc", "method": "subscription", "params": {"channel", "data"}}`, S1 | as documented. The book routes on `params.channel` or `params.data.instrument_name` |
| subscribe acknowledgement shape | `result`, "A list of subscribed channels", S1 | `{"id":"1","jsonrpc":"2.0","usIn":…,"usOut":…,"usDiff":…,"result":[…]}`. The id comes back as a string although it was sent as a number |
| symbol identifier format | `BTC-USDT-PERPETUAL` | identical to the REST `instrument_name` on 578 of 578 perpetuals. Four ids are Chinese characters, for example `币安人生-USDT-PERPETUAL`, and they subscribe and deliver like the rest |
| number representation | strings in the examples | book prices and sizes are strings, padded to the contract's precision, so `"1.930"` and `"86644.0"` arrive where REST sends `"2.13"` and `"86644"`. `ticker` sends best bid and ask as JSON numbers and everything else as strings |
| timestamp representation | `timestamp` in ms | book `timestamp` is a JSON integer in ms. `ticker` and `trades` send it as a string. The reply envelope's `usIn` and `usOut` are ms, while S1 says microseconds |
| size unit | "The minsize of futures and options is one contract", S1 | base coin: `BTC-USDT-PERPETUAL` sizes are BTC, section 4 |
| sequence semantics | `change_id`, and "If the event change_id > lastVersion + 1 of your local order book, something went wrong", S1 | `change_id` rose by exactly 1 per frame on every stream: 0 gaps in 1,836 frames on four contracts over three runs, and in 17,785 and 18,188 frames on 578 contracts |
| idle repeat behaviour | not documented | no repeated `change_id`. A quiet book still pushed at least every 2.6 s |

## 4. The book channel in detail

`book.{instrument_name}.raw` is the only book channel, and every row below is about it.

### No snapshot on subscribe

The first frame after the ack is an ordinary delta.
It carried 16 to 37 levels across both sides in the first frames of the four contracts over three runs, and its `change_id` continues the REST book's `version` counter.
S1 documents the alignment recipe, which is the Binance one: buffer the deltas, fetch `/public/get_order_book`, retry until `version` is at least the first buffered `change_id` minus 1, drop buffered deltas with `change_id` at or below `version`, then apply the rest in order.

The probe followed that recipe with `depth=100`.
In twelve alignments over three runs, the first REST snapshot was already recent enough, and the first kept delta always had `change_id` equal to `version` plus 1 where one was kept.
The probe fetched the snapshots about 2 s after the subscribe, and 3 to 28 deltas per contract had been buffered by then.

A full-depth snapshot is the wrong seed.
Over the same twelve alignments, `depth=0`, read just after `depth=100`, returned a lower `version` ten times, by 1 to 22, the same one once, and a higher one once, by 2.
In the two REST book runs, `depth=500` and `depth=0` returned a `version` 4 and 8 below the `depth=100` read made before them, see [`rest.md`](./rest.md) section 5.

### Delta semantics

A level is `[action, price, amount]`.
Only two actions appeared: `new` and `delete`, in 6,399 and 1,315 BTC levels in the first run, 6,417 and 954 in the second, and 7,273 and 2,365 in the third.
S1 shows no third action, and `change` never appeared, so `new` also overwrites a level that exists.
`new` carries the absolute size at that price, and `delete` carries `"0"`.
No frame had empty `bids` and `asks` together.

### Sequence and gap rule

```text
change_id <= last          ignore
change_id =  last + 1      apply, last = change_id
change_id >  last + 1      gap: reseed from REST (documented), or terminate the socket (the engine's resync)
```

The rule held on every delta of the three runs and of both batch runs, with 0 gaps.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| delta | descending in every frame, 0 exceptions over three runs | ascending in every frame, 0 exceptions |
| REST `get_order_book` | descending at 20, 50, 100 and full depth | ascending |

### Level window

The stream sends changes below the top 100 levels as well.
After a seed of 100 levels, the BTC book held up to 154 bids and 159 asks in the first run, 149 and 162 in the second, and 185 and 174 in the third, while the full REST book had 435 to 438 bids and 362 to 369 asks.
So a feed seeded from `depth=100` holds the top of the book exactly, and a level below the seed appears only once it changes.
That is enough for the engine's 20 levels at [`../../../server/src/engine/Engine.ts`](../../../server/src/engine/Engine.ts) line 61, unless a single move sweeps about 80 levels before a reseed.

### Exact check against REST

At 30 s and at 57 s the probe read `get_order_book?depth=20` and compared it with the local book at the same `change_id`.
In the second and third runs all 40 levels matched on `BTC-USDT-PERPETUAL` and on `CHR-USDT-PERPETUAL` at both checks.
The first run keyed levels by the price string and kept a stale BTC bid at `86666`, because the socket pads prices that REST trims, so a feed must key levels by number.

### Size unit against the catalog

| contract | socket size at the touch | REST size at the same `version` | unit |
|---|---|---|---|
| `BTC-USDT-PERPETUAL` | 2.094 | `"2.094"` | BTC |
| `CHR-USDT-PERPETUAL` | 38091 | `"38091"` | CHR |

The unit is the base coin, which is what the contract specification says: "BTCUSDT Perp, ETHUSDT Perp contracts represent only one unit of its respective base asset", S2.
The catalog has no `contract_size` field on any perpetual, so a catalog loader should set `contractSize` 1, see [`rest.md`](./rest.md) section 2.
Six contracts carry a multiple of the coin in their base, for example `1000SHIB-USDT-PERPETUAL`, whose sizes then count units of 1,000 SHIB, an inference from the name that was not checked against a book.

### One-sided and empty books

No one-sided or empty book was seen.
S1 says the ticker's best bid is "null if there aren't any bids", and what the book channel sends then is Not verified.

### Idle repeats

Nothing is repeated.
`CHR-USDT-PERPETUAL` and `SOL-USDT-PERPETUAL` pushed 0.6 to 0.8 frames a second with at most 2,563 ms between frames, and BTC and ETH pushed 3.9 to 5.4 frames a second with at most 678 ms between frames, over three runs.

### Frame timing

Book `timestamp` was 66 to 346 ms older than the arrival, median 68 to 70 ms on every contract in three runs, with the clock offset near 0, see [`rest.md`](./rest.md) section 7.

### Unknown, closed and wrong-level symbols

| request | reply |
|---|---|
| `book.NOPE-USDT-PERPETUAL.raw` | `{"error":{"code":3401,"message":"channel regex not match","data":{"channel":"book.NOPE-USDT-PERPETUAL.raw"}}}` |
| `book.BTCUSDT.raw` | the same 3401 |
| `book.XRP-USDT-PERPETUAL.100ms` and `.none.20.100ms` | the same 3401 |
| `nope.XRP-USDT-PERPETUAL.raw` | the same 3401 |
| `book.BTC-USDT-PERPETUAL.raw` a second time | success, and no frame arrived twice |
| `price_index.btc_usdt` and `price_index.chr_usdt` in one frame | 3401 naming only `price_index.chr_usdt`, and `btc_usdt` never delivered in 58 s |
| `/public/subscribe` with empty `params` | `"result":[]` |
| `public/subscribe` or `/public/nope` | code 1000 `No service found` |
| text that is not JSON | `{"jsonrpc":"2.0",…,"error":{"code":9902,"message":"json parse error"}}` with no id, and the socket stays open |

A frame is accepted or refused whole, and the refusal names only the bad channel.
So a feed that sends a delisted id in a slice loses the whole slice unless it drops the named channel and sends the rest again.
A closed contract was not available to probe.
`OURA-USDT-PERPETUAL` was in the catalog before its listing time of 03:30 UTC, and it delivered in the batch run after that time.

### Mark and index on the socket

The `markprice.perpetual.PERPETUAL` frame held 738 entries in each of 57 frames, in each of two runs.
All 578 live perpetuals were among them, and the other 160 were old contracts.
In both runs, 9,120 of the 42,066 entries, which is 160 a frame, carried a `mut` more than 60 s old, and the p90 age was 204 days.
`mark_price` equalled `underlying_price` on 8,325 and 8,203 of the 42,066 entries.
`mark_iv` was `"0"`.
The BTC mark took 12 and 20 distinct values over 57 frames, which fits a mark that follows the last trade, see [`rest.md`](./rest.md) section 4.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | a `PING` string or `/public/ping` every 5 s, S1 | `PONG` in text, and `/public/ping` answered in 132 to 154 ms with `"result":{}`. No server protocol ping on any socket |
| silence the server tolerates | Not publicly specified | a socket that never sent closed at 30.2 s with code 1006 and no close frame, in both runs. A socket subscribed to the CHR book, receiving 23 and 28 frames, and never pinging closed at 30.5 s with 1006, in both runs. So inbound data does not keep a socket alive, and only a client frame does |
| forced disconnect | Not publicly specified | none on a socket pinging every 5 s, the longest held 58 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | new sockets "no more than 5 times per minute", fewer than 10 at once | 176 to 555 ms to open. The front is Google (`via: 1.1 google`) |
| close | Not publicly specified | the client's close with 1000 ended as 1000 twice and as 1006 three times, over five sockets |
| subscription limits | Not publicly specified | 578 channels on one socket, no refusal |
| throughput | | all 578 perpetuals on one socket, two runs: median 472 and 473 frames a second over 32 one-second buckets, min 387 and 415, max 626 and 738, 314 and 322 KB a second, 793 and 796 bytes a frame, 28 and 37 µs `JSON.parse` per frame |
| order entry | removed from the WebSocket on 2025-05-30, market data unaffected, S3 | |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe, four books in one frame.

```json
{"jsonrpc": "2.0", "id": 1, "method": "/public/subscribe", "params": {"channels": ["book.BTC-USDT-PERPETUAL.raw", "book.ETH-USDT-PERPETUAL.raw", "book.SOL-USDT-PERPETUAL.raw", "book.CHR-USDT-PERPETUAL.raw"]}}
```

Acknowledgement.

```json
{"id":"1","jsonrpc":"2.0","usIn":1790134513352,"usOut":1790134513353,"usDiff":1,"result":["book.BTC-USDT-PERPETUAL.raw","book.ETH-USDT-PERPETUAL.raw","book.SOL-USDT-PERPETUAL.raw","book.CHR-USDT-PERPETUAL.raw"]}
```

First book frame after the ack, which is a delta and not a snapshot, first three levels per side kept.

```json
{"params":{"data":{"timestamp":1790134260671,"change_id":265434818,"bids":[["new","86666.5","4.629"],["new","86666.3","0.808"],["new","86666.2","0.855"]],"asks":[["new","86666.6","1.930"],["new","86666.7","0.754"],["new","86666.8","0.265"]],"instrument_name":"BTC-USDT-PERPETUAL"},"channel":"book.BTC-USDT-PERPETUAL.raw"},"method":"subscription","jsonrpc":"2.0"}
```

The next two deltas, with `change_id` rising by 1 and an empty side.

```json
{"params":{"data":{"timestamp":1790134260874,"change_id":265434819,"bids":[["new","86666.5","4.134"],["new","86666.4","0.194"],["new","86666.3","0.201"]],"asks":[["new","86666.6","4.229"],["new","86666.9","0.871"],["new","86667.1","0.159"]],"instrument_name":"BTC-USDT-PERPETUAL"},"channel":"book.BTC-USDT-PERPETUAL.raw"},"method":"subscription","jsonrpc":"2.0"}
```

```json
{"params":{"data":{"timestamp":1790134260879,"change_id":265434820,"bids":[],"asks":[["new","86669.1","0.334"],["new","86669.5","0.174"],["new","86683.9","7.200"]],"instrument_name":"BTC-USDT-PERPETUAL"},"channel":"book.BTC-USDT-PERPETUAL.raw"},"method":"subscription","jsonrpc":"2.0"}
```

Keepalive, both documented forms.

```json
{"jsonrpc": "2.0", "id": 1001, "method": "/public/ping"}
```

```json
{"id":"1001","jsonrpc":"2.0","usIn":1790134520161,"usOut":1790134520161,"result":{}}
```

The text `PING` is answered with the text `PONG`.

Errors.

```json
{"id":"5","jsonrpc":"2.0","usIn":1790134514157,"usOut":1790134514157,"usDiff":0,"error":{"code":3401,"message":"channel regex not match","data":{"channel":"book.NOPE-USDT-PERPETUAL.raw"}}}
```

```json
{"jsonrpc":"2.0","usIn":1790134515158,"usOut":1790134515158,"usDiff":0,"error":{"code":9902,"message":"json parse error"}}
```

Ticker, with best bid and ask as numbers and the rest as strings, `stats` cut.

```json
{"params":{"data":{"timestamp":"1790134513734","state":"open","last_price":"86667.6","instrument_name":"BTC-USDT-PERPETUAL","best_bid_price":86667.6,"best_bid_amount":1.193,"best_ask_price":86667.7,"best_ask_amount":1.51,"mark_price":"86667.6","underlying_price":"86702.2"},"channel":"ticker.BTC-USDT-PERPETUAL.raw"},"method":"subscription","jsonrpc":"2.0"}
```

Mark and index for every perpetual, three of 738 entries kept.
The second entry is an old contract whose `mut` is from 2026-06-30.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"markprice.perpetual.PERPETUAL","data":[{"mut":"1790134514311","instrument_name":"EWJ-USDT-PERPETUAL","mark_iv":"0","mark_price":"98.19","underlying_price":"98.1"},{"mut":"1782807031408","instrument_name":"IP-USDT-PERPETUAL","mark_iv":"0","mark_price":"0.2976","underlying_price":"0.2976"},{"mut":"1790134514503","instrument_name":"BABY-USDT-PERPETUAL","mark_iv":"0","mark_price":"0.0131","underlying_price":"0.01309"}]}}
```

Index.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"price_index.btc_usdt","data":{"price":"86702.5519999999960419","index_name":"btc_usdt","timestamp":1790134514285}}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL, `/public/auth` for a token, and `/private/subscribe`.

- `user.changes.{kind}.{currency}.{interval}`, `user.orders.{instrument_name}.raw`, `user.asset.{asset_type}`, `user.trades.{instrument_name}.{interval}`.
- The website subscribes `perpetual.PERPETUAL.raw` through its `userChanges` call, seen in the website bundle.
- Order entry over the socket ended on 2025-05-30, and orders go through HTTP, S3.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.orangex.com/ws/api/v1`, two sockets of about 290 perpetuals each | one family. 578 ran on one socket at 472 and 473 frames a second with 0 gaps, and two sockets halve what one failure takes down while staying far under the 10 socket cap |
| channel | `book.<rawMarketId>.raw` | the only book channel |
| subscribe frames | one frame per slice | a frame of 428 channels was acked as one |
| bad channel | on a 3401 reply, log the named channel, drop it, and send the rest of the slice again | one refused channel fails its whole frame |
| seed | after the ack, `GET /public/get_order_book?instrument_name=<id>&depth=100` per market, buffer deltas until it returns, drop deltas with `change_id <= version`, `resetBook` from the snapshot, then apply the buffer | no snapshot on subscribe, and the documented recipe matched REST on 40 of 40 levels. `depth=0` lagged by up to 22 versions |
| seed pacing | about 10 seeds a second, so 578 markets take about a minute | no REST limit is published, see [`rest.md`](./rest.md) section 6 |
| delta | apply only when `change_id === last + 1`, ignore `change_id <= last` | documented rule, 0 gaps observed |
| resync | `change_id > last + 1`, or a delta for a market with no seed: reseed that one market from REST. The engine's socket `resync` also works but costs a REST seed for every market on the socket | the documented recovery is a fresh snapshot |
| level keys | `Number(price)` | the socket pads prices that REST trims |
| keepalive | `{"jsonrpc":"2.0","id":<n>,"method":"/public/ping"}` every 5 s | documented cadence, the server closes a socket 30 s after the client's last frame, and the documentation warns of IP bans |
| `maxSilenceMs` | 15,000 | three missed pongs. A quiet book went 2.6 s without a frame, and the pong counts as traffic |
| reconnect pacing | at most 5 new sockets a minute | documented, with a ban as the stated penalty |
| receive time | stamp on arrival | book `timestamp` ran a median 70 ms behind arrival, which is transit and not staleness |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

This is the first feed in the engine that would need a REST seed per market, because every existing feed gets a snapshot or a whole window over its socket, and no feed file under `server/src/venues` makes a REST call.
That seed step is the named change the WebSocket side needs.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ORANGEX API v1.0.0, sections JSON-RPC, SubscriptionManagement and Subscriptions | https://openapi-docs.orangex.com | 2026-09-23 UTC | OrangeX.com | URL, channel names, subscribe shape, book recipe, heartbeat and connection limits, private channels, sections 1 to 7 |
| S2 | USDT-Margined perpetual contracts introduction | https://www.orangex.com/agreement | 2026-09-23 UTC | OrangeX.com | one unit of the base asset per contract, section 4 |
| S3 | WebSocket API Deprecation Notice, article 1247, dated 2025-05-30 | https://www.orangex.com/support/help/articles/1247 | 2026-09-23 UTC | OrangeX.com | order entry removed from the socket, sections 5 and 7 |
| S4 | Website bundle of `www.orangex.com`, `_app` and perpetual page chunks | https://www.orangex.com/perpetual/BTC-USDT-PERPETUAL | 2026-09-23 UTC | OrangeX.com | the two undocumented socket hosts and the `perpetual.PERPETUAL.raw` private channel, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, runs at 03:30:59, 03:35:13 and 03:46:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orangex/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:34:17 and 03:49:22 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orangex/ws-probe.mjs) | 2026-09-23 UTC | this host | throughput, 578 channels on one socket, sections 3 and 5 |
| P3 | `ws-probe.mjs silence`, runs at 03:32:41 and 03:47:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orangex/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P4 | `ws-probe.mjs deflate`, runs at 03:30:53 and 03:50:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orangex/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
