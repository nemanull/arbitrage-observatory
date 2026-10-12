# Coinmate REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:37 to 04:01 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Coinmate lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/coinmate/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S6 are those of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

### Where the API lives

The public REST API is `https://coinmate.io/api`, S3 and S4 line 120.
Public calls are `GET` with query parameters and need no key, and private calls are `POST` with a form body signed by HMAC-SHA256 over nonce, client id and public key, S3.

### Access, from the Canadian VPN exit

`ipinfo.io` placed the exit in Vancouver, British Columbia, CA, on AS212238 Datacamp Limited, `rest-probe.py host`.
Every public call answered HTTP 200 through Cloudflare, with `cf-ray` ending `-YVR`, the Vancouver edge.
No challenge, geoblock or refusal was seen on the API, the web app's `/frontend/*` JSON, or the socket.

### Resolution

`coinmate.io` resolved to Cloudflare addresses `104.26.0.82`, `104.26.1.82` and `172.67.71.55`, plus three IPv6 addresses.
TCP and TLS 1.3 to `104.26.0.82` took 46.7 ms in the first run and 20.2 ms in the second.

### Latency

`GET /system/time` over a fresh connection each time took 493.8, 187.7, 171.9 and 177.4 ms in the first run, and 186.6, 176.9, 174.8 and 196.0 ms in the second.
The probe opens a new TLS connection per call, so a kept-alive client would be faster.

## 2. Catalog

### The instruments call

`GET /api/tradingPairs` returns 15 pairs in 3,389 bytes, inside `{"error":false,"errorMessage":null,"data":[...]}`:

```json
{"name":"BTC_EUR","firstCurrency":"BTC","secondCurrency":"EUR","priceDecimals":1,"lotDecimals":8,"minAmount":0.000015,"tradesWebSocketChannelId":null,"orderBookWebSocketChannelId":null,"tradeStatisticsWebSocketChannelId":null}
```

The 15 names are `BTC_EUR`, `BTC_CZK`, `USDC_CZK`, `USDC_EUR`, `ETH_EUR`, `ETH_CZK`, `ETH_BTC`, `ADA_EUR`, `ADA_CZK`, `SOL_EUR`, `SOL_CZK`, `LTC_EUR`, `LTC_CZK`, `XRP_EUR` and `XRP_CZK`.
That is seven bases against EUR, the same seven against CZK, and `ETH_BTC`.
No pair is quoted in USDT or USD, and USDC appears only as a base.
The three `*WebSocketChannelId` fields are null on every row, although the Apiary example fills them with names such as `order_book-BTC_EUR`, S3.
The channel names still work when built by hand, see [`websocket.md`](./websocket.md) section 4.

`GET /api/products` returns the same 15 pairs with a dash, `BTC-EUR`, and a `status` field that was `TRADING` on all 15.
`/tradingPairs` has no status field, so `/products` is the only place a halted pair would show.
CoinMarketCap lists the same 15 spot pairs, S5.

### How CCXT maps it

CCXT's `fetchMarkets` reads `/tradingPairs` and sets `id` to `name`, such as `BTC_EUR`, with `type` `spot`, S4 lines 360 to 442.
That id is the spelling the REST book and the socket channel use.
`active` is left undefined because the call has no status, and `contractSize` and `linear` are undefined because there are no contracts.
`ccxt-probe.py` loaded 15 markets, all `spot`, with those values.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset, so `amount` 0.10860775 on `BTC_EUR` is BTC.
No pair is listed twice.
`priceDecimals` and `lotDecimals` give the tick and lot, for example 1 and 8 on `BTC_EUR`, so the tick there is 0.1 EUR.

## 3. Anchor

Coinmate publishes no index price, no mark price and no funding rate, because it lists no perpetual.
`/api/markPrice`, `/api/indexPrice`, `/api/fundingRate`, `/api/futures/tradingPairs` and `/api/perpetual/tradingPairs` each answered HTTP 404 with `application/problem+json`, for example `{"title":"Not Found","status":404,"detail":"No static resource markPrice.","instance":"/api/markPrice"}`, `rest-probe.py anchor`.
The only reference prices are the venue's own `last`, `open`, `high` and `low` on `GET /api/ticker` and `GET /api/tickerAll`, and the socket `statistics` channel.
None of them is an index, and none can anchor a perpetual.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

### The call

`GET /api/orderBook?currencyPair=BTC_EUR&groupByPriceLimit=True`, S3, or `False`, see grouping below.
Both parameters are required: without `groupByPriceLimit` the reply is HTTP 200 with `{"error":true,"errorMessage":"Invalid request","data":null}`.
Over three runs a `BTC_EUR` reply took 173 to 492 ms, mostly under 220 ms, and was 7,337 to 7,401 bytes.

```json
{"error":false,"errorMessage":null,"data":{
  "asks":[{"price":73789.5,"amount":0.10860775},{"price":73789.6,"amount":0.01468701}],
  "bids":[{"price":73754.8,"amount":0.01768059},{"price":73725.4,"amount":0.01348485}],
  "timestamp":1791604883,"status":"TRADING"}}
```

The excerpt is the `True` form from the 04:01 UTC book rerun, trimmed to two levels a side.

### Depth limits

Every reply held 100 bids and 100 asks, on `BTC_EUR` and on the thin `USDC_CZK`.
The API document names no depth parameter, and CCXT sends none, S4 line 491.

### Grouping

`groupByPriceLimit=False` returns one row per resting order, so one price can appear more than once.
The `BTC_EUR` book had 17, 18 and 18 repeated prices across its 200 rows in three runs, and `USDC_CZK` had 5 each time.
`groupByPriceLimit=True` merges them, and the same book then had 0 repeated prices.
CCXT sends `False`, S4 line 491, so a CCXT book can hold two rows at one price.
A feed that wants price levels should send `True`.

### Level order and values

Bids are sorted best first, descending, and asks best first, ascending, and no reply was crossed.
Each level is an object with `price` and `amount` as JSON numbers, not strings.
`timestamp` is Unix seconds, and `status` repeats the pair's trading status.

### Ticker and trades

`GET /api/ticker?currencyPair=BTC_EUR` returns `last`, `high`, `low`, `amount`, `bid`, `ask`, `change`, `open`, `timestamp` in Unix seconds, and `status`.
The document says the timestamp is in milliseconds, S3, and the wire carries seconds, for example `1791604475`.
`GET /api/tickerAll` returns the same fields for all 15 pairs in one reply of 2,724 bytes, keyed by pair name.
`GET /api/transactions?currencyPair=BTC_EUR&minutesIntoHistory=60` returned 0 trades in both runs, so `BTC_EUR` did not trade in the hour before either probe.

### Unknown and odd symbols

| request | reply |
|---|---|
| `orderBook` on `FOO_BAR` | HTTP 200, `{"error":true,"errorMessage":"Currency pair FOO_BAR not found.","data":null}` |
| `orderBook` with no pair | HTTP 200, `{"error":true,"errorMessage":"Invalid request","data":null}` |
| `orderBook` on `btc_eur` | HTTP 200, the `BTC_EUR` book, so the pair is matched without regard to case |
| `ticker` on `FOO_BAR` | HTTP 200, `Currency pair FOO_BAR not found.` |
| `POST /traderFees` without a signature | HTTP 200, `{"error":true,"errorMessage":"Invalid request","data":null}` |
| an unknown path | HTTP 404, `application/problem+json`, `No static resource doesNotExist.` |

An API error is HTTP 200 with `"error":true`, so a client must read the body, not the status.

### Caching

Every reply carried `cf-cache-status: DYNAMIC` and no `cache-control`, so Cloudflare does not cache the book.
Polling the `BTC_EUR` book about every 1.2 s for 60 s gave 50 replies in each run, with the top of book changing once in the first run and never in the second.
Replies took a median of about 183 ms in both runs, and at most 364 ms.

## 6. Rate limits and errors

The document says "Please not make more than 100 request per minute or we will ban your IP address", S3.
It names no status code, no `Retry-After` and no ban length.
No reply carried a rate limit header, `rest-probe.py limits`.
The probe kept at least 1 s between calls, about 50 a minute at its fastest, and was never refused.
The ban itself was not tested.

Errors take two shapes.
The API layer answers HTTP 200 with `{"error":true,"errorMessage":"...","data":null}`, and CCXT maps `errorMessage` to its exceptions, S4 lines 1242 to 1258.
The web framework answers an unknown path with HTTP 404 and an `application/problem+json` body.

## 7. Server time and clock offset

`GET /api/system/time` returns `{"serverTime":1791604230906}` in Unix milliseconds.
Against the midpoint of each request on this host, whose clock is NTP synchronised, the server was 524.0 to 536.1 ms ahead in the first run and 519.7 to 524.4 ms ahead in the second.

## 8. Recommended poller shape

None for the engine as it stands.
There is no anchor to poll, and Coinmate has no perpetual for the engine to price.

If a later design adds EUR or CZK spot legs, REST is needed only to seed books, because the socket sends no snapshot on subscribe, see [`websocket.md`](./websocket.md) section 4.

- Load the catalog from `GET /api/tradingPairs` and drop any pair that `GET /api/products` does not show as `TRADING`.
- Seed each book once with `GET /api/orderBook?currencyPair=<NAME>&groupByPriceLimit=True`, at most one pair a second, which keeps 15 pairs well inside 100 calls a minute.
- Replace the seeded book with the first socket push.
- Skip `ETH_BTC` for a fiat leg, and read EUR and CZK as separate quote families, since neither is USD.

## 9. Source ledger

The sources are S1 to S6 of [`fees.md`](./fees.md) section 10.
S3, the Apiary document, holds the request limit, the order book parameters and the example replies this profile compares with the wire.
S4, the CCXT class, holds the mapping in section 2 and the error handling in section 6.
