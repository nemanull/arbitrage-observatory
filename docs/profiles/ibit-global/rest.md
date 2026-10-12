# IBIT Global REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22, rechecked 2026-10-09.

**Probed:** 2026-10-09 by the Seattle calendar, 2026-10-10 02:18 to 02:45 UTC by the host clock, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

IBIT Global publishes no REST API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The 2026-09-24 draft linked this file but never wrote it, so everything below was probed on 2026-10-10.
The only REST paths found are the ones the web app calls, and Akamai refuses each of them without the web app's signature.
The market data that is reachable comes from the web client's own socket, see [`websocket.md`](./websocket.md).
So this profile records what was checked and what failed, and names what the socket offers in place of a REST anchor.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| web host | `www.ibitglobal.ai`, CNAME `a1229.dscr.akamai.net`, `23.213.230.202` and `23.213.230.203` | P1 |
| `https://www.ibitglobal.ai/` | 307 to `/zh-CN`, cold and warm both 173 to 176 ms in one run and 535 ms in the next | P1 |
| `https://ibit.global/` | 301 to `https://www.ibitglobal.ai:443/` | P1 |
| `/zh-CN` with a plain client user agent | 200, about 313 KB | P1 |
| `/zh-CN` with a Firefox user agent | 403 Akamai "Access Denied" with a reference id, no `Retry-After` | P1 |
| `api.ibitglobal.ai`, `openapi.ibitglobal.ai`, `api.ibit.global`, `openapi.ibit.global`, `docs.ibit.global` | none resolves | P1 |
| help center search for "API" | 12 articles, none of them API documentation | P2 |

The Firefox refusal is an Akamai bot rule that expects a real browser behind that user agent, and it is not a region refusal, since the same edge serves the page to a plain client from the same exit.

The API key page, `/en-US/member/apiManagement`, renders without a login, P1.
Its translations name two permissions, `READ` as "Allow reading" and `SPOTTRADE` as "Allow Spot Trading", and its chunk maps only those two.
Its "API Docs" heading sits beside an element that renders empty, so the page links no documentation.
The help center confirms a "Spot Trading API" for "market maker partners", see [`fees.md`](./fees.md) section 5.
No futures permission exists, so a futures leg could not trade through an API key.

## 2. Catalog

### What was checked

- CCXT: no class in 4.5.68 or on `master`, see [`fees.md`](./fees.md) section 8.
- The web app's chunks name 112 `/v1/` paths, P1, among them `/v1/futures/symbolList` and `/v1/futures/contractConfig`.
- Sent without the signature, each probed path answered 403 Akamai "Access Denied" with a reference id and no `Retry-After`, P1.

| path | status unsigned |
|---|---|
| `/v1/futures/symbolList` | 403 |
| `/v1/futures/contractConfig` | 403 |
| `/v1/futures/positionFeeRate` | 403 |
| `/v1/coMarket/marketSnapshot` | 403 |
| `/v1/spot/common/coinList` | 403 |

The web app adds a request interceptor that stamps every call with a time, a device id and hash signatures built from the time, the path and fixed strings in the bundle.
P1 finds that interceptor once in the chunks.
The probe does not reproduce that signer, because it is a private client scheme and not a published interface.

### What the socket shows instead

The futures socket's all-market mark channel listed 106 symbols, P3.
The mark of 99 of them moved within 60 s.
The seven that did not move are `1000xusdt`, `acxusdt`, `bakeusdt`, `nfpusdt`, `omusdt`, `tonusdt` and `vanryusdt`, and the help center announced each of their delistings, P2.
So the socket keeps dead contracts in its all-market channels.
The all-market funding channel lists 107, the extra one being `maticusdt`, whose delisting was announced for 2024-09-03, P2.
CoinMarketCap lists 96 perpetual pairs, S1, all of them on the socket.
The socket has ten symbols CoinMarketCap lacks: `1000xusdt`, `akeusdt`, `bakeusdt`, `bankusdt`, `btwusdt`, `dosusdt`, `hemiusdt`, `nfpusdt`, `omusdt` and `tonusdt`.

| item | value | source |
|---|---|---|
| active perpetual count | 99 USDT-M, by marks that moved, 0 USDC-M, 0 coin-M | P3 |
| status values | Not verified, no catalog call is reachable | P1 |
| symbol on the socket | lowercase, `btcusdt` | P3 |
| symbol in web URLs | `BTCUSDT`, from CoinMarketCap's `marketUrl` | S1 |
| contract size | Not verified, `contractConfig` refuses unsigned calls | P1 |
| price scale | `1000pepeusdt` and `1000xusdt` carry a 1000 prefix, a scale the engine would need to apply | P3 |
| pairs listed twice | none seen | P3 |

## 3. Anchor

No REST call returns index, mark or funding to this host, P1.
The futures socket publishes them instead, P3.

| `AnchorRow` column | socket field | note |
|---|---|---|
| `index` | `market_all_index_price` tick, keyed by lowercase symbol | one frame per second, 106 symbols |
| `mark` | `market_all_mark_price` tick | one frame per second, 106 symbols |
| `fundingRate` | `market_all_position_fee_rate` tick, `positionFeeRate` | whether it is the upcoming rate is Not publicly specified |
| `fundingIntervalHours` | none | 8 from the funding article, [`fees.md`](./fees.md) section 6 |
| `nextFundingAt` | none | 00:00, 08:00 and 16:00 UTC from the same article |

Each mark or index frame is 932 to 937 bytes compressed, P3.
The server's socket anchor support, [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs), already accepts a venue whose anchor fields arrive only on its socket.

## 4. Anchor semantics

- Index: the formula and basket are Not publicly specified, and no basket call was found.
- Mark: "Mark Price refers to the global spot price index plus a decreasing funding rate basis.", see [`fees.md`](./fees.md) S9.
  At the last frame of a 60 s read, mark equalled index on 71 of 106 symbols in one run and 59 in the next, P3.
  Clamps are Not publicly specified.
- Funding: the formula, cap and floor are Not publicly specified.
  The socket read 0.0003 on 86 contracts, -0.0003 on 19 and 0.0002 on 2, P3.
  Three values across 107 contracts suggest a clamp at ±0.03 %, Not verified.
  Every `updateTime` fell within a second after a five minute boundary, 02:25:00, 02:30:00 and 02:35:00 UTC in three runs, P3.
- How often each number changed: mark and index each arrived once a second, and 99 of 106 symbols changed within 60 s.
  No funding value changed within one 60 s read.
- The settlement instant was not captured.

## 5. REST book snapshot

None reachable.
The web app's `/v1/coMarket/marketSnapshot` answered 403 unsigned, P1.
The socket's book sends the whole 30 level window on every frame, so a feed needs no REST snapshot, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

Rate limits are Not publicly specified.
Every unsigned `/v1/` call answered 403 with an Akamai HTML page titled "Access Denied", a reference id and no `Retry-After`, P1.
The help center's Zendesk API and CoinMarketCap answered 200 throughout.

## 7. Server time and clock offset

No unsigned time call was found.
Socket data frames carry `ts` in Unix ms, see [`websocket.md`](./websocket.md) section 3, but the offset was not measured.

## 8. Recommended poller shape

None.
The venue has no published API, every REST path is signed and refused, and no catalog call gives contract sizes.
The only anchor source is the web client's socket, which does carry index, mark and funding for every contract once a second.
An adapter built on it would rely on an undocumented query string and a hidden contract size, so this profile recommends no poller.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap data API, market pairs for `ibit-global`, perpetual | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ibit-global&category=perpetual&start=1&limit=200 | 2026-10-10 | third party | 96 pairs, `marketUrl` spelling, section 2 |
| P1 | `rest-probe.py` | [`rest-probe.py`](../../../scripts/probes/venues/ibit-global/rest-probe.py) | 2026-10-10 | this host, Canadian VPN exit | hosts, redirects, refusals, API key page, request paths, sections 1, 2, 5 and 6 |
| P2 | `fees-probe.py` | [`fees-probe.py`](../../../scripts/probes/venues/ibit-global/fees-probe.py) | 2026-10-10 | this host, Canadian VPN exit | help center searches for "API" and "delisting", sections 1 and 2 |
| P3 | `ws-probe.py` mode book | [`ws-probe.py`](../../../scripts/probes/venues/ibit-global/ws-probe.py) | 2026-10-10 | this host, Canadian VPN exit | socket catalog, anchor fields and their cadence, sections 2 to 4 |
| P0 | `rest-probe.mjs`, the September draft's probe | [`rest-probe.mjs`](../../../scripts/probes/venues/ibit-global/rest-probe.mjs) | 2026-09-24 | this host, Canadian VPN exit | the September refusals of the same paths |
