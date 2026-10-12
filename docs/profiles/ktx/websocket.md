# KTX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 02:44 to 03:11 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers KTX's public market data socket for its one perpetual family, USDT-M linear perpetuals, market `lpc`.
Every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/ktx/ws-probe.py) unless a source row is named.
The cited numbers are from its last full run, 02:58 to 03:02 UTC, and from its `plain` mode at 03:03 UTC.
Sockets were held for about ten and a half minutes in total across three full runs, two short trials while the probe was written, and the `plain` check.

## 1. Endpoints

| URL | carries | evidence |
|---|---|---|
| `wss://m-stream.ktx.com` | public market data for every market, spot, `lpc` perpetuals and the prediction market, on one socket | S1, Probed |
| `wss://u-stream.ktx.com` | private user data after a `LOGIN` frame | S1, not probed |

One socket carried `lpc.BTC_USDT_SWAP`, `lpc.ETH_USDT_SWAP` and `spot.BTC_USDT` books together.
The host resolves to the same Cloudflare addresses as `api.ktx.com`, and the handshake answered with `server: cloudflare` and a `CF-RAY` ending in `YVR`, the Vancouver edge.

## 2. Channel matrix for public market data

Stream names follow `<market>.<symbol>.<data_type>.<params>`, S1.

| channel | stream name | depths | probed |
|---|---|---|---|
| order book | `lpc.BTC_USDT_SWAP.order_book.20` | documented 5, 10, 20, 50, 100, 200, 500, 1000 | snapshot then deltas at about 8 frames per second on BTC and ETH, section 4 |
| trades | `lpc.BTC_USDT_SWAP.trades` | | first frame is a batch `{"e":[...]}` of past trades, each `i`, `t`, `s`, `p`, `q` |
| candles | `lpc.BTC_USDT_SWAP.candles.1m` | 1m to 1M | documented, not probed |
| ticker | `lpc.BTC_USDT_SWAP.ticker` | | last, 24 h open, high, low, volume, best bid and ask with sizes. No mark, index or funding. |
| best bid and ask | none separate. The ticker carries `bidPrice`, `bidQty`, `askPrice` and `askQty`. | | |
| mark, index, funding | none documented | | the guessed `mark_price`, `funding_rate` and `index_price` streams were acknowledged and then stayed silent for 3 s |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all market data, S1 | one URL for spot and perpetuals, section 1 |
| subscribe frame shape | `{"id":123,"method":"SUBSCRIBE","params":["spot.BTC_USDT.order_book.5"]}`, S1 | as documented. A frame with 100 streams was acknowledged, while 101, 105 and 110 streams got no acknowledgement and no data. |
| unknown symbol expectation | an error `{"id":123,"error":-1003,"message":"..."}`, S1 | `lpc.NOPE_USDT_SWAP.order_book.20`, a lower-case symbol and an unknown market were all acknowledged with `"result":"success"` and then sent nothing |
| chunk unit and budget | Not publicly specified | 234 depth-5 streams in five frames of at most 50 on one socket all delivered, 942 frames per second and about 257 KiB per second decompressed, with no close |
| keepalive mechanism | `{"ping": <ms>}` answered with `{"pong": <ms>}`, every 5 to 10 s, S1 | as documented, the pong echoing the value in 10 to 37 ms |
| connection lifetime and maintenance notice | the server disconnects after 30 s without a client heartbeat, S1 | a socket that never pinged was still open at 60.1 s, and it received no protocol ping frames |
| handshake and operation rate limits | Not publicly specified | opens took 109 ms in the cited run, and up to two sockets were open at once without a refusal |
| public market data authentication | none, S1 | none |
| message parse and routing | `{"stream": "...", "data": ...}`, S1 | the same. Route on `stream`, which echoes the subscribed name exactly. |
| subscribe acknowledgement shape | `{"result":"success","op":"SUBSCRIBE","id":123,"events":[...]}`, S1 | as documented, one acknowledgement per frame listing every stream |
| symbol identifier format | `BTC_USDT_SWAP` | identical to the catalog's `symbol`, the REST book's `symbol` and the anchor's `ticker_id` |
| number representation | strings for price and size, S1 | strings for price and size. `i` is a string on live books and a JSON integer on the stale book of an inactive contract. `t` is a string. |
| timestamp representation | `t` "update time" in ms, S1 | `t` in ms on every book frame |
| size unit | "Order quantity", S1 | base coin units, see section 4 |
| sequence semantics | `i` "Update ID", S1 | per symbol, strictly increasing, never contiguous. BTC steps were 8 to 65, so no gap can be detected. |
| idle repeat behaviour | not documented | no repeats were seen. All 234 active books sent deltas within 20 s, and none sent only its snapshot. |

## 4. The book channel in detail

### Snapshot on subscribe

The first frame of every book stream is a full book of the subscribed depth, and only that frame carries `"s":1`.
In the cited run the BTC, ETH and spot BTC streams each opened with 20 bids and 20 asks and `s` 1, and none of the later 947 frames carried `s`.
The documentation says only that "the client will first receive a complete depth of data flow, and then receive an incremental change data flow", S1.

### Delta semantics

Each later frame lists changed levels as `[price, size]`, and a size of `"0"` removes the level.
A delta may have an empty side, which happened on 167 of 349 BTC frames.
Applying the deltas to the snapshot reproduced the REST book exactly: on four REST reads whose `i` matched a socket `i`, the top five levels on both sides were identical.

### Sequence and gap rule

`i` belongs to one symbol.
BTC and ETH perpetual streams and the spot BTC stream shared no `i` value, and their ranges sit far apart, about 4.01 billion, 4.86 billion and 3.28 billion.
Within a stream `i` never repeated and never went down, but it was never contiguous.
BTC steps ran from 8 to 65 and ETH steps from 8 to 81, so the venue numbers its own internal events and publishes a sample of them.
There is no previous-id field, so a missed frame cannot be detected from `i`.
A feed can only reject an `i` that is not larger than the last one, and resync by resubscribing.

### Checksum

None, S1, and no checksum field on the wire.

### Level order on the wire

Bids descend and asks ascend in every snapshot and every delta, with no unsorted frame in the run.
The documentation states the same order for the REST book, S1.

### Level window

A depth-20 stream does not stay inside 20 levels.
Deltas updated prices beyond the 20th held level 44 times on BTC in 45 s, a single delta carried up to 54 levels on one side, and the merged BTC book held 64 bids and 71 asks at the end.
So the feed keeps every level it is sent and publishes only the best 20.
The crossed check never fired, with the best bid below the best ask after every frame.

### Size unit

The catalog has no contract size or multiplier field.
Sizes match base coin units: BTC sizes such as `0.036871` sit against `minOrderSize` `0.002` and `quantityIncrement` `0.000001`, and the REST book uses the same unit.
So the contract size is 1 on every contract.

### One-sided and empty books

The 29 inactive contracts answer a subscription with one snapshot `{"i":47014372,"t":"1747880257526","b":[],"a":[],"s":1}`, empty on both sides and stamped 2025-05-22, and then nothing.
No active contract opened with an empty side.

### Idle repeats

None seen, since every active book changed within the run.

### Unknown, closed and wrong-level symbols

| subscription | answer |
|---|---|
| `lpc.NOPE_USDT_SWAP.order_book.20` | acknowledged, then silent |
| `lpc.EOS_USDT_SWAP.order_book.20`, inactive | acknowledged, then the empty snapshot above |
| `lpc.BTC_USDT_SWAP.order_book.7`, an undocumented depth | acknowledged, then a 7-level book |
| `lpc.BTC_USDT_SWAP.order_book`, no depth | acknowledged, then a book |
| `lpc.btc_usdt_swap.order_book.5` | acknowledged, then silent |
| `swap.BTC_USDT_SWAP.order_book.5` | acknowledged, then silent |
| the text `not json` | `{"type":"error","msg":"invalid_json"}` |
| method `HELLO` | no answer |

The documented error frame with `error` -1003 was never seen.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | client sends `{"ping": <ms>}` every 5 to 10 s, server echoes `{"pong": <ms>}` | S1, Probed |
| silence tolerated | documented 30 s. A socket that sent no heartbeat was still open at 60.1 s. | S1, Probed |
| server pings | none, no protocol ping frame in 60 s | Probed |
| forced disconnects | none seen | Probed |
| maintenance notices | none documented, none seen | |
| compression | the server accepts `permessage-deflate; client_max_window_bits=15` when the client offers it. A socket that offered no extension got none and received text frames, 76 BTC book frames in 10 s. | Probed, `ws-probe.py plain` |
| subscribe limit | 100 streams per SUBSCRIBE frame. A frame with more is dropped with no acknowledgement and no error. | Probed |
| streams per socket | at least 234, the whole active catalog | Probed |

## 6. Captured frames

Subscribe acknowledgement for three streams:

```json
{"result":"success","op":"SUBSCRIBE","id":1,"events":["lpc.BTC_USDT_SWAP.order_book.20","lpc.ETH_USDT_SWAP.order_book.20","spot.BTC_USDT.order_book.20"]}
```

Snapshot, as the probe printed it cut at 400 characters, so the asks and the trailing `"s":1` are not shown:

```text
{"stream":"lpc.ETH_USDT_SWAP.order_book.20","data":{"i":"4857538555","t":"1791601127314","b":[["2491.99","6.4577"],["2491.97","0.2664"],["2491.95","130.5643"],["2491.94","0.6506"], ...
```

The snapshot flag appears whole in the inactive contract's frame further down.

Delta, complete:

```json
{"stream":"lpc.ETH_USDT_SWAP.order_book.20","data":{"i":"4857538563","t":"1791601127420","b":[["2491.99","6.4643"],["2491.95","130.6973"]],"a":[["2492.09","10.7089"],["2492.13","170.6805"]]}}
```

Keepalive answer:

```json
{"pong":1791601132212}
```

Error for a frame that is not JSON:

```json
{"type":"error","msg":"invalid_json"}
```

Snapshot of an inactive contract:

```json
{"stream":"lpc.EOS_USDT_SWAP.order_book.20","data":{"i":47014372,"t":"1747880257526","b":[],"a":[],"s":1}}
```

## 7. Private channels

`wss://u-stream.ktx.com` takes `{"method":"LOGIN","auth":{"api-key":"...","api-sign":"..."}}`, where the signature is an HMAC-SHA256 of `/user/verify`, and then pushes the streams `account`, `position` and `order`, S1.
They were not probed.

## 8. Recommended feed shape

| item | value |
|---|---|
| URL | `wss://m-stream.ktx.com`, one URL for every contract |
| markets per connection | up to 150, which keeps two connections for the 234 active contracts. One socket carried all 234 at depth 5. |
| subscribe frames | at most 100 streams per frame, for example `{"id":1,"method":"SUBSCRIBE","params":["lpc.BTC_USDT_SWAP.order_book.20", ...]}` |
| depth | `order_book.20`, holding every level sent and publishing the best 20 |
| keepalive | `{"ping": <ms>}` every 10 s |
| `maxSilenceMs` | 30,000. Every active book changed several times a second, and the pong arrives every 10 s anyway. |
| snapshot rule | a frame with `"s":1` resets the book |
| sequence rule | drop a frame whose `i` is not larger than the last applied `i` for that symbol, and log it. A gap cannot be seen, so there is no gap-triggered resync. |
| resync | resubscribe the symbol, or reopen the socket, which brings a fresh `s` 1 snapshot |
| compression | offer none, since the server does not require it |
| skip | contracts with `active` 0 in the catalog |

The book is correct whenever no frame is lost, which the REST comparison in section 4 confirmed four times out of four.
A lost frame would leave a stale level until it is next touched, and there is no way to detect it from the wire.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | KTX API doc (v4), `https://ktx-private.github.io/api-en/`, sections "Market Data Streams", "Subscribe Order Book", "MarketData Heartbeat" and "User Data Streams" | 2026-10-09 |
