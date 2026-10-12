# CoinCorner WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:40 to 03:50 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

CoinCorner lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile looks for a spot book channel.
The short answer is that CoinCorner publishes no WebSocket.
No document names one, no public page or script on either host contains a socket URL, and five guessed upgrade URLs were all refused with HTTP 503.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/coincorner/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S7 are those of [`fees.md`](./fees.md) section 10.

## 1. Endpoints

None documented.
The API landing page, S1, describes REST only, and the full documentation it links answers HTTP 500, see [`rest.md`](./rest.md) section 1.

How that was established:

| check | result |
|---|---|
| `https://www.coincorner.com/`, `/buy-bitcoin` and `/Login`, and every first-party script they load | no `ws://`, `wss://`, SignalR, socket.io or `WebSocket` string |
| `https://api.coincorner.com/` and its `/Scripts/site.js` | the same, no socket string |
| `GET https://www.coincorner.com/signalr/negotiate` | HTTP 404 |
| `GET https://api.coincorner.com/signalr/negotiate` | HTTP 404, the IIS "resource ... removed" page |
| upgrade to `wss://api.coincorner.com/`, `/ws` and `/signalr` | HTTP 503 from `server: cloudflare`, body "The service is unavailable." |
| upgrade to `wss://www.coincorner.com/ws` and `/signalr` | the same HTTP 503 |

The logged-in Exchange page, where customers trade, was not opened, because that needs an account.
Its quote may well update live, but nothing public shows how.

## 2. Channel matrix for public market data

| data | channel |
|---|---|
| book at any depth | Not offered |
| best bid and ask | Not offered |
| trades | Not offered |
| ticker | Not offered on a socket, REST only, see [`rest.md`](./rest.md) section 5 |
| mark, index, funding | Not offered, no perpetuals |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Every axis is Not offered, because there is no public socket, see section 1.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not offered | five candidate URLs refused with HTTP 503 |
| subscribe frame shape | Not offered | not reachable |
| unknown symbol expectation | Not offered | not reachable |
| chunk unit and budget | Not offered | not reachable |
| keepalive mechanism | Not offered | not reachable |
| connection lifetime and maintenance notice | Not offered | not reachable |
| handshake and operation rate limits | Not offered | not reachable |
| public market data authentication | Not offered | not reachable |
| message parse and routing | Not offered | not reachable |
| subscribe acknowledgement shape | Not offered | not reachable |
| symbol identifier format | Not offered | not reachable |
| number representation | Not offered | not reachable |
| timestamp representation | Not offered | not reachable |
| size unit | Not offered | not reachable |
| sequence semantics | Not offered | not reachable |
| idle repeat behaviour | Not offered | not reachable |

## 4. The book channel in detail

Not offered.
CoinCorner runs a broker desk that fills at its own quote, see [`fees.md`](./fees.md) section 3, so there is no public order book to stream.
The REST order book path returns placeholder levels, see [`rest.md`](./rest.md) section 5.

## 5. Session

Not applicable, no session could be opened.
The five refused upgrades took no socket time.

## 6. Captured frames

None, because no upgrade succeeded.
The refusal, as `ws-probe.py upgrade` printed it:

```text
wss://api.coincorner.com/ refused: HTTP 503, server cloudflare, body 'The service is unavailable.'
```

## 7. Private channels

None documented.

## 8. Recommended feed shape

None.
CoinCorner has no public socket, no order book and no perpetual, so it has no place in the perpetual engine, and a spot leg would have no book to read either.

## 9. Source ledger

The sources are S1 to S7 of [`fees.md`](./fees.md) section 10.
S1, the landing page of `api.coincorner.com`, is the only API documentation this host could read, and it names no socket.
