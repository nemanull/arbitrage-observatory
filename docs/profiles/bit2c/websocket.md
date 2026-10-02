# Bit2c WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:49 to 05:08 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

Bit2c (CCXT id `bit2c`) documents no WebSocket API.
Its API page S1 lists REST calls only, and CCXT 4.5.68 marks the class `pro: false` and `has.ws` false, at `server/node_modules/ccxt/js/src/bit2c.js` lines 25 and 117.
The web site itself opens an ASP.NET SignalR connection to a hub named `tradeHub`, loaded from `https://bit2c.co.il/signalr/hubs`, and that hub pushes the top ten levels of every live book to an anonymous visitor.
This profile records that hub as [`ws-probe.mjs`](../../../scripts/probes/venues/bit2c/ws-probe.mjs) found it, because it is the only push feed the venue has.
It is undocumented, it is an interface of the site and not of the API, and it can change without notice.
Bit2c lists no perpetuals, so the book described here is the spot book of its four NIS pairs, see [`fees.md`](./fees.md) section 3.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| any public WebSocket API | none, S1 | |
| site SignalR, negotiate | not documented | `GET https://bit2c.co.il/signalr/negotiate?clientProtocol=1.5&connectionData=[{"name":"tradehub"}]`, 200 in 427 to 800 ms over four negotiations, P1 to P4 |
| site SignalR, socket | not documented | `wss://bit2c.co.il/signalr/connect?transport=webSockets&clientProtocol=1.5&connectionToken=<token>&connectionData=[{"name":"tradehub"}]&tid=3`, open in 370 to 821 ms over five sockets, P1 to P5 |
| site SignalR, start | not documented | `GET https://bit2c.co.il/signalr/start?transport=webSockets&clientProtocol=1.5&connectionToken=<token>&connectionData=…`, 200 `{ "Response": "started" }`, P1 |
| FIX API | `https://bit2c.co.il/FixAPI/index` is linked from S1 | 302 to `/Account/LogOn`, so its description needs a login, not probed further |

One socket carries every pair.
The server pushes all four live books to every connection, and there is no subscribe frame at all.
The socket URL carries the token from the negotiate reply, and the site's SignalR client negotiates again for each new connection, so a feed would do the same.
Whether a token can be reused was not tested.

## 2. Channel matrix for public market data

A SignalR hub method is the nearest thing to a channel.
The names below are the client methods the site's own script registers in `Bit2c-site.js`, and the counts are what one anonymous socket received in 100 s, in P1, P2 and P4.

| hub method | payload | cadence | probed |
|---|---|---|---|
| `UpdateOrderBook_<pair>` | `{"Asks": [{"Price", "Amount"} × 10], "Bids": [… × 10]}`, the whole top ten | per pair, median gap 273 to 830 ms, longest gap 19,671 ms on `UsdcNis` | 348 to 350 `EthNis`, 165 to 256 `BtcNis`, 124 to 220 `LtcNis`, 60 to 115 `UsdcNis` per 100 s |
| `UpdateAllTicker` | `{"<pair>": {"h", "l", "ll", "a", "av", "c", "up"}}`, the REST ticker of one pair | median gap 216 to 268 ms | 354 to 505 per 100 s |
| `TradesUpdated_<pair>` | the site passes it to its trade table, and the one call seen carried 95 bytes of arguments whose shape was not kept | on trade | 1 in P2, 0 in P1 and P4. `BtcNis` trades about 30 times a day, [`rest.md`](./rest.md) section 2 |
| `UpdateLastKline_<pair>` | the last candle, 98 bytes of arguments, shape not kept | on trade | 1 in P2, 0 in P1 and P4 |
| `IsLogged` | `[null]` for an anonymous socket | once, right after connect | 1 per socket |
| mark, index, funding | absent | | |

A frame may bundle several methods.
In P2, 408 frames carried one method, 361 carried two, one carried three and one carried four, and in P4 the counts were 371, 495, 7 and 2.
The usual pair is `UpdateAllTicker` with the `UpdateOrderBook_` of the same pair.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty in substance, because no socket is documented, so it names the ASP.NET SignalR 1.5 protocol where that fixes the behaviour.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none documented | one hub socket carries all four pairs, section 1 |
| subscribe frame shape | none documented | no subscribe exists, the hub pushes every pair to every connection. The client never sends a frame |
| unknown symbol expectation | none documented | not applicable without a subscribe. A hub name that does not exist fails at negotiate with HTTP 500 and an HTML page titled `500 - Internal server error.` |
| chunk unit and budget | none documented | one socket carries the whole venue, four pairs |
| keepalive mechanism | SignalR server keepalive, negotiate says `KeepAliveTimeout` 20 s | the server sent `{}` every 9,936 to 10,082 ms over three runs. The client sent nothing |
| connection lifetime and maintenance notice | negotiate says `DisconnectTimeout` 30 s and `ConnectionTimeout` 110 s | no forced close in three 100 s runs, no notice seen |
| handshake and operation rate limits | Not publicly specified | not reached, one socket per run |
| public market data authentication | none documented | none, an anonymous negotiate and connect, `IsLogged` pushes `null` |
| message parse and routing | SignalR frame `{"C": cursor, "M": [{"H": hub, "M": method, "A": args}]}` | routes on `M[i].M`, where the pair is the suffix of `UpdateOrderBook_BtcNis` |
| subscribe acknowledgement shape | SignalR init frame | `{"C":"d-…","S":1,"M":[]}` first, then `{ "Response": "started" }` as the HTTP reply to start |
| symbol identifier format | `BtcNis` | identical to CCXT `market.id` and the REST path segment, section 4 |
| number representation | none documented | JSON numbers, some with 29 significant digits such as `50675.675675675675675675675676`, which `JSON.parse` rounds to a double |
| timestamp representation | none documented | no timestamp in a book or ticker push. `C` is a message cursor and not a time |
| size unit | none documented | base currency, BTC for `BtcNis`, matching the REST book to the last digit, section 4 |
| sequence semantics | none documented | none. Every book push is a whole top ten, so no gap can exist |
| idle repeat behaviour | none documented | 54 of 165 `BtcNis` pushes in P2 and 34 of 256 in P4 were identical to the previous push, against 1 or 2 of about 350 on `EthNis` |

## 4. The book channel in detail

### Snapshot on subscribe

Every `UpdateOrderBook_<pair>` push is a snapshot of ten bids and ten asks, and nothing else is ever sent for a book.
The first books arrived 36 to 60 ms after the socket opened, before the start call returned, in P1 and P4.
The last of the four arrived 767 ms and 1,669 ms after the open, which suggests a book is pushed when it changes and not on connect.

### Delta semantics

There are no deltas.
A feed replaces both sides on every push.

### Sequence and gap rule

None exists, and none is needed, since a push never depends on the one before it.
SignalR's `C` cursor orders the messages of one connection but is not a per book sequence.

### Checksum

None.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| hub push | best first, descending, in every one of 1,655 pushes checked in P2 and P4 | best first, ascending, in every one of the same pushes |
| REST `orderbook.json` and `orderbook-top.json` | descending | ascending |

### Level window

The push held ten levels per side in every one of the 1,655 pushes checked in P2 and P4, never fewer.
The engine holds 20 levels per side by default, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) lines 61 and 72 to 73 with `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/ClusterIndexBuilder.ts) line 17, so this feed fills half of the engine's window.
The full REST book goes deeper, 157 to 165 bids and 119 to 129 asks on `BtcNis`, see [`rest.md`](./rest.md) section 5.

### Size unit against CCXT `contractSize`

The unit is the base currency.
Ten times in each of P2 and P4 the latest `BtcNis` push, 2 to 2,402 ms old, was compared with a REST `orderbook-top.json` read, and all ten bids and all ten asks matched in price and size all 20 times.
CCXT reports `contractSize` as `undefined` for these spot markets, see [`rest.md`](./rest.md) section 2, and the engine treats a missing contract size as 1, which is correct for base units.

### One-sided and empty books

No one-sided or empty live book was seen.
The six dead pair codes never appeared in a push.

### Idle repeats

Pushes come several times a second on the busier pairs, and some of them repeat the previous book unchanged.
In P2, 54 of 165 `BtcNis` pushes were identical to the previous push after parsing, and 34 of 256 in P4, while `LtcNis` and `UsdcNis` had none in either run.
The touch of `BtcNis` changed 0 times in 212 pushes in P1, 3 times in 165 pushes in P2 and 42 times in 256 pushes in P4.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| negotiate with hub `nopehub` | HTTP 500, HTML `500 - Internal server error.`, P3 and P5 |
| connect with a made up `connectionToken` | HTTP 400, body `Bad Request`, P3 and P5 |
| a pair that is not live | never pushed, nothing to ask for |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | negotiate reply `KeepAliveTimeout` 20 | the server sent `{}` every 9,936 to 10,082 ms, 10 or 11 keepalives per 100 s in P1, P2 and P4. The client sent nothing |
| silence the server tolerates | negotiate reply `DisconnectTimeout` 30 | a client that never sent a frame kept its socket for the full 100 s in all three runs |
| forced disconnect | Not publicly specified | none in three 100 s runs, and the client closed with 1000 |
| maintenance notice | Not publicly specified | none seen, the FAQ says trading is 24/7 apart from occasional maintenance |
| compression | Not publicly specified | offered permessage-deflate twice, and the upgrade reply carried no `sec-websocket-extensions` header either time, so the server does not negotiate it, P3 and P5 |
| handshake | SignalR negotiate, connect, start | negotiate 427 to 800 ms, socket open 370 to 821 ms, from the Canadian VPN exit |
| subscription limits | none | no subscription exists |
| throughput | | 782 to 887 frames and 826 to 971 KB per 100 s, about 8 to 9 frames and 8 to 10 KB per second for the whole venue |
| access from this host | | negotiate 200, upgrade 101, no refusal, through the Canadian VPN exit that Cloudflare places at `loc=CA`, `colo=SEA` |

## 6. Captured frames

Trimmed, from P1 on 2026-09-23 UTC.
P4 captured the same shapes.
Level arrays are cut to the levels the caption names, and the connection token and id are removed.

Negotiate reply.

```json
{"Url":"/signalr","ConnectionToken":"<128 chars>","ConnectionId":"<trimmed>","KeepAliveTimeout":20.0,"DisconnectTimeout":30.0,"ConnectionTimeout":110.0,"TryWebSockets":true,"ProtocolVersion":"1.5","TransportConnectTimeout":5.0,"LongPollDelay":0.0}
```

Init frame, the first frame on the socket.

```json
{"C":"d-3C9B641A-B,F4928|ECX,0|ECY,1","S":1,"M":[]}
```

Anonymous session marker.

```json
{"C":"d-3C9B641A-B,F492B|ECX,1|ECY,1","M":[{"H":"TradeHub","M":"IsLogged","A":[null]}]}
```

Book push, first three levels per side kept.

```json
{"C":"d-3C9B641A-B,F492E|ECX,2|ECY,1","M":[{"H":"TradeHub","M":"UpdateOrderBook_BtcNis","A":[{"Asks":[{"Price":259999.0,"Amount":0.01923084},{"Price":260111.1,"Amount":0.50000000},{"Price":261687.27,"Amount":0.6538363452}],"Bids":[{"Price":258073.99,"Amount":0.0635377640154799133830183159},{"Price":258000.0,"Amount":0.02953488},{"Price":257000.0,"Amount":0.05237781}]}]}]}
```

Ticker bundled with the book of the same pair, book cut to one level per side.

```json
{"C":"d-3C9B641A-B,F492A|ECX,0|ECY,1","M":[{"H":"TradeHub","M":"UpdateAllTicker","A":[{"EthNis":{"h":8100.25,"l":8352.34,"ll":8256.96,"a":70.66311259,"av":8247.61040066116341362294896,"c":1.1512952377685600111723904800,"up":true}}]},{"H":"TradeHub","M":"UpdateOrderBook_EthNis","A":[{"Asks":[{"Price":8352.34,"Amount":13.1330735694}],"Bids":[{"Price":8100.25,"Amount":5.89695684299303}]}]}]}
```

Keepalive from the server.

```json
{}
```

Errors are HTTP replies, not frames: a made up token gets 400 `Bad Request` on the upgrade, and an unknown hub gets 500 on negotiate.

## 7. Private channels

The site script also registers `UpdateMyWallet`, `UpdateOrder`, `DeleteOrder`, `AlertMessage`, `GoToLogin` and `KycPass` on the same hub, which a logged in browser session receives.
The API page documents no private socket and no API key login for one, S1.
Order entry is REST, with HMAC-SHA512 signed calls such as `Order/AddOrder`, S1 and CCXT at `server/node_modules/ccxt/js/src/bit2c.js` lines 140 to 164, with `Order/AddOrder` at line 145.
A FIX API is linked from S1 behind a login.

## 8. Recommended feed shape

No feed is recommended for the engine.
Bit2c has no perpetual, its markets are quoted in NIS outside the engine's settlement family, and its only push feed is an undocumented site interface that caps the book at ten levels.

If a later spot stage wanted it anyway, this is the shape the probe supports.

| item | recommendation | reason |
|---|---|---|
| URL plan | one connection for the venue, negotiate then connect then start, with a fresh negotiate on every reconnect | the site's client negotiates for each connection, and one socket carries all pairs |
| engine fit | override `openConnection`, since [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 opens `plan.url` as a fixed string | the socket URL needs the token from negotiate |
| subscribe frames | none, `getSubscribeFrames` returns an empty list | the hub pushes every pair |
| keepalive | none sent | the server sends `{}` every 10 s and never asked for a client frame in 100 s |
| `maxSilenceMs` | 30,000 | three missed server keepalives, matching `DisconnectTimeout` 30 |
| routing | `M[i].M` starting with `UpdateOrderBook_`, the rest of the name is the `rawMarketId` | method names carry the pair |
| book | `resetBook` with all ten levels on every push, then `publish` | every push is a whole top ten |
| resync | none needed for gaps, reconnect on close | there is no sequence to break |
| sizes | `Number()` of `Amount`, in base units | matches the REST book |
| receive time | stamp on arrival | no timestamp is sent |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bit2C API documentation | https://bit2c.co.il/home/api | 2026-09-22 | Bit2c, Israel | no socket documented, REST calls, FIX link, private calls, sections 1 and 7 |
| S2 | Bit2C SignalR hub proxy | https://bit2c.co.il/signalr/hubs | 2026-09-22 | Bit2c, Israel | the hub name `tradeHub` with no server methods, section 1 |
| S3 | Bit2C site script bundle `Bit2c-site.js` | `https://bit2c.co.il/Scripts/Bit2c-site?v=IJ5ukOQl0Lv-dM8ofAU-TlRpOpKVlzFGoHdutrNLVXs1` | 2026-09-22 | Bit2c, Israel | client method names, section 2 and 7 |
| S4 | Bit2C FAQ | https://bit2c.co.il/home/faq | 2026-09-22 | Bit2c, Israel | 24/7 trading and maintenance, section 5 |
| S5 | CCXT 4.5.68 `bit2c.js` | `server/node_modules/ccxt/js/src/bit2c.js` | 2026-09-22 | CCXT | `pro: false`, `has.ws` false, private calls, sections 1 and 7 |
| P1 | `ws-probe.mjs hub`, first run at 04:49 UTC, before the level comparison was fixed | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2c/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs hub`, second run with the level comparison at 04:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2c/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 2 to 5 |
| P3 | `ws-probe.mjs deflate` and `bogus` at 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2c/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 3 to 5 |
| P4 | `ws-probe.mjs hub`, second pass at 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2c/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 5, the second readings |
| P5 | `ws-probe.mjs bogus` and `deflate`, second pass at 05:05 and 05:07 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2c/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 3 to 5 |
