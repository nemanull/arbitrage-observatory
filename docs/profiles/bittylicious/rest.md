# Bittylicious REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:40 to 04:56 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Bittylicious lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
The short answer is that neither exists in a usable form.
The public API is undocumented, and two of its paths answer without a key.
`/api/v1/quote` prices one amount of one coin, for one side and one payment method, as a single all-in total from one broker.
`/api/v1/ticker` gives trade averages per fiat and coin pair from a cache that Cloudflare holds for up to an hour.
There is no order book, depth, market list or time path.
Every probed claim was captured by [`rest-probe.py`](../../../scripts/probes/venues/bittylicious/rest-probe.py) unless a source id says otherwise.
Source ids S1 to S8 are those of [`fees.md`](./fees.md) section 10.

## 1. Host and latency from this machine

### Where the API lives

No document gives an API base.
The site's script bundle builds the quote URLs as `/api/v1/quote/<coin>/<country>/<currency>/<payMethod>/<amount>/<side><routes>` and `/api/v1/quoteFiat/...` with a fiat amount in the same place, S8.
The ticker path `/api/v1/ticker` was found by trying common names, see section 2.
`api.bittylicious.com` does not resolve, see [`websocket.md`](./websocket.md) section 1.

### Access, from the Canadian VPN exit

| call | status | body or note |
|---|---|---|
| `GET https://bittylicious.com/` | 200 | the buy page with its payment method blocks, S1 |
| `GET /api/v1/quote/BTC/GB/GBP/BANK/1/BUY` | 200 | JSON quote, see section 5 |
| `GET /api/v1/ticker` | 200 | JSON averages for 91 pairs, see section 2 |
| `GET /api/` | 403 | Apache "Forbidden, You don't have permission to access this resource." |
| `GET /api/v1/` | 308 | redirect to `http://bittylicious.com/api/v1`, which is the HTML 404 page |
| `GET /api/v1/orderbook/BTCGBP`, `/api/v1/orderBook/BTC/GBP`, `/api/v1/depth/BTCGBP` | 404 | `text/html`, "Bittylicious, 404 - Page Not Found" |
| `GET /api/v1/markets`, `/symbols`, `/time`, `/status`, `/currencies`, `/prices`, and `/api/v2/ticker` | 404 | the same HTML page |
| `GET https://help.bittylicious.com/` and every wiki page tried | 500 | MediaWiki "Error 1146: Table 'bittylic_wikihel.page' doesn't exist", see [`fees.md`](./fees.md) section 1 |

No geoblock or challenge was met.
Purchases need a UK or EU IP address according to the buy page, but reading prices does not, S1.

### Resolution

`bittylicious.com` resolved to the Cloudflare addresses `172.66.41.21` and `172.66.42.235`.
Replies carry `server: cloudflare` and edge `SEA` in `cf-ray`.
The `/api/` refusal names an Apache origin.

### Latency

| measure | value |
|---|---|
| TCP and TLS connect to the Cloudflare edge | 27 and 29 ms |
| BTC buy quotes by UK bank transfer, including `quoteFiat` and refused amounts, on an open connection | 633 to 990 ms |
| cold BTC buy quote including connect | 738 and 1,086 ms |
| every other quote call, BTC sells and other coins included | 171 to 379 ms |
| ticker, served from the Cloudflare cache | 71 to 259 ms |

BTC buys by UK bank transfer are about twice as slow as any other quote, which points to extra work at the origin for that one route.

## 2. Catalog

### The instruments call

There is none.
The nearest thing is `GET /api/v1/ticker`, which returns one object of 91 keys.
Each key is the fiat code followed by the coin code, such as `GBPBTC`, across 11 fiat prefixes: AUD, CNY, CZK, EUR, GBP, INR, KRW, PKR, THB, USD and ZAR.
Each value is `{"avg_1h", "avg_3h", "avg_6h", "avg_12h", "avg_24h", "volume_24h", "rates": {"last"}}`.
Most keys, 86 of 91, have a null `last` and a volume of 0, and many name coins such as `AUR`, `NBT` and `STRAT` that no longer trade widely.
Only 5 keys had a non-null `last`, and 4 had any 24 hour volume:

| key | last | avg_24h | volume_24h |
|---|---|---|---|
| `GBPBTC` | 66,514.189694 | 65,101.507155 | 0.1585504 BTC |
| `GBPLTC` | 50.52 | 50.326182 | 92.93611812 LTC |
| `GBPDOGE` | 0.059741 | 0.059741 | 12,888.97072362 DOGE |
| `GBPETH` | 2,027.692308 | 1,975.958549 | 0.2895 ETH |
| `EURBTC` | 77,925.742574 | null | 0 |

These match CoinMarketCap's 5 spot pairs and their ranking by volume, S4, so CoinMarketCap most likely reads this call.
The `last` values sit above the current bank transfer buy quote, for example 66,514 against 64,857 GBP for BTC, so they look like averages of completed trades and not a live price.

There are no status values, no tick or lot sizes and no active flag.
The tradable set is only visible on the buy page, which lists Bitcoin, Dogecoin, Ether and Litecoin, S1, and by asking the quote call per coin, see section 5.

### How CCXT maps it

There is no CCXT class, see [`fees.md`](./fees.md) section 8.
The ticker key `GBPBTC` and the quote path's `BTC/GB/GBP` are two spellings of one market, and neither matches the CCXT `BTC/GBP` form.

### Size unit, pairs listed twice, and price scale

Sizes are in coins, and prices are totals in the fiat currency, see section 5.
No pair is listed twice in the ticker, though each coin is priced separately for each payment method.
No price scale applies.

## 3. Anchor

Bittylicious publishes no index, mark or funding, because it lists no perpetual.
The only public reference prices are the trade averages of `/api/v1/ticker`, section 2, and the per amount quote, section 5.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, see section 3.
`rest-probe.py poll` read the 1 BTC buy and sell quotes every 5 s for 60 s, in two runs.
In the first run neither changed over 12 intervals, the buy staying at 64,857.18 GBP and the sell at 59,698.13 GBP.
The buy page had shown the same 64,857.18 GBP at 04:48 UTC, so a broker's price can hold for at least two and a half minutes.
In the second run each changed once, the buy from 64,869.83 to 64,879.81 GBP and the sell from 59,709.77 to 59,718.96 GBP.
So the quote moves in steps of about 150 ppm, and the second run saw one step a side in a minute.
Between the two ticker reads, about five minutes apart, `GBPLTC` `avg_6h` moved from 50.34486 to 50.692219 and `GBPETH` `avg_6h` went from 2,027.692308 to null, so the cached ticker does refresh within its hour.

## 5. REST book snapshot

### The call

There is no book.
The closest call is the quote:

```text
GET https://bittylicious.com/api/v1/quote/{coin}/{country}/{currency}/{payMethod}/{amount}/{side}{routes}
```

`side` is `BUY` or `SELL`, and a missing side means `BUY`.
`routes` is the optional `?routes[]=...` list that the buy page passes for each payment method, for example `?routes[]=AXCESS&routes[]=TRUSTPAY` for a card, S1.
`quoteFiat` takes a fiat amount and returns the coin amount it buys.

### What it returns

The first run's 1 BTC buy, with the two runs' values in the table below:

```json
{"success":true,"totalPrice":64857.18,"currency":"GBP","fixedPortion":"0.00","minAmount":0.0007519318256498684,"maxAmount":1.69861929}
```

`totalPrice` is the all-in total for the amount asked, not a unit price.
`minAmount` and `maxAmount` bound the amount in coins for that broker and payment method.
`quoteFiat/BTC/GB/GBP/BANK/100/BUY` answered `{"success":true,"totalPrice":"0.00150386","coin":{},"fixedPortion":"0.00","minAmount":50.01,"maxAmount":112950.35}` in the first run, with the coin amount as a string and the bounds in GBP.

| quote | reply |
|---|---|
| BTC, GB, GBP, BANK, 1, BUY | 64,857.18 and 64,852.47 GBP |
| BTC, GB, GBP, BANK, 1, SELL | 59,698.13 and 59,693.79 GBP |
| LTC, GB, GBP, BANK, 10, BUY | 500.4 and 500.3 GBP |
| DOGE, GB, GBP, BANK, 1000, BUY | 68.927 and 68.9 GBP |
| ETH, GB, GBP, BANK, 1, BUY | 1,963.24 and 1,962.88 GBP |
| ETH, GB, GBP, BANK, 1, SELL | "Sorry, we cannot match your coin request with a broker." |
| BTC, GB, GBP, CARD, 0.01, BUY with card routes | 665.7613 and 665.8913 GBP |
| BTC, EU, EUR, CARD, 0.01, BUY with card routes | 787.0293 and 787.2033 EUR |
| BTC, EU, EUR, SEPA, 0.01, BUY | "Pay method does not exist" |

### Depth limits

There are no levels, so there is no depth.
A larger amount gets a better unit price up to `maxAmount`, see [`fees.md`](./fees.md) section 2, and an amount above it is refused, for example 100 BTC with "Sorry, we cannot match your coin request with a broker.".
So the quote at several amounts is the only view of size, and it reaches 1.69861929 BTC on the UK bank buy and about 4.19 BTC on the UK bank sell.

### Level order and values

Not applicable.
`totalPrice` is a JSON number on `quote` and a JSON string on `quoteFiat`, and `fixedPortion` is a string.

### Ticker

See section 2.

### Unknown and odd symbols

Every error is HTTP 200 with `"success":false` and a message:

| request | error |
|---|---|
| coin `XYZ` | "Coin not found" |
| amount `abc` | "Amount must be numeric" |
| amount 0.0001 BTC | "Sorry, we cannot match your coin request with a broker. Please purchase a minimum of 50.00 GBP." |
| payment method `SEPA` | "Pay method does not exist" |
| no broker for that side | "Sorry, we cannot match your coin request with a broker." |

### Caching

Quote replies carry `cf-cache-status: DYNAMIC` and no `cache-control`, so they are not cached.
Ticker replies carry `cache-control: public, max-age=3600, stale-if-error=300` and `cf-cache-status: HIT`, so a reader may see data up to an hour old.

## 6. Rate limits and errors

No rate limit is published, and the help wiki that might hold one answers HTTP 500, see section 1.
No reply carried `x-ratelimit-*` or `Retry-After`, and the probe stayed at one request a second or slower, so no limit was seen.
API errors are HTTP 200 JSON bodies with `"success":false`, quoted in section 5.
Unknown paths answer the HTML 404 page.

## 7. Server time and clock offset

No time path exists, `/api/v1/time` answers 404.
The `Date` header is the only server clock, and local time ran 0.6 s and 0.9 s ahead of it in two runs, at its 1 s resolution.

## 8. Recommended poller shape

None.
Bittylicious has no perpetual, no index, mark or funding, no catalog call and no order book, so there is nothing for an anchor poller or a REST book poller to read.
A display of Bittylicious's BTC/GBP broker price could read the 1 BTC buy and sell quote every few seconds, since it held still for at least a minute in the poll.

## 9. Source ledger

The sources are S1 to S8 of [`fees.md`](./fees.md) section 10.
No API documentation could be read, see S3, so every path here comes from the script bundle S8 or from the probe.
