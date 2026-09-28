# BitradeX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 between 06:41 and 06:58 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which Cloudflare placed at loc=CA, colo=YVR.

This profile covers the public futures REST API of BitradeX for its USDT-margined perpetuals.
BitradeX publishes no API documentation, and CCXT has no class for it, see [`fees.md`](./fees.md) section 8.
Every path below is one the www.bitradex.ai web app calls, read from its `_app` bundle, S1, and every number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) unless a source says otherwise.
These are web app endpoints, not a published API, so they can change without notice.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `https://www.bitradex.ai`, paths under `/v1/future-u/market/public/` |
| old host | `www.bitradex.com` answers 301 to `https://www.bitradex.ai/` |
| DNS | `www.bitradex.ai`, `api.bitradex.ai`, `fws.bitradex.ai` and `sws.bitradex.ai` all resolve to Cloudflare 104.18.14.240 and 104.18.15.240, plus `2606:4700::6812:ef0` and `2606:4700::6812:ff0` |
| exit seen by Cloudflare | loc=CA, colo=YVR, over IPv6, P1 |
| cold request, fresh connection, `/time` | median 139 ms, max 177 ms over 10, P2 |
| warm request, kept alive | median 110 ms, p90 126 ms, max 138 ms over 20, P2 |

Access, all from the Canadian VPN exit, P1:

| request | status | body |
|---|---|---|
| any www.bitradex.ai URL with user agent `curl/8.14.1` | 456 | `xxx`, `content-type: text/plain`, `server: cloudflare` |
| the same URLs from Node's `fetch`, or with any other user agent tried (`node`, `Mozilla/5.0`, empty) | 200 | the JSON or the page |
| `https://api.bitradex.ai/` and `https://api.bitradex.com/v1/future-u/market/public/q/tickers` | 401 | `401` |

The 456 is a filter on the curl user agent, not a geographic refusal, because the same exit got 200 with every other agent.
No geographic refusal was seen on any public endpoint.

## 2. Catalog

### The instruments call

`GET /v1/future-u/market/public/symbol/list` returned 72 perpetuals in 93,690 bytes and 533 ms, P3.
`/v1/future-u/market/v2/public/symbol/list` returns the same list inside `{time, version, symbols}` and an empty `symbols` when the `version` query matches the current one.

| field | values on 2026-09-24 |
|---|---|
| `contractType` | `PERPETUAL` on 72 |
| `underlyingType` | `U_BASED` on 72 |
| `quoteCoin` | `usdt` on 71, `sol` on 1 (`xaut_sol`) |
| `state` | 0 on 72 |
| `tradeSwitch` | true on 56, false on 16 |
| `isDisplay` | true on 56, false on 16 |
| `openSwitch` | true on 57, false on 15 |
| `isOpenApi` | true on 4: `btc_usdt`, `xrp_usdt`, `bnb_usdt`, `trb_usdt` |

`tradeSwitch` is the field that separates the 56 live contracts, which matches the 56 derivative pairs CoinMarketCap lists.
The 16 switched off are `luce_usdt`, `1000sats_usdt`, `ton_usdt`, `ai16z_usdt`, `vine_usdt`, `raysol_usdt`, `usual_usdt`, `arc_usdt`, `avaai_usdt`, `strk_usdt`, `xag_usdt`, `xaut_sol`, `xaut_usdt`, `cl_usdt`, `spcx_usdt` and `samsung_usdt`.
The Wayback Machine capture of the same call on 2026-09-14 held the same 72, 56 and 4, P9.

### How it maps to the engine

There is no CCXT class, so a catalog adapter has to read this call directly.

| engine field | BitradeX field | note |
|---|---|---|
| `rawMarketId` | `symbol`, for example `btc_usdt` | identical to socket `data.s` and to `s` in `q/agg-tickers` |
| `base`, `quote` | `baseCoin`, `quoteCoin`, lower case | |
| `linear` | always, `U_BASED` | |
| `contractSize` | `contractSize`, a string, 0.0001 on `btc_usdt`, 0.01 on `eth_usdt`, 10000 on `turbo_usdt` | book sizes are contracts, see [`websocket.md`](./websocket.md) section 4 |
| active | `tradeSwitch` true | |

No base is listed twice among the 56 trading contracts.
`1000shib_usdt` quotes 1,000 SHIB per price unit by its name, and its `contractSize` of 100 is in those units, which the engine's price scale would need, Not verified against a spot price.
Six trading contracts are tokenised non-crypto assets: `nvda_usdt`, `mu_usdt`, `skhynix_usdt`, `sndk_usdt`, `xau_usdt` and `paxg_usdt`.

## 3. Anchor

### The bulk calls

| call | returns | size and time |
|---|---|---|
| `GET /v1/future-u/market/public/q/agg-tickers` | every symbol: `s`, `t`, last `c`, `i` index, `m` mark, `bp` and `ap` best prices, 24 h fields | 65 rows, median 12,204 bytes, median 119 ms, p90 148 ms, max 385 ms over 60 polls, P4 |
| `GET /v1/future-u/market/public/q/index-price` | every symbol `{s, p, t}` | 3,406 bytes, 115 ms, P1 |
| `GET /v1/future-u/market/public/q/mark-price` | every symbol `{s, p, t}` | 3,416 bytes, 115 ms, P1 |
| `GET /v1/future-u/market/public/q/funding-rate?symbol=<id>` | one symbol: `fundingRate` a number, `nextCollectionTime` ms, `collectionInternal` hours | 168 bytes, median 113 to 116 ms, P5 |

Funding has no bulk call: `q/funding-rate` without `symbol` answers `invalid_symbol`, P6.
So index and mark come in one request, and funding needs one request per contract, 56 in all.

### Row mapping

| `AnchorRow` column | field |
|---|---|
| `index` | `Number(i)` from `q/agg-tickers` |
| `mark` | `Number(m)` from `q/agg-tickers` |
| `fundingRate` | `fundingRate` from `q/funding-rate`, already a fraction |
| `fundingIntervalHours` | `collectionInternal` |
| `nextFundingAt` | `nextCollectionTime` |

`q/agg-tickers` returns 65 rows: the 56 trading contracts and 9 switched-off ones whose `t` was 98 to 492 days old in a check at 07:00 UTC.
So rows are keyed by the tracked ids and the rest ignored.

## 4. Anchor semantics

### Index

No formula and no basket call are published.
The index differed from Binance USDT-M `indexPrice` by a median of 578 ppm in absolute value over 62 common symbols, and by -18 ppm on `btc_usdt`, P7.
So it is not Binance's index, and its basket is unknown.

### Mark

No formula and no clamp are published.
Mark minus index had a median absolute of 516 ppm over 65 rows on the last poll of P4.
The largest were `vine_usdt` at -14,772 ppm, which is switched off, and the trading `cookie_usdt` at 8,696 ppm and `dydx_usdt` at -7,692 ppm.
The mark differed from Binance's `markPrice` by a median absolute of 295 ppm, P7.
`symbol/list` carries `multiplierUp` and `multiplierDown` 0.5 and `marketTakeBound` 0.03 on `btc_usdt`, which look like order price bands and not mark clamps, Not verified.

### Funding

The rate moves between reads: `cookie_usdt` read 0.007119 and 0.007166 about 3 minutes apart, P5.
So the published rate is the predicted rate for the next settlement.
31 of 56 contracts sat at exactly 0.0001, and the range was 0.007166 to -0.006461.
No cap or floor is published.
The interval is 8 h on 55 contracts and 4 h on `trump_usdt`, and every contract, including the 4 h one, showed the next settlement at 2026-09-24 08:00 UTC.
`q/funding-rate-record?symbol=btc_usdt` lists the settled rates at 00:00, 08:00 and 16:00 UTC, each 0.0001 with `collectionInternal` 28800 seconds, a different unit from the hours of `q/funding-rate`.
The settlement instant itself was not captured.

### How often each number changed

Over 60 polls at 1 s of `q/agg-tickers`, P4:

| number | changes per symbol per minute |
|---|---:|
| index `i` | 7.9 |
| mark `m` | 10.3 |

That is one change every 6 to 8 s on average across all 65 rows, with the switched-off rows never changing.
The socket's `mark_price@btc_usdt` and `index_price@btc_usdt` pushed 22 frames each in 20 s, see [`websocket.md`](./websocket.md) section 2.

### Best prices against Binance

On the one read of P7, `bp` and `ap` equalled Binance USDT-M `bookTicker` exactly on `btc_usdt`, `eth_usdt` and `sol_usdt`, and the median absolute gap over 62 common symbols was 98 ppm on the bid and 203 ppm on the ask.
See [`websocket.md`](./websocket.md) section 4 for what that suggests about the book.

## 5. REST book snapshot

`GET /v1/future-u/market/public/q/depth?symbol=<id>&level=<n>`, P6 and P8.

| `level` | bids and asks returned | bytes |
|---|---|---|
| 5 | 5 and 5 | 325 |
| 20 | 20 and 20 | 907 |
| 50 | 50 and 50 | 2,062 |
| 1000 | 284 and 284 on `btc_usdt` | 11,042 |
| missing | error `invalid_level` | |

Bids descend and asks ascend at every level.
Prices and sizes are strings, and `u` is a JSON number that equals the socket's `u` at the same moment.
Two reads 115 ms apart on `eth_usdt` returned the same `u` with different `t`, which fits a quiet book, and no cache header was examined.

## 6. Rate limits and errors

No public rate limit is published.
The terms say "any repeated violation of the order rate limit will result in BitradeX suspending or closing the User's account", S2.
No 429 or other refusal was seen at the probe's pace of about two requests a second.

Errors come back as HTTP 200 with `code` 1, P6:

```json
{"code": 1, "msg": "failure", "msgInfo": {"code": "invalid_symbol", "template": "invalid symbol", "args": []}, "data": null, "ts": 1790232777059}
```

An unknown path under `/v1/future-u/market/public/` answers `msgInfo.code` `E000` "Internal Service Error", still with HTTP 200.

## 7. Server time and clock offset

`GET /v1/future-u/market/public/time` returns `{"code":0,"msg":"success","msgInfo":null,"data":<ms>,"ts":<ms>}`.
Five reads gave an offset of 3 to 4 ms at a 110 to 114 ms round trip, and 31 ms on a first read at 178 ms, P6.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| index and mark | `q/agg-tickers` once a second | one bulk call, median 119 ms, 12 KB |
| funding | `q/funding-rate?symbol=<id>` for every tracked contract, one call every 1 to 2 s in rotation, so each is refreshed every one to two minutes | no bulk call, and the rate drifts slowly |
| row mapping | section 3 | |
| skip | rows whose `s` is not a tracked `tradeSwitch` contract | switched-off rows can be a year old |
| user agent | any agent other than `curl/<version>` | the site answers curl with 456 |
| errors | treat `code !== 0` as a failed poll | HTTP status stays 200 |

A funding rate that is one to two minutes old is fresh enough for a rate that settles every 8 h, but the engine's reader expects one bulk reply per poll, so this split needs a named change in the poller.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | www.bitradex.ai `_app` bundle | `https://static3.bitradex.mobi/web/web/_next/static/chunks/pages/_app-759ef86c4e08dba3.js` | 2026-09-24 | BitradeX | every path in this profile |
| S2 | Crypto Trading Terms of Service | https://www.bitradex.ai/en/user/terms_of_service | 2026-09-24 | BitradeX | API rate clause |
| P1 | `rest-probe.mjs access` at 06:47 UTC, and curl with four user agents at 06:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | section 1, section 3 sizes |
| P2 | `rest-probe.mjs latency` at 06:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | section 1 |
| P3 | `rest-probe.mjs catalog` at 06:53 and 06:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | section 2 |
| P4 | `rest-probe.mjs anchor` at 06:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | sections 3 and 4 |
| P5 | `rest-probe.mjs funding`, two runs at 06:55 and 06:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | sections 3 and 4 |
| P6 | one-off reads of candidate paths, errors and `/time` at 06:52 UTC, the same calls `rest-probe.mjs book` and `clock` make | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | sections 3, 5, 6, 7 |
| P7 | `rest-probe.mjs mirror` at 06:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | section 4 |
| P8 | `rest-probe.mjs book` at 06:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | this host | section 5 |
| P9 | `rest-probe.mjs archive`, Wayback captures of 2026-09-14 and 2026-09-16 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitradex/rest-probe.mjs) | 2026-09-24 | web.archive.org | section 2 |
