# Bitonic WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:45 to 04:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Bitonic lists no perpetuals and no order book, see [`fees.md`](./fees.md) section 3, so this profile would cover a spot book channel.
Bitonic offers no WebSocket of any kind, and this file records how that was established.
Every probed claim comes from [`ws-probe.py`](../../../scripts/probes/venues/bitonic/ws-probe.py) unless a source id says otherwise.
Source ids S1 to S8 are those of [`fees.md`](./fees.md) section 10, and P3 is the socket probe of section 9 below.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| spot BTC against EUR | none published | the API page has 0 matches for "websocket", "wss://", "socket", "stream", "orderbook", "order book" and "depth", P3 |
| perpetuals | none | the venue lists none |

The public API is three plain HTTPS calls, `/api/buy`, `/api/sell` and `/api/price`, S1.
The site itself polls for prices instead of streaming them.
The home page script sets `refreshInterval:1e4,refreshUrl:"api/price?eur=40&include_fee=0"`, a 10 s poll of `/api/price`, P3 and S8.
The 17 site scripts the probe read, the home page script and 16 web app chunks of `/en/trade` with 3,693,382 bytes in all, hold no `new WebSocket(`, no `new EventSource(` and no `ws://` or `wss://` URL, P3.

The probe tried one handshake on each of five plausible paths, and none opened, P3.

| URL | answer |
|---|---|
| `wss://bitonic.nl/ws` | 404 with the site's HTML 404 page |
| `wss://bitonic.nl/websocket` | 404 with the site's HTML 404 page |
| `wss://bitonic.nl/api/ws` | 404 with `{"success":false,"data":{"errorCode":"404"}}` |
| `wss://api.bl3p.eu/1/BTCEUR/orderbook` | 404 with an nginx 404 page |
| `wss://api.bl3p.eu/1/BTCEUR/trades` | 404 with an nginx 404 page |

The two `api.bl3p.eu` paths are those of the BL3P exchange that closed on 2024-12-20, S3.
The host still resolves, but every path tried answers 404 over HTTPS and over a WebSocket upgrade, P1 and P3.

## 2. Channel matrix for public market data

| channel | offered |
|---|---|
| order book, any depth or speed | Not offered |
| best bid and ask | Not offered |
| trades | Not offered |
| ticker | Not offered |
| mark, index, funding | Not offered |

The nearest thing to a top of book is the pair of REST quotes, `/api/buy` and `/api/sell`, and the internal `/api/prices/v1/last-price`, see [`rest.md`](./rest.md) section 5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
With no socket, every axis is Not offered, and the probed column says what stood in for it.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not offered | no socket answered on five paths, P3 |
| subscribe frame shape | Not offered | nothing to subscribe to |
| unknown symbol expectation | Not offered | not applicable |
| chunk unit and budget | Not offered | not applicable |
| keepalive mechanism | Not offered | not applicable |
| connection lifetime and maintenance notice | Not offered | not applicable |
| handshake and operation rate limits | Not offered | each upgrade answered 404 |
| public market data authentication | Not offered | not applicable |
| message parse and routing | Not offered | not applicable |
| subscribe acknowledgement shape | Not offered | not applicable |
| symbol identifier format | Not offered. The REST calls take no symbol at all | not applicable |
| number representation | Not offered | not applicable |
| timestamp representation | Not offered | not applicable |
| size unit | Not offered | not applicable |
| sequence semantics | Not offered | not applicable |
| idle repeat behaviour | Not offered | not applicable |

## 4. The book channel in detail

Not offered.
Bitonic has no order book to stream, because every trade is against its own quote, see [`fees.md`](./fees.md) section 2.
Snapshot, delta, sequence, checksum, level order, size unit, one-sided books, idle repeats and unknown symbols therefore have nothing to describe.

## 5. Session

Not offered.
No socket opened, so there is no keepalive, silence limit, forced disconnect or compression to record.

## 6. Captured frames

None, since no socket opened.
The handshake answers are in section 1.

## 7. Private channels

None found.
The web app's account calls, such as `/api/wallet/v2/balances` and `/api/instant/v1/transactions`, are plain HTTPS behind sign-in, S8.

## 8. Recommended feed shape

None.
A book feed cannot be built for Bitonic.
If a spot leg were ever wanted, the only live source is a REST poll of `/api/buy` and `/api/sell` inside the 10 requests per minute the API page asks for, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public API page | https://bitonic.nl/en/api | 2026-10-09 | Bitonic B.V. | the three REST calls, no socket, section 1 |
| S3 | BL3P permanently offline | https://bitonic.nl/en/news/301/bl3p-permanently-offline | 2026-10-09 | Bitonic B.V. | BL3P closed, section 1 |
| S8 | Home page script and web app trade bundle | https://bitonic.nl/public/js/app-cedbe3b1.js and https://bitonic.nl/webapp/assets/trade-LS81wHXz.js | 2026-10-09 | Bitonic B.V. | the 10 s price poll, the account calls, sections 1 and 7 |
| P1 | `rest-probe.py bl3p`, 04:42 UTC on 2026-10-10, rerun 04:53 UTC | [`rest-probe.py`](../../../scripts/probes/venues/bitonic/rest-probe.py) | 2026-10-09 | this host, Canadian VPN exit | the BL3P hosts answer 302 or 404, section 1 |
| P3 | `ws-probe.py`, 04:45 to 04:48 UTC on 2026-10-10, rerun 04:56 to 04:57 UTC | [`ws-probe.py`](../../../scripts/probes/venues/bitonic/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | API page word counts, site script search, five handshakes, sections 1 and 3 |
