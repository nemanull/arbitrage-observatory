# Dinari REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:46 to 04:59 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

The documented REST API of Dinari is the Enterprise API v2, live at `https://api-enterprise.sbt.dinari.com/api/v2` and sandbox at `https://api-enterprise.sandbox.dinari.com/api/v2`, S1.
Every market data path in its OpenAPI spec requires the `X-API-Key-Id` and `X-API-Secret-Key` headers, and keys come from the Partners Dashboard, S2.
Without keys every documented path answered HTTP 401 to this host, in [`rest-probe.mjs`](../../../scripts/probes/venues/dinari/rest-probe.mjs).
Dinari's own web app at `app.dinari.com` serves stock data through undocumented routes that answered without keys, and section 2 records them as evidence of the catalog, not as an API to build on.
The venue lists no perpetuals, so this profile covers the spot product per template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), see [`fees.md`](./fees.md) section 3.
Access results are from a Canadian VPN exit, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 | front |
|---|---|---|
| `api-enterprise.sbt.dinari.com` | `104.26.6.164`, `104.26.7.164`, `172.67.68.254` | Cloudflare, `cf-ray` suffix `SEA`, AWS API Gateway behind it (`apigw-requestid` header) |
| `api-enterprise.sandbox.dinari.com` | the same three addresses | same |
| `app.dinari.com` | the same three addresses | Cloudflare, `SEA` edge in both probe runs, `YVR` in one manual call |
| `ws.api.dinari.com` and `ws.api.sandbox.dinari.com` | the same three addresses | Cloudflare, see [`websocket.md`](./websocket.md) |
| `api.dinari.com` | no A record, `ENODATA` | none |

Every documented market data GET, called once each without keys on both hosts in each of two runs, answered the same way.

| request | status | body | time |
|---|---|---|---|
| `/api/v2/market_data/stocks/`, with and without `page_size=5` | 401 | `{"error":null,"error_id":"req:<id>","message":"Unauthorized","status":401}` | 80 to 161 ms for the first request to each host, then 31 to 93 ms |
| `/api/v2/market_data/stocks/{stock_id}/current_price` and `/current_quote` for AAPL | 401 | same | 30 to 36 ms |
| `/api/v2/market_data/market_hours/` and `/api/v2/market_data/alloys/` | 401 | same | 31 to 39 ms |
| `/api/v2/nope`, which the spec does not define | 404 | `{"error":null,"error_id":"req:<id>","message":"Not Found","status":404}` | 35 to 39 ms |
| `/` | 500 | `{"message":"Internal Server Error"}` | 29 to 40 ms |

No reply carried `WWW-Authenticate` or `Retry-After`.
The sandbox host behaved exactly like the live host.
A 401 on a defined path and a 404 on an undefined one mean the gateway checks the route before the key.

## 2. Catalog

### The documented call

`GET /api/v2/market_data/stocks/` takes `symbols`, `page`, `page_size`, `limit`, `order`, `next` and `previous`, and needs both key headers, S2.
It answered 401 here, so the documented reply was not read.

### What the web app serves

The web app's JavaScript calls `/api/dinari/market/stocks`, `/stocks/{id}/quote`, `/stocks/{id}/price` and the batch reads `POST /stocks/quotes/batch` and `POST /stocks/prices/batch`, found in its chunk `8206-28bd266c550fda7d.js` on 2026-09-23.
These are the app's own routes, not part of the documented API, and they can change without notice.
The app's code also calls `/api/dinari/onboarding`, `/api/dinari/orders`, `/api/dinari/entities`, `/api/wallets` and `/api/portfolio`, and none of those was called.

| call on `https://app.dinari.com/api` | status | reply | time |
|---|---|---|---|
| `GET /region` | 200 | `{"countryCode":"CA","source":"cf-ipcountry"}` | 102 to 120 ms |
| `GET /dinari/market/stocks?page=N&page_size=100` | 200 on pages 1 to 8 | 100 rows per page and 19 on page 8, 719 rows, 24 to 130 KB per page | 30 to 121 ms |
| `GET /dinari/market/stocks/{id}/quote` | 200 | one top of book quote, 185 to 188 bytes | 91 to 251 ms |
| `GET /dinari/market/stocks/{id}/price` | 200 | one price row, 344 and 346 bytes | 129 and 139 ms |
| `POST /dinari/market/stocks/quotes/batch` with five ids | 200 | a map from stock id to quote, 1,137 bytes | 248 and 280 ms |
| `POST /dinari/market/stocks/prices/batch` with five ids | 200 | a map from stock id to price row, 1,900 bytes | 191 and 1,370 ms |
| `GET /dinari/market/stocks/00000000-0000-0000-0000-000000000000/quote` | 404 | `{"error":"404 No active stock found for Asset 00000000-0000-0000-0000-000000000000"}` | 113 and 178 ms |

The catalog has 719 stocks and ETFs, all with `is_tradable` true and 708 with `is_fractionable` true, P1.
The 11 not fractionable were `BRK.A`, `MSTU`, `SLS`, `NCPL`, `TRON`, `DFDV`, `BWET`, `FLD`, `CYPH`, `STRF` and `MNZL`.
Each row carries `cik`, `composite_figi`, `cusip`, `description`, `display_name`, `id`, `is_fractionable`, `is_tradable`, `logo_url`, `name`, `symbol` and `tokens`.
`id` is a UUID such as `0196ea6d-b6de-70d5-ae41-9525959ef309` for AAPL, and `symbol` is the US ticker, with a dot in `BRK.A`, `BRK.B` and `BF.B`.
No symbol appeared twice.
`tokens` lists one ERC-20 address per chain as `eip155:<chain>:<address>`.
Chains 1, 56, 5042, 8453, 42161, 43114, 98866 and 202110 carried all 719 stocks, chain 81457 carried 125, and chain 999 carried 18.

### How CCXT maps it

It does not.
CCXT 4.5.68 has no Dinari class and CCXT master has none either, see [`fees.md`](./fees.md) section 8.
There is no `market.id`, `contractSize`, `linear` or `active` to compare, and nothing is a swap.
A socket subscription names the stock `id` and the documented socket frame names the ticker in `Symbol`, see [`websocket.md`](./websocket.md) section 3, so a feed would have to map one to the other.

## 3. Anchor

Dinari publishes no index, no mark and no funding rate, because it lists no perpetual.
No bulk call returns any `AnchorRow` column, and this profile recommends no anchor poller.

Two reference prices exist, both per stock and both behind keys in the documented API, S2 and S3.

| call | fields | meaning |
|---|---|---|
| `GET /api/v2/market_data/stocks/{stock_id}/current_price` | `price`, `timestamp`, `last`, `open`, `high`, `low`, `close`, `previous_close`, `change`, `change_percent`, `volume`, `market_cap`, `weighted_shares_outstanding` | a "Fair Market Value" computed by blending "the last trade, recent trade" and other data points, S3 |
| `GET /api/v2/market_data/stocks/{stock_id}/current_quote` | `bid_price`, `bid_size`, `ask_price`, `ask_size` in shares, `timestamp`, and in version 2 `bid_exchange` and `ask_exchange` | a quote from US exchange feeds that "may not represent the National Best Bid Offer", or the metered SIP NBBO with `feed=sip`, S3 and S4 |

The price is not a perpetual index.
It is the dShare's reference to its underlying stock, and the terms say token prices "may diverge from the live market price of the corresponding underlying security", S5 section 3.6.

## 4. Anchor semantics

No index, mark or funding formula exists to record.
What the web app routes showed about the two reference prices, polled once a second for 30 s at 04:47 and again at 04:58 UTC during the overnight session, P2:

| series | distinct values in 30 polls, first and second run | age of its `timestamp` on arrival, first and second run |
|---|---|---|
| AAPL quote | 1 and 3 | 8.0 to 37.6 s, and 0.1 to 20.5 s |
| TSLA quote | 4 and 3 | 0.2 to 13.6 s, and 0.2 to 23.8 s |
| AAPL price | 1 and 1, stamped 04:26:58 and 04:42:32 UTC | 1,216 to 1,246 s, and 953 to 984 s |
| TSLA price | 2 and 1, stamped 04:31:19 and 04:32:10, then 04:41:56 UTC | 912 to 962 s, and 989 to 1,020 s |

The 240 requests took 85 to 1,200 ms, with a median of 120 and 127 ms.

The quote changes when the book changes and keeps its old `timestamp` otherwise.
The price trailed the wall clock by 15 to 21 minutes during the overnight session, so it behaves like a delayed series at that hour.
A regular session reading was not taken, so its cadence then is Not verified.

Trading sessions, in ET, S6 and S7:

| session | hours | order types |
|---|---|---|
| Regular | weekdays 9:30 to 16:00 | market and limit |
| Extended | weekdays 4:00 to 9:30 and 16:00 to 20:00 | limit, and market becomes marketable limit |
| Overnight | 20:00 the previous day to 4:00 on days with a regular session | same |
| Open (24/7) | all other times, for 9 tickers: `SPY`, `QQQ`, `AAPL`, `AMZN`, `META`, `MSTR`, `NVDA`, `SPCX`, `TSLA` | same, and an order may rest "on the Dinari order book" |

A marketable limit buy is priced at the latest ask and a sell at the latest bid, S6.

## 5. REST book snapshot

No depth call is documented.
`current_quote` is top of book only, one bid and one ask with sizes in shares, S2.
A missing side reads `0`, "The ask price. 0 if there is no active ask.", S2.
The web app routes sent the quote and the price with `cache-control: no-store`, the catalog with `public, s-maxage=3600, stale-while-revalidate=7200`, and the batch reads with `public, s-maxage=120, stale-while-revalidate=300`.
Every reply read here had `cf-cache-status: DYNAMIC`, so Cloudflare served none of them from cache.
The batch reads are nonetheless cached somewhere behind Cloudflare, which is an inference from the replies below.
At 04:47:00 and again at 04:58:03 UTC the batch quote read returned the same AAPL quote stamped 04:46:54, while the single quote read at 04:58:01 returned one stamped 04:57:50.
The batch price read likewise returned the price stamped 04:26:58 both times, while the single price read had moved to 04:42:32.

## 6. Rate limits and errors

No rate limit is published in the documentation index or in any page read, S1.
None was reached here, and no reply carried a rate limit header or `Retry-After`.

| case | status | body |
|---|---|---|
| documented path, no keys | 401 | `{"error":null,"error_id":"req:<id>","message":"Unauthorized","status":401}` |
| undefined path | 404 | `{"error":null,"error_id":"req:<id>","message":"Not Found","status":404}` |
| host root | 500 | `{"message":"Internal Server Error"}` |
| web app route, unknown stock id | 404 | `{"error":"404 No active stock found for Asset <id>"}` |

## 7. Server time and clock offset

No server time call appears in the documentation index, S1.
The `Date` header of five warm 401 replies from the live host read 236 to 944 ms behind the midpoint of each request in the first run, and 33 to 699 ms in the second, P1.
The header has one second resolution and truncates, so a perfectly synchronized clock reads between 0 and 1,000 ms behind, and the offset is within that resolution.

## 8. Recommended poller shape

None.
Dinari lists no perpetual, publishes no index, mark or funding, and every documented call needs a partner key that costs from $2,000 a month, see [`fees.md`](./fees.md) section 4.
The web app routes must not be polled by the engine, because they are undocumented and exist to serve Dinari's own front end.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Dinari documentation index | https://docs.dinari.com/llms.txt | 2026-09-22 | Dinari, Inc. | page list, no rate limit or server time page, sections 6 and 7 |
| S2 | API reference, Environment, Get Stocks, Get Stock current price, Get Stock Quote, Get Market Hours, as OpenAPI in markdown | https://docs.dinari.com/reference/environments.md, https://docs.dinari.com/reference/getstocks.md, https://docs.dinari.com/reference/getstockcurrentprice.md, https://docs.dinari.com/reference/getstockcurrentquotesroutev2.md, https://docs.dinari.com/reference/getmarkethours.md | 2026-09-22 | Dinari, Inc. | base URLs, key headers, parameters and fields, sections 2, 3 and 5 |
| S3 | Pricing and Quotes | https://docs.dinari.com/docs/pricing-quotes.md | 2026-09-22 | Dinari, Inc. | fair market value, quote sources, SIP, section 3 |
| S4 | Get Stock Quote, `feed` and `X-API-Version` parameters | https://docs.dinari.com/reference/getstockcurrentquotesroutev2.md | 2026-09-22 | Dinari, Inc. | `feed=sip`, version 2 fields, section 3 |
| S5 | Dinari, Inc. Terms and Conditions, revised 2025-12-26 (PDF) | https://cdn.prod.website-files.com/656fd13bce08f2dc3bc50573/695ee673aa80e179e884fafc_Dinari-dShares-Terms-and-Conditions-Revised-12-26-25-CLEAN-with-links.pdf | 2026-09-22 | Dinari, Inc., non-US | pricing methodology, section 3 |
| S6 | Order Types and Behaviors, and Trading Hours | https://docs.dinari.com/docs/order-type.md and https://docs.dinari.com/docs/trading-hours.md | 2026-09-22 | Dinari, Inc. | sessions, marketable limit, Dinari order book, section 4 |
| S7 | 24/7 Tradable Assets | https://docs.dinari.com/docs/24-7-trading.md | 2026-09-22 | Dinari, Inc. | the 9 tickers of the Open session, section 4 |
| P1 | `rest-probe.mjs all`, which runs `api`, `app` and `ccxt`, at 04:46 UTC and in the second pass at 04:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dinari/rest-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.mjs poll` at 04:47 UTC and in the second pass at 04:58 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dinari/rest-probe.mjs) | 2026-09-23 | this host, Canadian exit | section 4 |
