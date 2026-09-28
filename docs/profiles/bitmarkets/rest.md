# BITmarkets REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:41 to 06:56 UTC by the host clock, from the development host near Seattle, whose traffic exits a Surfshark WireGuard tunnel geolocated to Canada.

BITmarkets publishes no REST API documentation and exposes no public market data endpoint that this host could reach.
This profile records every host that was checked, what each returned, and where the perpetual data that CoinMarketCap shows could come from.
The calls are in [`rest-probe.mjs`](../../../scripts/probes/venues/bitmarkets/rest-probe.mjs), plus the `curl` checks named below.
Access results are from that Canadian VPN exit, and the Cloudflare edge that answered was `YVR` in the `cf-ray` header.

## 1. Host and latency from this machine

| host | resolved IPv4 | probed reply | time |
|---|---|---|---|
| `bitmarkets.com` | 104.20.46.100, 172.66.145.203, Cloudflare | 403 `cf-mitigated: challenge` "Just a moment..." on `/`, `/en`, `/robots.txt`, the fee, terms and futures pages | 41 ms |
| `bitmarkets.com/en/api` | same | 404 with the full site page and no challenge, where `/api` redirects with 302 | 1,104 ms |
| `api.bitmarkets.com` | 18.64.67.60, .79, .89, .123, CloudFront | TLS fails with `CERT_HAS_EXPIRED`, the `*.bitmarkets.com` certificate ran from 2022-12-19 to 2023-12-21 | 14 to 50 ms |
| `api.bitmarkets.com`, certificate check off | same | 200 with `{"code": 44444444, "msg": "block", "time": 1782270117900, "data": "", "success": false}` and `x-cache: Error from cloudfront` on every path | 5 to 35 ms |
| `ws.bitmarkets.com` | 104.20.46.100, 172.66.145.203 | 200 with the same block JSON and `x-cache: Error from cloudfront` | 54 ms |
| `platform-api.bitmarkets.com` | 104.20.46.100, 172.66.145.203 | 404 "Not Found" HTML on `/v1/`, `/v1/symbols`, `/v1/markets`, `/v1/instruments`, `/v1/futures/symbols`, `/v1/time`, `/v1/ticker` | 252 to 754 ms |
| `myzone-api.bitmarkets.com` | 104.20.46.100, 172.66.145.203 | 404 HTML on `/api/v2`, `/api/v2/markets`, `/api/v2/futures/markets`, and 401 HTML on `/api/v2/currencies` | 983 ms |
| `docs.`, `openapi.`, `support.`, `help.`, `futures.`, `stream.bitmarkets.com` | no DNS record | | |

The block JSON carries the same `time`, 2026-06-24 03:01:57 UTC, on every request and on both CDNs, so it is a stored error page and not a live answer.
The same body came back through WebFetch, whose requests do not originate from this host, so the block is not specific to the Canadian exit.
A headless Chrome on this host stopped at the same Cloudflare challenge on the fee page, and was closed at once.

## 2. Catalog

No instruments call exists that this host could reach.
CCXT 4.5.68 has no BITmarkets class, and the current CCXT `ts/src` has none either, see [`fees.md`](./fees.md) section 8.

CoinMarketCap's `market-pairs/latest` with `category=perpetual` listed 129 BITmarkets perpetuals on 2026-09-24 at 06:42 UTC, all quoted in USDT, S1.
Their open interest summed to about 261 million USD, and each row carries a price, an `indexPrice` and a `fundingRate`, S1.
That data reaches CoinMarketCap through a channel this host cannot see, so `market.id`, the socket symbol, the contract size and the size unit are all Not verified.

## 3. Anchor

No public call returns index, mark, funding rate, interval or next settlement.
The only view of those numbers is CoinMarketCap's copy, S1, which gives `indexPrice` and `fundingRate` per pair and no mark, interval or next settlement time.
CoinMarketCap is not a venue anchor, since its refresh cadence and source are not the venue's.

| `AnchorRow` column | field | status |
|---|---|---|
| `index` | none public | Not verified |
| `mark` | none public | Not verified |
| `fundingRate` | none public | Not verified |
| `fundingIntervalHours` | none public | Not verified |
| `nextFundingAt` | none public | Not verified |

## 4. Anchor semantics

The index formula and basket, the mark formula and its clamps, and the funding formula and cap are not published in any page this host could read.
In CoinMarketCap's copy, 62 of 129 funding rates were exactly 0.0001, and the range was -0.00010348 to 0.0001, S1.
Whether 0.0001 is a default interest term or a cap is Not verified.
No settlement instant was captured, and no funding history endpoint was found.

## 5. REST book snapshot

None found.

## 6. Rate limits and errors

Not publicly specified.
The only error shapes seen are the Cloudflare challenge page with 403, the stored block JSON with 200, the `platform-api` "Not Found" HTML with 404, and the `myzone-api` HTML with 401, section 1.
No 429 was produced by about thirty requests spread over fifteen minutes.

## 7. Server time and clock offset

No server time call was found.
The CloudFront `date` header on `api.bitmarkets.com` read `Thu, 24 Sep 2026 06:44:08 GMT`, which agrees with this host's clock to the second.

## 8. Recommended poller shape

None.
There is no public index, mark or funding call, so no anchor poller can be written.
BITmarkets would need to publish a market data API before it could join the engine.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap market pairs, `category=perpetual`, start 1 and 101 | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitmarkets&category=perpetual&start=1&limit=100 | 2026-09-24 | CoinMarketCap | sections 2, 3 and 4 |
| S2 | `my.bitmarkets.com` web app shell, Wayback capture of 2025-09-23, naming `platform-api.bitmarkets.com/v1/` as `tradingApi` and `myzone-api.bitmarkets.com/api/v2` as `API_URL` | https://web.archive.org/web/20250923210857/https://my.bitmarkets.com/ | 2026-09-24 | BITmarkets | section 1 |
| S3 | Wayback URL index of `bitmarkets.com`, 17,940 rows, which lists `platform-api`, `myzone-api` and no API documentation page | https://web.archive.org/cdx/search/cdx?url=bitmarkets.com&matchType=domain | 2026-09-24 | Internet Archive | section 1 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitmarkets/rest-probe.mjs) at 06:54 UTC | | 2026-09-24 | this host | section 1 |
| P2 | `curl` checks of paths, headers and the certificate with `openssl s_client`, 06:41 to 06:50 UTC | | 2026-09-24 | this host | sections 1, 6 and 7 |
