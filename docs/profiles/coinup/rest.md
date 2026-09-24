# CoinUp.io REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:03 to 04:22 UTC on 2026-09-23, a first pass at 04:14 and a second at 04:21, from the development host near Seattle through a Surfshark WireGuard exit that Cloudflare places in Canada.

This profile records what CoinUp.io's public REST hosts answer this machine, and what can be said about its catalog and anchor without them.
Every CoinUp page and API call answered HTTP 403 with a Cloudflare challenge, so no catalog, anchor, book or clock reply was read from the venue.
No CoinUp documentation page was readable either, so the paths tried are the ChainUp open API shape that CCXT's `bitrue` class uses, at `server/node_modules/ccxt/js/src/bitrue.js` lines 153 and 225 to 233, and that [`../bittime/rest.md`](../bittime/rest.md) found live on another venue built the same way.
That CoinUp runs this shape is an inference from its contract ids, `E-BTC-USDT` in CoinGecko's trade links, S1, and from its `futuresopenapi` host name.

## 1. Host and latency from this machine

All access results in this file are from the Canadian VPN exit named above.
Cloudflare's trace at `https://futuresopenapi.coinup.io/cdn-cgi/trace` answered 200 with `loc=CA` and `warp=off`, and `colo=SEA` in the first pass and `colo=YVR` in the second, P1.

| host | resolved address | what it answered |
|---|---|---|
| `futuresopenapi.coinup.io` | 104.26.14.107, 104.26.15.107, 172.67.73.217 | 403 challenge on `/fapi/v1/ping`, `/time`, `/contracts`, `/depth`, `/ticker`, `/index` |
| `openapi.coinup.io` | same three | 403 challenge on `/sapi/v1/ping`, `/time`, `/symbols` |
| `api.coinup.io`, `capi.coinup.io` | same three | 403 challenge on `/` |
| `futures.coinup.io`, `www.coinup.io` | same three | 403 challenge on the trade page, `/en_US/cms/apidoc`, `/en_US/cms/agreement` and `/en_US/cms/fee` |
| `doc.coinup.io` | same three | 403 challenge |
| `helpcenter.coinup.io`, `static.coinup.io`, `download.coinup.io`, `rank.coinup.io`, `otc.coinup.io` | same three | 403 challenge on `/` |
| `notice.coinup.io` | CNAME `helpcenter-coinup.zendesk.com`, 216.198.53.6 and 216.198.54.6 | 403 challenge on `/hc/en-us`, while the Zendesk API on `helpcenter-coinup.zendesk.com` answered 200 |
| `fapi.coinup.io` | `ENOTFOUND` | |

Every refusal had the same shape: status 403, `server: cloudflare`, `cf-mitigated: challenge`, `content-type: text/html; charset=UTF-8`, a body of 5,404 to 5,671 bytes titled "Just a moment...", and no `Retry-After`, P1.
A `cf-ray` ending in `SEA` or `YVR` shows the Seattle and Vancouver edges both answered.
The first pass took 36 to 130 ms per refusal over 17 URLs, and the second 38 to 172 ms over 22 URLs, 13 host names, P1.
Five repeats of `/fapi/v1/time` one second apart took 23 to 54 ms, and 19 to 69 ms in the second pass.
That is the time to Cloudflare's edge, not to CoinUp's origin, which was never reached.
One manual curl with the user agent `Mozilla/5.0` on `www.coinup.io` got the same 403, and no attempt was made to solve the challenge.
The certificate transparency log lists 12 host names and 2 wildcards under `coinup.io`, S5, and this table and [`websocket.md`](./websocket.md) cover every one except the apex, `walletgateway` and `rank-cms`.

## 2. Catalog

No catalog call was readable.
`GET https://futuresopenapi.coinup.io/fapi/v1/contracts` answered 403 challenge, P1.
CCXT 4.5.68 has no CoinUp class, and CCXT master on 2026-09-22 has none either, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to map, and the engine's catalog path, `loadMarkets` at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68, has nothing to load.

What CoinGecko shows instead, P2.

| item | value |
|---|---|
| perpetual pairs in the summary | 98 |
| tickers returned | 97, all `contract_type` `perpetual`, all target USDT |
| id shape in `trade_url` | `E-<BASE>-USDT` on 97 of 97, for example `E-AAVE-USDT` |
| pairs the venue delisted on 2026-09-20 still listed | 38 of the 97, see [`fees.md`](./fees.md) section 7 |
| remaining | 59 |
| remaining with open interest reported as 0 | 8 |
| `E-BTC-USDT` | last 86,666 and index 86,708.94 at 04:14 UTC, 86,771.3 and 86,811.86 at 04:21 UTC, open interest reported as 0 |

The 2024 contract guide gives a face value per contract, so sizes on this venue are in contracts: `BTC` 0.001, `ETH` 0.01, `SOL` 0.1, `DOGE` 1, S2.
Whether the book reports contracts or coins today is Not verified.

## 3. Anchor

No anchor call was readable.

| call tried | result |
|---|---|
| `GET https://futuresopenapi.coinup.io/fapi/v1/index?contractName=E-BTC-USDT` | 403 challenge, P1 |
| `GET https://futuresopenapi.coinup.io/fapi/v1/ticker?contractName=E-BTC-USDT` | 403 challenge, P1 |
| `GET https://futuresopenapi.coinup.io/fapi/v1/contracts` | 403 challenge, P1 |

On the other ChainUp venue probed in this survey the index call answers one contract per request and carries index, mark and funding rate, see [`../bittime/rest.md`](../bittime/rest.md) section 3.
If CoinUp matches, a bulk anchor would not exist in the documented API even with access.
CoinGecko's derivatives reply carries an `index` and a `funding_rate` per perpetual, P2, but no mark, interval or next settlement, and it is a third party aggregate, so it is not an anchor.

## 4. Anchor semantics

The only formula text is the archived 2024 contract guide, whose index page still lists FTX, so every row below may be out of date.

### Index

The index is "based on the latest transaction price of the standard currency pair of the mainstream exchange", sampled "every 1 second", S3.
The 2024 table weights FTX, Huobi and Binance for USDT contracts, and FTX, Coinbase and Bitfinex for USD contracts, S3.
A source that has not updated in 40,000 ms and differs from its last value is set to weight 0.
A source more than 3 % from the median of all sources is clamped to the median ±3 %, and ±0.3 % for the USDT price, S3.
No basket call is known.

### Mark

`mark = median(latest price, reasonable price, moving average price)`, S4.

- latest price is the median of best bid, best ask and last trade.
- reasonable price is `index × (1 + previous period rate × time to next settlement / interval)`.
- moving average price is `index + 60 minute moving average of (latest price - index)`.

No clamp on the mark is documented beyond the median, S4.
When the basis jumps and stays, the latest price moves at once, the reasonable price stays near the index, and the moving average price sits between them, so the median follows the moving average and the mark trails the book for up to an hour.
That reading is derived from the formula and was not observed.

### Funding

The formula, interval and clamps are in [`fees.md`](./fees.md) section 6.
The guide says the rate for a period is fixed at its start from the previous period's data and applied at its end, so the published rate is the one for the upcoming settlement and is known a whole period ahead, S6.
A predicted next rate is computed every minute.
Whether the API publishes the fixed rate, the predicted rate or both was not verified.

### How often each number changed

Not measured, since no call answered.

## 5. REST book snapshot

`GET https://futuresopenapi.coinup.io/fapi/v1/depth?contractName=E-BTC-USDT&limit=100` answered 403 challenge, P1.
Depth limits, level order and caching are Not verified.

## 6. Rate limits and errors

No limit was reachable or readable.
The only error this host saw is the challenge in section 1, which carries no `Retry-After`.
The engine treats 403 as a rate limit, at [`errors.ts`](../../../server/src/shared/errors.ts) line 1, and pauses the anchor poller for `rateLimitPauseMs` when no `Retry-After` comes, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 193.
Against this venue a poller would pause and retry forever without one reading.

## 7. Server time and clock offset

`GET /fapi/v1/time` and `GET /sapi/v1/time` answered 403 challenge, so the venue's clock and its offset were not measured, P1.

## 8. Recommended poller shape

None.
No poller is recommended while every CoinUp host answers this machine with a challenge.
Three things would have to change before a poller is worth designing.

1. A CoinUp API host that answers a plain HTTP client with JSON from the engine's network.
   Nothing public says how to get one.
2. A catalog source, since CCXT has no class, which means a hand-written connector outside the current registry shape.
3. A bulk anchor, since the ChainUp shape reads index and mark one contract per call.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinGecko derivatives exchange `coinup-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/coinup-futures?include_tickers=unexpired | 2026-09-22 | CoinGecko | contract ids, counts, section 2 |
| S2 | Contract variety elements, CoinUp contract guide, Wayback capture of 2024-04-20 | https://web.archive.org/web/20240420223935/https://coinup.io/en/usdt_margined_perpetual_contract/contract_variety_elements.html | 2026-09-22 | CoinUp, global | face values, section 2 |
| S3 | Index Price, same guide, capture of 2024-04-20 | https://web.archive.org/web/20240420221150/https://coinup.io/en/Overview/index_price.html | 2026-09-22 | CoinUp, global | index sources, sampling, clamps, section 4 |
| S4 | Mark Price, same guide, capture of 2024-04-20 | https://web.archive.org/web/20240420230754/https://coinup.io/en/Overview/mark_price.html | 2026-09-22 | CoinUp, global | mark formula, section 4 |
| S5 | crt.sh certificate search for `%.coinup.io` | https://crt.sh/?q=%25.coinup.io | 2026-09-22 | crt.sh | host names, section 1 |
| S6 | Funding Rate, same guide, capture of 2024-04-20 | https://web.archive.org/web/20240420231330/https://coinup.io/en/Overview/funding_rate.html | 2026-09-22 | CoinUp, global | when the rate is fixed, section 4 |
| S7 | CCXT 4.5.68 `bitrue.js` | `server/node_modules/ccxt/js/src/bitrue.js` | 2026-09-22 | CCXT | the ChainUp `fapi/v1` path shape tried, lines 153 and 225 to 233 |
| P1 | `rest-probe.mjs access` at 04:14 and 04:21 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinup/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | sections 1, 3, 5, 6 and 7 |
| P2 | `rest-probe.mjs context` at 04:14 and 04:21 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinup/rest-probe.mjs) | 2026-09-22 | this host | sections 2 and 3 |
