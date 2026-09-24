# Vindax Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:41 to 05:24 UTC), from the development host near Seattle, in two passes, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

VinDAX (CoinGecko id `vindax`, no CCXT class) is a centralized spot exchange, and it lists no perpetual, dated future, option or margin product.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
The fee schedule itself could not be read from this host, and section 1 says exactly what was tried.
Every number below carries a source id from section 10, a probe reference, or a file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local time, 2026-09-23 UTC | P1 to P4 |
| legal entity | Not publicly specified in any page readable from this host | S1, S2 |
| country and founding | CoinGecko lists Vietnam and 2019, and CoinMarketCap says live since March 2019 | S3, S5 |
| who may trade spot | not US or Canadian citizens or residents, wherever they are located | S2 |
| other excluded regions | Not verified, because the terms page could not be read | S1 |

The exclusion is quoted from `vindax.com/forbidden.html` as the Internet Archive captured it on 2025-01-11, S2.
"Sorry, we do not provide our services to US and Canada citizens and residents of the USA and Canada whether located on US and Canada territories or abroad."
The same page adds "We reserve the right to monitor and block registration from the USA, Canada and/or from US, Canada citizens and residents located on US and Canada territories or abroad."
So US persons may not trade on Vindax, and neither may Canadian residents.

Access from this host, all through the Canadian VPN exit, which the Cloudflare trace placed at `loc=CA` behind the `YVR` edge on 2026-09-23 at 04:41 UTC:

| endpoint | result | when |
|---|---|---|
| `https://vindax.com/`, `/fees`, `/fees.html`, `/api-docs`, `/terms`, `/about`, `/forbidden.html` and 20 more page paths | HTTP 403, `cf-mitigated: challenge`, a Cloudflare "Just a moment..." page of about 5.2 KB | 2026-09-23 04:41 to 04:57 UTC |
| `https://vindax.com/api-docs` through WebFetch, which does not leave from this host | HTTP 403 | 2026-09-23, between 04:41 and 04:57 UTC |
| the homepage in one headless Chrome load with a 20 s budget | still the "Just a moment..." page, not solved | 2026-09-23, between 04:48 and 04:57 UTC |
| `https://vindax.com/_next/static/...` and any unknown path under `/public/` | served without a challenge, the latter as a Next.js 404 page | 2026-09-23, between 04:48 and 04:57 UTC |
| `https://api.vindax.com/api/v1/...` | HTTP 200, public market data | P1, P4 |
| `wss://socket.vindax.com/socket.io/?EIO=3&transport=websocket` | HTTP 101, public market data | P2, P3 |

So the public API and stream served a Canadian exit on 2026-09-23, although the venue says it does not serve Canadian residents.
No refusal of any API or stream call was seen.

What was tried for the fee schedule, and why it failed:

- The live fee page and the app's fee endpoint `/bapi/public/exchange/getFeeLevels`, named in the live app bundle S7, both answer with the challenge above.
- The same path on `api.vindax.com` returns that host's 55 byte "WELCOME TO VinDAX API" page, as every unknown path there does, P1 and P4.
- The Internet Archive holds `vindax.com/fees.html` only as the 2021 AngularJS shell, whose content came from `public/common/views/fees.html`, and it never archived that template, S6.
- The 2019 API document, S4, the CoinGecko exchange record, S3, and the CoinMarketCap exchange page, S5, carry no fee number.
- No web search was available to this researcher, and CryptoCompare's exchange list needs an API key.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every quote asset | Not verified | Not verified | S1, see section 1 |

No maker or taker number is written here, because none could be read from a primary or secondary source on 2026-09-22.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no futures host resolves, `fapi.vindax.com`, `futures.vindax.com` and `contract.vindax.com` have no DNS record, and `/fapi/v1/exchangeInfo`, `/fapi/v1/premiumIndex`, `/dapi/v1/exchangeInfo`, `/api/v1/premiumIndex` and `/api/v1/fundingRate` on `api.vindax.com` return the welcome page, P4 |
| USDC-M or coin-M perpetuals | absent | same evidence |
| dated futures | absent | same evidence, and the live app bundle names no futures route or endpoint, S7 |
| options | absent | same evidence |
| margin | absent | the live app bundle names no margin route or endpoint, S7 |
| spot | present | 628 symbols in `exchangeInfo`, 432 quoted in USDT, 94 in BTC, 75 in ETH and 27 in VD, the venue's own token, P1 |

CoinGecko's derivatives exchange list of 214 venues on 2026-09-23 has no Vindax entry, S3.
Only 103 of the 628 spot symbols had any 24 h volume, see [`rest.md`](./rest.md) section 2.

## 4. Spot tiers

Not verified.
The live app calls an endpoint named `getFeeLevels`, S7, which suggests a tiered schedule, but its reply sits behind the challenge.

### Qualification

Not verified.

## 5. Discounts that change the spot taker

Not verified.
Vindax issues its own token VD and quotes 27 pairs in it, P1, but whether holding or paying in VD lowers the fee could not be read.
No referral, market maker or zero fee promotion could be read either.

## 6. Funding as a cost

None.
Spot carries no funding, and Vindax lists no perpetual.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
A delisting charge or procedure is Not publicly specified in anything readable from this host.
The catalog does not flag dead markets: all 628 symbols read `TRADING`, while 25 had an empty book and 363 had no bid, P1.

## 8. CCXT

CCXT 4.5.68 has no Vindax class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and the only ids containing "dax" are `indodax` and `ndax`, P1.
CCXT master at commit `1d8b674434fde39ef282988b066812adf8d19b9e` of 2026-09-22 12:48 UTC has no `ts/src/vindax.ts` or `ts/src/pro/vindax.ts`, its 105 exchange files in `ts/src` include none named for Vindax, its `exchanges.json` lists 105 ids without it, and a GitHub code search of `ccxt/ccxt` for "vindax" returned 0 hits, S8.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
Vindax lists no perpetual, the engine's catalog comes only from a CCXT class, and no fee number could be verified, so `takerPpm` and `ccxtTakerPpm` stay unset.
If a spot leg is ever wanted, the fee has to be read from an account or from a browser that passes the challenge first.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | VinDAX website pages | https://vindax.com/fees.html, https://vindax.com/api-docs, https://vindax.com/forbidden.html | 2026-09-23 UTC, HTTP 403 challenge | VinDAX | section 1, what failed |
| S2 | VinDAX "Services Unavailable" page, Internet Archive capture of 2025-01-11 | https://web.archive.org/web/20250111065313/https://vindax.com/forbidden.html | 2026-09-23 | VinDAX, US and Canada | who may trade, section 1 |
| S3 | CoinGecko API, `exchanges/vindax` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/vindax | 2026-09-23 | CoinGecko | country Vietnam, year 2019, trust score 3, trust score rank 154, 71 coins, 87 pairs, 374.6 BTC 24 h volume, absence from the derivatives list, sections 1 and 3 |
| S4 | VinDAX API Document, "Last updated: March 1, 2019", Internet Archive capture of 2019-06-07 | https://web.archive.org/web/20190607002214/https://vindax.com/public/common/views/api.html | 2026-09-23 | VinDAX | no fee in the API document, section 1 |
| S5 | CoinMarketCap VinDAX exchange page, through WebFetch | https://coinmarketcap.com/exchanges/vindax/ | 2026-09-23 | CoinMarketCap | live since March 2019, no fee number, links `vindax.com/fees.html`, section 1 |
| S6 | Internet Archive CDX index for `vindax.com/fees.html` and `vindax.com/public/common/views/` | https://web.archive.org/cdx/search/cdx?url=vindax.com/fees.html | 2026-09-23 | Internet Archive | the fee template was never archived, section 1 |
| S7 | Live VinDAX web app bundle chunk | https://vindax.com/_next/static/chunks/1394-d288b9c137b10db7.js | 2026-09-23 | VinDAX | `getFeeLevels` path, `socket:"wss://socket.vindax.com"`, no futures or margin endpoint, sections 1, 3 and 4 |
| S8 | CCXT GitHub repository, master | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 | CCXT | no Vindax class in master, section 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/vindax/rest-probe.mjs) `all`, at 05:00 and 05:17 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | catalog, quote counts, empty books, CCXT ids, sections 1, 3, 7 and 8 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `book`, `align` and `batch` | this host | 2026-09-23 UTC | this host, Canadian exit | the stream serves this exit, section 1 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `errors`, `deflate` and `silence` | this host | 2026-09-23 UTC | this host, Canadian exit | the stream serves this exit, section 1 |
| P4 | curl of the page paths, the API paths, the futures paths and hosts, and `https://www.cloudflare.com/cdn-cgi/trace`, and one headless Chrome load | this host | 2026-09-23 04:41 to 04:57 UTC | this host, Canadian exit | the challenge, the exit location, section 1 |
