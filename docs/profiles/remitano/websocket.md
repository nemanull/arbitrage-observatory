# Remitano WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:58 to 03:22 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Remitano lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book stream.
Remitano publishes no WebSocket documentation, and every endpoint, room and frame here comes from the web app and the wire.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/remitano/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S10 are those of [`fees.md`](./fees.md) section 10.
The short answer is that the book stream is a Socket.IO room that pushes the whole level list of one directed pair whenever it changes, with no snapshot on subscribe, no sequence and no acknowledgement.
A feed would have to seed itself from REST and could not detect a missed update.

## 1. Endpoints

The web app HTML sets two socket hosts, S4:

```js
window.WEBSOCKET_HOST = "socket.remitano.com"
window.CABLESOCKET_HOST = "cablesocket.remitano.com/cable"
```

| endpoint | protocol | public market data | probed |
|---|---|---|---|
| `wss://socket.remitano.com/socket.io/?EIO=4&transport=websocket` | Socket.IO over Engine.IO 4 | the book room `order_book_price_level_state`, plus `exchange_rates`, `accumulated_price_ladders` and `amm_pools`, S5 | HTTP 101 behind Cloudflare, edge `YVR`, no `sec-websocket-extensions` in the reply |
| `wss://cablesocket.remitano.com/cable` | Rails ActionCable, subprotocol `actioncable-v1-json` | `ExchangeRateChannel`, and swap rate channels that need parameters, S5 | HTTP 101, `welcome` frame |

One Socket.IO socket carries every pair, because the book room is one room for the whole venue.
The web app connects with `transports:["websocket"]` only, S5.

## 2. Channel matrix for public market data

| data | where | probed |
|---|---|---|
| book, every pair | Socket.IO room `order_book_price_level_state`, event `socket:order_book_price_level_state:update` | 13 updates over 180 s on 6 directed pairs in the first run, 11 on 3 in the second |
| book, other depths or speeds | none | the room is the only book stream named in the bundle, S5 |
| best bid and ask | none on a socket | REST `GET /api/v1/markets/exchange_info`, see [`rest.md`](./rest.md) section 2 |
| trades | none on a socket | not in the bundle's socket rooms, S5 |
| ticker | none on a socket | REST only |
| reference prices of other venues | room `exchange_rates`, event `socket:exchange_rates:update`, and ActionCable `ExchangeRateChannel` | 11 updates over 180 s in the first run and 8 in the second, keys such as `bitstamp_BTCUSD`, `binance_BTCUSD`, `kraken_BTCEUR` |
| swap ladders and AMM pools | rooms `accumulated_price_ladders` and `amm_pools` | named in the bundle, not detailed |
| mark, index, funding | Not offered | no perpetuals, see [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one Socket.IO URL for every pair |
| subscribe frame shape | Not publicly specified, the bundle emits `42["subscribe",{"room":<room>,"token":<token>}]`, S5 | the same frame with `"token":""` delivered book updates |
| unknown symbol expectation | Not publicly specified | there is no per symbol subscribe, and `no_such_room_xyz` got no frame and no error in 180 s |
| chunk unit and budget | Not publicly specified | not applicable, one room carries every pair |
| keepalive mechanism | Engine.IO 4, the server sends `2` every `pingInterval` 25,000 ms and expects `3` | `2` arrived at 25.3, 50.4, 75.5 s and on through 175.8 s |
| connection lifetime and maintenance notice | `pingTimeout` 60,000 ms in the open packet | a socket that never answered `2` was closed at 85.4 s with code 1005 and no close frame, which is one interval plus the timeout |
| handshake and operation rate limits | Not publicly specified | every open of the session was accepted, with no refusal |
| public market data authentication | the web app sends a token when signed in, S5 | none needed, an empty token works |
| message parse and routing | Socket.IO EVENT packets | `42[<event name>, <payload>]`, route by the event name |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement for any `subscribe` |
| symbol identifier format | Not publicly specified | `order_book_pair` in lower case, base and quote joined by `_`, in either direction, such as `ada_usdt` and `usdt_dot` |
| number representation | Not publicly specified | `price` and `amount` as decimal strings with 18 places |
| timestamp representation | Not publicly specified | no timestamp in a book update |
| size unit | Not publicly specified | units of the first asset of the directed pair, see section 4 |
| sequence semantics | none documented | none on the wire, each update is the whole level list of one directed pair |
| idle repeat behaviour | Not publicly specified | none, the longest gap between book updates was 81.2 s in the first run and 48.1 s in the second |

## 4. The book channel in detail

### Snapshot on subscribe

None.
The `subscribe` emit gets no reply, and the first book update arrived 8.6 s later for `vnd_usdt` in the first run and 9.5 s later for `ngn_usdt` in the second, each a change and not a snapshot.
The web app seeds its state from `GET /api/v1/order_book_price_levels`, which returns every directed pair at once, and polls it again every 60 s, S5.
Its saga calls the fetch with `forceFetch:!1` in a loop with a 60,000 ms delay, and skips a fetch less than 30,000 ms after the last one.

### Delta semantics

Each update carries `order_book_pair` and `price_levels`, and the web app's handler stores `price_levels` as the whole state of that pair, S5.
So an update replaces one directed pair's levels and is not a delta.
Over two runs of 180 s the probe saw level counts of 7, 8, 11, 12, 13, 14, 15, 23, 99 and 100, which matches whole lists and not single level changes.

### Sequence and gap rule

There is no sequence number, no timestamp and no checksum in an update.
A lost update cannot be detected.
Because each update replaces a pair's state, the next update for the same pair repairs it, but a quiet pair can stay wrong for minutes.
The only safe rule is the web app's own: reload the REST state on a timer.

### Checksum

None.

### Level order on the wire

A directed pair `x_y` lists offers to sell `x` for `y`, with `price` in `y` per `x`, from the best price up.
So `btc_usdt` is the ask side of `BTC_USDT`, and its 100 levels equalled the REST asks exactly, see [`rest.md`](./rest.md) section 5.
The bid side of `BTC_USDT` is the directed pair `usdt_btc`, whose `price` is BTC per USDT and whose `amount` is USDT.
The REST bid is `1 / price` with size `amount * price`, so `usdt_btc` first level `0.000012239902080784` and `0.9975` became the REST bid `81699.999999996` for `0.000012209302325582` BTC.
A feed would have to listen to both directions of every pair and invert one of them.

### Level window

Up to 100 levels per directed pair, the same cap as REST.

### Size unit

The `amount` is in the first asset of the directed pair, so base units on the ask side and quote units on the bid side before inversion.
There is no contract size, and there is no CCXT market to compare it with, see [`fees.md`](./fees.md) section 8.
Many `usdt_*` levels hold exactly `0.9975`, which is 1 less 0.25 %, so the amounts may be net of the taker fee.
That reading is a guess and Not publicly specified.

### One-sided and empty books

An empty side is an empty `price_levels` list.
In the REST state 238 of 1,650 directed pairs held any level, and `FIVE_USDT` had asks and no bids, see [`rest.md`](./rest.md) section 2.

### Idle repeats

None seen.
Updates are rare.
The first run saw 13 in 180 s across the whole venue, on `ngn_usdt` 4 times, on `renec_doge`, `ada_usdt`, `s_usdt` and `usdt_dot` twice each, and on `vnd_usdt` once.
The second run saw 11, on `ngn_usdt` 7 times and on `xrp_usdt` and `near_usdt` twice each.
None in either run touched `btc_usdt` or `usdt_btc`.

### Unknown, closed and wrong-level symbols

There is no per symbol subscribe, so there is no unknown symbol case.
An unknown room and an unknown event name both got silence and left the socket open.
A text frame that is not a Socket.IO packet made the server drop the socket within 0.2 s with code 1005 and no close frame, in three runs.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | the server sends Engine.IO `2` every 25 s and the client answers `3` | probed, section 3 |
| silence tolerated | 85.4 s without a `3`, which is `pingInterval` plus `pingTimeout` | probed, silence mode |
| forced disconnects | none in 180 s with pings answered | probed |
| maintenance notices | Not publicly specified | |
| compression | none offered and none forced, the upgrade reply had no `sec-websocket-extensions` | probed |
| handshake and subscription limits | Not publicly specified, `maxPayload` 1,000,000 bytes in the open packet | probed |
| ActionCable keepalive | `{"type":"ping","message":<unix seconds>}` every 3 s | probed, cable mode |

## 6. Captured frames

Open packet and namespace connect, trimmed:

```text
< 0{"sid":"i62h8zRjzdVlgLAoGczN","upgrades":[],"pingInterval":25000,"pingTimeout":60000,"maxPayload":1000000}
> 40
< 40{"sid":"Lc_rt6SbS6Y2p0OdAAAE"}
```

Subscribe, with no acknowledgement:

```text
> 42["subscribe", {"room": "order_book_price_level_state", "token": ""}]
```

A book update, the first of the session at 8.6 s, trimmed to three of its levels:

```json
["socket:order_book_price_level_state:update",
 {"order_book_pair":"vnd_usdt",
  "price_levels":[{"price":"0.000038520801232666","amount":"99625000.000000000000000000"},
                  {"price":"0.000038536967163807","amount":"285199804.320257025004190350"},
                  {"price":"0.000038580246913581","amount":"49812500.000000000000000000"}]}]
```

A reference price update, trimmed:

```json
["socket:exchange_rates:update",{"bitstamp_BTCUSD":82536.02,"bitfinex_BTCUSD":71073,"kraken_BTCEUR":73727.55,"binance_BTCUSD":82604.99}]
```

Keepalive: the server sends the text frame `2` and the probe answers `3`.

Error: there is no error frame.
A junk text frame ends the socket with code 1005.

ActionCable, trimmed:

```text
< {"type":"welcome"}
< {"identifier":"{\"channel\": \"ExchangeRateChannel\"}","type":"confirm_subscription"}
< {"identifier":"{\"channel\": \"DefaultSwapRateChannel\"}","type":"reject_subscription"}
< {"type":"ping","message":1791601534}
```

## 7. Private channels

The web app sends a `token` with every `subscribe` when signed in, and the same Socket.IO socket then carries account rooms, S5.
Their names were not catalogued, because no account was used.

## 8. Recommended feed shape

None for the engine as it stands.
Remitano has no perpetual and no CCXT class, so it has no place in the perpetual engine.

If a later design adds spot legs, the shape would be:

- one socket to `wss://socket.remitano.com/socket.io/?EIO=4&transport=websocket`, send `40`, then `42["subscribe",{"room":"order_book_price_level_state","token":""}]`.
- answer every `2` with `3`, and set `maxSilenceMs` near 30,000, because a ping arrives every 25 s even when no book changes.
- seed every pair from `GET /api/v1/order_book_price_levels` and reload it every 60 s, as the web app does, because there is no snapshot, sequence or checksum.
- treat each update as the whole state of one directed pair, and build `X_USDT` from `x_usdt` for asks and the inverted `usdt_x` for bids.

The stream is too sparse to call a book feed.
It carried one update every 14 to 16 s across the whole venue, and none for BTC in six minutes over two runs.
The REST seed is the feed in practice.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S4 | `https://remitano.com/policy/api_terms_of_service`, the web app HTML | the two socket hosts |
| S5 | `https://cdn.remitano.com/assets/chunks/react-35b6ed4f.js` | the subscribe frame, the event naming `socket:<room>:<event>`, the room names, the 60 s REST reload and the replace on update |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/remitano/ws-probe.py) mode `session`, 180 s | pings, update counts, level counts, unknown room and event |
| P2 | the same, mode `silence` | close at 85.4 s |
| P3 | the same, mode `cable` | ActionCable welcome, confirm, reject and ping |
| P4 | the same, mode `junk` | close with code 1005 |
