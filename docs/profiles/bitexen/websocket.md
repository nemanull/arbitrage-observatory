# Bitexen WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:53 and 05:08 UTC on 2026-09-23, through a Surfshark WireGuard exit that geolocates to Canada.

Bitexen documents no WebSocket.
Its API reference covers REST only, S1.
The bitexen.com web app reads market data from an undocumented socket.io v2 server, and this profile records that feed for the spot market `USDTTRY`, the only order book market Bitexen lists, see [`rest.md`](./rest.md) section 2.
The event names come from the web app bundle, S2, and every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitexen/ws-probe.mjs).
No login frame was ever sent, and every result is from the Canadian VPN exit.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, all markets | `wss://www.bitexen.com/v2/socket.io/?EIO=3&transport=websocket` | open in 601 to 769 ms over 13 sockets, W1 to W4 |
| perpetuals | none | Bitexen lists none, see [`fees.md`](./fees.md) section 3 |

The web app builds the socket with `path: "/v2/socket.io"` against the page's own origin, because the `PROD` tenant's `socket` is `"/"`, S2.
The old path `https://www.bitexen.com/socket.io/?EIO=3&transport=polling` answers 301 to the `/v2/socket.io/` path, P1.
The bundle's socket.io client speaks Engine.IO protocol 3, so `EIO=3` is the version the web app uses, S2.
A polling handshake on `/v2/socket.io/` also answered `EIO=4`, P1.

## 2. Channel matrix for public market data

Events are socket.io events.
A client subscribes by emitting an event whose one argument is the market code, and the server answers with other events, S2.

| client emits | server sends | content | probed |
|---|---|---|---|
| `s_m`, market | `sd` once, then `m_b`, `m_s`, `m_l`, `m_t` | `sd` is the whole market: `b` bids, `s` asks, `l` last trades, `lt` last trade time, `t` ticker. `m_b` and `m_s` are whole sides, `m_l` the whole recent trade list, `m_t` the ticker | yes, W1 |
| `s_ml`, market | `sdl`, `m_tl` | ticker only, the "light" market view | `sdl` in both runs and one `m_tl` in the first, within 2.5 s, W2 |
| `s_t` | `ts` | tickers of every order book market, one array per market | about one frame per second, 3 in the first 2.5 s of each run, W2 |
| `s_r`, `s_rl`, quote currency | `r_t`, `r_tl` | instant buy and sell tickers, short and long interval | not probed |
| `s_f`, platform | `f_s` | remote configuration | not probed |
| `u_m`, `u_ml`, `u_t`, `u_r`, `u_rl`, `u_f` | | unsubscribe | not probed |

No mark, index or funding event exists, because Bitexen has no derivative.
No best bid and ask event exists apart from the ticker's first two fields.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty for every axis because Bitexen documents no WebSocket, S1.
The web app bundle, S2, stands in for documentation where it says something.

| axis | documented (web app bundle) | probed |
|---|---|---|
| endpoint split axis | one socket path for every market | one market exists, so no split was observable |
| subscribe frame shape | `socket.emit("s_m", marketCode)` | `42["s_m","USDTTRY"]` on the wire, W1 |
| unknown symbol expectation | none | `s_m` `NOPETRY` and `s_m` `BTCTRY`, a resell market, each answered `42["sd",{"b":[],"l":[],"s":[],"t":[]}]`. Lowercase `usdttry` got no frame in 2.5 s, W2 |
| chunk unit and budget | none | the open packet sets `"maxPayload": 4096` bytes per client packet. Only one market has a book, so no budget was needed |
| keepalive mechanism | Engine.IO 3: the client sends `2` every `pingInterval`, the server answers `3` | `pingInterval` 25,000 ms and `pingTimeout` 20,000 ms in the open packet. The server never pinged. `3` came back in 158 to 172 ms, W1 and W3 |
| connection lifetime and maintenance notice | none | a socket that pinged stayed open for the full 90 s in both runs. No notice seen, W3 |
| handshake and operation rate limits | none | no refusal at 13 opens over about 14 minutes |
| public market data authentication | none, `login` is only for private messages | none needed, W1 |
| message parse and routing | socket.io event name, then the payload | `42` prefix, a JSON array `[event, payload]`. The book events carry no market code, so a socket is routed by what it subscribed, W1 |
| subscribe acknowledgement shape | none | no acknowledgement. The `sd` snapshot arrived 159 to 174 ms after the subscribe in three runs, W1 |
| symbol identifier format | `market_code`, `USDTTRY` | `USDTTRY`, identical to REST `market_code`, uppercase only, W1 and W2 |
| number representation | strings | price and size are decimal strings. Trade side is the number `0` or `1`, W1 |
| timestamp representation | seconds | Unix seconds as a string with a fraction, `"1790139656.3621905"`, in `lt`, in each trade and as the ticker's tenth field, W1 |
| size unit | base currency | USDT, and each level is `[size, price]` with the size first, W1 |
| sequence semantics | none | no sequence number or update id in any frame. Every book frame is a whole side, so there is nothing to chain, W1 |
| idle repeat behaviour | none | `m_b` repeated the previous bid side unchanged on 6 of 22, 21 of 29 and 15 of 40 pushes, and `m_s` on 15, 14 and 24, in three runs, W1 |

## 4. The book channel in detail

### Snapshot on subscribe

`s_m` answers once with `sd`, which holds up to 50 bids, up to 50 asks, 50 recent trades, the last trade time and the ticker.
Three runs got 50, 46 and 50 bids and 50, 47 and 42 asks, W1.
`sd` was 4,177 and 4,156 bytes of JSON in the second and third runs.

### Delta semantics

There are no deltas.
After `sd` the server pushes `m_b`, `m_s` and `m_l` together in the same millisecond, and each is the whole list, W1.
`m_b` held 45 to 50 levels and `m_s` 40 to 50 across three runs, and every one was ordered, W1.
The web app treats each as a replacement: it maps the array to levels, keeps the first 30, and stores them as the side, S2.
`m_t` arrived 6, 12 and 10 times per minute, sometimes in the same millisecond as a book bundle, W1.

### Push cadence

| run | bundles in 60 s | interval between bundles, min, median and max | intervals over 600 ms |
|---|---|---|---|
| 04:53 UTC | 23 | 492, 514 and 15,021 ms | not counted |
| 05:00 UTC | 30 | 499, 506 and 7,517 ms | 13 of 29 |
| 05:05 UTC, rerun | 41 | 494, 506 and 8,512 ms | 16 of 40 |

Bundles land on a grid of about 500 ms and skip ticks when nothing changed, so a quiet book can go 15 s without a book frame.

### Sequence and gap rule

None.
With whole-side replacement a lost frame is healed by the next one, and no gap can be detected.
A feed would call `resetBook` on every `m_b` and `m_s` pair.

### Checksum

None in any frame.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `sd` | descending, best first, three runs | ascending, best first, three runs |
| `m_b`, `m_s` | descending on every frame | ascending on every frame |
| REST `order_book` | descending | ascending |

### Level window

At most 50 levels per side.
A side can hold fewer: the bid side ended at a 1,000,000 USDT order priced 0.001 TRY in the second run, so the whole bid book was 46 levels.

### Size unit

Sizes are USDT, the base currency, and prices are TRY per USDT.
The top 10 bids and top 10 asks of the last socket frame equalled the REST book read after it on 10 of 10 levels per side in all three runs, W1.
There is no CCXT class, so no `contractSize` exists to compare with, see [`fees.md`](./fees.md) section 8.

### One-sided and empty books

An unknown market and a resell market both get an `sd` with four empty arrays, W2.
`USDTTRY` was never one-sided.

### Idle repeats

Yes, see axis 16.
Both sides are pushed whenever either side or the trade list changes, so the unchanged side repeats.

### Unknown, closed and wrong-case symbols

| request | reply |
|---|---|
| `s_m` `NOPETRY` | `42["sd",{"b":[],"l":[],"s":[],"t":[]}]` |
| `s_m` `BTCTRY`, a `resell_market` pair | the same empty `sd` |
| `s_m` `usdttry` | nothing in 2.5 s |
| unknown event `nope` | nothing, the socket stays open |
| `hello`, text that is not an Engine.IO packet | the server closed the socket 156 ms after it was sent, code 1005 with no close reason |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | none, Engine.IO 3 defaults in the open packet | client `2` every 25 s, server `3` in 158 to 172 ms, W1 |
| silence the server tolerates | `pingInterval` 25,000 plus `pingTimeout` 20,000 ms | a socket that never pinged got the Engine.IO close packet `1` and closed at 45.6 to 45.8 s with code 1005, with or without a subscription, four sockets over two runs, W3 |
| forced disconnect | none | none in 90 s with pings, two runs |
| maintenance notice | none | none seen |
| compression | none | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, W4 |
| handshake | none | 601 to 769 ms to open, W1 to W4 |
| subscription limits | none | not tested beyond one market |
| throughput | none | 80, 107 and 138 frames per minute, 100, 127 and 170 KB per minute, on the one market, W1 |

## 6. Captured frames

Trimmed, from the W1 and W2 reruns at 05:05 UTC.
Arrays are cut to their first levels, and the JSON blocks are the payload after the `42` prefix.

Open packet and socket.io connect.

```text
0{"sid":"rxwEvPpaaFAVYcLx","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":4096}
40
```

Subscribe.

```text
42["s_m","USDTTRY"]
```

Snapshot, first two levels per side and one trade kept.

```json
["sd",{"b":[["459.39","48.338"],["7914.87","48.337"]],"s":[["35.32","48.684"],["8041.51","48.685"]],"l":[["63.98","48.685","1790139885.6599176",0]],"lt":"1790139885.6599176","t":["48.338","48.684","48.685","63.98","453437.83","0.61","48.303","48.785","48.558","1790139908.945457","USDTTRY"]}]
```

Bid side and ask side of one bundle, first three levels kept.
The full frames held 50 bids and 42 asks.

```json
["m_b",[["447.86","48.338"],["7914.87","48.337"],["12935.97","48.332"]]]
```

```json
["m_s",[["35.32","48.684"],["8041.51","48.685"],["13171.42","48.690"]]]
```

Trade list of the same bundle, first two of 50 kept, where `0` is a buy and `1` a sell in the web app's mapper.

```json
["m_l",[["11.53","48.338","1790139943.637693",1],["63.98","48.685","1790139885.6599176",0]]]
```

Ticker, in the same millisecond as that bundle: bid, ask, last, last size, 24 h volume, 24 h change in percent, low, high, 24 h average, time, market.

```json
["m_t",["48.338","48.684","48.338","11.53","453449.36","-0.10","48.303","48.785","48.558","1790139944.0030823","USDTTRY"]]
```

Keepalive, client then server.

```text
2
3
```

Unknown market, and a resell market.

```json
["sd",{"b":[],"l":[],"s":[],"t":[]}]
```

Close packet sent to a socket that stopped pinging, 45.6 s after it opened.

```text
1
```

## 7. Private channels

Named from the web app bundle, S2, not probed.
The client emits `login` and `logout`, where `logout` carries a signed payload, and the server sends private messages as the `message` event.
No order entry over the socket is visible in the bundle.

## 8. Recommended feed shape

No feed is recommended.
Bitexen lists no perpetual, its one book is `USDTTRY`, and the socket is undocumented, so it can change without notice.
If a spot stage ever wanted it, the shape below follows from the probes.

| item | value | reason |
|---|---|---|
| URL plan | one socket, `wss://www.bitexen.com/v2/socket.io/?EIO=3&transport=websocket` | one market exists |
| subscribe | `42["s_m","USDTTRY"]` after the `40` connect packet | the web app's own frame |
| keepalive | send `2` every 25 s | the server closes a socket that has not pinged for 45 s |
| `maxSilenceMs` | 45,000 | a quiet book went 15 s without a book frame, and the `3` pong every 25 s counts as traffic |
| book handling | `resetBook` from `sd`, then again from every `m_b` and `m_s` pair | every book frame is a whole side |
| resync | none needed | no sequence exists, and each frame replaces the side |
| sizes | swap the pair: level `[size, price]` | size comes first |
| receive time | stamp on arrival | no book frame carries a time |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitexen API Reference | https://docs.bitexen.com/ | 2026-09-22 | Bitexen, Turkey | REST only, no WebSocket section, sections 1 and 3 |
| S2 | bitexen.com web app bundle, `assets/index-Dtr3JuRb.js` and `assets/simplebar-nn-LKBMS.js` | https://www.bitexen.com/assets/index-Dtr3JuRb.js | 2026-09-22 | Bitexen | socket path, event names, Engine.IO 3 client, level mappers, whole-side handling, private events, sections 1 to 7 |
| P1 | `curl` polling handshakes on `/socket.io/` and `/v2/socket.io/` | `https://www.bitexen.com/v2/socket.io/?EIO=3&transport=polling` | 2026-09-22 | this host | the 301 and the open packet, section 1 |
| W1 | `ws-probe.mjs book`, runs at 04:53, 05:00 and 05:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexen/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| W2 | `ws-probe.mjs errors` at 04:53 and 05:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexen/ws-probe.mjs) | 2026-09-22 | this host | unknown and resell markets, light and ticker events, sections 2 to 4 |
| W3 | `ws-probe.mjs silence` at 04:55 and 05:07 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexen/ws-probe.mjs) | 2026-09-22 | this host | the 45.6 s close, section 5 |
| W4 | `ws-probe.mjs deflate` at 04:53 and 05:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexen/ws-probe.mjs) | 2026-09-22 | this host | compression, section 5 |
