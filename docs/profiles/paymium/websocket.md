# Paymium WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:47 to 05:03 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public socket of Paymium (CCXT id `paymium`), which carries the one BTC/EUR spot book, since the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
The socket is a socket.io 1.x server on Engine.IO protocol 3, not a plain JSON WebSocket.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Access results are from the Canadian VPN exit named in the Probed line, and no socket was refused.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| BTC/EUR spot, public | socket.io at `https://paymium.com/public` with `path` `/ws/socket.io`, S1 | `wss://paymium.com/ws/socket.io/?EIO=3&transport=websocket`, then the namespace join `40/public`, opened in 682 to 938 ms over 21 sockets in both passes, P1 to P3 |
| user, private | `https://paymium.com/user`, same path, S1 | not probed |
| perpetuals, futures, options | none | the venue lists none |

One socket and one namespace carry the whole venue, since there is one book.
`paymium.com` resolved to the Cloudflare addresses `104.20.34.60` and `172.66.163.190`, see [`rest.md`](./rest.md) section 1.
The account web app does not serve a socket on its own host.
`wss://account.paymium.com/socket.io/?EIO=4&transport=websocket` answered HTTP 200 with the app's HTML, P2.
The app bundle reads its socket URL from a runtime setting `PAYMIUM_ENV_SOCKET_URL` that this probe did not read, and it names socket endpoints `public/bids`, `public/asks`, `public/ticker`, `public/prices` and `heartbeat`, which match the documented `stream` keys.
That mapping is an inference from minified code.

## 2. Channel matrix for public market data

There are no channels to subscribe.
Joining the `/public` namespace delivers everything the namespace publishes, as socket.io events.

| event and key | payload | cadence | probed |
|---|---|---|---|
| `stream`, `bids` | changed bid levels, "aggregated by price", `amount` 0 deletes the level, S1 | on change | 2 frames in run 1 and 6 in run 2, 75 s each, P1 |
| `stream`, `asks` | changed ask levels, same rule | on change | 20 and 18 frames, P1 |
| `stream`, `ticker` | the ticker, documented "If the ticker changed", S1 | on a trade | not observed, no trade printed during the probes |
| `stream`, `trades` | new trades, S1 | on a trade | not observed |
| `stream`, `prices` | the broker price of 33 pairs, `btceur` among them, for Paymium's conversion service | every 9.6 to 10.2 s | 7 and 8 frames of about 8.9 KB, P1 |
| `announcement` | an array of site notices in five languages with `severity` and `display_type` | every 10 s | 7 per 75 s in each run, P1 |

No depth selection, speed option, best bid and ask event, mark, index or funding event exists.
Level updates of both sides can share one frame, and a level update can share a frame with `prices`.
`keyCombos` in run 1 were `asks` 17, `prices` 6, `asks+bids` 2 and `asks+prices` 1, and in run 2 `asks` 16, `prices` 7, `bids` 3, `asks+bids` 2 and `bids+prices` 1, P1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | public and user namespaces on one server, S1 | one socket carries the only market |
| subscribe frame shape | a socket.io client connects to the `/public` namespace, S1 | the raw frame is the text `40/public` |
| unknown symbol expectation | not applicable, there is no per symbol subscription | an unknown namespace `40/nope` answers `44/nope,"Invalid namespace"` and the socket stays open, P2 |
| chunk unit and budget | not applicable | one namespace, no symbol list |
| keepalive mechanism | "Websockets are implemented using socket.io v1.3", S1, whose client pings | the open packet says `pingInterval` 10000 and `pingTimeout` 86400000. The client sends `2`, the server answers `3` in 168 to 184 ms, and the server sent no ping on any socket, P1 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 110 s. The `announcement` event carries site notices, which is where a maintenance notice would appear, and it held one `info` notice about SMS validation |
| handshake and operation rate limits | Not publicly specified | 21 sockets opened across both passes, up to three at once, with no refusal |
| public market data authentication | none, S1 | none |
| message parse and routing | socket.io `stream` event, "The object will have properties only for the data that changed", S1 | each text frame is an Engine.IO packet. A level frame is `42/public,["stream",{...}]`, which is the packet type `4`, the socket.io type `2`, the namespace, a comma, and a JSON array of event name and payload |
| subscribe acknowledgement shape | not documented | the server echoes `40/public`, 170 and 181 ms after the join was sent, P1 |
| symbol identifier format | none on the socket | a level carries only `"currency": "EUR"`. The REST depth names `"market": "BTC-EUR"`, and CCXT's `market.id` is `"eur"` |
| number representation | the bids example shows `amount` and `price` as strings, the asks example shows them as JSON numbers, S1 | strings on all 72 levels of both runs, such as `"amount":"0.71697100","price":"77792.10"` |
| timestamp representation | `timestamp` in the level examples, as Unix seconds | Unix seconds on a changed level, and `0` on every deleted level. A non-zero level `timestamp` lagged arrival by 0.3 to 1.3 s in run 2, which is within its one second resolution |
| size unit | BTC | BTC, the same `amount` the REST depth shows, section 4 |
| sequence semantics | none documented | no sequence field in any frame. The undocumented REST `version` rose by 32 over 32 streamed level updates in run 1 and by 41 over 40 in run 2 |
| idle repeat behaviour | not documented | no level is repeated. `prices` and `announcement` arrive every 10 s whatever the book does |

## 4. The book channel in detail

### Snapshot on subscribe

None.
After `40/public` the socket sends only changes, and the documentation says the stream "will emit an object when new data is available", S1.
The book has to be seeded from `GET https://paymium.com/api/v1/data/eur/depth`, see [`rest.md`](./rest.md) section 5.

### Delta semantics

Each level in `bids` or `asks` is an absolute amount at a price, with the fields `amount`, `price`, `category`, `currency` and `timestamp`.
`category` is `"buy"` on bids and `"sell"` on asks.
An `amount` of `"0.00000000"` deletes the level, and that level carries `timestamp` 0.
All 32 deletes and all 36 adds the capture could parse followed that rule, with a non-zero `timestamp` on every add, P1.
16 of 32 updates in run 1 and 20 of 40 in run 2 were deletes, P1.
A frame held at most 3 levels per side in run 1 and 6 in run 2.

### Sequence and gap rule

```text
no sequence on the wire
seed: GET /api/v1/data/eur/depth, keep its version
update: set the level to amount, or delete it when amount is 0
check: a later depth call should equal the local book, a mismatch means resync
```

A book seeded from one REST depth after the join and kept from every streamed level equalled a second REST depth 73 s later on 20 of 20 levels per side, in both runs, P1.
No update arrived between the join and the seed in either run, or during the closing REST call in run 2, which is the run that counted it.
The REST `version` is not on the socket, so it cannot align a seed with the stream, and it rose by one more than the streamed updates in run 2.
A lost frame cannot be detected from the stream itself.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| stream | unordered, such as bids 75,552.73, 75,927.62 and 75,174.66 in one frame, applied by price | unordered changes, applied by price |
| REST depth | best first, descending, on 60 of 60 polls | best first, ascending, on 60 of 60 polls |

### Level window

The stream reports changes anywhere in the book, such as an ask at 77,796.09 about 2 % above a touch near 76,300 in run 1.
The REST depth held 200 bids and 129 to 131 asks on every poll, down to a bid of 35,300 and up to an ask of 800,000, so a seeded book holds far more than the engine's 20 levels, see [`rest.md`](./rest.md) section 5.
Whether the bid side stops at 200 levels on the server is Not verified.

### Size unit against CCXT `contractSize`

`amount` is BTC.
The REST depth and the socket agree to the last digit, since the kept book matched the REST book on every one of the top 20 levels in both runs.
CCXT's BTC/EUR market has `contractSize` `undefined`, see [`rest.md`](./rest.md) section 2, and the connector turns a missing size into 1 at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194, which is the right multiplier for BTC.

### One-sided, locked and empty books

No one-sided or empty book was seen.
In the second and third REST runs a 10 EUR bid at 76,280.00 sat one cent under the best ask at 76,280.01, a spread of 0.13 ppm, and no poll of 60 was crossed, see [`rest.md`](./rest.md) section 5.

### Idle repeats

Nothing is repeated.
Between level changes the socket sends only `prices` and `announcement`, each every 10 s.
The longest gap between two `stream` frames was 10,019 ms in run 1 and 10,228 ms in run 2, set by the `prices` cadence.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `40/nope` | `44/nope,"Invalid namespace"` | the socket stays open |
| `42/public,["subscribe","BTC-EUR"]` | nothing | the socket stays open and nothing extra arrives |
| `hello`, then `{"op":"subscribe"}` | no packet | the server closed the socket with code 1000 before the 4 s hold ended, in both runs |
| no namespace join | only `0{...}` and `40` | no `stream` in 6 s, and the socket dies at 60 s, section 5 |
| `EIO=4` in the URL | the same open packet as `EIO=3` and the same stream | the server ignores the version parameter |
| no `EIO` parameter | the same | the same |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | socket.io 1.3 client heartbeat, S1 | `pingInterval` 10,000 ms. The client sends `2` and receives `3` in 168 to 172 ms in run 1 and 178 to 184 ms in run 2 |
| silence the server tolerates | `pingTimeout` 86,400,000 ms in the open packet | a socket that never joined `/public` and never pinged closed 60.0 s after open with code 1006 and no close frame, in both runs. A joined socket that never pinged stayed open 110 s in run 1 and 70 s in run 2, because `prices` and `announcement` keep traffic flowing. A socket that never joined but pinged every 10 s stayed open 70 s, P3 |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | not documented | the `announcement` event, `severity` `"info"` on the one notice seen |
| compression | Not publicly specified | text frames only. A client that offered permessage-deflate got `sec-websocket-extensions: permessage-deflate` back, so the server compresses when asked. With `perMessageDeflate: false` no extension was negotiated, P2 |
| handshake | socket.io 1.3 | 682 to 938 ms to open from this host, then 170 to 181 ms to the namespace echo |
| subscription limits | none | none reached, the namespace carries one market |
| throughput | | 26 and 29 `stream` frames and 7 `announcement` frames per 75 s. The `prices` frame of about 8.9 KB every 10 s is most of the bytes |

The 60 s close of an idle socket is below the 24 h `pingTimeout`, so it comes from something in front of the socket.io server.
A 60 s read timeout is the default of an nginx proxy, and that cause is an inference.

## 6. Captured frames

Trimmed, from the second pass at 04:59 to 05:03 UTC.
The leading number in the capture was milliseconds since the probe started and is dropped here.

Engine.IO open packet, then the default namespace, then the echo of the join.

```text
0{"sid":"unqjClf4Sn9jVyFOAFdn","upgrades":[],"pingInterval":10000,"pingTimeout":86400000}
40
40/public
```

Level updates: a delete and an add on the ask side.

```text
42/public,["stream",{"asks":[{"amount":"0.00000000","price":"76333.27","category":"sell","currency":"EUR","timestamp":0}]}]
42/public,["stream",{"asks":[{"amount":"0.05245168","price":"76360.74","category":"sell","currency":"EUR","timestamp":1790139583}]}]
```

Both sides in one frame.

```text
42/public,["stream",{"bids":[{"amount":"0.00000000","price":"76234.52","category":"buy","currency":"EUR","timestamp":0},{"amount":"0.00000000","price":"74797.06","category":"buy","currency":"EUR","timestamp":0}],"asks":[{"amount":"0.00000000","price":"76360.75","category":"sell","currency":"EUR","timestamp":0},{"amount":"0.00000000","price":"77422.49","category":"sell","currency":"EUR","timestamp":0}]}]
```

The `btceur` entry of a `prices` frame, one of 33 keys.
`price` is the last trade, and `swap` holds the broker's buy and sell prices.

```json
{"base_currency":"btc","quote_currency":"eur","price":"75980.0","broker_price":"76277.2","timestamp":1790139571,"swap":{"purchase_price":"76333.27","sale_price":"76234.52"},"card_payment":{"purchase_price":"77413.73","sale_price":"75140.67"},"variation":"0.2959"}
```

Keepalive, the client ping and the server pong.

```text
2
3
```

Error for an unknown namespace.

```text
44/nope,"Invalid namespace"
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
The client connects to `https://paymium.com/user` with the same path and emits `channel` with the `channel_id` from `GET /api/v1/user`.
The `stream` event then carries `balance_eur`, `locked_eur`, `balance_btc`, `locked_btc` and `orders`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Paymium is spot only and the engine consumes perpetuals, so no feed is recommended for the engine as it is.
The rows below describe what a BTC/EUR spot feed would need if a later design wants one.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://paymium.com/ws/socket.io/?EIO=3&transport=websocket` | one market, one namespace |
| markets per connection | 1 | there is one |
| subscribe frames | the text `40/public` after the `0{...}` open packet, not a JSON object | socket.io 1.x namespace join |
| keepalive | send the text `2` every 10,000 ms, the `pingInterval` of the open packet | the server never pings, and an idle socket dies at 60 s |
| `maxSilenceMs` | 25,000 | `prices` and `announcement` arrive every 10 s and a pong every 10 s, so two missed rounds is a dead socket |
| routing | frames starting `42/public,` whose event is `stream`, all to the one BTC/EUR market | no symbol on the wire |
| snapshot | on open and on every resync, call `GET /api/v1/data/eur/depth` after the join, buffer stream levels that arrive during the call and apply them after the seed | the socket sends no snapshot, and replaying an absolute level is harmless unless the same price changed twice during the call |
| delta | set each level to `Number(amount)`, delete it on 0 | documented and matched the REST book on 20 of 20 levels |
| resync | no gap rule exists, so compare the kept top 20 with a REST depth every 60 s, and on a mismatch `resync` | a lost frame is otherwise invisible |
| receive time | stamp on arrival | the level `timestamp` has one second resolution and is 0 on deletes |
| parse | strip the Engine.IO and socket.io prefix up to the first `[`, then `JSON.parse` | the frame is not bare JSON |
| deflate | keep `perMessageDeflate: false` | the server would negotiate it if offered |

The VenueFeed base class opens the socket with `perMessageDeflate: false` at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 and hands `handleMessage` the raw frame, as the Gate subclass shows, so the prefix handling fits inside a subclass.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Paymium API 1.1.1, section WebSocket | https://paymium.github.io/api-documentation/ | 2026-09-22 | Paymium SAS | URL, path, namespaces, `stream` keys, examples, user channel, sections 1 to 7 |
| S2 | Paymium API changelog 1.1.0 to 1.1.1 | https://raw.githubusercontent.com/Paymium/api-documentation/master/API-CHANGES.md | 2026-09-22 | Paymium SAS | no socket change listed, and the repository's last commit is dated 2024-12-19 in its commit feed |
| P1 | `ws-probe.mjs book`, runs at 04:47 and 04:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs variants`, runs at 04:49 and 05:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | errors, EIO versions, deflate, web app host, sections 1, 3, 4, 5 |
| P3 | `ws-probe.mjs silence`, runs at 04:51 and 05:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/paymium/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | idle close and keepalive, section 5 |
