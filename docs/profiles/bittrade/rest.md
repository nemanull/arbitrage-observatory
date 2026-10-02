# BitTrade REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:12 to 03:36 UTC), from the development host near Seattle.

This profile covers the public REST API of BitTrade (CCXT id `bittrade`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every measured number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bittrade/rest-probe.mjs) unless it names another source.
The API is the Huobi v1 REST API served under BitTrade hosts, S1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api-cloud.bittrade.co.jp`, S1 |
| resolution | CNAME `api-cloud.bittrade.co.jp.cdn.cloudflare.net`, then `104.18.8.201` and `104.18.9.201` |
| edge | Cloudflare, `cf-ray` suffix `YVR`, so the Vancouver edge, with `cf-cache-status: DYNAMIC` |
| cold request | 464 and 503 ms for `GET /v1/common/timestamp` in two runs, TLS included |
| warm request | 106 to 176 ms, median 108 ms, over five requests, and 106 to 109 ms in the rerun after one read of 431 ms |
| catalog | 116 and 117 ms for the 62,536 byte `GET /v1/common/symbols` |

A warm request of about 108 ms against a Cloudflare edge in Vancouver means the origin answers from further away, most likely Japan, which is an inference.
No refusal, challenge or geoblock came back on any public call.

## 2. Catalog

### The instruments call

`GET /v1/common/symbols` returns every symbol the venue has ever listed, with its `state` and an `api-trading` flag, S1.

| state | quote | `api-trading` | count |
|---|---|---|---:|
| `online` | JPY | `enabled` | 17 |
| `online` | JPY | `disabled` | 28 |
| `suspend` | JPY | `disabled` | 1, `tonjpy` |
| `offline` | JPY | either | 14 |
| `offline` | BTC | `enabled` | 21 |
| `offline` | ETH | `enabled` | 10 |
| `offline` | HT | `enabled` | 4 |
| total | | | 95 |

The documented states are `online`, `offline` and `suspend`, S1.
The 17 `enabled` pairs are exactly the 17 pairs of the exchange fee table, see [`fees.md`](./fees.md) section 2.
The 28 `online` but `disabled` pairs, among them `soljpy`, `dogejpy` and `bnbjpy`, are not in the fee table, yet they publish a book over REST and WebSocket and show 0 to 1,393 trades a day in `GET /market/tickers`.
What those 28 books are for is Not verified.
Six offline BTC-quoted pairs still carry a `leverage-ratio` of 2 to 5.

### How CCXT 4.5.68 maps it

| field | CCXT | source |
|---|---|---|
| call | `publicGetCommonSymbols` | `server/node_modules/ccxt/js/src/bittrade.js` line 513 |
| `market.id` | `baseId + quoteId`, so `btcjpy`, equal to the REST `symbol` on 95 of 95 rows and to the socket topic symbol | line 565 |
| `type`, `spot`, `swap` | `spot`, true, false on every market, 0 swaps | lines 573 to 578 |
| `active` | `state === 'online'`, so 45 active markets, including the 28 whose `api-trading` is `disabled` | line 579 |
| `linear`, `contractSize` | `undefined` | lines 581 and 585 |
| `taker`, `maker` | 0.002, and 0 for OMG | line 563 |
| pair listed twice | none among the active markets | P1 |

Because every market is `spot`, the connector's swap filter at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202 keeps none of them.
`loadMarkets` took 707 and 481 ms in two runs, and it also reads the currency list.

### Size unit, pairs listed twice, and price scale

Sizes are base currency on REST and on the socket, and `contractSize` is undefined, which the engine reads as 1.
No pair is listed twice, and no price is quoted per 10 or per 1000 units.
Every online pair is quoted in JPY, which is outside the USD, USDC and USDT settlement family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so even a spot leg would share no quote with the other venues.

## 3. Anchor

BitTrade publishes no index, no mark and no funding rate, because it lists no perpetual.
No call returns any `AnchorRow` column.

| call | what it carries | reply | warm time |
|---|---|---|---|
| `GET /market/tickers` | per pair `open`, `high`, `low`, `close`, `amount`, `vol`, `count`, `bid`, `bidSize`, `ask`, `askSize`, and an envelope `ts` | 8,203 to 8,212 bytes, 45 rows | 60 polls: min 115, median 122, p90 130, max 487 ms, and in the rerun 109, 114, 119 and 443 ms |
| `GET /market/detail/merged?symbol=btcjpy` | the same for one pair, with `bid` and `ask` as `[price, size]` and a `version` | 319 bytes | 115 and 116 ms |
| `GET /v1/retail/maintain/time` | the dealer's maintenance window, `state` 0 | 178 bytes | 125 ms |
| `wss://api-cloud.bittrade.co.jp/retail/ws` topic 1 | the dealer's own buy and sell price per coin, S1 | | not probed |

The nearest thing to a reference price is the dealer (販売所) price, which is BitTrade's own quote as counterparty, not an index of other venues.
`GET /v2/market-status`, which CCXT lists, answered 404.

## 4. Anchor semantics

None of index, mark or funding exists, so there is no formula, basket, clamp or cap to record.

Over 60 one second polls of `GET /market/tickers` at 03:25 UTC, the envelope `ts` changed on 60 of 60.
Per pair, the bid or ask changed on a median of 8 polls, with a minimum of 0 and a maximum of 21.
`btcjpy` did not change once in that run: its touch sat at 13,646,221 and 13,646,222 JPY through the minute, and the last trade was 119 s old at 03:27 UTC.
In the rerun at 03:34 UTC the envelope `ts` again changed on 60 of 60, the per pair median was 9 and the maximum 38, and `btcjpy` changed on 38 polls.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /market/depth?symbol=btcjpy&type=step0`, `type` required, `step0` unaggregated, `step1` to `step5` aggregated by 10 to 100,000 price ticks, S1 |
| depth | 150 levels per side on `step0` by default, and 20 on `step1`. An undocumented `depth=5` or `depth=20` returns 5 or 20 levels |
| level order | bids descending and asks ascending on 4 of 4 pairs in two runs |
| numbers | JSON numbers in exponent notation, `[1.3646221E7,0.00351]` |
| sequence | `tick.version` is a `seqNum` of the socket's `mbp.150` stream, see [`websocket.md`](./websocket.md) section 4 |
| freshness | `tick.ts` was 195 to 1,239 ms old on `btcjpy` and `ethjpy`, and 1,669 to 7,823 ms old on `batjpy` and `soljpy`, over two runs |
| caching | two reads 150 ms apart returned the same `version` and `tick.ts` in two runs, which shows the book did not move, not that it is cached. `cf-cache-status` was `DYNAMIC` |
| reply | 5,744 bytes for 150 levels a side on `btcjpy`, 107 to 197 ms for any depth call |

Errors come back with HTTP 200 and `"status":"error"`.

| request | reply |
|---|---|
| `type=step9` | `{"ts":1790133509858,"status":"error","err-code":"invalid-parameter","err-msg":"invalid type:step9"}` |
| no `type` | `"err-msg":"invalid type:null"` |
| `symbol=nopejpy`, or the offline `adaeth` | `"err-msg":"invalid symbol"` |
| an unknown path, `/market/tickers/nope` | HTTP 404, body `404 Not Found` |

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public REST | "公開APIの場合、IP毎に1秒以内に10回に制限されます。", 10 requests per second per IP, S1 | not provoked. The poll ran at one request a second |
| signed REST | 10 requests per second per API key, S1 | not probed |
| CCXT | `rateLimit: 100`, one request per 100 ms | `server/node_modules/ccxt/js/src/bittrade.js` line 24 |
| limit status code and `Retry-After` | Not publicly specified | not provoked. No rate limit header appeared on any reply |
| error shape | `{"ts": 1632970571737, "status": "error", "err-code": "invalid-parameter", "err-msg": "invalid symbol"}`, S1 | identical, with HTTP 200 |

The socket's snapshot request does have a limit, see [`websocket.md`](./websocket.md) section 4.

## 7. Server time and clock offset

`GET /v1/common/timestamp` returns `{"status":"ok","data":1790133127613}` in ms.
Five reads against the midpoint of each request gave offsets of 30, 2, -2, 3 and 2 ms with round trips of 180, 106, 113, 108 and 107 ms.
The rerun gave 3, 3, 3, 2 and 3 ms with round trips of 105 to 109 ms.
The first read of the first run was the slow one, and the other reads put the host clock within 3 ms of the venue.

## 8. Recommended poller shape

None.
The venue publishes no index, mark or funding rate, so an anchor poller has nothing to read, and the connector would skip the venue before a poller starts.
If a spot leg is ever built, the book comes from the socket, and `GET /market/depth` with `type=step0` is the REST fallback for a snapshot.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitTrade API documentation | https://api-doc.bittrade.co.jp/ | 2026-09-22 | BitTrade Inc., Japan | host, symbol fields and states, depth `type`, limits, error shape, dealer socket, sections 1 to 6 |
| C1 | CCXT 4.5.68 `bittrade.js` | `server/node_modules/ccxt/js/src/bittrade.js` | 2026-09-22 | CCXT | lines 24, 513, 563 to 585, section 2 and 6 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bittrade/rest-probe.mjs) `catalog` at 03:18 UTC | | 2026-09-23 UTC | this host | sections 1 to 3 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/bittrade/rest-probe.mjs) `book` and `time` at 03:18 UTC | | 2026-09-23 UTC | this host | sections 5 and 7 |
| P3 | [`rest-probe.mjs`](../../../scripts/probes/venues/bittrade/rest-probe.mjs) `poll` at 03:25 UTC, and `curl` of `/market/trade` and `/v1/retail/maintain/time` at 03:27 UTC | | 2026-09-23 UTC | this host | sections 3 and 4 |
| P4 | [`rest-probe.mjs`](../../../scripts/probes/venues/bittrade/rest-probe.mjs) `all`, the second pass at 03:34 to 03:35 UTC | | 2026-09-23 UTC | this host | the second readings in sections 1 to 7 |
