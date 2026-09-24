# bitcastle REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:22 to 04:50 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API of bitcastle for its USDT-M perpetuals.
The public API reference S1 documents only spot market calls, and every futures call below is one the web app makes without a login, found in its bundle S3 and answered without a key.
Every number carries a probe run of [`rest-probe.mjs`](../../../scripts/probes/venues/bitcastle/rest-probe.mjs) or a source from section 9.

## 1. Host and latency from this machine

| host | addresses on 2026-09-23 | note |
|---|---|---|
| `api.bitcastle.io` | `47.130.47.124`, `52.74.160.114`, `18.138.32.119` | the web app's `API_URL`, S2, and the host every call below uses |
| `socket.bitcastle.io` | the same three | MQTT over WebSocket, see [`websocket.md`](./websocket.md) |
| `developer.bitcastle.io` | `18.141.115.59`, `13.228.130.52`, `47.130.190.173` | the documentation, and the spot calls answer here too |
| `bitcastle.io` | `47.130.218.39`, `52.220.130.192`, `52.76.26.105` | web app |

The three API addresses fall in prefixes AWS publishes for ap-southeast-1, Singapore, in its `ip-ranges.json` of 2026-09-22.

| measure | value |
|---|---|
| cold request, `GET /futures/v1/settings/symbols` | 731 and 698 ms in two runs |
| warm, 9 more requests 500 ms apart | 222 to 437 ms, median 226 and 227 ms |
| response headers | `x-powered-by: Express` and `date`, no rate limit, cache or CDN header |
| refusals | none: every public call answered from the Canadian VPN exit, status codes in section 6 |

`developer.bitcastle.io` answers the futures calls with 401 `{"statusCode":62001,"msg":"APIKEY.NOTFOUND"}`, while `api.bitcastle.io` serves them without a key.

## 2. Catalog

### The instruments call

`GET https://api.bitcastle.io/futures/v1/settings/pair` returned 119 rows and 122,958 bytes in 914 and 912 ms.

| item | value |
|---|---|
| settlement assets | `usdt` on all 119 |
| status field | none, and `GET /futures/v1/settings/symbols` lists the same 119 `pair_name` values |
| key | `pair_name`, spelled `btc/usdt`, and `coin` plus `currency` |
| source venue | `target`: `bybit` on 109, `mexc` on 7 (`fet`, `hot`, `ray`, `floki`, `turbo`, `cheems`, `pi`), `binance` on 3 (`usdc`, `layer`, `spcx`) |
| price precision | `ob_default_price_scale` from 1 to 10 decimals, and `ob_list_price_scale` holds that one value on every row |
| size | `trading_amount_scale`, `trading_min_amount` and `trading_max_amount` in the base coin, `0.0001` to `5` on `btc/usdt` |
| funding fields | `funding_rate` `"0"`, `funding_interval` `"8"`, `funding_start_time` in ms |
| fee fields | see [`fees.md`](./fees.md) section 2 |

The web app's pair model also names `ob_external_limit_orders`, `ob_external_min_amount`, `ob_external_max_amount`, `mark_price_threshold_adjustment`, `mark_price_random_oscillation` and `mark_price_avg_time`, S3, and the public reply carries none of them.

### How CCXT 4.5.68 maps it

It does not, since CCXT has no bitcastle class, see [`fees.md`](./fees.md) section 8.
The engine builds its catalog from `loadMarkets` of a CCXT class at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68, so the venue has no catalog without new code.

| engine field | what bitcastle offers |
|---|---|
| `rawMarketId` | `btc/usdt`, which is also the MQTT `symbol` and the funding history `symbol`. The book topic and the REST book take `coin` and `currency` apart |
| `base`, `quote` | `coin` and `currency` upper cased |
| `linear` | true for all, USDT settled |
| `contractSize` | none, sizes are in the base coin, so 1 |
| `active` | no field, every listed row is live |
| pair listed twice | never, one row per coin |

### Symbols that name a different token

The survey did not check each base against other venues' tokens.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /futures/v1/ticker/24h` | absent | `mark_price` on 119 of 119 rows | absent | absent | absent | 30,405 and 30,445 bytes | 1,201 and 1,419 ms single, then 449 to 2,306 ms, median 624 and 581 ms, over 55 and 56 polls |
| `GET /futures/v1/settings/pair` | absent | absent | `funding_rate`, `"0"` on all rows | `funding_interval`, hours | derivable from `funding_start_time` | 122,958 bytes | 912 and 914 ms |
| `GET /futures/v1/funding-rate/history?page=1&limit=200` | absent | `mark_price` at settlement | `funding_rate` of the last settlement | `funding_interval` | `calculation_time` of the last one | 60,814 and 60,829 bytes | 292 and 270 ms |
| MQTT `public/futures/markprice_update` | absent | `mark_price`, 127 symbols | absent | absent | absent | 5.8 KB per frame | one frame per 5 s |

`GET /futures/v1/ticker` answered with `"data":[]` and carries nothing.
No call and no topic publishes an index price, S3 has no `index_price` field anywhere, and so `AnchorRow.index` has no source.

### Row mapping

| `AnchorRow` column | field | conversion |
|---|---|---|
| key | `coin` and `currency` of `ticker/24h`, joined as `btc/usdt` | none |
| `index` | none | none published |
| `mark` | `ticker/24h` `mark_price`, a decimal string | `Number()` |
| `fundingRate` | `funding_rate` of the pair's newest `funding-rate/history` row, a fraction | `Number()`, and it is the last settled rate, not the upcoming one |
| `fundingIntervalHours` | `settings/pair` `funding_interval`, `"8"` | `Number()` |
| `nextFundingAt` | `funding_start_time + (floor((now - funding_start_time) / interval) + 1) * interval`, as the web app's countdown computes it, S3 | ms already |

On 2026-09-23 at 04:28 UTC that rule gave 08:00 UTC for `btc/usdt`, whose `funding_start_time` is 2023-09-29 00:00 UTC.

## 4. Anchor semantics

### Index

None is published.
The help center says "Index Price: Based on prices from the spot (underlying) market", S5, but no call returns one.

### Mark

The documentation says the mark is "calculated using a combination of: Price data from multiple spot exchanges, Market data such as funding-related data", S6.
The wire shows the source venue's mark, sampled every 5 s.

| test | result |
|---|---|
| MQTT mark frames against Bybit's `tickers` stream, `btc/usdt` and `eth/usdt`, 14 frames each, two runs | 28 of 28 and 28 of 28 values had appeared on Bybit's stream before the bitcastle frame arrived, 1,058 to 3,829 ms before at a median of 3,051 ms, and 1,080 to 5,680 ms before at a median of 2,887 ms. Only 4 and 5 of 28 still equalled Bybit's current mark |
| `ticker/24h` once a second for 60 s beside Bybit's REST tickers, two runs | `btc/usdt` mark changed 12 and 11 times in 55 and 56 polls, `eth/usdt` 11 and 11 times, 5 polls per value at the median. 46 of 55, then 51 and 53 of 56, bitcastle marks equalled a Bybit mark from 0 to 5 polls earlier, median 1 or 2 |
| one read of `btc/usdt`, run 1 | bitcastle mark `87121.51`, Bybit mark `87099.20` and index `87136.97` at the same second, 256 ppm apart |
| one read of `btc/usdt`, run 2 | bitcastle mark `87119.9`, Bybit mark `87119.90`, equal |
| one read of `pi/usdt`, run 2 | bitcastle mark `0.09136`, MEXC `fairPrice` `0.09136` and `indexPrice` `0.09133`, equal to the fair price |
| one read of `layer/usdt`, run 2 | bitcastle mark `0.07955951`, Binance `markPrice` `0.07956000` and `indexPrice` `0.07951510`, 6 ppm apart |

So a bitcastle mark is a copy of its source venue's mark, and on Bybit pairs it was 1.1 to 5.7 s old when it arrived.
The `mark_price_random_oscillation` field name in S3 suggests a configured perturbation, which is an inference, and every one of the 56 socket values compared had appeared on Bybit's stream.

### Funding

| item | value |
|---|---|
| documented | "Currently, bitcastle operates with a 0% funding fee.", S4, and "Funding rates calculation consists of the interest rate and the premium.", S7 |
| catalog | `funding_rate` `"0"` on all 119 rows |
| history | nonzero on every settlement: `btc/usdt` at `0.0001` on all of its last 50, and the newest settlement of every pair at `0.01` on 88, `0.0001` on 29, `-0.00001` on 1 and `-0.01` on 1 |
| upcoming or settled | the history holds settled rates only, and no call publishes an upcoming one |
| against the source | Bybit's BTCUSDT rate read `0.00003714` and `0.00004901` in the two runs, so the rate is bitcastle's own |
| interval and instants | 8 h, at 00:00, 08:00 and 16:00 UTC for 54 pairs and one hour later for 65 |
| MQTT `public/futures/funding_rate` | no frame in 70 s |

The settlement instant was not captured, and these rows come from the history call and the documentation, see [`fees.md`](./fees.md) section 6.

### How often each number changed

| number | changes over about a minute |
|---|---|
| `mark_price`, REST, one poll per second | 12 and 11 changes in 55 and 56 polls on BTC, 11 and 11 on ETH |
| `mark_price`, MQTT | one frame every 4,808 to 5,212 ms |
| last price in `ticker/24h` | 12 and 9 changes in 55 and 56 polls on BTC, 10 and 9 on ETH, following one trade per 5 s |
| funding | once per 8 h |
| index | none |

The poller stamps each reading on arrival, so a mark that is already up to 5.7 s old when it arrives would read as fresh.
That is the slow republish the design asks a researcher to flag.
The move guard at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 6 reads the index or the mark, whichever moved more, so here it would see only a mark that jumps once per 5 s.
A mark of 0 refuses the route at open, at [`types.ts`](../../../server/src/engine/cluster/types.ts) line 34, which is what an unknown coin's ticker row would give.

## 5. REST book snapshot

`GET /futures/v1/orderbook?coin=btc&currency=usdt&precision=0.1` answered 200 in 223 to 362 ms over two runs.

| item | value |
|---|---|
| depth | up to 100 levels per side, `take` of 5, 20 or 500 changed nothing |
| precision | a missing or unlisted `precision` falls back to the default, and the reply's `precision` then reads `1` as a number |
| extra fields | `current_price`, the last trade, and `last_update` |
| caching | four reads 250 ms apart gave four server timestamps 480 to 523 ms apart and a moving best ask, in both runs |
| level order | as on the socket, see [`websocket.md`](./websocket.md) section 4 |

Each book was read at the same moment as its source venue's book, once in each run.

| pair and run | bitcastle best bid and ask | source best bid and ask | bitcastle levels priced on the source book | of those, same size |
|---|---|---|---|---|
| `btc/usdt`, Bybit, run 1 | 87087.4, 87118.0 | 87087.5, 87087.6 | 98 of 106 | 70 |
| `btc/usdt`, Bybit, run 2 | 87119.9, 87120.0 | 87119.9, 87120.0 | 140 of 145 | 128 |
| `eth/usdt`, Bybit, run 1 | 2783.7, 2784.64 | 2783.7, 2783.71 | 174 of 175 | 121 |
| `eth/usdt`, Bybit, run 2 | 2780.86, 2781.00 | 2780.99, 2781.00 | 190 of 200 | 116 |
| `pi/usdt`, MEXC, run 1 | 0.0913, 0.0915 | 0.09137, 0.0914 | 74 of 157, with 38 and 21 repeated prices | 29 |
| `pi/usdt`, MEXC, run 2 | 0.0914, 0.0915 | 0.09141, 0.09142 | 79 of 161, with 31 and 32 repeated prices | 26 |
| `layer/usdt`, Binance, run 1 | 0.0796, 0.0797 | 0.07964, 0.07967 | 186 of 200, with 87 and 85 repeated prices | 23 |
| `layer/usdt`, Binance, run 2 | 0.0795, 0.0796 | 0.07956, 0.07958 | 177 of 200, with 84 and 86 repeated prices | 22 |

In run 1 the `btc/usdt` book showed 31 asks, the nearest 30.4 USD above Bybit's best ask, and a spread of 351 ppm where Bybit's was about 1 ppm.
In run 2 its touch equalled Bybit's.
The MEXC and Binance pairs are cut to four decimals, so their touch can never equal the source's five decimal touch.

## 6. Rate limits and errors

The only published limit is for API keys: "50 calls per 10 seconds for user account" and "100 calls per 10 seconds for enterprise account", S1.
No public limit, no rate limit header and no `Retry-After` was seen.
The probe made 44 calls to bitcastle in 32 s in each `main` run, and at most about 4 in any one second.

| request | status | body |
|---|---|---|
| unknown path `GET /futures/v1/nope` | 404 | `{"status_code":404,"message":"Cannot GET /nope","timestamp":"2026-09-23T04:28:45.982Z","path":"/nope"}` |
| private `GET /futures/v1/position` without a key | 401 | `{"status_code":401,"message":"Unauthorized",…}` |
| spot `GET /exchange/orderbook/v1/orderbook` without parameters | 400 | `{"statusCode":400,"message":["coin must be a string",…]}` |
| futures book, unknown coin | 200 | an empty book and `"current_price":"0"` |
| futures ticker, unknown coin | 200 | one row of zeros, `"mark_price":"0"` |
| funding history, unknown symbol | 200 | `"data":[]` |
| futures call on `developer.bitcastle.io` | 401 | `{"statusCode":62001,"msg":"APIKEY.NOTFOUND"}` |

The replies wrap data in an object with the keys `timestamp`, `msg`, `data` and `status_code`, and the funding history puts the text `"get runding rate histories success!"` in `timestamp`.

## 7. Server time and clock offset

No time call is published.
The body `timestamp`, in ms, read -2 to 6 ms from the midpoint of the local request over 10 calls in two runs, and the `Date` header, with 1 s resolution, read within 500 ms.
So this host's clock and bitcastle's agree to a few ms, and the median 111 to 120 ms age of socket frames is transit.

## 8. Recommended poller shape

None is recommended, because the venue should not join, see [`fees.md`](./fees.md) section 9.
The table records what a poller would have to be, for a later design that decides otherwise.

| item | value | reason |
|---|---|---|
| URL | `https://api.bitcastle.io/futures/v1/ticker/24h` for the mark | the only bulk call with a mark |
| second call | `funding-rate/history?page=1&limit=200` every few minutes for the last settled rate | 200 rows covered the newest settlement of all 119 pairs |
| interval | 5,000 ms | the mark changes every 5 s, and the reply took up to 2,306 ms |
| index | none, so the row would carry the mark in both columns or a 0, and either misleads the reader | |
| skip | every `target` other than the pair a design chooses | the book and the mark are the source venue's |
| rate limit pause | 10,000 ms | the only published window is 10 s |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | bitcastle API docs 1.0.0 | https://developer.bitcastle.io/document | 2026-09-22 | bitcastle | spot calls, API key limits, error example shapes |
| S2 | web app runtime config | https://bitcastle.io/config.json | 2026-09-22 | bitcastle | `API_URL`, `API_SERVICE` paths |
| S3 | web app bundle `app.d64a015.js` | https://bitcastle.io/_nuxt/app.d64a015.js | 2026-09-22 | bitcastle | futures call paths, pair model field names, the funding countdown rule, no `index_price` field |
| S4 | USDT-M Futures Contract Specifications | https://support.bitcastle.io/hc/en-us/articles/20504150629785-USDT-M-Futures-Contract-Specifications | 2026-09-22 | bitcastle | 0 % funding statement |
| S5 | About Mark Price | https://support.bitcastle.io/hc/en-us/articles/20504036901529-About-Mark-Price | 2026-09-22 | bitcastle | index described |
| S6 | Difference Between Mark Price and Last Price | https://support.bitcastle.io/hc/en-us/articles/20503745284505-Difference-Between-Mark-Price-and-Last-Price | 2026-09-22 | bitcastle | mark described |
| S7 | Definition of Futures technical terms | https://support.bitcastle.io/hc/en-us/articles/20503714500121-Definition-of-Futures-technical-terms | 2026-09-22 | bitcastle | funding formula described |
| S8 | AWS IP address ranges | https://ip-ranges.amazonaws.com/ip-ranges.json | 2026-09-23 | AWS | host region |
| P1 | `rest-probe.mjs main` at 04:28 and 04:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitcastle/rest-probe.mjs) | 2026-09-23 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs poll` at 04:29 and 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitcastle/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P3 | `ws-probe.mjs book` at 04:25 and 04:45 UTC, the mark comparison | [`ws-probe.mjs`](../../../scripts/probes/venues/bitcastle/ws-probe.mjs) | 2026-09-23 | this host | section 4 |
