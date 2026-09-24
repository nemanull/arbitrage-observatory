# NBX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:40 to 05:10 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that Cloudflare places in Canada (`loc=CA`, edges `YVR` and `SEA`).

This profile covers the fees of NBX, the Norwegian Block Exchange, which CCXT does not list.
NBX lists no perpetual, dated future or option, so the survey plan's template change 1 applies and this profile records the spot market.
The public API refused every request from this host, see [`rest.md`](./rest.md) section 1, so nothing here was read from the venue's own API.
The fee schedule comes from the NBX help center and the market maker terms on nbx.com, both of which this host could read.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22, help center fee article last edited 2026-09-03T06:58:00Z | S1 |
| operator | Norwegian Block Exchange AS, registration no. 920 245 676, Arnstein Arnebergs Vei 30, 1366 Lysaker, Norway | S3 |
| regulator | registered with Finanstilsynet under the Norwegian framework for virtual currency exchange and custody, and "has applied for authorisation as a crypto-asset service provider under MiCA" | S3 |
| who may trade | registered customers aged 18 or over who complete KYC and AML checks | S3, S5 |
| countries | "clients from 190 countries around the world can start trading after successful identity verification" | S6 |
| extra checks | 84 countries listed as high-risk or sanctioned get a closer document check, among them Belarus, China, Cuba and Bulgaria | S6 |
| United States | not on the high-risk list and not excluded by name in the terms or the operating rules, so US persons are not visibly barred | S3, S5, S6 |
| Canada | not on the high-risk list and not excluded by name | S6 |
| caveat | "you may not be able to access the marketplace / site from outside the country in which you established the account" | S3 |

The operating rules say "Access is limited to jurisdictions where NBX offers its services", and no page read here lists those jurisdictions, S5.

## 2. Quick answer

NBX has no perpetuals.
The researched product is spot.

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, standard customer | 0.70 %, 7,000 ppm | 0.70 %, 7,000 ppm | S1, S4 |
| spot, qualified market maker | 0.20 %, 2,000 ppm | 0.20 %, 2,000 ppm | S1, S4 |
| recurring order (DCA), any customer | | 0.70 %, 7,000 ppm | S1 |
| card or Vipps purchase | | 0.70 % trading fee plus a 4.5 % commission | S1 |

The schedule is one flat rate for every customer who is not a qualified market maker.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no contract in the API catalog of 2025-06-07, none on CoinGecko on 2026-09-22, no derivatives endpoint in the API spec, S2, S7, S8 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| spot | present | 41 markets in the archived catalog of 2025-06-07, and 21 tickers on CoinGecko on 2026-09-22, see [`rest.md`](./rest.md) section 2 |

Spot quotes are fiat and one e-money token: NOK, SEK, DKK and EUR, and USDM, which NBX issues, S7, S8, S9.
The archived catalog also held `BTC-USDC`, `ETH-USDC` and `ETH-BTC`, all three `disabled` on 2025-06-07, S7.
CoinGecko showed no USDT or USDC quoted market on 2026-09-22, only `USDC-NOK` with USDC as the base, S8.

### Order book or broker

A help center article edited on 2026-06-27 says most NBX markets no longer have a customer order book, S10.
The article says "For most markets, you could previously place your own limit orders (orders where you set the price yourself) through advanced trading."
It goes on "This has now been phased out for those markets."
It names the exceptions in "A small number of specialised markets still keep the order book and advanced trading, such as VT, GNRC, PALM, FGLD and FSLVR."
On the other markets a customer trades at "the best available price" and pays a "brokerage fee" of "0.7% per trade", which the article says is unchanged, S10.
QuickBuy is described in the terms as "an off-venue trading service where NBX acts as principal and counterparty to the customer", S3.
So on BTC, ETH and every other market outside that list the app shows no order book, and the 0.70 % is called a brokerage fee.
CoinGecko still reported a bid and ask spread of 1.21 % on `BTC-NOK` on 2026-09-22, so some book still reaches a public feed, and its depth is Not verified, S8.

## 4. Spot tiers

There are no volume tiers.

| participant | maker | taker | qualification |
|---|---|---|---|
| standard customers | 0.70 % | 0.70 % | "Standard flat rate", S4 |
| qualified market makers | 0.20 % | 0.20 % | the criteria below, assessed monthly, S4 |

### Qualification

The market maker rate applies only on markets NBX designates as eligible, and only while every criterion holds, S4.

- At least NOK 10,000,000 of executed volume per month, unless NBX publishes a lower threshold for a market.
- Two-sided quotes present for at least 50 % of the time the market is open.
- Quoted spreads that do not persistently exceed 2.00 % on BTC/NOK and ETH/NOK, 3.00 % on other liquid assets, and 5.00 % on less liquid or new assets.
- Qualifying orders of at least NOK 5,000 on BTC/NOK and ETH/NOK, and NOK 2,500 on other eligible markets.

A participant who stops qualifying pays the standard rate "from the next applicable fee period", S4.

## 5. Discounts that change the taker

| discount | effect on the taker | source |
|---|---|---|
| token holding | none, NBX has no fee token | S1, S4 |
| referral | none for the trader, the referrer receives "20% from fees they pay during the first year", and a referred user gets a 75 NOK welcome bonus in BTC | S11 |
| market maker | 0.20 % while qualified, section 4 | S4 |
| zero fee promotion | none found | S1 |

The market maker terms say "No individual discounts, rebates, kickbacks, exclusivity arrangements or unpublished fee incentives are provided under the MM Program.", S4.

## 6. Funding as a cost

Not applicable.
NBX lists no perpetual, so there is no funding rate, interval, cap or settlement.

## 7. Liquidation, settlement and delisting charges

There is no margin or liquidation on NBX.
A disabled market cancels every open order automatically, and neither new orders nor cancels are accepted, S2.
A market can also be in cancel-only mode during maintenance, where "If you try to place an order, it will be immediately cancelled (closed).", S2.
In that mode "No orders will be filled.", S2.
Deposits, withdrawals and card fees are listed in the help center article, S1, and are out of scope here.

## 8. CCXT

CCXT 4.5.68 has no NBX class.
`node -e "console.log(require('ccxt').exchanges)"` run from `server/` listed 104 ids, and none matched `nbx` or `norw`, in `rest-probe.mjs ccxt`, P1.
The current CCXT master on GitHub, package version 4.5.82, has no NBX class either.
`https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/nbx.ts` answered 404, `exchanges.json` on master holds 105 ids with no `nbx`, and `README.md` on master does not mention NBX, all read on 2026-09-22, S12.
So there is no `market.taker` to report and no CCXT source line to cite.

## 9. Recommended registry values

None.
NBX has no perpetual for the engine to trade, no CCXT class to build a catalog from, and a public API that timed out at the origin for every request from this host.
If a spot leg were ever designed, `takerPpm` would be 7,000 from S1 and S4, and `ccxtTakerPpm` would have no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | What are the fees on NBX? | https://nbxsupport.zendesk.com/hc/en-us/articles/360025617132-What-are-the-fees-on-NBX | 2026-09-22, edited 2026-09-03 | Norwegian Block Exchange AS | standard and market maker rates, DCA and card fees, sections 2, 4, 5 and 7 |
| S2 | NBX Public API 1.0.0, Redoc spec in `main.b707d6c60c5d57ab49d3.js`, identical to the Wayback capture of 2025-12-14 except one private call's description | https://app.nbx.com/developers | 2026-09-23 04:57 UTC, read with Node's fetch | NBX, global | the endpoint list, disabled and cancel-only markets, sections 3 and 7 |
| S3 | Terms of Service, updated 8 May 2026 | https://nbx.com/en/terms-of-service | 2026-09-22 | Norwegian Block Exchange AS | operator, regulator, age, access caveat, QuickBuy as principal, sections 1 and 3 |
| S4 | Market Maker Program Terms (including Fees & Qualification Criteria), version 1.1, effective 20 May 2026 | https://nbx.com/en/mmpt | 2026-09-22 | Norwegian Block Exchange AS | the fee table and the qualification criteria, sections 2, 4 and 5 |
| S5 | Trading Platform Operating Rules, version 1.4, effective 8 May 2026 | https://nbx.com/en/tpor | 2026-09-22 | Norwegian Block Exchange AS | eligibility and refusal criteria, section 1 |
| S6 | Is NBX available in my country? | https://nbxsupport.zendesk.com/hc/en-us/articles/360047722852-Is-NBX-available-in-my-country | 2026-09-22, updated 2026-03-19 | Norwegian Block Exchange AS | 190 countries, the 84 country high-risk list, section 1 |
| S7 | `GET /markets`, Wayback capture of 2025-06-07 | https://web.archive.org/web/20250607220157/https://api.nbx.com/markets | 2026-09-22 | NBX | 41 spot markets, section 3 |
| S8 | CoinGecko exchange record `nbx` | https://api.coingecko.com/api/v3/exchanges/nbx | 2026-09-22 | CoinGecko | 21 spot tickers, trust rank, section 3 |
| S9 | What is USDM | https://nbx.com/en/whatisusdm | 2026-09-22 | NBX and Moneta | USDM is a USD e-money token issued by NBX and Moneta on Cardano, section 3 |
| S10 | How the new trading experience works on NBX | https://nbxsupport.zendesk.com/hc/en-us/articles/48140417422481-How-the-new-trading-experience-works-on-NBX | 2026-09-22, edited 2026-06-27 | Norwegian Block Exchange AS | order book phased out on most markets, brokerage fee, section 3 |
| S11 | NBX Referral Program description | https://nbxsupport.zendesk.com/hc/en-us/articles/4402057183508-NBX-Referral-Program-description | 2026-09-22, updated 2026-07-31 | Norwegian Block Exchange AS | fee sharing and welcome bonus, section 5 |
| S12 | CCXT master `exchanges.json`, `README.md` and `ts/src/nbx.ts` | https://github.com/ccxt/ccxt | 2026-09-22 | CCXT | no NBX class on master, section 8 |
| P1 | `rest-probe.mjs ccxt` | [`rest-probe.mjs`](../../../scripts/probes/venues/nbx/rest-probe.mjs) | 2026-09-22 | this host | no NBX id in CCXT 4.5.68, section 8 |
