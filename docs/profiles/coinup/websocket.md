# CoinUp.io WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:15 and 04:21 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard exit that Cloudflare places in Canada.

This profile records what CoinUp.io's public WebSocket hosts answer this machine.
Every upgrade was refused with HTTP 403 and a Cloudflare challenge before any WebSocket frame, so no channel, book or session behaviour was observed.
The API documentation page, `https://www.coinup.io/en_US/cms/apidoc`, answered the same challenge, see [`rest.md`](./rest.md) section 1, so no documented value is available either.
The URLs tried are the ChainUp `kline-api` shape that CCXT Pro's `bitrue` class uses, at `server/node_modules/ccxt/js/src/pro/bitrue.js` line 31, applied to CoinUp's `futuresws` and `ws` hosts.
That CoinUp runs this shape is an inference, see [`rest.md`](./rest.md).

## 1. Endpoints

| URL | family, by name only | probed |
|---|---|---|
| `wss://futuresws.coinup.io/kline-api/ws` | USDT-M perpetuals, inferred | 403, `cf-mitigated: challenge` |
| `wss://futuresws.coinup.io/ws` | | 403 challenge |
| `wss://futuresws.coinup.io/` | | 403 challenge |
| `wss://ws.coinup.io/kline-api/ws` | spot, inferred | 403 challenge |
| `wss://ws.coinup.io/` | | 403 challenge |
| `wss://futures.coinup.io/kline-api/ws` | | 403 challenge |
| `wss://www.coinup.io/kline-api/ws` | | 403 challenge |

All seven were refused in 41 to 63 ms in the first run and 41 to 61 ms in the second, from the `SEA` and `YVR` edges, with bodies of 5,402 to 5,488 bytes, P1.
`futuresws.coinup.io` and `ws.coinup.io` resolve to the same three Cloudflare addresses as the REST hosts, see [`rest.md`](./rest.md) section 1.
Whether one socket carries several families is Not verified.

## 2. Channel matrix for public market data

Not verified.
No CoinUp channel list was readable.
On the other ChainUp venue in this survey the depth channel is `market_<symbol>_depth_step0` with 30 levels, and every frame is gzip inside a binary frame, see [`../bittime/websocket.md`](../bittime/websocket.md) sections 2 and 3.
That is a hint for a later probe, not a CoinUp fact.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty for every axis because the documentation page answered 403.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not readable | Not verified, every URL refused |
| subscribe frame shape | Not readable | Not verified |
| unknown symbol expectation | Not readable | Not verified |
| chunk unit and budget | Not readable | Not verified |
| keepalive mechanism | Not readable | Not verified |
| connection lifetime and maintenance notice | Not readable | Not verified |
| handshake and operation rate limits | Not readable | the handshake itself is refused with 403 challenge on seven of seven URLs |
| public market data authentication | Not readable | no credential was asked for, the edge refused before the origin |
| message parse and routing | Not readable | Not verified |
| subscribe acknowledgement shape | Not readable | Not verified |
| symbol identifier format | Not readable | Not verified. REST links spell `E-BTC-USDT`, see [`rest.md`](./rest.md) section 2 |
| number representation | Not readable | Not verified |
| timestamp representation | Not readable | Not verified |
| size unit | Not readable | Not verified. The 2024 guide gives each contract a face value, 0.001 BTC for `BTC` |
| sequence semantics | Not readable | Not verified |
| idle repeat behaviour | Not readable | Not verified |

## 4. The book channel in detail

Nothing was observed.
Snapshot on subscribe, delta semantics, sequence and gap rule, checksum, level order, size unit, one-sided books, idle repeats and the answer to an unknown symbol are all Not verified.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not readable | Not verified |
| silence the server tolerates | Not readable | Not verified |
| forced disconnect | Not readable | Not verified |
| maintenance notice | Not readable | the help center has a "Maintenance Or System Update" category, notices not read |
| compression | Not readable | Not verified. The client offered no permessage-deflate, and the refusal came before any negotiation |
| handshake | | refused with HTTP 403 in 41 to 63 ms, and 41 to 61 ms in the rerun |
| subscription limits | Not readable | Not verified |

## 6. Captured frames

No WebSocket frame was received.
The refusal of `wss://futuresws.coinup.io/kline-api/ws`, as the probe logged it at 04:15 UTC on 2026-09-23.

```json
{"tag":"refused","url":"wss://futuresws.coinup.io/kline-api/ws","status":403,"cfMitigated":"challenge","server":"cloudflare","ray":"a3f6b9e81c7a2c5d-YVR","type":"text/html; charset=UTF-8","bytes":5488,"title":"Just a moment...","ms":59}
```

The body is Cloudflare's challenge page, which asks the client to "Enable JavaScript and cookies to continue".

## 7. Private channels

Not verified.
No private channel name or endpoint was readable.

## 8. Recommended feed shape

None.
No feed is recommended while every CoinUp socket host refuses the upgrade from this machine.
A later probe from a network the edge accepts, if one exists, would start with `wss://futuresws.coinup.io/kline-api/ws`, a gzip decoder, and the ChainUp depth subscription `{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "e_btcusdt"}}`, which [`ws-probe.mjs`](../../../scripts/probes/venues/coinup/ws-probe.mjs) already sends if a socket ever opens.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinUp API documentation page | https://www.coinup.io/en_US/cms/apidoc | 2026-09-22 | CoinUp | answered 403 challenge, so no documented value, sections 2 to 7 |
| S2 | CCXT Pro 4.5.68 `bitrue.js` | `server/node_modules/ccxt/js/src/pro/bitrue.js` | 2026-09-22 | CCXT | the `kline-api/ws` URL shape tried, line 31 |
| S3 | Bittime WebSocket profile | [`../bittime/websocket.md`](../bittime/websocket.md) | 2026-09-22 | Bittime | ChainUp channel and gzip shape, section 2 |
| P1 | `ws-probe.mjs` at 04:15 and 04:21 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/coinup/ws-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 1, 3, 5 and 6 |
