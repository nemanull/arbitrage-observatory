# BITmarkets WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:51 to 06:55 UTC by the host clock, from the development host near Seattle, whose traffic exits a Surfshark WireGuard tunnel geolocated to Canada.

BITmarkets publishes no WebSocket API documentation, and no public market data socket was found.
This profile records which socket hosts exist, what each did when [`ws-probe.mjs`](../../../scripts/probes/venues/bitmarkets/ws-probe.mjs) connected, and why no book channel can be described.
Access results are from that Canadian VPN exit.
The sockets were held about 115 s in total over three runs.

## 1. Endpoints

No URL is documented.
The candidates come from DNS and from the web app configuration `window.__NUXT__.config` in the Wayback capture of `https://my.bitmarkets.com/` of 2025-09-23, S1.

| host | where it comes from | probed |
|---|---|---|
| `wss://platform-api.bitmarkets.com:8443/` | `tradingSocket` in S1 | upgrade 101 in 742 to 799 ms, no frame, closes with 1000 about 250 ms after any client text frame, P1 to P3 |
| `wss://platform-api.bitmarkets.com:2096/` | `spotPublicSocket` in S1 | upgrade 101 in 734 and 754 ms, same behaviour as 8443, P1 and P2 |
| `futuresSocket` | the S1 config value is the empty string `""` | nothing to probe |
| `wss://ws.bitmarkets1.com/ws/spot` | `providerPrivateSocket` in S1 | not probed, since the config names it private |
| `wss://ws.bitmarkets.com/` | DNS, Cloudflare addresses 104.20.46.100 and 172.66.145.203 | no upgrade, HTTP 200 with the JSON `{"code": 44444444, "msg": "block", …}` and `x-cache: Error from cloudfront`, P1 |

`platform-api.bitmarkets.com` resolved to the same two Cloudflare addresses as `bitmarkets.com`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

No channel is documented, and neither open socket answered any frame, so no channel name is known.
The web app configuration S1 sets `futuresSocket` to the empty string, which suggests the futures page does not use a separate public socket, but that reading is an inference.
Book, best bid and ask, trades, ticker, mark, index and funding channels are all Not verified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | two ports on one host, 8443 named trading and 2096 named spot public in S1 |
| subscribe frame shape | Not publicly specified | unknown, since every text frame tried ended the socket |
| unknown symbol expectation | Not publicly specified | Not verified |
| chunk unit and budget | Not publicly specified | Not verified |
| keepalive mechanism | Not publicly specified | the server sent one protocol ping in 40 s on each idle socket, P2 |
| connection lifetime and maintenance notice | Not publicly specified | an idle socket stayed open 40 s until the probe closed it, P2 |
| handshake and operation rate limits | Not publicly specified | no refusal over 8 handshakes to `platform-api` |
| public market data authentication | Not publicly specified | unknown, since no frame was ever sent by the server |
| message parse and routing | Not publicly specified | no frame received |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement, the server closes with 1000 and an empty reason |
| symbol identifier format | Not publicly specified | Not verified |
| number representation | Not publicly specified | Not verified |
| timestamp representation | Not publicly specified | Not verified |
| size unit | Not publicly specified | Not verified |
| sequence semantics | Not publicly specified | Not verified |
| idle repeat behaviour | Not publicly specified | no unprompted frame in 10 s on either port, and none in 40 s on an idle socket |

## 4. The book channel in detail

No book channel could be reached.
Snapshot on subscribe, delta semantics, sequence and gap rule, checksum, level order, size unit against CCXT `contractSize`, one-sided books, idle repeats and unknown symbols are all Not verified.
CCXT has no BITmarkets class, so there is no `contractSize` to compare against, see [`fees.md`](./fees.md) section 8.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | one server protocol ping per idle socket within 40 s, answered by the `ws` library's automatic pong, P2 |
| silence the server tolerates | Not publicly specified | at least 40 s with no client frame, P2 |
| forced disconnect | Not publicly specified | any client text frame, whether `ping`, `{"op":"ping"}`, `{"method":"ping"}` or `{"event":"ping"}`, got a close 1000 with an empty reason 247 to 261 ms after it was sent, P1 and P3 |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | no `sec-websocket-extensions` header in the 101 reply to a client that offered none, P1 |
| handshake | | 734 to 799 ms to open from this host, P1 to P3 |
| subscription limits | Not publicly specified | Not verified |

## 6. Captured frames

The server sent no data frame in any run, so there is nothing to quote.
The only replies were the HTTP upgrade and the close.

```json
{"tag":"upgrade","url":"wss://platform-api.bitmarkets.com:8443/","status":101,"ext":null,"protocol":null}
```

```json
{"tag":"close","url":"wss://platform-api.bitmarkets.com:8443/","code":1000,"reason":"","atMs":3014}
```

The block body that `ws.bitmarkets.com` returns in place of an upgrade, P1.
Its `time` is fixed at 2026-06-24 03:01:57 UTC on every request, so it is a stored error page.

```json
{"code": 44444444, "msg": "block", "time": 1782270117900, "data": "", "success": false}
```

## 7. Private channels

The web app configuration S1 names `providerPrivateSocket` `wss://ws.bitmarkets1.com/ws/spot` and `tradingSocket` `wss://platform-api.bitmarkets.com:8443`.
Their channels are not published and were not probed.

## 8. Recommended feed shape

None.
There is no documented public socket, and the two sockets that open close on the first client frame without a word, so a feed cannot be written.
A feed would need BITmarkets to publish a market data API first.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | `my.bitmarkets.com` web app shell, Wayback capture of 2025-09-23, `window.__NUXT__.config` | https://web.archive.org/web/20250923210857/https://my.bitmarkets.com/ | 2026-09-24 | BITmarkets | sections 1, 2 and 7 |
| P1 | `ws-probe.mjs generic` at 06:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmarkets/ws-probe.mjs) | 2026-09-24 | this host | sections 1, 3, 5 and 6 |
| P2 | `ws-probe.mjs idle` at 06:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmarkets/ws-probe.mjs) | 2026-09-24 | this host | sections 3 and 5 |
| P3 | `ws-probe.mjs early` at 06:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmarkets/ws-probe.mjs) | 2026-09-24 | this host | sections 1, 5 and 6 |
