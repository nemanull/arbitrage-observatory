# Cryptal Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific, which is 2026-09-23 from 04:40 to 04:56 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which geolocates to Canada.

Cryptal lists no perpetual, dated future, option or margin product, so this profile covers its spot order book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
CCXT 4.5.68 has no Cryptal class, and neither does CCXT master, see section 8.
Every number below carries a source id from section 10 or a probe reference.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Digital Ledger Technologies LLC, "a limited liability company registered in Georgia" | S3, terms section 2.1, last updated Dec. 9, 2022 |
| licences | "a Georgian VASP (Virtual Asset Service Provider) license and an international FCIS (Financial Crime Investigation Service) license granted by Lithuania". The footer of every page shows "license 0002-9404" and does not name the issuer | S5 |
| founded | 2018 on the About page, 2020 on CoinGecko | S5, S8 |
| governing law | the laws of Georgia and the courts of Georgia | S3 |
| products | spot order book ("Spot Trading"), Instant Trade and convert, B-Link and an OTC desk for large orders | S1, S6 |
| who may trade | a verified account. The published limits give an `UNVERIFIED` account no deposit and no withdrawal method, against 30 deposit and 31 withdrawal currencies for `VERIFIED` | S1, page data `fees.limits` |
| excluded | citizens of 42 countries cannot open a verified account, among them the United States of America, the Russian Federation, Belarus, Iran, North Korea, Colombia, Panama and Nigeria. Canada is not on the list | S4, updated 2026-06-18 |
| US persons | cannot be verified, so cannot fund an account or trade | S4 |
| eligibility clause | "You can use our Product if it is permitted under the laws of Your jurisdiction (Country of permanent residence)" | S3, section 3.2 |

The exclusion list is written by citizenship: "We are unable to verify accounts for citizens of the following countries".
The FAQ says "Citizens and residents of most countries can be verified", and names 14 of the 42, S7.

Access from this host, all through the Canadian VPN exit:

| URL | status on 2026-09-23 UTC |
|---|---|
| `https://cryptal.com/en/fees`, `/en/terms-of-use`, `/en/faq`, `/en/aml`, `/en/about-us`, `/en/services` | 200 |
| `https://api.cryptal.com/openapi.json`, the API reference | 200, 47,237 bytes |
| `https://exchange.cryptal.com/exchange/api/v1/public/*` | 200, see [`rest.md`](./rest.md) section 1 |
| `https://support.cryptal.com/hc/en-us/articles/360019782159-...`, the country list page | 403, a Cloudflare "Just a moment..." challenge |
| `https://support.cryptal.com/api/v2/help_center/en-us/articles/360019782159.json`, the same article through the Zendesk API | 200, read for S4 |
| `wss://wss.cryptal.com/gex`, the web client's socket | 101, then closed by the server with 1002, see [`websocket.md`](./websocket.md) section 1 |

No reply named a region or a geoblock, and the Cloudflare challenge is a browser check that a plain HTTP client cannot pass.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, 68 of 69 tradable pairs | 0.25 % = 2,500 ppm | 0.25 % = 2,500 ppm | S1 fee table, and `makerFee` and `takerFee` `"0.0025"` in `GET /api/v1/public/pairs`, [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) `catalog` |
| spot `USD-GEL`, shown as `TOUSD-TOGEL` | 0 % = 0 ppm | 0.1 % = 1,000 ppm | same |
| perpetuals | absent | absent | section 3 |

The fees page prints "0.25" in a "Taker/Maker" column, and the API prints the fraction `"0.0025"`, so the two agree.
All 81 rows of `GET /pairs`, including the 12 not tradable, carry 0.0025 for both sides except `USD-GEL`, in both catalog runs.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | the words perpetual, future, leverage and funding appear neither in the API reference S2 nor in the 2.74 MB trading client bundle at `https://cryptal.com/ex/`, whose `swap` strings name the convert screen, and the site navigation S1 and services page S6 list no derivative |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same. The only futures page is a beginners' blog article about futures in general |
| options | absent | same |
| margin | absent | same |
| spot | present | 81 pairs in `GET /pairs`, 69 with `tradeEnabled` true, quoted in `USD` shown as `TOUSD` (27), `GEL` shown as `TOGEL` (28), `EUR` shown as `TOEUR` (8), `BTC` (5) and `USDT` (1), see [`rest.md`](./rest.md) section 2 |
| Instant Trade and convert | present | S1 has an Instant Trade fee tab, not researched |
| OTC desk and B-Link | present | S6, not researched |

CoinGecko lists Cryptal as a spot exchange with trust score 3, 27 coins, 68 pairs and 10.65 BTC of 24 h volume, and its derivatives exchange list of 214 venues does not contain Cryptal, S8.
The survey plan names Cryptal at trust rank 148, and the CoinGecko API answered `trust_score_rank` 155 on 2026-09-23 UTC.

## 4. Spot tiers

None is published.
The fees page has one maker and taker per pair and no volume, VIP or holding tier, and its page data contains no `VIP`, `tier` or `volume` key, S1.
The API returns one `makerFee` and one `takerFee` per pair, S2.

## 5. Discounts that change the spot taker

| discount | effect on the order book taker | source |
|---|---|---|
| token holding | none, Cryptal has no exchange token | S1, S2 |
| referral | the referrer is credited "a percentage of fees" on the referred user's exchange transactions. The referred user's taker is not stated to change | S3, Referral Program |
| market maker programme | Not publicly specified | |
| zero fee promotions | "Buy USDT 1:1 with No Commission" and "0% Commission" banners apply to Instant Trade and convert. The 2022 and 2023 "no fee" blog posts cut USD, EUR and GEL withdrawal fees and the USDT to TOUSD Instant Trade. None applies to the order book | S1, S9 |

## 6. Funding as a cost

Not applicable, because Cryptal lists no perpetual.

## 7. Liquidation, settlement and delisting

There is no margin or derivative, so no liquidation or settlement charge exists.
A pair that is switched off stays in `GET /pairs` with `tradeEnabled` false, and 12 were on 2026-09-23 UTC, among them `MATIC-USD` and `XLM-BTC`.
Its book answers HTTP 403 with an empty body, see [`rest.md`](./rest.md) section 6.
No delisting charge is published.
Deposit and withdrawal fees by method and network are on the Top up and Withdrawal tabs of S1.

## 8. CCXT

No CCXT class exists for Cryptal.

| check | result |
|---|---|
| `require('ccxt').exchanges` in `server/`, CCXT 4.5.68 | 104 ids, none contains `cryptal`. The ids containing `cryp` are `cryptocom`, `cryptomus` and `tokocrypto`. [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) `catalog`, both runs |
| CCXT master, `exchanges.json` at `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, package version 4.5.82 | 105 ids, none contains `cryptal`, S10 |
| CCXT master, `ts/src/cryptal.ts` and `ts/src/pro/cryptal.ts` on raw.githubusercontent.com | 404, S10 |

So `market.taker` has no value to report, and there is no source line to cite.

## 9. Recommended registry values

None, because Cryptal cannot be a perpetual leg and has no CCXT class for the connector to load.
If a spot stage ever adds it, the base taker is `takerPpm` 2,500 from S1 and S2, with `ccxtTakerPpm` unset because no CCXT constant exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Cryptal Fees & Limits | https://cryptal.com/en/fees | 2026-09-23 UTC | Digital Ledger Technologies LLC, Georgia | pair fee table, Instant Trade tab, verified and unverified limits, promotion banners, sections 1 to 5 and 7 |
| S2 | Cryptal Exchange API, OpenAPI 3.0.1, Last-Modified 2023-03-28 | https://api.cryptal.com/openapi.json, rendered at https://api.cryptal.com/ | 2026-09-23 UTC | Cryptal | `makerFee` and `takerFee` fields, the product surface, sections 2 to 5 |
| S3 | Cryptal Terms of Use, last updated Dec. 9, 2022 | https://cryptal.com/en/terms-of-use | 2026-09-23 UTC | Digital Ledger Technologies LLC, Georgia | operator, eligibility, governing law, referral programme, sections 1 and 5 |
| S4 | Citizens of Countries That Cannot Open a Verified Cryptal Account, updated 2026-06-18 | https://support.cryptal.com/hc/en-us/articles/360019782159-Citizens-of-Countries-That-Cannot-Open-a-Verified-Cryptal-Account, read through https://support.cryptal.com/api/v2/help_center/en-us/articles/360019782159.json | 2026-09-23 UTC | Cryptal | the 42 excluded citizenships, section 1 |
| S5 | Cryptal About Us | https://cryptal.com/en/about-us | 2026-09-23 UTC | Cryptal | founding year, Georgian VASP and Lithuanian FCIS licences, section 1 |
| S6 | Cryptal Services | https://cryptal.com/en/services | 2026-09-23 UTC | Cryptal | B-Link and OTC desk, section 3 |
| S7 | Cryptal FAQ | https://cryptal.com/en/faq | 2026-09-23 UTC | Cryptal | "What nationalities can be verified?", section 1 |
| S8 | CoinGecko exchange and derivatives exchange APIs | https://api.coingecko.com/api/v3/exchanges/cryptal and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 UTC | CoinGecko | trust score, rank, coins, pairs, volume, absence from the derivatives list, section 3 |
| S9 | Cryptal blog posts `0-fee`, `nofeeusd` and `nofeeswiftusd` | https://cryptal.com/en/blog/0-fee, https://cryptal.com/en/blog/nofeeusd | 2026-09-23 UTC | Cryptal | withdrawal and Instant Trade promotions, section 5 |
| S10 | CCXT master | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json | 2026-09-23 UTC | CCXT | no Cryptal id, section 8 |
| P1 | `rest-probe.mjs catalog`, runs at 04:48 and 04:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptal/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | fees per pair, catalog counts, CCXT ids, sections 2, 3, 7 and 8 |
