# Blynex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:50 to 04:10 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers Blynex's public WebSocket market data for its spot market, because Blynex lists no order book perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Every number comes from [`ws-probe.py`](../../../scripts/probes/venues/blynex/ws-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py) or a source ledger row.
All traffic left through the Canadian exit, and every host answered from Cloudflare.

The short answer is that no public spot book channel was found.
Blynex documents no WebSocket at all, S1.
The spot trading page, which is where a spot socket client would live, is behind a Cloudflare JavaScript challenge from this exit, and it was not bypassed.
The only socket found is the futures web app's Socket.IO server, and it carries one dealer price per instrument and no book.

## 1. Endpoints

| URL | what it is | result from this exit | evidence |
|---|---|---|---|
| `wss://futures.blynex.com/socket.io/?token=&EIO=4&transport=websocket` | the futures web app's Socket.IO v4 server, named as `wss://futures.blynex.com` in its bundle, which connects with `transports:["websocket"]` and an empty `token` when logged out, P2 section `bundle` | HTTP 101 in 520 to 621 ms, no `Sec-WebSocket-Extensions` | S2, P1 part A |
| `https://futures.blynex.com/socket.io/?EIO=4&transport=polling` | the long polling transport of the same server | HTTP 403 from nginx, so only the WebSocket transport is served | P2 section `hosts` |
| spot socket | not documented and not found | the spot trading page `https://blynex.com/spot/BTC_USDT` answered 403 with `cf-mitigated: challenge` | P2 section `hosts` |
| guessed spot URLs | `wss://api.blynex.com/` answered 200 with the API docs HTML, so no upgrade. `wss://api.blynex.com/ws` answered 404. `wss://blynex.com/socket.io/` with EIO 3 or 4 answered 200 with an empty body, so no upgrade. `wss://blynex.com/ws` redirected to `https://blynex.com/ws/`. `wss://futures.blynex.com/ws` answered 404 | no WebSocket | P1 part D |

The Android app at `https://blynex.com/APK/xHCGuAqIMbnS8h87oDgy.apk`, 7,956,322 bytes, was read as a zip and not run, P2 section `app`.
It is a WebView wrapper whose only Blynex URL is `https://blynex.com`, so it names no socket either.
DNS has no `ws`, `wss`, `stream`, `socket`, `spot`, `trade` or `exchange` subdomain, P2 section `hosts`.
The Wayback Machine answered 429 to every request, P2 section `app`, so no archived copy of the spot trading page could be read.

## 2. Channel matrix for public market data

| channel | spot | futures Socket.IO | evidence |
|---|---|---|---|
| order book at any depth | not found | none. Four guessed book events, `subscribe`, `orderbook`, `depth` and `subscribe_orderbook` with `BTCUSDT`, got no reply in 10 s. The bundle chunks contain no `orderbook`, `order_book`, `bids` or `asks` string, and `depth` appears only in library code | P1 part C, P2 section `bundle` |
| best bid and ask | not found | none | P1 part A |
| trades | not found | none | P1 part A |
| last price | not found | `BROADCAST_LAST_PRICE`, one number for each of the 20 instruments in every frame | P1 part A |
| 24 hour statistics | not found | `24_MARKET`, high, low and volume per instrument | P1 part A |
| mark, index or funding | not offered | not offered. The product charges no funding, [`fees.md`](./fees.md) section 6 | S3 |
| private events | not probed | `POSITION_CREATED`, `POSITION_UPDATE`, `POSITION_AMOUNT_UPDATE`, `POSITIONS_CLOSE`, `ALL_POSITIONS_CLOSE`, `UPDATE_BALANCE`, `UPDATE_CONFIGS` and `NOTIFICATION_MESSAGE` handlers in the bundle | S2 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
No spot socket was found, so the probed column describes the futures price socket, the only one Blynex serves.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none documented | one futures URL for all 20 instruments. No spot URL found |
| subscribe frame shape | none documented. The bundle emits `subscribe_public` on connect, S2 | `40`, then `42["subscribe_public"]`, with no symbol. It subscribes to every instrument at once |
| unknown symbol expectation | Not publicly specified | not applicable, since the subscribe takes no symbol. Guessed events with `BTCUSDT` got no reply and no error |
| chunk unit and budget | Not publicly specified | one socket carries every instrument |
| keepalive mechanism | Engine.IO 4: the server sends `2` and the client answers `3` | `pingInterval` 25000 and `pingTimeout` 20000 in the open packet, and two server pings were answered in 60 s |
| connection lifetime and maintenance notice | Not publicly specified | no close in 60 s, and no notice event |
| handshake and operation rate limits | Not publicly specified | three sockets opened one after another in each run with no refusal |
| public market data authentication | none | none. The `token` query is empty when logged out and the public events still arrive |
| message parse and routing | Socket.IO event packets | strip `42`, parse JSON, route on element 0 |
| subscribe acknowledgement shape | Not publicly specified | none. The first `BROADCAST_LAST_PRICE` arrived 310 to 809 ms after the subscribe |
| symbol identifier format | Not publicly specified | `BTCUSDT`, no separator, the same as the futures pair list. The spot API spells pairs `BTC_USDT` |
| number representation | Not publicly specified | JSON numbers, for example `"BTCUSDT":82596.84` |
| timestamp representation | Not publicly specified | none in any frame |
| size unit | not applicable | no sizes at all |
| sequence semantics | none | no sequence or update id |
| idle repeat behaviour | Not publicly specified | every second the whole price map is resent, changed or not. TONUSDT and XMRUSDT did not change in 60 frames in either run, and GBPUSDT or AUDUSDT did not change in one |

## 4. The book channel in detail

No book channel exists on any socket found.

### Spot

The spot market has a REST book, [`rest.md`](./rest.md) section 5, but no documented or discoverable socket.
The documented API is the CoinMarketCap and CoinGecko aggregator format, which defines REST calls only, S1.
Its `/v1/info` reply lists the capabilities `markets`, `trades` and `ordersSnapshot` as true and `candles` and `ticker` as false, and names no stream.

### Futures

The futures price stream is not a book.
Each `BROADCAST_LAST_PRICE` frame is a map of 20 instruments to one price each, 417 bytes, about once a second: over 60 frames in each of two runs the median gap was 1,000 ms, the minimum 258 to 865 ms and the maximum 1,136 to 1,750 ms, P1 part A.
BTCUSDT changed on 19 to 27 of 59 frame pairs but took only 7 to 13 distinct values, so the price moves back and forth between a few values.
`24_MARKET` arrives at a median of every 3,000 ms, about 1,290 bytes, with `high`, `low` and `volume` per instrument.
The last BTCUSDT price read 87 to 122 ppm below OKX's BTC-USDT mid and 97 to 173 ppm above Blynex's own spot `lastPrice`, read moments apart.
A position opens at that price plus a fixed spread per instrument, so there is no level, no size and nothing to cross, [`fees.md`](./fees.md) section 3.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | Engine.IO ping from the server every 25 s, answered with `3`. The server waits 20 s for the answer | P1 part A |
| silence tolerated | not measured beyond 60 s. The price stream never went silent | P1 part A |
| forced disconnects | none in 60 s | P1 part A |
| maintenance notices | none seen, and none documented | P1 |
| compression | permessage-deflate not negotiated, plain JSON text frames | P1 part A |
| handshake | open packet `0{"sid":...,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}`, then `40` answered by `40{"sid":...}` | P1 part A |
| subscription limits | Not publicly specified | |
| no subscribe | a socket that sent `40` and no `subscribe_public` received nothing in 10 s | P1 part B |

## 6. Captured frames

Trimmed from P1 part A.

Engine.IO open, then the Socket.IO connect answer:

```text
0{"sid":"iQr_nD3LMEl81q19AAoN","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"sid":"T6gzLeNMLedn4b_HAAoO"}
```

A price frame, the whole map, trimmed to four of 20 instruments:

```text
42["BROADCAST_LAST_PRICE",{"type":"BROADCAST_LAST_PRICE","payload":{"BTCUSDT":82596.84,"ETHUSDT":2492.023,"EURUSDT":1.12067,"XAUUSDT":4183.6}}]
```

A 24 hour frame, trimmed to one instrument:

```text
42["24_MARKET",{"BTCUSDT":{"high":82767.71,"low":82545.82,"volume":216.83382434}}]
```

A keepalive exchange is the text `2` from the server and `3` from the client.
No error frame was produced by any guessed event.

## 7. Private channels

Names only, from the futures bundle, S2.
The socket URL carries `?token=` with the login token from local storage, and the private events are `POSITION_CREATED`, `POSITION_UPDATE`, `POSITION_AMOUNT_UPDATE`, `POSITIONS_CLOSE`, `ALL_POSITIONS_CLOSE`, `UPDATE_BALANCE`, `UPDATE_CONFIGS` and `NOTIFICATION_MESSAGE`.
Orders go over REST to `https://futures.blynex.com/api-orders`, and positions to `https://futures.blynex.com/api/positions`.
No spot private channel was found.

## 8. Recommended feed shape

No feed is recommended.
The engine's book feed needs a snapshot or a sequence rule on a book of at least 20 levels, as the Gate adapter's `plan`, `subscribe_frames` and `handle` show at [`gate.rs`](../../../server/src/venues/gate.rs) lines 58, 71 and 84.
Blynex offers no socket book for spot, and its futures socket has no book at all.

If a spot leg were ever wanted, the only public book is the REST call `GET https://api.blynex.com/v1/orderbook?market_id=<PAIR>`, polled per pair, [`rest.md`](./rest.md) section 5.
At a warm 205 ms a call and 221 pairs, a full sweep takes about 45 s on one connection, which is far too slow for the engine's freshness rules.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blynex API documentation, apidoc 1.0.0, eleven public GET calls and no WebSocket | https://api.blynex.com/ | 2026-10-09 | Blynex | no documented socket, sections 1 and 4 |
| S2 | Blynex futures web app bundle chunks, Socket.IO client, events and REST bases | https://blynex.com/futures/_next/static/chunks/4f853195a6433d2d.js | 2026-10-09 | Blynex | the socket URL, `subscribe_public`, event names, sections 1, 2 and 7 |
| S3 | "BLYNEX FUTURES Official User Guide & Product Specification, Version 1.2" | https://blynex.com/blynex-hybrid-forex-crypto-future/ | 2026-10-09 | Blynex | no funding, spread model, section 2 |
| P1 | `ws-probe.py`, parts A to D, about 100 socket seconds, two runs | [`ws-probe.py`](../../../scripts/probes/venues/blynex/ws-probe.py) | 2026-10-09 | this host, Canadian exit | every probed row |
| P2 | `rest-probe.py`, sections `hosts`, `bundle` and `app` | [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py) | 2026-10-09 | this host, Canadian exit | the spot page challenge, the polling 403, DNS |
