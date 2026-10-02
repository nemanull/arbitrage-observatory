# BitKan REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:34 UTC, from the development host near Seattle.

BitKan publishes no REST API.
No `api`, `docs` or `openapi` host resolves, no help article names an API, and CCXT has no class, see [`fees.md`](./fees.md) section 8.
The website's own REST calls live on `bitkan.com` behind a Cloudflare challenge that refuses this host.
This profile records what was reachable, what refused, and the evidence that BitKan's perpetuals are Binance USD-M contracts.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs).

## 1. Host and latency from this machine

| host | resolved | request | status and body | cold, run 1 and 2 | warm, run 1 and 2 |
|---|---|---|---|---|---|
| `bitkan.com` | 104.20.42.219, 172.66.155.242, Cloudflare | `GET /` | 403, `cf-mitigated: challenge`, title "Just a moment..." | 73, 77 ms | 69, 58 ms |
| `bitkan.com` | same | `GET /help/fee` | 403, challenge | 61, 43 ms | 61, 48 ms |
| `bitkan.com` | same | `GET /help/protocol`, the terms | 403, challenge | 61, 54 ms | 68, 69 ms |
| `bitkan.com` | same | `GET /proxy/v2/contract/symbol/contracts?exchange=binance&update_time=0&strategy_type=0` | 403, challenge | 49, 44 ms | 105, 60 ms |
| `bitkan.com` | same | `GET /proxy/v2/contract/quote/depth?contract_id=BINANCE-BTC-USDT&depth=1` | 403, challenge | 55, 63 ms | 45, 43 ms |
| `bitkan.com` | same | `GET /proxy/v2/contract/quote/open_interest` | 403, challenge | 53, 52 ms | 61, 44 ms |
| `bitkan.com` | same | `GET /api/seo/rates?from=USDT&to=USD` | 403, challenge | 69, 43 ms | 47, 64 ms |
| `help.bitkan.com` | 216.198.53.2, 216.198.54.2, CNAME `bitkan.zendesk.com` | `GET /hc/en-us` | 403, title "Edge IP Restricted \| help.bitkan.com \| Cloudflare", body `error code: 1034` to curl | 55, 68 ms | 15, 17 ms |
| `help.bitkan.com` | same | `GET /api/v2/help_center/articles/search.json?query=API` | 403, Edge IP Restricted | 15, 18 ms | 16, 20 ms |
| `s.btckan.com:8080` | 190.92.253.49 | `GET /` | 426 `Upgrade Required`, `Server: elb` | 747, 761 ms | 211, 190 ms |
| `cdn.bitkan.net` | 99.86.101.45, .70, .71, .100, CloudFront | `GET /cdn/static/js/config-CiXgh45W.js` | 200, 54,618 bytes of JavaScript | | |
| `api.bitkan.com`, `docs.bitkan.com`, `openapi.bitkan.com` | ENOTFOUND | | | | |

The `cf-ray` suffixes were `SEA` and `YVR`, so the refusal comes from Cloudflare's Seattle and Vancouver edges.
A request with a desktop browser `User-Agent` got the same 403 challenge, so the refusal is Cloudflare's JavaScript challenge and not a filter on curl's agent.
WebFetch, which does not originate here, also got 403 on `https://bitkan.com/` and `https://help.bitkan.com/hc/en-us`.
No attempt was made to solve the challenge.
The timings above are Cloudflare's refusal, not a BitKan origin reply.

## 2. Catalog

### The instruments call

No public instruments call exists.
The website fetches its futures catalog from `/proxy/v2/contract/symbol/contracts?exchange=<venue>&update_time=0&strategy_type=0`, S1, which refused this host, section 1.
The Wayback Machine holds one copy of that reply, captured 2023-03-27 09:05:37 UTC, S2, and it reads as follows.

| field | value on 169 of 169 rows |
|---|---|
| `exchange` | `binance` |
| `group_name` | `Binance` |
| `future_type_name` | `Perp` |
| `currency` | `USDT` |
| `status` | `2` |
| `contract_id` | `BINANCE-BTC-USDT` shape |

`BINANCE-BTC-USDT` carried `preferences_title` "Binance USDT-M Preferences", `contract_size` `"0.001"`, `leverage_max` `"125"` and `min_notional` `"5"`.
Its `min_price` `"556.8"`, `max_price` `"4529764"`, `price_step_size` `"0.1"`, `min_quantity` `"0.001"`, `quantity_step_size` `"0.001"` and `max_quantity` `"1000"` equal the `PRICE_FILTER` and `LOT_SIZE` of Binance's `BTCUSDT` read on 2026-09-23 UTC, whose `MIN_NOTIONAL` has since moved to 50.

### Today's count, from CoinGecko

| call | reply |
|---|---|
| `GET https://api.coingecko.com/api/v3/derivatives/exchanges/bitkan-futures` | 726 perpetual pairs, 0 dated futures, open interest 15,275.42 and 15,247.73 BTC, 24 h volume 14,238.35 and 14,328.64 BTC, in two reads eleven minutes apart |
| same with `include_tickers=unexpired` | 723 tickers, every one `target` `USDT` and `contract_type` `perpetual`, symbols spelled `0G_USDT_PERP`, `trade_url` `https://bitkan.com/futures` |

Every one of the 723 symbols, with `_PERP` and the underscores removed, is a Binance USD-M perpetual in `GET https://fapi.binance.com/fapi/v1/exchangeInfo`.
720 are `TRADING` there, and the other three, `ICXUSDT`, `SCRTUSDT` and `STORJUSDT`, are `SETTLING`.
Binance listed 771 trading USD-M perpetuals at the time, 571 crypto and 200 TradFi, so BitKan carries most of them.
None matched a Binance COIN-M perpetual.
The CoinGecko funding rate equalled Binance's current `lastFundingRate` on 446 and 445 of 723 rows in two reads, and the rest differ by the age of CoinGecko's snapshot, which is not published.
CoinGecko's spot entry `GET /api/v3/exchanges/bitkan` gave trust score 8, trust rank 43, 602 pairs and a 24 h volume of 2,098 and 2,112 BTC in two reads.

### How CCXT maps it

It does not, since there is no class.
The website socket spells a contract `BINANCE-BTC-USDT`, the website catalog spells it the same way in `contract_id`, and CoinGecko spells it `BTC_USDT_PERP`.
The Binance class already maps the same contract as `BTCUSDT`, which the engine trades today.

### Size unit, pairs listed twice, and price scale

The socket's trade `volume` is in coins, see [`websocket.md`](./websocket.md) section 4.
No pair appears twice in the 2023 copy or on CoinGecko.
Symbols keep Binance's multiplier prefixes, as `1000000MOG_USDT_PERP` on CoinGecko shows, so the price scale is Binance's.

## 3. Anchor

### The bulk calls

None public.
The website reads mark, index and funding one contract at a time through the socket channel `contract_mark_price`, see [`websocket.md`](./websocket.md) section 2.
Its REST calls are all on `bitkan.com/proxy/v2`, which refused this host, and no bundle names a bulk premium or funding call.

### Row mapping

For the record only, the socket frame would fill an `AnchorRow` like this.

| `AnchorRow` column | field on `contract_mark_price` | unit |
|---|---|---|
| key | `trade_pair` | `BINANCE-BTC-USDT` |
| `index` | `index_price` | decimal string |
| `mark` | `mark_price` | decimal string, rounded to the contract's price step |
| `fundingRate` | `rate` | decimal string fraction, equal to Binance's `lastFundingRate` |
| `fundingIntervalHours` | absent, `next_time` minus `prev_time` gives 8 on both contracts probed | |
| `nextFundingAt` | `next_time` | Unix ms |

## 4. Anchor semantics

Every anchor field is Binance's.
Over three runs of 30 s, `rate` equalled Binance's `lastFundingRate` and `next_time` equalled Binance's `nextFundingTime` on every frame, 121 of 121 over BTC and ETH.
Mark equalled the nearest Binance poll rounded to BitKan's decimals on 86 of 121 frames, and index on 91 of 121, and the misses fit a number that moved between a BitKan frame and a poll up to a second away, see [`websocket.md`](./websocket.md) section 4.
`prev_rate` equalled Binance's settled rate at 2026-09-23 00:00 UTC on both contracts, `0.00001021` for BTC and `0.00009373` for ETH.
So the index basket, the mark formula, its clamps and the funding cap are Binance USD-M's.
BitKan republishes the mark every 1.3 to 1.7 s median and at most 2.5 s apart, while Binance's REST premium index moves on a one second grid.
The published rate is Binance's `lastFundingRate`, which the engine's Binance poller already reads as the upcoming rate, at [`anchor.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/binance/anchor.ts) line 40.
No settlement instant was captured.

## 5. REST book snapshot

The website calls `/proxy/v2/contract/quote/depth?contract_id=<id>&depth=<n>`, S1.
It answered 403 challenge to this host, so depth limits, level order and caching are Not verified.

## 6. Rate limits and errors

Not publicly specified.
Every `bitkan.com` path answered 403 with a Cloudflare challenge page of 5.4 to 5.8 KB, and no `Retry-After` header.
`help.bitkan.com` answered 403 with Cloudflare error 1034, Edge IP Restricted.
CoinGecko, a third party, answered 429 on several tries during this survey because many researchers shared this host, and 200 on others.

## 7. Server time and clock offset

No time call is public.
The website socket's server ping carries a Unix ms timestamp, and it arrived here 95 and 98 ms after its own value in two runs, the same as the mark frames' `time`.
That lag is transit plus clock offset, and the two cannot be separated without a round trip call.

## 8. Recommended poller shape

None.
There is no public anchor call to poll, and the socket's anchor numbers are Binance's.
The engine already polls the same contracts through [`anchor.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/binance/anchor.ts).

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | website bundle `futures.symbols-BmA1Mca9.js` | https://cdn.bitkan.net/cdn/static/js/futures.symbols-BmA1Mca9.js | 2026-09-22 | BitKan | `/proxy/v2` catalog, depth, fees and open interest paths, sections 2, 3 and 5 |
| S2 | Wayback copy of the futures catalog, 2023-03-27 | https://web.archive.org/web/20230327090537/https://bitkan.com/proxy/v2/contract/symbol/contracts?exchange=binance&update_time=0&strategy_type=0 | 2026-09-22 | BitKan | 169 Binance USDT perpetuals, section 2 |
| S3 | CoinGecko derivatives API, `bitkan-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/bitkan-futures?include_tickers=unexpired | 2026-09-22 | BitKan | 726 perpetuals, 723 tickers, section 2 |
| S4 | Binance USD-M `exchangeInfo`, `premiumIndex`, `fundingRate` | https://fapi.binance.com/fapi/v1/exchangeInfo | 2026-09-22 | Binance | symbol match and anchor comparison, sections 2 and 4 |
| S5 | Binance COIN-M `exchangeInfo` | https://dapi.binance.com/dapi/v1/exchangeInfo | 2026-09-22 | Binance | no COIN-M match, section 2 |
| P1 | `rest-probe.mjs reach` at 03:18 and 03:30 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs) | 2026-09-22 | this host | section 1 and 6 |
| P2 | `rest-probe.mjs catalog`, `coingecko` and `tickers` at 03:19 to 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs) | 2026-09-22 | this host | section 2 |
| P3 | `ws-probe.mjs mark`, four runs from 03:14 to 03:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkan/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4 and 7 |
