# Lighter WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:27 to 22:48 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that ipinfo.io placed in Vancouver, British Columbia, Canada.

This profile covers the public WebSocket API of Lighter (CCXT id `lighter`), with the book channel in detail.
Lighter has one perpetual family, USDC-margined linear perpetuals, and one socket carries every market.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py), run with `uv run` from the repository root, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC, and the probe runs are listed as W1 to W11 in section 9.
Fees and access are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed from this host |
|---|---|---|
| every market, mainnet | `wss://mainnet.zklighter.elliot.ai/stream`, S1 and S2 | refused: HTTP 400 from CloudFront with `{"code": 20558, "message": "You are accessing Lighter from a restricted jurisdiction. For more information, see the https://lighter.xyz/terms"}`, with and without permessage-deflate offered, W1 and W6 |
| read-only, mainnet | `wss://mainnet.zklighter.elliot.ai/stream?readonly=true`, which S1 and S2 give to "restricted regions" to "read market data" | HTTP 101, open in 296 to 448 ms, W1 to W11 |
| testnet | `wss://testnet.zklighter.elliot.ai/stream`, S1 | not probed |

The read-only URL is the venue's own published entrance for restricted regions, so using it does not route around the refusal.
Every capture below came through it.
The upgrade reply carried `via: 1.1 ….cloudfront.net (CloudFront)` and `x-amz-cf-pop: SEA900-P10`, W1.
One socket carried 213 perpetual books and `market_stats/all` at once, W4 and W9.

## 2. Channel matrix for public market data

| channel | subscription | payload | documented cadence, S1 | probed |
|---|---|---|---|---|
| `order_book` | `{"type":"subscribe","channel":"order_book/1"}` | the whole book on subscribe, then changed levels | "in batches, every 50ms" | `BTC` deltas p50 50.6 to 51.0 ms apart and p90 61.9 to 96.6 ms over four runs, W2, W4, W8 and W9. Thin markets only on change |
| `ticker` | `{"type":"subscribe","channel":"ticker/1"}` | best bid and ask with sizes | "on every nonce update" | 1,356 and 1,499 frames in about 58 s on `BTC`, 264 bytes each, W2 and W8 |
| `market_stats` | `market_stats/{id}` or `market_stats/all` | index, mark, mid, best bid and ask, open interest, both funding rates, the last funding time, clamps, daily volume, premium | not stated | `all`: a first frame of 235 markets, 146,747 to 146,759 bytes, then one frame about every 1,000 ms, p50 1,000.0 ms, holding the markets that changed, 52 to 235 per frame, with p10 to p90 sizes between 43,406 and 71,345 bytes, W2, W4, W8 and W9. A market's row comes only when its stats change, see below |
| `trade` | `trade/{id}` | trades and liquidation trades | not stated | not probed |
| `height` | `height` | the block height | not stated | every 500 ms, p50 500.1 and 499.9 ms, 88 bytes, W2 and W8 |
| `candle`, `mark_price_candle` | per market and resolution | OHLCV | "as trades occur" | not probed |
| `spot_market_stats` | `spot_market_stats/{id}` or `/all` | spot index and stats | not stated | not probed |

`market_stats` is the only channel that carries index, mark and funding, and [`rest.md`](./rest.md) section 3 maps it to the anchor.
A market's row is sent only when its stats change, and not on every change of its best bid or ask.
Over 137 s, the longest wait between two rows of one active market was p10 4.0 s, p50 13.0 s, p90 43.6 s and max 80.4 s, and 123 of 213 markets waited more than 10 s at least once, W9.
On `1000SHIB`, `1000BONK`, `1000FLOKI` and `POPCAT`, the per market channel `market_stats/{id}` sent its rows at the same moments as `market_stats/all`, with the same longest waits of 7.0 to 20.3 s, so it is not a faster source, W11.
On those four markets, 21 of 49 changes of the best bid or ask price on `ticker` came with no `market_stats` row within 1.5 s, W11.
The 22 inactive markets in the first frame never sent a second row, W9.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every market, S1 | one socket carried all 213 perpetuals, W4 |
| subscribe frame shape | `{"type":"subscribe","channel":"order_book/{MARKET_INDEX}"}`, one channel per frame, S1 | an array under `channels` and a comma list under `channel` each answered error 30005, W3 and W7 |
| unknown symbol expectation | Not publicly specified | `{"error":{"code":30005,"message":"Invalid Channel:  (marketId)"}}` about 100 ms later, naming no market, and the socket stays open. An inactive market, `order_book/28` for `MKR`, answers the same, W3 and W7 |
| chunk unit and budget | 500 subscriptions a connection and 5,000 an IP, 200 client messages a minute, 50 in flight, S3 | 214 subscriptions on one socket, sent 0.5 s apart, were all served, W4 and W9 |
| keepalive mechanism | the client sends a frame at least every 2 minutes, a protocol ping or any message, and `{"type":"ping"}` is answered by `{"type":"pong"}`, S1 | pong in 97.2 to 104.0 ms over four pings, W2 and W8. The server sent no protocol ping and no application ping on any socket, W2 to W11 |
| connection lifetime and maintenance notice | "Deployments with no downtime might drop your connection", S3. The official SDK handles a `shutdown` frame with `close_in_ms`, S6 | no forced close and no `shutdown` frame in any run |
| handshake and operation rate limits | 255 connections and 255 new connections a minute per IP, S3 | 16 sockets opened over 20 minutes with no refusal on the read-only URL, W1 to W11 |
| public market data authentication | none on market channels. Account channels take an `auth` token, S1 | none. A restricted region must use `?readonly=true`, section 1 |
| message parse and routing | `{channel, type, …}`, S1 | route on `type`, then `channel` such as `order_book:1`, with a colon where the subscribe used a slash. Errors carry no `type` and no `channel` |
| subscribe acknowledgement shape | not separate | the first frame of a channel is its snapshot, typed `subscribed/order_book`, `subscribed/ticker`, `subscribed/market_stats` or `subscribed/height`. An unsubscribe is answered `{"type": "unsubscribed", "channel": "order_book:2"}`, W3 |
| symbol identifier format | the integer `market_id` of `orderBookDetails`, S1 | `order_book/1` for `BTC`, spelled back as `order_book:1`. `market_stats` keys rows by the same id as a string |
| number representation | prices and sizes as strings, S1 | as documented. `market_stats` sends prices as strings and daily volumes as JSON numbers |
| timestamp representation | the envelope `timestamp` in ms from the API server, `last_updated_at` in µs from the sequencer, S4 | as documented, section 4 |
| size unit | base asset units | coins of the base, which matches CCXT's `contractSize` of 1, section 4 |
| sequence semantics | "check that `begin_nonce` on the current update matches the `nonce` (i.e. `last_nonce`) of the previous update", S1. `offset` belongs to the API server and may jump | 0 gaps by that rule in 2,713 and 3,021 deltas on six markets, W2 and W8, and in 55,878 and 62,294 deltas over 213 markets, W4 and W9. `offset` rose on every frame and never went back |
| idle repeat behaviour | not documented | none. No delta was empty in 118,172, and 18 and 19 markets sent no delta in 137 s, W4 and W9 |

## 4. The book channel in detail

### Snapshot semantics

The first frame after a subscribe is `subscribed/order_book`, and it holds the whole book.
`BTC` came with 1,392 bids and 1,323 asks and `ETH` with 755 and 679, W2, and 1,377 and 1,300 and 756 and 684 in W8.
Over the 213 markets the snapshot held p10 15, p50 54 and max 1,409 bids, and p10 16, p50 46 and max 3,148 asks in W4, and p10 14, p50 52 and max 1,415 bids, and p10 15, p50 47 and max 3,156 asks in W9.
It arrived 97.7 to 130.0 ms after the subscribe frame was sent, p50 100.3 ms, in W4, and 95.6 to 156.9 ms, p50 97.9 ms, in W9.
The snapshot's `order_book` carries `nonce`, the state it shows, and `begin_nonce` 0.

### Delta semantics

Each `update/order_book` frame lists the levels that changed in one 50 ms batch, each with its new total size, S5.
A size of zero, written with the market's decimals such as `"0.00000"`, removes the level, S5.
`BTC` deltas held p50 5 and max 132 levels in W2, and 3,880 of those levels were removals, against p50 6, max 171 and 5,212 removals in W8.

### Sequence and gap rule

A delta continues the book when its `begin_nonce` equals the `nonce` of the previous frame on that market, the snapshot included, S1 and S5.
The first delta's `begin_nonce` equalled the snapshot's `nonce` on every market, and no gap occurred in 2,713 and 3,021 deltas over six markets, W2 and W8, or in 55,878 and 62,294 deltas over 213 markets, W4 and W9.
The nonce does not step by one: it advanced p50 54 and 52 on `BTC` per delta, W2 and W8, and S1 ties it to the matching engine.
`offset` is the API server's counter: it rose on every frame and never went back, but it is not continuous, and S1 says it can "change drastically on reconnection".
S5 says a gap means "you missed an update and must resubscribe", and gives the unsubscribe and subscribe pair of that one market as the repair.

### Checksum

None is sent and none is documented.

### Level order on the wire

Snapshot bids came in descending and asks in ascending price on 213 of 213 markets, W4 and W9, and every delta kept the same order, W2, W4, W8 and W9.

### Size unit against CCXT `contractSize`

Sizes are coins of the base: `BTC` levels such as `{"price":"82546.1","size":"0.13224"}`, W2.
CCXT's `contractSize` is `quote_multiplier`, 1 on every market, [`rest.md`](./rest.md) section 2, so they agree.
The five `1000` markets count price and size in units of 1,000 tokens, as the `1000PEPE` index of 0.003984 shows, [`rest.md`](./rest.md) section 2.

### One-sided and empty books

The same 14 markets sent an empty or one-sided snapshot in W4 and W9: `QCOM`, `AVGO`, `NOK`, `WDC`, `BYD`, `SOXS`, `BE`, `USDHKD`, `GME`, `POPMART`, `KIOXIA`, `ARM`, `AXTI` and `KORU`.
All 14 are among the 16 `force_reduce_only` markets of [`rest.md`](./rest.md) section 2.
`BYD`'s snapshot was `{"code":0,"asks":[],"bids":[],"offset":1,"nonce":0,…}`, with no delta in 62 s, W2.
No book went crossed in any run, W2, W4, W8 and W9.

### Idle repeats

None.
A quiet book sends nothing, and 18 and 19 markets sent no delta in 137 s, W4 and W9.

### Unknown, closed and malformed subscriptions

| frame sent | answer, W3 |
|---|---|
| `order_book/9999` | `{"error":{"code":30005,"message":"Invalid Channel:  (marketId)"}}` after 102 ms |
| `order_book/abc` | the same, 98 ms |
| `order_book/28`, inactive `MKR` | the same, 99 ms |
| `order_book:2`, a colon | `{"error":{"code":30005,"message":"Invalid Channel"}}` |
| `channels` as an array | `{"error":{"code":30005,"message":"Invalid Channel"}}` |
| `order_book/2,order_book/24` | `{"error":{"code":30005,"message":"Invalid Channel:  (marketId)"}}` |
| `{"type":"nope"}` | `{"error":{"code":30001,"message":"Invalid Type"}}` |
| `{"type":"subscribe"}` with no channel | `{"error":{"code":30005,"message":"Invalid Channel"}}` |
| `market_stats/9999` | `{"error":{"code":30005,"message":"Invalid Channel:  (marketId)"}}` |
| a second subscribe of `order_book/2` | `{"error":{"code":30003,"message":"Already Subscribed to : order_book:2"}}`, and no new snapshot |
| `unsubscribe` of `order_book/2` | `{"type": "unsubscribed", "channel": "order_book:2"}`, after one or two deltas already in flight, W3 and W7 |
| `unsubscribe` of a channel never subscribed | `{"error":{"code":30002,"message":"Not Subscribed to : order_book:24"}}` |

No error closed the socket, and no error names the market it refuses.
The rerun W7 gave the same answers.

### Age at arrival

The envelope `timestamp` is the API server's send time in ms, and `last_updated_at` is the newest sequencer execution time in the batch, in µs, S4.
The host clock was 1.7 ms from its NTP source.

| stream | arrival minus envelope `timestamp` | arrival minus `last_updated_at` | runs |
|---|---|---|---|
| `update/order_book`, six markets | min 49.1, p50 50.2, p90 51.2, p99 67.3, max 239.7 ms | min 51.7, p50 72.2, p90 99.2, max 361.2 ms | W2 |
| `update/order_book`, 213 markets | min 49.5, p50 50.7, p90 53.2, p99 77.3, max 238.7 ms | | W4 |
| `update/order_book`, 213 markets, rerun | min 48.0, p50 49.4, p90 51.8, p99 73.8, max 174.0 ms | | W9 |
| `update/ticker` | min 49.1 and 48.9, p50 50.1 and 50.0, p99 100.4 and 62.6 ms | | W2 and W8 |
| `update/market_stats` | min 51.6 in both, p50 52.5 and 52.6, max 105.5 and 103.1 ms | | W2 and W8 |
| `update/order_book`, six markets, rerun | min 48.9, p50 50.1, p90 52.0, p99 62.8, max 248.1 ms | min 52.4, p50 74.2, p90 101.5, max 379.6 ms | W8 |

A floor of about 49 ms on every stream is the one way trip from the origin plus any clock offset between it and this host.
S2 names AWS Tokyo as the place to run, and an application ping's round trip of 97.2 to 104.0 ms, W2 and W8, fits about 50 ms each way.

### Checking a rebuilt book against a fresh one

Two checks tried to compare a book rebuilt from deltas with a fresh snapshot at the same nonce, and neither could line up a nonce.
W8 unsubscribed and resubscribed `BTC` and `ETH` mid run, but the deltas stop with the unsubscribe, so each fresh snapshot came at a later nonce, 24486130476 against the last delta's 24486129522 on `BTC`.
W10 rebuilt `BTC` and `ETH` on two sockets at once for 20 s, and the two sockets shared 0 of 429 and 342 batch nonces on `BTC` and 0 of 446 and 352 on `ETH`, so the two sockets received differently cut batches.
So a feed cannot match one socket's nonces against another's, and the check of the merge rule rests on the 0 gaps and 0 crossed books above.

Checked on 2026-10-12, a quiet book does line up.
B1 repaired `BOT` with an unsubscribe, waited for the `unsubscribed` answer, then subscribed again, and the fresh snapshot came at nonce 24487609265, the nonce of the last delta before the unsubscribe.
The book rebuilt from the first snapshot and four deltas equalled that snapshot level for level, 19 bids and 32 asks.
So the merge rule holds, and the repair the docs give for a gap works one market at a time.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | a frame from the client at least every 2 minutes, a protocol ping or any message, S1. `{"type":"ping"}` is answered `{"type":"pong"}`. The SDK and CCXT Pro answer a server `{"type":"ping"}` with a pong, S6 and S7 | pong in 97.2 to 104.0 ms, W2 and W8. The server never pinged, at the protocol or the application level, over 60 to 137 s per socket, W2 to W11 |
| silence the server tolerates | "If the server receives no frames from a client within the 2-minute window, it will close the connection", S1 | a socket that subscribed to `height` and then sent nothing, while it received a frame every 500 ms, was closed at 120.1 s with code 1000 and a reason that reports an `i/o timeout` on the server's read of that socket, W5b. A socket that subscribed nothing and sent nothing was dropped at 60.0 s with no close frame, twice, W5a and W5b, which looks like the CloudFront idle limit |
| forced disconnect | possible on deployments, S3 | none in any run |
| maintenance notice | not in the reference. The SDK reads `{"type":"shutdown","close_in_ms":…}`, S6 | none seen |
| compression | "Support for `permessage-deflate` compression is enabled", S1 | negotiated only when offered: `permessage-deflate; server_no_context_takeover; client_no_context_takeover` on the read-only URL with an offer, and no extension without one, W1 and W6. Frames are text JSON |
| handshake | | 296 to 448 ms to open, W1 to W11. The first frame is `{"session_id":"…","type":"connected"}` within 3 ms of the open |
| subscription limits | 500 subscriptions a connection, 5,000 an IP, 200 client messages a minute, 50 in flight, 255 connections, S3 | not approached. 214 subscriptions at 120 a minute on one socket, W4 and W9 |
| throughput | | 213 books and `market_stats/all`: 410.2 and 457.0 frames and 252,818 and 284,483 bytes a second on average over 137 s, and 1,397 and 1,667 frames in the busiest second, W4 and W9 |

A reconnect resubscribes every channel, and 214 frames at the documented 200 client messages a minute take more than a minute.

## 6. Captured frames

Trimmed from W8, the rerun of the book mode at 22:42 UTC, and from W1 and W3.
Level arrays are cut to three per side and `market_stats` to one market, and the values are as received.

The refusal of the plain URL, the body of an HTTP 400 at the handshake, W1 and W6.

```json
{"code": 20558, "message": "You are accessing Lighter from a restricted jurisdiction. For more information, see the https://lighter.xyz/terms"}
```

The first frame on the read-only URL, then the subscribe frames as sent.

```json
{"session_id":"95b107e8-e35e-4582-9a00-ca74c66cda25","type":"connected"}
{"type":"subscribe","channel":"order_book/1"}
{"type":"subscribe","channel":"market_stats/all"}
```

The snapshot of `BTC`, whose `nonce` the first delta continues as its `begin_nonce`.

```json
{"channel":"order_book:1","last_updated_at":1791844923825302,"offset":6434828,"order_book":{"code":0,"asks":[{"price":"82532.0","size":"0.11754"},{"price":"82532.4","size":"0.01265"},{"price":"82532.5","size":"0.00013"}],"bids":[{"price":"82531.9","size":"0.00020"},{"price":"82531.8","size":"0.00020"},{"price":"82531.7","size":"0.00020"}],"offset":6434828,"nonce":24486088053,"last_updated_at":1791844923825302,"begin_nonce":0},"timestamp":1791844923894,"type":"subscribed/order_book"}
{"channel":"order_book:1","last_updated_at":1791844923931230,"offset":6434830,"order_book":{"code":0,"asks":[{"price":"82533.7","size":"0.00000"},{"price":"82535.5","size":"0.00000"}],"bids":[{"price":"82524.4","size":"0.00000"}],"offset":6434830,"nonce":24486088108,"last_updated_at":1791844923931230,"begin_nonce":24486088053},"timestamp":1791844923957,"type":"update/order_book"}
```

The best bid and ask, on its own nonce.

```json
{"channel":"ticker:1","last_updated_at":1791844928857557,"nonce":24486091563,"ticker":{"s":"BTC","a":{"price":"82505.5","size":"0.34997"},"b":{"price":"82505.4","size":"0.02045"},"last_updated_at":1791844928857557},"timestamp":1791844929023,"type":"update/ticker"}
```

One row of `market_stats/all`, keyed by `market_id` as a string, with funding in percent per hour and `funding_timestamp` on the last settlement, 22:00 UTC.

```json
{"channel":"market_stats:all","market_stats":{"0":{"symbol":"ETH","market_id":0,"index_price":"2486.17","mark_price":"2485.07","mid_price":"2484.62","best_ask_price":"2484.69","best_bid_price":"2484.54","open_interest":"80697722.841260","open_interest_limit":"72057594037927936.000000","funding_clamp_small":"0.0500","funding_clamp_big":"4.0000","last_trade_price":"2484.54","current_funding_rate":"0.0012","funding_rate":"0.0001","funding_timestamp":1791842400000,"daily_base_token_volume":146602.894,"daily_quote_token_volume":372045636.931112,"daily_price_low":2479.37,"daily_price_high":2578.09,"daily_price_change":-1.9987616196752604,"base_interest_rate":"0.0100","premium":"-0.0384"}},"timestamp":1791844929453,"type":"update/market_stats"}
```

The block height, the keepalive and its answer, an unsubscribe answer and an error.

```json
{"channel":"height","height":354154021,"timestamp":1791844930958,"type":"update/height"}
{"type":"ping"}
{"type":"pong"}
{"type": "unsubscribed", "channel": "order_book:1"}
{"error":{"code":30005,"message":"Invalid Channel:  (marketId)"}}
```

The server closed a socket that sent nothing for 2 minutes with a close frame of code 1000, whose reason began `read tcp` with two private addresses and ended `i/o timeout`, W5b.

## 7. Private channels

Named for a future execution stage, from S1, and not probed.

- The account channels are `account_all`, `account_market`, `user_stats`, `account_tx`, `account_all_orders`, `account_orders`, `account_all_trades`, `account_all_positions`, `account_all_assets`, `pool_data`, `pool_info`, `notification` and the RFQ channels, and each takes an `auth` token signed by an API key, S1.
- Orders go over the socket as `jsonapi/sendtx` and `jsonapi/sendtxbatch` with a signed `tx_info`, S1.
  The observatory never sends one.

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://mainnet.zklighter.elliot.ai/stream?readonly=true` | the plain URL refuses this exit with code 20558, and the read-only URL is the documented entrance for reading, section 1 |
| markets per connection | every active perpetual on one connection, 213 today, plus `market_stats/all`, 214 subscriptions | the cap is 500 a connection, and one socket carried 410 and 457 frames a second, W4 and W9 |
| subscribe frames | `{"type":"subscribe","channel":"order_book/<market_id>"}` per market, and `{"type":"subscribe","channel":"market_stats/all"}` first | one channel per frame, section 3 |
| `subscribe_gap` | 400 ms | 150 frames a minute keeps a reconnect under the 200 client messages a minute an IP may send, S3, and W4 ran at 120 a minute |
| keepalive | `ping_every` 30 s, with `{"type":"ping"}` or a protocol ping | the server closes after 120 s without a client frame, W5b, and never pings, so the client must |
| `max_silence` | 10 s | `market_stats/all` arrives every 1,000 ms and `BTC` deltas every 51 ms |
| routing | `type`, then the id after the colon in `channel` | section 3 |
| snapshot | on `subscribed/order_book`, `reset_book` with every level and keep `nonce` in the venue's `State` | the snapshot is the whole book |
| delta | on `update/order_book`, check that `begin_nonce` equals the kept `nonce`, apply each level with size 0 as a removal, keep the new `nonce`, and `publish` | S1 and section 4 |
| gap | the runtime's `resync`, or, as waves design decision 21 allows for xt and deepcoin, empty that one market's book and send its unsubscribe and subscribe through `Connection::send` | S5 gives the per market pair as the repair, and a full reconnect costs 214 frames, more than a minute at the message cap. No gap occurred in 123,906 deltas, W2, W4, W8 and W9, so the cheaper repair is a choice, not a need |
| error frames | log the whole frame with the last channel subscribed, since errors name no market | section 4 |
| empty books | expect no first book on the 14 `force_reduce_only` markets with empty snapshots, or leave them out in the loader as [`rest.md`](./rest.md) section 2 recommends | section 4 |
| depth | keep the whole book in the venue's state and hand the engine its top levels | the engine holds 20 levels at [`index_builder.rs`](../../../server/src/engine/cluster/index_builder.rs) line 8, and the p10 snapshot held only 14 to 15 bids, W4 and W9 |
| anchor | `market_stats/all` on the same connection, written into `SocketAnchors`, as [`rest.md`](./rest.md) section 8 maps it | the REST reply is cached at the edge for about 5 s. A quiet market's row ages past the engine's 10 s limit, section 2, which [`rest.md`](./rest.md) section 8 weighs |
| deflate | do not offer it | the runtime does not, and the server then sends plain text, W1 and W6 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Lighter API Docs, WebSocket reference | https://apidocs.lighter.xyz/docs/websocket-reference | 2026-10-12, page updated 2026-10-07 | Lighter, API docs | URLs, keepalive, deflate, channels, frame shapes, continuity rule, account channels, sections 1 to 5 and 7 |
| S2 | Lighter API Docs, Environments and endpoints | https://apidocs.lighter.xyz/docs/environments | 2026-10-12 | Lighter, API docs | read-only socket for restricted regions, Tokyo colocation, sections 1 and 4 |
| S3 | Lighter API Docs, Rate Limits | https://apidocs.lighter.xyz/docs/rate-limits | 2026-10-12, page updated 2026-10-08 | Lighter, API docs | per IP socket limits, deployment drops, sections 3, 5 and 8 |
| S4 | Lighter API Docs, Timestamps | https://apidocs.lighter.xyz/docs/timestamps | 2026-10-12 | Lighter, API docs | envelope and sequencer clocks, section 4 |
| S5 | Lighter API Docs, Market data | https://apidocs.lighter.xyz/docs/market-data | 2026-10-12 | Lighter, API docs | size 0 removes a level, resubscribe on a gap, section 4 |
| S6 | lighter-python `ws_client.py` | https://github.com/elliottech/lighter-python/blob/main/lighter/ws_client.py | 2026-10-12 | Lighter, official SDK | `connected`, `ping` and `shutdown` handling, section 5 |
| S7 | CCXT Pro 4.5.68 `lighter.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/lighter.js` | 2026-10-12 | CCXT | URL at line 49, `order_book/` channel at line 194, `market_stats/all` at line 351, pong to a server ping at lines 1200 to 1202 and 1275 to 1282, and no gap check, since lines 123 and 169 store `offset` as the nonce, sections 3 and 5 |
| W1 | `ws-probe.py deflate p1` at 22:27 UTC, four handshakes | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 5 and 8 |
| W2 | `ws-probe.py book p1` at 22:27 UTC, six books, `ticker/1`, `market_stats/all` and `height` for 62 s | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 5 |
| W3 | `ws-probe.py errors p1` at 22:29 UTC | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 4 |
| W4 | `ws-probe.py batch p1` at 22:30 UTC, 213 books and `market_stats/all` on one socket for 137 s | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 5 and 8 |
| W5a | `ws-probe.py silence p1` at 22:33 UTC, one idle socket | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 5 |
| W5b | `ws-probe.py silence p1b` at 22:35 UTC, an idle socket and a socket subscribed to `height`, both silent | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 5 |
| W6 | `ws-probe.py deflate p2` at 22:41 UTC, the rerun of W1 | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 and 5 |
| W7 | `ws-probe.py errors p2` at 22:43 UTC, the rerun of W3 | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 4 |
| W8 | `ws-probe.py book p2` at 22:42 UTC, the rerun of W2 with a resubscribe of `BTC` and `ETH` and one REST `funding-rates` call | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 6 |
| W9 | `ws-probe.py batch p2` at 22:43 UTC, the rerun of W4 | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 5 and 8 |
| W10 | `ws-probe.py twin p2` at 22:46 UTC, two sockets on `BTC` and `ETH` for 20 s | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 4 |
| W11 | `ws-probe.py quiet p2` at 22:47 UTC, `market_stats` and `ticker` on four quiet markets for 45 s | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| B1 | the Rust adapter's `capture_frames` probe at 23:06 UTC, `order_book/185` and `order_book/1` for 14 s with a repair of `BOT` halfway, in `server/src/venues/lighter/tests.rs` | | 2026-10-12 | this host, Canadian exit | section 4 |

The silence mode was not rerun in the second pass.
Its idle case closed at 60.0 s in both W5a and W5b, and its subscribed case matched the documented 2 minutes, while a rerun would have added two more minutes to socket time already past the ten minutes this research aimed for.
Socket wall time over all runs was about 13 minutes, three of them on silent sockets that sent nothing.
