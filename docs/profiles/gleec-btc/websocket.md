# Gleec BTC WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-24, for the venue survey of 2026-09-22.

**Probed:** 2026-09-24 between 06:46 and 06:49 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket of Gleec BTC, which is the HitBTC API v3 socket on the host `api.exchange.gleec.com`, for its one perpetual family, USDT-margined perpetuals.
Every probed value below comes from [`ws-probe.mjs`](../../../scripts/probes/venues/gleec-btc/ws-probe.mjs), and the documented value is from the API documentation S1.
The probe held sockets for about 2.3 minutes of wall time, about 4.5 socket minutes summed over five sockets.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| public market data, spot and perpetuals on one socket | `wss://api.exchange.gleec.com/api/3/ws/public`, S1 | opened in 578 to 1,131 ms over five sockets, no refusal from the Canadian VPN exit |
| trading, private | `wss://api.exchange.gleec.com/api/3/ws/trading`, S1 | not opened |
| wallet, private | `wss://api.exchange.gleec.com/api/3/ws/wallet`, S1 | not opened |

One socket carries every symbol, spot and perpetual, because the symbol id itself says which product it is (`BTCUSDT` against `BTCUSDT_PERP`).
The host sits behind Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | depth and speed | probed on 2026-09-24 |
|---|---|---|
| `orderbook/full` | every level, snapshot then updates sent "immediately", S1 | snapshot then deltas on 30 of 30 working perpetuals, recommended |
| `orderbook/{depth}/{speed}` | `D5`, `D10`, `D20`, at `100ms`, `500ms` or `1000ms`, S1 | `D20/100ms` sends a whole 20 by 20 book in every `data` frame. `D30` is refused with code 2003 |
| `orderbook/{depth}/{speed}/batch` | several symbols per frame, S1 | not probed |
| `orderbook/top/{speed}` | best bid and ask, S1 | `top/100ms` sent 28 frames in 60 s on `BTCUSDT_PERP`, fields `t`, `a`, `A`, `b`, `B` |
| `futures/info` | mark, index, premium, funding, next funding, per perpetual, S1 | 636 `data` frames in 60 s for 31 contracts including the expired one |
| `trades`, `ticker/{speed}`, `ticker/price/{speed}`, `candles/{period}`, `price/rate/{speed}` | S1 | not probed |

`futures/info` carries the whole anchor row, see section 8 and [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of `docs/research/2026-07-30-venue-ws-protocol-differences.md`.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for all products, S1 | spot and perpetual ids share the socket, section 1 |
| subscribe frame shape | `{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["ETHBTC"]}, "id": 123}`, S1 | 30 symbols in one frame got one reply listing all 30 |
| unknown symbol expectation | not documented | `NOPE_PERP` on `orderbook/full` answers `{"result":{"ch":"orderbook/full","subscriptions":[]},"id":5}` and nothing else. The expired `TONUSDT_PERP` is accepted and sends one empty snapshot with `s` 1 |
| chunk unit and budget | 10 socket messages per second with a burst of 10 on `/ws/public`, per IP, S1 | 30 symbols in one frame, and 9 frames within about 1.5 s on one socket, no refusal |
| keepalive mechanism | "the system sends ping messages to the client each 30 seconds", S1 | protocol pings at 30.6 to 32.4 s and 60.7 to 61.3 s after open on four sockets |
| connection lifetime and maintenance notice | Not publicly specified | no close by the server within 71 s |
| handshake and operation rate limits | at most 100 connections per IP, S1 | five opens over the runs, none refused |
| public market data authentication | none | none |
| message parse and routing | `ch` plus one of `snapshot`, `update` or `data`, keyed by symbol, S1 | as documented. How many symbols one `orderbook/full` frame can hold was not counted |
| subscribe acknowledgement shape | `{"result": {"ch", "subscriptions"}, "id"}`, S1 | as documented. The reply to 30 symbols listed them in a different order |
| symbol identifier format | `BTCUSDT_PERP` | identical to CCXT `market.id` through the `hitbtc` override, and to the keys of REST `futures/info` |
| number representation | prices and sizes as strings | strings on `orderbook/full`, `D20` and `top`, `t` and `s` as JSON integers |
| timestamp representation | `t` in ms | `t` integer ms |
| size unit | quantity in the base currency | base coins, and CCXT `contractSize` is 1, section 4 |
| sequence semantics | `s`, "Sequence number", S1, no gap rule written | `s` stepped by exactly 1 on 4,981 of 4,981 updates over 30 perpetuals in 60.4 s, and the first update followed the snapshot's `s` by 1 |
| idle repeat behaviour | not documented | no update without a change except 3 empty ones on `ETHUSDT_PERP`. The quietest perpetual went 5.8 s between frames |

## 4. The book channel in detail

`orderbook/full` is the channel this profile recommends.

### Snapshot on subscribe

The first frame for each symbol is `snapshot` with every level of both sides and the symbol's `s`.
All 30 working perpetuals got exactly one snapshot, 270 to 532 ms after the subscribe frame on the four watched symbols, and none got a second one in 60 s.
S1 says the snapshot "comes right after the response".

### Delta semantics

An `update` carries `t`, `s`, and `a` and `b` arrays of `[price, size]` strings.
A size of `"0"` deletes the level.
No zero size appeared inside any snapshot, although the documented example shows some.

### Sequence and gap rule

```text
snapshot                 replace the book, last = s
update, s = last + 1     apply, last = s
update, s != last + 1    gap: terminate and resubscribe
```

The rule held on every update of the run, with 0 gaps.
S1 does not state the rule, so it is taken from the wire.
The `s` values are per symbol, since each symbol started from its own value between about 1.08 M and 1.65 M.

### Checksum

None documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | descending on 30 of 30 | ascending on 30 of 30 |
| update | descending in every one of 4,981 | ascending in every one |
| REST `orderbook` | descending | ascending |

A feed still applies updates by price.

### Level window

`orderbook/full` has no window.
The book held up to 360 bid levels on `BTCUSDT_PERP` and as few as 8 on `TRUMPUSDT_PERP`.
The engine keeps 20 levels per side, so the feed trims on publish.

### Size unit against CCXT `contractSize`

Sizes are base coins.
`BTCUSDT_PERP` showed `"0.0112"` at the best bid, and the REST ticker's `volume` `"54.0518"` against `volume_quote` `"4581119.855147"` gives a price near 84,757, so `volume` is in BTC.
Open interest is also given in coins, `"12.2389"` on `BTCUSDT_PERP`.
CCXT `hitbtc` sets `contractSize` to 1 for every contract at `server/node_modules/ccxt/js/src/hitbtc.js` line 840, so the engine's size multiplier is right.
At mid run, 20 of 20 top REST bids on `BTCUSDT_PERP` matched the socket book in price and size.

### One-sided and empty books

The expired `TONUSDT_PERP` answers with `{"ch":"orderbook/full","snapshot":{"TONUSDT_PERP":{"t":1790232402998,"s":1,"a":[],"b":[]}}}`.
No working perpetual had an empty side.
`TRUMPUSDT_PERP` held 8 bids and 7 asks.

### Idle repeats

None.
`TRUMPUSDT_PERP` still sent 119 updates in 60 s, and every book updated at least every 5.8 s.

### Unknown, closed and wrong-channel requests

| request | reply |
|---|---|
| `orderbook/full` `NOPE_PERP` | `{"result":{"ch":"orderbook/full","subscriptions":[]},"id":5}`, nothing more |
| `orderbook/full` `TONUSDT_PERP`, expired | accepted, one empty snapshot |
| `orderbook/D30/100ms` | `{"error":{"code":2003,"message":"Unknown channel","description":"Channel is not supported: orderbook/D30/100ms"},"id":6}` |
| `nope/channel` | code 2003, "Channel is not supported: nope/channel" |
| text that is not JSON | `{"error":{"code":1,"message":"Invalid json","description":"JSON request is corrupted."}}`, the socket stays open |

A feed checks the `subscriptions` list of the reply against what it asked for, because an unknown id is dropped silently.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server protocol ping every 30 s, S1 | pings at about 30.6 and 60.7 s, answered automatically by `ws` |
| silence the server tolerates | Not publicly specified | a socket that subscribed nothing and sent no application frame stayed open 71 s, as did one with a quiet book |
| forced disconnect | Not publicly specified | none in 71 s |
| maintenance notice | Not publicly specified | none |
| compression | not documented | a client that offered permessage-deflate got no extension back |
| handshake | 100 connections per IP, S1 | 578 to 1,131 ms to open |
| subscription limits | 10 messages per second on `/ws/public`, S1 | not reached |
| throughput | | 30 perpetuals on `orderbook/full`: 83 frames per second, 19,743 bytes per second, 9.6 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the run at 06:46 UTC on 2026-09-24.

Subscribe reply, cut after three ids.

```json
{"result": {"ch": "orderbook/full", "subscriptions": ["NEARUSDT_PERP", "FLOWUSDT_PERP", "ZECUSDT_PERP"]}, "id": 1}
```

Snapshot of `BTCUSDT_PERP`, three levels of 357 bids and 184 asks.

```json
{"ch": "orderbook/full", "snapshot": {"BTCUSDT_PERP": {"t": 1790232410487, "s": 1649928, "b": [["84093.85", "0.0112"], ["84091.75", "0.0201"], ["84085.69", "0.0818"]], "a": [["84120.14", "0.0119"], ["84123.65", "0.0208"], ["84124.34", "0.0600"]]}}}
```

The next update, `s` one higher.

```json
{"ch": "orderbook/full", "update": {"BTCUSDT_PERP": {"t": 1790232410888, "s": 1649929, "b": [["84093.85", "0"], ["84084.54", "0.0112"], ["84071.82", "0"]], "a": []}}}
```

`futures/info`.

```json
{"ch": "futures/info", "data": {"MANAUSDT_PERP": {"c": "perpetual", "t": 1790232409633, "m": "0.0840", "i": "0.0840", "p": "0", "P": "-0.000017201628348222", "o": "10745", "r": "0.0001", "R": "-0.000271451583367902", "T": 1790236800000, "I": "0.0001"}}}
```

Error.

```json
{"error": {"code": 2003, "message": "Unknown channel", "description": "Channel is not supported: orderbook/D30/100ms"}, "id": 6}
```

The keepalive is a protocol ping frame, so there is no text frame to show.

## 7. Private channels

`wss://api.exchange.gleec.com/api/3/ws/trading` for orders and `wss://api.exchange.gleec.com/api/3/ws/wallet` for balances, both after a `login` with Basic or HS256, S1.
Neither was opened.

## 8. Recommended feed shape

- URL: `wss://api.exchange.gleec.com/api/3/ws/public`, perMessageDeflate off.
- Markets per connection: all 30 working perpetuals fit one socket at 83 frames per second.
- Subscribe: one frame, `{"method":"subscribe","ch":"orderbook/full","params":{"symbols":[…]},"id":1}`, then check the reply's `subscriptions` list.
- Keepalive: answer the server's protocol ping, which `ws` does by itself.
  No application ping is needed.
- `maxSilenceMs`: 15,000, since the quietest book went 5.8 s between frames and the server pings every 30 s.
- Resync: on `s` not equal to last plus 1, terminate and resubscribe, since each subscribe starts with a snapshot.
- Skip any symbol whose catalog `status` is not `working`, because CCXT marks `TONUSDT_PERP` active.

## 9. Source ledger

| id | source | read |
|---|---|---|
| S1 | API documentation, `https://api.exchange.gleec.com/`, sections "Socket API Reference", "Subscriptions", "Order Books" and "Futures Info" | 2026-09-24, curl, HTTP 200 |
| S2 | [`ws-probe.mjs`](../../../scripts/probes/venues/gleec-btc/ws-probe.mjs) modes `book`, `silence` and `deflate` | 2026-09-24 |
| S3 | `server/node_modules/ccxt/js/src/hitbtc.js` line 840 and `server/node_modules/ccxt/js/src/pro/hitbtc.js` lines 39 and 62, CCXT 4.5.68 | 2026-09-24 |
