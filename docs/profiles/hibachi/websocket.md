# Hibachi WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:18 to 22:42 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market socket of Hibachi (CCXT id `hibachi`), with the book channel in detail.
Hibachi's only product is linear perpetuals settled in USDT, and one socket carries all fifteen.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/hibachi/ws-probe.py), run with `uv run` from the repository root, and the runs are listed as W1 to W4 in section 9.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The socket's own documentation is a Postman workspace whose three request pages could not be read as text, so the documented values come from Hibachi's official Python SDK, S3 to S5, and most axes below are Not publicly specified.
Fees and access are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).
All times are UTC.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| every perpetual, public market data | `wss://data-api.hibachi.xyz/ws/market`, S3 | open in 344 to 426 ms, status 101, `server: cloudflare`, `cf-ray` ending `-YVR` or `-SEA`, W1 and W4 |
| the same with the SDK's query string | `wss://data-api.hibachi.xyz/ws/market?hibachiClient=HibachiPythonSDK/<version>`, S3 | the same reply, so the query string is optional, W1 |
| private trading | `wss://api.hibachi.xyz/ws/trade`, S5 | not opened |
| private account stream | `wss://api.hibachi.xyz/ws/account`, S5 | not opened |

One socket carried the eight crypto perpetuals and the seven FX perpetuals together, W1.

## 2. Channel matrix for public market data

The topics are the SDK's `WebSocketSubscriptionTopic` values, S4.
Cadences are from W1, W3 and W4, over 25 to 40 s per run.

| topic | payload | probed cadence |
|---|---|---|
| `orderbook` | a snapshot on subscribe, then deltas, with `depth` 1 to 100 and a `granularity` from the market's `orderbookGranularities` | one frame per market every 301 to 312 ms, p50 302 ms, whether or not anything changed |
| `ask_bid_price` | `askPrice`, `askSize`, `bidPrice`, `bidSize` and `timestampMs` | every 302 to 303 ms per market at p50, repeated unchanged |
| `mark_price` | `markPrice` | every 302 to 303 ms per market at p50, repeated unchanged |
| `spot_price` | `spotPrice`, the index | every 302 to 303 ms per market at p50, repeated unchanged |
| `funding_rate_estimation` | `estimatedFundingRate` and `nextFundingTimestamp` in seconds | every 302 to 303 ms per market at p50, repeated unchanged |
| `trades` | trade prints | not probed |
| `klines` | | not probed |

The `timestampMs` of `ask_bid_price` is the time of the last change, not of the push.
It trailed arrival by a median of 1,588 to 2,189 ms and by up to 63,565 ms on a quiet market, W1, W3 and W4.
`mark_price`, `spot_price` and `funding_rate_estimation` carry no time at all.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market socket on the data host, S3 | one socket carried all 15 perpetuals, crypto and FX, W1 |
| subscribe frame shape | `{"method":"subscribe","parameters":{"subscriptions":[{"symbol":"BTC/USDT-P","topic":"mark_price"}]}}`, an array per frame, S3 | as documented. 15 books in one frame and 60 anchor subscriptions in one frame were all served. `depth` is an integer and `granularity` a string, and a number such as `0.1` answers `Invalid "subscribe.parameters".`, W1 |
| unknown symbol expectation | Not publicly specified | `{"error":"Could not find symbol \"FOO/USDT-P\".","original_request":"…"}` about 110 ms after the frame, and the socket stays open. The probe printed about 450 ms because its clock started before the 344 to 426 ms handshake, as W5 found on 2026-10-12. The whole frame is refused, so `SOL/USDT-P` sent in the same frame got no stream. A `CLOSED` symbol such as `DOGE/USDT-P` gets no error and no frame, and `SOL/USDT-P` beside it was served, W1 and W2 |
| chunk unit and budget | Not publicly specified | 60 subscriptions on one socket, all served, W1 |
| keepalive mechanism | Not publicly specified | no application ping, since `{"method":"ping"}` answers `Unknown method "ping".`. A protocol ping is answered with a pong in 104 to 126 ms. The server sent no protocol ping on any socket held 30 to 66 s, W1, W2 and W4 |
| connection lifetime and maintenance notice | Not publicly specified. Maintenance windows are listed in the REST `/market/exchange-info` reply, see [`rest.md`](./rest.md) section 6 | no forced close of a subscribed socket within 66 s, and no notice frame, W2 and W4 |
| handshake and operation rate limits | Not publicly specified for the socket. REST allows 350 requests per 10 s per IP, S6 | 14 sockets opened one after another in about 40 s and 3 held at once, with no refusal, W1, W2 and W4 |
| public market data authentication | none for `/ws/market`, S1 | none |
| message parse and routing | | route on `topic`, then `symbol`. A book frame adds `messageType`, `Snapshot` or `Update`. An error frame has only `error` and `original_request` |
| subscribe acknowledgement shape | Not publicly specified | none. The first snapshot came 104 to 198 ms after the subscribe frame, W1 and W4. An unsubscribe is not acknowledged either, W2 and W4 |
| symbol identifier format | `BTC/USDT-P`, S3 | as documented, the same string as CCXT's `market.id` and the REST `symbol`. Case matters, and `btc/usdt-p` is refused as an unknown symbol, W1 |
| number representation | | prices and quantities as decimal strings such as `"82570.6"` and `"0.0302770837"`, a deletion as a zero quantity such as `"0.0000000000"`, `depth` as an integer and `granularity` as a string, W4 |
| timestamp representation | | `timestamp_ms`, integer ms, at the top level of a book frame. `timestampMs` inside `ask_bid_price`. `nextFundingTimestamp` in integer seconds |
| size unit | real units of the underlying, S1 | base coins, such as `0.0302770837` BTC, which is CCXT's `contractSize` 1, section 4 |
| sequence semantics | none documented | no sequence number and no checksum. Each side carries `startPrice` and `endPrice`, the best and worst price of the window after the frame, section 4 |
| idle repeat behaviour | | every market gets an `Update` every 302 ms, with empty `levels` when nothing changed, as on 130 of the 132 `CAD/USDT-P` updates in 40 s, W1 |

## 4. The book channel in detail

### Snapshot and deltas

The first frame of each market is `messageType` `Snapshot`, with the whole window, and every later frame is `Update`, W1.
An update lists absolute quantities by price, and a quantity of zero deletes the level.
A level that enters the window arrives as an addition, and a level that leaves it arrives as a deletion.
So the book rebuilt from the deltas never held more levels a side than `depth`, and its best and worst prices equalled `startPrice` and `endPrice` after every one of 1,988 frames on 15 markets in W1 and 1,500 in W4.
A second socket opened halfway through each run received 15 snapshots, and in both runs each was identical, level for level, to the book rebuilt on the first socket at the same `timestamp_ms`.
That is the proof that the deltas are complete and absolute.

### Sequence and the gap rule

No frame carries a sequence number or a checksum.
`timestamp_ms` rose by 301 to 312 ms per market per frame, p50 302 ms, and never went backwards, W1 and W4.
Markets do not share one push clock, because the 347 distinct values of `timestamp_ms` in W1, and the 262 in W4, held from 1 to 8 markets each.
Over one TCP connection a frame cannot be lost, so the window check is the guard against a server that skips a frame.
After applying a frame, a side with more levels than `depth`, or whose best or worst price differs from `startPrice` or `endPrice`, means the book is wrong.

### Depth and granularity

| subscription on `BTC/USDT-P` | first frame |
|---|---|
| no `depth` and no `granularity` | `depth` 20 and `granularity` `"0.1"`, the finest, which is the tick size, 20 bids and 20 asks |
| `depth` 1 | 1 and 1 |
| `depth` 50 | 50 and 47, then 50 and 50 |
| `depth` 100 | 74 and 54, then 76 and 54, the whole book |
| `depth` 101 | `{"error":"Depth 101 must be inside range [1, 100].",…}` |
| `depth` 20, `granularity` `"10"` | 20 and 20 in buckets of 10 USDT |
| `granularity` `"0.5"`, not listed | `{"error":"Unknown granularity 0.5.",…}` |

All from W1 and W4.
The default subscription is the engine's 20 levels at the tick size, so it needs no parameters.

### Level order on the wire

In the captured snapshot of section 6 the bids come best first, descending, and the asks best first, ascending, and the REST book of [`rest.md`](./rest.md) section 5 kept that order on every level in both runs.
A feed should still set each level by price rather than rely on the order of a delta's levels.

### Size unit against CCXT `contractSize`

Quantities are in coins of the underlying, which the API documentation states for every quantity, S1.
The `BTC/USDT-P` snapshot of section 6 shows `0.0302770837` at 82,570.6 USDT, about 2,500 USDT, and the REST book of `JPY/USDT-P` showed `65019` at 0.006307 USDT, about 410 USDT, [`rest.md`](./rest.md) run R2.
CCXT sets `contractSize` 1 on every market at `hibachi.js` line 315, S9, so the engine multiplies by 1.

### Thin, one-sided and empty books

No book was one-sided in W1 or W4.
Several are thin: `XAG/USDT-P` held 4 to 12 bids and 4 to 12 asks, `NZD/USDT-P` 5 to 15 bids, and `SUI/USDT-P` 4 to 13 asks, W1 and W4.
No side was ever empty, so what `startPrice` and `endPrice` hold on an empty side was not seen.

### Unknown, closed and repeated subscriptions

| case | reply, W1, W2 and W4 |
|---|---|
| unknown symbol | an error frame naming it, and the socket stays open |
| unknown symbol in a frame with a good one | one error frame, and neither market is served |
| `CLOSED` symbol | nothing at all |
| `CLOSED` symbol in a frame with a good one | the good one is served |
| the same market subscribed twice | one snapshot, then the one stream, with no second snapshot |
| unsubscribe | the stream stops, after at most one frame already in flight, with no acknowledgement |
| subscribe again after an unsubscribe | a fresh `Snapshot`, then updates |
| unsubscribe of a market never subscribed | nothing |

So one market can be reseeded without closing the socket, by sending its unsubscribe and then its subscribe.
The two frames may go out back to back with `depth` 20 in both, since W5 got one frame already in flight and then a fresh `Snapshot` 109 ms after them, on 2026-10-12.

### Halts and auctions

FX markets halt from Friday 17:00 to Sunday 17:00 New York time, and a scheduled maintenance stops the whole exchange, S8 and S10.
Trading resumes through a call auction, during which "the book is allowed to cross" and nothing trades, S7.
Neither a halt nor an auction was captured, because none fell inside the probe window.
What the socket sends during a halt, and whether a frame marks the auction, is unknown.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | protocol ping answered in 104 to 126 ms, W2 and W4. No application ping exists |
| silence the server tolerates | Not publicly specified | a socket that subscribed to nothing and sent nothing was closed at 60.3, 60.4 and 60.5 s with code 1006 and no close frame, W1, W2 and W4. A socket with one book subscription that sent nothing more stayed open for 66 s, and so did an unsubscribed socket that sent a protocol ping every 20 s, W2 and W4 |
| forced disconnect | Not publicly specified | none within 66 s |
| maintenance notice | the next windows appear in `/market/exchange-info` `maintenanceWindow`, see [`rest.md`](./rest.md) section 6 | no notice frame seen |
| compression | Not publicly specified | text JSON frames. A client offering permessage-deflate got no `sec-websocket-extensions` header back, W1 |
| handshake | | 344 to 426 ms from this host through Cloudflare YVR or SEA, W1 and W4 |
| subscription limits | Not publicly specified | not approached with 60 on one socket |
| throughput | | 15 books at depth 20 on one socket: 49.7 to 50.0 frames a second, 18.0 to 20.0 KiB a second, 267 bytes a frame at p50 and 2,791 to 3,205 at most, and 9.3 to 9.8 µs of Python `json.loads` a frame at p50, W1 and W4 |
| frame age | | arrival minus `timestamp_ms` was min 56 to 58, p50 65, p90 71 and max 197 to 441 ms, W1 and W4, with the server clock 4 to 9 ms ahead of this host at the median, see [`rest.md`](./rest.md) section 7 |

## 6. Captured frames

Trimmed from W4, with level arrays cut to three a side and values as received.

Subscribe to one book at the default depth.

```json
{"method":"subscribe","parameters":{"subscriptions":[{"symbol":"BTC/USDT-P","topic":"orderbook"}]}}
```

The snapshot that opens the stream.

```json
{"data":{"ask":{"endPrice":"82607.4","levels":[{"price":"82570.7","quantity":"0.0605577541"},{"price":"82570.8","quantity":"0.0309421204"},{"price":"82571.0","quantity":"0.0021399659"}],"startPrice":"82570.7"},"bid":{"endPrice":"82546.6","levels":[{"price":"82570.6","quantity":"0.0302770837"},{"price":"82568.3","quantity":"0.0121239497"},{"price":"82567.4","quantity":"0.0242481683"}],"startPrice":"82570.6"}},"depth":20,"granularity":"0.1","messageType":"Snapshot","symbol":"BTC/USDT-P","timestamp_ms":1791844734215,"topic":"orderbook"}
```

A delta 300 ms later, with an absolute quantity at each changed price.

```json
{"data":{"ask":{"endPrice":"82607.4","levels":[{"price":"82570.8","quantity":"0.0317091040"}],"startPrice":"82570.7"},"bid":{"endPrice":"82546.6","levels":[{"price":"82570.6","quantity":"0.0304688296"}],"startPrice":"82570.6"}},"depth":20,"granularity":"0.1","messageType":"Update","symbol":"BTC/USDT-P","timestamp_ms":1791844734515,"topic":"orderbook"}
```

A delta with nothing changed, which still carries the window's prices.

```json
{"data":{"ask":{"endPrice":"82579.3","levels":[],"startPrice":"82555.2"},"bid":{"endPrice":"82534.7","levels":[],"startPrice":"82555.1"}},"depth":20,"granularity":"0.1","messageType":"Update","symbol":"BTC/USDT-P","timestamp_ms":1791844742686,"topic":"orderbook"}
```

An error, for an unknown symbol, W1.

```json
{"error":"Could not find symbol \"FOO/USDT-P\".","original_request":"{\"method\": \"subscribe\", \"parameters\": {\"subscriptions\": [{\"symbol\": \"FOO/USDT-P\", \"topic\": \"orderbook\"}]}}"}
```

An anchor frame of each kind, W3.

```json
{"data":{"markPrice":"0.696400000"},"symbol":"AUD/USDT-P","topic":"mark_price"}
```

```json
{"data":{"spotPrice":"0.695907500"},"symbol":"AUD/USDT-P","topic":"spot_price"}
```

```json
{"data":{"fundingRateEstimation":{"estimatedFundingRate":"0.000051","nextFundingTimestamp":1791846000}},"symbol":"AUD/USDT-P","topic":"funding_rate_estimation"}
```

No keepalive frame is shown, because the answer to a protocol ping is a protocol pong, which carries no JSON.

## 7. Private channels

- `wss://api.hibachi.xyz/ws/trade` places, modifies and cancels signed orders, S5.
  It offers `orders.enableCancelOnDisconnect`, a signed message that cancels the account's orders when the socket drops without a normal close, S2.
- `wss://api.hibachi.xyz/ws/account` streams account updates after a listen key is obtained, and keeps it alive with `stream.ping`, S5.
- Both need an API key, S1.
  The observatory opened neither.

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://data-api.hibachi.xyz/ws/market`, for every market | one socket carried all 15, W1 |
| markets per connection | all of them, 15 today | about 50 frames and 18 to 20 KiB a second, W1 and W4 |
| subscribe frames | one frame per market, `{"method":"subscribe","parameters":{"subscriptions":[{"symbol":"<market.id>","topic":"orderbook","depth":20}]}}` | one unknown symbol voids its whole frame, so a frame per market loses only that market, and the error names it |
| depth | 20, at the default granularity, the tick size | the engine's `DEPTH_LEVEL` at [`index_builder.rs`](../../../server/src/engine/cluster/index_builder.rs) line 8 |
| routing | `topic` `orderbook`, then `symbol`, which equals `market.id` | section 3 |
| snapshot | on `Snapshot`, `reset_book` with both sides and `publish` | the snapshot is the whole window |
| delta | on `Update`, set every level by price, delete on a zero quantity, then run the window check, then `publish` | section 4 |
| window check | each side holds at most `depth` levels, and its best and worst prices equal `startPrice` and `endPrice`. On a failure, empty that market's book and send its unsubscribe and its subscribe, as xt reseeds one market at [`xt.rs`](../../../server/src/venues/xt.rs) line 299 | no sequence exists, and a fresh subscribe yields a fresh snapshot without closing the socket, W2 |
| crossed top | publish nothing for that market while its top is crossed, keep applying frames, and publish again once a frame uncrosses it | a reopening call auction allows a crossed book, S7, so a reseed would only fetch the same crossed book |
| keepalive | `ping_every` 20 s with the runtime's protocol ping | not needed while the books stream, but answered in about 110 ms and it keeps even a quiet socket open, W2 |
| `max_silence` | 10 s | every market sends a frame every 302 ms, changed or not, W1 |
| error frames | log `error` with `original_request` and carry on | the socket stays open after every error seen, W1 and W2 |
| catalog guard | subscribe only `LIVE` markets | a `CLOSED` market is silent and an unknown one voids its frame |
| deflate | none | the server does not negotiate it, W1 |
| receive time | stamp on arrival, and keep `timestamp_ms` for the book's age | about 65 ms from the server stamp to arrival here, W1 and W4 |
| anchor | keep the REST poll of [`rest.md`](./rest.md) section 8 | it trails the socket by at most about 1 s. The socket's `mark_price` and `spot_price` would fit `SocketAnchors` as a fallback, at 60 subscriptions for 15 markets, W3 |

The feed fits `BookVenue` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 78 with no REST seeding, since the socket sends its own snapshot.
`Connection::send` at line 228 carries the per-market unsubscribe and subscribe, and `reset_book` at line 204 empties a book.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hibachi API documentation, introduction and "Websocket API" | https://api-doc.hibachi.xyz/ | 2026-10-12 | Hibachi, Postman documenter | no key for `/ws/market`, quantities in real units, sections 3, 4 and 7 |
| S2 | Postman public workspace, "Hibachi Websockets API" collection | https://www.postman.com/hibachi-xyz/hibachi-public/collection/6707f03b7c82ad6d2f10477c | 2026-10-12 | Hibachi, Postman | cancel on disconnect, section 7. Its three request pages did not render as text |
| S3 | Hibachi SDK `api_ws_market.py` | https://github.com/hibachi-xyz/hibachi_sdk/blob/main/python/hibachi_xyz/api_ws_market.py | 2026-10-12 | Hibachi, official SDK | URL, query string, subscribe and unsubscribe frames, sections 1 and 3 |
| S4 | Hibachi SDK `types.py`, `WebSocketSubscriptionTopic` | https://github.com/hibachi-xyz/hibachi_sdk/blob/main/python/hibachi_xyz/types.py | 2026-10-12 | Hibachi, official SDK | topic names, section 2 |
| S5 | Hibachi SDK `api_ws_trade.py` and `api_ws_account.py` | https://github.com/hibachi-xyz/hibachi_sdk/tree/main/python/hibachi_xyz | 2026-10-12 | Hibachi, official SDK | private socket paths and `stream.ping`, sections 1 and 7 |
| S6 | Hibachi Docs, Limits | https://docs.hibachi.xyz/hibachi-docs/trading/limits | 2026-10-12 | Hibachi, docs | REST limit per IP, section 3 |
| S7 | Hibachi Docs, Call auctions | https://docs.hibachi.xyz/hibachi-docs/trading/call-auctions | 2026-10-12 | Hibachi, docs | crossed book in an auction, sections 4 and 8 |
| S8 | Hibachi Docs, FX trading | https://docs.hibachi.xyz/hibachi-docs/trading/fx-trading | 2026-10-12 | Hibachi, docs | weekend halt, section 4 |
| S9 | CCXT 4.5.68 `hibachi.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/hibachi.js` | 2026-10-12 | CCXT | `pro` false at line 29, so CCXT has no socket class, and `contractSize` 1 at line 315, section 4 |
| S10 | Hibachi Docs, FAQ, Liquidation | https://docs.hibachi.xyz/faq | 2026-10-12 | Hibachi, docs | the exchange is down during maintenance, section 4 |
| W1 | `ws-probe.py hosts book depth anchors errors silence --seconds 40`, 22:25 to 22:29 UTC | [`ws-probe.py`](../../../scripts/probes/venues/hibachi/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 5 |
| W2 | `ws-probe.py silence errors`, three silent sockets at once, then the error cases tagged by phase, 22:30 to 22:32 UTC | [`ws-probe.py`](../../../scripts/probes/venues/hibachi/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 to 5 |
| W3 | `ws-probe.py anchors --seconds 25`, with the REST inventory polled beside it, 22:34 UTC | [`ws-probe.py`](../../../scripts/probes/venues/hibachi/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 6 and 8 |
| W4 | the second pass, `ws-probe.py hosts book depth anchors errors silence --seconds 30`, 22:38 to 22:42 UTC | [`ws-probe.py`](../../../scripts/probes/venues/hibachi/ws-probe.py) | 2026-10-12 | this host, Canadian exit | every section, and the frames of section 6 |
| W5 | the builder's capture, the ignored Rust test `capture_frames` beside the adapter, 22:59 UTC | `server/src/venues/hibachi/tests.rs` | 2026-10-12 | this host, Canadian exit | the error delay of section 3 and the back to back reseed of section 4 |

Sockets were open for about ten minutes of wall time in all, counting about one minute of first look at the protocol before the probe was written.
