# LeveX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:13 to 03:39 UTC on 2026-09-23, from the development host near Seattle.

LeveX publishes no WebSocket API and no API documentation, see [`fees.md`](./fees.md) section 1.
This profile therefore records the socket that LeveX's own web page opens for a logged-out visitor, `wss://ws100.levex.com`, as read from the page's JavaScript and from [`ws-probe.mjs`](../../../scripts/probes/venues/levex/ws-probe.mjs).
Every "documented" cell below is Not publicly specified, and the web client's own behaviour, read from its bundle, stands in its place where it exists.
The socket is an internal interface that LeveX may change without notice, and both LeveX agreements forbid scripts that "access, obtain, copy or monitor" the site, see [`fees.md`](./fees.md) section 1.
The probe kept to the volume of one browser tab, with one socket for about 61 s per run and about ten minutes of socket time in total.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M, USDC-M and coin-M perpetuals, and spot | `wss://ws100.levex.com/?no=<n>`, where the web client counts `n` from 0 per page, S1 | 101 Switching Protocols through CloudFront POP `SEA900-P9`, open in 334 to 381 ms |
| the same host over plain HTTPS | `https://ws100.levex.com/` | 403, CloudFront "Request blocked" |

One socket carries every family.
`BTCUSDT`, `BTCUSDC` and `cBTCUSD` books delivered on the same socket, and the all market ticker carried all three families in one frame.
The web page builds the host from the prefix `ws100` and its own domain, S1.
The socket host upgraded from this machine while the web client's REST host `api100.levex.com` refused it, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

Methods are those the web client sends, S1 and S2.
Requests are JSON-RPC style, `{"method", "params", "id"}`.

| method | params | pushes | probed |
|---|---|---|---|
| `orderbook.subscribe` | `{"symbol": "BTCUSDT"}` | `orderbook.update`, 25 levels, snapshot then incremental | recommended if anything, section 4 |
| `orderbook.unsubscribe` | `[]` | | acked, ends every book on the socket |
| `perp24HTicker.subscribe` | `{}` | `perp24HTicker.update`, every perpetual with last, bid, ask, index, mark, funding rate, last funding rate, volume, turnover, open interest | one snapshot of 332 rows, then one incremental frame every 1,000 ms median |
| `trade.subscribe` | `{"symbol": …}` | `trade.update` | not probed |
| `kline.subscribe` | `{"symbol", "interval"}` | `kline.update` | not probed |
| `spot24HTicker.subscribe` | `{}` | `spot24HTicker.update` | not probed |
| `tick.subscribe` | `{"symbol": …}` | `tick.update`, fiat conversion ticks in the web client | not probed |
| `server.ping` | `[]` | reply `"result": "pong"` | 93 to 146 ms round trip |

No dedicated index, mark or funding channel exists.
The ticker carries all three for every perpetual in one stream, see [`rest.md`](./rest.md) section 3.
No speed or depth option is exposed, and every book frame says `"depth": 25`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is Not publicly specified on every row, so it holds what the web client does instead.

| axis | web client | probed |
|---|---|---|
| endpoint split axis | one host for everything, S1 | one socket carried USDT-M, USDC-M and coin-M books |
| subscribe frame shape | `{"method": "orderbook.subscribe", "params": {"symbol": "BTCUSDT"}, "id": 3}`, one symbol per frame, and the web client unsubscribes before it subscribes the next symbol, S2 | one symbol per frame, and eleven `orderbook.subscribe` frames without an unsubscribe left eleven books subscribed at once, each with its snapshot and the busy ones with their incrementals |
| unknown symbol expectation | Not publicly specified | `NOPEUSDT` and `BTCUSD` answer `{"error":{"code":3001,"message":"invalid argument"},"id":…,"result":null}`, and an unknown method answers the same |
| chunk unit and budget | Not publicly specified | 11 books on one socket, not pushed further |
| keepalive mechanism | the web client sends `server.ping` every 3 s and drops the socket after 6 s without any message, S2 | no server protocol ping in 90 s on four sockets. A socket that sends nothing after its subscribe closes at 31 to 32 s with 1006, even while it receives book frames |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 90 s, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | none met at about 40 requests per socket in 61 s |
| public market data authentication | none, `user.auth` exists for private streams, S2 | none needed |
| message parse and routing | pushes carry `method` and `data`, replies carry `id`, `error` and `result`, S2 | as described, route books on `data.symbol` |
| subscribe acknowledgement shape | reply matched by `id`, S2 | `{"error":null,"id":3,"result":{"status":"success"}}` in 94 to 275 ms |
| symbol identifier format | `symbol` from the catalog, `BTCUSDT`, `BTCUSDC`, `cBTCUSD`, S2 | as described, and CoinGecko's `trade_url` uses the same spelling |
| number representation | strings | price and size as strings, `timestamp` as a 19 digit JSON integer |
| timestamp representation | Not publicly specified | nanoseconds, above 2^53, so `JSON.parse` rounds it to about 256 ns. An inactive book's snapshot carries `0` |
| size unit | the web client multiplies ticker volume by a per contract `contractSize` read from the refused catalog, S2 | not verified against a catalog, see section 4 |
| sequence semantics | the web client uses none: a snapshot clears the book, an incremental sets levels and deletes crossed levels, S2 | no sequence number, no update id and no checksum on any frame |
| idle repeat behaviour | Not publicly specified | the server sends a new snapshot of an unchanged book, section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

The first `orderbook.update` for a symbol is `"type": "snapshot"`, with up to 25 bids and 25 asks and `"keys": ["price","size"]`, arriving 100 to 300 ms after the subscribe frame.
Every probed book got its snapshot, including the inactive `STORJUSDT`, whose snapshot was empty on both sides with `"timestamp": 0`.
A second subscribe to a symbol already on the socket is acked, and was answered with a fresh snapshot in three runs of four, see below.

Besides the snapshot on subscribe, the server re-sends snapshots on no schedule the probe could find.

| run | re-sent snapshots |
|---|---|
| 1, 03:17 UTC | `BTCUSDT` once, 4.2 s after its first. The eight books subscribed at 20 s got none in 30 s |
| 2, 03:22 UTC | `BTCUSDT` 9.5 s after its first, then every book on the socket at 39.3 to 40.2 s, about 4 s after the last subscribe |
| 3, 03:34 UTC | every book on the socket at 31.4 to 32.3 s, about 11 s after the batch subscribe |
| 4, 03:37 UTC | `BTCUSDT` once, 2.4 s after its first, and no other book |

A second `orderbook.subscribe` for `BTCUSDT` at about 30.3 s was answered by a snapshot within 100 ms in runs 1, 3 and 4, and not in run 2.
Each re-sent snapshot carried the same `timestamp` as the last incremental before it, so it restates the book rather than moving it.

### Delta semantics

An incremental carries only the changed levels as `[price, size]` string pairs, and a size of `"0"` deletes the level.
In run 2, 25 of 85 `BTCUSDT` incrementals changed more than one level, and 81 levels were deleted by a `"0"` size.
The web client also deletes, on every incremental, any bid at or above the lowest new ask and any ask at or below the highest new bid, S2.
A book kept from snapshot and incrementals alone, without that pruning, was crossed after 10 of 63 `SOLUSDT` incrementals in run 4, and after none on 11 symbols in runs 1 to 3.
So the server does not always send a `"0"` for a level that a trade removed, and the pruning is part of the protocol.

### Sequence and gap rule

There is none.
Frames carry no update id, no previous id and no checksum, and the web client keeps no counter, S2.
The only consistency check available is to compare a kept book with the next snapshot, and every later snapshot matched the kept book exactly, level for level, 24 of 24 over four runs.
A lost incremental cannot be detected until the next snapshot, and that snapshot is not on a known schedule.

### Checksum

None on any frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of 11 symbols | best first, ascending, on every snapshot |
| incremental | often one level, and 0 to 3 arrays per symbol per run were out of price order | the same |

A feed applies incrementals by price and never by position.

### Level window

The server keeps 25 levels a side.
The kept book held at most 25 or 26 levels a side, so a level leaving the window mostly arrives as a `"0"` size, and a 26th level can linger until the next snapshot replaces the book.

### Size unit against CCXT `contractSize`

CCXT has no LeveX class, so there is no `contractSize` to compare.
The catalog call that holds `contractSize`, `/public/pairs`, answered 403 to this host, see [`rest.md`](./rest.md) section 2.
The ticker gives an indirect check: turnover divided by volume times last price was 0.93 at the 5th percentile, 0.98 at the median and 1.01 at the 95th over 275 linear contracts with volume, and only `NILUSDT`, at 0.79, was off by more than 20 %, so ticker volume counts base units.
Book sizes on the linear books read like base units too, `BTCUSDT` showed `"0.4575"` at the touch and `XRPUSDT` `"2783"`.
On `cBTCUSD` the touch read `"22893"` and `"13704"`, and its ticker turnover of 27.10 BTC over a volume of 2,329,331 gives about 85,950, the BTC price, so a coin-M size counts US dollars.
Both readings are inferences from the ticker, since the catalog was not readable.

### One-sided and empty books

`STORJUSDT`, one of 46 contracts with a mark of 0, sent an empty snapshot and nothing after it.
No one-sided book was seen on an active contract.

### Idle repeats

A quiet book sends nothing between changes: `KOUSDT` sent 0 incrementals in the 30 s it was subscribed in runs 2 and 4, and `XAUUSDT` went up to 8.1 s between frames.
Snapshots of unchanged books are re-sent, see the snapshot cadence above.

### Unknown, closed and wrong-family symbols

| request | reply | then |
|---|---|---|
| `orderbook.subscribe` `NOPEUSDT` | `{"error":{"code":3001,"message":"invalid argument"},"id":…,"result":null}` | nothing |
| `orderbook.subscribe` `BTCUSD` | code 3001 `invalid argument`, the coin-M contract is `cBTCUSD` | nothing |
| `orderbook.subscribe` `STORJUSDT`, inactive | success | one empty snapshot, `timestamp` 0 |
| `orderbook.subscribe` `BTCUSDT` twice | success | a new snapshot within 100 ms in three runs of four, and the book keeps delivering |
| `nope.subscribe` | code 3001 `invalid argument` | |
| text that is not JSON | code 3001 with `"id":0` | the socket stays open |

## 5. Session

| item | web client | probed |
|---|---|---|
| keepalive | `{"method":"server.ping","params":[],"id":n}` every 3 s, S2 | `{"error":null,"id":1,"result":"pong"}` in 93 to 146 ms over 84 pings in four runs |
| silence the server tolerates | the client gives up after 6 s without a message, S2 | the server closes a socket 31 to 32 s after the client's last frame, with 1006 and no close frame. It did so with no subscription, and with a busy `BTCUSDT` book that had delivered 64 and 82 frames in two runs. A ping every 20 s kept a socket open for the full 90 s |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | announcements on the blog, such as `scheduled-system-maintenance-notice-20260730` in the sitemap, whose body did not render outside a browser | no notice frame |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | | 334 to 381 ms to open from this host |
| subscription limits | Not publicly specified | 11 books and the ticker on one socket, no refusal |
| throughput | | 373 to 555 book frames and 62 ticker frames in 61 s on 11 books. The ticker snapshot is 45 KB, and later frames carry only the 95 to 223 changed contracts, about 20 KB |
| clock | | arrival time minus the frame's `timestamp` was 50 to 57 ms at the minimum and 120 to 124 ms at the median over runs 2 to 4, against a ping round trip near 95 ms, so the server clock is close to this host's |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Books are cut to three levels a side.

Subscribe and ping, as the web client spells them.

```json
{"method":"orderbook.subscribe","params":{"symbol":"BTCUSDT"},"id":3}
```

```json
{"method":"server.ping","params":[],"id":1}
```

Acknowledgement and pong.

```json
{"error":null,"id":3,"result":{"status":"success"}}
```

```json
{"error":null,"id":1,"result":"pong"}
```

Snapshot, three levels per side kept.

```json
{"data":{"asks":[["86617.4","0.4575"],["86620.2","0.3"],["86620.6","0.5518"]],"bids":[["86611.3","0.39"],["86611.2","0.475"],["86610.2","0.5851"]],"depth":25,"keys":["price","size"],"symbol":"BTCUSDT","timestamp":1790133740925910914,"type":"snapshot"},"method":"orderbook.update"}
```

Incrementals.

```json
{"data":{"asks":[["86617.4","0.457"]],"bids":[],"depth":25,"symbol":"BTCUSDT","timestamp":1790133741336894346,"type":"incremental"},"method":"orderbook.update"}
```

```json
{"data":{"asks":[],"bids":[["86611.3","0.3896"]],"depth":25,"symbol":"BTCUSDT","timestamp":1790133742468582437,"type":"incremental"},"method":"orderbook.update"}
```

Snapshot of an inactive contract.

```json
{"data":{"asks":[],"bids":[],"depth":25,"keys":["price","size"],"symbol":"STORJUSDT","timestamp":0,"type":"snapshot"},"method":"orderbook.update"}
```

Errors, for an unknown symbol and for text that is not JSON.

```json
{"error":{"code":3001,"message":"invalid argument"},"id":21,"result":null}
```

```json
{"error":{"code":3001,"message":"invalid argument"},"id":0,"result":null}
```

Ticker, one row of an incremental frame, whose columns are named by the snapshot's `keys`.

```json
{"keys":["symbol","lastPrice","bidPrice","askPrice","openPrice","highPrice","lowPrice","indexPrice","markPrice","fundingRate","lastFundingRate","volume","turnover","openInterest"],"row":["cBNBUSD","797.57","797.51","797.57","791.82","797.98","781.81","796.67","796.73","0.000107","0.0001","257269","326.37508270587","1399842"]}
```

The last block is reassembled from two frames for reading, and is not a frame as sent.

## 7. Private channels

Named for completeness, from the web client, S2, not probed.
They need `user.auth` on the same socket.

- `perpAccount.subscribe` with `perpAccount.update`, `perpOrder.update`, `perpPosition.update` and `perpPosInfo.update`, and `perpPosition.query`.
- `spotUser.subscribe` with `spotOrder.update` and `spotWallet.update`.
- `service.subscribe` with type `user.events`, and `service.query`.

## 8. Recommended feed shape

No feed is recommended.
LeveX says it offers no API, forbids scripts from monitoring the site, and excludes US persons, see [`fees.md`](./fees.md) section 1.
The socket also lacks what [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) relies on to call `resync`: a sequence or update id per symbol.

If LeveX ever publishes this socket as an API, the shape the probe supports would be:

| item | shape | reason |
|---|---|---|
| URL plan | one plan, `wss://ws100.levex.com/?no=0`, every family | one socket carried all three families |
| channel | `orderbook.subscribe` per symbol, 25 levels | the only book channel |
| markets per connection | untested beyond 11 | no cap published |
| keepalive | `server.ping` every 10 s | the server drops a socket 31 s after the client's last frame |
| `maxSilenceMs` | 30,000 | a quiet book sent nothing for 30 s, so the pong has to count as traffic |
| snapshot | `type === "snapshot"`: `resetBook` | clears and replaces the book |
| incremental | set each level, delete on `"0"`, delete bids at or above the lowest new ask and asks at or below the highest new bid, then publish | the web client's rule, and `SOLUSDT` crossed without the pruning |
| resync | no gap is detectable, so only a re-sent snapshot that disagrees with the kept book could trigger it, and none did in 24 | no sequence field |
| receive time | stamp on arrival | the frame `timestamp` is in nanoseconds and loses precision in `JSON.parse` |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | LeveX web bundle `app-FiYwroKJ.js` | https://static.levex.com/101/js/app-FiYwroKJ.js | 2026-09-22 | LeveX, global | `ws100` host prefix, socket worker URL, section 1 |
| S2 | LeveX trade worker `worker-trade-ARXVGGSP.js` and perpetual bundle `app-BabnG6Gd.js` | https://static.levex.com/100/js/worker-trade-ARXVGGSP.js | 2026-09-22 | LeveX, global | method names, frame shapes, `?no=` counter, 3 s ping and 6 s timeout, book reducer, private channel names, sections 1 to 4 and 7 |
| S3 | LeveX Miscellaneous FAQ, "Do you offer an API?" | https://levex.com/en/support/miscellaneous | 2026-09-22 | LeveX, global | no API, preamble |
| P1 | `ws-probe.mjs book`, runs 1 and 2 at 03:17 and 03:22 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/levex/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs silence`, runs at 03:24 and 03:25 UTC, and `deflate` at 03:24 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/levex/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
| P3 | second pass: `book` runs 3 and 4 at 03:34 and 03:37 UTC, `deflate` at 03:36 UTC and `silence` at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/levex/ws-probe.mjs) | 2026-09-22 | this host | the second readings in sections 1 to 5 |
