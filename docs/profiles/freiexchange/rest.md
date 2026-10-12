# FreiExchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:01 to 05:15 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

FreiExchange lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
The public API is two calls, a ticker for every pair and a full depth order book per pair, with a documented limit of 30 requests per 60 s per IP.
It publishes no index, mark or funding, and no anchor poller is recommended.
Probed values come from [`rest-probe.py`](../../../scripts/probes/venues/freiexchange/rest-probe.py) unless a source id says otherwise.

## 1. Host and latency from this machine

### Where the API lives

The API page at `https://api.freiexchange.com/` is titled "FreiExchange / FreiXLite Api Documentation", S1.
It documents two public calls and nothing else:

- `GET https://api.freiexchange.com/public/ticker` and `GET https://api.freiexchange.com/public/ticker/{COIN}`, "24h market statistics for all enabled trading pairs, or a single pair when a coin is specified".
- `GET https://api.freiexchange.com/public/orderbook/{COIN}` for the BTC quoted book, and `GET https://api.freiexchange.com/public/orderbook/{COIN}/LTC` for the LTC quoted book of FreiXLite.

The page has no private section and no "websocket", "futures", "perpetual", "funding", "fee" or "time" word, `rest-probe.py docs`.
The web site also serves undocumented JSON at `https://freiexchange.com/market/getmarketlist`, `https://freiexchange.com/market/getsellarray/{COIN}/BTC` and `https://freiexchange.com/market/getbuyarray/{COIN}/BTC`, which its own pages load, S2.

### Access, from the Canadian VPN exit

| call | status | evidence |
|---|---|---|
| `GET https://freiexchange.com/` | 200, title "FreiExchange", `server: cloudflare` | `rest-probe.py host` |
| `GET https://api.freiexchange.com/` | 200, the API page | `rest-probe.py docs` |
| every documented public call | 200 | sections 2 and 5 |

No refusal, challenge or geoblock was met.
Every reply carried `server: cloudflare` and `cf-cache-status: DYNAMIC`.

### Resolution

`api.freiexchange.com` and `freiexchange.com` resolve to the same Cloudflare addresses, `104.26.8.87`, `104.26.9.87` and `172.67.71.94`, and three IPv6 addresses, `rest-probe.py host`.

### Latency

`GET /public/ticker/LTC` on one kept-alive connection took 575 ms and 610 ms cold in the two runs, and 168 to 187 ms warm, `rest-probe.py host`.
The full ticker took 509 to 874 ms and the full LTC_BTC book 809 to 817 ms, because both replies are 71 to 78 KB of indented JSON.

## 2. Catalog

### The instruments call

There is no instruments call.
`GET /public/ticker` is the catalog, and it answered 71,465 bytes in 509 to 874 ms in the two runs, `rest-probe.py catalog`.

| item | value |
|---|---|
| shape | an object keyed by `COIN_BASE`, each value a list of one row |
| pairs | 170 |
| by quote | 118 `*_BTC` and 52 `*_LTC` |
| `marketid` | 170 distinct values, one per pair |
| row fields | `marketid`, `volume24h`, `average24h`, `high`, `low`, `last`, `volume24h_btc` or `volume24h_ltc`, `percent_change_24h`, `highestBuy`, `lowestSell` |
| status field | none, the call lists "enabled" pairs only, S1 |
| pairs with 24 hour volume above 0 | 36 |
| pairs with both a bid and an ask | 139, none crossed |
| coins listed against both BTC and LTC | 36 |

No row carries a tick size, lot size, minimum order or precision.
Every number is a decimal string with 8 decimal places.
The web market list, `GET /market/getmarketlist`, held 117 rows, all BTC quoted, against 118 BTC pairs on the ticker.
CoinMarketCap tracks 46 spot pairs for the venue, see [`fees.md`](./fees.md) section 3.

### How CCXT maps it

CCXT 4.5.68 has no FreiExchange class, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.
A hand-built catalog would take the ticker key as the symbol, with `COIN_BASE` matching the socket's `pair` field, see [`websocket.md`](./websocket.md) section 3.

### Size unit, pairs listed twice, and price scale

`amount` in the book and `volume24h` in the ticker are units of the coin, and `volume24h_btc` or `volume24h_ltc` is the same volume in the quote coin.
Each `COIN_BASE` key appears once, and a coin quoted in both BTC and LTC appears as two keys, for example `DOGE_BTC` and `DOGE_LTC`.
The ticker also lists `BTC_LTC`, whose price is in LTC per BTC.

## 3. Anchor

Not offered.
FreiExchange lists no perpetual, so it publishes no index, mark, funding rate, funding interval or next settlement, see [`fees.md`](./fees.md) section 3.
The only reference prices are the ticker's `last` and `average24h` per pair, which are trade statistics and not an index.

## 4. Anchor semantics

Not offered, for the reason in section 3.

The one minute stability check of the template was run on the book instead.
`GET /public/orderbook/LTC` polled about every 3 s for 40 s returned the same top of book in all 13 polls of each run, `rest-probe.py poll`.
The first run saw bid `0.00077160` for `0.20747796` and ask `0.00078999` for `8.27212858`, and the rerun ten minutes later saw the same prices with the ask size down to `8.23579587`, after the trade captured in [`websocket.md`](./websocket.md) section 6.
The LTC_BTC page reports about 62 trades a day, S2.

## 5. REST book snapshot

### The call

`GET https://api.freiexchange.com/public/orderbook/{COIN}` for a BTC quoted pair and `GET https://api.freiexchange.com/public/orderbook/{COIN}/LTC` for an LTC quoted pair, S1.
The reply is `{"BUY":[...],"SELL":[...]}`, and each level is `{"id","coin","basecoin","price","amount"}`.

| pair | buy levels | sell levels | bytes | time |
|---|---|---|---|---|
| LTC_BTC | 75, then 76 | 359 | 77,293, then 77,471 | 809 to 817 ms |
| DOGE_BTC | 39 | 434 | 85,272 | 517 to 1,018 ms |
| DOGE_LTC | 30 | 51 | 14,452 | 352 to 360 ms |

The first figure is the first run at 05:03 UTC and the second the rerun at 05:13 UTC, where they differ.

### Depth limits

None documented and none on the wire.
The call returns every price level of the pair, and there is no `limit` parameter, S1.

### Level order and values

`BUY` runs from the highest price down and `SELL` from the lowest price up, on all three pairs.
No price repeats within a side, which agrees with the page's "aggregated buy and sell orders for a trading pair, grouped by price level", S1.
Each level still carries an `id`, which looks like the id of one resting order, for example `1868970`.
No book was crossed.
In the first run the web site's own arrays for LTC_BTC, read a few seconds after the API book, showed the same best bid `0.00077160` and best ask `0.00078999`, with 75 buy and 356 sell levels.
In the rerun the API book had a bid at `0.00077161` that the web arrays no longer showed a few seconds later, and every later poll showed `0.00077160` again, so a short lived order is the likely cause.

### Caching

`cf-cache-status: DYNAMIC` on every reply, so Cloudflare does not cache the book.
No `Cache-Control` or `Age` header came with an API reply.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| documented limit | "The API is rate limited to 30 requests per 60 seconds per IP. Abusive requests will be automatically blocked." | S1 |
| ticker polling | "Use /public/ticker to fetch all pairs in a single request. Polling individual tickers in a loop will result in a ban." | S1 |
| headers on the wire | `x-ratelimit-limit: 250` and an `x-ratelimit-remaining` that fell by one per call and refilled to 249 about a minute into each run, between 05:04:38 and 05:04:41 UTC in the first and between 05:14:04 and 05:14:08 UTC in the rerun | `rest-probe.py catalog`, `rest-probe.py poll` |
| `Retry-After` | never seen, no call was refused | all modes |
| limit reply | not provoked, the probe stays under the documented 30 per 60 s | |

The documented 30 per 60 s and the header's 250 disagree.
A poller must follow the documented 30, because the page threatens a ban.

| call | status | body |
|---|---|---|
| `GET /public/ticker/NOPE` | 200 | `[]` |
| `GET /public/orderbook/NOPE` | 200 | `{"BUY":[],"SELL":[]}` |
| `GET /public/orderbook/LTC/ETH` | 400 | `{"error":"Invalid basecoin. Use BTC or LTC."}` |
| `GET /public/markets` | 404 | `{"message":"404 Not Found"}` |

An unknown coin is indistinguishable from an empty book.

## 7. Server time and clock offset

There is no server time call, S1.
The HTTP `Date` header put the server 0.8 s and 0.2 s behind the local clock in the two runs, at 1 s resolution, `rest-probe.py time`.

## 8. Recommended poller shape

No anchor poller is recommended, because there is no index, mark or funding.
FreiExchange cannot join the engine as a perpetual leg.
If a later design adds spot legs, the catalog would be one `GET /public/ticker` at start and on a slow refresh, and books would come from `GET /public/orderbook/{COIN}`, at most 30 calls per 60 s across every pair together.
That is one book every 2 s for the whole venue, so only a handful of pairs could be kept fresh.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.freiexchange.com/`, the page "FreiExchange / FreiXLite Api Documentation" | the two public calls, the reply shapes, the rate limit and the ban warning |
| S2 | `https://freiexchange.com/market/LTC/BTC`, `https://freiexchange.com/market` and their page scripts | the undocumented JSON calls the pages load, the `tradesPerDay` of about 62 for LTC_BTC |
