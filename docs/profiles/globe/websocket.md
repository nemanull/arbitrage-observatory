# Globe WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:20 to 04:37 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that exits in Canada.

This profile covers the public WebSocket of Globe for its one perpetual family, the linear USD perpetuals, with the book channel in detail.
Globe has no CCXT class, so no CCXT Pro source exists to compare against, see [`fees.md`](./fees.md) section 8.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/globe/ws-probe.mjs) in two passes, and both readings are written where they differ.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Every access result was seen from the Canadian VPN exit, and nothing was refused.

## 1. Endpoints

| socket | URL | probed |
|---|---|---|
| public API, documented | `wss://globe.exchange/api/v1/ws`, S1 | open in 433 to 749 ms over 12 opens, no refusal, Cloudflare ray suffix `YVR` |
| web app, undocumented | `wss://globe.exchange/app/ws`, from the trade app bundle `/trade/app.23b8619f16f38be5f4e1.js` | open in 508 and 452 ms, `depth` on `BTC-PERP` gave 100 frames in 10 s with 25 levels per side, the same cadence as the API socket |
| legacy host | `wss://globedx.com/api/v1/ws`, in the client library, S3 | not probed, `https://globedx.com/` answers 301 to `https://globe.exchange/` |

One socket carries every product.
The perpetuals and the spot pair `BTC/USDT` delivered books on the same API socket.
The API socket is the one this profile recommends, since it is the documented one and the app socket showed no advantage.

## 2. Channel matrix for public market data

| channel | subscribe frame | documented | probed on 2026-09-23 |
|---|---|---|---|
| `depth` | `{"command": "subscribe", "channel": "depth", "instrument": "BTC-PERP"}` | "The top 25 bid and ask levels of the order book for the given instrument. Updates are sent at a fixed frequency of twice a second and not necessarily for every change.", S1 | a whole 25 level book every 100 ms, 600 to 604 frames per instrument in 60 s, recommended |
| `depth` with `grouping` | adds `"grouping": 10` | groups levels by a multiple of the tick, "Valid options are 1, 2, 5, 10, 50, 100, 500, 1000.", S1 | `ETH-PERP` with grouping 10 pushed every 1,000 ms, 60 frames in 60 s |
| `index-price` | `{"command": "subscribe", "channel": "index-price", "instrument": "BTC-PERP"}` | "The latest value of the index price", S1 | a push every 500 ms, 120 and 121 pushes in 60 s, and the value changed 58 and 53 times |
| `market-overview` | same shape | "Each response message will contain at least one field. Be aware that not all fields may be included in a given message.", S1 | one full object, then each field in a frame of its own every 500 ms: `mark_price`, `index_price`, `funding_rate`, `mid_market_price`, `last_trade_price`, `volume` with `volume_usd`, `price_change_percent`, `ohlc` |
| `product-list` | `{"command": "subscribe", "channel": "product-list"}` | all products | 33 products, 30 `Perp` and 3 `Spot` |
| `product-detail` | per instrument | contract size, funding period, next funding time, fees, tick, status | delivered for 30 of 30 perpetuals in both passes, 101 to 156 ms after the subscribe in the second |
| `open-interest` | per instrument | `num_contracts` and `qty` | delivered |
| `trades`, `price-history`, `insurance-fund` | | trades at "twice a second" with a 100 trade snapshot first, S1 | not probed |

The channel names, frames and fields are from S1, and the client library spells the same names, S3.
No best bid and offer channel exists, and no dedicated mark or funding channel exists.
The `market-overview` channel carries mark, index and funding rate for one instrument, see [`rest.md`](./rest.md) section 4 for how often each changed.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | perpetuals and spot on one socket, section 1 |
| subscribe frame shape | `{"command": "subscribe", "channel": <name>, "instrument": <symbol>}`, one instrument per frame, S1 | as documented. A list form is not documented and was not tried |
| unknown symbol expectation | `{ "error": "invalid-instrument", "detail": "LTCXBT" }`, S1 | `{"error":"invalid-instrument","details":"NOPE-PERP"}`, spelled `details`, with no `subscription` echo, and nothing more for that stream |
| chunk unit and budget | "You may simultaneously subscribe to any number of channels", and 50 messages per second, S1 | 28 `depth` subscriptions spaced 25 ms on one socket all delivered, and 42 streams of six channels on one socket all delivered |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping every 4.0 s from the open. A client that does not answer is closed 4.0 s after the first ping with code 1008 and reason `Did not receive PONG in time`, in both passes. No application ping exists |
| connection lifetime and maintenance notice | Not publicly specified. The error `exchange-busy` is documented | no forced close and no notice in 90 s |
| handshake and operation rate limits | "Websocket 50 messages per second", and "If you persistently exceed these limits we may block your IP address", S1 | no refusal at up to 40 frames per second. The limit was not tested |
| public market data authentication | none, "Public channels do not require authentication.", S1 | none |
| message parse and routing | `{"subscription": {...}, "data": {...}}`, S1 | route on `subscription.channel` and `subscription.instrument`, plus `subscription.grouping` when set. Errors carry no `subscription` |
| subscribe acknowledgement shape | none documented | none sent. The first data frame is the confirmation: `depth` 137 to 232 ms after the subscribe in the first pass and 121 to 196 ms in the second |
| symbol identifier format | `BTC-PERP` for perpetuals, `BTC/USDT` for spot, S1 | identical to the REST `instrument` on 30 of 30 perpetuals |
| number representation | JSON numbers | JSON numbers for `price`, `volume` and `volume_quote`, including exponent form such as `4.92107e-6` for `PEPE-PERP` |
| timestamp representation | not documented for `depth` | `data.timestamp` in integer ms on every `depth` frame, on a 100 ms tick shared by every perpetual |
| size unit | "The volume field specifies market size.", S1 | base currency, not contracts, and `volume_quote` is `price × volume`, section 4 |
| sequence semantics | none documented | none. Every frame is a whole book |
| idle repeat behaviour | "not necessarily for every change" | a frame every 100 ms whether or not the book changed, and an empty book every 100 ms for a suspended contract |

## 4. The book channel in detail

`depth` without `grouping` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

Every frame is a snapshot.
The first frame arrives 121 to 232 ms after the subscribe frame, and each later frame replaces the whole book.
There is no delta, no update id and no checksum, so a feed resets the book on every frame.

### Cadence

The documentation says twice a second, and the wire sends ten times a second.

| run | instruments | frames per instrument in the window | gap between frames, median | gap, max |
|---|---|---|---|---|
| book, first pass, 60 s | 5 perpetuals | 600 or 601 | 100 ms | 121 ms |
| book, second pass, 60 s | 5 perpetuals | 603 or 604 | 100 ms | 124 ms |
| batch, first pass, 45 s | 28 perpetuals | 450 to 457 | 100 ms | 192 ms |
| batch, second pass, 45 s | 28 perpetuals | 450 to 457 | 100 ms | 190 ms |

`data.timestamp` stepped by 98 to 102 ms, and its remainder modulo 100 was the same for every perpetual on the socket, 88 on 534 or 535 of about 600 frames in the first pass.
So Globe publishes every perpetual book on one shared 100 ms tick.
The spot book ran on a tick of its own, with a remainder of 23 or 24.

### Sequence and gap rule

```text
every frame   replace the whole book with data.bids and data.asks
```

There is nothing to chain, so there is no gap to detect.
A lost frame is superseded by the next one 100 ms later.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| `depth` frames | best first, descending, on every frame of both passes, 0 exceptions in about 32,000 frames | best first, ascending, 0 exceptions |
| REST `/ticker/orderbook` | descending, then padded with `[0, 0]` entries to 25, see [`rest.md`](./rest.md) section 5 | ascending, padded the same way |

### Level window

A side holds at most 25 levels.
Over the batch runs, bid sides held 21 to 25 levels and ask sides 21 to 25, so a side is often short of 25, and it is never padded on the socket.
25 levels covers the engine's 20.

### Size unit against the contract size

| instrument | `product-detail` `contract_size` | socket `volume` at the touch | `volume_quote` | reading |
|---|---:|---|---|---|
| `BTC-PERP` | 0.0001 | `0.0004` | `34.73` at price 86825 | 0.0004 BTC, which is 4 contracts |
| `XLM-PERP` | 10 | `30.0` | `6.69369` at price 0.223123 | 30 XLM, which is 3 contracts |
| `PEPE-PERP` | 1000000 | `15000000.0` | `73.81605` at price 4.92107e-6 | 15,000,000 PEPE, which is 15 contracts |

The unit is the base currency, and every size seen was a whole multiple of `contract_size`.
`volume_quote` equals `price × volume` on every row above, so the quote size needs no contract multiplier either.
The top five levels of the socket book equalled the REST book level for level on both sides of `BTC-PERP` in both passes, compared with the last socket frame when the REST reply arrived.
So the engine's `contractSize` for Globe must be 1, whatever the catalog says, see [`rest.md`](./rest.md) section 2.

### Depth at the touch

The best level is dust on every perpetual.
Over the second batch run, the median notional of the smaller of the two best levels was 2 to 16 USD per instrument, 9 USD on `BTC-PERP` and 3 USD on `ETH-PERP`.
The median notional of the top five levels on the thinner side was 466 USD on `WLD-PERP` up to 39,402 USD on `BTC-PERP`.
In four `BTC-PERP` books read on 2026-09-23, two from the socket and two from REST, the best level held 0.0001 to 0.0115 BTC.
The third level held 0.097 to 0.112 BTC and sat 134 to 211 USD from the best price.

### One-sided and empty books

A suspended contract is served with both sides empty.
`IOTA-PERP`, `product_status` `Suspended`, sent `{"bids":[],"asks":[]}` every 100 ms, 600 and 603 frames in 60 s.
No active perpetual sent an empty or one-sided frame in either pass, and no frame was crossed.
The engine's `resetBook` accepts an empty side.

### Idle repeats

The socket repeats an unchanged book on every tick.
In the second book pass, 347 of 604 `BTC-PERP` frames, 335 of 604 `ETH-PERP`, 417 of 604 `XLM-PERP` and 376 of 603 `PEPE-PERP` held the same levels as the frame before, with only `timestamp` new.
In the first pass the counts were 331, 336, 405 and 383 of about 600.
A repeat still says the book was current at that tick.

### Unknown, closed and wrong requests

| request | reply | then |
|---|---|---|
| `depth` `NOPE-PERP` | `{"error":"invalid-instrument","details":"NOPE-PERP"}` | nothing |
| `depth` `IOTA-PERP`, suspended | no error | empty books every 100 ms |
| `depth` `BTC/USDT`, spot | no error | a 25 level spot book every 100 ms |
| `depth` `BTC-PERP` a second time | nothing | still one stream, 601 and 604 frames in 60 s, not doubled |
| `depth` with `grouping` 3 | `{"error":"invalid-request"}` | |
| `depth` with no `instrument` | `{"error":"invalid-request"}` | |
| unknown channel `nope` | `{"error":"invalid-request"}` | |
| unknown command `nope` | `{"error":"invalid-request"}` | |
| text that is not JSON | `{"error":"invalid-syntax"}`, where the documentation names `invalid-json` | the socket stays open |

A closed or delisted contract was not available to probe, since the catalog lists only `Active` and `Suspended` ones.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | a protocol ping every 4.0 s, 23 pings in 90 s on an idle socket in each pass. The `ws` library answers them by default, as it does on the engine's sockets |
| silence the server tolerates | Not publicly specified | a socket that subscribed nothing and sent no frame, but answered pings, stayed open for the full 90 s in both passes. A socket that does not answer pings closes 4.0 s after the first ping with 1008 |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, in both passes, so the server does not negotiate it. Frames are text JSON |
| handshake | | 433 to 749 ms to open over 12 opens of the API socket |
| subscription limits | "any number of channels", 50 messages per second | no cap reached with 42 streams on one socket |
| throughput | | 28 active perpetuals on one socket: 280 frames per second in both passes, 2,860 and 2,861 bytes per frame, 807 and 808 KB per second, and `JSON.parse` took 26.6 and 31.2 µs per frame |
| delay | | arrival minus `data.timestamp`: median 53 to 57 ms and max 75 to 93 ms per ungrouped book. The client ping round trip was 102 to 109 ms in the second pass, and the host clock was NTP synchronised with an offset of 1.08 ms. If the path is symmetric, about 51 ms of the delay is the path, and the stamp is taken a few ms before the send |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Level arrays keep their first three entries.

Subscribe.

```json
{"command": "subscribe", "channel": "depth", "instrument": "BTC-PERP"}
```

Depth, `BTC-PERP`, first pass at 04:20:02 UTC.
The best level on each side is one to four contracts of 0.0001 BTC.

```json
{"subscription":{"channel":"depth","instrument":"BTC-PERP"},"data":{"timestamp":1790137202188,"bids":[{"price":86825.0,"volume":0.0004,"volume_quote":34.73},{"price":86792.0,"volume":0.0001,"volume_quote":8.679},{"price":86614.0,"volume":0.1079,"volume_quote":9345.65}],"asks":[{"price":86828.0,"volume":0.0001,"volume_quote":8.682},{"price":86861.0,"volume":0.0625,"volume_quote":5428.812},{"price":86962.0,"volume":0.0973,"volume_quote":8461.402}]}}
```

Depth of the suspended `IOTA-PERP`.

```json
{"subscription":{"channel":"depth","instrument":"IOTA-PERP"},"data":{"timestamp":1790137202288,"bids":[],"asks":[]}}
```

Index price.

```json
{"subscription":{"channel":"index-price","instrument":"BTC-PERP"},"data":{"price":86844.975}}
```

Market overview, the first frame and then single field frames.

```json
{"subscription":{"channel":"market-overview","instrument":"BTC-PERP"},"data":{"volume":80.6399,"volume_usd":6959380.5579,"price_change_percent":1.5175961650882732,"mid_market_price":86826.5,"last_trade_price":86828,"funding_rate":-0.006666666666666667,"mark_price":86789.331,"index_price":86844.975,"ohlc":{"open":85519,"high":86906,"low":85123,"close":86828}}}
```

```json
{"subscription":{"channel":"market-overview","instrument":"BTC-PERP"},"data":{"mark_price":86789.331}}
```

Product detail.
`taker_fee` is a fraction, and `funding_period` is in seconds.

```json
{"subscription":{"channel":"product-detail","instrument":"BTC-PERP"},"data":{"category":"Perp","funding_period":28800,"next_funding_time":1790164800000,"max_leverage":100,"maker_fee":0,"taker_fee":0.0005,"contract_size":0.0001,"contract_type":"Linear","base_symbol":"BTC","quote_symbol":"USD","tick_size":1,"price_precision":0,"qty_precision":4,"min_qty":0.0001,"qty_increment":0.0001,"status":"Active","position_cap":10000000,"order_max_cost":1000000}}
```

Open interest.

```json
{"subscription":{"channel":"open-interest","instrument":"BTC-PERP"},"data":{"num_contracts":4690638,"qty":469.0638}}
```

Errors.

```json
{"error":"invalid-instrument","details":"NOPE-PERP"}
```

```json
{"error":"invalid-request"}
```

```json
{"error":"invalid-syntax"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL, and the connection is authenticated by headers on the upgrade request: `X-Access-Key`, `X-Access-Passphrase`, `X-Access-Nonce` and `X-Access-Signature`, an HMAC SHA-256 of the nonce, the verb and the path, S1 and S3.

- Channels: `my-market-events`, `my-orders`, `my-positions`, `my-account-overview`, `my-balances`, `my-margin-account-overview`.
- Commands: `place-order`, `cancel-order`, `cancel-stop-order`, `cancel-take-profit-order`, `cancel-all-orders`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one endpoint, `wss://globe.exchange/api/v1/ws`, for the 28 active perpetuals | one socket carries every product |
| channel | `depth`, no `grouping` | a whole book of up to 25 levels every 100 ms |
| markets per connection | all 28 | 280 frames per second and about 808 KB per second on one socket, with 0 missing streams |
| subscribe frames | one frame per market, `{"command": "subscribe", "channel": "depth", "instrument": "<rawMarketId>"}`, at least 25 ms apart | one instrument per frame, and 50 messages per second is the published limit |
| keepalive | nothing from the client, and keep the `ws` default that answers protocol pings | the server pings every 4 s and closes a socket that does not pong. There is no application ping |
| `maxSilenceMs` | 5,000 | every subscribed market sends a frame every 100 ms, the longest gap seen was 192 ms, and the server itself gives up on a peer after 4 s |
| routing | `subscription.instrument` is the `rawMarketId` | the instrument string is identical on REST and on the socket |
| every frame | `resetBook(instrument, bids, asks)` with `[price, volume]` pairs, then `publish` | each frame is the whole book, and a repeat still confirms the book at that tick |
| resync | none on sequence, since there is none. Log an `invalid-instrument` error by its `details` | nothing chains, and an unknown instrument answers with an error that names it |
| suspended markets | leave out of the catalog, see [`rest.md`](./rest.md) section 8 | a suspended contract streams empty books |
| receive time | stamp on arrival, and never from `data.timestamp` | the stamp is the server tick, 53 to 57 ms before arrival here |
| sizes | `volume` as is, with `contractSize` 1 | sizes are in the base currency |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Globe API documentation, sections "WebSocket API", "WebSocket Public Channels", "Rate Limits", "Errors" and "Authentication" | https://globe.exchange/developers | 2026-09-23 | Globe, global | URL, channels, frames, limits, error names, authentication headers, sections 1 to 7 |
| S2 | Globe help article "Websocket API", which points to S1 | https://globe.exchange/support/websocket-api | 2026-09-23 | Globe, global | section 1 |
| S3 | Globe API client library, `python_client/src/globe.py` lines 22 and 63 to 176 | https://github.com/globedx/globe-api-clients | 2026-09-23 | Globe, last pushed 2021-06-15 | legacy URL, channel names, authentication headers, sections 1, 2, 7 |
| P1 | `ws-probe.mjs book`, `batch`, `silence`, `deflate` and `app`, first pass at 04:20 to 04:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/globe/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs book`, `batch`, `silence`, `deflate` and `app`, second pass at 04:33 to 04:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/globe/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1 to 6, the second readings |
