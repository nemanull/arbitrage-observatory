# MAX (MaiCoin) REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:12 to 03:19 UTC, and the second pass 03:34 to 03:36 UTC, from the development host near Seattle.

This profile covers the public REST API of MAX Exchange for its spot market, since MAX lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/max-maicoin/rest-probe.mjs) unless a source row is named.
The v3 API is the current one, S1, and the v2 API still answers and still carries the only bulk ticker and the VIP fee table, S2.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `max-api.maicoin.com`, a CNAME to `max-api.maicoin.com.cdn.cloudflare.net` |
| resolved | `104.18.28.198` and `104.18.29.198`, Cloudflare, with `cf-ray` ending `-SEA` |
| cold request | `GET /api/v3/timestamp` 378 ms, and 337 ms in the second pass |
| warm request | 10 × `GET /api/v3/timestamp`: min 259, median 275, max 298 ms, and min 266, median 274, max 346 ms in the second pass |
| edge cached reply | `GET /api/v2/tickers` is served with `cache-control: public, max-age=3`. Over 60 one second polls it answered in a median of 16 ms in both runs, and the second run counted 48 `HIT` and 12 `EXPIRED`, an `age` header of 0 to 2 s, and the newest `at` 1 to 5 s behind the host clock, median 3 s |
| system status | `GET https://status-api-max.maicoin.com/api/status/max-api`, S1, answered 200 in 2,013 ms with `{"service":"max-api","status":"online","last_changed_at":"2026-07-29T07:32:57Z"}` |

The `depth`, `index_prices` and `vip_levels` calls returned `cache-control: max-age=0, private, must-revalidate` and `cf-cache-status: BYPASS`, so they reach the origin.
The WebSocket host is not behind Cloudflare, see [`websocket.md`](./websocket.md) section 1.

## 2. Catalog

### The instruments call

`GET /api/v3/markets` returns every market in one array, 14,505 bytes, in 213 ms and 207 ms.

```json
{"id":"maxtwd","status":"active","base_unit":"max","base_unit_precision":2,"min_base_amount":28,"quote_unit":"twd","quote_unit_precision":4,"min_quote_amount":250,"m_wallet_supported":false}
```

| count on 2026-09-23 UTC | value |
|---|---:|
| markets | 74, all `active` |
| quoted in `twd` | 41 |
| quoted in `usdt` | 32 |
| quoted in `btc` | 1, `ethbtc` |
| distinct bases | 42 |
| bases with both a `twd` and a `usdt` market | 31 |
| `m_wallet_supported` | 6: `btctwd`, `ethtwd`, `usdttwd`, `ethbtc`, `btcusdt`, `ethusdt` |

The status values are `active`, `suspended` and `cancel-only`, S2.
The 32 USDT markets are `max`, `btc`, `eth`, `bch`, `ltc`, `xrp`, `sand`, `usdc`, `link`, `doge`, `comp`, `dot`, `paxg`, `uni`, `pol`, `aave`, `xlm`, `ada`, `sol`, `shib`, `mask`, `ape`, `bnb`, `etc`, `arb`, `avax`, `trx`, `tao`, `sui`, `xaut`, `near` and `ondo` against `usdt`.
`GET /api/v2/markets` lists the same 74 ids with a `name` such as `MAX/TWD` and `market_status` in place of `status`.
No row carries a contract, settlement, expiry or contract size field.

Volume sits on TWD.
The v2 ticker at 03:12 UTC summed 4,232,814 USDT of 24 h quote volume over the 32 USDT markets, led by `ethusdt` at 2,132,686 and `btcusdt` at 1,360,854.
The 41 TWD markets summed 460,776,958 TWD, led by `usdttwd` at 235,068,694.

### How CCXT maps it

It does not, because CCXT 4.5.68 has no MAX class, and neither does CCXT master of 2026-09-22, see [`fees.md`](./fees.md) section 8.
The connector builds every venue from a CCXT class's `loadMarkets`, filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 203, so MAX would load nothing.
For a hand written loader, the facts it would need are these.

| field | MAX |
|---|---|
| `rawMarketId` | `id`, lower case such as `btcusdt`, identical to the socket's `M` and the `depth` call's `market` on all 74 markets |
| `base`, `quote` | `base_unit`, `quote_unit`, lower case |
| `linear` | not applicable, spot |
| `contractSize` | 1, since book sizes are base currency, see [`websocket.md`](./websocket.md) section 4 |
| active | `status === "active"` |

### Pairs listed twice, and price scale

31 bases trade against both `twd` and `usdt`.
TWD is not in the USD, USDC and USDT settlement family of [`../../implemented/2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so each base has at most one market in that family.
`usdcusdt` is a stablecoin pair and `twdusdt` appears only as an index key, section 3.
No market is quoted per 10 or per 1,000 units.

## 3. Anchor

MAX publishes no index, mark or funding for a perpetual, because it lists none.
No anchor poller is recommended.
An `AnchorRow` for MAX would have a mark of 0, and the reader refuses such a route at open with `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 and 38.

MAX does publish one reference price, the M-wallet index.

| call | reply | values | cadence |
|---|---|---|---|
| `GET /api/v3/wallet/m/index_prices` | 302 to 315 bytes, a map of 13 keys, median 291 and 283 ms, max 1,014 and 1,000 ms over two runs of 60 polls | `ethbtc`, `ethusdt`, `btcusdt`, `dogeusdt`, `linkusdt`, `ltcusdt`, `usdttwd`, `dogetwd`, `linktwd`, `btctwd`, `ethtwd`, `ltctwd`, `twdusdt`, as decimal strings | each key changed once in 60 polls a second apart, in both runs |
| `GET /api/v3/wallet/m/historical_index_prices?market=btcusdt&start_time=<ms>&end_time=<ms>` | `[{"timestamp": <ms>, "price": "<string>"}, …]`, at most 30 days a call, S1 | 9 rows, and 8 rows in the second pass, for a 10 minute window | rows 60,000 ms apart, with one 120,000 ms step in the second pass |

The index moves once a minute, which the reader's 10 s staleness rule could not use even if MAX had a mark.
It is a collateral price for margin loans, which is an inference from its path and its keys.
Its formula and basket are Not publicly specified.

The only bulk ticker is `GET /api/v2/tickers`, 18,350 to 18,403 bytes for all 74 markets, with `buy`, `sell`, `buy_vol`, `sell_vol`, `last`, `open`, `high`, `low`, `vol`, `vol_in_btc`, `vol_in_quote` and `at` in Unix seconds.
`GET /api/v3/tickers` requires `markets[]`, and without it answers 400 `markets is missing`.

## 4. Anchor semantics

| item | value |
|---|---|
| index formula and basket | Not publicly specified. `btcusdt` read `86521.76333333`, a value with a repeating third, which suggests a mean of three sources, and that is an inference |
| basket call | none public |
| mark | none |
| funding | none. M-wallet loans pay hourly interest instead, see [`fees.md`](./fees.md) section 6 |
| index against the MAX book | over 60 one second polls, the index minus the v2 ticker mid was a median of -323 ppm on `btcusdt`, range -428 to 1, and -84 ppm on `usdttwd`, range -84 to -66. The second pass read -153 ppm, range -311 to -121, and 0 ppm, range -58 to 5 |
| index change rate | once in 60 s on all 13 keys in both runs, and the history call spaces rows 60 s apart, with one 120 s step in the second pass |
| ticker change rate | over the same 60 polls the best bid or ask changed 10 times on `btcusdt`, 11 on `ethusdt`, 8 on `btctwd` and 0 on `usdttwd`, and 10, 10, 8 and 2 in the second pass. The newest `at` across all markets changed 15 times in each run, which fits the 3 s edge cache |

## 5. REST book snapshot

`GET /api/v3/depth?market=<id>&limit=<1 to 300>&sort_by_price=<bool>`, S1.

| item | value |
|---|---|
| depth | `limit` 1 to 300, default 300. `limit=301` and `limit=0` answer 400 `limit does not have a valid value` |
| reply keys | `timestamp` in Unix seconds, `last_update_version`, `last_update_id`, `asks`, `bids` |
| level order, default `sort_by_price=true` | asks descending, so the best ask is last, and bids descending, best first |
| level order, `sort_by_price=false` | asks ascending, best first, and bids descending, best first |
| numbers | price and size strings |
| time | `btcusdt` at 300 levels 1,010 ms and 286 ms, 14,284 and 14,289 bytes. `usdttwd` at 300 levels 242 and 250 ms. `btctwd` at 20 levels 412 and 242 ms |
| caching | `private`, `BYPASS`. `last_update_id` of `btcusdt` rose from 33555893 to 33555925 between two calls one second apart, and from 33588093 to 33588136 in the second pass |
| alignment with the socket | `last_update_id` and `last_update_version` are the socket's `li` and `v`, equal on four of six reads and one id apart on two, see [`websocket.md`](./websocket.md) section 4. A price can be spelled differently, `"2750938.0"` on REST against `"2750938"` on the socket |
| thin book | `gsttwd` at 300 levels returned 300 asks and 17 bids in both runs |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| public REST | 1,200 requests a minute per IP | S1 table "公開 API", and the FAQ on S3, "Public API allows 1200 requests per IP address every 1 minute." |
| private REST | 1,200 requests a minute per account | S1, S3 |
| a 429 | Not documented for REST. The WebSocket docs say a 429 bans the IP, carries `Retry-After` as a Unix time in seconds, and a retry during the ban extends it | S4 |
| probed | no 429 at up to about four requests a second in either run. No rate limit header was returned on any call | P1 |

Error shapes seen:

| request | status | body |
|---|---:|---|
| `depth?market=nopeusdt` | 400 | `{"success":false,"error":{"code":1001,"message":"market does not have a valid value"}}` |
| `depth?market=btcusdt&limit=301` | 400 | `{"success":false,"error":{"code":1001,"message":"limit does not have a valid value"}}` |
| `tickers` with no `markets[]` | 400 | `{"success":false,"error":{"code":1001,"message":"markets is missing"}}` |
| `tickers?markets[]=btcusdt&markets[]=nopeusdt` | 400 | `{"success":false,"error":{"code":1001,"message":"markets does not have a valid value"}}` |
| `ticker?market=nopeusdt` | 400 | `{"success":false,"error":{"code":1001,"message":"market does not have a valid value"}}` |
| `/api/v3/nope` | 404 | `{"error":{"code":404,"message":"Resource not found"}}` |
| `wallet/m/historical_index_prices` with no times | 400 | code 1001, `start_time is missing, …` |

## 7. Server time and clock offset

`GET /api/v3/timestamp` returns `{"timestamp":1790133162}` in whole seconds, and `GET /api/v2/timestamp` returns the bare number.
Five reads gave server time minus the local midpoint of -305 to -880 ms, with round trips of 275 to 893 ms, and -37 to -898 ms with round trips of 265 to 297 ms in the second pass.
Truncation to whole seconds alone puts that difference between -1,000 and 0 ms, so the host clock agrees with MAX within the one second resolution, and a finer offset cannot be read from this call.
The socket's `T` is in ms, and arrival minus `T` sat at 107 to 113 ms at p90 on busy books, which is the offset plus one way latency and server delay together, see [`websocket.md`](./websocket.md) section 3.

## 8. Recommended poller shape

None.
MAX has no mark, index or funding for a perpetual, and the M-wallet index moves once a minute.
If a later design adds spot legs, the book comes from the socket and needs no REST seed, since the socket sends a snapshot on subscribe.
`GET /api/v3/depth?market=<id>&limit=50&sort_by_price=false` is the call to reseed one market by hand, and its ids line up with the socket's.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | MAX V3 RESTful API List, OpenAPI 2.0 spec behind `https://max-api.maicoin.com/doc/v3.html`, in Chinese | https://max-api.maicoin.com/api/doc/external/v3 | 2026-09-22 | MAX | v3 endpoints, depth parameters, rate limit table, error format, system status API, sections 1 to 7 |
| S2 | MAX V2 API spec behind `https://max-api.maicoin.com/doc/v2.html` | https://max-api.maicoin.com/api/doc/external/v2 | 2026-09-22 | MAX | `vip_levels`, `tickers`, `summary`, market states, sections 2 and 3 |
| S3 | MAX Exchange RESTful API Documentation page | https://campaign.maicoin.com/en/api-document | 2026-09-22 | MAX | English FAQ on rate limits, section 6 |
| S4 | MAX Exchange WebSocket API, IP rate limit | https://maicoin.github.io/max-websocket-docs/ | 2026-09-22 | MAX | 429 ban and `Retry-After`, section 6 |
| P1 | `rest-probe.mjs all`, 03:17 to 03:19 UTC, and the second pass at 03:34 to 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/max-maicoin/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 8 |
| P2 | `curl` of `/api/v2/tickers` headers three times at 03:19 UTC, and the DNS lookups | this host | 2026-09-23 UTC | this host | edge cache, CNAME and addresses, section 1 |
