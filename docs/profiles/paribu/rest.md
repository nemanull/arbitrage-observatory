# Paribu REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:58 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

This profile covers the public REST API of Paribu for its spot market, because Paribu lists no perpetual on its own exchange, see [`fees.md`](./fees.md) section 3.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) unless a source id says otherwise.
Every call was a public, unauthenticated GET, paced far below the published limits, and every result is from the Canadian VPN exit.

## 1. Host and latency from this machine

| item | value |
|---|---|
| documented base URL | `https://api.paribu.com`, S1 |
| resolved address | `api.paribu.com` to `104.18.4.98` and `104.18.5.98`, no AAAA record, both runs, P1 |
| front | Cloudflare, `server: cloudflare` on every reply. The edge varied between Seattle and Vancouver: every probe reply carried a `cf-ray` ending in `SEA`, three of four `curl` requests at 04:23 and 04:30 UTC ended in `YVR`, and the trace at `https://www.paribu.com/cdn-cgi/trace` answered `colo=YVR` in both probe runs and `colo=SEA` to `curl`, always with `loc=CA` |
| gateway | replies carry `x-krakend: Version undefined`, so a KrakenD gateway sits behind Cloudflare |
| refusals | none. Every documented public call answered 200 |
| website API | the web app's bundle names `https://api.blackswan.run` as its API base, which answered 200 for `/initials/config?scope=markets` once, and it is not documented for API clients |

One request cold and 20 warm at 250 ms spacing per call, P1.
Only the first call of each run opened the connection, so only its first request is cold.

| call | reply | first request | warm min, median, p90, max | edge cache |
|---|---|---|---|---|
| `GET /market/ticker` | 50.0 KB, 269 rows | 260 and 231 ms | 177, 189, 361, 535 ms and 171, 182, 206, 330 ms | `DYNAMIC` on 21 of 21 |
| `GET /orderbook?market=btc_tl&limit=100` | 4.6 KB | 241 and 230 ms | 27, 34, 215, 218 ms and 20, 25, 208, 212 ms | `HIT` on 15 of 21 in the second run, `EXPIRED` on 6 |
| `GET /cg/tickers` | 55.2 KB, 267 rows | 245 and 189 ms | 183, 195, 364, 371 ms and 166, 185, 218, 350 ms | `DYNAMIC` |
| `GET /initials/config?scope=markets` | 52.5 KB, 278 markets | 198 and 190 ms | 181, 196, 209, 222 ms and 171, 184, 216, 224 ms | `DYNAMIC` |

The book call is fast because Cloudflare serves it from the Seattle edge cache, section 5.
The full `/initials/config` without a scope was 190,872 bytes in 260 ms, and it carries the fee tables, see [`fees.md`](./fees.md) section 4.

## 2. Catalog

### The instruments call

`GET https://api.paribu.com/initials/config?scope=markets` returns `{"message", "meta", "payload": {"markets": {<id>: {...}}}}`, and the documentation recommends polling it every 60 s, S2.
A market row carries `labels`, `pairs` `{market, payment}`, `precisions` and `steps`, and optionally `badges`, `suspended`, `unlisted` and `listing_date`, P2.

```json
{"labels":["crypto_usdt"],"pairs":{"market":"btc","payment":"usdt"},"precisions":{"amount":6,"price":2},"steps":{"amount":"0.000001","price":"0.01"}}
```

| count | value, both runs |
|---|---|
| markets | 278 |
| quoted in TRY, spelled `tl` | 242 |
| quoted in USDT | 36 |
| `unlisted` true | 11: `agix_tl`, `eos_tl`, `ftm_tl`, `matic_tl`, `mkr_tl`, `mkr_usdt`, `prb_tl`, `rndr_tl` with `suspended` `"system_messages.market_suspended"`, and `rdnt_tl`, `ton_tl`, `tryc_tl` with `suspended` `"pre-launch"` |
| open | 267: 232 TRY and 35 USDT |
| `listing_date` present | 11, dates from 2026-06-09 to 2026-09-10 |
| perpetuals, any settlement asset | 0, no id or label names a derivative |

Every id equals `<pairs.market>_<pairs.payment>`, so the id is also the socket's market and the book call's `market`, P2.
A scope the server does not know answers 500 with an empty body, where the documentation says an unknown scope "fails the whole request", S2.
Labels: `crypto_tl` 242, `box_tl` 100, `fantoken_chz` 33, `ai_tl` 24, `meme_tl` 18, `crypto_usdt` 36, `meme_usdt` 6, `box_usdt` 2, `ai_usdt` 2, `new` 1.

### Ticker lists against the catalog

| call | rows | against the catalog |
|---|---|---|
| `GET /market/ticker` | 269 | the 278 catalog ids minus 9, and it keeps the pre-launch `ton_tl` and `tryc_tl` |
| `GET /cg/pairs` | 267 | exactly the 267 open markets, spelled `BTC_TRY` and `ETH_USDT`, which map to the catalog by lowercasing and writing `try` as `tl` |
| `GET /cg/tickers` | 267 | same ids, with `bid` and `ask` |

The ticker row is `{average, change, first, high, last, low, market, pair_volume, percentage, volume}`, all strings, and carries no bid or ask, S3.
The CoinGecko ticker's `bid` and `ask` give the spreads quoted in [`fees.md`](./fees.md) section 2: medians of 3,231 and 3,302 ppm over 232 TRY markets and 4,202 and 3,731 ppm over 35 USDT markets, with no one-sided and no crossed row, P2.

The 24 h quote volume is concentrated in TRY.
`USDT_TRY` traded 632 and 633 million TRY, then `SYN_TRY`, `XRP_TRY`, `BONK_TRY`, `PEPE_TRY`, `ETH_TRY`, `DRIFT_TRY` and `BTC_TRY` at 155 to 258 million TRY each, while the 36 USDT markets together traded 4.43 and 4.40 million USDT, P2.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no Paribu class, P2, see [`fees.md`](./fees.md) section 8.
The open pull request ccxt/ccxt#30536 parses this same config: `market.id` is the catalog id such as `btc_tl`, `base` and `quote` come from `pairs` with `TL` renamed `TRY`, `type` is `spot`, and `active` is false when `suspended` is set or `unlisted` is true, at lines 418 to 441 and 264 to 266 of its `ts/src/paribu.ts`, S8.
With that class `market.id` would match the socket's `s` and the book call's `market` exactly.
A spot market has no `contractSize`, and socket sizes are base currency, see [`websocket.md`](./websocket.md) section 4.
A base listed twice, such as `btc_tl` and `btc_usdt`, is two quotes, and only the USDT market falls in the engine's USD quote family.

## 3. Anchor

Paribu publishes no index price, no mark price and no funding rate, because its exchange lists no perpetual.
No call returns any `AnchorRow` column.

It publishes reference prices, none of which is an index.

| call | fields | note |
|---|---|---|
| `GET /market/ticker` | per market `last`, `average`, `first`, `high`, `low`, volumes | a 24 h summary, S3 |
| `GET /cg/tickers` | per pair `last_price`, `bid`, `ask`, `high`, `low`, volumes | `cache-control: max-age=1, public`, S4 |
| `match-price:<market>` on the socket | last trade price | see [`websocket.md`](./websocket.md) section 2 |

The DeFi perpetual product in the mobile app has a mark or oracle price and a funding rate, but they belong to the third-party protocol and no Paribu call exposes them, see [`fees.md`](./fees.md) section 3.

## 4. Anchor semantics

There is no index basket, no mark formula, no clamp and no funding formula to record for Paribu's exchange.
The funding settlement instant does not exist here, so nothing was captured or waited for.

## 5. REST book snapshot

`GET https://api.paribu.com/orderbook?market=<id>&limit=<n>` returns `{bids, asks, timestamp, last_offset, seq}`, S5.

| query | reply, both runs |
|---|---|
| no `limit`, `limit=20`, `limit=abc` | 20 bids and 20 asks |
| `limit=100` | 100 and 100 on `btc_tl` and `btc_usdt`, 100 bids and 82 then 81 asks on `usdt_tl` |
| `limit=500` | 100 and 100, clamped as documented |
| `market=nope_tl`, `market=btc-tl`, the unlisted `agix_tl` and `rdnt_tl`, or no `market` | 200 with the body `null` |
| `market=BTC_TL` | the `btc_tl` book, so REST ignores case while the socket refuses uppercase |

Bids were descending and asks ascending in every reply, P3.
`timestamp` is Unix seconds, and `seq` is the counter of the older `orderbook-diff` stream, not the `sq` of the newer socket book, see [`websocket.md`](./websocket.md) section 4.
`last_offset` "may have gaps", S5.

The book is edge cached.
Every reply carried `cache-control: public, max-age=3`, and at 250 ms spacing Cloudflare answered `HIT` on 15 of 21 calls with a median of 25 ms, P1.
At about 1.2 s spacing every reply was `EXPIRED`, and in the second run `seq` repeated on consecutive calls three times, 34,084,052, 34,084,053 and 34,084,056, P3.
A unique query parameter such as `&_=<ms>` answered `MISS` on 3 of 3 calls in both runs.
The age of `timestamp` at receipt was 344 to 1,182 ms and 200 to 1,071 ms over ten calls with such a parameter, which fits a one second timestamp, P5.
The newer socket delivers a snapshot in band, so a feed needs no REST seed, see [`websocket.md`](./websocket.md) section 4.

`GET /cg/orderbook?ticker_id=BTC_TRY&depth=<n>` splits `depth` across both sides, S4.
`depth=0` and `depth=200` gave 100 and 100, `depth=10` gave 5 and 5, `depth=1` gave an empty book, and `depth=501` answered 400 with `{"error":"depth must be an integer between 0 and 500; available depth is at most 100 levels per side", …}`, P3.
Its replies carried `cache-control: public, max-age=1` and `cf-cache-status: DYNAMIC`.

## 6. Rate limits and errors

The documented limit is per user: a weight bucket of 100,000 per minute that resets at `:00`, with `/market/ticker` weighing 1 and `/orderbook` 2, and 25 order creates and 25 cancels per second, S6.
An exceeded bucket answers 429 with `Retry-After: <seconds>` and `{"code": 429, "message": "Rate limit exceeded", "retry_after": 12}`, S6.
The documented `X-Quota-Remaining` header did not appear on anonymous calls, P4.

Anonymous calls carried a different, per-second header set, P4.

| call | `x-ratelimit-limit` | `x-ratelimit-remaining` over 20 calls at 5 per second | `x-ratelimit-reset` | `ratelimit` |
|---|---:|---|---:|---|
| `/market/ticker?market=btc_tl` | 100 | 98 on every call | 1 | `"client";r=98;t=1` |
| `/orderbook?market=eth_tl&limit=5` | 300 | 299 on every call | 1 | `"client";r=299;t=1` |
| `/cg/tickers`, one call | 100 | 98 | 1 | `"client";r=98;t=1` |

`/initials/config?scope=markets` and `/trades` carried no rate limit header, P4.
Reading these as 100 and 300 requests per second per client is an inference from `t=1` and the remaining count that never fell.
No 429 was provoked, so the anonymous refusal shape is Not verified.

| request | status | body |
|---|---:|---|
| `/market/ticker?market=nope_tl` or `market=BTC_TL` | 500 | `{"message": "Internal Server Error", "code": 5001}`, as documented, S3 |
| `/trades?market=btc_tl&limit=21` | 400 | `{"message":"limit: It must not exceed 20..","code":4001}` |
| `/trades?market=btc_tl` with no `limit` | 400 | `{"message":"limit: It must be a positive integer..","code":4001}` |
| `/trades?market=nope_tl&limit=5` | 200 | an empty array |
| `/nope` | 404 | `{"message":{"display":{"component":"none","content":"status"},"severity":"danger"},"meta":null,"payload":null}` |
| `/initials/config?scope=nope` | 500 | empty |
| `/orderbook?market=nope_tl` | 200 | `null` |

The documented error codes 4001 to 4135 and 5001 are listed in S7.

## 7. Server time and clock offset

No server time call is documented, S1.
The `Date` header minus the midpoint of each request had a median of -489 and -438 ms over ten calls, with ranges of -878 to 11 ms and -849 to 38 ms, P5.
With a one second header resolution that range is what a clock synchronised within a few tens of milliseconds produces.
The socket's `E` field is in milliseconds but is the server's event time, so it measures latency plus clock offset rather than the offset alone, see [`websocket.md`](./websocket.md) section 3.

## 8. Recommended poller shape

No anchor poller is recommended, since Paribu publishes no index, mark or funding.

If a spot book feed were ever built, the REST side would be the catalog only.

| item | recommendation | reason |
|---|---|---|
| catalog | `GET https://api.paribu.com/initials/config?scope=markets` every 60 s, keep rows with no `suspended` and no `unlisted` | documented cadence, 267 of 278 markets open |
| book seed | none | the newer socket sends a snapshot on subscribe |
| do not read | `/orderbook` as a live touch without a unique query parameter | edge cached for up to 3 s |
| rate limit pause | `rateLimitPauseMs` 60,000 for an authenticated client, or `Retry-After` when present | the documented bucket resets each minute |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Introduction, and the documentation index | https://docs.paribu.com/api/introduction | 2026-09-23 | Paribu | base URL, no time call, sections 1 and 7 |
| S2 | Exchange Config | https://docs.paribu.com/api/market-data/exchange-config | 2026-09-23 | Paribu | scopes, 60 s poll, section 2 |
| S3 | Ticker | https://docs.paribu.com/api/market-data/ticker | 2026-09-23 | Paribu | row shape, 500 code 5001, sections 2, 3 and 6 |
| S4 | Market Data for Coingecko | https://docs.paribu.com/api/market-data/coingecko | 2026-09-23 | Paribu | `/cg/pairs`, `/cg/tickers`, `/cg/orderbook` depth rules, sections 2, 3 and 5 |
| S5 | Orderbook | https://docs.paribu.com/api/market-data/orderbook | 2026-09-23 | Paribu | limit 20 to 100, `seq`, `last_offset`, null for unknown markets, section 5 |
| S6 | Rate Limiting | https://docs.paribu.com/api/error-handling/rate-limiting | 2026-09-23 | Paribu | weight bucket, weights, 429 shape, section 6 |
| S7 | Common Error Codes | https://docs.paribu.com/api/error-handling/common-error-codes | 2026-09-23 | Paribu | error codes, section 6 |
| S8 | ccxt/ccxt pull request 30536, `ts/src/paribu.ts` at head `4aff599` | https://github.com/ccxt/ccxt/pull/30536 | 2026-09-23 | CCXT | market parsing, section 2 |
| P1 | `rest-probe.mjs host`, runs at 04:32 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) | 2026-09-23 | this host | sections 1 and 5 |
| P2 | `rest-probe.mjs catalog`, runs at 04:31 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) | 2026-09-23 | this host | section 2 |
| P3 | `rest-probe.mjs book`, runs at 04:31 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | `rest-probe.mjs limits`, runs at 04:32, 04:50, 04:57 and 04:58 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) | 2026-09-23 | this host | section 6 |
| P5 | `rest-probe.mjs time`, runs at 04:32 and 04:51 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paribu/rest-probe.mjs) | 2026-09-23 | this host | sections 5 and 7 |
