# Giottus REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:08 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

Giottus documents a public REST API for spot only, at `https://api.giottus.com`, S1.
It documents no futures call, and two guessed futures paths answered 404.
The perpetual catalog, index, mark and funding exist in public form only inside the `https://www.giottus.com/futures` web page and on its undocumented socket, see [`websocket.md`](./websocket.md).
Every number here was read by [`rest-probe.mjs`](../../../scripts/probes/venues/giottus/rest-probe.mjs) unless a source id says otherwise.
Those numbers show that the Giottus perpetuals are Binance USD-M contracts: the same symbols, the same mark, index, funding rate and next settlement, and the same book.

## 1. Host and latency from this machine

| host | resolved | reply | cold | warm |
|---|---|---|---|---|
| `api.giottus.com` | Cloudflare `172.67.74.219`, `104.26.14.164`, `104.26.15.164` | 200 on every documented public call | 1,066 and 1,099 ms to first byte on the first call of two runs | 257 to 273 ms for `orderbook` over 16 calls in two runs |
| `www.giottus.com` | the same three addresses | 200, the futures page is 4.07 MB | 553 and 1,285 ms to first byte, 1,511 and 2,272 ms in total, two fetches | not polled |
| `socket.giottus.com` | the same three addresses | 101 on every upgrade | see [`websocket.md`](./websocket.md) section 5 | |

`cf-ray` named the Cloudflare colo `YVR` or `SEA` on every reply, and `cf-cache-status` was `DYNAMIC`.
All traffic left through the Canadian VPN exit, and no endpoint refused it, answered with a geoblock page, or asked for a challenge.

## 2. Catalog

### The instruments call

No public futures instruments call exists.
The API reference lists five public calls, `GET /api/v1/public/exchange/ticker`, `/exchange/symbols`, `/market/trades`, `/market/orderbook` and `/exchange/assets`, all for spot, S1.
`GET /api/v1/public/futures/symbols` and `/futures/ticker` returned 404 `{"code":"-1404","msg":"Endpoint not found."}` in both runs.

The futures page renders the whole catalog into its HTML as the argument of `Futures.init(...)`, a JSON object of 4.01 MB out of the 4.07 MB page, S3.

| key | content |
|---|---|
| `symbol_config` | 1,066 rows: 533 pairs quoted in USDT and the same 533 bases quoted in INR, each with `funding_frequency`, `leverage`, `market` and `limit` order steps, `margin_config`, `price_config` and `deductibles` |
| `mark_price` | one row per pair with `mark_price`, `index_price`, `settle_price`, `funding_rate`, `next_funding_time`, `exchange_id` and `exchange_symbol` |
| `ticker_data` | one 24 h ticker per pair with `top_bid` and `top_ask` |
| `delisted_contracts` | 44 pairs, with display precision only |
| `active_conversion_factors` | `USDT` at 1 and `INR` at `"usdt_price": "104.00000000"`, effective from 2026-08-07 |

No row carries a status field.
A pair is listed or it is in `delisted_contracts`.

### Mapping to Binance

| check | result |
|---|---|
| `exchange_id` | 1 on 1,066 of 1,066 rows |
| `exchange_symbol` | the Binance USD-M id, `BTCUSDT` for both `BTC/USDT` and `BTC/INR`, and base plus `USDT` on all 533 USDT rows |
| present in Binance `GET /fapi/v1/premiumIndex` | 1,066 of 1,066 rows, in both runs |
| Binance coverage | `premiumIndex` listed 860 symbols ending in `USDT` at 05:02 UTC, and 327 of them are not on Giottus |
| trade ids on the page and the socket | end in `-BN`, as `1790138482466-BN` |
| terms | "Contracts are priced, and liquidations are triggered, by reference to an index price derived from a third party exchange that we use for liquidity.", S2, addendum D8.1 |

The venue behind `exchange_id` 1 is not named anywhere public.
It is Binance by every check above, which is an inference, since no page says so.

### How CCXT maps it

CCXT has no Giottus class in 4.5.68 or in master 4.5.82, see [`fees.md`](./fees.md) section 8.
So `loadMarkets` cannot build this catalog, and there is no `market.id`, `contractSize`, `linear` or `active` to compare.
Were a class written, the natural `market.id` is the pair as the socket spells it, `BTC/USDT`, and the size unit is base coin, see [`websocket.md`](./websocket.md) section 4.

### Pairs listed twice and price scale

Every base is listed twice, once per quote, and both rows are one Binance contract.
In the engine's quote family USDT and INR are not one family, so the INR row would be a separate market, priced at Binance times a fixed 104.
That factor is not the market rate: CoinGecko showed Giottus `USDT/INR` spot last at 99.2 at 04:30 UTC, S4.
Three bases carry a 1000 multiplier in both the Giottus and the Binance id, `1000BONK`, `1000PEPE` and `1000FLOKI`, so they need the same price scale as on Binance.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| none documented | | | | | | | |
| `GET https://www.giottus.com/futures`, the web page | `mark_price[pair].index_price` | `mark_price[pair].mark_price` | `mark_price[pair].funding_rate` | `symbol_config[i].funding_frequency`, hours | `mark_price[pair].next_funding_time`, Unix ms as a string | 4.07 MB HTML | 1,511 and 2,272 ms |
| socket `markprice` event | `index_price` | `mark_price` | `funding_rate` | absent | `next_funding_time` | about 300 bytes per pair | one per pair every 3 s |

In the first fetch all 1,066 rows carried one `ets`, 1,527 ms before the page request started.
In the second the rows carried two `ets` values, 2,510 ms before and 490 ms after the request started, at one second resolution.
So the page is a server-side snapshot a few seconds old, and not a live read.

### Row mapping against Binance

The probe read Binance `premiumIndex`, `fundingInfo` and `ticker/bookTicker` 1,723 and 2,546 ms after it started the page request, in two runs, and compared every row, INR rows divided by 104.

| `AnchorRow` column | Giottus field | agreement with Binance |
|---|---|---|
| key | pair, `BTC/USDT` | `exchange_symbol` gives the Binance id |
| `index` | `index_price` | within 134 and 126 ppm at the median and 788 and 754 ppm at p90 over 1,066 rows, the two reads 2 to 5 s apart |
| `mark` | `mark_price` | within 115 and 142 ppm at the median and 818 and 871 ppm at p90, and on the socket equal to a Binance mark on 23 of 24, 23 of 25, 25 of 25 and 24 of 25 `BTC/USDT` frames in four runs |
| `fundingRate` | `funding_rate` | equal to `lastFundingRate` on 1,066 of 1,066 rows in both runs |
| `fundingIntervalHours` | `funding_frequency` | differs from Binance `fundingInfo` on 5 USDT rows in both runs: `G`, `MTL`, `ONE`, `SPY` and `T` |
| `nextFundingAt` | `next_funding_time` | equal to `nextFundingTime` on 1,066 of 1,066 rows in both runs |

`settle_price` is Binance's `estimatedSettlePrice` rounded to the tick: the 05:02 page read 87171.3 against Binance's 87171.33077935.
On the socket it equalled the Binance value of the matching poll on 20 of 23, 12 of 25 and 15 of 24 frames in three runs, the rest having moved between the two reads.
The `ticker_data` `top_bid` on the page was within 118 and 218 ppm of Binance's `bookTicker` bid at the median over 533 USDT rows.

## 4. Anchor semantics

### Index, mark and clamps

Giottus publishes no index formula, basket, mark formula or clamp.
The terms say only that the index is "derived from a third party exchange that we use for liquidity", and that Giottus "may change the index constituents or the mark price methodology", S2, addenda D8.1 and D8.3.
Since the index, mark and settle price equal Binance's, Binance's index basket, mark formula and clamps are the ones in force, see [`../binance/fees.md`](../binance/fees.md) for that venue's profile.
An INR row is the USDT row times 104, a constant set by Giottus and unchanged since 2026-08-07, so an INR anchor moves only with Binance.

### Funding

The rate is Binance's `lastFundingRate`, which on Binance is the rate for the upcoming settlement.
Whether Giottus settles its users at that rate and at that instant is not published, and the settlement instant itself was not captured.
No funding history call is public.

### How often each number changed

The socket carried `BTC/USDT` and `BTC/INR` anchors about every 3 s, 2,629 to 3,202 ms apart over five runs.
Over about 75 s the `BTC/USDT` mark changed on 18 to 22 of 23 or 24 intervals per run, and the `BTC/INR` mark on 21 to 24.
`ets` was 239 to 672 ms old on arrival.
In the 05:05 run the mark reached this host 243 to 1,275 ms after the `time` of the last Binance poll showing the same mark, median 272 ms, which is a lower bound on its age.
So each Giottus anchor is Binance's of about a quarter second earlier, refreshed once every 3 s.

## 5. REST book snapshot

No futures book call exists.
The futures page embeds a top of book for its default pair, `BTC/INR`, in `orderbook.topasks` and `topbids`, with sizes such as `"4.940 BTC"` and prices such as `"9058202.40 INR"`, which is 87,098.1 times 104, the `top_ask` of `BTC/USDT` in `ticker_data` on the same page, fetched at 04:42 UTC, S3.
The spot call `GET /api/v1/public/market/orderbook` documents `limit` up to 50, and `limit=50` on `BTC/USDT` returned 20 bids and 20 asks, bids descending and asks ascending.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| scope | "Public endpoints enforce limits based on the caller's IP address.", S1 | |
| headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` in Unix seconds, and `Retry-After` on 429, S1 | every documented call returned `x-ratelimit-limit: 1` and `x-ratelimit-remaining: 0`, with a reset 2 to 3 s after the reply, over 32 calls in two runs |
| numbers | Not publicly specified | calls spaced 2.5 s apart never failed, so the window is at most 2.5 s for one request |
| refusal | HTTP 429 with error code -1003 `TOO_MANY_REQUESTS`, S1 | not provoked |
| error shape | `{"code": <number>, "msg": "description"}`, S1 | `code` arrives as a string: `{"code":"-1105","msg":"Limit is outside the allowed range."}` with 400 for `limit=51`, `{"code":"-1121","msg":"Invalid symbol."}` with 400 for `NOPE/USDT`, and `{"code":"-1404","msg":"Endpoint not found."}` with 404 |
| futures page | none | one fetch per run, and it carries no rate limit headers |

The guessed futures paths carried no rate limit headers either.
The futures page was fetched twice in total and never polled, so its tolerance for polling is unknown.

## 7. Server time and clock offset

No time call is documented.
The `Date` header of twenty replies in two runs read 869 ms behind to 206 ms ahead of the local midpoint of each request, at the header's one second resolution, so the offset is under one second.
The spot `ticker` field `time` came back in Unix seconds, `"1790139100"`, although S1 says milliseconds.
The spot `trades` field `time` read `1790158898000` and `1790159575000`, about 5 h 30 min ahead of UTC in both runs, which is India time written as if it were UTC.

## 8. Recommended poller shape

No poller is recommended.

| item | finding |
|---|---|
| public anchor call | none, only a 4.07 MB web page rendered once per request, or the undocumented socket |
| content | Binance's index, mark, settle price, funding rate and next settlement, the INR row times 104 |
| redundancy | the engine's Binance anchor poller already reads the same numbers from Binance directly, and sooner |
| clock | the page snapshot was up to 2.5 s old when requested, and the socket republishes each mark only every 3 s |

If a later design wanted a Giottus anchor, it would be the Binance anchor row keyed by `exchange_symbol`, with the INR row scaled by 104 and `fundingIntervalHours` taken from Giottus's `funding_frequency` only where it differs.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Giottus API Reference | https://api.giottus.com/docs/ | 2026-09-22 | Giottus Technologies, India | public calls, rate limit headers, error shape, number format, sections 2, 6 and 7 |
| S2 | User Terms and Conditions, Derivatives and Perpetual Futures addendum | https://www.giottus.com/docs/termsandconditions.html | 2026-09-22 | Giottus Technologies, India | index from a third party exchange, methodology changes, sections 2 and 4 |
| S3 | Giottus futures page and its `Futures.init` config, version 2.3.42 | https://www.giottus.com/futures | 2026-09-22 | Giottus web front end | catalog, anchors, conversion factor, sections 2 to 5 |
| S4 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/giottus | 2026-09-22 | CoinGecko | spot `USDT/INR` last 99.2, section 2 |
| S5 | Binance USD-M `premiumIndex`, `fundingInfo` and `ticker/bookTicker` | https://fapi.binance.com/fapi/v1/premiumIndex | 2026-09-22 | Binance | the comparison rows, section 3 |
| P1 | `rest-probe.mjs futures` at 04:51 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/giottus/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 5 |
| P2 | `rest-probe.mjs spot` at 04:51 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/giottus/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 5, 6 and 7 |
| P3 | `ws-probe.mjs book`, runs from 04:49 to 05:05 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/giottus/ws-probe.mjs) | 2026-09-22 | this host | mark cadence and lag, section 4 |
