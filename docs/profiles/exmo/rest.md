# EXMO REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:41 to 04:56 UTC, and the second pass from 04:59 to 05:01 UTC, from the development host near Seattle, through the laptop's Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API v1.1 of EXMO (CCXT id `exmo`) for its spot market, because EXMO lists no perpetual, see [`fees.md`](./fees.md) section 3.
The platform announced its wind-down on 2026-07-14, and the API still answers, see [`fees.md`](./fees.md) section 1.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs), the documentation, or a CCXT file and line.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 | answered as | use |
|---|---|---|---|
| `api.exmo.com` | 138.201.188.181 | `server: trade-info/2.0.116` | REST, CCXT `urls.api.public` at `server/node_modules/ccxt/js/src/exmo.js` line 113 |
| `ws-api.exmo.com` | 190.115.31.221 | `server: ddos-guard` on the socket upgrade | WebSocket, see [`websocket.md`](./websocket.md) |
| `exmo.com` | 190.115.31.221 | web pages and `ctrl/feesAndLimits` | fee endpoint |
| `api.exmo.me` | 167.233.73.247 | the sister platform's REST, one pair | not CCXT's |
| `ws-api.exmo.me` | 185.178.208.182 | the sister platform's socket | not CCXT's |

| call | cold | warm |
|---|---|---|
| `GET /v1.1/pair_settings`, 5,266 bytes | 540 and 534 ms | 161 to 168 ms over 10 calls, P1 |
| `GET /v1.1/ticker`, 4,351 bytes | | two runs of 60 polls: min 164 and 158, median 167 and 161, p90 172 and 170, max 529 and 512 ms, none over 1 s, P3 |
| `GET /v1.1/order_book` for all 24 pairs at limit 1,000, 5,155 bytes | | 165, 175 and 164 ms, P2 |

Every public call from this host answered HTTP 200, and nothing was refused.
The host's traffic leaves through a Surfshark WireGuard exit that geolocates to Canada, and exmo.com's page data named the visitor country `CA`, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api.exmo.com/v1.1/pair_settings` returns one object keyed by pair, S1.
On 2026-09-23 it held 24 pairs, and every one is quoted in USDC, P1.

| field | example on `BTC_USDC` |
|---|---|
| `min_quantity`, `max_quantity` | `"0.00002"`, `"1000"` |
| `min_price`, `max_price` | `"0.01"`, `"200000"` |
| `min_amount`, `max_amount` | `"1"`, `"700000"` |
| `price_precision` | `2` |
| `commission_taker_percent`, `commission_maker_percent` | `"1"`, `"1"` |

The 24 pairs are `ADA`, `ARB`, `ATOM`, `BCH`, `BTC`, `DOGE`, `ENA`, `ETC`, `ETH`, `EUR`, `GAS`, `LTC`, `NEAR`, `PLN`, `PUMP`, `QTUM`, `SOL`, `TRX`, `UAH`, `USD`, `WIF`, `XLM`, `XRP` and `XTZ`, each against `USDC`.
There is no status field, so a listed pair is the only signal that it trades.
The 109 pairs of 2026-06-02, 86 of them against USDT, are all gone, see [`fees.md`](./fees.md) section 7.

### How CCXT 4.5.68 maps it

| engine need | CCXT | wire | match |
|---|---|---|---|
| perpetual catalog | 0 swap markets, `'swap': false` at `server/node_modules/ccxt/js/src/exmo.js` line 30 | no perpetual exists | the engine's active swap filter at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203 would find nothing |
| `market.id` | `BTC_USDC`, the `pair_settings` key, lines 891 to 897 | REST keys and socket topics spell the pair the same way | 24 of 24, P1 and [`websocket.md`](./websocket.md) section 3 |
| `contractSize` | `undefined`, line 926 | sizes are base currency quantities | the engine's fallback of 1 would be correct |
| `linear` | `undefined`, line 922 | spot | not applicable |
| `active` | `undefined`, line 920, on 24 of 24 | no status field | the engine keeps `active !== false`, so every pair would pass |
| `taker`, `maker` | 0.01 on 24 of 24, lines 924 and 925 | `commission_*_percent` `"1"` | exact |
| margin | `margin: false` on every market without credentials, because the margin pair list is private, lines 851 to 853 and 916 | | |

`loadMarkets` took 1,236 and 1,267 ms without credentials, P1.

### Pairs listed twice, and price scale

No pair is listed twice, and no pair carries a multiplier or a price scale.
`EUR_USDC`, `PLN_USDC`, `UAH_USDC` and `USD_USDC` are fiat currencies traded as bases.

## 3. Anchor

EXMO publishes no index, no mark and no funding rate, because it has no derivative, S1.
No public call returns any of the five `AnchorRow` columns.

The nearest reference is `GET /v1.1/ticker`, one bulk reply of 24 rows with `buy_price`, `sell_price`, `last_trade`, `high`, `low`, `avg`, `vol`, `vol_curr` and `updated` in Unix seconds, P3.
It is the venue's own book and last trade, not an external reference, so it cannot anchor anything.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index formula, basket, mark formula, clamp or funding formula to record.

How often the ticker changed over 60 one second polls on 2026-09-23 from 04:47:39 UTC, and again from 04:59:53 UTC, P3:

| field | pairs whose value changed | note |
|---|---|---|
| `buy_price`, `sell_price` | 0 of 24 in both runs | |
| `last_trade` | 0 of 24 in both runs | |
| `updated` | 0 of 24 in both runs | 3,243 s to 55,095 s old at the first poll of the first run |

On 12 of the 24 pairs `updated` read 1790083765, which is 2026-09-22 13:29:25 UTC, fifteen hours before the probe.
The most recent was `BTC_USDC` at 1790135617, 03:53:37 UTC on 2026-09-23.

## 5. REST book snapshot

`GET /v1.1/order_book?pair=<pair>[,<pair>…]&limit=<n>` returns every requested pair in one reply, S1.
`limit` defaults to 100 and is documented as at most 1,000, S1.
`limit=1` cut `BTC_USDC` to one bid, and `limit=5000` was accepted without an error, P2 and P4.

Each pair carries `ask_quantity`, `ask_amount`, `ask_top`, `bid_quantity`, `bid_amount`, `bid_top`, and `ask` and `bid` arrays of `["price", "quantity", "amount"]` strings, P2.
Bids are descending and asks ascending on 24 of 24 pairs, and `amount` equals price times quantity on every bid level, P2.
The top of each book equals the ticker's `buy_price` and `sell_price` on 24 of 24 pairs, P2.

What the books held on 2026-09-23 at 04:47, 04:55 and 04:59 UTC, identical in all three reads, P2:

| item | value |
|---|---|
| levels | one bid and one ask on 23 pairs. `BTC_USDC` adds a second bid of 0.00006 BTC at 0.01 USDC |
| touch spread | 196,262 to 206,452 ppm of the mid, that is about 20 % |
| bid against the book's own mid | -98,131 to -103,226 ppm, so each side sits about 10 % from the mid |
| quote size at the touch | 2,460 to 77,310 USDC on the bid, 3,000 to 93,223 USDC on the ask |
| `BTC_USDC` | bid 77,310 for 1 BTC, ask 94,490 for 0.98659564 BTC, mid 85,900 |

Against Kraken's USD books read in the same run at 04:55 UTC, P2:

| pair | Kraken mid | EXMO mid | EXMO mid against Kraken mid | EXMO bid against Kraken mid | EXMO ask against Kraken mid |
|---|---:|---:|---:|---:|---:|
| `BTC_USDC` | 87,199.95 | 85,900 | -14,908 ppm | -113,417 ppm | +83,602 ppm |
| `ETH_USDC` | 2,782.925 | 2,748 | -12,550 ppm | -111,295 ppm | +86,195 ppm |
| `SOL_USDC` | 119.635 | 117 | -22,025 ppm | -119,823 ppm | +75,772 ppm |
| `XRP_USDC` | 1.646465 | 1.55 | -58,589 ppm | -155,767 ppm | +38,589 ppm |

The second pass at 04:59 UTC read within 5,000 ppm of every cell above.

The books read as one quote band of about plus and minus 10 % around a reference that is not the live market and did not move during the probes.
That is an inference from the prices, since the API does not name who quotes.
No cross against another venue fits inside that band, and a cross outside it would come from a stale band, not from an edge.
Caching could not be judged, because nothing changed between reads.

## 6. Rate limits and errors

"The number of API requests is limited to 10 per/sec from one IP address or by a single user.", S1.
CCXT spaces requests by 100 ms, at `server/node_modules/ccxt/js/src/exmo.js` line 24.
No reply carried a rate limit header, and the probes stayed at no more than four requests a second, so the status a limit produces was not seen, P4.

Errors come back as HTTP 200, P4.

| request | reply |
|---|---|
| `order_book?pair=NOPE_USDC` | `{}` |
| `order_book?pair=BTC_USDT`, delisted here and listed on exmo.me | `{}` |
| `order_book` with no pair | `{"error":"Error 50013: Parameter 'pair' is not specified","result":false}` |
| `/v1.1/nope` | `{"result":false,"error":"Error 40015: API function do not exist - /v1.1/nope/"}` |
| `trades?pair=NOPE_USDC` | `{}` |

An unknown or delisted pair is silently absent, so a poller must check that every requested key came back.

## 7. Server time and clock offset

No public call returns the server time, S1.
The `Date` header has one second resolution.
The socket's millisecond `ts` arrived 108 to 114 ms after it was stamped, against a one way trip of about 108 ms, so this host's clock and EXMO's agree to within a few milliseconds, see [`websocket.md`](./websocket.md) section 5.

## 8. Recommended poller shape

None.
EXMO has no index, mark or funding to poll, and no perpetual to anchor.

| item | value | reason |
|---|---|---|
| anchor poller | none | section 3 |
| catalog refresh, if ever used | `pair_settings`, which CCXT reads | the only catalog, and it changed wholesale between June and September 2026 |
| skip | every pair, today | the books are a fixed 10 % band, section 5 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Exmo API, REST v1.1, Public API and API Rate Limits | https://documenter.getpostman.com/view/10287440/SzYXWKPi | 2026-09-23 | EXMO.com | calls, parameters, `limit` default and maximum, rate limit, sections 2 to 7 |
| S2 | CCXT 4.5.68 `exmo.js` | `server/node_modules/ccxt/js/src/exmo.js` | 2026-09-23 | CCXT | URLs, `rateLimit`, `fetchMarkets` mapping, sections 1, 2, 6 |
| P1 | `rest-probe.mjs catalog` at 04:47 UTC, and the second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) | 2026-09-23 | this host | DNS, timing, catalog, CCXT fields, sections 1 and 2 |
| P2 | `rest-probe.mjs book` at 04:47 and 04:55 UTC, and the second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) | 2026-09-23 | this host | the books, the Kraken compare, section 5 |
| P3 | `rest-probe.mjs ticker` at 04:47 UTC, and the second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) | 2026-09-23 | this host | ticker cadence and timing, sections 1, 3, 4 |
| P4 | `rest-probe.mjs errors` at 04:48 UTC, and the second pass at 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/exmo/rest-probe.mjs) | 2026-09-23 | this host | error shapes and headers, sections 5 and 6 |
