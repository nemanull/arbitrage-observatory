# MGBX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time, which is 02:24 to 03:10 UTC on 2026-10-10, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py), run from the repository root with `uv run`, unless a row names the frozen [`rest-probe.mjs`](../../../scripts/probes/venues/mgbx/rest-probe.mjs) of 2026-09-23 and 2026-09-24 UTC.

This profile covers the public REST market data of MGBX Global for its only perpetual family, the USDT-margined perpetuals.
MGBX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every path below is one the futures web app at www.mgbx.com called when the first run read its JavaScript bundle on 2026-09-22 and 2026-09-23, see [`websocket.md`](./websocket.md) section 9.
None of it is a published interface, so any of it can change without notice.
The User Agreement forbids automated data collection without MGBX's written consent, see [`fees.md`](./fees.md) section 1.
The web app is a moving target: the bundle chunk the first run read answered HTTP 404 on 2026-10-09, and the home page carried the build id `ssr-web-home-20261005-071729-71329295`.
Every path below still answered on 2026-10-10 UTC.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| base | `https://www.mgbx.com/futures/fapi/market/v1/public/` | P1 |
| resolved address | 15.197.214.70 and 15.197.93.79, the same two as on 2026-09-23 | P1 |
| access from the Canadian exit | HTTP 200 on every market data call, no geoblock and no challenge page | P1 to P7 |
| cold request, fresh TCP and TLS | 8 of 10 answered in the first run and 7 of 10 in the second pass, at a median of 678 to 698 ms and a maximum of 735 ms, of which TCP and TLS took a median of 508 to 519 ms | P1 |
| cold request, hung | 2 and 3 of 10 got no answer within 5 s | P1 |
| warm request, one kept-alive connection | 20 of 20 answered in each run, at a median of 159 to 183 ms and a maximum of 270 ms | P1 |

Fresh TLS handshakes to www.mgbx.com stall often from this exit.
2 and 3 of 10 cold requests hung in the two runs of P1.
In the first run a 500-level book read failed three tries in a row and an upper-case symbol read five, each try on a fresh connection, P4 and P6.
One kept-alive connection avoided almost all of it: the 60 anchor rounds of P3 needed one connection and lost no request in either run, and the second funding sweep of 274 calls needed one connection, P5.
A poller has to hold its connection open and reconnect with a short timeout.

## 2. Catalog

### The instruments call

`GET symbol/list` returns every contract in one reply of 291,319 bytes in 1,325 to 1,340 ms, P2.

| field | meaning | example on `btc_usdt` |
|---|---|---|
| `symbol` | the contract id, lower case `<base>_usdt` | `btc_usdt` |
| `contractType` | `PERPETUAL` on all 274 rows | |
| `underlyingType` | `U_BASED` on all 274 rows | |
| `targetType` | 1 for crypto on 167 rows, 2 for stocks, ETFs, metals and energy on 107 rows | 1 |
| `state` | 0 on all 274 rows | 0 |
| `tradeSwitch` | true on all 274 rows | true |
| `contractSize` | base units per contract, a string | `"0.0001"` |
| `baseCoin`, `quoteCoin` | lower case | `btc`, `usdt` |
| `pricePrecision`, `minStepPrice` | price decimals and tick | 1, `"0.1"` |
| `quantityPrecision`, `minQty` | size in whole contracts | 0, `"1"` |
| `makerFee`, `takerFee` | per contract fee rate, see [`fees.md`](./fees.md) section 4 | `"0.0003"`, `"0.0005"` |
| `onboardDate` | listing time in ms | 1651528801000 |

The active perpetual count is 274 USDT-M contracts on 2026-10-10 UTC, against 267 on 2026-09-23.
No other settlement asset exists, see [`fees.md`](./fees.md) section 3.
No status value other than `state` 0 and `tradeSwitch` true appears, so the meaning of the others is Not publicly specified.

### How it maps to the engine

MGBX has no CCXT class, so a catalog needs a native markets module like Gate's [`gate/markets.rs`](../../../server/src/venues/gate/markets.rs), which reads the venue's contract list and builds each market.

| engine field | MGBX source | probed |
|---|---|---|
| `rawMarketId` | `symbol` | identical to the socket's `data.s` and the anchor's `s`, lower case, P2 and [`websocket.md`](./websocket.md) section 3 |
| base and quote | `baseCoin` and `quoteCoin`, upper cased | `btc`, `usdt` |
| linear | every row is `U_BASED` with `quoteCoin` `usdt` | P2 |
| active | `state` 0 and `tradeSwitch` true | all 274 rows |
| `contractSize` | `contractSize` | 17 distinct values from `0.0001` to `1000000`, for example 58 contracts at `0.001`, 55 at `1` and 52 at `10` |

The socket and REST book sizes are whole contracts of this `contractSize`, see [`websocket.md`](./websocket.md) section 4.

### Pairs listed twice, scaled names and odd ids

No base is listed twice, P2.
Four contracts carry a scaled base: `1000cheems_usdt`, `1000cat_usdt`, `1000pepe_usdt` and `1000bonk_usdt`, which would need a price scale against a venue that lists the unscaled token.
Three contract ids are Chinese words, `龙虾_usdt`, `牛来_usdt` and `哈基米_usdt`, so a client must percent-encode the symbol in a query string, P2 and P5.
`q/agg-tickers` returns 275 rows, one more than the catalog: `burger_usdt`, a contract that is no longer listed, P2.
A poller must therefore filter the bulk rows by the catalog.

## 3. Anchor

### The bulk calls

| call | rows | reply size | warm time over 60 polls | fields |
|---|---:|---:|---|---|
| `GET q/agg-tickers` | 275 | 52,475 to 52,477 bytes | median 182.5 to 200.5 ms, max 1,066 ms | `s`, `i` index, `m` mark, `c` last, `bp`, `ap`, `o`, `h`, `l`, `a`, `v`, `r`, `t` |
| `GET q/mark-price` | 275 | 13,567 to 13,572 bytes | median 175 to 183 ms, max 237 ms | `s`, `p`, `t` |
| `GET q/index-price` | 275 | 13,570 bytes | median 175 to 183 ms, max 336 ms | `s`, `p`, `t` |
| `GET q/funding-rate?symbol=<s>` | 1 | about 236 bytes | median 160 to 170 ms per call | `symbol`, `fundingRate`, `fundingRateUpperLimit`, `fundingRateLowerLimit`, `lastFundingRate`, `collectionInterval`, `nextCollectionTime` |

Times are from P3 and P5, over the first run and the second pass.
Index and mark for every contract come in one call, `q/agg-tickers`.
Funding comes only one contract at a time.
`q/funding-rate` without a symbol answers `{"code":-1,"msg":"invalid symbol","data":null}`, and the guessed bulk paths `q/funding-rates`, `q/funding-rate/list` and `q/premium-index` answer HTTP 404, P5.
The web app's bundle named no bulk funding call when the first run read it.
A sweep of all 274 contracts at 4 calls a second took 113 s in the second pass, and all 274 answered, P5.
The first sweep got 270, because that version of the probe did not percent-encode the three Chinese ids and one call stalled.

### Row mapping

| `AnchorRow` column | MGBX field |
|---|---|
| index | `i` of `q/agg-tickers`, a string |
| mark | `m` of `q/agg-tickers`, a string |
| funding rate | `fundingRate` of `q/funding-rate`, per contract |
| funding interval in hours | `collectionInterval` of `q/funding-rate`, 8, 4 or 2 |
| next settlement in ms | `nextCollectionTime` of `q/funding-rate` |
| timestamp | `t` of `q/agg-tickers`, in ms |

The columns are those of `AnchorRow` at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 27.

## 4. Anchor semantics

### Index

The index formula and basket are Not publicly specified, and no basket call is known.
The index equals the mark on almost every row.
On 16,494 of 16,500 `q/agg-tickers` rows over 60 polls `i` equalled `m`, and on 16,500 of 16,500 in the second pass, P3.
The separate bulk index and mark calls, read about 0.2 s apart, agreed on 15,788 and 16,278 of 16,500 rows.
The socket shows the same thing, see [`websocket.md`](./websocket.md) section 6.
So MGBX publishes one number twice, and the engine cannot use the gap between its index and its mark.

### Mark

The mark formula and any clamp are Not publicly specified.
S13 of [`fees.md`](./fees.md) names a price protection threshold between mark and last price without a number.
Against Binance USDT-M on the 264 common contracts, MGBX's mark was a median 30.5 to 134.5 ppm and a p90 of 490 to 712 ppm from Binance's mark, and a median 520 to 646.5 ppm from Binance's index, in one read each per run, P7.

### Funding

The formula is Not publicly specified, and the cap is per contract, see [`fees.md`](./fees.md) section 6.
`fundingRate` is the running rate for the next settlement and `lastFundingRate` the last settled one, an inference from the names.
They were equal on 166 of 274 contracts at 02:58 UTC, P5.
`q/funding-rate-record?symbol=<s>` returns the last ten settlements with `hasNext` true, each with `id`, `collectionInterval`, `markPrice`, `symbol`, `fundingRate` and `createdTime`, P5.
The `btc_usdt` and `eth_usdt` records are 8 h apart and the `xau_usdt` records 4 h apart, and the newest of all three is 2026-10-10 00:00 UTC.
The settlement instant itself was not captured.

### How often each number changed

Over 60 polls one second apart, first run and second pass, P3:

| contract | index changes | mark changes | last price changes |
|---|---:|---:|---:|
| median contract | 4 | 4 | 10 to 11 |
| p90 contract | 20 to 21 | 19 to 21 | 21 to 22 |
| `btc_usdt` | 24 to 27 | 24 to 27 | 41 to 42 |
| `eth_usdt` | 24 to 25 | 24 to 25 | 41 to 42 |
| `xau_usdt` | 11 | 11 | 13 to 18 |
| `aapl_usdt` | 0 to 2 | 0 to 2 | 11 to 15 |

The socket pushes index and mark every 500 ms, see [`websocket.md`](./websocket.md) section 2, so the REST mark is no fresher than the socket.

## 5. REST book snapshot

`GET q/depth?symbol=<s>&level=<n>` returns `t`, `s`, `u`, `b` and `a`, P4.

| item | value |
|---|---|
| depth | `level` 1, 5, 10, 20, 50, 100 and 200 each returned exactly that many levels per side. `level` 500 and 1000 returned 262 to 354 bids and 295 to 443 asks, which looks like the whole book. `level` 7 returned 7 levels per side |
| missing `level` | `{"code":-1,"msg":"invalid level","data":null}` with HTTP 200 |
| level order | bids descending and asks ascending on 4 of 4 contracts read in each run |
| numbers | prices and sizes are strings, with no scientific notation in 400 sizes per run |
| size unit | whole contracts of `contractSize`, for example `btc_usdt` bid `"51637"` at `contractSize` `0.0001`, which is 5.1637 BTC |
| `u` | a JSON integer above 2^53, for example 679046046734614594, so a parser must read it as a 64-bit integer and not as a double |
| `u` meaning | the id of the last book change, whose top 42 bits plus 1,629,702,000,000 give its time in ms, see [`websocket.md`](./websocket.md) section 4 |
| freshness | `t` was 76 to 95 ms old on arrival |
| caching | no `cache-control`, `age` or `x-cache` header |

The REST book with `u` equal to a socket snapshot's `id` held the same 40 top levels as that snapshot on 2 of 2 matches in P1 of [`websocket.md`](./websocket.md), and on 4 of 4 contracts in the frozen run of 2026-09-24.

## 6. Rate limits and errors

No rate limit is published, and none was met.
Every reply carries `x-ratelimit-remaining: 9999`, `x-ratelimit-burst-capacity: 10000`, `x-ratelimit-replenish-rate: 10000` and `x-ratelimit-requested-tokens: 1`, P6.
The window those numbers apply to is Not publicly specified, and no `Retry-After` header was seen.

| request | status | body |
|---|---|---|
| unknown symbol, `q/depth` | 200 | `{"code":-1,"msg":"invalid symbol","data":null}` |
| unknown symbol, `q/mark-price` and `q/funding-rate` | 200 | the same |
| missing `level`, `q/depth` | 200 | `{"code":-1,"msg":"invalid level","data":null}` |
| unknown path `q/nope` | 404 | `{"timestamp":"...","status":404,"error":"Not Found","path":"/v1/public/q/nope"}` |
| upper case `BTC_USDT`, `q/mark-price` | 200 | `{"code":-1,"msg":"invalid symbol","data":null}` in the second pass, after five stalled tries in the first run |

Errors arrive with HTTP 200 and `code` -1, so a client has to check `code` and not only the status.

## 7. Server time and clock offset

`GET time` returns `{"code":0,"msg":"success","data":<ms>}`.
Read over one kept-alive connection with a round trip of 157 to 192 ms, MGBX's time sat between −1 and +10 ms of the host clock's midpoint over both runs, P6.
Binance's `serverTime` sat 15 to 21 ms ahead of the host clock in the same runs.
The `Date` header has whole seconds only, so it cannot bound the offset more tightly than a second.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
It applies only if MGBX grants consent for automated access, see [`fees.md`](./fees.md) section 1.

| item | recommendation | reason |
|---|---|---|
| connection | one kept-alive HTTPS connection, a 5 s timeout and a reconnect | fresh handshakes stall, section 1 |
| index and mark | `GET q/agg-tickers` every second, filtered to the catalog | one call covers all 275 rows in about 200 ms |
| funding | `GET q/funding-rate?symbol=<s>` round robin at 4 calls a second, one full round about every 70 s | no bulk funding call exists |
| interval and next settlement | `collectionInterval` and `nextCollectionTime` from the same call | per contract, 8, 4 or 2 h |
| `code` check | treat `code` other than 0 as a failed row | errors arrive with HTTP 200 |
| skip | `burger_usdt` and any other row missing from `symbol/list` | the bulk call lists one unlisted contract |
| percent-encode | the symbol in every query string | three ids are Chinese words |

The engine's anchor poller asks each venue for one full round at a time, as Gate does at [`gate/anchor.rs`](../../../server/src/venues/gate/anchor.rs) line 19.
MGBX cannot fill funding for all 274 contracts in one round, so its adapter would have to cache the last funding read per contract and merge it into each one-second round of index and mark.
That is the named change the anchor would need, on top of the consent question.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| P1 | `rest-probe.py latency` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:24 UTC and the second pass | this host | section 1 |
| P2 | `rest-probe.py catalog` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:24 UTC and the second pass | this host | section 2 |
| P3 | `rest-probe.py anchor` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:49 UTC and the second pass | this host | sections 1, 3 and 4 |
| P4 | `rest-probe.py book` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:25 UTC and the second pass | this host | sections 1 and 5 |
| P5 | `rest-probe.py funding` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:47 UTC and the second pass | this host | sections 2 to 4 |
| P6 | `rest-probe.py errors` and `clock` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:27 UTC and the second pass | this host | sections 1, 6 and 7 |
| P7 | `rest-probe.py mirror` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:27 UTC and the second pass | this host | section 4 |
| P0 | `rest-probe.mjs` all modes, the first run and its second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/mgbx/rest-probe.mjs) | 2026-09-23 06:42 UTC to 2026-09-24 07:04 UTC | this host | the 2026-09-23 contract count and the 2026-09-24 REST and socket match, sections 2 and 5 |
