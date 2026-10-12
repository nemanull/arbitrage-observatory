# Revolut X WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Vancouver, Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
Revolut X publishes no WebSocket API, public or private.
The researched product is spot, since the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
This file records how the absence was established and what the handshakes on the API host returned.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/revolut-x/ws-probe.py).

## 1. Endpoints

None published.
The API reference, S1, is REST only, and its text has no occurrence of "websocket" or "wss://", `ws-probe.py` section docs.
Its only occurrence of "stream" is the phrase "streamline your trading experience".
Revolut's own LLM reference for the API, S2, describes "16 REST API endpoints" and has no occurrence of either word.
CCXT's comparison page for Revolut X, S3, says "Revolut X publishes no streaming API", and CCXT master has no `pro/revolutx.ts`, S4.

One opening handshake was sent to each of seven guessed URLs and closed at once, with no subscription, `ws-probe.py` section handshake.

| URL | result from this host |
|---|---|
| `wss://revx.revolut.com/ws` | HTTP 403 with a short HTML body "403 Forbidden" |
| `wss://revx.revolut.com/stream` | HTTP 403, the same body |
| `wss://revx.revolut.com/api/ws` | HTTP 404 "WebSocket handler not found", from a Jetty server behind `Via: 1.1 google` |
| `wss://revx.revolut.com/api/1.0/ws` | HTTP 404, the same body |
| `wss://revx.revolut.com/api/2.0/ws` | HTTP 404, the same body |
| `wss://revx.revolut.com/api/1.0/public/ws` | HTTP 404, the same body |
| `wss://exchange.revolut.com/ws` | HTTP 403 with `Cf-Mitigated: challenge` from Cloudflare |

The Jetty reply shows that the API server understands an upgrade request but has no handler at those paths.
The web app at `exchange.revolut.com` may use a socket of its own, but its pages answer this host with a Cloudflare challenge, so its bundle could not be read, see [`fees.md`](./fees.md) section 1.
No further paths were guessed.

## 2. Channel matrix for public market data

| data | WebSocket | REST stand-in |
|---|---|---|
| order book | Not offered | `GET /api/2.0/public/order-book/{symbol}`, 1 to 192 levels, see [`rest.md`](./rest.md) section 5 |
| best bid and ask | Not offered | `GET /api/1.0/public/tickers` |
| trades | Not offered | `GET /api/1.0/public/trades/all` |
| ticker | Not offered | `GET /api/1.0/public/tickers` |
| index | Not offered | the `index_price` field of the tickers call, see [`rest.md`](./rest.md) section 3 |
| mark and funding | Not offered, no perpetuals | none |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
With no socket, every axis is Not offered, and the probed column records the handshake result.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not offered | 403 or 404 on every guessed URL |
| subscribe frame shape | Not offered | no socket opened |
| unknown symbol expectation | Not offered | no socket opened |
| chunk unit and budget | Not offered | no socket opened |
| keepalive mechanism | Not offered | no socket opened |
| connection lifetime and maintenance notice | Not offered | no socket opened |
| handshake and operation rate limits | Not offered | no socket opened |
| public market data authentication | Not offered | no socket opened |
| message parse and routing | Not offered | no socket opened |
| subscribe acknowledgement shape | Not offered | no socket opened |
| symbol identifier format | Not offered | no socket opened |
| number representation | Not offered | no socket opened |
| timestamp representation | Not offered | no socket opened |
| size unit | Not offered | no socket opened |
| sequence semantics | Not offered | no socket opened |
| idle repeat behaviour | Not offered | no socket opened |

## 4. The book channel in detail

Not offered.
The REST book is a full snapshot on every call, with no sequence number, no update id and no checksum, see [`rest.md`](./rest.md) section 5.
A feed built on it can only replace the whole book on each poll and cannot detect a missed change.

## 5. Session

Not offered.

## 6. Captured frames

No frame was captured.
The two kinds of refusal, trimmed from `ws-probe.py` section handshake, are below.

```text
wss://revx.revolut.com/api/1.0/ws  HTTP 404  Content-Type: text/html;charset=iso-8859-1  Via: 1.1 google
  <title>Error 404 WebSocket handler not found</title>
wss://revx.revolut.com/ws  HTTP 403  Content-Type: text/html; charset=UTF-8
  <title>403</title>403 Forbidden
```

## 7. Private channels

Not offered.
Private data comes from signed REST calls with Ed25519 keys, S1, S2.

## 8. Recommended feed shape

None.
A feed for this venue would be a REST poller of `GET /api/2.0/public/order-book/{symbol}` per symbol and per region.
The published limit is one request per second, see [`rest.md`](./rest.md) section 6, so one poller covers about one symbol per second.
That is too slow for the 455 pairs, and the engine's book feed expects a socket.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Revolut X Crypto Exchange REST API reference, https://developer.revolut.com/docs/api/revolut-x-crypto-exchange | 2026-10-09 |
| S2 | Revolut X REST API reference for LLMs, official repository, https://github.com/revolut-engineering/revolut-x-api/blob/master/revolut-x-api-for-llm.md | 2026-10-09 |
| S3 | CCXT comparison page, https://github.com/ccxt/ccxt/blob/master/wiki/comparisons/ccxt-vs-revolutx-api.md | 2026-10-09 |
| S4 | CCXT master at `f0aca06eb748`, `ts/src/revolutx.ts` present and `ts/src/pro/revolutx.ts` absent, https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/revolut-x/ws-probe.py), seven handshakes and no open socket, run twice | 2026-10-09 |
