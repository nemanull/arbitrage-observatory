# CriptoSwaps REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:15 to 04:45 UTC on 2026-10-10, from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the public REST calls of CriptoSwaps for its spot market, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The site runs Openware's OpenDAX stack, as its start script's calls to `/api/v2/sonic/` and `/api/v2/barong/` and its bundle's `/api/v2/peatio/` and `/api/v2/ranger` paths show, S3.
CriptoSwaps publishes no API documentation, so the documented column is Openware's Peatio API v2, S1.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/criptoswaps/rest-probe.py), whose sections are numbered 1 to 6, run three times, the third after the config call was added to section 1.
CriptoSwaps has no CCXT class, see [`fees.md`](./fees.md) section 8.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| host | `www.criptoswaps.com`, which also serves the web app, base path `/api/v2/peatio/public/` | section 1 |
| resolved address | Cloudflare, 104.21.91.12 and 172.67.207.75, plus two IPv6 addresses | section 1 |
| edge | `cf-ray` ends in `YVR`, Vancouver | section 1 |
| caching | `cf-cache-status: DYNAMIC` and `cache-control: max-age=0, private, must-revalidate`, so nothing is cached at the edge | sections 1 and 4 |
| request time | cold 242 to 321 ms, warm 211 to 438 ms with medians 226 to 236 ms, over three runs | section 1 |
| access | no call was refused or geoblocked from the Canadian exit. The site config call `GET /api/v2/sonic/public/config`, whose HTTP 471 would send a browser to `/restriction`, answered 200 | sections 1 to 6 |

## 2. Catalog

| item | value | evidence |
|---|---|---|
| call | `GET /api/v2/peatio/public/markets`, 23,279 bytes, 468 to 535 ms | section 2, three runs |
| rows | 103, every one `"type":"spot"` and `"state":"enabled"` | section 2 |
| quote assets | USDT 78, BTC 13, ETH 6, BNB 5, WCP 1 | section 2 |
| row fields | `id`, `symbol`, `name`, `type`, `base_unit`, `quote_unit`, `min_price`, `max_price`, `min_amount`, `amount_precision`, `price_precision`, `state` | section 2 |
| market id | lowercase base plus quote, `btcusdt`, equal to `symbol` on every row, and the same spelling as the socket streams | section 2, [`websocket.md`](./websocket.md) section 3 |
| pagination | S1 documents a default `limit` of 100, but the call returns all 103 rows without one, and `limit=1000` returns the same 103 | section 2 |
| perpetuals | none: `?type=qe` returns `[]` and `?type=futures` returns 422 `{"errors":["public.market.invalid_market_type"]}` | section 2 |
| tickers | `GET /api/v2/peatio/public/markets/tickers`, 23,797 to 23,845 bytes, one key per market id, 103 keys, equal to the catalog | section 2 |
| inactive markets | 15 markets had a 24 hour base `amount` of 0, among them `zecusdt`, `bchusdt` and the house pair `wcswcp` | section 2, runs 2 and 3 |
| CoinMarketCap | `numMarketPairs` 83, so CoinMarketCap tracks fewer pairs than the catalog lists | section 2 |

CCXT has no class, so there is no `market.id`, `contractSize`, `linear` or `active` mapping to compare.
The book size unit is the base asset, such as BTC on `btcusdt`.
No pair is listed twice.

## 3. Anchor

CriptoSwaps publishes no index, mark or funding, because it lists only spot markets.
`GET /funding_rates`, `/markets/btcusdt/funding`, `/markets/btcusdt/mark_price` and `/qe/prices` under `/api/v2/peatio/public/` all answer 404, section 3.
No anchor poller is recommended.

The nearest thing to a reference price is the `price` field of `GET /api/v2/peatio/public/currencies`, 80 rows, section 3.
BTC read `82691.5221394374` there, close to the 24 hour `avg_price` of the `btcusdt` ticker, `82691.768762175`, read seconds earlier in run 2.
It is a venue-internal average, not an index, and it has no basket.

The same call shows which currencies can move.
Only `wg`, `csk`, `ordu` and `ldt` have `deposit_enabled` true, and only `wg`, `csk` and `ldt` have `withdrawal_enabled` true.
BTC, ETH, USDT and every other major currency have both false.

## 4. Anchor semantics

Not offered.
There is no index formula, mark price, funding formula or settlement to describe.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /api/v2/peatio/public/markets/<id>/depth?limit=<n>` returns `{"timestamp","asks","bids"}` with `[price, amount]` string pairs | section 4 |
| depth | S1 documents a default of 300. With no limit BTC/USDT returned 151 to 152 asks and 208 to 210 bids, the whole book. `limit` 1, 5 and 50 cut both sides to that count, 1000 returns the whole book, and 5000 answers 422 `public.market_depth.invalid_limit` | section 4 |
| level order | asks ascending, bids descending | section 4 |
| timestamp | `timestamp` in seconds, the time of the read, not of the last change | 12 polls 1 s apart: the timestamp advanced 14 or 15 s while the top 5 levels changed 0, 0 and 2 times in the three runs |
| order list | `GET /api/v2/peatio/public/markets/<id>/order-book?asks_limit=<n>&bids_limit=<n>` lists individual resting orders with their fee fields, default 20 a side, maximum 200, and 201 answers 422 | section 4, [`fees.md`](./fees.md) section 5 |
| trades | `GET /api/v2/peatio/public/markets/<id>/trades?limit=<n>`, maximum 1000. 1000 BTC/USDT trades spanned 17.3 to 17.4 hours, about 58 trades an hour | section 4 |
| caching | none at the edge, see section 1 | section 4 |

The books are thin, wide and close to Binance, section 4.

| market | spread, runs 1 to 3 | mid against Binance spot mid, runs 1 to 3 |
|---|---|---|
| BTC/USDT | 33.8, 33.8 and 33.8 bp | minus 12.1, minus 7.8 and minus 9.5 bp |
| ETH/USDT | 34.9, 34.9 and 34.9 bp | minus 12.8, minus 7.5 and minus 10.8 bp |
| BNB/USDT | 42.4, 42.4 and 42.4 bp | minus 9.2, minus 6.2 and minus 10.7 bp |
| DOGE/USDT | 46.3, 46.3 and 46.3 bp | 8.7, 21.5 and 14.5 bp |
| ADA/USDT | 47.8, 59.8 and 28.0 bp | 10.0, 12.0 and minus 12.0 bp |

The BTC/USDT best ask was `82724.94` for `0.003674` in every read over the 20 minutes of the three runs.
Nearly every resting order carries a zero fee, see [`fees.md`](./fees.md) section 5, and CoinMarketCap tags the venue "Auto Order Book Exchange".
Together these suggest the visible books are quoted by the venue's own market maker around a Binance reference.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limits | Not publicly specified | no CriptoSwaps page, and S1 names none |
| probed | 20 depth calls in 13.6 to 13.8 s all answered 200 in each run, and no response carried a rate limit or `Retry-After` header | section 5 |
| unknown market | 422 `{"errors":["public.market.doesnt_exist"]}`, also for the uppercase `BTCUSDT` | section 5 |
| bad parameter | 422 with a named error, such as `public.order_book.invalid_ask_limit` or `public.trade.invalid_limit` | sections 4 and 5 |
| unknown path | 404 with the plain text body `404 Not Found` | section 5 |
| server error | `GET /api/v2/peatio/public/version` answers 500 `{"errors":["server.internal_error"]}` | section 5 |

## 7. Server time

`GET /api/v2/peatio/public/timestamp` returns an ISO 8601 string with whole seconds, such as `"2026-10-10T04:32:35+00:00"`, section 6.
`GET /api/v2/barong/identity/time` returns `{"time":1791606756}` in seconds, equal to the local clock in the same second.
Against the request midpoint the body read 0.09 to 0.93 s behind, which is the whole-second truncation, so the clocks agree within one second.

## 8. Recommended poller shape

No anchor poller is recommended, because there is no index, mark or funding to poll.
CriptoSwaps cannot join the engine as a perpetual leg.

For a future spot leg the REST side would be small.

| use | call | interval |
|---|---|---|
| catalog | `GET /api/v2/peatio/public/markets`, keep rows with `state` `enabled` | at startup and hourly |
| book check | `GET /api/v2/peatio/public/markets/<id>/depth?limit=1000` | every few minutes per market, to catch the divergence in [`websocket.md`](./websocket.md) section 4 |
| fees | `GET /api/v2/peatio/public/trading_fees` | daily |
| transfer state | `GET /api/v2/peatio/public/currencies`, `deposit_enabled` and `withdrawal_enabled` | hourly, since a leg is only usable when its currencies can move |

Skip the 15 markets with no 24 hour volume and the `wcswcp` pair, whose fee row reads 20 %, see [`fees.md`](./fees.md) section 4.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Openware Peatio user API v2, branch 2-6-stable, the `/api/v2/peatio/public/` calls: `https://raw.githubusercontent.com/openware/peatio/2-6-stable/docs/api/peatio_user_api_v2.md` | 2026-10-09 |
| S2 | [`rest-probe.py`](../../../scripts/probes/venues/criptoswaps/rest-probe.py), three runs | 2026-10-09 |
| S3 | The web start script `https://www.criptoswaps.com/public/assets/config.js` and the bundle `https://www.criptoswaps.com/public/assets/bundle.78aa1abaf20c890dfbec.js` | 2026-10-09 |
| S4 | CoinMarketCap market pairs `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=criptoswaps&category=spot` and exchange record `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=criptoswaps` | 2026-10-09 |
| S5 | Binance spot `GET https://api.binance.com/api/v3/ticker/bookTicker` for the five reference symbols, rest probe section 4 | 2026-10-09 |
