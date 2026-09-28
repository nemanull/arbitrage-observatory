# BiKing REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The survey is dated 2026-09-22, and the host clock read 2026-09-24 when these pages were read and probed.

BiKing publishes no REST API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
Its help center returned no article about an API for the queries `API` and `open api` on 2026-09-24, S1.
The only market data endpoints found are the ones its own website calls, and they return an encrypted body.
So this profile records what was checked and what failed, and the anchor sections are Not verified.

## 1. Host and latency from this machine

| host | resolved on 2026-09-24 | result |
|---|---|---|
| `www.bikingex.com` | `47.75.233.24` | website and its data endpoints, HTTP 200, P1 |
| `api.bikingex.com` | NXDOMAIN | P1 |
| `openapi.bikingex.com` | NXDOMAIN | P1 |
| `futuresopenapi.bikingex.com` | NXDOMAIN | P1 |
| `biking.com` | `13.248.169.48`, `76.223.54.146` | an unrelated parked page that redirects to `/lander` |

The `openapi` and `futuresopenapi` names were tried because white-label exchange platforms often use them, and neither exists.
One `curl` to `/contract/api/v2/public/url-info` on 2026-09-24 took 165 ms to connect, 334 ms to finish TLS and 507 ms to the first byte.
The reply set an `acw_tc` cookie, which is the session cookie of Alibaba Cloud's web application firewall.
P1 timed the same three endpoints cold and warm, see section 2.
No refusal was seen from this Canadian VPN exit.

## 2. Catalog

No documented instruments call exists.
The futures web app at `https://www.bikingex.com/swaps` loads its data from paths on the page's own origin, S2.

| path | role in the bundle, S2 | P1 status | P1 time cold, warm, in two runs | P1 body |
|---|---|---|---|---|
| `/contract/api/v2/public/ins` | `codeList`, the contract list | 200 | 2,125 and 1,061 ms, then 1,378 and 821 ms | 323,968 bytes, not JSON |
| `/market/api/v2/pub/index` | `codeListPrice`, the price list | 200 | 471 and 696 ms, then 644 and 480 ms | 77,120 or 77,144 bytes, not JSON |
| `/contract/api/v2/public/url-info` | `getUrl`, the URLs the app uses | 200 | 172 and 496 ms, then 181 and 547 ms | 192 bytes, not JSON |

Every body is served as `application/json;charset=UTF-8`, but it is a single base64 string that does not parse as JSON, P1.
All three bodies start with the same 43 characters, `3YettQa5LMLxSzWs8UUlhrlieXLLtsdVMoy38JeS6Rl`.
That fits a block cipher encrypting a common JSON envelope prefix, so the payload is deliberately encrypted.
This research did not decrypt it.
A key taken from the website bundle would be reverse engineering a private interface, and the venue could change it at any release.

So the active perpetual count, the symbol spelling, the contract size and the status values are all Not verified.
The help center describes USDT-margined perpetuals only, with BTCUSDT sized at 0.001 BTC per contract in its example, S3.
CoinMarketCap's derivatives ranking reported 172 derivatives pairs on 2026-09-23, as given in the survey brief, see [`fees.md`](./fees.md) section 1.

## 3. Anchor

No documented call returns index, mark or funding.
The venue does publish all three on its site, because the help center defines them, S3 and S4.
The `/market/api/v2/pub/index` reply above may carry them, but it is encrypted, so no field can be mapped to an `AnchorRow` column.

## 4. Anchor semantics

Taken from the help center only, and none of it was checked against a reply.

- Index: "the weighted average of prices in major mainstream trading markets", called the BiKing Index, S3.
  No basket, weights or basket call are published.
- Mark, first formula: "Mark price = index price * (1 + basis rate of fund cost)", where the basis rate is the funding rate times the time to the next payment over the funding interval, S3.
- Mark, second formula in the same article: "Mark Price = Median (Price 1, Price 2, futures Price)", S3.
  Price 1 is "price index* (1 + funding rate *(time from next funding rate collection (hours)/8))".
  Price 2 is "Price Index + Moving Average (30-minute basis)", the average of mid minus index sampled every minute over 30 minutes.
- Mark clamp: "in extreme market conditions or price source deviations ... Biking Exchange will take additional protection measures, and at this time will directly use price 2 as the mark price", S3.
  No threshold for that switch is published.
- Funding: "Funding rate (F) = premium index (P) + clamp (interest rate (I) - premium index (P), 0.05%, -0.05%)", S4.
  P uses depth-weighted bid and ask against the mark, over the spot price.
  No cap on F is published.
- Interval: 8 hours at 00:00, 08:00 and 16:00 UTC+8, S4, with at least one announced exception for DOGS and ACT, see [`fees.md`](./fees.md) section 6.
- Whether a published rate is the upcoming or the last settled one is Not verified.
- How often each number changes is Not verified.

## 5. REST book snapshot

Not verified.
The futures bundle names `contracts` on the origin as `pkOrder`, S2, but `GET https://www.bikingex.com/contracts` returned the website HTML with status 200 on 2026-09-24.

## 6. Rate limits and errors

No rate limit is published.
No limit was hit in two runs of six requests each, sent one after another, P1.
The site sits behind Alibaba Cloud's web application firewall, section 1, whose limits are unknown.

## 7. Server time and clock offset

No server time call is known.
The `Date` header of the reply at 07:07:40 UTC on 2026-09-24 matched the host clock to the second, which is the only resolution the header offers.

## 8. Recommended poller shape

None.
There is no public endpoint whose reply can be read, so no anchor poller can be written.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Help center search, `https://biking.zendesk.com/api/v2/help_center/articles/search.json?query=<q>&locale=en-us` | 2026-09-24 |
| S2 | Futures web bundle `https://biking-index.oss-accelerate.aliyuncs.com/biking-index/swaps/assets/js/app.2d502930.js`, the object that maps `codeList`, `codeListPrice`, `getUrl` and `pkOrder` to paths | 2026-09-24 |
| S3 | "Perpetual Futures Product Details", `https://biking.bkexchange.news/hc/en-us/articles/11063882487825`, read through `https://biking.zendesk.com/api/v2/help_center/en-us/articles/11063882487825.json`, updated 2025-11-17 | 2026-09-24 |
| S4 | "Funding Rate (Perpetual Futures)", article 11063905319185 on the same help center, updated 2025-11-17 | 2026-09-24 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/biking/rest-probe.mjs), run 2026-09-24 | 2026-09-24 |
