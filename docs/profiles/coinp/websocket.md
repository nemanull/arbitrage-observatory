# CoinP WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 02:21 to 02:25 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocated to Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

CoinP publishes no WebSocket documentation that this host could find, and no CCXT Pro class covers it, see [`fees.md`](./fees.md) section 8.
Its site, where any documentation would live, returned Cloudflare 521 on every path, see [`rest.md`](./rest.md) section 1.
So [`ws-probe.py`](../../../scripts/probes/venues/coinp/ws-probe.py) tried seven guessed socket URLs on the venue's three domains.
Every handshake was refused by the Cloudflare edge with HTTP 521 before any frame was exchanged.
No socket was held open, so the whole probe used a few seconds of socket time.

## 1. Endpoints

| URL | source | probed on 2026-10-10 UTC |
|---|---|---|
| `wss://www.coinp.com/ws` | guessed | handshake refused, HTTP 521, `server: cloudflare`, body `error code: 521` |
| `wss://www.coinp.com/websocket` | guessed | the same |
| `wss://api.coinp.com/ws` | guessed | the same |
| `wss://ws.coinp.com/` | guessed | the same |
| `wss://futures.coinp.com/ws` | guessed | the same |
| `wss://www.coinp1000.com/ws` | guessed, on the register domain CoinMarketCap names | the same |
| `wss://www.coinp.io/ws` | guessed | the same |

Every name under `coinp.com` resolves to the same two Cloudflare addresses, a made-up label among them, so the zone has a wildcard record and a resolving name proves nothing, see [`rest.md`](./rest.md) section 1.
A 521 is Cloudflare saying that it could not open a connection to the origin server.
It is not a geoblock, since Cloudflare answers it before the origin sees the request.
The refusals came back in 129 to 220 ms in the first run and 130 to 186 ms in the second.

## 2. Channel matrix for public market data

No channel could be listed.
No book, best bid and ask, trades, ticker, mark, index or funding channel is documented anywhere this host could read, and no socket opened.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Every row has the same answer, so the table is collapsed into one statement.
Documented value: none, since no documentation could be found.
Probed value: none, since no handshake completed.
That holds for the endpoint split axis, subscribe frame shape, unknown symbol expectation, chunk unit and budget, keepalive mechanism, connection lifetime and maintenance notice, handshake and operation rate limits, public market data authentication, message parse and routing, subscribe acknowledgement shape, symbol identifier format, number representation, timestamp representation, size unit, sequence semantics and idle repeat behaviour.

## 4. The book channel in detail

There is no book channel to describe.
Snapshot on subscribe, delta semantics, the sequence and its gap rule, checksum, level order, size unit, one-sided and empty books, idle repeats and the reply to an unknown symbol are all unknown.

## 5. Session

Unknown, since no session opened.
The one fact probed is the handshake reply: an HTTP 521 from Cloudflare with `content-type: text/plain` and the 16-byte body `error code: 521`.

## 6. Captured frames

No frame was captured.
The handshake refusal, as `ws-probe.py` printed it in the first run:

```json
{"url": "wss://www.coinp.com/ws", "result": "handshake refused", "status": 521, "server": "cloudflare", "cf_ray": "a48227066cca7d77-YVR", "body": "error code: 521\n", "ms": 220}
```

## 7. Private channels

None documented that this host could read.

## 8. Recommended feed shape

No feed is recommended.
There is no documented URL, no socket accepted a handshake, and no book channel is known.
A later run should first confirm that `https://www.coinp.com/` serves its site again and then look for API documentation on it, before writing a probe that subscribes to anything.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | [`ws-probe.py`](../../../scripts/probes/venues/coinp/ws-probe.py), seven handshakes | 2026-10-10 UTC | the 521 refusals |
| S2 | [`rest-probe.py`](../../../scripts/probes/venues/coinp/rest-probe.py), DNS and site checks | 2026-10-10 UTC | wildcard DNS, the site being down |
| S3 | [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md) | 2026-10-09 | the sixteen axes |
