# GroveX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:42 UTC, from the development host near Seattle.

GroveX is CoinGecko's trust rank 36 on 2026-09-22, it lists no perpetual, and it has no CCXT class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The fee numbers come from the JSON that GroveX's own fee page loads, and every row names its source.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/grovex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | GROVEX PTY LTD, Australian Private Company, ABN 13 667 226 459, ACN 667 226 459, ABN active from 19 April 2023, main business location VIC 3059 | S6 |
| name on the legal pages | "GroveX", with no company name, number or address | S3 |
| other names | GitHub organisation "GroveXchange (GroveX PTY LTD)", which hosts the API document | S5 |
| regulator | a third-party review says GroveX was registered with AUSTRAC as a digital currency exchange in August 2023, and the AUSTRAC register was not checked | S9 |
| governing law | "the laws applicable to GroveX's then-current licensing and operating framework", Terms of Service section 30 | S3 |
| excluded | anyone located, resident or ordinarily resident in the United States or a U.S. Territory, any U.S. Person, and anyone in a jurisdiction where the service would be unlawful or need a licence GroveX lacks, Terms of Service section 3.1 | S3 |
| US persons | may not trade | S3 |
| terms version | Terms of Service effective 11 February 2026, Terms and Conditions version 2026.11 of the same date, Risk Disclosure effective 2 September 2026 | S3, S4 |
| access from this host | the web site, `openapi.grovex.io` and `wss://ws.grovex.io/kline-api/ws` all answered this host near Seattle with HTTP 200 or 101 on 2026-09-23 UTC, with no geoblock and no challenge | P1, P2 |

The Terms say GroveX may use geolocation, IP analysis and device signals to restrict access from a restricted jurisdiction, and that a suspected U.S. Person may be limited to withdrawals, S3.
The public market data did not do that to this host.

The Terms of Service also list, as prohibited conduct that undermines market integrity, "exploitation of precision/rounding/tick-size/fee/latency differences, stale quote exploitation, and profiting from Platform Errors or abnormal conditions", section 9.3 of S3.
The Terms define "Abusive Trading" to include exploiting "price-feed, or latency differences", S3.
A cross venue taker strategy against a stale GroveX quote falls inside that wording.

## 2. Quick answer

GroveX lists no perpetual, so the numbers below are spot.

| product | VIP 0 maker | VIP 0 taker | markets | source |
|---|---|---|---|---|
| spot, default rate | 0.80 %, 8,000 ppm | 0.80 %, 8,000 ppm | 423 of the 433 listed markets, `BTCUSDT` among them | S1, S2, P1 |
| spot, reduced rate | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | 9 markets: `RCONUSDT`, `PEPONKUSDT`, `GIGATROLLUSDT`, `ANSEMUSDT`, `ZIGCAUD`, `PRTSUSDT`, `TIGRINOUSDT`, `UNIVERSEUSDT`, `OISHIIUSDT` | S1 |
| spot, `AUDUSDT` | 1.00 %, 10,000 ppm | 1.00 %, 10,000 ppm | 1 market | S1 |

The fee page at `https://www.grovex.io/fees` loads `https://www.grovex.io/api/fees/public`, which returned 821 rows of `{"symbol", "maker", "taker"}` on 2026-09-23 03:08 UTC, with `"maker":0.008,"taker":0.008` for `BTCUSDT`, S1.
The 433 listed markets are all among the 821 rows.
The page script formats each number as `(100*e)` followed by `%`, under the heading "Current GroveX VIP 0 maker and taker rates by market.", so the page shows 0.80 % for `BTCUSDT`, S2.
The same number is `quoteFeeRate` in the web app's market configuration at `https://webapi.grovex.io/common/market`, and it equalled the fee page taker on 433 of 433 markets, P1.
Every one of those markets also carries `"openQuoteFee":0`, whose meaning is Not publicly specified.

Two other sources disagree.
CoinGecko's exchange description says GroveX has "the lowest trading fees in the industry, pegged at just 0.1%", S7.
A third-party review says the spot fee is 0.1 %, with promotions down to 0.001 %, S9.
No official page states 0.1 %, and the fee actually charged cannot be read without an account, so the 0.80 % of the official fee page is the number of record and the 0.1 % stays an open question.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual futures | absent | `https://www.grovex.io/futures` reads "Futures trading is coming soon." and "Futures trading is not active yet, and no futures orders can be placed from this page until the product is officially enabled.", S2 |
| dated futures | absent | same page, and the About page says "GroveX does not currently offer futures trading or margin trading.", S2 |
| options | absent | no page, no API and no market names one |
| margin | absent | About page, and `is_open_lever` is 0 on 433 of 433 markets in the web app configuration, P1 |
| spot | present | 433 markets from `/open/api/common/symbols`: 387 USDT, 16 USDC, 11 FDUSD, 11 USD1, 3 MUSDT, 2 AUD, 2 ETH, 1 SOL, P1 |

The fee page has a Futures tab that reads "GroveX Futures fee information will appear here when the production futures fee schedule is available.", S2.
Certificate transparency lists `futuresopenapi.grovex.io` and `futuresadmin.grovex.io`, on certificates valid from 2025-05-29 to 2025-08-27 and not renewed, S8.
`futuresopenapi.grovex.io` has no address record on 2026-09-23 UTC, P1.
CoinGecko's derivatives exchange list of 214 venues does not include GroveX, S7.

## 4. Spot tiers

No tier table is published.
The fee page's VIP tab reads "VIP pricing is account-specific. Sign in to view the fee level currently assigned to your GroveX account.", S2.
The per market VIP 0 rates of section 2 are the whole public schedule.
The Institutional and Market Maker pages name no rate, S2.

## 5. Discounts that change the spot taker

| discount | published terms | source |
|---|---|---|
| platform coin | the order call takes `fee_is_user_exchange_coin`, documented as "(Redundant fields, ignored) 0, When the exchange has the platform currency, this parameter indicates whether to use the platform currency to pay the handling fee", and no discount rate is published | S5 |
| VIP | account specific, not published | S2 |
| referral, rewards, market maker | pages exist, and none states a fee rate | S2 |
| zero fee promotion | none found on the site | S2 |

## 6. Funding as a cost

None.
GroveX lists no perpetual, so it charges no funding and publishes no index, mark or funding rate, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
The Risk Disclosure says a market may be suspended, restricted or delisted, and that delisting "may require users to trade or withdraw within specified timeframes", S4.
The Terms of Service say an account inactive for 12 months may be treated as dormant and charged a dormant fee "after reasonable notice (as published)", section 22 of S3.
Deposit and withdrawal fees are published per asset and network in the `withdrawals` array of `https://www.grovex.io/api/fees/public`, 765 rows on 2026-09-23 UTC, S1.

## 8. CCXT

There is no GroveX class in CCXT.

| check | result | source |
|---|---|---|
| `require('ccxt').exchanges` in `server/`, CCXT 4.5.68 | 104 ids, none matching `grov` | P1 |
| `server/node_modules/ccxt/js/src/` | no file matching `grov` | P1 |
| CCXT master `ts/src` on GitHub, HEAD `1d8b674434fde39ef282988b066812adf8d19b9e` on 2026-09-23 UTC | 112 entries, none matching `grov` | S10 |
| CCXT master `ts/src/pro` | 78 entries, none matching `grov` | S10 |
| GitHub issue search for `grovex` in `ccxt/ccxt` | 0 results | S10 |

So `market.taker` has no value to report, and a GroveX connector would need its own catalog code.

## 9. Recommended registry values

None.
GroveX has no perpetual and no CCXT class, so it cannot join the engine as a perpetual leg.
If a spot study ever uses it, the VIP 0 taker of record is 8,000 ppm on `BTCUSDT`, from S1 and S2, and `ccxtTakerPpm` has no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GroveX public fee JSON | https://www.grovex.io/api/fees/public | 2026-09-23 03:08 UTC, and again at 03:41 UTC with the same counts | GroveX, global | per market maker and taker, withdrawal rows, sections 2 and 7 |
| S2 | GroveX web pages: Fees, Futures, About, Institutional, Market Maker, Referrals, Rewards, and the fee page script `/_next/static/chunks/app/fees/page-a5663b2632b180c5.js` | https://www.grovex.io/fees, https://www.grovex.io/futures, https://www.grovex.io/about | 2026-09-23 UTC | GroveX, global | fee formatting and VIP text, futures status, sections 2 to 5 |
| S3 | GroveX Terms of Service and Terms and Conditions | https://www.grovex.io/legal/terms, https://www.grovex.io/legal/terms-and-conditions | 2026-09-23 UTC | GroveX, global | excluded regions, US persons, prohibited conduct, dormant fee, governing law, section 1 and 7 |
| S4 | GroveX Risk Disclosure | https://www.grovex.io/legal/risk-disclosure | 2026-09-23 UTC | GroveX, global | delisting, section 7 |
| S5 | GroveX official API document | https://github.com/GroveXchange/grovexfile/blob/main/api_doc_en.md | 2026-09-23 UTC | GroveX, global | `fee_is_user_exchange_coin`, operator name on GitHub, sections 1 and 5 |
| S6 | Australian Business Register, ABN 13 667 226 459 | https://abr.business.gov.au/ABN/View?abn=13667226459 | 2026-09-23 UTC | Australia | operator, section 1 |
| S7 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/grovex, https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 UTC | CoinGecko | trust rank 36, the 0.1 % claim, no derivatives listing, sections 2 and 3 |
| S8 | crt.sh certificate search for `%.grovex.io` | https://crt.sh/?q=%25.grovex.io | 2026-09-23 UTC | certificate transparency | futures host names and dates, section 3 |
| S9 | Plisio, "Grovex Review: Legit Exchange or Yellow-Flag Risk?" | https://plisio.net/education/grovex-review | 2026-09-22, search result summary | third party | AUSTRAC claim, 0.1 % claim, sections 1 and 2 |
| S10 | CCXT repository on GitHub | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | no GroveX class in master, section 8 |
| P1 | `rest-probe.mjs latency`, `catalog`, `book`, `mirror` and `poll`, and one-off curl reads of the fee JSON, the web app market configuration and DNS | [`rest-probe.mjs`](../../../scripts/probes/venues/grovex/rest-probe.mjs) | 2026-09-23 03:06 to 03:37 UTC | this host | catalog counts, `quoteFeeRate`, margin flags, CCXT list, sections 1 to 3 and 8 |
| P2 | `ws-probe.mjs book`, `req`, `batch`, `silence` and `deflate` | [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs) | 2026-09-23 03:17 to 03:34 UTC | this host | socket access, section 1 |
