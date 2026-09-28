# Koinbay REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures REST API of Koinbay (no CCXT class): catalog, anchor, book snapshot, limits and time.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/koinbay/rest-probe.mjs) unless a source is named.
Access results are from the Canadian VPN exit.

## 1. Host and latency from this machine

| host | resolves to | probed |
|---|---|---|
| `futuresopenapi.koinbay.com` (futures REST, S1) | CNAME `cloong-alb-internet-h5-v6-1615804683.ap-northeast-1.elb.amazonaws.com`, 3.115.212.56 and 13.196.131.139 | every call 200 |
| `openapi.koinbay.com` (spot REST, S1) | the same load balancer | `/sapi/v1/symbols` 200, 84,118 bytes, 234 symbols |
| `futuresws.koinbay.com`, `ws.koinbay.com` | the same load balancer | see [`websocket.md`](./websocket.md) |
| `www.koinbay.com` | Vercel, 216.150.1.193 and 216.150.16.193 | 200, redirects to `/en-US` |

The API sits in AWS Tokyo (`ap-northeast-1` in the load balancer name).
`/fapi/v1/ping` took 817 ms cold and 255 to 310 ms warm on a kept-alive connection, probe `catalog`.
A fresh curl per request took 696 to 818 ms in total, with a TCP connect of 256 ms.
The replies carry `server: webserver` and `x-envoy-upstream-service-time`, and no rate limit header.
No endpoint refused this host.

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.koinbay.com/fapi/v1/contracts` returns every contract in one array, no parameters (S1).
On 2026-09-22 it answered 200 with 88,721 bytes and 177 contracts in 1,626 ms, of which the envoy upstream time was 906 ms.

| `type` | `marginCoin` | `side` | `status` 1 | `status` 0 |
|---|---|---|---|---|
| `E` | `USDT` | 1 | 127 | 47 |
| `E` | `BTC` | 0 | 1 (`E-BTC-USD`) | 0 |
| `S` | `EXUSD` | 1 | 1 (`S-BTC-USDT`) | 0 |
| `FILCOIN` | `FILCOIN` | 1 | 1 (`FILCOIN-BTC-USDT`) | 0 |

`status` 1 reads as trading, and the 47 with `status` 0 include delisted names such as `E-ZIL-USDT`, `E-FTM-USDT` and `E-TON-USDT`.
`side` 1 reads as linear and `side` 0 as inverse, since the only `side` 0 contract is margined in BTC with a multiplier of 10 USD.
Neither enum is documented.

Fields per contract: `symbol`, `pricePrecision`, `side`, `maxMarketVolume`, `multiplier`, `maxLever`, `minOrderVolume`, `maxMarketMoney`, `marginCoin`, `openMakerFee`, `type`, `closeMakerFee`, `closeTakerFee`, `maxLimitVolume`, `maxValidOrder`, `multiplierCoin`, `openTakerFee`, `minOrderMoney`, `maxLimitMoney`, `contractId`, `minLever`, `status`.
There is no tick size field, only `pricePrecision` in decimals.

### Liveness

The undocumented `GET /fapi/v1/ticker_all` returns every contract's 24 h ticker in one object keyed by socket name (`e_btcusdt`), 19,919 bytes in 298 ms, fields `high`, `vol`, `last`, `low`, `rose`, `time`.
35 of the 130 active contracts had a last trade more than seven days old, among them `E-BSV-USDT` (2022-05-23), `E-PENDLE-USDT` (2024-08-26) and `E-MATIC-USDT` (2024-09-05).
`FILCOIN-BTC-USDT` last traded on 2021-10-29 and its mark read 60,377 against an index of 84,114.
So about a quarter of the listed book is ghost markets, and the adapter must filter them.

### How CCXT maps it

CCXT 4.5.68 has no Koinbay class, and neither has the CCXT `master` branch on 2026-09-22, see [`fees.md`](./fees.md) section 8.
A Koinbay adapter would build the catalog from this call itself:

- `rawMarketId`: the REST name is `E-BTC-USDT`, the socket name is `e_btcusdt` and the mark frame's `symbol` is `e_btcusdt` (S2).
  The REST depth call also accepted the lowercase `e-btc-usdt` but refused `e_btcusdt` with `BAD_SYMBOL`.
- `base` is `multiplierCoin` and the quote is `marginCoin` for the linear family.
- `contractSize` is `multiplier`, and book sizes are integer contracts, section 5.
- `linear` follows `side` 1.
- `active` follows `status` 1, plus the liveness filter above.

### Size unit, pairs listed twice, and price scale

Multipliers range from 0.00001 to 5,000 coins per contract across the active set, for example 0.0001 on BTC, 0.1 on SOL and SSV.
BTC is the only base listed more than once among active contracts: `E-BTC-USDT`, `S-BTC-USDT` and `FILCOIN-BTC-USDT`, plus the inverse `E-BTC-USD`.
Only `E-BTC-USDT` should be kept.
Names like `E-SHIB-USDT` quote the plain coin with a large multiplier, so no price scale was needed in the names inspected, but a per name check against another venue is Not verified.

## 3. Anchor

### The bulk calls

None exists.
`GET /fapi/v1/index?contractName=E-BTC-USDT` returns one contract (S1):

```json
{"currentFundRate": 0.0000379900000000, "tagPrice": 84167.7, "indexPrice": 84200.18666666666199250, "nextFundRate": 0.000074}
```

Without `contractName`, `/fapi/v1/index` and `/fapi/v1/ticker` answer `{"code":"-1121","msg":"BAD_SYMBOL","data":null}`.
Guessed bulk paths `index_all`, `indexes` and `fundingRate` answer `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}`, the body every unknown path gets.
`ticker_all` is bulk but carries no index, mark or funding.

Polling one contract at a time took p50 273 ms, p90 352 ms and max 911 ms over 180 calls, probe `anchor`.
Covering 95 live contracts that way would take about 26 s per round on one connection, or tens of calls a second in parallel with no published limit.

The socket channel `mark_price_<symbol>` carries the same four numbers plus `nextSettlementTime` at about one frame a second, and it comes along with every depth subscription, see [`websocket.md`](./websocket.md) section 2.
That is the only practical anchor source.

### Row mapping

| `AnchorRow` column | REST `/fapi/v1/index` | socket `mark_price_<symbol>` |
|---|---|---|
| `index` | `indexPrice`, number | `indexPrice`, string |
| `mark` | `tagPrice`, number | `tagPrice`, string |
| `fundingRate` | `currentFundRate` or `nextFundRate`, which one is upcoming is Not verified | same, strings |
| `fundingIntervalHours` | absent | absent, 8 is plausible from `nextSettlementTime` at 08:00 UTC but Not verified |
| `nextFundingAt` | absent | `nextSettlementTime`, ms as a string, 1790236800000 |

## 4. Anchor semantics

### Index

No formula or basket is published.
The BTC index read `84200.18666666666199250`, a repeating sixth decimal that suggests a mean of three sources, and it was within 1 USD of Binance's `indexPrice` 84199.69 read about 20 s later.
The inactive `E-ZIL-USDT` index read 0.00365 against a mark of 0.01225, so a delisted contract keeps a detached mark.
No basket call is public.

### Mark

`tagPrice` is the mark (S2 calls the channel "Futures mark price").
No formula or clamp is published.
At the end of probe `anchor`, BTC `tagPrice` 84132.67 sat 2.47 above the best ask 84130.2 of the ticker read just before it, and about 430 ppm below the index 84168.80.
In two curls about 20 s apart, Binance's BTCUSDT mark read 84167.24 against Koinbay's `tagPrice` 84167.7.
A capped premium is Not verified.

### Funding

`currentFundRate` changed twice in 60 polls on BTC and ETH, with values like 0.0000379900 and 0.0000475366666667, while `nextFundRate` stayed at 0.000074 and 0.000083.
On SSV, SOL and the inverse both fields read 0.0001.
The docs do not say which field is the rate charged at `nextSettlementTime`.
No cap, floor or formula is published, and no public funding history call exists.
The settlement instant was not captured.

### How often each number changed

Over 60 one second polls of `/fapi/v1/index`, probe `anchor`:

| contract | `indexPrice` changes | `tagPrice` changes | `currentFundRate` | `nextFundRate` |
|---|---|---|---|---|
| `E-BTC-USDT` | 34 | 59 | 2 | 0 |
| `E-ETH-USDT` | 23 | 35 | 2 | 0 |
| `E-SSV-USDT` | 0 | 13 | 0 | 0 |

The SSV index held 3.093 for the whole minute while its mark moved 13 times, so a small contract's index can sit still for at least 60 s.

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=100` (S1).
The docs give a maximum `limit` of 100, and `limit=200` returned 100 levels per side on BTC, SOL and SSV, probe `book`.
Asks ascend and bids descend on every reply.
Sizes are integer contracts: the BTC top ask of 9,126 contracts is 0.9126 BTC at a multiplier of 0.0001.
`time` is always `null`.
Two reads 508 ms apart returned different bodies, so no cache of that length was seen.
Replies took 256 to 414 ms.

## 6. Rate limits and errors

- No public rate limit is published.
  The error table lists `-1003 TOO_MANY_REQUESTS` "Requests too frequent; rate limit exceeded" (S3).
  The probes stayed at about 3 requests a second and never saw it, so its HTTP status and any `Retry-After` are Not verified.
- Errors come back with HTTP 200 and a JSON body, never a 4xx, in every case probed:

| request | body |
|---|---|
| unknown contract `E-NOPE-USDT`, socket-style `e_btcusdt`, missing `contractName` | `{"code":"-1121","msg":"BAD_SYMBOL","data":null}` |
| unknown path, or a signed path without a key | `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}` |
| delisted `E-ZIL-USDT` ticker | a normal reply with `buy` 0, `sell` 0 and a `time` of 1755505565000 |

- The docs name three envelopes, including a Spring style `{"timestamp","status","error","message","path"}` for paths that do not exist (S4), which was not seen from this host.

## 7. Server time and clock offset

`GET /fapi/v1/time` returns `{"timezone":"GMT+08:00","serverTime":1790232200595}`.
Five reads put the server 72 to 129 ms ahead of the midpoint of the local request, with round trips of 256 to 409 ms, so the offset is within the round trip error.

## 8. Recommended poller shape

A REST poller does not fit, because no call returns the anchor for all contracts at once.
The recommendation is to read the anchor from the socket instead:

- Take `mark_price_<symbol>` frames from the book sockets, one per subscribed contract at about 1 Hz.
- Map `indexPrice` to `index`, `tagPrice` to `mark`, `nextSettlementTime` to `nextFundingAt`, and parse the strings as numbers.
- Leave `fundingRate` and `fundingIntervalHours` unset or conservative until the meaning of `currentFundRate` against `nextFundRate` and the interval are settled by a capture across a settlement.
- If a REST poller is still wanted, `/fapi/v1/index` per contract at about 300 ms per call can serve a handful of contracts, not the whole catalog.
- Skip contracts with `status` 0, the three odd BTC contracts of section 2, and ghost contracts whose `ticker_all` time is older than a day.

## 9. Source ledger

- S1: Futures REST API, https://docs.koinbay.com/api/futures-rest-api.md, sections "Contracts", "Depth (order book)", "24hr ticker", "Index / tag price", "Server time".
- S2: WebSocket (market streams), https://docs.koinbay.com/api/websocket-market-streams.md.
- S3: Error codes and enums, https://docs.koinbay.com/api/error-codes-and-enums.md.
- S4: API overview, https://docs.koinbay.com/api/overview.md.
- S5: [`rest-probe.mjs`](../../../scripts/probes/venues/koinbay/rest-probe.mjs), modes `catalog`, `anchor`, `book`, `errors`, run 2026-09-22, plus curl calls the same day for the hosts, `ticker_all`, `/sapi/v1/symbols`, the index of the three odd contracts and Binance's `premiumIndex` for BTCUSDT.
