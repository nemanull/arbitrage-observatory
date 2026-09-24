# BVOX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:27, 03:38 and 03:39 UTC, from the development host near Seattle, which Cloudflare places in Canada (`loc=CA`, colo `YVR`).
No socket opened, so no frame was captured.

This profile covers the public WebSocket surface of BVOX, formerly BitVenus, for its perpetuals.
BVOX runs on the BHEX broker platform and has no CCXT class, see [`fees.md`](./fees.md) sections 1 and 8.
Its API documentation link, `https://www.bitvenus.me/docs/v1/intro`, returns 404, so BVOX documents no socket that this host could read.
Two sources name the socket paths tried by [`ws-probe.mjs`](../../../scripts/probes/venues/bvox/ws-probe.mjs).
The archived web app bundle built its quote socket as the page origin plus `/ws/quote/v1`, S1.
The BHEX broker documentation serves raw streams at `wsapi.<domain>/openapi/quote/ws/v1`, S2.
Every handshake was refused, see section 5 for the times.
The "documented" column below is therefore the BHEX template, which BVOX never confirmed as its own.

## 1. Endpoints

| URL | source | handshake from this host |
|---|---|---|
| `wss://www.bvox.com/ws/quote/v1` | web app bundle, S1 | 404, the 335 byte `Error response` page |
| `wss://www.bvox.com/openapi/quote/ws/v1` | BHEX template on the site host | 404, the same page |
| `wss://wsapi.bvox.com/openapi/quote/ws/v1` | BHEX template, S2 | 503, a 190 byte nginx page `503 Service Temporarily Unavailable` |
| `wss://ws.bvox.com/ws/quote/v1` | guess from the web app path | 404, a 146 byte nginx page |
| `wss://api.bvox.com/openapi/quote/ws/v1` | guess from the BHEX REST host | 404, the 146 byte nginx page |
| `wss://wsapi.bitvenus.me/openapi/quote/ws/v1` | BHEX template on the former domain | 503, the 190 byte nginx page |
| `wss://www.bitvenus.me/ws/quote/v1` | web app bundle on the former domain | 404, the 335 byte page |

A plain GET on `wsapi.bvox.com` answers 503 on `/openapi/quote/ws/v1` and `/openapi/ws/` and 404 on every other path tried, see [`rest.md`](./rest.md) section 1.
So the socket host routes the BHEX stream paths to a backend that does not answer this host, which is the closest thing to a public endpoint found.
Whether one socket would carry several families is Not verified.
BVOX's config of 2026-08-02 listed only USDT perpetuals, see [`rest.md`](./rest.md) section 2.

## 2. Channel matrix for public market data

Not verified on the wire.
The BHEX template names these topics, S2.

| topic | payload in the template | probed |
|---|---|---|
| `depth` | merged book, `"f": true` on the first entry, levels `[price, quantity]` as strings, a version string `v` | not reachable |
| `diffDepth` | difference book "pushed every second", size 0 deletes a level | not reachable |
| `realtimes` | 24 h ticker | not reachable |
| `trade` | trades | not reachable |
| `kline_<interval>` | candles from `1m` to `1M` | not reachable |
| `index` | "index prices gathered for options and futures" | not reachable |

The archived web app also opened `/ws/quotation/pre/v1` for pre-market quotes and `/api/ws/user` for the account, S1.
No mark price or funding topic is named in either source.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the BHEX template, S2, unless it says otherwise.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one raw stream path, `/openapi/quote/ws/v1` | every candidate refused, section 1 |
| subscribe frame shape | `{"symbol": "$symbol0, $symbol1", "topic": "$topic", "event": "sub", "params": {"binary": false}}`, symbols comma separated in one string | not reachable |
| unknown symbol expectation | error code `-100010` `Invalid Symbols!` | not reachable |
| chunk unit and budget | Not publicly specified | not reachable |
| keepalive mechanism | client sends `{"ping": <ms>}` and the server answers `{"pong": <ms>}` | not reachable |
| connection lifetime and maintenance notice | the server closes a client that sends no ping for 5 minutes | not reachable |
| handshake and operation rate limits | Not publicly specified | 21 refused handshakes over three runs drew no 429 |
| public market data authentication | none | the refusals came before any authentication step |
| message parse and routing | `{symbol, topic, data: [...], f}` | not reachable |
| subscribe acknowledgement shape | Not publicly specified | not reachable |
| symbol identifier format | the template's examples use spot names such as `BTCUSDT`. BVOX's web app called its perpetuals `BTC-SWAP-USDT`, see [`rest.md`](./rest.md) section 2 | not reachable |
| number representation | prices and quantities as strings | not reachable |
| timestamp representation | `t` in ms | not reachable |
| size unit | Not publicly specified | not reachable. BVOX's archived catalog sizes contracts by `contractMultiplier`, from 0.0001 to 100,000 |
| sequence semantics | a version string `v` such as `"112801745_18"`, with no documented gap rule | not reachable |
| idle repeat behaviour | `diffDepth` is "pushed every second" | not reachable |

## 4. The book channel in detail

Nothing in this section could be observed, because no socket opened.

- Snapshot on subscribe: the template's `depth` payload carries `"f": true` on the first entry, S2, which suggests a snapshot, and this is Not verified for BVOX.
- Delta semantics: the template's `diffDepth` deletes a level at quantity 0, S2.
- Sequence and gap rule: the template names a version `v` and gives no rule for a gap, S2.
- Checksum: none in the template.
- Level order on the wire: Not verified.
- Size unit against `contractSize`: Not verified.
  The archived catalog gives `BTC-SWAP-USDT` a `contractMultiplier` of 0.0001 and whole contract orders, so a book in contracts would need that factor.
- One-sided and empty books, idle repeats, unknown and closed symbols: Not verified.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"ping": <ms>}` from the client, S2 | no socket opened |
| silence the server tolerates | 5 minutes without a client ping, S2 | not reachable |
| forced disconnect | Not publicly specified | not reachable |
| maintenance notice | Not publicly specified | not reachable |
| compression | the template offers `"binary": true` payloads, S2. The archived web app sets `window.ws_binary` true unless local storage says otherwise, S3 | the refusals were HTTP responses, so no extension was negotiated |
| handshake | | refused in 231 to 383 ms, with no `Retry-After` on any refusal |
| subscription limits | Not publicly specified | not reachable |

No engine feed parses a binary payload today, and a venue that compresses inside the frame has to be flagged, see [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section 3.
Whether BVOX's binary payload is compressed, and whether its socket defaults to binary, is Not verified.
The template says the default is text.

## 6. Captured frames

No frame was captured.
The probe logged one line per handshake, and the three kinds of refusal from the first run are below.

```json
{"tag":"ws","url":"wss://www.bvox.com/ws/quote/v1","result":"refused","status":404,"ms":272,"server":"cloudflare","type":"text/html;charset=utf-8","bytes":335,"title":"Error response","regionBlock":false}
```

```json
{"tag":"ws","url":"wss://wsapi.bvox.com/openapi/quote/ws/v1","result":"refused","status":503,"ms":251,"server":"cloudflare","type":"text/html","bytes":190,"title":"503 Service Temporarily Unavailable","regionBlock":false}
```

```json
{"tag":"ws","url":"wss://api.bvox.com/openapi/quote/ws/v1","result":"refused","status":404,"ms":234,"server":"cloudflare","type":"text/html","bytes":146,"title":"404 Not Found","regionBlock":false}
```

The body of the 503, as the probe stored it.

```text
<html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>nginx</center>
</body>
</html>
```

## 7. Private channels

Named for a future execution stage and not probed.
The archived web app opened `/api/ws/user` on the page origin, S1.
The BHEX template names a user data stream on the same `wsapi` host, S2.

## 8. Recommended feed shape

None.
BVOX refuses every socket path this host tried, documents no socket of its own that is still online, and lists no mark or funding topic.
A feed would need a reachable endpoint, a documented gap rule for the `v` version, and proof that the book arrives as text.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BVOX web app bundle `main-be17c5a6.297cc435.chunk.js`, archived 2025-09-14 | https://web.archive.org/web/20250914055128id_/https://www.bitvenus.me/static/js/main-be17c5a6.297cc435.chunk.js | 2026-09-23 | BVOX, via Internet Archive | `/ws/quote/v1`, `/ws/quotation/pre/v1`, `/api/ws/user`, sections 1, 2 and 7 |
| S2 | BHEX OpenApi, `doc/Websocket Stream EN.md` and `doc/endpoint.md` | https://github.com/bhexopen/BHEX-OpenApi/tree/master/doc | 2026-09-23 | BHEX platform, not BVOX | stream path, topics, subscribe shape, ping, error codes, sections 1 to 5 |
| S3 | BVOX API documentation page, archived 2025-10-04 | https://web.archive.org/web/20251004105651id_/https://www.bitvenus.me/docs/v1/intro | 2026-09-23 | BVOX, via Internet Archive | the page is the app shell with no documentation text, and sets `window.ws_binary`, section 5 |
| P1 | `ws-probe.mjs`, runs at 03:27, 03:38 and 03:39 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bvox/ws-probe.mjs) | 2026-09-22 local | this host, Cloudflare `loc=CA` | sections 1, 5 and 6 |
| P2 | `rest-probe.mjs`, runs at 03:25, 03:38 and 03:40 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bvox/rest-probe.mjs) | 2026-09-22 local | this host | the `wsapi` path map, section 1 |
