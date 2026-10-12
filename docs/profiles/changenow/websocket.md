# ChangeNOW WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 04:13 to 04:18 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

ChangeNOW lists no perpetuals, so the researched product is its spot conversion service, see [`fees.md`](./fees.md) section 3.
ChangeNOW has no order book, documents no WebSocket, and none was found.
Its only market data is the REST quote described in [`rest.md`](./rest.md).
Every probed fact below comes from [`ws-probe.py`](../../../scripts/probes/venues/changenow/ws-probe.py), which held sockets for a few seconds in total.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| perpetuals | Not offered | not applicable |
| spot | none documented | no `ws://` or `wss://` URL and no use of the word "websocket" in the two Postman documentation collections, S1 |

The front end pages `/exchange`, `/crypto-trading` and `/pro`, and the ten first-party scripts they load from `/dist/`, hold no socket URL, S2.
The only script that uses the word "websocket" is the Sentry error reporting bundle, twice, S2.

Four guessed URLs were each tried with one opening handshake, S2.

| guessed URL | result |
|---|---|
| `wss://api.changenow.io/ws` | HTTP 404 from Cloudflare, body `Not Found` |
| `wss://api.changenow.io/v2/ws` | HTTP 405, body `Method Not Allowed` |
| `wss://notifier.changenow.io/` | HTTP 404, body `{"statusCode":404,"message":"Cannot GET /","error":"Not Found"}` |
| `wss://notifier.changenow.io/socket.io/?EIO=4&transport=websocket` | HTTP 404, the same body naming the path |

The host `notifier.changenow.io` appears in the front end scripts as an HTTPS URL, S2.
No guessed path upgraded to a WebSocket.

## 2. Channel matrix for public market data

None.
No book, best bid and ask, trade, ticker, mark, index or funding channel is documented or was found.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Every row has the same answer, so the table is collapsed into one statement.
Documented value: none, since the venue documents no WebSocket.
Probed value: none, since no handshake upgraded.
That holds for the endpoint split axis, subscribe frame shape, unknown symbol expectation, chunk unit and budget, keepalive mechanism, connection lifetime and maintenance notice, handshake and operation rate limits, public market data authentication, message parse and routing, subscribe acknowledgement shape, symbol identifier format, number representation, timestamp representation, size unit, sequence semantics and idle repeat behaviour.

## 4. The book channel in detail

There is no book channel, and there is no book.
ChangeNOW quotes a conversion amount for a chosen input size, see [`rest.md`](./rest.md) section 5.
A quote carries no levels, sequence, checksum or timestamp.

## 5. Session

Not applicable, since no socket exists.

## 6. Captured frames

No frame was captured.
The handshake refusals in section 1 are the whole capture.

## 7. Private channels

None documented.
Exchange status is read over REST with `GET /v2/exchange/by-id`, S1.

## 8. Recommended feed shape

No feed can be built.
The venue has no perpetuals, no order book and no WebSocket.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | ChangeNOW API documentation, Postman collections `https://documenter.gw.postman.com/api/collections/8180765/SVfTPnM8` ("ChangeNOW", API v1 and v2) and `/8180765/2sBYAvtpun` ("NOW Custody"), linked from `https://changenow.io/api`, read by [`ws-probe.py`](../../../scripts/probes/venues/changenow/ws-probe.py) | 2026-10-10 UTC | no WebSocket documented, status call |
| S2 | `https://changenow.io/exchange`, `/crypto-trading`, `/pro`, their `/dist/*.js` scripts, and the four handshakes, read by [`ws-probe.py`](../../../scripts/probes/venues/changenow/ws-probe.py) | 2026-10-10 UTC | no socket URL in the front end, the handshake refusals |
