# 5DAX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:10 to 05:27 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

5DAX lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/5dax/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S9 are those of [`fees.md`](./fees.md) section 10.
The API document names no socket, S5, and everything here was read from the web app's scripts, S2, and then from the wire.
The short answer is a Socket.IO v2 server with one namespace per symbol that pushes Binance style `depthUpdate` deltas with contiguous `U` and `u` ids.
Those ids line up exactly with the `lastUpdateId` of the site's undocumented REST book, so a feed can build a sequenced book.
But most upgrades to the socket host close at once without a single packet, so a feed must retry its connection several times.

## 1. Endpoints

| endpoint | public market data | probed |
|---|---|---|
| `wss://socket.5dax.com/socket.io/?EIO=3&transport=websocket` | the book, trades, kline and ticker namespaces | HTTP 101 in 678 to 811 ms behind Cloudflare, edge `YVR`, no `sec-websocket-extensions` in the reply |
| `https://socket.5dax.com/socket.io/?EIO=3&transport=polling` | none | HTTP 502 from Cloudflare in every probe run, and the open packet offers `"upgrades":[]`, so the socket is WebSocket only |

The app reads the socket host from `GET https://5dax.com/settings/getSettingByKey/wssUrl`, which answered `https://socket.5dax.com`, S2.
Its bundled client is Socket.IO v2.4.0, which speaks Engine.IO protocol 3, S2.
One socket carries every symbol, because each symbol is a namespace joined over the same connection.
The probe held six namespaces on one socket.

### Most upgrades die at once

Every upgrade returned 101, and then most sockets closed with no close frame and no packet within about a second.

| run | upgrades that sent the open packet | upgrades that closed silently |
|---|---|---|
| first, 05:10 UTC | 4 of 15 | 11 |
| second, 05:17 UTC | 5 of 16 | 11 |
| third, 05:24 UTC | 5 of 19 | 14 |

A socket that did send its open packet stayed up for the whole listen in every run, 120 s in the first and 90 s after.
The likely reading is a pool of origin servers behind Cloudflare in which most members accept the upgrade and then drop it, and the polling 502 points the same way.
The probe retries the open up to eight times, one second apart, and never needed more than five tries.

## 2. Channel matrix for public market data

| data | namespace | documented | probed over 90 s, third run |
|---|---|---|---|
| book deltas | `/<symbol>`, lower case, such as `/btcusdt` | Not publicly specified, read from the app, S2 | 71 deltas on `/btcusdt`, 38 on `/ethusdt`, 3 on `/usdcusdt`, 1 on `/ethbtc` |
| book snapshot | none on the socket | | the app reads `GET https://5dax.com/exchange/depth`, see section 4 |
| best bid and ask | none on a socket | | the REST `GET /api/v1/ticker/bookTicker` has them, see [`rest.md`](./rest.md) section 5 |
| trades | `/<symbol>_aggTrade` | read from the app, S2 | 1 `aggTrade` on `/btcusdt_aggTrade` |
| klines | `/<symbol>_kline_<interval>` | read from the app, S2 | not joined |
| ticker | `/miniTicker` | read from the app, S2 | 12 pushes, each an array of 1 to 45 `24hrMiniTicker` rows for the symbols that changed |
| mark, index, funding | Not offered | | no perpetuals, see [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
No socket is documented, so the documented column is empty except where the app's scripts show intent, S2.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host, S2 | one URL for every symbol, one namespace per symbol |
| subscribe frame shape | `io.connect(url + "/" + symbol)` in the app, S2 | the Socket.IO packet `40/btcusdt,` |
| unknown symbol expectation | Not publicly specified | `44/nopeusdt,"Invalid namespace"`, and the socket stays open |
| chunk unit and budget | Not publicly specified | one namespace per packet, and six namespaces on one socket were all served |
| keepalive mechanism | Engine.IO 3, the client pings | the client sends `2` every 25 s and the server answers `3` in 190 to 287 ms |
| connection lifetime and maintenance notice | Not publicly specified | no close and no notice within 90 s on a pinging socket |
| handshake and operation rate limits | Not publicly specified | none hit, but most upgrades closed silently, see section 1 |
| public market data authentication | none in the app, S2 | none needed |
| message parse and routing | Socket.IO event `message` per namespace, S2 | `42/<namespace>,["message",{...}]`, route by namespace |
| subscribe acknowledgement shape | Not publicly specified | `40/btcusdt,`, the join echoed |
| symbol identifier format | lower case in the namespace and upper case in the payload, S2 | `/btcusdt` with `"s":"BTCUSDT"`, and `/BTCUSDT` is an invalid namespace |
| number representation | Not publicly specified | price as a JSON number, size as a decimal string, or the integer `0` for a removed level |
| timestamp representation | Not publicly specified | `E` in Unix milliseconds |
| size unit | Not publicly specified | units of the base asset, the same as the REST book, see section 4 |
| sequence semantics | the app keeps `lastDepthId` and its loss check is commented out, S2 | `U` and `u` per symbol, contiguous, see section 4 |
| idle repeat behaviour | Not publicly specified | none, a quiet symbol stays silent for a minute or more |

## 4. The book channel in detail

### Snapshot on subscribe

No.
Joining `/btcusdt` brings only the join echo, and then deltas as the book changes.
The app takes its snapshot from `GET https://5dax.com/exchange/depth?symbol=BTCUSDT`, which returns `lastUpdateId` as an integer, S2.

### Delta semantics

Each delta is one object:

| field | meaning |
|---|---|
| `e` | `depthUpdate` |
| `E` | event time, Unix ms |
| `s` | symbol, upper case |
| `U` | first update id in the delta |
| `u` | last update id in the delta |
| `b`, `a` | changed bid and ask levels, `[price, size, []]` |
| `z` | named `canceled` by the app, S2, and `false` in every delta seen |

A level with size `0` removes the price, and any other size replaces it.
The third element of each level was an empty list in every delta seen, and its meaning is Not publicly specified.
Many deltas remove the same price from both sides at once, such as `"b":[[82683.49,0,[]]],"a":[[82683.49,0,[]]]`.
Levels inside one delta are not always sorted: the third run counted 16 sides out of price order across 71 BTCUSDT deltas.

### Sequence and gap rule

`U` and `u` are integers per symbol, and `u - U` ran from 0 to 38, so one delta can carry several updates.
In every consecutive pair of deltas on a symbol, `U` was the previous `u` plus one.
That held for 82 of 82, 55 of 55 and 70 of 70 pairs on BTCUSDT in the three runs, and for 78, 77 and 37 of as many pairs on ETHUSDT, with no gap and no overlap.

The site's REST book shares the counter:

| run | REST `lastUpdateId` before the join | first socket `U` | last socket `u` | REST `lastUpdateId` after the socket closed |
|---|---|---|---|---|
| second, BTCUSDT | 374,896,644 | 374,896,645 | 374,897,025 | 374,897,046 |
| second, ETHUSDT | 369,993,863 | 369,993,881 | 369,994,492 | 369,994,505 |
| third, BTCUSDT | 374,897,364 | 374,897,365 | 374,897,856 | 374,897,856 |
| third, ETHUSDT | 369,994,938 | 369,994,939 | 369,995,100 | 369,995,100 |

So the gap rule is Binance's: drop deltas with `u` at or below the snapshot's `lastUpdateId`, apply from the delta that spans `lastUpdateId + 1`, and resync when a `U` is not the previous `u` plus one.
In the second run 17 ETHUSDT update ids passed between the snapshot and the join, which is why a feed must join first, buffer, and only then fetch the snapshot.
The documented `GET https://api.5dax.com/api/v1/depth` returns a 24 character hex `lastUpdateId` instead, see [`rest.md`](./rest.md) section 5, and cannot be lined up with the socket.

### Checksum

None on the wire.

### Level order on the wire

Not guaranteed inside a delta, see above, so a feed must key levels by price.
The REST snapshots are sorted best first on both sides, see [`rest.md`](./rest.md) section 5.

### Size unit

Sizes are in the base asset.
BTCUSDT sizes such as `"0.00029"` against prices near 82,680 USDT are BTC, and 5DAX has no contracts, so there is no `contractSize` to reconcile.

### One-sided and empty books

Many deltas carry one side only, with the other as `[]`.
Nothing documents how an empty book is sent, and none was seen.

### Idle repeats

None.
Deltas came about once a second on the two busy symbols, with a median gap of 1.05 to 1.12 s on BTCUSDT and ETHUSDT across the runs.
On USDCUSDT and ETHBTC the longest gap per symbol and run was 25.9 to 62.8 s, and a quiet namespace sends nothing at all in between.

### Unknown and closed symbols

| sent | reply |
|---|---|
| `40/nopeusdt,` | `44/nopeusdt,"Invalid namespace"` |
| `40/BTCUSDT,` | `44/BTCUSDT,"Invalid namespace"` |
| `42/nopeusdt,["subscribe",{"symbol":"BTCUSDT"}]` | nothing within 6 s |
| `42["subscribe","btcusdt@depth"]` | nothing within 6 s |
| the text `hello` | the server closed the socket with no close frame |
| `41/nopeusdt,` | nothing |

The server ignores client events, so the namespace join is the only subscription.
A malformed packet costs the whole socket and every namespace on it.

## 5. Session

| item | value |
|---|---|
| open packet | `0{"sid":"...","upgrades":[],"pingInterval":25000,"pingTimeout":5000}`, then `40` for the root namespace |
| keepalive | the client sends `2` every 25 s, and the server answers `3` |
| silence the server tolerates | a socket that never pinged was dropped after 30.2 s in all three runs, with no close frame, which is `pingInterval` plus `pingTimeout` |
| forced disconnects | none on a pinging socket within 90 s |
| maintenance notices | none documented, none seen |
| compression | no `permessage-deflate` offered in the reply |
| handshake and subscription limits | Not publicly specified, see section 1 for the silent closes |

## 6. Captured frames

The open packet and the root namespace join:

```text
0{"sid":"tP5pSOGpZHvrg-H6ABeh","upgrades":[],"pingInterval":25000,"pingTimeout":5000}
40
```

A namespace join, as sent and as echoed:

```text
40/btcusdt,
```

A delta, from the third run:

```text
42/btcusdt,["message",{"E":1791609872716,"e":"depthUpdate","s":"BTCUSDT","z":false,"U":374897370,"u":374897372,"b":[],"a":[[82680.1,"0.00031",[]],[82681.19,"0.00029",[]],[82682,"0.00026",[]]]}]
```

A trade:

```text
42/btcusdt_aggTrade,["message",{"eventTime":1791609909819,"aggTradeId":"6ac9cc3541a54e57d4507d6e","firstTradeId":"6ac9cc3541a54e57d4507d6e","lastTradeId":"6ac9cc3541a54e57d4507d6e","price":82676.23,"qty":"0.00002","symbol":"BTCUSDT","time":1791609909754,"isBuyerMaker":true,"event":"aggTrade"}]
```

A ticker push, trimmed to one row:

```text
42/miniTicker,["message",[{"time":1791609071530,"price":0.001597,"high":0.001615,"open":0.001556,"low":0.001516,"volume":263.8,"quoteVolume":0.4112252,"symbol":"RSRUSDT","event":"24hrMiniTicker"}]]
```

The keepalive is the text packet `2` from the client and `3` from the server.

An error:

```text
44/nopeusdt,"Invalid namespace"
```

## 7. Private channels

The app's `user.stream.js` opens a socket after login and emits `authenticate`, and `userstream.factory.js` opens an account stream on a URL it is given, S2.
Neither was opened.

## 8. Recommended feed shape

None for the engine as it stands.
5DAX has no perpetual and no CCXT class, so it has no place in the perpetual engine.

If a later design adds spot legs, the shape would be:

- one socket to `wss://socket.5dax.com/socket.io/?EIO=3&transport=websocket`, retried until the `0{...}` open packet arrives, with up to ten tries a second apart.
- one `40/<symbol>,` per market, lower case, all 77 on one socket.
- send `2` every 25 s, and set `maxSilenceMs` to about 35,000 for the socket as a whole, since a quiet namespace can be silent for a minute and only the `3` answers prove the socket alive.
- buffer deltas after the join, then read `GET https://5dax.com/exchange/depth?symbol=<SYMBOL>`, and apply as section 4 says.
- resync one symbol when a `U` is not the previous `u` plus one, and remember that the site's REST host allows 10 calls per path per minute, see [`rest.md`](./rest.md) section 6.
- never send anything but Socket.IO packets, because a malformed packet drops the socket.

## 9. Source ledger

The sources are S1 to S9 of [`fees.md`](./fees.md) section 10.
S2, the web app's scripts, holds everything this profile knows about the socket before the wire: the host setting call, the Socket.IO v2.4.0 client in `assets/stylesheet/js/socket.io.js`, and the stream factories under `public/exchange/factory/` that name the namespaces and parse `depthUpdate`.
S5, the API document, mentions no socket.
