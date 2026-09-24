# Bitbegin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:40 to 05:10 UTC on 2026-09-23, from the development host near Seattle through its Canadian VPN exit.

This profile covers Bitbegin's REST surface for its spot market, since the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Bitbegin publishes no API documentation and no public market data route.
Its web client calls an API at `api.bitbegin.io`, and that API refuses any client that does not send the web client's own header.
The API reads as Laravel from the Laravel Echo client in the bundle, its `x-ratelimit` headers and its `{"message":""}` 404 body, which is an inference.
Every call below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs), and the routes come from the web client's bundle, S1.

## 1. Host and latency from this machine

| host | resolved | cold | warm | source |
|---|---|---|---|---|
| `www.bitbegin.io`, the web client | 104.21.36.178 and 172.67.198.64, Cloudflare | 1,784 and 1,691 ms for the homepage | 886 to 1,389 ms | P1 |
| `api.bitbegin.io`, the API and the socket | the same two addresses | 530 and 555 ms for a 403 | 203 to 240 ms | P1 |
| `bitbegin.io` | the same two addresses, 301 to `www` | | | P1, C1 |
| `www.bitbegin.com` | 172.67.194.88 and 104.21.41.219 | | | P1, an unrelated blog, see [`fees.md`](./fees.md) section 1 |

Cloudflare's trace endpoint on `www.bitbegin.io` answered `loc=CA` in both runs, with `colo=SEA` in the first and `colo=YVR` in the rerun, and the `cf-ray` of the other fetches ended in `SEA` or `YVR`, P1.
So these timings are from a Canadian VPN exit through a Seattle or Vancouver edge, and the laptop's own route was not tested.
The web client's pages carry `x-powered-by: Next.js` and `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, C1.

## 2. Catalog

### The instruments call

No catalog call answers a client without the web client's header.
The web client reads its pairs from `/api/app-dashboard/<pair>` and its settings from `/api/common-settings`, S1, and both answered 403, section 6.

The only pair list a public client can read is the landing page's server rendered data, `/_next/data/<buildId>/index.json`, where `buildId` is read from the homepage HTML, S2.
It holds three lists of six pairs, `asset_coin_pairs`, `hourly_coin_pairs` and `latest_coin_pairs`, with the fields `id`, `parent_coin_id`, `child_coin_id`, `last_price`, `balance`, `price_change`, `volume`, `high`, `low`, `pair_decimal`, `child_coin_name`, `parent_coin_name`, `child_full_name`, `parent_full_name`, `coin_icon` and `change`, P2.

| source | pairs | quotes | differs by |
|---|---|---|---|
| landing page data, three lists merged by `id` | 12 | 11 in USDT, 1 in ETH | has `USDT/ETH`, lacks `LINK/USDT` |
| CoinGecko tickers | 12 | 12 in USDT | has `LINK/USDT`, S3 |

So the landing data is not a complete catalog, and the full list is at least 13 pairs.
`USDT/ETH` has `parent_coin_id` 13 and `child_coin_id` 2, a last price of 1935.56 and a 24 h change of 0 on every read, which reads as an inverted, idle listing.
No status or active flag is exposed.

### How CCXT 4.5.68 maps it

CCXT has no Bitbegin class, neither in 4.5.68 nor in master on 2026-09-22, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to map.

| identifier | where | form |
|---|---|---|
| pair string | the web client's `coin_pair` query and the `/api/app-dashboard/<pair>` route | `BTC_USDT` |
| coin ids | the socket's channel names and the book and trade routes | `base_coin_id` 2 for USDT, `trade_coin_id` 1 for BTC |

The socket keys on coin ids and the REST routes on pair strings, so a feed would need a map between them, and only the landing data exposes one for its 12 pairs.

### Size unit, pairs listed twice, and price scale

Spot sizes are presumed to be base units, which could not be checked because no book was readable.
No pair is listed twice under one quote.
`USDT/ETH` and `ETH/USDT` are both present, as opposite directions of one market.

## 3. Anchor

Bitbegin publishes no index, mark or funding, because it lists no perpetuals.
The only reference number a public client can read is `last_price` in the landing data, a last trade price, for 12 pairs.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since no index, mark or funding exists.
Two readings of `last_price` are recorded as context for the spot market.

The landing data against Gate's spot `last`, read one pair at a time over the following two seconds, at 04:54 and 05:02 UTC on 2026-09-23, P2.

| pair | Bitbegin `last_price` | Gate `last` | difference | rerun Bitbegin | rerun Gate | rerun difference |
|---|---:|---:|---:|---:|---:|---:|
| BTC/USDT | 87141.42 | 87156.5 | -173 ppm | 87139.49 | 87001.2 | 1,590 ppm |
| ETH/USDT | 2781.9 | 2781.67 | 83 ppm | 2781.21 | 2772.83 | 3,022 ppm |
| LTC/USDT | 63.91 | 63.88 | 470 ppm | 63.97 | 64.56 | -9,139 ppm |
| UNI/USDT | 10.486 | 10.435 | 4,887 ppm | 10.469 | 10.451 | 1,722 ppm |
| AAVE/USDT | 150.86 | 150.09 | 5,130 ppm | 150.67 | 149.96 | 4,735 ppm |
| MANA/USDT | 0.08872 | 0.08897 | -2,810 ppm | 0.0888 | 0.08899 | -2,135 ppm |

In the first run the majors sat within a few hundred ppm of Gate and the thin pairs within about half a percent.
In the rerun Gate's BTC and ETH had fallen by about 0.2 % and 0.3 % while Bitbegin's last prices had not moved, and LTC differed by 0.9 %.
Bitbegin's BTC/USDT read 87138.00 at the first poll of the minute that followed and 87136.00 at the last, with 5 changes between, P3.
A single curl of all three at 05:04:42 UTC read Bitbegin 87127.00, Gate 86945.8 and Kraken 86949.0, so Bitbegin's last trade stood about 2,000 ppm above two large venues ten minutes after they moved, C1.
Whether that is a market maker that follows slowly or a book that does not follow at all could not be told without the book.
The 24 h `volume` of BTC/USDT was 5.48 BTC, of ETH/USDT 253.7 ETH and of AAVE/USDT 1,586 to 1,588 AAVE, P2.
CoinGecko's ticker for LINK/USDT showed a bid ask spread of -0.084 %, a crossed book at its fetch at 04:44 UTC, S3.

The landing data polled every 3 s for 60 s, 13 polls and then 15 in the rerun, changed `last_price` 0 to 5 times per pair, P3.
BTC/USDT changed 2 and 5 times, ETH/USDT 3 and 2, and `USDT/ETH` never.

## 5. REST book snapshot

The web client reads the book from `/api/get-exchange-all-orders-app?per_page=50&dashboard_type=dashboard&order_type=buy_sell&base_coin_id=<id>&trade_coin_id=<id>`, S1.
That route answered 403 `Access denied` to this probe, section 6.
No depth limit, level order or caching could be observed.

## 6. Rate limits and errors

| request | status | body | source |
|---|---|---|---|
| `/api/common-settings` | 403 | `{"error":"Unaccessable","success":false,"message":"Access denied"}` | P1 |
| `/api/app-dashboard/BTC_USDT` | 403 | the same | P1 |
| `/api/get-exchange-all-orders-app?…` | 403 | the same | P1 |
| `/api/get-exchange-market-trades-app?…` | 403 | the same | P1 |
| `/api/get-networks-list` | 200 | `{"success":false,"message":"Something went wrong","data":[]}` | P1 |
| `/api/v1/ticker`, `/api/v2/summary`, `/api/v2/ticker`, `/api/tickers`, `/api/coingecko/tickers`, `/api/public/tickers`, `/api-docs`, `/api/documentation` | 404 | `{"message":""}` | P1 |

The web client's request interceptor adds a fixed `userapisecret` header to every API call, S1.
The same string is published in the landing data as the setting `public_key`, S2.
The probe never sent it, and this profile does not quote it.
The API uses it to refuse clients other than the web client, the Terms forbid "attempts to bypass security controls", S4, and the site settings carry `api_access_enable` `"0"` and `api_access_allow_user` 0, S2.
So the refusal is taken as the venue's answer, and no call was made around it.

Every API reply carried `x-ratelimit-limit: 600` and an `x-ratelimit-remaining` that fell by one per request, from 594 to 590 over five calls, in both runs, P1.
The window is Not publicly specified, and it had reset in the eight minutes between the runs.
No reply carried `Retry-After`, and no 429 was produced at about one request a second.
The 403 is an application refusal with a JSON body, not a Cloudflare block and not a location block.

## 7. Server time and clock offset

No server time route is reachable.
The API's `Date` header against the local clock read 46, -157, -353, -550 and -750 ms over five requests a second apart, and -565, -788, -5, -347 and 198 ms in the rerun, P1.
The header has whole seconds, so the drift is the truncation walking through one second, and the clocks agree to within a second.

## 8. Recommended poller shape

None.
There is no anchor to poll, since the venue lists no perpetuals, and no public market data route to poll for spot either.
The landing page data is a page render of 68 KB that took 852 to 6,757 ms, median 1,153 ms, over 13 polls, and 897 to 1,530 ms, median 1,013 ms, over 15 polls in the rerun, P3, and it is not an API.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbegin web client bundle, `_app` chunk | https://www.bitbegin.io/_next/static/chunks/pages/_app-4d755e7858755c43.js | 2026-09-22 | Bitbegin | API base `https://api.bitbegin.io/api`, route names, the `userapisecret` interceptor, book `per_page` 50, sections 2, 5 and 6 |
| S2 | Landing page data | https://www.bitbegin.io/_next/data/JX8hCEZb_I5hxo6OapA8c/index.json | 2026-09-22 | Bitbegin | pair lists and fields, `public_key`, `api_access_enable`, `enable_future_trade`, sections 2, 4 and 6 |
| S3 | CoinGecko API, exchange detail | https://api.coingecko.com/api/v3/exchanges/bitbegin | 2026-09-22 | CoinGecko | 12 tickers, LINK/USDT, negative spread, sections 2 and 4 |
| S4 | Terms and Conditions | https://www.bitbegin.io/terms-and-conditions | 2026-09-22 | British Capital LLC | "attempts to bypass security controls", section 6 |
| P1 | `rest-probe.mjs access`, 04:53 and 05:01 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | DNS, latency, refusals, rate limit headers, Cloudflare trace, clock, sections 1, 6 and 7 |
| P2 | `rest-probe.mjs pages`, 04:54 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | landing data, settings flags, pair list, Gate compare, sections 2 and 4 |
| P3 | `rest-probe.mjs poll`, 04:54 to 04:55 and 05:02 to 05:03 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | 13 and 15 polls, change counts, timings, sections 4 and 8 |
| C1 | manual `curl` checks at 04:41 to 05:05 UTC on 2026-09-23 | the apex redirect, homepage headers, and one simultaneous read of the landing data, Gate `spot/tickers` and Kraken `Ticker` for BTC | 2026-09-22 | this host, Canadian VPN exit | Next.js headers, the three venue BTC compare, sections 1 and 4 |
