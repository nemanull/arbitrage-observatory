# BlockFin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 04:18 to 04:40 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada, where every WebSocket handshake was refused with HTTP 403.

This profile covers the public WebSocket market data of BlockFin's perpetuals.
BlockFin publishes no socket reference that this host could read, because its docs page answers with the restricted region page, see [`rest.md`](./rest.md) section 1.
BlockFin's REST API answers in the shape of BloFin's, so the socket was tried at BloFin's path on BlockFin's hosts, and BloFin's documented socket in [`../blofin/websocket.md`](../blofin/websocket.md) is the closest reference.
No socket opened, so nothing in sections 2 to 5 was seen on BlockFin's wire.
Every probed number comes from [`ws-probe.py`](../../../scripts/probes/venues/blockfin/ws-probe.py), P1, and its second pass run, P2.
No proxy, VPN or other route around the refusal was used.

## 1. Endpoints

| URL tried | result |
|---|---|
| `wss://openapi.blockfin.com/ws/public` | HTTP 403 on 18 of 18 handshakes in P1 and P2, `text/html`, 8,893 bytes, the restricted region page, Cloudflare colo `YVR`, 23 to 175 ms |
| `wss://blockfin.com/ws/public` | HTTP 403 on 18 of 18 handshakes in P1 and P2, the same page, 28 to 326 ms |
| `ws.blockfin.com` | no DNS record, [`rest-probe.py`](../../../scripts/probes/venues/blockfin/rest-probe.py) mode `access` |

The handshake refusal body is 8,893 bytes against 9,831 bytes for a plain GET, and it carries the same refusal sentence, P1, P2 and [`rest.md`](./rest.md) section 1.
REST calls from the same exit were let through in between 1 of 48 and 12 of 30 tries per run, see [`rest.md`](./rest.md) section 1, but no handshake was, P1 and P2.
The URL `wss://openapi.blockfin.com/ws/public` is inferred from BloFin's `wss://openapi.blofin.com/ws/public` at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/blofin.js` line 37, and is Not publicly specified by BlockFin.
Whether one socket carries USDT-M, USDC-M and coin-M streams is Not verified, although BloFin documents one public URL for every family, see [`../blofin/websocket.md`](../blofin/websocket.md) section 1.

## 2. Channel matrix for public market data

Nothing was seen on the wire.
If BlockFin's socket follows BloFin's, the channels are `books`, `books5`, `tickers`, `funding-rate`, `trades` and the candle channels, with no dedicated mark or index channel, see [`../blofin/websocket.md`](../blofin/websocket.md) section 2.
The probe subscribes `books` and `books5` on `BTC-USDT`, `books` on `ETH-USDT`, `funding-rate` on `BTC-USDT` and `books` on an unknown symbol, and would print the first frame of each, but no socket opened, P1 and P2.

## 3. The sixteen axes

The axes are those of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is BloFin's reference, as recorded in [`../blofin/websocket.md`](../blofin/websocket.md) section 3, because BlockFin publishes none that this host could read.

| axis | documented, BloFin's reference | probed on BlockFin |
|---|---|---|
| endpoint split axis | one public URL for every family | refused, HTTP 403, P1 |
| subscribe frame shape | `{"op":"subscribe","args":[{"channel":"books","instId":"BTC-USDT"}]}`, several args per frame, 4,096 bytes of args at most | refused |
| unknown symbol expectation | `{"event":"error","code":"60012",...}` is the documented failure, and what an unknown `instId` gets is Not publicly specified | refused |
| chunk unit and budget | one arg per `instId` and channel, 4,096 bytes of args per frame, no per connection cap published | refused |
| keepalive mechanism | client sends the text `ping` and expects `pong` | refused |
| connection lifetime and maintenance notice | the server drops a socket after 30 s without a subscription or pushed data, no maintenance channel | refused |
| handshake and operation rate limits | 1 new connection per second per IP | refused, 36 of 36 handshakes got 403, about 3 s apart per URL, P1 and P2 |
| public market data authentication | none | refused before any subscription, HTTP 403 at the upgrade |
| message parse and routing | `{"arg":{"channel","instId"},"action":"snapshot" or "update","data":{...}}`, route on `arg.instId` | refused |
| subscribe acknowledgement shape | `{"event":"subscribe","arg":{...}}` | refused |
| symbol identifier format | `BTC-USDT`, the REST `instId` | refused, and the BlockFin REST `instId` has that format, see [`rest.md`](./rest.md) section 2 |
| number representation | strings in the text, numbers in the push example | refused |
| timestamp representation | `data.ts` as a string of Unix ms | refused |
| size unit | contracts | refused, and BlockFin's REST ticker sizes are contracts, see [`rest.md`](./rest.md) section 2 |
| sequence semantics | per `instId`, `prevSeqId` equals the previous `seqId`, and a snapshot has `prevSeqId` 0 | refused |
| idle repeat behaviour | Not publicly specified | refused |

## 4. The book channel in detail

Nothing could be seen.
If BlockFin's `books` matches BloFin's, a feed resets on `action` `snapshot`, applies an `update` only when its `prevSeqId` equals the last `seqId`, and resyncs on a broken link, see [`../blofin/websocket.md`](../blofin/websocket.md) section 4.
The probe checks exactly that rule and counts gaps, and would report it on a socket that opens.
Sizes would be contracts, to be multiplied by the catalog's `contractValue`, see [`rest.md`](./rest.md) section 2.

## 5. Session

| item | probed |
|---|---|
| handshake | 403 on 36 of 36 attempts in P1 and P2, two URLs tried together about every 3 s |
| permessage-deflate | the probe offers none, and the refusal came before any negotiation |
| keepalive, silence, forced disconnects, maintenance notices, limits | not reached |

## 6. Captured frames

No frame was received.
The refusal, as the probe printed it:

```json
{"url": "wss://openapi.blockfin.com/ws/public", "status": 403, "bytes": 8893, "restricted_page": true, "cf_ray": "a482d1b01876d9c8-YVR", "ms": 175}
```

## 7. Private channels

BloFin documents `wss://openapi.blofin.com/ws/private`, see [`../blofin/websocket.md`](../blofin/websocket.md) section 1.
The BlockFin counterpart would be `wss://openapi.blockfin.com/ws/private`, which was not probed, because private channels are out of scope.

## 8. Recommended feed shape

A recommendation for a host that BlockFin serves, not a decision, resting on BloFin's documentation and not on BlockFin's wire.
From this exit there is no feed to build, because the upgrade is refused every time.

| item | recommendation |
|---|---|
| URL plan | `wss://openapi.blockfin.com/ws/public`, after a probe from a served host confirms it |
| channel | `books`, arg `{"channel":"books","instId":<instId>}` |
| keepalive | text `ping` every 20 s |
| resync | on a broken `prevSeqId` link |
| first check | whether BlockFin's books are BloFin's books, see [`rest.md`](./rest.md) section 1 |

Verdict for the engine: no book feed can run from this exit, because every handshake is refused.

## 9. Source ledger

| id | source | retrieved | covers |
|---|---|---|---|
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/blockfin/ws-probe.py) | 2026-10-10 04:18 UTC | 12 handshakes, all refused |
| P2 | `ws-probe.py`, second pass, run twice, the second time with the refusal matched by its sentence | 2026-10-10 04:36 and 04:39 UTC | 24 more handshakes, all refused, 28 to 163 ms |
| S1 | [`../blofin/websocket.md`](../blofin/websocket.md) | 2026-09-22 | BloFin's documented socket |
| S2 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/blofin.js` line 37 | 2026-10-10 | BloFin's public socket URL |
