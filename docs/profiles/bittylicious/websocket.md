# Bittylicious WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:40 to 04:56 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Bittylicious lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile looks for a spot book channel.
The short answer is that Bittylicious publishes no WebSocket.
No readable document names one, the home page and its script bundle contain no socket string, the usual socket host names do not resolve, and guessed upgrade URLs were refused.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/bittylicious/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S8 are those of [`fees.md`](./fees.md) section 10.

## 1. Endpoints

None documented.
The help wiki that would hold any API documentation answers HTTP 500, and `https://bittylicious.com/api/` answers HTTP 403, see [`rest.md`](./rest.md) section 1.

How that was established:

| check | result |
|---|---|
| `https://bittylicious.com/`, its inline scripts and its two external scripts, `/dist/js/bundle-user.js` of about 424,000 characters and the Cloudflare analytics beacon | no `WebSocket`, `wss://`, `ws://`, `socket.io`, `Pusher` or `EventSource` string |
| `/api/v1/` paths named in the bundle | `check`, `companyLookup`, `quote`, `quoteFiat`, `stateList`, `uploadProvider`, `uploadType` and a generic form poster on `/api/v1/`, all plain REST |
| the bundle's three `setInterval` timers | one of them POSTs `/api/v1/check/<id>` every 10 s and reloads the page when the reply's `updateID` changes, so the site polls REST instead of streaming |
| `ws.bittylicious.com`, `api.bittylicious.com`, `stream.bittylicious.com`, `socket.bittylicious.com` | none resolves |
| upgrade to `wss://bittylicious.com/ws`, `wss://bittylicious.com/socket.io/?EIO=4&transport=websocket` and `wss://bittylicious.com/api/v1/ws` | each refused, either with HTTP 502 from `server: cloudflare` and body "502 Bad Gateway", or with no valid HTTP response at all. Which URL got which answer changed between the two runs. |

The logged-in trade pages were not opened, because that needs an account.
The 10 s `check` poll suggests they do not stream either.

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
| endpoint split axis | Not offered | three candidate URLs refused, four candidate hosts unresolved |
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
Bittylicious matches each customer to one broker's all-in price, see [`fees.md`](./fees.md) section 2, so there is no public order book to stream.
The nearest REST data is a per amount quote, see [`rest.md`](./rest.md) section 5.

## 5. Session

Not applicable, no session could be opened.
The refused upgrades took no socket time.

## 6. Captured frames

None, because no upgrade succeeded.
The refusals, as `ws-probe.py connect` printed them in the first run:

```text
wss://bittylicious.com/ws: InvalidMessage: did not receive a valid HTTP response
wss://bittylicious.com/socket.io/?EIO=4&transport=websocket: refused with HTTP 502, server cloudflare, body b'<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad'
wss://ws.bittylicious.com/: gaierror: [Errno -5] No address associated with hostname
```

## 7. Private channels

None documented.

## 8. Recommended feed shape

None.
Bittylicious has no public socket, no order book and no perpetual, so it has no place in the perpetual engine, and a spot leg would have no book to read either.

## 9. Source ledger

The sources are S1 to S8 of [`fees.md`](./fees.md) section 10.
S1, the home page, and S8, its script bundle, are what the socket search read.
No API documentation could be read, see S3.
