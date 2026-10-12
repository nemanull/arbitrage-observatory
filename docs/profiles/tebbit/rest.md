# Tebbit REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:03 to 03:36 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public futures REST surface of Tebbit, which has no CCXT id, for its one perpetual family, USDT-margined linear perpetuals.
Tebbit publishes no API documentation.
Every path below comes from the website bundle `https://tebbit.io/static/js/main.28a3fab6.chunk.js`, S1, where the futures client prefixes `/futures` to `/fapi` or `/dapi`, and the market paths add `/market`.
Every number was read by [`rest-probe.py`](../../../scripts/probes/venues/tebbit/rest-probe.py), runs P1 and P2 at 03:14 and 03:22 UTC and the second pass run P3, unless a row names another source.

## 1. Host and latency from this machine

| host | resolved | TLS from this exit | role |
|---|---|---|---|
| `tebbit.io` | 3 IPv4 addresses: 13.228.186.245, 18.140.220.133, 47.131.34.140 | TLS 1.2, 200 | website, REST and WebSocket used here |
| `tebbit.vip`, `www.tebbit.vip` | the same three addresses, `www.tebbit.vip` through an AWS load balancer in `ap-southeast-1` | TLS 1.2, 200 | backup domain, same site |
| `www.tebbit.io` | `ha11.shieldedges.com`, 12 IPv4 addresses | TCP connects, the TLS handshake times out with no server hello | the domain the help center names as official |
| `tebbit.com`, `www.tebbit.com` | the same 12 `shieldedges` addresses | the same timeout, and plain HTTP on port 80 timed out too, P3 | the website CoinMarketCap lists |

The edge accepts the TCP connection and never answers, rather than refusing with an alert or a status code.
Whether that edge blocks this exit or is simply down cannot be told from here.

| measure | value |
|---|---|
| `GET /futures/fapi/market/v1/public/time`, first request | 751 to 780 ms |
| the same, five warm requests | median 763 to 767 ms |
| every other public call | 743 to 987 ms, except one whole book read of 1,587 ms in P1, see the tables below |

About 760 ms per request is the round trip to the Singapore region from Vancouver.

## 2. Catalog

### The instruments call

`GET https://tebbit.io/futures/fapi/market/v1/public/symbol/list` returns every futures contract in one reply: 414 rows, 446 KB, about 21.5 KB gzipped, in 980 to 983 ms.

| field | values on 2026-10-10 from 03:14 to 03:28 UTC, the same in P1, P2 and P3 |
|---|---|
| `contractType` | `PERPETUAL` on 412 rows, `EVENT` on 2: `btcevent_usdt`, `ethevent_usdt` |
| `underlyingType` | `U_BASED` on all 414 |
| `quoteCoin` | `usdt` on all 414 |
| `state` | `0` on all 414 |
| `tradeSwitch` | `true` on all 414 |
| `contractSize` | `0.001` on 101 perpetuals, `0.01` on 99, `1` on 68, `0.1` on 57, `10` on 49, `100` on 14, `0.0001` on 13, `1000` on 5, `100000` on 2, `10000` on 1 |
| `makerFee`, `takerFee`, `liquidationFee` | per contract, see [`fees.md`](./fees.md) sections 4 and 7 |
| `partitionId` | 173 perpetuals in `Stocks`, 11 in `Commodities`, the rest in crypto partitions such as `Meme` 26 and `DeFi` 25, from `GET .../v1/public/symbol/partition` |

The coin-M twin, `GET https://tebbit.io/futures/dapi/market/v1/public/symbol/list`, returns `{"code":0,"msg":"success","data":[]}`.
Active perpetual count by settlement asset: USDT 412, USDC 0, coin 0.
The spot catalog `GET https://tebbit.io/pro/p/symbol/list` lists 21 USDT pairs and is not detailed.

### Symbols

`symbol` is lower case `base_quote`, such as `btc_usdt`, and it is the same string the socket and the anchor calls use, see [`websocket.md`](./websocket.md) section 3.
Five symbols are Chinese: `币安人生_usdt`, `我踏马来了_usdt`, `龙虾_usdt`, `牛来_usdt` and `哈基米_usdt`, and they must be URL encoded in a query string.
No base coin is listed twice, and no symbol is upper case.
An upper case symbol is refused with `{"code":-1,"msg":"invalid symbol","data":null}`.

### How CCXT 4.5.68 maps it

CCXT has no Tebbit class, see [`fees.md`](./fees.md) section 8, so a catalog would be built from this call by hand: `id` from `symbol`, `base` and `quote` from `baseCoin` and `quoteCoin` upper cased, `contractSize` from `contractSize`, linear true, and active from `state` 0 with `tradeSwitch` true.

### Size unit and price scale

Book sizes are in contracts, and `contractSize` gives the base amount per contract, 0.0001 BTC on `btc_usdt`.
The ticker's `v` turnover divided by `a` times `contractSize` times the last price had a median of 0.997 and sat within 0.8 to 1.25 on 411 of 412 perpetuals in P3, so `a` counts contracts and `contractSize` describes the unit the book uses.
On `btc_usdt`, `a` 38,438,492 times 0.0001 times 82,557 is about 317.3 million against a `v` of 317,693,155 USDT.
No price scale showed up: against XT's index for the same symbol the p90 difference stayed under 2,000 ppm, and only 4 of 358 shared symbols differed by more than 1 %, section 4.
Those 4 were not examined one by one.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /futures/fapi/market/v1/public/q/index-price` | `p` | | | | | 417 rows, 20.5 KB, 4.8 KB gzipped | 753 to 836 ms on 9 reads, and a median of 772 to 774 ms over 40 polls |
| `GET /futures/fapi/market/v1/public/q/mark-price` | | `p` | | | | 417 rows, 20.5 KB, 4.8 KB gzipped | 749 to 800 ms on 9 reads, and a median of 776 to 778 ms over 40 polls |
| `GET /futures/fapi/market/v1/public/q/agg-tickers` | `i` | `m` | | | | 415 rows, 77.6 KB, 23.7 KB gzipped | 933 to 987 ms |
| `GET /futures/fapi/market/v1/public/q/funding-rate?symbol=` | | | `fundingRate`, `null` | `collectionInterval`, `null` | `nextCollectionTime`, `null` | one contract | about 770 ms |
| `GET /futures/fapi/market/v1/public/q/funding-rate-record?symbol=` | | | history, empty | | | `{"hasPrev":false,"hasNext":false,"items":[]}` | about 760 ms |

The index and mark calls cover all 412 perpetuals and add five extra rows: the two event contracts and `ip_usdt`, `mkr_usdt` and `sats_usdt`, which are not in the catalog.
XT's CoinGecko feed path, `/v1/public/cg/contracts`, answers 404 here, so there is no bulk funding call at all.
The funding call returned `fundingRate`, `collectionInterval` and `nextCollectionTime` all `null` on 60 of 60 contracts sampled evenly across the catalog in each of P1, P2 and P3, and the funding history returned no items on 10 of 10 in each run.
The account funding list, `/futures/fapi/user/v1/balance/funding-rate-list`, answers HTTP 403 with an empty body without a token.
No WebSocket channel carries funding either, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | call and field | on the wire | conversion |
|---|---|---|---|
| key | `s` | `btc_usdt` | none |
| `index` | `q/index-price` `p` | decimal string | parse, but see section 4: it is the venue's own last trade |
| `mark` | `q/mark-price` `p` | decimal string, never 0 on 412 rows | parse |
| `fundingRate` | none published | `null` | none possible |
| `fundingIntervalHours` | none published | `null` | none possible |
| `nextFundingAt` | none published | `null` | 0, unknown |

The rows' `t` stamps were 0.3 to 0.6 s old on arrival by the local clock in P2 and P3, and the server clock reads about 0.3 s ahead, section 7, so the readings are under a second old.

## 4. Anchor semantics

### Index

No index formula, basket or constituent call is published.
On the wire the index is the contract's own last trade.

| measure, from one `q/agg-tickers` reply on 412 perpetuals | P1 | P2 | P3 |
|---|---|---|---|
| index `i` equal to the last trade `c` | 378 | 390 | 398 |
| mark `m` equal to the last trade `c` | 402 | 405 | 405 |
| index equal to mark | 387 | 395 | 405 |
| mark inside the contract's own bid and ask | 401 | 404 | 409 |
| abs(mark ÷ index − 1) | median 0 ppm, p90 0, max 2,185 | median 0, p90 0, max 456 | median 0, p90 0, max 387 |

An external comparison confirms it.
Against XT's public index on 358 shared symbols, Tebbit's index differed by a median of 537 to 567 ppm, a p90 of 1,855 to 1,982 ppm, and more than 1 % on 4 symbols in each run.
On the majors Tebbit sat below XT in every run: BTC by 328 to 473 ppm, ETH by 329 to 371 ppm.
Against OKX's index on 305 shared symbols the median absolute difference was 537 to 646 ppm, and BTC sat 449 to 562 ppm below OKX.
So Tebbit's prices run a few hundred ppm off the market, and its index follows its own trades, not the market.
This is the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), in its strongest form: the index is the leg itself.

### Mark

No mark formula is published.
The liquidation article says liquidation is "Triggered when the mark price falls below the liquidation price", see [`fees.md`](./fees.md) section 7.
On the wire the mark equals the last trade on 402 to 405 of 412 contracts in three runs, so it carries no information the book does not.

### Funding

No funding formula, interval, cap or rate is published, and every public funding field is `null`, section 3.
Whether funding is charged at all is Not publicly specified, see [`fees.md`](./fees.md) section 6.

### How often each number changed

Over 40 one second polls of the two bulk calls, P1, P2 and P3:

| series | value changed | `t` changed |
|---|---|---|
| index `btc_usdt` | 9, 17 and 18 of 39 polls | 39 of 39 |
| mark `btc_usdt` | 9, 17 and 18 of 39 | 39 of 39 |
| index `eth_usdt` | 17, 13 and 21 of 39 | 39 of 39 |
| mark `eth_usdt` | 17, 13 and 21 of 39 | 39 of 39 |

The index and the mark changed on exactly the same polls, which fits both being the last trade.
The stamps advance every second, so a freshness check on `t` passes even when the value has not moved.

## 5. REST book snapshot

`GET https://tebbit.io/futures/fapi/market/v1/public/q/depth?symbol=btc_usdt&level=<n>` returns `{t, s, u, b, a}`.

| `level` | levels returned on `btc_usdt` | reply |
|---|---|---|
| 5, 20, 50, 100 | exactly that many a side | 288 B to 3.7 KB, 753 to 787 ms |
| 500 | 240 bids and 464 asks in P1, 293 and 382 in P2, 297 and 378 in P3, the whole book | 12.0 to 12.6 KB, 763 to 1,587 ms |
| 1000 | the same whole book | 12.0 to 12.6 KB |

Bids are descending and asks ascending.
Two reads 300 ms apart returned different `u` and different books, so the reply is not cached for that long.
`u` is the same id space as the socket's full book `id`, and one REST read matched a socket full book id exactly, see [`websocket.md`](./websocket.md) section 4.
REST sizes were plain decimals, 0 of 100 in E notation, while the socket's full books use E notation often.
An unknown or upper case symbol answers HTTP 200 with `{"code":-1,"msg":"invalid symbol","data":null}`.

## 6. Rate limits and errors

No limit is published.
Every reply carries Spring Cloud Gateway limiter headers: `X-RateLimit-Burst-Capacity: 10000`, `X-RateLimit-Replenish-Rate: 10000`, `X-RateLimit-Requested-Tokens: 1` and `X-RateLimit-Remaining: 9999`.
No probe went above about three requests a second, no limit was hit, and no `Retry-After` was seen.

| case | answer |
|---|---|
| unknown path under `/market` | HTTP 404, `{"timestamp":"...","status":404,"error":"Not Found","path":"/v1/public/q/nonexistent"}` |
| unknown path under `/futures` | HTTP 404 with the same shape plus `requestId` |
| unknown path at the root | HTTP 200 with the website's HTML |
| bad symbol | HTTP 200, `code` -1, `msg` `invalid symbol` |
| funding call without a symbol | HTTP 200, `{"code":-1,"msg":"invalid symbol","data":null}` |
| private call without a token | HTTP 403, empty body |

A poller has to treat `code` other than 0 inside an HTTP 200 as a failure.

## 7. Server time and clock offset

`GET https://tebbit.io/futures/fapi/market/v1/public/time` returns `{"code":0,"msg":"success","data":<Unix ms>}`.
Server time minus the local midpoint was 286 to 310 ms over five reads in P1, median 296 ms, 299 to 329 ms in P2, median 301 ms, and 290 to 342 ms in P3, median 294 ms.

## 8. Recommended poller shape

No poller is recommended, because the anchor cannot be filled honestly.

| need | what Tebbit offers |
|---|---|
| index | `q/index-price` `p`, which equals the contract's own last trade on 92 to 97 % of contracts |
| mark | `q/mark-price` `p`, which equals the last trade on about 98 % of contracts |
| funding rate, interval, next settlement | nothing, every field is `null` and the history is empty |

If a poller were written anyway, it would read `q/index-price` and `q/mark-price` once a second, about 4.8 KB gzipped each and under 1 s, key rows by `s`, skip the five rows not in the catalog, and treat a non zero `code` as a failure.
It would still leave `fundingRate` empty, and its index would let a Tebbit leg pass the fresh gate while describing nothing but itself.
So the venue is blocked on the anchor, not on the book feed.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | website bundle `https://tebbit.io/static/js/main.28a3fab6.chunk.js`: the axios interceptor that prefixes `/futures` to `/fapi` and `/dapi`, the market paths under `/market`, and the public endpoint names `SYMBOL_CONFIG_LIST`, `TICKER_DEPTH_LIST`, `TICKER_FUNDING_RATE`, `TICKER_INDEX_PRICE`, `TICKER_MARK_PRICE` | 2026-10-09 |
| S2 | XT public index, `https://fapi.xt.com/future/market/v1/public/q/index-price` | 2026-10-09 |
| S3 | OKX public index, `https://www.okx.com/api/v5/market/index-tickers?quoteCcy=USDT` | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/tebbit/rest-probe.py), 2026-10-10 03:14 UTC. Its age on arrival figures were measured after later reads and are not cited. | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/tebbit/rest-probe.py), 2026-10-10 03:22 UTC | 2026-10-09 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/tebbit/rest-probe.py), second pass run, 2026-10-10 03:27 UTC, which added the port 80, unknown path and turnover checks | 2026-10-09 |
