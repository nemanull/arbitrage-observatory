# Bitbegin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:40 to 05:10 UTC on 2026-09-23, from the development host near Seattle through its Canadian VPN exit.

This profile covers Bitbegin, the exchange at `www.bitbegin.io`, which CCXT does not implement.
The venue lists no perpetuals, so it is profiled on its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Bitbegin publishes no fee page, no API documentation and no public market data API, so most of this file records what was checked and found missing.
The probes are [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitbegin/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | |
| brand and entity | "Bitbegin Exchange British Capital LLC" in the header of every legal page | S1, S2 |
| registration | "registered in Georgia as a British Capital LLC established in 2007 with the National Bank of Georgia license as a Financial company Register Number:200232907", from CoinGecko's description, not from a venue page | S4 |
| country and year | CoinGecko API `country` `"Georgia"`, `year_established` 2018. The homepage says "2018 Exchange active" and "2007 British Capital" | S1, S4 |
| CoinGecko standing | trust score 2 of 10, `trust_score_rank` 166 in the API on 2026-09-22, where the survey's list had it at 157, 12 pairs and 29.35 BTC of 24 h volume | S3, S4 |
| who may trade | the Terms say "Users must be legally permitted to use digital asset services in their jurisdiction", and name no excluded region | S2 |
| excluded regions | no venue page lists any. CoinGecko's description lists Afghanistan, Central African Republic, Congo-Brazzaville, Eritrea, Congo-Kinshasa, Guinea-Bissau, Cuba, Lebanon, Iran, Mali, Iraq, Namibia, Libya, Somalia, North Korea, South Sudan, Syria, Sudan and Yemen | S2, S4 |
| US persons | not excluded by any page read. Neither the venue nor CoinGecko's list names the United States | S2, S4 |
| web domains | `www.bitbegin.io` is the exchange. `www.bitbegin.com` is an unrelated VuePress 1.9.9 blog titled "Post \| bitbegin" | P1 |

Each of the four legal pages carries "This document is provided for platform transparency and should be reviewed by qualified legal counsel before being treated as final production legal advice or a jurisdiction-specific policy.", S2.
The site reads as a white-label exchange build, a Next.js web client over a Laravel API at `api.bitbegin.io`, whose route list also carries ICO, P2P, gift card, staking and futures modules, S6.
The access results in every file of this profile are what a Canadian VPN exit received, since the laptop sends all traffic through a Surfshark WireGuard tunnel whose exit Cloudflare placed at `loc=CA` through its `SEA` or `YVR` edge, P1.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| perpetuals | absent | absent | section 3 |
| spot, VIP 0 | Not publicly specified | 0.1 %, 1,000 ppm, from CoinGecko's single "Fees 0.1%" field | S3 |

No venue page states a trading fee.
The Terms say only "Fees, withdrawal limits, trading limits and supported assets may change from time to time", S2.
The account pages that would show the schedule sit behind sign-in, and the API route that serves the site settings refuses a client without the web client's header, see [`rest.md`](./rest.md) section 6.
CoinGecko shows one number, "Fees 0.1%", with no maker and taker split, S3.
So 1,000 ppm is the best available spot taker, and it is not confirmed by the venue.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | the site settings carry `enable_future_trade` 0, and `/futures/exchange` answers 307 to `/404`, P2 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | no route, no product on the homepage |
| spot | present | 12 pairs on CoinGecko, all quoted in USDT. The landing page data shows 12 pairs, 11 in USDT plus `USDT/ETH`, and lacks `LINK/USDT`, P2 and S4 |

The web client's build manifest does list `/futures/exchange`, `/futures/exchange/[code]` and `/futures/wallet-list`, S6.
Those routes belong to the white-label product, and this deployment has them switched off.
CoinGecko's description claims "Spot and Derivatives trading (USDT perpetual, USDC perps, inverse perps, futures, USDC options, leveraged tokens)", S4.
The venue's own homepage offers "Spot trading", S1, and CoinGecko's derivatives list of 214 venues on 2026-09-22 does not include Bitbegin, S5.
The claim in the description is therefore not borne out by the site.

## 4. Spot tiers

Not publicly specified.
No tier table, volume rule or VIP program is published on any page read, S1 and S2.

## 5. Discounts that change the spot taker

Not publicly specified.
The build manifest has `/user/referral` and `/user/referral-earning-trade/[id]`, S6, but no page states a referral or token discount.
A market maker program is advertised on the homepage and at `market-maker.bitbegin.io`, whose page is an 835 byte single page app shell titled "Market Maker - Bitbegin" with no text, P1.

## 6. Funding as a cost

Not applicable, because Bitbegin lists no perpetuals.

## 7. Liquidation, settlement and delisting charges

Not applicable to spot.
No delisting charge is published.
Deposit and withdrawal schedules are out of scope, and CoinGecko shows "Deposit None" and "Withdrawal BRIT" as its only entries, S3.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `begin`, P2 |
| CCXT master, `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC | 112 entries, no `bitbegin.ts`, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/bitbegin.ts` answers 404, S7 |
| GitHub code and issue search for `bitbegin` in `ccxt/ccxt` | 0 and 0 results, S7 |

So there is no `market.taker` to read, and no CCXT source line exists.

## 9. Recommended registry values

None.
Bitbegin has no perpetual to register, no CCXT class for the catalog, and no public market data interface, see [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).
If a spot leg were ever wanted, `takerPpm` 1,000 is the only published number, and `ccxtTakerPpm` has nothing to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbegin homepage | https://www.bitbegin.io/ | 2026-09-22 | British Capital LLC | "Spot trading", "2018 Exchange active", "2007 British Capital", "API REST + WebSocket", sections 1, 3 and 5 |
| S2 | Terms and Conditions, AML Policy, Privacy Policy, Risk Disclosure | https://www.bitbegin.io/terms-and-conditions, https://www.bitbegin.io/aml-policy, https://www.bitbegin.io/privacy-policy, https://www.bitbegin.io/risk-disclosure | 2026-09-22 | British Capital LLC | eligibility, no region list, fee wording, legal notice, sections 1 and 2 |
| S3 | CoinGecko exchange page | https://www.coingecko.com/en/exchanges/bitbegin | 2026-09-22 | CoinGecko | "Fees 0.1%", "Deposit None", "Withdrawal BRIT", trust score 2/10, sections 2 and 7 |
| S4 | CoinGecko API, exchange detail | https://api.coingecko.com/api/v3/exchanges/bitbegin | 2026-09-22 | CoinGecko | country, year, `trust_score_rank` 166, 12 pairs, description with registration, restricted countries and the derivatives claim, sections 1 and 3 |
| S5 | CoinGecko API, derivatives venues | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | 214 venues, no Bitbegin, section 3 |
| S6 | Web client build manifest | https://www.bitbegin.io/_next/static/JX8hCEZb_I5hxo6OapA8c/_buildManifest.js | 2026-09-22 | Bitbegin | route list with futures and referral pages, sections 3 and 5 |
| S7 | CCXT master source listing and search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Bitbegin class, section 8 |
| P1 | `rest-probe.mjs access`, 04:53 and 05:01 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | DNS, the unrelated `.com` blog, the market maker page, Cloudflare `loc=CA`, sections 1 and 5 |
| P2 | `rest-probe.mjs pages`, 04:54 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbegin/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `enable_future_trade` 0, futures route 307 to `/404`, pair list, CCXT 4.5.68 ids, sections 3 and 8 |
