# NBX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:40 to 05:10 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that Cloudflare places in Canada (`loc=CA`, edges `YVR` and `SEA`).

This profile covers the public REST API of NBX, the Norwegian Block Exchange, which lists spot markets only, see [`fees.md`](./fees.md) section 3.
Every API request from this host failed.
Requests with curl's User-Agent were blocked by the Cloudflare firewall with 403, and requests with Node's default fetch passed the firewall and got 522 after about 19.5 s, because Cloudflare could not reach the NBX origin.
The documented values below come from the NBX Public API 1.0.0 spec, S1, and the catalog from a Wayback capture and CoinGecko, S3 and S4.

## 1. Host and latency from this machine

| host | resolved | edge | result |
|---|---|---|---|
| `api.nbx.com` | `172.66.173.5`, `104.20.31.122`, Cloudflare | `SEA` or `YVR`, `loc=CA` | `/cdn-cgi/trace` 200. Every API path 522 with Node's fetch, and 403 with curl |
| `app.nbx.com` | the same two addresses | `SEA` or `YVR` | `/developers` and `/markets` 200 with Node's fetch, and `/`, `/developers` and `/markets` 403 with curl |
| `nbx.com` | `198.202.211.1`, the Webflow marketing site | `SEA` or `YVR` | 200 with both clients |

The edge seen for one host changed between runs, so both colos serve this tunnel.

### What each client got

| client | calls | status | time | body |
|---|---|---|---|---|
| curl 8.14.1, default User-Agent | `api.nbx.com/`, `/markets`, `/docs`, and `app.nbx.com/`, `/developers`, `/markets` | 403 | 52 to 78 ms | Cloudflare "Attention Required!", "Sorry, you have been blocked", "You are unable to access nbx.com", ray `a3f6e009cf8bd4c5-YVR` |
| Node fetch with `user-agent: curl/8.14.1`, `rest-probe.mjs ua` | `/markets`, three runs | 403 | 13, 14 and 140 ms | the same block page, classified `cloudflare_waf_block` |
| Node fetch, default User-Agent, `rest-probe.mjs access` | the ten public paths of sections 2 to 5, in three runs from 04:47 to 05:04 UTC | 522 | 19,296 to 19,856 ms, median 19,556, 29 requests | "522: Connection timed out", "The initial connection between Cloudflare's network and the origin web server timed out.", with `Retry-After: 120` |
| Node fetch, `rest-probe.mjs latency` | `/tickers` three times in each of two runs | 522 | 19,648 to 19,887 ms | the same |
| Node fetch, `rest-probe.mjs latency` | `/cdn-cgi/trace` ten times in each of two runs | 200 | first 11 and 10 ms, warm 9 to 41 ms, medians 10 and 13 ms | the Cloudflare edge only |
| WebFetch, which does not originate here | `api.nbx.com/markets`, `/tickers` | 522 | | `Retry-After: 120` |

The 403 is a firewall rule and not a country block, since the page is Cloudflare's generic "you have been blocked" page and not its "has banned the country or region" page.
It fires on curl's User-Agent, because the same path answered differently to Node's default fetch.
The spec says "if you find yourself blocked and have not exceeded the hard limit, you have likely violated a WAF rule", and recommends "a dedicated outbound IP address", S1.
This host sends from a shared VPN exit, and the probes never changed the route or disguised the client as a browser.

The 522 is the origin, not this host.
It came from two Cloudflare colos here and from WebFetch's own network, and the error page marks "Browser Working", "Cloudflare Working" and "api.nbx.com Host Error".
CoinGecko's record for NBX still showed `last_fetch_at` of 2026-09-23T04:51:40Z, during the probes, and a newest trade at 2026-09-22T22:22:46Z, S4.
Whether the origin answers other Cloudflare regions, or only CoinGecko's fetcher, is Not verified, since testing it would mean routing through another network.

### Where the spec was read

`app.nbx.com/developers` answered 200 to Node's fetch and loads the Redoc bundle `main.b707d6c60c5d57ab49d3.js`, which Node's fetch also read, S1.
The spec in it was compared field by field with the Wayback capture of the previous bundle, S2, and differs only in the description of the private cancel order call.

## 2. Catalog

### The instruments call

`GET https://api.nbx.com/markets`, public, paginated with an `x-next-page-url` header, and cached for 60 s, S1.
Each market carries `id`, `name`, `baseAsset`, `quoteAsset`, `status`, `statusDescription`, `disabled`, `cancelOnly`, `limitOnly`, `quoteIncrement`, `baseSizeMinimum` and `baseIncrement`, S1.
`GET /markets/{market_id}` returns one market, and the id is case insensitive, S1.

The call returned 522 here, so the live catalog was not read.

| catalog | count | quotes | source |
|---|---|---|---|
| Wayback capture of `/markets`, 2025-06-07 | 41 spot markets, all `status` `"OK"`, 5 of them `disabled`: `BTC-USDC`, `ETH-USDC`, `ETH-BTC`, `CGT-NOK` and `CGT-EUR` | NOK, SEK, DKK, EUR and USDM on the 36 enabled markets | S3 |
| CoinGecko tickers, 2026-09-22 | 21 spot tickers, 10 not stale | NOK, EUR, USDM | S4 |
| perpetuals | 0 | | S1, S3, S4 |

The archived rows also carry `isQuickbuyEnabled`, `quickbuyBaseAssetMaximum` and `quickbuyQuoteAssetMaximum`, which the spec does not document, S3.
CoinGecko reported 4.1 BTC of 24 h volume, trust rank 163, and bid and ask spreads of 1.2 % to 7.5 % across the 21 tickers, S4.
The busiest ticker was `USDC-NOK` at about 253,000 USD, then `BTC-NOK` at about 66,000 USD, S4.

### How CCXT maps it

CCXT 4.5.68 has no NBX class, and CCXT master 4.5.82 has none either, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.
The venue's own id is `BASE-QUOTE`, as in `BTC-NOK`, and the same spelling goes into the socket URL, S1.

## 3. Anchor

NBX publishes no index, no mark price and no funding rate, because it lists no perpetual.
The only reference prices are those of `GET /tickers`, which is not paginated and is cached for 3 s, S1.

| field | meaning |
|---|---|
| `lastTradePrice` | last trade on NBX |
| `currentHighestBuyPrice`, `currentLowestSellPrice` | best bid and ask on NBX |
| `highestBuyPriceLast24Hours`, `lowestSellPriceLast24Hours`, `openPriceLast24Hours`, `closePriceLast24Hours` | 24 h statistics |
| `volumeBaseAssetLast24Hours`, `volumeQuoteAssetLast24Hours` | 24 h volume |

All of them are NBX's own prices, not a basket of other venues, S1.
USDM, a quote asset on NBX, is a USD e-money token issued by NBX and Moneta on Cardano, see [`fees.md`](./fees.md) section 3.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable.
There is no index formula, basket, mark, clamp or funding rate to record.
The `/tickers` call answered 522 on all six polls, so how often its fields change was not measured.

## 5. REST book snapshot

`GET https://api.nbx.com/markets/{market_id}/orders`, public, with an optional `side=buy` or `side=sell`, S1.

| item | value | source |
|---|---|---|
| granularity | one row per open order: `id`, `price`, `quantity`, `side` | S1 |
| order | "highest to lowest price for `BUY` orders and lowest to highest price for `SELL` orders", equal prices "by creation time (first to last)" | S1 |
| depth limit | none, every open order, paginated with `x-next-page-url` and a page size that "cannot be determined or specified in advance" | S1 |
| caching | "Max age of the response is 3 seconds", a stale answer allowed for 60 s if revalidation fails and for 10 s while it runs | S1 |
| archived sample | `CGT-NOK` on 2021-05-14: 36 orders, 18 buys descending and 18 sells ascending, at 35 distinct prices | S5 |
| probed | `BTC-NOK`, `BTC-NOK?side=sell`, `PALM-USDM` and `NOPE-NOK` all 522 | P1 |

So the book is order level, and a reader must sum orders at the same price.
By 2026-06-27 most markets no longer showed a customer order book, see [`fees.md`](./fees.md) section 3.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| hard limit | "a global rate limit of 1000 requests per minute from any single IP address" | S1 |
| on breach | "a `429` error page", and "Exceeding this limit will get your IP blocked for 1 minute from accessing any NBX service." | S1 |
| order entry | "Create order API endpoint has additionally 100 requests per minute limit." | S1 |
| WAF | undisclosed rules, a dedicated outbound IP recommended | S1 |
| `Retry-After` | not documented. Cloudflare's 522 page carried `Retry-After: 120` | S1, P1 |
| error bodies | the spec gives empty objects for 400, 401, 403, 404, 429, 500 and 503, and field errors as `{"error": {"headers": {...}, "body": {...}}}` for the token call | S1 |
| 503 | "Service/market is unavailable OR the market is cancel-only, limit-only or disabled." | S1 |

The research sent about 100 requests to NBX hosts over about 30 minutes, about 75 of them to `api.nbx.com`, far inside the hard limit.

## 7. Server time and clock offset

The spec has no server time call, S1.
Every probed response came from the Cloudflare edge, whose `date` header is Cloudflare's clock and not the venue's, so no clock offset was measured.

## 8. Recommended poller shape

None.
NBX has no index, mark or funding to poll, and its API origin did not answer this host.
`GET /tickers` is the only bulk price call, and it would give NBX's own last price and touch, cached for 3 s, S1.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | NBX Public API 1.0.0, Redoc spec in `main.b707d6c60c5d57ab49d3.js` | https://app.nbx.com/developers | 2026-09-23 04:57 UTC, read with Node's fetch | NBX, global | every documented call, field, cache rule, limit and error, sections 1 to 8 |
| S2 | NBX Public API 1.0.0, Wayback capture of the previous bundle | https://web.archive.org/web/20251214013924/https://app.nbx.com/developers/main/main.1a1c770078ca98dee557.js | 2026-09-22 | NBX, global | the spec comparison, section 1 |
| S3 | `GET /markets`, Wayback capture of 2025-06-07 | https://web.archive.org/web/20250607220157/https://api.nbx.com/markets | 2026-09-22 | NBX | the archived catalog, section 2 |
| S4 | CoinGecko exchange record and tickers for `nbx` | https://api.coingecko.com/api/v3/exchanges/nbx | 2026-09-22, and the tickers call at 2026-09-23 04:53 UTC | CoinGecko | ticker count, volume, spreads, trust rank, fetch time, sections 1 and 2 |
| S5 | `GET /markets/CGT-NOK/orders`, Wayback capture of 2021-05-14 | https://web.archive.org/web/20210514080635/https://api.nbx.com/markets/CGT-NOK/orders | 2026-09-22 | NBX | the order level book shape, section 5 |
| P1 | `rest-probe.mjs all`, 04:52 to 04:56 UTC and 05:01 to 05:05 UTC, and a first `access` run from 04:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/nbx/rest-probe.mjs) | 2026-09-23 UTC | this host | DNS, edges, every 522 and 403, trace latency, sections 1, 5 and 6 |
| P2 | curl 8.14.1 by hand, 04:41 and 05:01 UTC | none, commands in section 1 | 2026-09-23 UTC | this host | the 403 firewall block, section 1 |
