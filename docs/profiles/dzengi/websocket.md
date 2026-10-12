# Dzengi WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 04:07 to 04:30 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

Dzengi lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
The Leverage mode's symbols are named where the socket treats them differently.
Every probed number comes from [`ws-probe.py`](../../../scripts/probes/venues/dzengi/ws-probe.py), run three times, the third with `--short` in the second pass.
Socket time over the three runs was about ten minutes of wall time, most of it in the 90 second book mode and the 75 second idle test.

## 1. Endpoints

| URL | role | evidence |
|---|---|---|
| `wss://api-adapter.dzengi.com/connect` | the one public and private socket, spot and Leverage mode alike | `Published` S2, `Probed` |
| `wss://demo-api-adapter.dzengi.com/connect` | demo accounts | `Published` S2, the host resolves, not connected |
| `wss://api-adapter.backend.dzengi.com/connect` | the host in the docs' code sample | `Probed`: does not resolve, "Name or service not known" |

One socket carries every symbol of both modes.
The host sits behind Cloudflare, and the handshake reply carried `CF-RAY` ending in `SEA`.

## 2. Channel matrix for public market data

Destinations come from the Swagger's `websocket-api` tag, S3.

| destination | content | probed |
|---|---|---|
| `depthMarketData.subscribe` | book, up to 20 price levels a side, pushed as event `marketdepth.event` | yes, 20 levels a side on every spot frame. No event ever arrived for a Leverage symbol. |
| `marketData.subscribe` | best bid and ask with sizes, event `internal.quote` | yes, on spot and Leverage symbols |
| `trades.subscribe` | trades, event `internal.trade` | not probed |
| `OHLCMarketData.subscribe` | candles | not probed |
| `/api/v2/depth` and the other REST paths | request and reply over the socket, the same body as REST | yes, `/api/v2/depth` answered with `lastUpdateId`, `asks` and `bids` |
| `ping` | keepalive | yes |
| mark, index, funding | none | `Not offered`, no such destination in S3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S2 | one URL for spot and Leverage mode |
| subscribe frame shape | `{"destination", "correlationId", "payload"}` with `payload.symbols` an array, S2 and S3 | `{"destination": "depthMarketData.subscribe", "correlationId": 1, "payload": {"symbols": ["BTC/USDT", ...]}}` |
| unknown symbol expectation | Not publicly specified | The ack carries `"NOPE/USD": "ERROR: NOPE/USD not found"` in `subscriptions`, with `status` `OK`. |
| chunk unit and budget | Not publicly specified | One frame naming all 112 TRADING spot crypto symbols got 40 `PROCESSED` and 72 `"ERROR: Max Subscription limit reached."`. |
| keepalive mechanism | client sends `ping`, "connection is closed in case API is not pinged for a 30-seconds time interval", S2 | `ping` answered `{"status": "OK", "destination": "ping", "correlationId": "5", "payload": {}}` in 215 to 243 ms. No server ping arrived. |
| connection lifetime and maintenance notice | 30 s without a ping, S2 | A socket that sent nothing was dropped after 60.9 s in both runs that tried it, close code 1006 with no close frame. A socket with a live subscription and no ping was still open at 75 s in all three runs. No maintenance frame was seen. |
| handshake and operation rate limits | Not publicly specified beyond 40 subscriptions | Handshake took 956 to 1983 ms. Two sockets at once were accepted. |
| public market data authentication | none for subscriptions, S3 | none |
| message parse and routing | `Destination` and `Payload` with capitals in the examples, S3 | lower case `destination`, `payload`, and `data`, `bid`, `ofr` inside. Route on `destination`, then `payload.symbol` for depth or `payload.symbolName` for quotes. |
| subscribe acknowledgement shape | `SubscribeResponse` with `subscriptions` map, S3 | `{"status": "OK", "destination": "depthMarketData.subscribe", "correlationId": "1", "payload": {"subscriptions": {"BTC/USDT": "PROCESSED", ...}}}`. The `correlationId` comes back as a string. |
| symbol identifier format | the `exchangeInfo` symbol, with `_LEVERAGE` appended for the Leverage mode, S2 | `BTC/USDT`, `BTC/USD_LEVERAGE`, identical to REST |
| number representation | numbers, S3 | Book prices are JSON object keys, so strings, such as `"82583.65000000001"`, with float noise. Sizes are JSON numbers. |
| timestamp representation | `ts` in ms, S3 | `data.ts` integer ms. Receive minus `ts` had a median of 98 to 112 ms across runs, against a clock offset of 32 to 40 ms, see [`rest.md`](./rest.md) section 7. |
| size unit | Not publicly specified | base asset, the same as the REST book and the `LOT_SIZE` filter |
| sequence semantics | none | no sequence field, only `ts`, which never went backwards |
| idle repeat behaviour | Not publicly specified | A frame is pushed only on a change. No frame equalled the previous one, and 22 and 18 of 40 subscribed symbols sent nothing in 30 s in two runs. |

The socket negotiates `permessage-deflate;client_max_window_bits=15`, and every frame is a text frame of plain JSON.

## 4. The book channel in detail

### Snapshot on subscribe

There is no snapshot on subscribe.
With 40 symbols subscribed on one socket, 22 sent nothing within 30 s in one run and 18 in another, which only happens if a frame waits for a change.
A feed must seed each book from `GET /api/v2/depth` or the socket's `/api/v2/depth` request, see [`rest.md`](./rest.md) section 5.

### Delta semantics

Every `marketdepth.event` is a full replacement of the top 20 levels a side.
All 359 spot depth frames of the book mode over the three runs carried exactly 20 bids and 20 offers.
A level that leaves the top 20 simply disappears from the next frame.

### Sequence and gap rule

There is no sequence number.
`data.ts` is the only ordering field, and it never went backwards in any run.
Because each frame replaces the whole window, a lost frame costs only staleness until the next one, and no resync is needed.

### Checksum

None documented, none on the wire.

### Level order on the wire

`bid` and `ofr` are JSON objects keyed by price.
In the frames captured, `bid` keys were in descending price order and `ofr` keys in ascending order, but JSON objects carry no order guarantee, so a parser should sort.

### Level window

20 levels a side, fixed.
The REST book gives the same 20 at most, see [`rest.md`](./rest.md) section 5.

### Size unit

Sizes are in the base asset.
The top BTC/USDT level was 6.0 BTC on both the socket and REST, and `LOT_SIZE` gives `minQty` 0.0001 and `stepSize` 0.0001 in BTC.
There is no contract size.

### One-sided and empty books

Not observed.
Every spot book captured had 20 levels a side.

### Idle repeats

None.
In the two 90 s runs the busiest spot books, BTC/USD and BTC/USDT, had a median gap of 145 to 444 ms between frames.
In the 30 s run of the second pass the same two books sent only 5 and 6 frames, with gaps up to 12.1 s.
ETH/USDT had a median gap of 2.1 to 2.5 s in the 90 s runs and the longest gap seen, 20.7 s.
So a silence timer must not be tied to one symbol.

### Unknown and closed symbols

| request | answer |
|---|---|
| `NOPE/USD` | ack with `"NOPE/USD": "ERROR: NOPE/USD not found"` |
| `BTC/USDT_LEVERAGE`, a Leverage name that does not exist | ack with `"ERROR: BTC/USDT_LEVERAGE not found"` |
| `BTC/USD_LEVERAGE`, a real Leverage symbol | ack `PROCESSED`, then no depth event in any run, while `marketData.subscribe` sent 8 to 29 quotes per Leverage symbol in 30 s |
| an unknown destination | `{"status": "ERROR", "correlationId": "3", "payload": {"errorCode": "BAD_REQUEST"}}` |
| a frame that is not JSON | `{"status": "ERROR", "payload": {"errorCode": "BAD_REQUEST"}}`, and the socket stays open |

## 5. Session

| item | value |
|---|---|
| keepalive | send `{"destination": "ping", "correlationId": n, "payload": {}}`, answered in about 220 ms |
| silence tolerated | Documented 30 s. A socket that sent nothing at all was dropped at about 61 s with close code 1006. A subscribed socket that never pinged stayed open past 75 s. |
| forced disconnects | none seen in about ten minutes |
| maintenance notices | none seen, and none documented |
| compression | permessage-deflate negotiated |
| subscription limit | 40 symbols per socket per destination, from the ack, section 3 |
| trading hours | The BTC/USDT row in `exchangeInfo` carries `tradingHours` with a pause from 21:00 to 21:05 UTC each day, 21:00 to 22:01 UTC on Friday, and also 05:00 to 07:00 UTC on Saturday. The socket was not held across a pause. |

## 6. Captured frames

Subscribe acknowledgement:

```json
{"status": "OK", "destination": "depthMarketData.subscribe", "correlationId": "1", "payload": {"subscriptions": {"BTC/USD": "PROCESSED", "ETH/USDT": "PROCESSED", "ETH/USD_LEVERAGE": "PROCESSED", "BTC/USDT": "PROCESSED", "BTC/USD_LEVERAGE": "PROCESSED"}}}
```

Depth event, ETH/USDT, trimmed to three of 20 levels a side:

```json
{"status": "OK", "destination": "marketdepth.event", "payload": {"data": {"ts": 1791605700676, "bid": {"2494.43": 1000.0, "2486.93": 2000.0, "2479.43": 4000.0}, "ofr": {"2494.46": 1000.0, "2501.96": 2000.0, "2509.46": 4000.0}}, "symbol": "ETH/USDT"}}
```

Best bid and ask on a Leverage symbol, a single dealer quote:

```json
{"status": "OK", "destination": "internal.quote", "payload": {"symbolName": "BTC/USD_LEVERAGE", "bid": 82611.15, "bidQty": 5.0, "ofr": 82611.25, "ofrQty": 5.0, "timestamp": 1791605833047}}
```

Keepalive answer:

```json
{"status": "OK", "destination": "ping", "correlationId": "5", "payload": {}}
```

Subscription limit, trimmed:

```json
{"status": "OK", "destination": "depthMarketData.subscribe", "correlationId": "1", "payload": {"subscriptions": {"UNI/USD": "ERROR: Max Subscription limit reached.", "SAND/USDT": "PROCESSED"}}}
```

## 7. Private channels

Account, order and position calls run over the same socket as the REST paths with a signed payload, such as `/api/v2/account`, `/api/v2/order/create` and `/api/v2/tradingPositions`, S3.
Signing is HMAC SHA256 over the payload keys sorted alphabetically, S2.

## 8. Recommended feed shape

No feed is recommended now, because the engine has no spot leg and Dzengi has no perpetual.
A future spot feed would look like this.

| item | value |
|---|---|
| URL plan | `wss://api-adapter.dzengi.com/connect`, one socket per 40 symbols |
| subscribe | `{"destination": "depthMarketData.subscribe", "correlationId": n, "payload": {"symbols": [...]}}`, then check every value in `subscriptions` |
| seed | `GET /api/v2/depth?symbol=...` per symbol after the ack, because no snapshot is pushed |
| handling | replace the whole book on each `marketdepth.event`, after sorting the price keys |
| keepalive | `ping` every 15 s |
| `maxSilenceMs` | per socket, not per symbol, and at least 30,000, since one ETH/USDT book was silent for 20.7 s |
| resync | none needed, every frame is a full window. On reconnect, resubscribe and reseed. |

The Leverage mode cannot use this channel, since its depth subscription sends nothing.
Its quotes would come from `marketData.subscribe`, one level with the dealer's fixed size.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | <https://dzengi.com/api>, retrieved 2026-10-09 | API landing page |
| S2 | <https://dzengi.com/general-websocket-api-information>, retrieved 2026-10-09 | URLs, 30 s ping rule, request model, signing |
| S3 | <https://apitradedoc.dzengi.com/v2/api-docs?group=public-api>, retrieved 2026-10-09 | destinations, ack and event shapes |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/dzengi/ws-probe.py) | every probed value |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/dzengi/rest-probe.py) | catalog, REST book, clock offset |
