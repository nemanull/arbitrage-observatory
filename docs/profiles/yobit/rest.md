# YoBit REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:43 to 04:07 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

YoBit lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot catalog and the spot REST book.
The calls are the Public API v2 and v3 documented on the API page, S1.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/yobit/rest-probe.py), named by its section.

## 1. Host and latency from this machine

| host | resolved | role | result |
|---|---|---|---|
| `yobit.net` | `185.129.102.2`, behind DDoS-Guard (`Server: ddos-guard`) | website and the whole API | HTTP 200 on every documented call |
| `propusher24.com` | behind DDoS-Guard | the web app's socket | [`websocket.md`](./websocket.md) |

`GET /api/3/ticker/btc_usdt` took 311 to 391 ms over nine cold and warm tries in three runs, with no steady difference between cold and warm, section "Host and latency".
The full catalog, `GET /api/3/info`, is 1,490,444 bytes and took 4.6 s, 1.4 s and 103 s in three runs, so its time is not predictable.
No geoblock, challenge page or refusal was seen from this Canadian exit.

## 2. Catalog

| item | value |
|---|---|
| call | `GET https://yobit.net/api/3/info`, no parameters |
| reply | `{"server_time":<s>,"pairs":{"ltc_btc":{...},...}}`, with `Content-Type: text/html` although the body is JSON |
| fields per pair | `decimal_places`, `min_price`, `max_price`, `min_amount`, `min_total`, `hidden`, `fee`, `fee_buyer`, `fee_seller`, the same set on every pair |
| status values | `hidden` 0 or 1, where a hidden pair still trades but is off the home page, and a disabled pair disappears from the list, S1. All 9033 pairs had `hidden` 0. |
| pair count | 9033 |
| pairs by quote | btc 1488, doge 1476, rur 1475, usd 1474, eth 1473, waves 1468, yo 122, usdt 53, and one each for snmold, usdttrc20, usdtbep20 and usdtton |
| pair id format | lowercase `base_quote`, one underscore in every id, no pair listed twice by case |
| BTC/USDT | `decimal_places` 8, `min_price` 1e-08, `max_price` 10000, `min_amount` 1e-05, `min_total` 0.0001, `fee` 0.2 |

`max_price` is 10000 on the pairs read, while BTC/USDT trades near 82,000.
So the field does not bound real prices and should not be used to validate them.

The catalog is wide and thin.
In the 24 hours before the probe, BTC/USDT traded 0.030 BTC, about 2,476 USDT, and ETH/USDT 0.074 ETH, section "Ticker".
On the wire, the ticker's `vol` is the quote volume and `vol_cur` the base volume, since `vol` divided by `vol_cur` falls between the day's `low` and `high`.
CCXT's delisting note says the same about volume, [`fees.md`](./fees.md) section 8.

There is no CCXT 4.5.68 class to map ids, so `market.id`, `contractSize` and `linear` have no CCXT value.
The REST pair id `btc_usdt` and the socket's numeric `pair_id` 10108 are different keys, and only the trade page links them, [`websocket.md`](./websocket.md) section 2.

The perpetual catalog does not exist: the API page documents only spot methods, and `/en/futures/` answers 404, section "Site access".

## 3. Anchor

YoBit publishes no index, mark price or funding rate, because it lists no perpetuals.
The only reference prices are the spot ticker's `last`, `avg`, `buy` and `sell`, from `GET /api/3/ticker/<pairs>`, and the DeFi pool prices of `GET /api/defi/info`.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, see section 3.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET https://yobit.net/api/3/depth/<pair>[-<pair>...]?limit=<n>`, or v2 `GET /api/2/<pair>/depth` |
| depth | 150 levels a side by default, `limit` up to 2000, S1. `limit=5000` returned the same book as `limit=2000`, about 730 asks and 2000 bids on BTC/USDT. |
| reply | `{"btc_usdt":{"asks":[[price,amount],...],"bids":[...]}}`, prices and amounts as JSON numbers |
| level order | asks ascending, bids descending, checked on every reply |
| size unit | base asset |
| several pairs | one call takes a hyphen-joined list, such as `btc_usdt-eth_usdt` |
| caching | "Server responses are cached every 2 seconds", S1. Polled once a second for 20 s, the ETH/BTC book changed once, so the period could not be measured on a book this quiet. No `Cache-Control` or `Age` header is sent. |
| size | about 6.7 KB for the default 150 levels and about 60 KB for 2000 |

The REST book matched the socket's replayed book, [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limit | "Admissible quantity of requests to API from user's software is 100 units per minute." | S2, section 9 |
| cache | 2 s on v3, so faster polling gains nothing | S1 |
| limit status and `Retry-After` | not reached, so not seen | the probe stays under 50 requests a minute |
| invalid pair | HTTP 200 with `{"success":0,"error":"Invalid pair name: nosuch_pair"}`, also when one bad pair sits in a list | section "Errors and fee call" |
| `ignore_invalid=1` | drops the bad pair and answers the rest | section "Errors and fee call" |
| unknown method | HTTP 404 with the body `404 Not found` | section "Errors and fee call" |
| long pair lists | 400 pairs in one ticker call, a 3514 character URL, answered 400 rows | section "Ticker" |

Errors come with HTTP 200, so a client must check for `success` 0 in the body.

## 7. Server time

There is no separate time call.
`GET /api/3/info` carries `server_time` in seconds, which read 0.6 s and 1.4 s behind the local clock at the start of the request in the two runs that printed it.
The `Date` header read 0.1 to 0.9 s behind the local midpoint of each request, three per run over three runs, at one second resolution, section "Server time".

## 8. Recommended poller shape

No anchor poller, because there is no index, mark or funding to poll.
A spot catalog refresh would read `GET /api/3/info` a few times a day, since it is 1.5 MB.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [YoBit API page](https://yobit.net/en/api/), Public API v2 and v3 | 2026-10-09 |
| S2 | [YoBit rules](https://yobit.net/en/rules/), section 9 "Rules of use of Public API and Trade API" | 2026-10-09 |
| S3 | [`rest-probe.py`](../../../scripts/probes/venues/yobit/rest-probe.py), sections "Host and latency", "Site access", "Catalog", "Ticker", "Book", "Caching", "Errors and fee call", "Server time", "Pair ids from trade pages" and "Coverage" | 2026-10-09 |
