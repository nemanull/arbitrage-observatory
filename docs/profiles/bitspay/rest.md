# Bitspay REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:15 to 03:34 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public REST surface of Bitspay (no CCXT id), on its spot market, since Bitspay lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The public API is documented at `https://api.bitspay.io/`, S1, and served from `https://apiv2.bitspay.io`.
Every call is an unsigned `GET` and answers JSON.
The numbers below are from [`rest-probe.py`](../../../scripts/probes/venues/bitspay/rest-probe.py), P1, second pass at 03:32 UTC, unless a run is named.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `apiv2.bitspay.io`, resolved to `104.21.91.130`, `172.67.219.205`, `2606:4700:3031::6815:5b82` and `2606:4700:3031::ac43:dbcd` |
| other hosts | `www`, `api`, `node` and `socket.bitspay.io` resolve to the same four addresses |
| front | Cloudflare, `cf-ray` ending `YVR`, with `x-powered-by: Express` from the origin |
| `GET /info` | cold 466 ms with TCP and TLS, warm on the same connection min 152, median 158, max 196 ms over 5 |
| slow replies | one `orderbook/BTC_USDT` took 10,283 ms in the first run and 1,577 ms in the second pass, and the slowest of 60 book polls took 1,356 ms |
| access | 82 requests in the second pass, all 200, no refusal and no region message |

## 2. Catalog

### The instruments call

`GET /markets/` returns `{"status":1,"message":"Success","combinations":[{"id":"BTC_USDT","base":"BTC","quote":"USDT"},…]}`, S1, P1.

| item | value | source |
|---|---|---|
| pairs | 65 | P1 |
| by quote | USDT 21, USDC 12, ETH 11, BNB 11, BTC 10 | P1 |
| status field | none, every listed pair is presented as live | P1 |
| `getavailablepairs/` and `coingecko/pairs` | the same 65 ids | P1 |
| `ticker/all` | 54 rows, 34,267 bytes, every row `market_type` `SPOT` | P1 |
| `getCompleteMarkets/` | 61 rows, all `SPOT`, 7 with zero `baseVolume` | P1 |
| ids with no ticker row | `BSP_USDT`, `BTB_USDT`, `CPR_USDT`, `FAITH_USDT`, `ISO9000_USDT`, `MGO_USDT`, `POPECASH_USDT`, `STACO_USDT`, `USD_USDC`, `XGO_BTC` | P1 |
| CoinMarketCap | 46 spot pairs tracked | P3 |

The id is `BASE_QUOTE` in upper case, and the lower case `btc_usdt` is refused as `Invalid Market`, P1.

### How CCXT maps it

There is no CCXT class in 4.5.68 or on the current `master`, see [`fees.md`](./fees.md) section 8.

### Ticker fields that cannot be used

The `ticker/all` `bid` and `ask` are not a best bid and offer.
In the second pass 50 of 54 rows had `bid` above `ask` and the other 4 had them equal, P1.
On `BTC_USDT` the row said `bid` 82738.39 and `ask` 82597.58 while the book said best bid 82562.35 and best ask 82590.32, P1.

The trade list swaps its volume fields.
On the newest `BTC_USDT` trade, `quoteVolume` 0.00601193 times the price gives 496.57, which is `baseVolume`, so `quoteVolume` holds the base amount and `baseVolume` the quote amount, P1.

## 3. Anchor

### The bulk calls

None.
Bitspay publishes no index price, no mark price and no funding rate, because it lists no perpetual, S1, P1.

The nearest reference numbers are per pair fields in `ticker/all`, P1.

| field | meaning | example, `BTC_USDT` |
|---|---|---|
| `last` | last trade price | 82597.57922693 |
| `vendorusd` | a USD rate for the base asset | per row |
| `marketusd` | a USD rate for the quote asset | per row |
| `updated_at` | Unix ms of the row | 1791603006000, 03:30:06 UTC |

### Row mapping

No `AnchorRow` can be filled.
A route with a Bitspay leg would have `mark` 0 and be refused at open, as section 4 of [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) says.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.

Book movement was measured instead.
Over 60 s of polls every 2 s, of both `orderbook/BTC_USDT?depth=20` and `coingecko/orderbook?ticker_id=BTC_USDT&depth=20`, neither the top of book nor any of the 20 levels changed, in the second run at 03:29 UTC or the second pass at 03:32 UTC, P1.
The two paths returned the same 20 levels on all 30 polls of the second pass, P1.
The trade list holds 200 `BTC_USDT` trades from 02:15:39 to 03:24:54 UTC, about one every 21 s, and none after it, P1.
So the book moves with the trades, and it was idle for the whole probe window.

The book tracks the wider market.
Its mid was 82576.34 against Kraken's `XBTUSDT` mid of 82590.05, 1.7 bps lower, P1.
CoinMarketCap's record carries the tag `[Internal] Auto Order Book Exchange`, P3, and the regular 21 s trade rhythm fits automated quoting, which is an inference.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET /orderbook/{pair}`, and `GET /depth/{pair}` is byte identical | S1, P1 |
| shape | `{"status":1,"message":"Success","asks":[{"price":"82590.32425808","quantity":"0.02901925"},…],"bids":[…],"ticker_id":"BTC_USDT","last":"82597.57922693"}` | P1 |
| aggregation | one level per price, no duplicate prices | P1 |
| full depth | 398 asks and 404 bids on `BTC_USDT`, 40,999 bytes, from 80830.99652010 to 84123.79487761 | P1 |
| depth parameter | `?depth=N` returns N/2 levels per side, `depth=10` gave 5 and 5 | P1 |
| CoinGecko path | `GET /coingecko/orderbook?ticker_id={pair}&depth=N`, the same rule, `depth=20` gave 10 and 10, `depth=100` gave 50 and 50, `depth=1000` gave the full book | S1, P1 |
| level order | asks ascending, bids descending | P1 |
| numbers | decimal strings, with 8 decimals on every level shown in the reply sample | P1 |
| size unit | base currency | S1, P1 |
| spread | best bid 82562.34780930, best ask 82590.32425808, 3.4 bps, not crossed | P1 |
| thin pair | `OMG_BNB` had 9 asks and 83 bids | P1 |
| timestamp | none in the reply | P1 |
| caching | weak `etag`, `cf-cache-status: DYNAMIC`, no `cache-control` | P1 |
| per order view | `GET /getOrderBook/{pair}` lists 802 individual orders, 112,773 bytes, with `orders_id`, `ordertype`, `coins` and `cost` | P1 |

So 40 levels per side, enough for the engine's 20, need `depth=80`.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published limit | none, the error table lists code 4 "Too many attempts" with no number | S1 |
| headers | no rate limit or `Retry-After` header on any of 82 replies | P1 |
| unknown pair | 200 `{"status":0,"message":"Invalid Market","orderbook":[]}` | P1 |
| unknown pair on `getSelectedMarket/` | 200 `{"status":0,"message":"Invalid Market","marketdetails":[]}` | P1 |
| unknown path | 200 `{"status":0,"message":"Under Maintanance"}` | P1 |

Every error is HTTP 200, so a client must read `status`, where 1 is success and 0 an error, S1.

## 7. Server time and clock offset

No server time call is documented, S1.
The `Date` header read 0.8 s behind the local clock in the second pass and 1.0 and 1.3 s behind in the first two runs, at one second resolution, P1.

## 8. Recommended poller shape

No anchor poller, because there is nothing to anchor.

A spot stage, if one is ever built, would read its book here, since the socket carries none, see [`websocket.md`](./websocket.md) section 8.

| item | value |
|---|---|
| catalog | `GET /markets/` once, minus the ids with no `ticker/all` row |
| book | `GET /orderbook/{pair}?depth=80` per pair, 40 levels per side |
| trigger | the socket's `refreshorders` for the pair, with a timed poll as the fallback |
| interval | not published, so start slow, such as one pair per second, and back off on `status` 4 |
| skip | `ticker/all` `bid` and `ask`, and the trade volume fields as named |

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://api.bitspay.io/`, the public API documentation page | 2026-10-10 03:15 UTC |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/bitspay/rest-probe.py), first run 03:27 UTC, second run 03:29 UTC, second pass 03:32 UTC | 2026-10-10 |
| P3 | [`fees-probe.py`](../../../scripts/probes/venues/bitspay/fees-probe.py), CoinMarketCap record and pair counts | 2026-10-10 |
