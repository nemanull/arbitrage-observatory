# BIT.TEAM REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:00 to 04:25 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

BIT.TEAM lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/bit-team/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S5 are those of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

### Where the API lives

The public REST API is `https://bit.team/trade/api`, S1 and S3 line 168.
CCXT also names `https://history.bit.team` for candles, S3 line 167.
Public calls are `GET` and need no key.
Private calls use HTTP Basic authentication, with the header `authorization: Basic base64(key1:key2)` built from the key pair made in the profile, S1.

### Access, from the Canadian VPN exit

`ipinfo.io` placed the exit in Vancouver, British Columbia, CA, on AS212238 Datacamp Limited, `rest-probe.py access`.
Every public call answered through DDoS-Guard, with `server: ddos-guard` and the cookies `__ddg1_`, `__ddg8_`, `__ddg9_` and `__ddg10_`, and no challenge page, geoblock or refusal.
The site, the API document, the catalog, the books and the socket all answered from this exit.
`p2p.bit.team`, the fee page host CoinMarketCap names, does not resolve, `gaierror(-2, 'Name or service not known')`.

### Resolution

`bit.team`, `history.bit.team` and `api-v2.bit.team` all resolved to the single address `185.178.208.156`, a DDoS-Guard front.

### Latency

Five calls to `GET /trade/api/cmc/orderbook/btc_usdt` over a fresh connection each took 338, 300, 1232, 340 and 1319 ms in the first run, median 340 ms, and 1285, 909, 323, 591 and 609 ms in the second, median 609 ms.
Across the book mode most calls took 310 to 470 ms, with outliers of 1.4 and 6.4 s in the first run and none in the second.
The home page took 3.1 s in the first run and 59.1 s in the second, and the API document took 0.4 to 4.0 s, so the front is slow at times.

## 2. Catalog

### The instruments call

`GET /trade/api/ccxt/pairs` returns `{"ok":true,"result":{"count":41,"pairs":[...]}}`, 41 pairs in about 27 KB.
One row, with the volume fields left out:

```json
{"id":22,"name":"btc_usdt","baseAssetId":11,"quoteAssetId":3,"fullName":"BTC USDT","active":true,"baseStep":8,"quoteStep":6,"status":1,"settings":{"limit_usd":"0.1","price_max":"10000000000000","price_min":"1","price_tick":"1","pricescale":10000,"lot_size_max":"1000000000000000","lot_size_min":"1","lot_size_tick":"1","price_view_min":6,"default_slippage":10,"lot_size_view_min":6},"updateId":"1366","timeStart":"2021-03-01T13:04:52.512Z","makerFee":200,"takerFee":200}
```

| `status` | `active` | pairs |
|---|---|---|
| 1 | true | 12: `bnb_rub`, `btc_rub`, `btc_usdt`, `btt_usdt`, `del_rub`, `del_usdt`, `eth_rub`, `eth_usdt`, `ton_rub`, `trx_rub`, `trx_usdt`, `usdt_rub` |
| 0 | false | 16 |
| 2 | false | 13 |

The web app keeps only rows with `status` 1, S2, and `active` is true exactly on those rows.
The 12 trading pairs are 7 quoted in RUB and 5 in USDT.
`/trade/api/pairs` returns the same 41 names, and `/trade/api/pair/{name}` returns one row with prices as strings and the pair's own book.
CoinMarketCap lists 10 spot pairs, S4.

Volume is thin and concentrated.
In the first run `del_rub` showed `volume24USD` of about 156,886, `usdt_rub` about 102,467 and `del_usdt` about 88,740, while `btc_usdt` showed about 261, `btc_rub` about 125 and `trx_usdt` about 52, and the second run was within 0.2 % of those.
DEL is the coin of Decimal chain, which the bundle names as `decimalCoin`, S2.

### How CCXT maps it

CCXT's `fetchMarkets` reads `/trade/api/ccxt/pairs`, line 368, and `parseMarket` sets `id` to `name`, such as `btc_usdt`, and `numericId` to `id`, with `type` `spot`, S3 lines 459 to 527.
`active` is copied from the row, so 12 of the 41 markets are active.
`precision` comes from `baseStep` and `quoteStep` as decimal places, so `BTC/USDT` has an amount step of 1e-08 and a price step of 1e-06, `fees-probe.py ccxt`.
The REST book takes the `name`, and the socket takes the numeric `id`, see [`websocket.md`](./websocket.md) section 3.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset.
No pair is listed twice.
`baseStep` and `quoteStep` are decimal places, 8 and 6 on `btc_usdt`.
`settings` pairs `price_tick` with `pricescale` as 1 and 10000, 1 and 1000000, or 100 and 10000 across the 41 rows, and the `btc_usdt` book shows prices with 6 decimals, so no field states the effective tick plainly.

## 3. Anchor

BIT.TEAM publishes no index price, no mark price and no funding rate, because it lists no perpetual.
`/trade/api/futures/pairs`, `/trade/api/perpetual/pairs`, `/trade/api/contracts`, `/trade/api/funding`, `/trade/api/mark-price` and `/trade/api/index` each answered HTTP 404 `{"ok":false,"code":404000,"data":{},"message":"Not Found"}`, and `/futures` and `/trade/futures` answered 404 with the site's HTML, `rest-probe.py errors`.
The only reference prices are the venue's own last trade prices on `GET /trade/api/cmc/ticker`, `GET /trade/api/cmc/summary` and `GET /trade/api/rates`, and the socket `/prices` channel.
`/trade/api/rates` returns 6 rows of a `price` against USDT with a week of hourly points.
None of them is an index, and none can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

### The call

Two public calls return the same book.

| call | shape | numbers | extra |
|---|---|---|---|
| `GET /trade/api/orderbooks/{name}` | `{"ok":true,"result":{"bids":[["83145.738467","0.00014849"],...],"asks":[...],"symbol":"BTC/USDT"}}` | strings | the unified symbol |
| `GET /trade/api/cmc/orderbook/{name}` | `{"timestamp":1791605218047,"bids":[[83145.738467,0.00014849],...],"asks":[...]}` | JSON numbers | a `timestamp` in Unix milliseconds |

On every one of the 12 trading pairs both calls returned the same depth and the same top of book.
CCXT's `fetchOrderBook` uses the CMC call, S3 lines 829 to 837.
The CMC `timestamp` was 97 to 183 ms behind the local clock on most replies of both runs, about the one way trip, so it reads as the time of the reply and not the time of the last book change.

### Depth limits

The book returns every level the venue holds, up to 100 a side or more.
`usdt_rub` returned 155 bids and 138 asks, `del_usdt` 100 bids, `btc_usdt` 99 bids and 68 asks, and `btt_usdt` 10 bids and 15 asks.
`?depth=5`, `?limit=5`, `?depth=500&level=2` and `?level=3` changed nothing on either call.
CCXT's comment says "default 100, max 200", S3 line 825, and sends no limit.

### Grouping

None.
No level repeated a price on any of the 12 books.

### Level order and values

Bids are best first, descending, and asks best first, ascending, on every pair.
No book was crossed and no level had size zero.
Each level is `[price, size]` with size in the base asset.

### Ticker and trades

`GET /trade/api/cmc/ticker` returns an object keyed by upper case pair, 41 entries, such as `"BTC_USDT":{"base_id":11,"quote_id":3,"last_price":84066.850782,"base_volume":0.0030362,"quote_volume":254.62230339205178,"isFrozen":0}`.
It has no bid or ask.
`GET /trade/api/cmc/summary` returns a list of 41 entries that does carry `highest_bid` and `lowest_ask`.

### Unknown and odd symbols

| call | reply |
|---|---|
| `orderbooks/foo_bar` | HTTP 404 `{"ok":false,"code":404000,"data":{},"message":"Symbol foo_bar was not found"}` |
| `orderbooks/BTC_USDT` | HTTP 200, the `btc_usdt` book, so case is ignored |
| `orderbooks/eth_btc`, a pair with `status` 0 | HTTP 200 with a book |
| `orderbooks/22`, the numeric id | HTTP 400 `{"ok":false,"code":400000,"data":{},"message":"Invalid request params input"}` |
| `cmc/orderbook/foo_bar` | HTTP 500 `{"ok":false,"code":500000,"message":"Internal server error"}` |
| `cmc/orderbook/BTC_USDT` | HTTP 200, the book |
| `pair/foo_bar` | HTTP 404 `{"ok":false,"code":404200,"message":"Pair not found"}` |

A pair that is not trading still has a book, so a client has to filter by `status` itself.

### Caching

Every book reply carried `cache-control: no-cache` and `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0`, so DDoS-Guard does not cache it.

## 6. Rate limits and errors

No rate limit is published.
The API document S1 names none, and CCXT sets `rateLimit` 1 with the comment "the exchange has no rate limit", S3 line 24.
Twenty sequential catalog calls took 18.9 s in the first run and 17.1 s in the second, and all answered HTTP 200 with no rate limit or `Retry-After` header, `rest-probe.py burst`.
The probe never ran calls in parallel, and the DDoS-Guard threshold was not tested.

Errors are `{"ok":false,"code":<six digits>,"message":"..."}` with a matching HTTP status, where the first three digits of `code` repeat the status.
Private paths answer HTTP 401 with code 401010 and the message "p2p_access_token and p2p_refresh_token are required in cookies" when called without a login, `fees-probe.py private`.
Some public paths fail on the server, `GET /trade/api/stats` and `GET /trade/api/markdown/menu` answered HTTP 500 with code 500000.

## 7. Server time and clock offset

The API has no time call.
`GET https://history.bit.team/api/tw/time`, which the web app uses for its chart, returns Unix seconds as a bare number, such as `1791605282`.
It matched the local clock, which is NTP synchronised, at one second resolution, with offsets of 0.0 and 0.2 s in the two runs.
The `Date` header agreed with the local clock to within one second.

## 8. Recommended poller shape

None for the engine as it stands.
There is no anchor to poll, and BIT.TEAM has no perpetual for the engine to price.

If a later design adds RUB or USDT spot legs, REST is needed for the catalog and to seed books, because the socket sends no snapshot on subscribe, see [`websocket.md`](./websocket.md) section 4.

- Load the catalog from `GET /trade/api/ccxt/pairs`, keep rows with `status` 1, and map `name` for REST and `id` for the socket.
- Read the taker per pair from `takerFee`, since two pairs charge 0.5 % and not 0.2 %, see [`fees.md`](./fees.md) section 4.
- Seed each book once with `GET /trade/api/orderbooks/<name>`, one call at a time, and replace it with the first socket push.
- Reseed a quiet pair every few minutes, since its socket can stay silent that long.
- Read RUB and USDT as separate quote families, since RUB is not USD.

## 9. Source ledger

The sources are S1 to S5 of [`fees.md`](./fees.md) section 10.
S1, the Swagger document, holds the paths, their parameters and the Basic authentication rule.
S2, the Nuxt bundle, holds the `status` 1 filter, the history time call and the `decimalCoin` setting.
S3, the CCXT class, holds the mapping in section 2 and the book call in section 5.
