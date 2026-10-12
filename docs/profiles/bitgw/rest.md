# BitGW Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:47 to 04:06 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers BitGW's public REST surface for its spot market, because BitGW lists no perpetuals, see [`fees.md`](./fees.md) section 3.
BitGW publishes no REST API.
Every call below is one the web app makes for an anonymous visitor, read from its bundle and replayed by [`rest-probe.py`](../../../scripts/probes/venues/bitgw/rest-probe.py).
The probe ran at 03:55 and 04:04 UTC, and where the runs differ both values are given, first run first.

The calls are form encoded POSTs to `https://bitgw.com/api/<controller>`, with a `type` field naming the action.
The app adds `language`, `platform`, `system_language`, `version`, `timestamp` and `url`, then a `sign`.
The `sign` is the md5 of the sorted `key=value` pairs, each lowercased with spaces and line breaks removed, joined with `&` and followed by `&key=` and a client key from the public bundle.
No username or token is sent, so these calls are the anonymous view every visitor's browser loads.
A wrong or missing `sign` gets `{"code":205,"message":"ERROR"}`.

## 1. Host and latency from this machine

| item | probed |
|---|---|
| `bitgw.com`, `www.bitgw.com`, `static.bitgw.com` | each resolved to the Cloudflare addresses 104.21.86.185 and 172.67.223.184, and two IPv6 addresses |
| `api.bitgw.com`, `bitgw.io` | no DNS record |
| TCP and TLS to `bitgw.com:443` | 5 and 12 ms for TCP, 9 ms for TLS, TLS 1.3 |
| catalog call, cold | 128 and 105 ms, 24,014 bytes |
| catalog call, warm | median 106 ms in both runs, 101 to 114 ms over 5 calls each |
| Cloudflare edge | `YVR` in every `CF-RAY` |
| website | `https://www.bitgw.com/` and `https://bitgw.com/` answered 200. `https://static.bitgw.com/` answered 403 from nginx at its root |

## 2. Catalog

### The catalog call

`home` with `type=marketInit` returns every listed pair.

| item | probed |
|---|---|
| pairs | 91 |
| quote assets | USDT on all 91 |
| pairs listed twice | none, and no base is listed twice |
| fields | `id`, `key`, `currency`, `currency_full`, `icon`, `sort`, `last`, `sodUtc0`, `high`, `low`, `volCcy24h`, `is_hot`, `star` |
| symbol | `key`, such as `BTC-USDT`, the same spelling as the socket's `instId` and OKX's |
| status | none in this reply. `marketDetail` carries `status: 1` on all 91 pairs, and `is_exchange: 1` on 35 and 0 on 56, a flag the bundle does not explain |
| pegged and wrapped bases | `USDC-USDT`, `USDG-USDT`, `PYUSD-USDT`, `PAXG-USDT`, `STETH-USDT`, `JITOSOL-USDT` and `LEO-USDT` |

`marketDetail` with an `id` adds `trade_limit`, the minimum size, `to_fixed`, the price decimals, and `is_self`, which was 0 on all 91 pairs.

### Prices against OKX

In each run the catalog `last` equalled OKX's spot `last` on 73 of 91 pairs, and was within 0.1 % on 3, then 4, more.
`CTSI-USDT`, `TFUEL-USDT`, `KAVA-USDT` and `STORJ-USDT` had no OKX spot pair.
In the second run `PAXG-USDT`, `ZEN-USDT`, `KNC-USDT`, `SHIB-USDT`, `PEPE-USDT`, `DASH-USDT`, `GALA-USDT`, `COMP-USDT` and `ZEC-USDT` differed from OKX by 1.67 % to 31.41 %, and the seven of them the first run printed had the same price then.
The rest differed by under 0.2 %, which is a move between the two reads.
These 13 stale or unmatched pairs are exactly the ones whose socket group sends no book, see [`websocket.md`](./websocket.md) section 4.
`sodUtc0` matched OKX's on 0, then 2, of the pairs, so the day's opening price BitGW shows is mostly not OKX's.

### How CCXT maps it

It does not.
CCXT 4.5.68 has no BitGW class, see [`fees.md`](./fees.md) section 8, so there is no `market.id`, `contractSize`, `linear` or `active` to check.
A catalog for the engine would have to be written by hand from `marketInit`.

## 3. Anchor

Not offered.
BitGW publishes no index, mark or funding rate.
The probe listed every field name in the `marketInit` and `marketDetail` replies, 39 names, and none names an index, mark, funding, settlement, premium or basis.
The only reference price is `last`, which for a live pair is OKX's last trade.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered, as section 3 says.
There is no index basket, no mark formula and no funding formula to record.

## 5. REST book snapshot

`home` with `type=marketDetail` and the pair's numeric `id` returns the book in `data.books`, beside 1,000 daily candles, the pair's details and the fee rate.

| item | probed |
|---|---|
| depth | 5 levels a side, with no depth parameter |
| level shape | `[price, size, "0", orders]`, strings, OKX's `books5` level |
| level order | asks ascending, bids descending |
| extra fields | `instId`, `ts` and `seqId`, OKX's |
| reply size and time | 156,613 to 166,929 bytes and 1.06 to 1.11 s for BTC, ETH and SOL, mostly candles |
| freshness | the book's `ts` was 2.0, 9.1 and 2.4 s older than OKX's REST book read right after it, then 6.0, 3.4 and 5.7 s |
| match with OKX | 7, 9 and 10 of the 10 BitGW levels had a price that was also a level in OKX's book of the moment, then 0, 8 and 6 as the market moved |

`home` with `type=k`, an `id`, `key` and `k_type` returns 1,000 candles and the last 50 trades.
In the first run all 50 BTC trade ids were in OKX's last 100 BTC-USDT trades, and in the busier second run 31 of 50 were, because OKX's last 100 covered a shorter span.
The newest trade had the same `tradeId`, price, size and side on both, with BitGW's `ts` rounded down to the second.
So both the book and the trade tape are OKX's, and BitGW shows no trade of its own.

## 6. Rate limits and errors

| item | probed |
|---|---|
| published limit | none |
| headers | `x-ratelimit-limit: 60` and `x-ratelimit-remaining`, with no reset header. Over 20 calls one counter fell by one per call from 46 to 31 while two calls showed 59 and 58, so more than one backend counts separately, and the window is unknown |
| 20 catalog calls at 2 a second | 20 answered 200 with `code` 200 |
| `Retry-After` | not seen, no limit was reached |
| wrong or missing `sign` | HTTP 200, `{"code":205,"message":"ERROR"}` |
| unknown `type` | HTTP 200, `{"code":203,"message":"Type Error","data":[]}` |
| unknown market `id` | HTTP 500 with an HTML "Server Error" page |
| unknown controller | HTTP 404 with the web app's HTML |
| GET on a controller | HTTP 405, `Allow: POST` |
| session expiry, for logged in calls | `code` 204, which the app treats as a logout, read from the bundle and not probed |

## 7. Server time and clock offset

There is no time call.
The `Date` header was 0.03 to 0.86 s behind the local clock over six reads in two runs, within its one second resolution.

## 8. Recommended poller shape

None.
There is no anchor to poll, BitGW has no perpetuals, and its book and prices are OKX's spot data.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.bitgw.com/assets/index-B2YCeHws.js`, the request wrapper `ajax`, the signer `sign`, and `globalData.host` | 2026-10-09 |
| S2 | the k page chunk `pages-k-k.CNLv_m6W.js`, the `marketInit`, `marketDetail` and `k` calls and the fee formula | 2026-10-09 |
| S3 | OKX public REST `https://www.okx.com/api/v5/market/books`, `trades` and `tickers?instType=SPOT`, used only for comparison | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/bitgw/rest-probe.py) | 2026-10-09 |
| P2 | [`fees-probe.py`](../../../scripts/probes/venues/bitgw/fees-probe.py), `is_self`, `status` and `service` on 91 pairs | 2026-10-09 |
