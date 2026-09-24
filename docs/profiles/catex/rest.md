# Catex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:23 to 04:43 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit Cloudflare places in Canada (`loc=CA`, edges SEA and YVR).

This profile covers the public REST API of Catex (catex.io), which has no CCXT class and lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Under template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), it records the spot catalog and recommends no anchor poller.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) unless a source is named.
The documentation is a GitHub wiki whose pages were last edited between 2023-06-15 and 2023-10-17, S1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `www.catex.io`, the only API host named in S1 |
| addresses | `104.26.2.184`, `104.26.3.184`, `172.67.75.16` and three IPv6 addresses in `2606:4700:20::/48`, all Cloudflare |
| DNS lookup | 12, 12 and 71 ms in three runs |
| edge | `cf-ray` ended in `SEA` or `YVR` from one request to the next, and `/cdn-cgi/trace` answered `colo=YVR`, `loc=CA`, `http=http/2`, `tls=TLSv1.3` |
| cold request, new TLS connection | 60 to 267 ms over 12 requests in three runs, on `cmc/summary`, `cmc/ticker`, `token/list` and `api/order` |
| warm `GET /api/cmc/summary` | 65 polls each run: median 40.7 and 34.9 ms, p90 56.4 and 42.2 ms, max 103.8 and 90.3 ms |
| warm `GET /api/cmc/ticker` | 65 polls each run: median 36.8 and 33.4 ms, p90 49.4 and 45.2 ms, max 57.3 and 60.3 ms |
| warm `GET /api/order?market=BTC/USDT&limit=20` | 15 polls each run: median 37.3 and 34.4 ms, max 357.5 and 85.6 ms |

Access results are from the Canadian VPN exit.
Every documented call answered 200 with JSON, and no call was refused or challenged by Cloudflare.
Canada is a restricted location in the Terms, see [`fees.md`](./fees.md) section 1, and public data was served anyway.

## 2. Catalog

### The catalog calls

| call | reply | key spelling | notes |
|---|---|---|---|
| `GET /api/cmc/summary` | array of 64 rows, 21,868 bytes | `trading_pairs` `"BTC_USDT"` | last price, best bid and ask, 24 h high, low and volumes, cached for 30 s, section 4 |
| `GET /api/cmc/ticker` | object with 64 keys, 9,562 bytes | key `"BTC_USDT"` | `last_price`, volumes, `isFrozen`, and `base_id` and `quote_id` |
| `GET /api/token/list` | `{"code":0,"data":[…]}` with 64 rows, 18,644 bytes | `pair` `"BTC/USDT"` | last price in quote and in USD, 24 h volume, `feeType` `"Percentage"` on all 64 |
| `GET /api/token/baseCurrency` | `{"code":0,"data":["USDT","BTC","ETH","TRX","BFIC"]}` | | no pair was quoted in `BFIC` |
| `GET /api/cmc/assets` | object with 100 assets, 19,477 bytes | asset code | `maker_fee`, `taker_fee`, `can_deposit`, `can_withdraw`, withdrawal bounds |
| `GET /api/token?pair=BTC/USDT` | one pair | `pair` `"BTC/USDT"` | same fields as `token/list` |

The three pair lists named the same 64 pairs in both runs.
The only status field is `isFrozen` in `cmc/ticker`, and it was `"0"` on all 64 pairs, so no closed pair could be probed.
No call publishes a tick size or lot size, and the WebSocket quote topic is the only place `priceDecimal` and `amountDecimal` appear, 2 and 5 for `BTC/USDT`, see [`websocket.md`](./websocket.md) section 6.

### Pairs

| quote | pairs |
|---|---:|
| USDT | 46 |
| BTC | 11 |
| ETH | 6 |
| TRX | 1 |
| total | 64 |

In both runs 25 of 64 pairs had zero 24 h quote volume, 4 had one side or no side in `cmc/summary`, and none was crossed.
Of 44 two-sided USDT pairs, 15 had a spread under 2,000 ppm in both runs, among them `BTC_USDT` at 191 and 170 ppm and `ETH_USDT` at 420 and 108 ppm.
Nine of the ten USDT pairs with the most 24 h volume had a spread of 888,889 ppm or more.
`MPRA_USDT` led with about 38 million USDT of 24 h quote volume against a best bid of 12,005,580 and a best ask of 4,449,239,221, and its REST book held 29 bids and 6 asks.
`MPRA` and `MPRD` were announced as new listings on 2025-04-08 and 2025-07-21, and an MPRA upgrade notice followed on 2026-01-27, S3.

### How CCXT maps it

It does not.
CCXT 4.5.68 has no Catex class, and neither does CCXT master, see [`fees.md`](./fees.md) section 8.
A future adapter would have to build the catalog from `cmc/summary` or `token/list` itself.

| engine field | Catex source |
|---|---|
| `rawMarketId` | `BTC/USDT`, the spelling of `api/order` and of every WebSocket topic |
| other spellings | `BTC_USDT` in every `cmc` call. `api/order` refuses `BTC_USDT` and `btc/usdt` with `{"code":1,"message":"Param market not correct"}` |
| size unit | base coin, spot, so no contract size |
| pairs listed twice | none |
| price scale | none needed, every pair is quoted per one base unit |

## 3. Anchor

Catex publishes no index price, no mark price and no funding rate, because it lists no perpetuals.
The only reference prices are the last trade price, `last_price` in `cmc/summary` and `cmc/ticker`, and its USD conversion, `priceByUSD` in `token/list` and `token?pair=`.
Neither is an index.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, see section 3.
What does change, and how often, over one second polls:

| reply | polls | changed |
|---|---|---|
| `cmc/summary` body | 65 in each of two runs | at 11 s and 41 s of the first loop, and at 24 s and 54 s of the second, so it is rebuilt every 30 s |
| `cmc/ticker` body | 65 in each of two runs | on 56 and 50 of 64 consecutive polls |
| `api/order` `BTC/USDT` 20 levels | 15 in each of two runs | 14 and 12 distinct books, 9 and 6 distinct best bid and ask pairs, 15 distinct `timestamp` values |

So the bid and ask in `cmc/summary` can be 30 s old, and the book calls are live.

## 5. REST book snapshot

| call | depth | observed |
|---|---|---|
| `GET /api/order?market=BTC/USDT&limit=N` | default 20, max 100, S1 | no `limit`, `limit=0` and `limit=-1` return 20 per side. `limit=100`, `101` and `500` return at most 100 per side: 100 bids and 60, 61 or 78 asks, the whole ask side. `limit=abc` answers 500 `{"code":1,"message":"System error"}` |
| `GET /api/order` with no `market` | "will return all trading paris' order books", S1 | `{"code":0,"message":"Success"}` with no `data` in both runs |
| `GET /api/cmc/orderbook/market_pair?market_pair=BTC_USDT&depth=N&level=L` | "Not defined or 0 = full order book, Depth = 100 means 50 for each bid/ask side", level 1 is the best bid and ask, S1 | no `depth` and `depth=0` return 50 per side. `depth=20` returns 20 per side. `depth=100` returns 100 bids and 63 or 79 asks, not 50. `level=1` returns one per side |
| `GET /order/BTC/USDT/buy/list` and `/sell/list` | the web page's own seed call, see [`websocket.md`](./websocket.md) section 4 | 16 objects `{coinCode, baseCoinCode, type, price, amount, total}`, best first |

Level order is best first on every book call: bids descending and asks ascending, with no duplicate price in 100 levels.
`api/order` sends each level as `["87132.180000000000","0.001480000000"]`, strings with 12 decimals, and a `timestamp` such as `"2026-09-23 04:28:41"`, UTC to the second.
`cmc/orderbook` sends the same strings and a Unix millisecond `timestamp`.
Read one right after the other, with the second request taking 34 and 86 ms, the first 20 levels of `api/order` and of `cmc/orderbook` were equal on both sides in both runs.
Every catalog reply, and an `api/order` reply read with curl, carried `cf-cache-status: DYNAMIC`, and no book reply was served from a cache, section 4.

Quiet and odd books, read with `limit=100`:

| pair | bids | asks | best bid | best ask |
|---|---:|---:|---|---|
| `QTUM/USDT` | 100 | 33 and 32 | 1.0399 | 1.0401 |
| `COSA/BTC` | 21 | 22 | 0.000023 | 0.0000232 |
| `MPRA/USDT` | 29 | 6 | 12,005,580 | 4,449,239,221 |

## 6. Rate limits and errors

No rate limit is published, S1.
The probe spaced most requests 500 to 700 ms apart, sent at most three in any one second, and saw no 429, no rate limit header and no `Retry-After`.
Where the real limit sits was not tested.

| request | status | body |
|---|---|---|
| `api/order?market=NOPE/USDT`, `market=btc/usdt`, `market=BTC_USDT` | 200 | `{"code":1,"message":"Param market not correct"}` |
| `api/order?market=BTC/USDT&limit=abc` | 500 | `{"code":1,"message":"System error"}` |
| `cmc/orderbook/market_pair?market_pair=NOPE_USDT` | 200 | `{"asks":[],"bids":[],"timestamp":1790137752362}` |
| `cmc/orderbook/market_pair` with no pair | 200 | `{"code":1,"message":"Param market_pair must not be empty"}` |
| `token?pair=NOPE/USDT` | 200 | `{"code":1,"message":"Param pair not correct"}` |
| `trading/history?market=NOPE/USDT` | 200 | `{"code":1,"message":"Param market not correct！"}`, with a full-width exclamation mark |
| `/api/nope` | 404 | `{"code":1,"message":"Page Not Found"}` |

An error is `code` 1 inside a 200 reply in most cases, so a client must read `code` and not rely on the status.
An unknown pair on `cmc/orderbook` is an empty book with no error at all.

## 7. Server time and clock offset

No server time call is documented, S1.
The `Date` header has one second resolution, and its offset from the local midpoint was −922 to −55 ms over 15 requests in three runs, which is agreement within that resolution.
The `cmc/orderbook` millisecond `timestamp` was −3 to +5 ms and −17 to +1 ms from the local midpoint over 5 requests in each of two runs, with round trips of 32 to 69 ms.
So the server clock and this host agree within about 20 ms.
The newest `BTC/USDT` trade was 10, 1 and 4 s old at the three reads, and trade times are UTC strings to the second.

## 8. Recommended poller shape

None.
Catex has no index, mark or funding, so there is nothing for an `AnchorPoller` to read, and it has no perpetual for the engine to track.
For a possible spot stage, `GET /api/order?market={BASE}/{QUOTE}&limit=16` is the seed call for the socket, see [`websocket.md`](./websocket.md) section 8.
`cmc/summary` is not a usable book source, because its bid and ask are rebuilt only every 30 s.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Catex exchange API wiki: Home, "Acquire trading pairs' order book", "Catex api integration for coinmarketcap", edited 2023-06-15 to 2023-10-17 | https://github.com/catex/catex_exchange_api/wiki | 2026-09-22 | Catex, global | host, calls, book limits, no rate limit or time call, sections 1, 5, 6 and 7 |
| S2 | CoinGecko exchange record `catex` | https://api.coingecko.com/api/v3/exchanges/catex | 2026-09-22 | CoinGecko | volume context, [`fees.md`](./fees.md) section 1 |
| S3 | Catex announcements | https://www.catex.io/announcement | 2026-09-22 | Catex, global | listing dates, section 2 |
| P1 | `rest-probe.mjs catalog`, at 04:28 and 04:41 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 2 |
| P2 | `rest-probe.mjs timing`, at 04:29 on an earlier 30 poll revision, and at 04:30 and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 4 |
| P3 | `rest-probe.mjs depth`, at 04:28 and 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 4 and 5 |
| P4 | `rest-probe.mjs errors`, at 04:29 and 04:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 5 and 6 |
| P5 | `rest-probe.mjs clock`, at 04:29 on an earlier revision without the millisecond read, and at 04:40 and 04:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 7 |
| P6 | `dig` at 04:23 and `curl https://www.catex.io/cdn-cgi/trace` at about 04:40 UTC | | 2026-09-22 | this host, Canadian VPN exit | section 1 |
