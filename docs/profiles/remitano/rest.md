# Remitano REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:58 to 03:22 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Remitano lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the public spot REST API.
Remitano has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/remitano/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S10 are those of [`fees.md`](./fees.md) section 10.
The short answer is that Remitano is a P2P venue with a thin limit order book on 25 USDT pairs, a REST book that the CDN caches for up to 30 minutes, and no index, mark or funding.

## 1. Host and latency from this machine

### Where the API lives

The developer site gives the base URL `https://api.remitano.com`, S3.
The public market calls are documented in the OpenAPI 2.0 document at `https://api.remitano.com/api/v1/doc`, S1, under the tags `Markets`, `Coingecko`, `Coinmarketcap`, `Volumes`, `Tickers` and `Rates`.
Two more calls the web app reads, `/api/v1/order_books` and `/api/v1/order_book_price_levels`, are not in that document, S5.

### Access, from the Canadian VPN exit

| request | status | reply |
|---|---|---|
| `GET https://remitano.com/` | 301 | `location: /global` |
| `GET https://remitano.com/global` | 403 | Cloudflare page titled "Just a moment...", `cf-mitigated: challenge` |
| `GET https://remitano.com/global/fees` | 403 | the same challenge |
| `GET https://remitano.com/policy/api_terms_of_service` | 200 | the web app HTML, 631,643 bytes, no challenge |
| `GET https://developers.remitano.com/` | 200 | the developer site |
| `GET https://api.remitano.com/` | 403 | the same challenge |
| `GET https://api.remitano.com/api/v1/doc` and `/api/v2/doc` | 200 | the OpenAPI documents |
| every `GET https://api.remitano.com/api/v1/...` public call below | 200 | JSON, `server: cloudflare`, edge `YVR` |

The challenge falls on the site's landing and fee pages and on the bare API host, not on the API paths.
No route around it was tried.

### Resolution

`api.remitano.com`, `remitano.com`, `socket.remitano.com`, `cablesocket.remitano.com`, `cdn.remitano.com` and `developers.remitano.com` all resolve to the same Cloudflare addresses, `104.18.28.12` and `104.18.29.12`, plus `2606:4700::6812:1c0c` and `2606:4700::6812:1d0c`.

### Latency

Six calls to `GET /api/v1/markets/exchange_info` half a second apart took 142, 44, 40, 43, 38 and 43 ms in the first run, and 166, 41, 32, 34, 37 and 43 ms in the second.
The first is a cold connection.
The warm times are short because Cloudflare answered from its cache, `cf-cache-status: HIT`, see section 5.

## 2. Catalog

### The instruments call

`GET https://api.remitano.com/api/v1/markets/exchange_info`, S1, returned about 8.6 KB with 25 pairs, every one quoted in USDT:

`BTC_USDT`, `ETH_USDT`, `BCH_USDT`, `LTC_USDT`, `XRP_USDT`, `BNB_USDT`, `ADA_USDT`, `XLM_USDT`, `TRX_USDT`, `XTZ_USDT`, `LINK_USDT`, `ETC_USDT`, `DOT_USDT`, `DOGE_USDT`, `UNI_USDT`, `SOL_USDT`, `AVAX_USDT`, `NEAR_USDT`, `USDC_USDT`, `AXS_USDT`, `POL_USDT`, `SHIB_USDT`, `FIVE_USDT`, `RENEC_USDT`, `S_USDT`.

Each row holds `trading_pairs`, `last_price`, `lowest_ask`, `highest_bid`, `base_volume`, `quote_volume`, `price_change_percent_24h`, `highest_price_24h` and `lowest_price_24h`, all as decimal strings.
There is no status field, no tick size, no lot size and no minimum.
`FIVE_USDT` had a `highest_bid` of zero.
`GET /api/v1/coinmarketcap/exchange_info` returns the same body, and `GET /api/v1/coingecko/pairs` lists the same 25 pairs.

The top of book spread is wide.
The narrowest were `USDC_USDT` at 11,604 ppm and `BTC_USDT` at 12,228 ppm, and the widest was `S_USDT` at 110,588 ppm, in both runs.

### Other spellings and other markets

| call | spelling | count |
|---|---|---|
| `exchange_info`, `coingecko/pairs`, the REST book path | `BTC_USDT` | 25 |
| `GET /api/v1/markets/24h` | `BTCUSDT` | 26, the extra one is `REUSDUSDT` |
| `GET /api/v1/tickers/price` | `BTCUSDT` | 31 |
| the fee map and the socket's `order_book_pair` | `btc_usdt` and `usdt_btc`, one per direction | 1,196 in the fee map, 1,650 in the level state |
| `GET /api/v1/volumes/market_summaries` | `BTCAED` | 166, the P2P fiat rates |

The level state `GET /api/v1/order_book_price_levels` holds 1,650 directed pairs, and 238 of them had any level.
Fiat quoted books such as `RENEC_VND` answer on the REST book path, though `exchange_info` does not list them.

### How CCXT maps it

There is no CCXT class, so there is no `market.id`, `contractSize`, `linear` or `active` to compare.
A hand-built catalog would take `trading_pairs` as the id for REST and `x_usdt` with `usdt_x` for the socket.

### Size unit, pairs listed twice, and price scale

Sizes are in base units, since the first BTC ask of `0.0000120897` at 82,699 is 0.9998 USDT.
No pair is listed twice and no price is scaled.

## 3. Anchor

Remitano publishes no index price, no mark price and no funding rate, because it lists no perpetual.

The reference prices it does publish are these.

- `GET /api/v1/rates/ads`, "bid/ask of coin currencies for all fiat currencies", S1, built from P2P adverts.
  It returned 115 countries, and the Canadian row had a BTC bid of 95,626.99 CAD and a BTC ask of 202,256.15 CAD.
- `GET /api/v1/tickers/price`, documented as the coins "with latest bid price and ask price", with a fallback "to non-amm price from open exchange", S1.
  All 31 of its rows had `bid` equal to `ask`, so it is a swap quote and not a book.
- `GET /api/v1/altcoins`, whose rows name a `default_exchange` such as `bitstamp_BTCUSD`, S1.
- The socket room `exchange_rates`, which carries other venues' prices such as `bitstamp_BTCUSD` and `binance_BTCUSD`, see [`websocket.md`](./websocket.md) section 2.

None of them is an index of the book, and none can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding to describe.
The REST book and the ticker did not change over a minute of polls, but that came from the CDN cache and not from the market, see section 5.

## 5. REST book snapshot

### The call

`GET https://api.remitano.com/api/v1/markets/{market_pair}/order_books?depth=N`, S1, documents `depth` "from 1 to 500", default 100.
`GET /api/v1/coingecko/orderbook?ticker_id=BTC_USDT&depth=10` and `GET /api/v1/coinmarketcap/order_books/BTC_USDT` return the same levels.
The reply below is trimmed to one level per side.

```json
{"ticker_id":"BTC_USDT","timestamp":1791602051784,
 "asks":[["82699.000000000000000000","0.000012089700000000"]],
 "bids":[["81699.999999996000000000","0.000012209302325582"]]}
```

### Depth limits

| `depth` | status | levels returned for `ETH_USDT` |
|---:|---:|---|
| 5 | 200 | 5 asks, 5 bids |
| 20 | 200 | 20 asks, 20 bids |
| 100 | 200 | 100 asks, 49 bids |
| 500 | 200 | 100 asks, 49 bids |
| 501 | 400 | `{"error":"depth not in range from 1 to 500"}` |
| 0 | 400 | the same error |

So the reply stops at 100 levels per side whatever `depth` says.
At `depth=100`, 20 of the 25 pairs had 100 asks, but only `BTC_USDT` had 100 bids, and the others had 6 to 49 bids, except `FIVE_USDT` with none.
`FIVE_USDT` had 16 asks and no bid, and `USDC_USDT` had 2 asks and 7 bids.

### Level order and values

Asks ascend and bids descend, and the book was not crossed.
Prices and sizes are strings with 18 decimal places.
The bids carry floating point residue such as `81699.999999996`, because they are inverted from the `usdt_btc` direction, see [`websocket.md`](./websocket.md) section 4.
The 100 asks of `BTC_USDT` equalled the `btc_usdt` levels of `/api/v1/order_book_price_levels` exactly, in both runs.

### Unknown and odd symbols

| path | status | reply |
|---|---|---|
| `NOPE_USDT` | 200 | `"asks":[],"bids":[]` |
| `BTCUSDT` | 200 | empty book |
| `btc_usdt` | 200 | the BTC book, `ticker_id` upper cased |
| `RENEC_VND` | 200 | a real book, though not in the catalog |

An unknown pair is a silent empty book and not an error.

### Caching

The book carries `cache-control: public, max-age=1800`, and Cloudflare honours it.
Thirty polls of `BTC_USDT?depth=20` two seconds apart returned one `timestamp` and one top of book, with `cf-cache-status` `HIT` after the first, in both runs.
The book `timestamp` is Unix ms in UTC and was 0.8 s from the `Date` header on a fresh reply.
On the last of the thirty polls the snapshot was 59 s older than the `Date` header.
So a REST book can be up to 30 minutes old, and its `timestamp` is the only way to see that.
The `exchange_info` reply has the same header and was served `HIT` with prices 47 s and 54 s old in the two runs.
`/api/v1/order_book_price_levels` instead carries `max-age=1`, returned about 332 KB in 240 to 250 ms, and is what the web app reads.

## 6. Rate limits and errors

The OpenAPI document lists 400, 401, 422, 429 "Too Many Requests" and 503, S1.
Its 503 row includes the reason "API usage limit", and says "If you reach API usage limits a 503 will be returned, please wait until you can do the call again."
It gives no number for any limit.
Ten calls to `/api/v1/markets/24h` at five per second all returned 200, and no reply carried a rate limit or `Retry-After` header.
A bad parameter returns 400 with `{"error":"..."}` and `cache-control: no-cache`.

## 7. Server time and clock offset

There is no server time call.
`exchange_info` carries `server_time` as an integer in seconds, though the document types it as a string, S1.
It read 25,153 s and 25,146 s ahead of the `Date` header in the two runs.
That is seven hours, 25,200 s, less the 47 s and 54 s the cached reply had aged, so `server_time` is Vietnam local time written as if it were UTC.
The book `timestamp` is true UTC.

## 8. Recommended poller shape

None.
There is no anchor to poll, and Remitano cannot be a perpetual leg.

If a later design adds spot legs, the catalog is `exchange_info` read once an hour, and the book seed is `GET /api/v1/order_book_price_levels` every 60 s as the web app does, never the cached `/markets/{pair}/order_books`.
Every book row should be dropped when its age passes a few seconds, which the cached REST book would fail most of the time.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.remitano.com/api/v1/doc` | the market calls, the depth range, the status codes, the `server_time` type |
| S3 | `https://developers.remitano.com/docs/getting-started/getting-started/` | the base URL |
| S5 | `https://cdn.remitano.com/assets/chunks/react-35b6ed4f.js` | the two undocumented calls |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/remitano/rest-probe.py), first run and second pass run | every probed number above |
