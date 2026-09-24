# BTC Markets Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:25 to 04:47 UTC for the first pass and 04:53 to 04:57 UTC for the second pass, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers spot trading on BTC Markets (CCXT id `btcmarkets`), because the venue lists no perpetual, see section 3.
It follows change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs), and the probe ledger rows are in [`rest.md`](./rest.md) section 9 and [`websocket.md`](./websocket.md) section 9.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local time, 2026-09-23 UTC | all rows below |
| operator | BTC Markets Pty Ltd, ACN 164 093 887, ABN 45 164 093 887, registered with AUSTRAC as a virtual asset service provider | S2 |
| licence | an authorised representative, AR No. 1297122, of BTCM Payments Limited, ACN 643 241 829, AFSL No. 525840 | S2 |
| terms in force | Terms of Service version 1.1, dated 12:00pm AEST 28 April 2026, governed by the laws of Victoria, Australia | S2 |
| who may trade | an individual of at least 18 or a legal entity, who must "be an Australian resident (except for Approved Overseas Users and Liquidity Providers accepted at our discretion)", and must not be a Restricted Person under sanctions law | S2, clause 4 |
| broker service | "The Broker Services are only available to Australian residents.", where BTC Markets trades as principal | S2, Part C |
| US persons | not named anywhere in the terms. A US person is not an Australian resident, so may trade only if BTC Markets accepts them as an Approved Overseas User or a Liquidity Provider at its discretion | S2 |
| excluded regions | any jurisdiction under comprehensive sanctions administered or enforced by Australia or the UN Security Council, and any jurisdiction where the use would breach applicable law | S2 |
| CoinGecko | trust score 5, trust rank 114 through the API on 2026-09-23 against rank 111 in the survey's listing, established 2013, Australia, 52.34 BTC of 24 h volume on 35 tickers, and absent from the 214 venues of CoinGecko's derivatives exchange list | S5 |

Access from this host, all through the Canadian VPN exit:

| host | reply |
|---|---|
| `https://www.btcmarkets.net/fees`, `/terms-of-service`, `/legal`, `/` | HTTP 403 with a Cloudflare "Just a moment..." challenge and `cf-mitigated: challenge` to `curl` on all four, and on `/fees` also to WebFetch and to one headless Chrome load |
| `https://docs.btcmarkets.net/v3/` | the same 403 challenge, to `curl` and to WebFetch |
| `https://support.btcmarkets.net/` | 302 to `/hc`, then `/hc/en-us` answers the same 403 challenge |
| `https://api.btcmarkets.net/v3/…` | 200 on every public call, see [`rest.md`](./rest.md) section 1 |
| `wss://socket.btcmarkets.net/v2` | 101 on every upgrade, see [`websocket.md`](./websocket.md) section 1 |

The challenge reads as a bot check rather than a geographic refusal, because the API host behind the same Cloudflare zone served this host normally.
The fee schedule and the terms were therefore read from the Internet Archive's copies, S1 and S2, and the live pages of 2026-09-22 could not be compared with them.
The fee schedule copy is dated 2025-12-05, nine months before retrieval, and is the newest the archive's index returned for `btcmarkets.net/fees`.
CCXT's AUD fee agrees with its first tier, 0.85 %, see section 8.

## 2. Quick answer

| product | VIP 0 taker | VIP 0 maker | lowest tier | source |
|---|---|---|---|---|
| spot, AUD and USDT pairs | 0.85 %, 8,500 ppm | 0.85 %, 8,500 ppm | 0.10 %, 1,000 ppm, above AU$5,000,000 of 30 day volume | S1 |
| spot, BTC pairs: ETH-BTC, LTC-BTC, XRP-BTC | 0.20 %, 2,000 ppm | -0.05 %, -500 ppm, a rebate | flat, no tiers | S1 |

The AUD and USDT schedule has one "Trading fee %" column per tier and no maker and taker split, so a maker pays the same as a taker, S1.
"For Australian residents, all fees include GST.", S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | CCXT `'swap': false` at `server/node_modules/ccxt/js/src/btcmarkets.js` line 30, 51 of 51 CCXT markets `spot` and 0 swaps in R1, and no contract market in `GET /v3/markets`. The terms have parts for accounts, the exchange, the broker and OTC, and none for derivatives, S2. CoinGecko lists no derivatives for the venue, S5 |
| dated futures | absent | CCXT `'future': false` at line 31 |
| options | absent | CCXT `'option': false` at line 32 |
| margin | absent | CCXT `'margin': false` at line 29, and no margin clause in the terms, S2 |
| spot | present, 51 markets: 44 quoted in AUD, 4 in USDT and 3 in BTC, 49 `Online` | R1 |
| Simple Trade | present, priced by a spread in the quoted price, with "No additional trading fees" | S1 |
| Broker Services | present, trades with BTC Markets as principal, for Australian residents only | S2, Part C |
| OTC desk | present, for orders of AU$100,000 or more | S3 |
| staking | present, under clause 13 of the terms | S2 |

Deposit and withdrawal fees are listed on the fee page, S1, and are not recorded here.

## 4. Spot tiers

### AUD and USDT pairs

"Exchange trading fees for AUD/USDT pairs are based on a rolling 30-day total of AUD and USDT trading volume, across all trades.", S1.
"Trading volume is calculated every hour.", S1.
"The relevant trading fee is applied when an order is created.", S1.

| tier | rolling 30 day volume, AUD | fee | ppm |
|---:|---|---:|---:|
| 1 | $0.01 to $500 | 0.85 % | 8,500 |
| 2 | $500.01 to $1,000 | 0.83 % | 8,300 |
| 3 | $1,000.01 to $3,000 | 0.80 % | 8,000 |
| 4 | $3,000.01 to $9,000 | 0.75 % | 7,500 |
| 5 | $9,000.01 to $18,000 | 0.70 % | 7,000 |
| 6 | $18,000.01 to $40,000 | 0.65 % | 6,500 |
| 7 | $40,000.01 to $60,000 | 0.60 % | 6,000 |
| 8 | $60,000.01 to $70,000 | 0.55 % | 5,500 |
| 9 | $70,000.01 to $80,000 | 0.50 % | 5,000 |
| 10 | $80,000.01 to $90,000 | 0.45 % | 4,500 |
| 11 | $90,000.01 to $115,000 | 0.40 % | 4,000 |
| 12 | $115,000.01 to $125,000 | 0.35 % | 3,500 |
| 13 | $125,000.01 to $200,000 | 0.30 % | 3,000 |
| 14 | $200,000.01 to $400,000 | 0.25 % | 2,500 |
| 15 | $400,000.01 to $650,000 | 0.23 % | 2,300 |
| 16 | $650,000.01 to $850,000 | 0.20 % | 2,000 |
| 17 | $850,000.01 to $1,000,000 | 0.18 % | 1,800 |
| 18 | $1,000,000.01 to $3,000,000 | 0.15 % | 1,500 |
| 19 | $3,000,000.01 to $5,000,000 | 0.13 % | 1,300 |
| 20 | above $5,000,000 | 0.10 % | 1,000 |

"All trades are converted to AUD to calculate volume.", S1.

### BTC pairs

"Exchange trading fees for BTC pairs ( ETH-BTC, LTC-BTC, XRP-BTC ) use a flat-rate maker & taker fee.", S1.
"These trades do not count towards AUD and USDT trading volume.", S1.
The maker fee is -0.05 % and the taker fee 0.2 %, S1.

### Qualification

The tier follows the rolling 30 day AUD and USDT volume, recalculated every hour and fixed when an order is created, S1.
A VIP program offers "customised fee agreement" levels at AU$500k to AU$1m, AU$1m to AU$5m, and above AU$5m of 30 day volume, reviewed at the end of each month, S3.
Its rates are not published.

## 5. Discounts that change the taker

| discount | exists | detail |
|---|---|---|
| exchange token | none named | the archived fee page names no token discount, S1 |
| referral | Not verified | the live site could not be read, and the archived fee page names none, S1 |
| VIP | yes | customised agreements above AU$500k of 30 day volume, rates unpublished, S3 |
| market maker | Liquidity Providers exist as a class of user under the terms, and their fees are not published | S2 |
| zero fee promotion | none on the archived fee page | S1 |

## 6. Funding as a cost

None.
Spot positions pay no funding, and BTC Markets offers no margin or perpetual on which a funding rate could run.

## 7. Liquidation, settlement and delisting

No liquidation or settlement charge applies to spot.
The terms allow a Dormant Account Fee deducted monthly from the fiat wallet, with the amount in the fee schedule, and on closure of a dormant account BTC Markets may sell its digital assets and pay out the AUD proceeds less fees, S2.
A delisted asset gets at least 30 days' notice before trading stops, except in exceptional circumstances, and a withdrawal deadline at least 30 days after that.
After the deadline BTC Markets may sell the holding "at the best price reasonably obtainable" and credit the proceeds less fees, commissions, spread and costs of sale, S2, clause 14.
No separate delisting charge is published.
Two markets are `Offline` today, MCAU-AUD and RLUSD-AUD.
The MCAU-AUD book is empty, its REST `snapshotId` dates from 2025-06-24, and its socket snapshot carries a `timestamp` of 2026-07-23, see [`rest.md`](./rest.md) section 5 and [`websocket.md`](./websocket.md) section 4.

## 8. CCXT

| market | `market.taker` | `market.maker` | source line |
|---|---:|---:|---|
| BTC/AUD and every AUD market | 0.0085, 8,500 ppm | 0.0085 | `options.fees.AUD` at `server/node_modules/ccxt/js/src/btcmarkets.js` lines 293 to 298, picked by quote at line 515 and set at line 543 |
| BTC/USDT and every USDT market | 0.002, 2,000 ppm | -0.0005 | the exchange default `fees` at lines 286 to 291, since `options.fees` has no USDT entry |
| ETH/BTC and every BTC market | 0.002, 2,000 ppm | -0.0005 | the same default |

R1 and R5 read these values from `loadMarkets` without credentials on 51 of 51 markets.
The AUD value and the BTC pair values match the fee page, S1.
The USDT value does not: the fee page puts USDT pairs on the tiered AUD and USDT schedule, which starts at 0.85 %, and CCXT gives them the flat BTC pair rate of 0.20 %.

## 9. Recommended registry values

None.
BTC Markets lists no swap, so the connector drops all 51 markets at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 202 and skips the venue before a fee is read.
If a later design admits spot legs, the values would be `takerPpm: 8500`, the VIP 0 rate of the AUD and USDT pairs, and `ccxtTakerPpm: 8500`, the constant CCXT reports for AUD markets at `btcmarkets.js` line 296.
The four USDT markets would still report 2,000 ppm from CCXT, so they need the registry override, and the three BTC pairs would need their own flat 2,000 ppm.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTC Markets, Fees, Internet Archive copy of 2025-12-05 06:51 UTC | http://web.archive.org/web/20251205065143/https://www.btcmarkets.net/fees | 2026-09-22 | BTC Markets Pty Ltd, Australia | tiers, BTC pair rates, GST, Simple Trade, sections 2 to 5 |
| S2 | BTC Markets, Terms of Service version 1.1 of 28 April 2026, Internet Archive copy of 2026-05-04 10:21 UTC | http://web.archive.org/web/20260504102139/https://www.btcmarkets.net/terms-of-service | 2026-09-22 | BTC Markets Pty Ltd, Australia | operator, licence, eligibility, sanctions, staking, dormant accounts, sections 1, 3, 5 and 7 |
| S3 | BTC Markets, VIP Program, Internet Archive copy of 2025-08-14 14:14 UTC | http://web.archive.org/web/20250814141408/https://www.btcmarkets.net/vip | 2026-09-22 | BTC Markets Pty Ltd, Australia | VIP levels, OTC threshold, sections 3 to 5 |
| S4 | CCXT 4.5.68 `btcmarkets.js` | `server/node_modules/ccxt/js/src/btcmarkets.js` | 2026-09-22 | CCXT | `has` flags at lines 28 to 32, fees at lines 286 to 298, `parseMarket` at lines 508 to 575 |
| S5 | CoinGecko API, `/api/v3/exchanges/btcmarkets` and `/api/v3/derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/btcmarkets | 2026-09-23 04:47 UTC | CoinGecko | trust score and rank, volume, tickers, derivatives absence |
| S6 | BTC Markets live fee page | https://www.btcmarkets.net/fees | 2026-09-22, refused | BTC Markets | not read: HTTP 403 with a Cloudflare challenge |
| R1 | `rest-probe.mjs catalog` at 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | market counts and CCXT fee values, sections 3 and 8 |
| R5 | `rest-probe.mjs catalog`, second pass at 04:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | the same counts and CCXT values again, sections 3 and 8 |
