# Reku WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:42 to 02:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada, in AS212238 Datacamp Limited.

Reku publishes no WebSocket documentation that this host could read, and no CCXT Pro class covers it, see [`fees.md`](./fees.md) section 8.
The certificate transparency logs name an API documentation host, `api-docs.reku.id`, and the development and staging stream hosts `stream-dev.reku.id`, `stag-stream.reku.id` and `stag-pstream.reku.id`, see [`rest.md`](./rest.md) section 1.
This profile guesses `stream.reku.id` and `pstream.reku.id` as their production names.
Every Reku host, those included, refused this exit with HTTP 403 and Cloudflare error 1005, an ASN ban.
So [`access-probe.py`](../../../scripts/probes/venues/reku/access-probe.py) tried three socket handshakes only to record the refusal, and no frame was exchanged.

## 1. Endpoints

| URL tried | why | result |
|---|---|---|
| `wss://stream.reku.id/` | production name implied by `stream-dev` and `stag-stream` in the certificate logs | 403, `error code: 1005` |
| `wss://pstream.reku.id/` | production name implied by `stag-pstream` in the certificate logs | 403, `error code: 1005` |
| `wss://api.reku.id/` | the API host | 403, `error code: 1005` |

All three names resolve to the same Cloudflare addresses, 104.20.28.118 and 172.66.145.225, which also serve `reku.id` under a wildcard certificate, P1.
The refusal comes from the Cloudflare edge before the request reaches Reku's origin, so these paths say nothing about whether a socket exists there.
The refusals came back in 26 to 209 ms in the first run and 23 to 67 ms in the second.
Whether one socket carries several families is unknown.

## 2. Channel matrix for public market data

No channel could be listed.
No book, best bid and ask, trades, ticker, mark, index or funding channel is documented anywhere this host could read, and no socket opened.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Every row has the same answer, so the table is collapsed into one statement.
Documented value: none, since the documentation host refused this exit.
Probed value: none, since no handshake completed.
That holds for the endpoint split axis, subscribe frame shape, unknown symbol expectation, chunk unit and budget, keepalive mechanism, connection lifetime and maintenance notice, handshake and operation rate limits, public market data authentication, message parse and routing, subscribe acknowledgement shape, symbol identifier format, number representation, timestamp representation, size unit, sequence semantics and idle repeat behaviour.
The one symbol format seen anywhere is the contract name `<BASE>USDT-PERP`, as in `BTCUSDT-PERP`, from Reku's delisting announcements and from CFX, see [`rest.md`](./rest.md) section 2.
Whether the socket uses that name is unknown.

## 4. The book channel in detail

There is no readable book channel to describe.
Snapshot on subscribe, delta semantics, the sequence and its gap rule, checksum, level order, size unit, one-sided and empty books, idle repeats and the reply to an unknown symbol are all unknown.

## 5. Session

Unknown, since no session opened.
The one fact probed is the handshake reply: HTTP 403 from Cloudflare with the body `error code: 1005`.
The same 403 to a browser user agent on HTTPS carries the Cloudflare page "Access denied", which says the owner "has banned the autonomous system number (ASN) your IP address is in (212238)", see [`rest.md`](./rest.md) section 1.

## 6. Captured frames

No frame was captured.
The handshake refusals, as `access-probe.py` printed them in the first run:

```json
{"url": "wss://stream.reku.id/", "result": "refused", "status": 403, "server": "cloudflare", "cf_ray": "a48250c5fb0c2ed2-YVR", "body": "error code: 1005\n", "ms": 209}
```

```json
{"url": "wss://pstream.reku.id/", "result": "refused", "status": 403, "server": "cloudflare", "cf_ray": "a48250c69db46052-YVR", "body": "error code: 1005\n", "ms": 80}
```

```json
{"url": "wss://api.reku.id/", "result": "refused", "status": 403, "server": "cloudflare", "cf_ray": "a48250c6cb0e4675-YVR", "body": "error code: 1005\n", "ms": 26}
```

## 7. Private channels

None documented that this host could read.

## 8. Recommended feed shape

No feed is recommended.
The documentation host and every candidate socket host refuse this exit by ASN, and no book channel is known.
A later run from an exit outside AS212238 should first read `https://api-docs.reku.id/` and check whether it documents public market data for the perpetuals at all, before writing a probe that subscribes to anything.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| P1 | [`access-probe.py`](../../../scripts/probes/venues/reku/access-probe.py), modes `ws`, `hosts` and `ct` | 2026-10-10 UTC | the three refusals, the shared addresses, the host names |
| S14 | crt.sh certificate transparency search `https://crt.sh/?q=%25.reku.id&output=json`, read by [`access-probe.py`](../../../scripts/probes/venues/reku/access-probe.py) | 2026-10-10 UTC | `api-docs`, `stream-dev`, `stag-stream` and `stag-pstream` names |
| S18 | Cloudflare, error 1005, `https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1005/`, linked from the block page | 2026-10-10 UTC | meaning of the refusal |
| S19 | [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md) | 2026-10-09 | the sixteen axes |
