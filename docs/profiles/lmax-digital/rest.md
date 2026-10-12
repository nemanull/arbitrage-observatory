# LMAX Digital REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers the REST side of LMAX Group's perpetual futures, the researched product of [`fees.md`](./fees.md), and names LMAX Digital's spot surface where it matters.
Every perpetual REST call needs a bearer token, so the catalog comes from the market data socket, and no public call or channel returns an index, a mark or a next settlement time.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/lmax-digital/rest-probe.py), [`anchor-probe.py`](../../../scripts/probes/venues/lmax-digital/anchor-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/lmax-digital/ws-probe.py), section by section.

## 1. Host and latency from this machine

| host | resolved on 2026-10-09 | role | result |
|---|---|---|---|
| `market-data.london-perpetual.lmax.com` | `104.18.39.165`, `172.64.148.91`, Cloudflare | perpetual market data REST and sockets | REST 401 without a token, sockets open, see [`websocket.md`](./websocket.md) |
| `client.london-perpetual.lmax.com`, `trading.london-perpetual.lmax.com` | the same two addresses | client REST, trading socket | 401 without a token |
| `market-data.perpetual-demo.lmax.com` and the other demo hosts | the same two addresses | demo | REST 401, socket open |
| `auth.lmax.com` | Cloudflare, IPv4 and IPv6 | OAuth token issuer | not called |
| `docs.lmax.com` | CloudFront | API documentation, a Vue app over OpenAPI files | HTTP 200 |
| `market-data-api.london-digital.lmax.com` | the same two Cloudflare addresses | LMAX Digital spot market data | `/v1/time` and `/v1/version` answer, the book needs a token, section 2 |
| `public-data-api.london-digital.lmax.com` | the same two Cloudflare addresses | unknown | 404 `{"error_code":"NOT_FOUND","error_message":"Not found"}` on its root |
| `web-order.london-digital.lmax.com` | `185.122.245.5` | LMAX Digital web trading | not called |

Requests took 156 to 474 ms over two runs, cold or warm, with no steady difference, `rest-probe.py` section 2.
No geoblock or challenge was seen from this Canadian exit on any host, and the socket handshakes carried a Vancouver `CF-RAY`, `ws-probe.py` section 1.

## 2. Catalog

### The instruments call

The documented call, `GET https://market-data.london-perpetual.lmax.com/instrument/v1/instruments`, needs a bearer token, S1.
Without one it answers `401` with `{"code":"UNAUTHORIZED","message":"Unauthorized"}`, on production and on demo, `rest-probe.py` section 2.

The same definitions come over the public market data socket with `{"type": "GET_INSTRUMENT_DEFINITIONS", "symbols": []}`, see [`websocket.md`](./websocket.md) section 4.
On 2026-10-09 it listed 22 perpetuals, all `OPEN`, all USD-quoted linear with `contractSize` `1.0`, for AAVE, ADA, APT, AVAX, BCH, BNB, BTC, DOGE, DOT, ETH, HBAR, ICP, LINK, LTC, NEAR, PYTH, SOL, SUI, TRX, UNI, XAU and XRP, each spelled `<BASE>USDPERP`.
The published instrument list adds `TONUSDPERP`, which the production socket does not list, for 23 rows, S3, `rest-probe.py` section 4.

| field | value | engine use |
|---|---|---|
| `symbol` | `BTCUSDPERP` | `rawMarketId`, spelled the same on the book and funding sockets |
| `baseCurrency`, `quoteCurrency` | `BTC`, `USD` | base and quote, USD joins the USD, USDC and USDT family |
| `contractSize` | `1.0` on every production row | the book size is in coins |
| `marketStatus` | `OPEN` or `SUSPENDED` | `active` |
| `tickSize`, `orderQuantityIncrement` | per symbol | not used |
| `tradingBandwidth` | `8`, "Default trading bandwidth as percentage away from index" | not used |
| `fundingRatePremiumPercentage` | `0.003` | the debit side premium, see [`fees.md`](./fees.md) section 6 |
| `pythProId` | the Pyth Pro feed id of the index, section 4 | none |

Each pair is listed once.
`XAUUSDPERP` tracks gold through Pyth Pro's `Crypto.PAXG/USD`, so it would need a check against the gold tickers of other venues before it joined a cluster.

### How CCXT maps it

There is no CCXT class in 4.5.68 or on the current master, see [`fees.md`](./fees.md) section 8.
A loader would read the socket's `metadata` frame directly.

### LMAX Digital spot

The spot list has 66 instruments, 27 quoted in USD, S6, `rest-probe.py` section 5.
The Broker Market Data API answers `/v1/time` and `/v1/version` (`1.3.2`) without a token, but `/v1/marketdata/5004`, the BTC/USD book, answers `401` with `{"error_code":"UNAUTHORIZED","error_message":"Unauthorized"}`, and its spec says "Endpoints require authentication via an API Key", S5.
So LMAX Digital spot has no public book, which is why the spot side is not profiled further.

## 3. Anchor

LMAX publishes none of the anchor's five columns as a public bulk call.

| `AnchorRow` column | where LMAX has it | public |
|---|---|---|
| `index` | Pyth Pro, named by `pythProId`, section 4 | no, LMAX does not republish it, and Pyth's Hermes needs a key |
| `mark` | an exponential moving average of recent trade prices, S1 | no, not on any socket or call |
| `fundingRate` | the funding socket, credit and debit rates in percent | yes, see [`websocket.md`](./websocket.md) section 4 |
| `fundingIntervalHours` | 8, in prose only | in the documentation, not in any reply |
| `nextFundingAt` | nowhere | no |

The funding history call, `GET /instrument/v1/instruments/funding`, carries `creditFundingRatePercentage`, `debitFundingRatePercentage`, `averagePremiumIndexPercentage`, `price` and `timestampMicros`, S1, but it answers `401` without a token, `rest-probe.py` section 2.
The spec has no field named for a mark price, an index price or a next funding time, `rest-probe.py` section 3.

## 4. Anchor semantics

### Index

"The index price is the reference price of the underlying asset, sourced from Pyth Network", S1.
Since spec 1.0.13 of 2026-08-19 each instrument names a Pyth Pro feed in `pythProId`, and `pythId` is always empty, S1.
Pyth Pro's public symbol list, S2, maps every one of the 22 ids to a Pyth crypto feed in state `stable`, for example `1` to `Crypto.BTC/USD`, `2` to `Crypto.ETH/USD` and `163` to `Crypto.PAXG/USD` for `XAUUSDPERP`, `anchor-probe.py` section 2.
Each of those feeds also has a Hermes id.
Hermes, Pyth's HTTP price service, answered `401` with body `unauthorized` to the bulk call and to a single BTC/USD call without a key, `anchor-probe.py` section 3.
Pyth says "Hermes now requires an API Key" since its Core upgrade of 2026-08-26, S4.
So the index is a third-party price that LMAX does not republish, and the public route to it, Hermes, needs a Pyth key.

### Mark

"Positions are marked using the mark price, which is an exponential moving average of recent trade prices", S1.
The window, the weights and any clamp are not published, and no public channel carries trades, so the mark cannot be rebuilt either.

### Funding

The rate is "a time-weighted average over the funding interval (typically 8 hours)" of the premium index, "the difference between the mid-market price and the external reference (index) price", with a variance buffer, an unpublished cap, and a premium added to the debit side, S1.
The socket's credit and debit rates are called "Current", S1, so they read as the running estimate for the upcoming settlement, but the documentation does not say so outright.
The settlement instants are not published, and none was captured.

### How often each number changed

The funding socket republished all 22 rates every 5.0 s, and every rate was `0` in all 8 batches over two runs, [`websocket.md`](./websocket.md) section 4.
So the rate did not change while it was watched, which fits the variance buffer holding small premiums at zero.
The index and mark could not be read.

## 5. REST book snapshot

The perpetual API has no REST book call, S1.
The book comes only from the socket, where `SNAPSHOT` mode gives a whole book every 50 ms, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No rate limit is published for the perpetual REST calls or the sockets, and the spec has no `Retry-After` or rate limit header, `rest-probe.py` section 3.
No reply carried a rate limit header.
The trading socket documents a `RATE_LIMIT_EXCEEDED` rejection for orders, S1.

| request | status | body |
|---|---|---|
| any perpetual REST call without a token | 401 | `{"code":"UNAUTHORIZED","message":"Unauthorized"}`, even for an unknown symbol |
| an unknown path on the market data host | 404 | `<html><body><h1>Resource not found</h1></body></html>` |
| documented error codes | | `INTERNAL_SERVER_ERROR`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `AUTHENTICATION_FAILED`, S1 |

## 7. Server time and clock offset

The perpetual API has no time call.
LMAX Digital's `/v1/time` returned `epoch_millis` 27 to 36 ms ahead of the host's request midpoint over three calls in each of two runs, `rest-probe.py` section 6.
The funding socket's `timestampMicros` was 55 to 58 ms behind the host clock on arrival, which includes the transit time, `ws-probe.py` section 7.

## 8. Recommended poller shape

No poller is recommended, because the venue is blocked.

1. The index is a Pyth Pro price that LMAX does not republish, and Pyth's Hermes needs a key since 2026-08-26.
2. The mark is not published anywhere, so every route would be refused at open as a venue with no mark.
3. The next settlement time is not published, and the interval is only in prose.
4. The perpetual taker is not published, see [`fees.md`](./fees.md) section 2.
5. The perpetuals are sold only to professional clients of LMAX Global MU.

The funding rate alone is public, so a socket anchor, the shape of [`../../../server/src/venues/socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs), could hold `fundingRate` at 8 h with `nextFundingAt` 0.
It still could not complete a row, because that file leaves a row out until it has an index.
A named change would need a Pyth key for the index and an engine rule for a venue with no mark, and the books would still hold at most 16 levels a side.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S1 | Perps API, OpenAPI 1.0.14, with its change log | https://docs.lmax.com/perps-client-api/rest/1.0.14/openapi.yaml and https://docs.lmax.com/perps-client-api/change-log.json | 2026-10-09 | REST calls and their security, mark, index and funding text, error codes, sections 2 to 6 |
| S2 | Pyth Pro symbol list | https://history.pyth-lazer.dourolabs.app/history/v1/symbols | 2026-10-09 | `pythProId` to feed mapping, section 4 |
| S3 | LMAX Global MU perpetual futures instrument list, CSV | https://assets.lmaxstatic.com/csv/LMAXGlobal-mu-Instruments-Perpetual-Futures.csv | 2026-10-09 | 23 listed symbols, section 2 |
| S4 | Pyth Hermes, API instances and providers | https://docs.pyth.network/price-feeds/core/api-instances-and-providers/hermes | 2026-10-09 | "Hermes now requires an API Key", section 4 |
| S5 | Broker Market Data API, OpenAPI 1.3.2 | https://docs.lmax.com/broker-market-data-api/rest/1.3.2/openapi.yaml | 2026-10-09 | LMAX Digital spot market data needs a key, section 2 |
| S6 | LMAX Digital instrument list, CSV | https://assets.lmaxstatic.com/csv/LMAXDigital-Instruments.csv | 2026-10-09 | 66 spot instruments, section 2 |
