# NexDAX WebSocket Profile

**Status:** Done, with no book channel found, because the socket server is undocumented and the web app that would name its events is geoblocked from this host.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:53 to 04:12 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

NexDAX lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers its spot market.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/nexdax/ws-probe.py), which held sockets for about 100 s per run.
Sockets were held for about 5 minutes in total across exploration, the first run and the second pass.

## 1. Endpoints

- NexDAX publishes no socket documentation.
  `docs.nexdax.com` documents the NexDAX Chain, an EVM chain, and has no exchange API page, S1.
  The `nexdax` GitHub organisation holds forks of wallets, a block explorer and `go-ethereum`, last pushed in 2021, and no exchange API, S2.
- `socket.nexdax.com` runs a Socket.IO server behind Cloudflare, in `ws-probe.py`.
  `wss://socket.nexdax.com/socket.io/?EIO=4&transport=websocket` and the same URL with `EIO=3` both open and send an Engine.IO open frame.
  The HTTP polling transport answers `400` with `{"code":0,"message":"Transport unknown"}` for both versions, so the server accepts only the WebSocket transport.
- Plain WebSocket paths fail.
  `wss://api.nexdax.com/ws`, `wss://socket.nexdax.com/ws` and `wss://api.nexdax.com/stream` are each rejected with HTTP `404`.
- The subdomains `stream`, `ws` and `wss` do not resolve, checked by hand with `getent hosts`.
- The web app at `nexdax.com` would show which events it emits, but every path there answers `302` to `forbidden.html` from this exit, see [`fees.md`](./fees.md) section 1.

## 2. Channel matrix for public market data

| channel | found |
|---|---|
| order book | no |
| best bid and ask | no |
| trades | no |
| ticker | no |
| mark, index, funding | Not offered, spot only |

No event name that yields market data was found.
203 guessed subscribe events, 29 event names times 7 argument shapes, got no acknowledgement and no frame in 12 s, in `ws-probe.py` section C.
The names include `subscribe`, `join`, `joinRoom`, `depth`, `orderbook`, `ticker` and `SUBSCRIBE`, and the arguments include `BTCUSDT`, `BTC_USDT`, `btcusdt@depth`, `{"symbol":"BTCUSDT"}` and a Binance style `{"method":"SUBSCRIBE","params":["btcusdt@depth"],"id":1}`.
A socket that subscribes to nothing also receives nothing, 0 data frames in 70 s, in section E.
Not publicly specified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none | one Socket.IO server, `socket.nexdax.com` |
| subscribe frame shape | none | unknown, no guessed Socket.IO event delivered anything |
| unknown symbol expectation | none | unknown, because no known symbol delivered either |
| chunk unit and budget | none | unknown |
| keepalive mechanism | none | Engine.IO client ping, the text `2`, answered by `3` in 333 to 349 ms, 6 of 6 over two runs |
| connection lifetime and maintenance notice | none | a socket that never pings is dropped at 31.6 s without a close frame in both runs, which matches `pingInterval` 25000 plus `pingTimeout` 5000 from the open frame, and a socket that pings every 20 s stayed open for 70 s |
| handshake and operation rate limits | none | 2 sockets at once and 203 event frames in one burst, no refusal |
| public market data authentication | none | none needed to connect |
| message parse and routing | none | Engine.IO text packets, a one digit type prefix then JSON |
| subscribe acknowledgement shape | none | none received, 0 of 203 ack ids answered |
| symbol identifier format | none | unknown on the socket, the REST API uses `BTCUSDT` |
| number representation | none | unknown |
| timestamp representation | none | unknown |
| size unit | none | unknown, the REST book is in base currency, see [`rest.md`](./rest.md) section 5 |
| sequence semantics | none | unknown, and the REST `lastUpdateId` is not a sequence, see [`rest.md`](./rest.md) section 5 |
| idle repeat behaviour | none | unknown |

## 4. The book channel in detail

No book channel was found, so snapshot, delta semantics, sequence, checksum, level order, size unit, empty books, idle repeats and unknown symbol answers could not be observed.
The REST book is described in [`rest.md`](./rest.md) section 5.

## 5. Session

- The open frame is `0{"sid":"...","upgrades":[],"pingInterval":25000,"pingTimeout":5000}` for both `EIO=4` and `EIO=3`, in `ws-probe.py` section A.
- The namespace connect reply is the bare `40`, with no `sid` payload, for both versions.
  A Socket.IO server of version 3 or later answers `40{"sid":...}` to an `EIO=4` client, so the bare `40` suggests a version 2 server that also accepts `EIO=4` handshakes.
  The client then pings and the server answers, as section 3 shows.
- Other namespaces are refused with `44/market,"Invalid namespace"`, and the same for `/exchange` and `/public`, in section B.
  14 more namespaces such as `/ticker`, `/depth` and `/spot` were refused the same way during exploration, outside the probe.
- Connect time was 378 to 421 ms over two runs.
- No maintenance notice, compression offer or forced disconnect other than the ping timeout was seen.

## 6. Captured frames

Open frame and namespace connect, `EIO=4`, section A:

```text
0{"sid":"hSZNa98OD0BDJ5v0CaTa","upgrades":[],"pingInterval":25000,"pingTimeout":5000}
40
```

Last guessed subscribe frame sent, which like the other 202 got no answer, section C:

```text
42203["marketData", {"method": "SUBSCRIBE", "params": ["btcusdt@depth"], "id": 1}]
```

Keepalive, section D:

```text
> 2
< 3
```

Refused namespace, section B:

```text
44/market,"Invalid namespace"
```

No subscribe acknowledgement, snapshot or delta was captured.

## 7. Private channels

None found.
Private events would need an account, and the site that issues one is geoblocked from this host.

## 8. Recommended feed shape

None can be recommended.
The socket server is reachable and its keepalive is known, an Engine.IO `2` every 20 s with a `maxSilenceMs` above 30 s, but no event that delivers a book is known.
A future spot feed would first need the event names from NexDAX's web app or from the venue.
Until then the REST book in [`rest.md`](./rest.md) section 5 is the only book source, and it is not a usable sequence for a feed.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | NexDAX Chain Docs, `https://docs.nexdax.com/` | 2026-10-10 UTC, mkdocs site with chain, validator and NRC20 pages only |
| S2 | GitHub organisation `nexdax`, `https://api.github.com/users/nexdax/repos` | 2026-10-10 UTC, 8 repositories, last pushed 2021-08-16 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/nexdax/ws-probe.py) | 2026-10-10 UTC |
