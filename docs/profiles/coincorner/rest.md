# CoinCorner REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:40 to 03:50 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

CoinCorner lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
The short answer is that neither exists in a usable form.
The documented public API is one ticker call that ignores the coin it is asked for.
An undocumented order book path returns the same five placeholder levels for every pair, each with an amount of 999.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/coincorner/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S7 are those of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

### Where the API lives

The API landing page gives the base `https://api.coincorner.com/api`, S1.
It names one call, "Ticker", which "Returns the current fiat price of a coin", and links its help page `/Help/Api/GET-api-Ticker_Coin_Currency`.
It also says the API "requires authentication" with an API key, an HMAC-SHA256 signature over nonce, user id and key, and a nonce, S1.
The ticker and the order book path nonetheless answer without any of the three.
`https://www.coincorner.com/api` answers HTTP 301 to `https://api.coincorner.com/`.

### Access, from the Canadian VPN exit

| call | status | body or note |
|---|---|---|
| `GET https://api.coincorner.com/` | 200 | the landing page, S1 |
| `GET /api/Ticker?Coin=BTC&Currency=GBP` | 200 | JSON ticker, see section 5 |
| `GET /api/OrderBook?Coin=BTC&Currency=GBP` | 200 | JSON book of five placeholder levels a side, see section 5 |
| `GET /api/Ticker` and `GET /api/OrderBook` with no query | 405 | `text/html`, "The page you are looking for cannot be displayed because an invalid method (HTTP verb) is being used." |
| `GET /api/Trades`, `/api/Markets`, `/api/Currencies`, `/api/Time` | 404 | `text/html`, "The resource you are looking for has been removed, had its name changed, or is temporarily unavailable." |
| `GET /Help` and `GET /Help/Api/GET-api-Ticker_Coin_Currency` | 500 | `text/html`, "The page cannot be displayed because an internal server error has occurred." |
| `GET /Help/Api/GET-api-OrderBook_Coin_Currency` | 200 | an HTML page titled "Error" |

No geoblock or challenge was met.
The documentation the landing page links is broken from this host, and the Wayback Machine answered HTTP 429 to every lookup, so no archived copy was read.

### Resolution

`api.coincorner.com` resolved to the Cloudflare addresses `172.66.134.39` and `172.66.137.160`, and to two IPv6 addresses.
Replies carry `server: cloudflare`, `cf-cache-status: DYNAMIC` and edge `YVR` in `cf-ray`.
They also set `ARRAffinity` cookies, which point to an Azure App Service origin.

### Latency

| measure | value |
|---|---|
| TCP and TLS connect to the Cloudflare edge | 18 to 20 ms |
| first ticker request on an open connection | 170 to 225 ms |
| warm ticker requests | 171 to 225 ms |
| cold ticker request including connect | 206 to 304 ms |
| ticker and book requests over the 60 s poll | 163 to 266 ms, with one outlier of 677 ms |

## 2. Catalog

### The instruments call

None exists.
No markets, symbols, pairs or currencies path answered, see section 1.
The products are known only from the help centre: BTC and USDT bought and sold against GBP and EUR, and ETH and LTC sold, or bought outside the UK, S4.
CoinMarketCap tracks two pairs, BTC/GBP with about 267,786 USD of 24 hour volume and BTC/EUR with about 2,682 USD, S5.
CoinMarketCap tags the venue `order-book-exchange` and `auto-order-book-exchange`, which does not match the broker desk the help centre describes, S4 and S5.

### How CCXT maps it

CCXT has no CoinCorner class at 4.5.68 or on `master`, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.

### Size unit, pairs listed twice, and price scale

Not applicable.
There is no catalog.
The ticker's `Volume` of 3.20475259 for GBP is in BTC, since it is within 3 % of CoinMarketCap's 24 hour BTC volume of 3.27777596 for the venue, S5.

## 3. Anchor

CoinCorner publishes no index, mark or funding, because it lists no perpetual.
The only public reference price is the ticker's `LastPrice` and `AvgPrice` per fiat currency, see section 5.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, see section 3.
Two runs polled the BTC/GBP ticker and book every 5 s for 60 s.
`AvgPrice` and `Volume` did not change in either run.
`LastPrice` held one value in the first run and took 3 values in the second, 63,129, 63,124 and 63,128.
Each time it moved, the book's first bid and ask moved with it, so `LastPrice` follows CoinCorner's own quote and not a trade print.
`CreateDate` moved with each request, so it is the reply time and not a trade time.

## 5. REST book snapshot

### The call

`GET https://api.coincorner.com/api/OrderBook?Coin=<COIN>&Currency=<FIAT>` is not on the landing page.
It answers HTTP 200 with `{"Coin":"BTC","buys":[{"Amount":999.00000000,"Price":60332.00000000},...],"sells":[...]}`.

### What it returns

The reply is not a BTC/GBP book.

- Every request returned 5 buys and 5 sells, and every `Amount` was `999.00000000`.
- The queries BTC with GBP, BTC with EUR, BTC with USD, ETH with GBP, LTC with EUR, USDT with GBP and XYZ with GBP all returned the same ten levels.
  The largest price gap to the BTC/GBP reply was 0 ppm in one run and 418 ppm in another, which is the quote moving between requests.
  Only the `Coin` field echoes the query.
- The five prices on each side fall by orders of magnitude.
  As fractions of the first level they were 1, 0.030166, 0.000769, 0.000013 and 0.000012 on the buy side, and within 0.00001 of that in the second run.
  So the five rows are five different instruments and not five depths of one book.
- The first level looked like CoinCorner's BTC/GBP quote: bid 60,332 and ask 64,358 when the ticker's `LastPrice` was 63,108.
  That is a spread of 64,576 ppm of the mid, with the ask 19,807 ppm above the last price and the bid 43,988 ppm below it.
  The second run gave 64,570 ppm, 19,817 ppm and 43,973 ppm.
- The second and third levels, 1,820 and 1,941, and 46.40 and 49.57, are in the range of ETH and LTC in GBP, and the last two, below 1, are not identified.
  These identifications are inference and are not stated by any source.

### Depth limits

Five rows a side, with no depth parameter that the probe found.

### Level order and values

Buys descend and sells descend, both by instrument and not by price within one book.
Prices and amounts are JSON numbers with 8 decimal places.

### Ticker

`GET /api/Ticker?Coin=BTC&Currency=GBP` returned `{"LastPrice":63104.00000000,"AvgPrice":63132.34899329,"LastHigh":63104.00000000,"LastLow":61572.00000000,"Volume":3.20475259,"BidHigh":63104.00000000,"BidLow":61572.00000000,"Coin":"BTC","CreateDate":"2026-10-10T03:42:29.697"}`.
The ticker ignores `Coin`: `ETH`, `USDT` and `XYZ` with `GBP` returned the BTC/GBP numbers, and `LTC` with `EUR` returned the BTC/EUR numbers.
It honours `Currency`: `EUR` returned `LastPrice` 74,559 in the first run and `Volume` 0.03209204, and `USD` returned `LastPrice` 0.0 with the GBP `AvgPrice` and `Volume`.
It has no best bid or ask, and `BidHigh` and `BidLow` equal `LastHigh` and `LastLow`.

### Unknown and odd symbols

An unknown coin such as `XYZ` is accepted and answered with BTC data, on both paths.
An unsupported fiat such as `USD` is accepted and answered with zeros on the ticker and the placeholder levels on the book.
A missing query answers 405, see section 1.

### Caching

Replies carry `cache-control: no-cache` and `cf-cache-status: DYNAMIC`.
Over 12 polls in 60 s the book body took 2 distinct values in one run and 5 in the other, so the quote is regenerated and not cached.

## 6. Rate limits and errors

The landing page says "The rate limit for CoinCorner's API is 60 requests a minute", S1.
No reply carried `x-ratelimit-*` or `Retry-After`, and the probe stayed at about 24 requests a minute or less, so the limit's status code was not seen.
Errors are IIS-style `text/html` pages with HTTP 405, 404 and 500, quoted in section 1, and not JSON.

## 7. Server time and clock offset

No time path exists, `/api/Time` answers 404.
The `Date` header is the only server clock, and local time ran 0.5 s and 1.0 s ahead of it in two runs, at its 1 s resolution.

## 8. Recommended poller shape

None.
CoinCorner has no perpetual, no index, mark or funding, no catalog call and no real order book, so there is nothing for an anchor poller or a REST book poller to read.
The ticker could feed a display of CoinCorner's BTC/GBP and BTC/EUR last price, at most once a second, which is the published limit of 60 a minute.

## 9. Source ledger

The sources are S1 to S7 of [`fees.md`](./fees.md) section 10.
S1, the landing page of `api.coincorner.com`, is the only API documentation this host could read.
