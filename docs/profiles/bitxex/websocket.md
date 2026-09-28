# BitxEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-24.

**Probed:** 2026-09-24, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

BitxEX publishes no WebSocket documentation that this research could find.
The endpoint and the frame shapes below were read from the futures web bundle `https://bitxex.io/static/js/main.afe60ef9.chunk.js` (webpack name `futures-web`), B1, and tried with [`ws-probe.mjs`](../../../scripts/probes/venues/bitxex/ws-probe.mjs).
No book frame was received in any run, so most of this profile is Not verified.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals, public market data | `wss://bitxex.io/ws/market`, built as origin + `/ws` + `/market` in B1 | 8 attempts: 3 opened in 5.2 to 7.4 s, 3 hit the 40 s handshake timeout, 2 had not opened when the 25 s and 40 s run windows ended |
| private | `wss://bitxex.io/ws/user`, B1 | not probed |
| spot | `wss://bitxex.io/ws/socket`, B1 | not probed |

The upgrade answered through Cloudflare (`server: cloudflare`, `cf-ray` suffix `YVR`), with no geoblock.

## 2. Channel matrix for public market data

The web client sends `{"req": "<name>", ...data}`, B1.

| request | payload | meaning, from B1 | probed |
|---|---|---|---|
| `sub_symbol` | `{"symbol": "btc_usdt"}` | the one symbol the page shows, book and trades | no frame in 42 s on the one socket that opened |
| `sub_tickers` | none | every symbol's ticker | no frame |
| `sub_mark_prices` | none | every symbol's mark price | no frame |
| `sub_kline` | kline parameters | candles | not probed |
| XT style `{"method": "SUBSCRIBE", "params": ["depth@btc_usdt,50", "depth_update@btc_usdt,100ms", …]}` | 14 streams | the XT.com futures format this API resembles | no acknowledgement and no frame in 65 s |

`sub_symbol` takes one symbol, and the client unsubscribes before it subscribes another, so the web protocol looks like one book per socket.
No depth level or update speed is visible in B1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified. B1 builds one `/ws/market` URL | Not verified |
| subscribe frame shape | Not publicly specified. B1 sends `{"req": "sub_symbol", "symbol": s}` | no reply to it, W3 |
| unknown symbol expectation | Not publicly specified | Not verified |
| chunk unit and budget | Not publicly specified | Not verified |
| keepalive mechanism | Not publicly specified. B1 answers any text frame containing `ping` with a pong | client text `ping` got text `pong` twice in 65 s, W2 |
| connection lifetime and maintenance notice | Not publicly specified | one socket closed 1006 at 47.1 s although the client sent `ping` every 20 s, W3 |
| handshake and operation rate limits | Not publicly specified | opens took 5.2 to 7.4 s or timed out at 40 s, section 1 |
| public market data authentication | none in B1 for `/ws/market` | none asked |
| message parse and routing | B1: a text frame is JSON routed by `channel`, a binary frame is inflated with pako and routed by `type` | Not verified, no data frame arrived |
| subscribe acknowledgement shape | Not publicly specified | none received |
| symbol identifier format | lower case `btc_usdt`, the catalog `symbol` | Not verified on the socket |
| number representation | Not publicly specified | Not verified |
| timestamp representation | Not publicly specified | Not verified |
| size unit | Not publicly specified | Not verified. The REST book uses whole contracts of `contractSize`, see [`rest.md`](./rest.md) section 5 |
| sequence semantics | Not publicly specified | Not verified. The REST book's `u` exceeds 2^53, see [`rest.md`](./rest.md) section 5 |
| idle repeat behaviour | Not publicly specified | Not verified |

## 4. The book channel in detail

No book frame was captured, so snapshot on subscribe, delta semantics, sequence and gap rule, checksum, level order, size unit on the socket, one-sided books, idle repeats and unknown symbols are all Not verified.

Two facts from B1 bear on the engine.
A binary frame carries compressed JSON that the client inflates itself, which is compression inside the frame, and the engine's feed has no such step.
The web protocol subscribes one symbol per socket with `sub_symbol`, which would mean one socket per market for 252 perpetuals.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | text `ping` answered by text `pong`, W2 |
| silence the server tolerates | Not publicly specified | a socket that sent `ping` every 20 s and received nothing closed 1006 at 47.1 s, W3. A socket that sent 14 XT style streams and `ping` twice stayed open 65 s, W2. The planned `silence` mode was not run |
| forced disconnect | Not publicly specified | the first run's frames `SUBSCRIBE`, an unknown symbol, an unsupported level and the text `not json` got the text `Invalid parameter` and a close 1005 after 643 ms, W1 |
| compression | B1 inflates binary frames with pako | no `sec-websocket-extensions` header came back to a client that offered none. The `deflate` mode was not run |
| handshake | | 5.2 to 7.4 s when it succeeded, 40 s timeouts otherwise |
| subscription limits | Not publicly specified | Not verified |

## 6. Captured frames

Server reply to the first run's frame burst, W1, then close code 1005.

```text
Invalid parameter
```

Keepalive, W2.

```text
ping
```

```text
pong
```

No acknowledgement, snapshot, delta or data frame was received.

## 7. Private channels

`wss://bitxex.io/ws/user`, subscribed with `{"req": "sub_user", "listenKey": …}` after a REST call to `/pro/u/ws/token` or its futures twin, B1.
Not probed.

## 8. Recommended feed shape

None.
No book frame arrived in 8 attempts, half the handshakes timed out, the protocol is undocumented, and B1 points to one symbol per socket and compressed binary frames.
A feed would need the protocol captured first from a host where the handshake is reliable.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| B1 | BitxEX futures web bundle `main.afe60ef9.chunk.js` | https://bitxex.io/static/js/main.afe60ef9.chunk.js | 2026-09-24 | BitxEX | URLs, `req` frames, ping handling, binary inflate, sections 1 to 7 |
| W1 | `ws-probe.mjs book`, first version with the error frames in the same burst, 06:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitxex/ws-probe.mjs) | 2026-09-24 | this host | `Invalid parameter` and close 1005, section 5 |
| W2 | `ws-probe.mjs book`, 06:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitxex/ws-probe.mjs) | 2026-09-24 | this host | open in 7.4 s, no ack, two pongs, sections 2, 3 and 5 |
| W3 | `ws-probe.mjs web btc_usdt`, six runs from 06:57 to 07:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitxex/ws-probe.mjs) | 2026-09-24 | this host | one open in 5.2 s with no frame and close 1006 at 47.1 s, three 40 s handshake timeouts, two runs with no open inside the 25 s and 40 s windows, sections 1 to 5 |
