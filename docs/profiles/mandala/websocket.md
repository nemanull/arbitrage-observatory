# Mandala Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:46 to 06:55 UTC by the host clock (evening of 2026-09-23 in Seattle), from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market data socket of Mandala Exchange for its one perpetual family, USDT-M, with the book channel in detail.
Every probed value was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/mandala/ws-probe.mjs), and the documented value is from the API v3 reference at `https://api.trade.mandala.exchange/` (S1), which answered this host with HTTP 200.
The protocol is the HitBTC API v3 socket protocol in shape, see [`fees.md`](./fees.md) section 8.
All access results are from the Canadian VPN exit, and no socket was refused.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, and spot | `wss://api.trade.mandala.exchange/api/3/ws/public` (S1) | opened in 931 and 1,125 ms on the two sockets that logged it, all 24 perpetuals deliver |
| trading, private | `wss://api.trade.mandala.exchange/api/3/ws/trading` (S1) | not probed |
| wallet, private | `wss://api.trade.mandala.exchange/api/3/ws/wallet` (S1) | not probed |

One public socket carries spot and perpetual symbols alike, since the channel takes any symbol code from `/api/3/public/symbol`.
Only perpetuals were subscribed.
The host sits behind Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `orderbook/full` | `{"method":"subscribe","ch":"orderbook/full","params":{"symbols":[...]},"id":1}` | whole book, snapshot then updates "sent immediately" (S1) | recommended, snapshot of 17 to 354 levels a side, then `s` steps of exactly 1 |
| `orderbook/{depth}/{speed}` | same shape | depth `D5`, `D10` or `D20`, speed `100ms`, `500ms` or `1000ms` (S1) | `D20/100ms` on BTC gave 101 whole 20 by 20 frames in 60 s, so it pushes only when the top 20 changed. `D25` is refused with code 2003 |
| `orderbook/{depth}/{speed}/batch` | same shape | several symbols per notification (S1) | not probed |
| `orderbook/top/{speed}` and `/batch` | same shape | best bid and ask, `100ms`, `500ms` or `1000ms` (S1) | not probed |
| `ticker/{speed}`, `ticker/price/{speed}`, `price/rate/{speed}` and their `/batch` forms | same shape | `1s` in the examples (S1) | not probed |
| `trades` | same shape | snapshot then updates (S1) | not probed |
| `candles/{period}`, `converted/candles/{period}` | same shape | | not probed |
| `futures/info` | `{"symbols":["*"]}` subscribes every contract (S1) | mark, index, premium, funding, next funding, open interest | 528 notifications in 60 s across all 24 perpetuals, 22 for BTC, one symbol per notification |

`futures/info` carries every `AnchorRow` column and pushed each active contract about every 3 s, which matches the 3 s republish grid of the REST reply in [`rest.md`](./rest.md) section 4.
A socket feed could replace the REST anchor poll, but the engine's anchor poller is REST, so the REST call is recommended.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for all market data (S1) | spot and perpetual symbols share it, section 1 |
| subscribe frame shape | `{"method":"subscribe","ch":<channel>,"params":{"symbols":[...]},"id":<n>}` (S1) | one frame with 24 symbols was acked once, and all 24 snapshots arrived |
| unknown symbol expectation | not documented for subscribe | `NOPEUSDT_PERP` on `orderbook/full` was acked with the list of the socket's valid subscriptions, without the unknown code and without an error, and nothing followed. An unknown channel answers `{"error":{"code":2003,"message":"Unknown channel",...}}` |
| chunk unit and budget | 10 messages per second per IP on `/ws/public` with a burst of 10 (S1 "Rate limits"), 100 sockets per IP (S1 "Connection") | 24 symbols in one frame, acked in 137 ms, all snapshots within 526 ms |
| keepalive mechanism | the server sends a protocol ping every 30 s (S1 "Ping") | one ping in the first 60 s of a subscribed socket and two in 70 s on an idle one. A socket with `autoPong` off was closed at 60.1 s with code 4002 `Ping pong timeout.` An application `{"method":"ping"}` answered `{"id":6,"result":"pong"}`, though S1 does not document it |
| connection lifetime and maintenance notice | not documented | no forced disconnect in 70 s, no notice frame seen |
| handshake and operation rate limits | 10 per second plus burst 10 on `/ws/public`, 100 sockets per IP (S1) | no refusal at bursts of three and four frames |
| public market data authentication | none (S1) | none |
| message parse and routing | notifications carry `ch` and one of `snapshot`, `update` or `data`, keyed by symbol (S1) | as documented, one symbol per `orderbook/full` notification |
| subscribe acknowledgement shape | `{"result":{"ch":...,"subscriptions":[...]},"id":...}` (S1) | as documented. The `subscriptions` list is the socket's whole set for that channel, not only the new symbols. `futures/info` with `*` acked all 24 codes |
| symbol identifier format | contract code such as `BTCUSDT_PERP` (S1) | identical to the REST catalog key, the REST `futures/info` key and CCXT `hitbtc` `market.id` on 24 of 24 |
| number representation | prices and sizes as strings (S1) | strings, `[["84120.15","0.0009"],...]` |
| timestamp representation | `t` in ms (S1) | integer ms, agreeing with the host clock, D20 frames a median 127 ms old on arrival |
| size unit | not stated | base currency units, the unit CCXT `hitbtc` gives `contractSize` 1, section 4 |
| sequence semantics | `s` is a "sequence number" (S1), no gap rule written | `orderbook/full` stepped by exactly 1 on 355 of 355 updates on three contracts over 60 s, and on 2,773 updates across all 24 contracts over 40 s |
| idle repeat behaviour | not documented | no repeated `s` on `orderbook/full`. `D20/100ms` and `D5/1000ms` send nothing while the top levels do not change, and never repeated an `s` |

## 4. The book channel in detail

`orderbook/full` is the channel this profile recommends.

### Snapshot on subscribe

The first frame per symbol is `"snapshot"` with the whole book and the symbol's `s`.
S1 says the snapshot "comes right after the response", and it arrived 137 to 266 ms after the socket opened, then never again in 60 s.
BTC's snapshot held 354 bids and 182 asks, ETH's 169 and 182, and ZEC's 32 and 17.
The documented snapshot example contains levels of size `"0"`, but no probed snapshot did.

### Deltas

An `"update"` carries only changed levels, and a size of `"0"` removes the level.
Four of ETH's 134 updates carried empty `a` and `b` arrays, and they still advanced `s` by 1.

### Sequence and gap rule

`s` is per symbol and advances by exactly 1 on each update, with 0 gaps and 0 repeats in both runs.
The recommended rule is that an update whose `s` is not the previous `s` plus 1 triggers `resync`.
S1 documents no gap rule and no checksum.

### Level order

Bids descending and asks ascending, in every snapshot and every update, and the REST book agrees, see [`rest.md`](./rest.md) section 5.
No crossed local book appeared in 60 s, and the local top of BTC equalled the REST top at the end of the run, `84108.97` and `84130.65`.

### Size unit

Sizes are in base currency units.
BTC levels read `0.0112`, and the REST ticker's `volume` of 54.0496 against `volume_quote` of 4,580,899 USDT gives about 84,755 USDT per unit, the BTC price.
CCXT `hitbtc` sets `contractSize` to 1 for every contract at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hitbtc.js` line 840, which matches.

### One-sided, empty and far books

The full book spans very wide prices, and one ETH update touched an ask at `4568.124` and a bid at `806.139` while the market sat near 2,690.
The engine keeps the top 20, so the far levels only cost parse time.
No one-sided book was observed, but ATOM showed a 108,441 ppm spread in the REST ticker, see [`rest.md`](./rest.md) section 2.

### Idle repeats and quiet books

ZEC, with 16 USDT of 24 hour volume, sent 68 updates in 60 s and went up to 3.0 s without a frame.
BTC went up to 3.1 s without an update.

### Unknown or closed symbol

An unknown symbol is silently dropped from the ack, see section 3.
A delisted contract was not observed.

## 5. Session

- Keepalive: the server pings every 30 s and closes with 4002 `Ping pong timeout.` when unanswered, observed at 60.1 s.
  The `ws` library answers pings by default, so no application ping is needed.
- Silence tolerated: a socket with no subscription and default pong handling stayed open for 70 s with two pings and no data.
- Forced disconnects and maintenance notices: none seen in about 4 minutes of socket time.
  S1 documents HTTP 503 for maintenance on REST and no socket notice.
- Compression: a client offering `permessage-deflate` got no extension back, so the server does not compress.
  Frames are plain JSON text.
- Limits: 100 sockets per IP and 10 messages per second on `/ws/public` (S1).

## 6. Captured frames

Subscribe acknowledgement, trimmed:

```json
{"result":{"ch":"orderbook/full","subscriptions":["ETHUSDT_PERP","ZECUSDT_PERP","BTCUSDT_PERP"]},"id":1}
```

Snapshot, trimmed to two levels a side:

```json
{"ch":"orderbook/full","snapshot":{"ZECUSDT_PERP":{"t":1790232388504,"s":963311,"a":[["1524.52","64.19"],["1524.55","9.18"]],"b":[["1520.94","58.00"],["1520.65","8.95"]]}}}
```

The frame is cut to the first two asks and the first two bids of the captured snapshot.

Delta:

```json
{"ch":"orderbook/full","update":{"ETHUSDT_PERP":{"t":1790232389947,"s":1527027,"a":[["4568.009","0"],["4568.124","0.040"]],"b":[["806.139","0.040"],["806.119","0"]]}}}
```

Application ping answer:

```json
{"id":6,"result":"pong"}
```

Errors:

```json
{"error":{"code":2003,"message":"Unknown channel","description":"Channel is not supported: orderbook/D25/100ms"},"id":5}
```

```json
{"error":{"code":1,"message":"Invalid json","description":"JSON request is corrupted."}}
```

`futures/info` notification:

```json
{"ch":"futures/info","data":{"MANAUSDT_PERP":{"c":"perpetual","t":1790232388635,"m":"0.0842","i":"0.0842","p":"0","P":"-0.000017201628348222","o":"10745","r":"0.0001","R":"-0.000271451583367902","T":1790236800000,"I":"0.0001"}}}
```

## 7. Private channels

`wss://api.trade.mandala.exchange/api/3/ws/trading` carries spot, margin and futures orders and reports, and `wss://api.trade.mandala.exchange/api/3/ws/wallet` carries balances and transactions (S1).
Not probed.

## 8. Recommended feed shape

- URL plan: one URL, `wss://api.trade.mandala.exchange/api/3/ws/public`.
- Markets per connection: all 24 perpetuals fit on one socket, as probed.
  The 10 messages per second limit only matters for resubscribes.
- Subscribe frame: one `{"method":"subscribe","ch":"orderbook/full","params":{"symbols":[...all 24...]},"id":1}`.
- Keepalive: answer the server's protocol ping, which `ws` does by default.
  No application ping.
- `maxSilenceMs`: 45,000, above the 30 s ping cadence and far above the 3.1 s longest book gap seen.
  A quiet contract such as ZEC or ATOM can go longer without an update, so the silence check must be per socket, not per symbol.
- Book handling: on `snapshot`, `resetBook` and set every level, then `publish`.
  On `update`, check `s` against the previous `s` plus 1, apply sizes with `"0"` as delete, and `publish`.
  On a gap, call `resync`.
- Depth: keep the top 20 of the full book, since `D20/100ms` sends only on change and carries no delta semantics.

## 9. Source ledger

- S1: Mandala Exchange API v3 reference, `https://api.trade.mandala.exchange/`, sections "Rate limits", "Socket API reference", "Subscriptions", "Subscribe to Full Order Book", "Subscribe to Partial Order Book", "Subscribe to Futures Information", fetched with HTTP 200 on 2026-09-24.
- CCXT: `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hitbtc.js` line 840, version 4.5.68.
- Probes: [`ws-probe.mjs`](../../../scripts/probes/venues/mandala/ws-probe.mjs) modes `book` (60 s), `batch` (40 s), `silence` (70 s) and `deflate`.
