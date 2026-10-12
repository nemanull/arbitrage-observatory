# OneBullEx REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, which was 2026-10-10 from about 02:20 to 03:10 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

This profile covers the public V2 futures Open API of OneBullEx, documented at `https://doc.onebullex.com/`, S1, that a catalog, an anchor poller and a book resync would use.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/onebullex/rest-probe.py), P1, or [`anchor-probe.py`](../../../scripts/probes/venues/onebullex/anchor-probe.py), P2.
Public paths start with `/v2/public/`, need no key, and every one probed answered from the Canadian exit.

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-09 |
|---|---|---|
| `futures-openapi.onebullex.com` | production REST base, S1 section 1.2 | `172.66.41.21` and `172.66.42.235`, plus two IPv6 records, Cloudflare |
| `futures-openapi.1bullex.com` | test REST base, S1 | not probed |

Every reply came through Cloudflare, with `server: cloudflare`.
The first `GET /v2/public/time` of the process took 576 ms and 236 ms in two runs, and the next five took a median 223 ms and 189 ms, P1.

| call | reply bytes | time from this host |
|---|---:|---|
| `GET /v2/public/symbol/list` | 168,602 | 231 to 303 ms |
| `GET /v2/public/q/agg-tickers?timeRangeType=H24` | about 45,800 | median 193 ms over 60 polls, max 1,201 ms, P2 |
| `GET /v2/public/q/mark-price` | about 11,720 | 184 to 535 ms |
| `GET /v2/public/q/index-price` | about 11,720 | 150 to 460 ms |
| `GET /v2/public/q/funding-rate?symbol=btc_usdt` | about 120 | median 179 ms, P2 |
| `GET /v2/public/q/funding-rate-record?symbol=<s>` | about 1,000 | 3.3 to 24.6 s over all runs, and one read in an earlier P2 run ran past its 30 s timeout |
| `GET /v2/public/q/depth?symbol=btc_usdt&level=50` | about 1,915 | 147 to 148 ms |

## 2. Catalog

- The call is `GET /v2/public/symbol/list`, which returns every contract with no parameter, S1 section 4.2.
- It returned 154 rows on 2026-10-09, all `contractType` PERPETUAL, `underlyingType` U_BASED, `quoteCoin` usdt, `state` 0 and `tradeSwitch` true, P1.
  S1 does not list the values of `state`.
- The active perpetual count by settlement asset is USDT 154, USDC 0 and coin-margined 0.
- No symbol appears twice, P1.
- The symbol is lower case with an underscore, `btc_usdt`, and it is the same string in the socket topics, the bulk replies and the book call, P1 and [`websocket.md`](./websocket.md) section 3.
- `contractSize` is the coin amount per contract and varies, P1.
  It is 1 on 46 contracts, 0.01 and 10 on 31 each, 0.1 on 21, 0.001 on 11, 100 on 8, 0.0001 on 3, 1000 on 2 and 10000 on 1.
  `btc_usdt` has 0.0001, `quantityPrecision` 0 and `minQty` 1, so sizes are whole contracts.
- Plate 8 of the catalog's `plateList` holds 25 stock, index and metal contracts, such as `nvda_usdt`, `qqq_usdt`, `xau_usdt` and `samsung_usdt`, P1.
  The pair names `cl_usdt` and `intc_usdt` sit outside plate 8 and are likely more of the same, see section 3.
- `GET /v2/public/symbol/all` returns 238 names, 84 more than the list, P1.
  The extra names are not in the list and are most likely delisted, since the bulk calls carry 83 stale rows outside the list, see section 3.
- There is no CCXT class, see [`fees.md`](./fees.md) section 8, so a catalog loader would read this call directly.
  The Rust server already loads Gate's catalog natively in `server/src/venues/gate/markets.rs`, so that is not new work in kind.

## 3. Anchor

| `AnchorRow` field | call | field | coverage |
|---|---|---|---|
| index | `GET /v2/public/q/agg-tickers?timeRangeType=H24` | `i` | every contract in one call |
| mark | the same call | `m` | every contract in one call |
| funding rate | `GET /v2/public/q/funding-rate?symbol=<s>` | `fundingRate` | one contract per call, 151 of 154 answered with a number |
| funding interval | `GET /v2/public/q/funding-rate-record?symbol=<s>` | `collectionInterval`, seconds | one contract per call, seconds each |
| next settlement | `GET /v2/public/q/funding-rate?symbol=<s>` | `nextCollectionTime`, ms | one contract per call |

- `agg-tickers` and `agg-ticker` need `timeRangeType`, S1, and `agg-ticker` without it answered `{"code":-1,"msg":"invalid param"}`, P1.
- `agg-tickers`, `mark-price` and `index-price` each return 237 rows, the 154 listed contracts plus 83 delisted ones, P1.
  The delisted rows' timestamps were 377 to 2,610 hours old in `agg-tickers` over two runs, with frozen prices, so a poller must filter on the catalog.
- `GET /v2/public/q/funding-rate` with no symbol answers `{"code":-1,"msg":"invalid param","bizCode":"10164"}`, P1, so there is no bulk funding call.
- A full sweep of the 154 contracts, one call at a time with a 0.45 s pause, took 102 to 105 s over three sweeps, P2.
- Three contracts, `cl_usdt`, `spy_usdt` and `intc_usdt`, return `fundingRate` null and `nextCollectionTime` null, P2.

## 4. Anchor semantics

- **Index.**
  No formula or basket is published, and no basket call exists, S1.
- **Mark.**
  No formula or clamp is published.
  The help center describes the mark as a "fair price" for risk control and gives no formula, S2.
  Over 60 one second polls, mark equalled index on 6,725 of 9,240 contract rows, P2.
  It differed on every poll of `btc_usdt` and `eth_usdt`, and equalled the index on every poll of `sol_usdt` and `doge_usdt`.
- **Funding formula and cap.**
  Not published, S1 and [`fees.md`](./fees.md) section 6.
  The last sweep's rates ran from -0.0995 % to +0.0997 % per interval, P2.
- **Upcoming or settled.**
  The published rate is the upcoming one.
  The current `fundingRate` differed from the last settled record on 5 of 6 sampled contracts in the first run and 6 of 6 in the second, P1.
- **Interval.**
  The help center says every 8 hours, see [`fees.md`](./fees.md) section 6.
  Each sweep found `nextCollectionTime` at 08:00 UTC on 76 contracts, 04:00 UTC on 74 and 03:00 UTC on 1, read between about 02:40 and 03:05 UTC, P2.
  The history call is the only one that reports the interval, as `collectionInterval`, and P2 reads one sample per group.
  `btc_usdt` in the 08:00 group had 28800, `hype_usdt` in the 04:00 group had 14400, and `kaia_usdt`, the one 03:00 contract, had 3600, P2.
  So 8, 4 and 1 hour intervals all run at once.
- **How often numbers change.**
  Over 60 polls about a second apart, the median contract showed 5.5 distinct marks and 5.5 distinct indexes, P2.
  `btc_usdt` showed 10 distinct marks and 10 distinct indexes, and its funding rate stayed at one value.
  12 contracts showed one mark for the whole minute.
- The settlement instant was not captured.

## 5. REST book snapshot

- The call is `GET /v2/public/q/depth?symbol=<s>&level=<n>`, S1, where the doc says `level` runs 1 to 50.
- The probe got 1, 5, 50, 51 and 100 levels a side for `level` 1, 5, 50, 51 and 100, so the documented cap is not enforced, P1.
  `level=1000` returned 239 bids and 231 asks, about the depth of the socket's `depth_full`.
  `level=0` answered `invalid param`.
- Bids descend and asks ascend, best first, P1.
- The reply carries `u`, an update id of the same magnitude as the socket's `depth_full` and `depth_update` ids, and `t` in ms.
  Three reads about 0.7 to 1 s apart each returned a new `u`, and no reply carried a cache header, in both runs, P1.
- Sizes are contracts, as on the socket.

## 6. Rate limits and errors

- No public limit is published.
  The FAQ says limits are per API key and IP and to contact customer service, S1 section 8.3.
- The `/v2/public/time` reply carried no rate limit header, P1.
  The website socket's upgrade carries `X-RateLimit-Replenish-Rate: 5` and `X-RateLimit-Burst-Capacity: 20`, see [`websocket.md`](./websocket.md) section 3.
- No limit was hit at about two requests a second.
- Errors come back with HTTP 200 and a non-zero `code`, P1.

| request | reply |
|---|---|
| unknown symbol on depth, funding or symbol detail | `{"code":-1,"msg":"invalid symbol","data":null,"bizCode":"10002"}` |
| missing or bad parameter | `{"code":-1,"msg":"invalid param","data":null,"bizCode":"10164"}` |
| upper case `BTC_USDT` on agg-ticker | `{"code":0,"msg":"success","data":null}`, a silent empty success |
| unknown public path, or a private path with no key | `{"msg":"sign-error","code":1}` |

## 7. Server time

`GET /v2/public/time` returns `data` in ms, as the doc says, P1.
The doc's own example shows a value in seconds, `1711900000`, S1 section 4.1, which the wire does not follow.
The median offset of server time against this host's clock was -224 ms and -219 ms over five reads in each of two runs, P1.

## 8. Recommended poller shape

The venue is blocked as a leg, because funding is read one contract at a time and the only public book socket is undocumented, see [`websocket.md`](./websocket.md) section 8.
If both were accepted, the poller below follows from the probe.

| item | recommendation | reason |
|---|---|---|
| index and mark | `GET /v2/public/q/agg-tickers?timeRangeType=H24` every 5 s | one call, about 46 KB, median 193 ms |
| funding rate and next settlement | `GET /v2/public/q/funding-rate?symbol=<s>`, round robin over the catalog at about 2 calls a second | no bulk call exists, and a full round took 102 to 105 s |
| funding interval | the history call once per contract at startup and after each settlement, or the gap between `nextCollectionTime` values | the current call has no interval, and the history call takes seconds |
| row filter | keep only rows whose symbol is in `symbol/list` | 83 delisted rows ride along with frozen prices |
| skip | rows with null `fundingRate` | 3 stock or commodity contracts |
| errors | treat a non-zero `code` as a failure even on HTTP 200 | every error shape is a 200 |

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | OneBullEx Open API Documentation, version 2.1.1 dated 2026-04-20, `https://doc.onebullex.com/onebullex-openapi-en-v2.md`, sections 1, 2, 4 and 8 | 2026-10-09 |
| S2 | "What is Mark Price? What is the latest price?", `https://support.onebullex.com/hc/en-us/articles/5033297488414`, updated 2026-03-27, read through the Zendesk API | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/onebullex/rest-probe.py) | 2026-10-09 |
| P2 | [`anchor-probe.py`](../../../scripts/probes/venues/onebullex/anchor-probe.py), modes `poll` and `sweep` | 2026-10-09 |
