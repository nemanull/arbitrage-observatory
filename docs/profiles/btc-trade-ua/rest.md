# BTC Trade UA REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific evening (04:42 to 05:00 UTC on 2026-09-23), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API of BTC Trade UA, the only public market data the venue serves.
The venue lists spot only, see [`fees.md`](./fees.md) section 3, so the catalog below is the spot catalog, and section 3 records that no index, mark or funding exists.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) in two runs of each mode, unless a source is named.
Trade participant names in the deals reply are never printed by the probe or quoted here.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| API base | `https://btc-trade.com.ua/api`, the site's own host | S1 |
| `btc-trade.com.ua` and `www.btc-trade.com.ua` | `136.243.53.121`, in RIPE block `HETZNER-fsn1-dc12`, Germany | P1, S5 |
| `api.btc-trade.com.ua` | does not resolve, `ENOTFOUND` | P1 |
| `btc-trade.app` | `49.12.191.2`, in RIPE block `CLOUD-FSN1`, Germany, plus an AAAA record `fe80::4d5:2aff:fe00:a95`, which is a link-local address no client can reach | P1, S5 |
| server | `nginx/1.18.0 (Ubuntu)`, no CDN header | P1 |
| cold request, `GET /api/ticker/btc_uah` | 569 and 551 ms | P1 |
| warm request, same call | 152 to 166 ms over eight reads | P1 |
| access | every call answered 200 through the Canadian VPN exit, except the error cases in section 6. No geoblock or refusal page | P1 to P3 |

## 2. Catalog

### The instruments call

There is no instruments or markets call.
The catalog is the key set of `GET /api/ticker`, which returned 36 pairs in 13,673 bytes in both runs, P1.
Each value holds `buy`, `sell`, `last`, `high`, `low`, `avg`, `vol`, `vol_cur`, `buy_usd`, `sell_usd`, `last_usd`, `vol_cur_usd`, `usd_rate`, `updated`, `last_id`, `currency_trade` and `currency_base`.
No field carries a status, a tick size, a lot size or a minimum order.

| quote | pairs | traded in the last 24 h |
|---|---:|---|
| UAH | 25 | 11: `btc_uah` 0.0140 BTC, `usdt_uah` 3,626.65 USDT, `eth_uah` 0.101 ETH, `zec_uah`, `etc_uah`, `xrp_uah`, `dash_uah`, `ltc_uah`, `bch_uah`, `doge_uah`, `tlr_uah` |
| BTC | 7 | none |
| USDT | 4 | none |

The trading page links 35 of the 36 pairs, all but `btc_uah`, P1.
The four USDT pairs are the only ones in the engine's settlement family, and none traded in 24 h.
The table is read from the ticker in the two catalog runs, P1.

| pair | best bid | best ask | spread | 24 h volume |
|---|---:|---:|---:|---:|
| `btc_usdt` | 79,284.02 and 79,286.22 | 87,221.37 | 100,113 and 100,082 ppm | 0 |
| `sol_usdt` | 117.99 | 119.50 | 12,773 ppm | 0 |
| `trx_usdt` | 0.34154 | 0.343 | 4,273 ppm | 0 |
| `eos_usdt` | 0.0795 | 0.4183 | 4,261,569 ppm | 0 |

Kraken's `XBTUSDT` read in the same depth runs was 87,212.3 to 87,212.4 and then 87,180.5 to 87,185.1, P2.
So the `btc_usdt` ask sat 103 and 416 ppm above Kraken's ask, and its bid about 9.1 % below Kraken's bid.

`GET /api/deals/<pair>` lists recent trades, S1.
For `btc_uah` it returned 16 rows, 8 `buy` and 8 `sell` in pairs of equal price, amount and time, so each trade appears once from each side, with the newest at 17:12:09 UTC on 2026-09-22 and the oldest at 05:18:03 UTC that day, in both runs, P1.
Each row carries a `user` field with the counterparty's user name, S1 and P1.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no BTC Trade UA class, and neither has CCXT master, see [`fees.md`](./fees.md) section 8.
The last class, removed after 4.1.51, hard coded 17 markets with ids spelled `btc_uah` and never called the venue for a catalog, S4.

| engine field | what the venue gives |
|---|---|
| `market.id` against the socket and anchor symbol | `btc_uah`, lowercase, the same in every REST path and in the socket's `get` paths. `BTC_UAH` answers 404 `{"status":"false"}`, P1 |
| `contractSize` against the book size unit | not applicable, spot. Book sizes are in the base currency, section 5 |
| `linear`, `active` | not applicable, no swap market and no status field |
| pairs listed twice | none. Each base has at most one pair per quote |

## 3. Anchor

None.
BTC Trade UA publishes no index price, no mark price and no funding rate, because it lists no perpetual.

| call | index | mark | funding rate | interval | next settlement |
|---|---|---|---|---|---|
| `GET /api/ticker` | absent | absent | absent | absent | absent |

The ticker's `usd_rate` is the only reference price it publishes.
It read `"42.4"` on every pair in both runs, P1, and the API documentation calls it "our local rate", S1.
It converts the UAH fields into the `*_usd` fields, while `usdt_uah` itself traded between a bid of 45.63 and an ask of 45.894 at the same time, P1.
`GET /api/market_prices`, which the trading page calls every 30 s, answered 502 with `{"status":"wait","timeout":1000}` on every read, two per catalog run 1.5 s apart and one `curl` read before them, P1, so what it would publish is unknown.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The one number that could serve as a slow reference is the ticker, and it changes on a 30 s cache, not on the market:

| item | value | source |
|---|---|---|
| `Cache-Control` | `max-age=30` on `/api/ticker` and `/api/ticker/<pair>` | P1, P3 |
| cache refresh | `X-GG-Cache-Date` changed three times in each 60 s poll run, at 04:48:53, 04:49:24 and 04:49:55, and at 04:58:43, 04:59:15 and 04:59:48 UTC, so every 31 to 33 s | P3 |
| `updated` | equals `X-GG-Cache-Date` to the second, so it stamps the cache fill and not a trade | P2, P3 |
| `X-Upstream` | `tornado_api` | P1 |

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| calls | `GET /api/trades/buy/<pair>` for bids and `GET /api/trades/sell/<pair>` for asks, two calls per book | S1 |
| depth limit | none documented. The whole resting list comes back: `btc_uah` 256 bids and 80 asks, `usdt_uah` 146 and 275, `eth_uah` 164 and 142, `btc_usdt` 101 and 23, `sol_usdt` 424 and 170, the same counts in both runs | S1, P2 |
| entry | `{"price", "currency_trade", "currency_base"}`, all decimal strings, `currency_trade` in base currency and `currency_base` in quote currency | S1, P2 |
| arithmetic | `price` times `currency_trade` equals `currency_base` to 0 ppm on the first five entries of every list read | P2 |
| aggregation | none. Entries are orders, not price levels: `btc_uah` bids held 256 entries at 209 distinct prices, and `sol_usdt` bids 424 entries at 208 prices | P2 |
| level order | bids strictly descending apart from equal prices, asks ascending likewise, on all ten lists in both runs | P2 |
| head fields | `min_price`, `max_price` and `orders_sum`, which is quote currency on the bid list and base currency on the ask list, as S1 says | S1, P2 |
| far entries | lists run to absurd prices, for example a `btc_uah` bid of 0.0000000001 UAH for 1,000,000 BTC and an ask of 65,048,243 UAH | P2 |
| edge cache | `Cache-Control: no-cache`, but `X-Upstream: crypton_long_cache` and `X-GG-Cache-Status: EXPIRED, HIT` with two `X-GG-Cache-Date` values one second apart | P2, P3 |
| cache in practice | two reads 595 and 602 ms apart returned identical bodies. Reads 2 s apart differed on 28 of 29 and 29 of 29 in the two poll runs, each with a new cache date | P2, P3 |
| what changes | orders below the touch are repriced continuously. Two reads 2.5 s apart differed in 5 of 80 ask entries while the best ask stayed at 3,926,000 UAH through both 60 s runs | P3, one manual pair of reads |
| ticker against book | the ticker `buy` and `sell` matched the first bid and ask entries to ten decimals in both runs | P2 |
| reply size | 19,297 bytes for the `btc_uah` bids, 30,981 bytes for the `sol_usdt` bids | P2 |

Two calculators walk the book for a given amount, S1.
`GET /api/ask/btc_uah?is_api=1&amount=0.01` returned a buy of 0.01 BTC spread over 10 orders from 3,926,000 to 4,000,000 UAH, at an average of 3,977,901 and 3,977,803 UAH, P2.
`GET /api/bid/btc_uah?is_api=1&amount=0.01` returned a sale over 9 orders from 3,869,624 to 3,848,077 UAH, at an average of 3,863,293 and 3,863,276 UAH, P2.
Both answered with `Cache-Control: max-age=0` and `X-Upstream: crypton_balance`, so they are not cached.
A 0.01 BTC buy therefore pays about 1.3 % over the best ask, which is about 870 USDT of bitcoin at Kraken's price.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| published limit | none. The API documentation states no rate limit, S1 | S1 |
| CCXT's old spacing | `rateLimit` 3000 ms, at `ts/src/btctradeua.ts` line 23 of tag 4.1.51 | S4 |
| probed | 60 reads at about one per second in each poll run, all 200, with no `Retry-After` and no rate limit header | P3 |
| unknown pair on a book call | 404, `application/json`, `{"status":"false"}` | P1 |
| uppercase pair | 404, `{"status":"false"}` | P1 |
| unknown pair on `/api/ticker/<pair>` | 200 with the body `false`, and a doubled `Content-Type: application/json, application/json` | P1 |
| unknown pair on `/api/deals/<pair>` | 200 with `[]` | P1 |
| unknown path | 404 with the site's HTML error page | P1 |
| `/api/market_prices` | 502 with `{"status":"wait","timeout":1000}` on every read | P1 |

## 7. Server time and clock offset

No time call is documented, S1.
The `Date` header, at one second resolution, sat 0 to 1 s behind this host over ten reads, P1, which is what truncation to whole seconds produces.
The socket's `time_object.time` gives the same reading, see [`websocket.md`](./websocket.md) section 3.

The venue mixes two time bases.

| field | base | evidence |
|---|---|---|
| ticker `updated`, deals `unixtime` | Unix seconds, UTC | `updated` matched the cache date, and deal `unixtime` 1790097129 is 17:12:09 UTC, P1 and P2 |
| deals `pub_date` | Kyiv local time as text | "Sept. 22, 2026, 8:12 p.m." for that same deal, P1 |
| candles from `GET /api/japan_stat/high/<pair>` | Unix milliseconds shifted by 3 h | the last `btc_uah` candle was stamped 06:47:11 as UTC when read at 04:48 UTC, P1 |
| socket `time_object.time` | Unix seconds shifted by 3 h | see [`websocket.md`](./websocket.md) section 3 |

The candle reply held 1,438 and 1,437 candles, on average 30 minutes apart and about 30 days in all, in 113 KB, P1.

## 8. Recommended poller shape

None.
The venue has no perpetual, no index, no mark and no funding, so it has nothing for [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) to read, and template change 1 asks for no anchor poller on a spot venue.
It also has no CCXT class, so the connector could not build its catalog, see [`fees.md`](./fees.md) section 9.
If the spot book were ever wanted, it would be two REST calls per pair, no faster than the one second edge cache, and the four USDT pairs it could use did not trade in 24 h.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Документация API биржи, API documentation | https://btc-trade.com.ua/page/api_documentation | 2026-09-22 | BTC Trade UA, Ukraine | API base, ticker, order lists, deals, calculators, `usd_rate`, no time call, no rate limit, sections 1 to 3 and 5 to 7 |
| S2 | Trading page script `main.js` | https://btc-trade.com.ua/static/js/main.js?do=1myjsversio13.5 | 2026-09-22 | BTC Trade UA, Ukraine | `market_prices` every 30 s at lines 3045 to 3048, section 3 |
| S3 | Kraken public ticker | https://api.kraken.com/0/public/Ticker?pair=XBTUSDT | 2026-09-23 UTC | Kraken | reference price, section 2 |
| S4 | CCXT `btctradeua.ts` at tag 4.1.51 | https://raw.githubusercontent.com/ccxt/ccxt/4.1.51/ts/src/btctradeua.ts | 2026-09-22 | CCXT | hard coded markets, `rateLimit`, sections 2 and 6 |
| S5 | RIPE RDAP records for `136.243.53.121` and `49.12.191.2` | https://rdap.db.ripe.net/ip/136.243.53.121 | 2026-09-22 | RIPE NCC | Hetzner blocks in Germany, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:48 and 04:58 UTC, and `curl` reads of the same calls at 04:42 to 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) | 2026-09-23 UTC | this host | DNS, latency, catalog, deals, candles, errors, clock, sections 1 to 3, 6 and 7 |
| P2 | `rest-probe.mjs depth`, runs at 04:48 and 04:58 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) | 2026-09-23 UTC | this host | order lists, cache headers, calculators, Kraken reference, sections 2, 4 and 5 |
| P3 | `rest-probe.mjs poll`, runs at 04:49 and 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btc-trade-ua/rest-probe.mjs) | 2026-09-23 UTC | this host | ticker cache cadence, list changes, rate limit behaviour, sections 4 to 6 |
