# StakeCube WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:14 to 05:28 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

StakeCube lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
StakeCube documents no WebSocket, and no public socket was found.
The documentation, the official Node SDK and every candidate socket URL were checked, and none carries market data.
The web app that might open an undocumented socket sits behind a Cloudflare challenge from this host, so its script could not be read.
So StakeCube has no known book channel, and the only book is the REST call of [`rest.md`](./rest.md) section 5.
Probed values come from [`ws-probe.py`](../../../scripts/probes/venues/stakecube/ws-probe.py) unless a source id says otherwise.

## 1. Endpoints

| item | value | evidence |
|---|---|---|
| documented socket | none, the API docs name only REST routes under `https://stakecube.io/api/v2`, S1 | S1 |
| official SDK | `stakecube-node-sdk` uses only `ENDPOINT_BASE = 'https://stakecube.io/api/v2'` at line 4 of `index.js`, with no socket code | S2 |
| socket host names | `ws`, `socket`, `stream` and `api` under both `stakecube.io` and `stakecube.net` resolve to no address | `ws-probe.py dns` |
| socket paths on the API host | `/ws` and `/websocket` redirect with 301 to a trailing slash, which answers 403 from nginx, while a made-up `/made-up-dir/` answers 404 | `ws-probe.py paths` |
| handshakes | every candidate URL refused the upgrade, see the table below | `ws-probe.py handshake` |
| web app | `https://stakecube.net/app/exchange/` answered 403 with `cf-mitigated: challenge` | `ws-probe.py webapp` |

| candidate | handshake answer |
|---|---|
| `wss://stakecube.io/` | HTTP 200, the API host's two-line index page |
| `wss://stakecube.io/ws/` | HTTP 403 from nginx |
| `wss://stakecube.io/websocket/` | HTTP 403 from nginx |
| `wss://stakecube.io/socket.io/?EIO=4&transport=websocket` | HTTP 404 from nginx |
| `wss://stakecube.io/api/v2/ws` | HTTP 404 from nginx |
| `wss://stakecube.net/ws/` | HTTP 404 through Cloudflare, an HTML page, no challenge |
| `wss://stakecube.net/socket.io/?EIO=4&transport=websocket` | HTTP 404 through Cloudflare, an HTML page, no challenge |

The 403 on `/ws/` and `/websocket/`, against a 404 on a made-up path, says nginx has something at those two paths, but it refused both a plain GET and a WebSocket upgrade from this host.
Whether the web app opens a socket there with a session cookie is not known.

## 2. Channel matrix for public market data

| channel | present | evidence |
|---|---|---|
| order book levels, any depth | no public socket found, REST only | section 1, [`rest.md`](./rest.md) section 5 |
| best bid and ask | no socket, REST `GET /exchange/spot/markets?orderData=true` carries `bestBid` and `bestAsk` | [`rest.md`](./rest.md) section 5 |
| trades | no socket, REST `GET /exchange/spot/trades` | S1 |
| ticker | no socket, REST `GET /exchange/spot/markets` | S1 |
| mark, index, funding | no, spot only | [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
With no socket, every axis is Not offered on the documented side, and the probed side records what the search found.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not offered | no socket accepted an upgrade, section 1 |
| subscribe frame shape | Not offered | none, no socket opened |
| unknown symbol expectation | Not offered | none, no socket opened |
| chunk unit and budget | Not offered | none |
| keepalive mechanism | Not offered | none |
| connection lifetime and maintenance notice | Not offered | none |
| handshake and operation rate limits | Not offered | none, the REST weight limit of [`rest.md`](./rest.md) section 6 is the only published limit |
| public market data authentication | Not offered | the two nginx 403 paths refused an unauthenticated upgrade |
| message parse and routing | Not offered | none |
| subscribe acknowledgement shape | Not offered | none |
| symbol identifier format | Not offered, REST uses `TRADE_QUOTE` in upper case such as `SCC_BTC`, S1 | REST only |
| number representation | Not offered, REST sends decimal strings | REST only |
| timestamp representation | Not offered, REST sends Unix ms in `timestamp` | REST only |
| size unit | Not offered, REST `amount` is in the traded coin, S1 | REST only |
| sequence semantics | Not offered, the REST book carries no sequence | REST only |
| idle repeat behaviour | Not offered | none |

## 4. The book channel in detail

There is no book channel.
The REST book, `GET /exchange/spot/orderbook?market=SCC_BTC`, returns every resting level on both sides with no sequence, no checksum and no update id, see [`rest.md`](./rest.md) section 5.
Its asks arrive from the highest price to the lowest, so the best ask is the last element, which a consumer must sort or scan for.

## 5. Session

Not offered, because no socket opened.
The only session facts are the REST ones: `Cache-Control: no-store`, a warm request time of about 280 ms on a kept connection, and the weight limit of 20 per 10 s, see [`rest.md`](./rest.md) sections 1 and 6.

## 6. Captured frames

None, because no socket opened.
The handshake answers of section 1 are the captures, and the two nginx 403 bodies were the stock "403 Forbidden" page.

## 7. Private channels

None documented.
The private API is REST with an `X-API-KEY` header and an HMAC SHA256 `signature` over the URL-encoded body, S1.

## 8. Recommended feed shape

No feed is recommended.
StakeCube has no perpetuals and no public socket.
A spot feed could only poll the REST book, and at the published 20 weight per 10 s, with each book call weighing 1, one IP could refresh about 2 pairs every second or all 84 traded pairs about every 42 s.
That is far from the engine's feed shape, a book channel with a snapshot and deltas as in [`../gate/websocket.md`](../gate/websocket.md).
The terms also forbid using StakeCube market data for data feeding without written consent, see [`fees.md`](./fees.md) section 1.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://github.com/stakecube-hub/stakecube-api-docs`, files `rest-api/README.md`, `rest-api/exchange.md`, `rest-api/system.md` and `rest-api/user.md`, last pushed 2022-05-09 | REST routes only, the signing rule, no socket |
| S2 | `https://github.com/stakecube-hub/stakecube-node-sdk`, `index.js`, last pushed 2021-04-30 | the REST base URL at line 4, no socket code |
