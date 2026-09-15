# Gemini Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

## 1. Scope and freshness

This profile covers the fees that reach a perpetual to perpetual taker cross on Gemini.
Every number was read on 2026-09-15, and the second pass reread every source and reran both probes between 18:59 and 19:12 UTC that day.
The fee schedule page carries the date September 1, 2026 [S1].

| Label | Meaning |
| --- | --- |
| Published | Gemini publishes a current numeric rate or formula. |
| Dynamic | The value is computed by Gemini at request time. |
| Account-gated | The value needs an eligible authenticated account. |
| Negotiated | The value depends on a separate agreement. |
| Region-specific | The value applies only to a named entity or region. |
| Not offered | Gemini does not list the product. |
| Not publicly specified | No official public number was found. |
| Probed | [`gemini-venue-probe.mjs`](../../../scripts/probes/gemini-venue-probe.mjs) or [`gemini-ws-probe.mjs`](../../../scripts/probes/gemini-ws-probe.mjs) observed it from this host on 2026-09-15. |

Two Gemini entities have offered perpetuals.

| Entity | Jurisdiction and regulator | Customers | Settlement asset | Evidence |
| --- | --- | --- | --- | --- |
| Gemini Artemis Pte. Ltd. | Singapore company, not licensed or regulated by the Monetary Authority of Singapore for these products | Non EU and EEA customers in select jurisdictions | GUSD | [S12], [S13], [S17], [S3] |
| Gemini Intergalactic EU Artemis, Ltd. | Malta company C110965, MFSA Class 2 Investment Firm | EU and EEA customers | USDC | [S14], [S15], [S3] |

Who may trade, per the eligibility article updated 2026-08-05 [S5]:

- Non EU and EEA countries: Argentina, Brazil, Chile, Indonesia, Malaysia, New Zealand, Saudi Arabia, Singapore, South Africa, South Korea, Switzerland, Taiwan, Thailand, Vietnam.
- Brazil and New Zealand are institutional clients only.
- The same article still lists 30 EU and EEA countries.
- A trader must not be physically located in the United States or be a U.S. Person under the CFTC definition [S5].
- The Artemis agreement also requires the user not to be, or be owned or controlled by, a U.S. Person [S13] clause 21.1(c).
- The eligibility article also requires access through an ActiveTrader account [S5].
- So an operator on this development host, which sits in the United States, may not trade the perpetuals.

The EU and EEA row conflicts with a later notice.
Gemini announced that it closes customer accounts in the United Kingdom, the EU and Australia, with UK and EU accounts in withdrawal-only mode from 5 March 2026 and all assets to be withdrawn ahead of 6 April 2026 [S6].
The eligibility article updated on 2026-08-05 still lists the EU and EEA countries [S5].
The USDC perpetuals are still listed with status `open` on the public REST catalog (Probed).
Whether any EU or EEA customer can still open a USDC perpetual position is Not verified.

Excluded regions stated in official material: the United States and U.S. Persons [S5] [S13], the United Kingdom and Australia after the closure [S6], and sanctioned persons and jurisdictions [S13] clause 3.1(g).

Deposit, withdrawal, card and custody fees are out of scope.
The official lookups are the Transfer Fee Schedule and the Custody Fee Schedule named in [S19].

## 2. Quick answer

| Perpetual family | VIP 0 maker | VIP 0 taker | Label |
| --- | --- | --- | --- |
| GUSD settled linear (Gemini Artemis Pte. Ltd.) | 0.02 % = 200 ppm | 0.07 % = 700 ppm | Published [S1] |
| USDC settled linear (EU and EEA entity) | 0.02 % = 200 ppm | 0.07 % = 700 ppm | Published [S1], Region-specific, see section 1 for the closure |

The fee schedule publishes one Derivatives table and does not split it by settlement asset or entity [S1].
The support article says fees are charged in GUSD for non EU and EEA customers and in USDC for EU and EEA customers [S3].
The schedule itself says "Derivatives fees are charged in GUSD" [S1].

## 3. Coverage matrix

| Product | State | Evidence |
| --- | --- | --- |
| GUSD settled linear perpetuals | Present, 7 contracts: AVAX, BTC, ETH, HYPE, SOL, TRUMP, XRP | Probed `/v1/symbols` and `/v1/symbols/details`, [S10] |
| USDC settled linear perpetuals | Listed, 6 contracts on the wire: AVAX, BTC, ETH, HYPE, SOL, XRP, for EU and EEA customers. [S10] lists only five and omits AVAX. | Probed, [S10], [S6] |
| USDT settled perpetuals | Not offered, no USDT perpetual in the catalog | Probed |
| Coin margined or inverse perpetuals | Not offered, no inverse contract in the catalog | Probed, the REST schema allows `contract_type: inverse` [S20] |
| Dated futures | Not offered | [S11] |
| Options | Not offered | [S11] |
| Spot | Present, 331 spot markets in CCXT, fees on the same schedule [S1] | Probed |
| Prediction markets | Present, out of scope | [S20] |

The GUSD and USDC contract on one base share one order book on the wire, see [`rest.md`](./rest.md) section 2.

## 4. Perpetual tiers

The Derivatives table of the ActiveTrader Fee Schedule [S1], dated September 1, 2026.

| Volume | Maker | Taker |
| --- | --- | --- |
| ≥ $100,000,000 | -0.01 % = -100 ppm | 0.03 % = 300 ppm |
| ≥ $50,000,000 | -0.01 % = -100 ppm | 0.04 % = 400 ppm |
| ≥ $10,000,000 | 0.00 % = 0 ppm | 0.04 % = 400 ppm |
| ≥ $5,000,000 | 0.01 % = 100 ppm | 0.04 % = 400 ppm |
| ≥ $50,000 | 0.02 % = 200 ppm | 0.05 % = 500 ppm |
| ≥ $10,000 | 0.02 % = 200 ppm | 0.06 % = 600 ppm |
| $0 | 0.02 % = 200 ppm | 0.07 % = 700 ppm |

The table has no row between $50,000 and $5,000,000, as published.
A negative maker fee is a rebate [S1] [S18].

Qualification rule, as the two official sources state it:

- The schedule says a fee tier is based on total trailing 30-day trading volume across all order books, excluding stablecoin pairs, or on total asset balance in USD, and that tiers are recalculated daily at about 02:00 UTC [S1].
- The Derivatives table has only a Volume column and no asset balance column [S1].
- The support article says the perpetual fee depends on "your volume traded on the Gemini Perps sub account" [S3].
- The two statements differ on which volume counts, and which one Gemini applies to perpetuals is Not publicly specified.

Label: Published.

## 5. Discounts

| Discount | Effect on the perpetual taker | Label and evidence |
| --- | --- | --- |
| Token holding | None found | Not publicly specified, the schedule lists none [S1] |
| Referral | A one-off crypto reward on a referee's first trades, not a fee rate | [S21] |
| Market maker or other side letter | The Artemis agreement allows separately negotiated fee and funding terms | Negotiated, [S13] clause 36.1 |
| Promotions | No perpetual fee promotion found | See below |

Promotions were searched three ways.
The public `/v1/feepromos` endpoint, whose documented example named `BTCGUSDPERP`, was removed from the documentation on 2026-09-10 [S16] and answered 404 `EndpointNotFound` in both runs (Probed).
The downloadable REST specification [S20] still listed it on 2026-09-15.
The support center search for "fee promotion", "zero fee", "promo" and "perpetuals promotion" returned no perpetual fee promotion.
The fee schedule carries no promotion line [S1].
So no promotion is recorded, and none has an end date.

## 6. Funding as a cost

| Item | Value | Label and evidence |
| --- | --- | --- |
| Formula | Funding Amount = TWAP(Perpetual Price minus Spot Price) / 24 | Published [S7] |
| Perpetual Price | Median(best bid, best ask, last) of the perpetual order book, each minute of the 60 minute period | Published [S7] |
| Spot Price | Median(best bid, best ask, last) of "the Spot order book", each minute | Published [S7], the article does not name which spot book |
| TWAP | Average of open, high, low and close differences per 1 minute bar, then the average of the 60 bars | Published [S7] |
| Interest component | None in the published formula | Published [S7] |
| Cap and floor | Not publicly specified | Searched [S7], [S8], [S13] and the support center for "cap" and "clamp" |
| Interval | Hourly, the period runs from the first minute to the end of the last minute of the hour | Published [S8] |
| Interval in use | 60 minutes on all 13 contracts | Probed, `nextFundingTimestamp` minus `fundingTimestampMilliSecs` and `funding_interval_in_minutes` |
| Unit | An absolute amount in the settlement asset for a long position of 1 contract | Published [S7], schema [S20] |
| Contract | 1 unit of the base asset | Probed, `open_interest` times mark equals `open_interest_notional` on all 13 in the second pass |
| Direction | A positive amount means longs pay shorts, a negative amount means shorts pay longs | Published [S7], [S13] clause 11.3 |
| Settled against the estimate | The amount settled at 19:00 UTC on BTC was 5.96835, while the last estimate one second earlier was 6.00522 | Probed, see [`rest.md`](./rest.md) section 4.4 |
| Who is charged | Only positions held at the Funding Timestamp | Published [S13] clauses 11.6 and 11.8 |
| Paid in | GUSD for non EU and EEA customers, USDC for EU and EEA customers | Published [S8] |
| Funding fee | The company may charge a fee for determining and paying funding, amount not stated | Not publicly specified, [S13] clause 11.9 |
| Changes | The company may change timestamps, rate and methodology without prior notice | Published [S13] clause 11.7 |

A worked number from the probe.
At 07:20 UTC the upcoming BTC amount was 7.90688 GUSD per BTC against a mark of 77,302.223, which is 0.0102 % = 102 ppm per hour (Probed).
For the modelled trade, which crosses no settlement, funding costs nothing.

## 7. Liquidation, settlement and delisting charges

| Charge | Value | Label and evidence |
| --- | --- | --- |
| Liquidation fee | 0.5 % = 5,000 ppm on executed liquidation orders, with no other trading fee | Published [S1], [S9] |
| Insurance fund and auto-deleveraging | Positions pass to the insurance fund at the Zero Price, then auto-deleveraging | Published [S9] |
| Expiry settlement | None, perpetuals do not expire | Published [S11] |
| Negative balance fee | GUSD, maximum negative balance $5,000, threshold $200, 0.0175 % = 175 ppm per 12 hours | Published [S1] |
| Delisting charge | Not publicly specified | Searched [S1] and [S13] |

## 8. CCXT

CCXT 4.5.68 reads no fee from any public Gemini call.

- `fees.trading` is `taker: 0.004` and `maker: 0.002` at `server/node_modules/ccxt/js/src/gemini.js:228` and `:229`.
- `setMarkets` merges `fees.trading` into every market at `server/node_modules/ccxt/js/src/base/Exchange.js:3735`.
- The probe read `taker: 0.004` and `maker: 0.002` on all 13 active swaps, in both runs (Probed).
- 0.004 is 0.40 % = 4,000 ppm, and it matches no taker row of the schedule dated September 1, 2026 [S1].
- `fetchTradingFees` at `gemini.js:1236` to `:1288` is the only real fee read, and it calls the private `POST /v1/notionalvolume` at `:1240`, so it needs credentials.

## 9. Recommended registry values

These are recommendations for a later design, not decisions.

```text
takerPpm: 700
ccxtTakerPpm: 4000
```

`takerPpm: 700` is the published $0 tier taker of the Derivatives table [S1], the base retail tier the engine models.
`ccxtTakerPpm: 4000` declares the constant at `gemini.js:228`, so the connector does not warn on every market.
A registry comment should say the 0.004 literal matches no current Gemini taker rate and is not a perpetual rate.

## 10. Source ledger

Support center articles returned HTTP 403 to plain fetches from this host.
Their text was read through Gemini's own help center API at `https://support.gemini.com/api/v2/help_center/en-us/articles/<id>.json`, which serves the same article body.

| Id | Title | URL | Retrieved | Entity or region | Sections supported |
| --- | --- | --- | --- | --- | --- |
| S1 | ActiveTrader Fee Schedule, dated September 1, 2026 | https://www.gemini.com/fees/activetrader-fee-schedule | 2026-09-15 | Gemini, global site | 2, 4, 5, 7, 8, 9 |
| S2 | Derivatives Fee Schedule link, 307 redirect to S1 | https://www.gemini.com/fees/derivative-fees-table | 2026-09-15 | Gemini | 2, 4 |
| S3 | What are the fees for trading perpetuals? What is the difference between a maker fee vs. a taker fee? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12087020520987-What-are-the-fees-for-trading-perpetuals-What-is-the-difference-between-a-maker-fee-vs-a-taker-fee | 2026-09-15 | Non EU and EU perpetuals | 1, 2, 4 |
| S4 | What are the fees for trading perpetuals? (updated 2026-01-21), points to S2 | https://support.gemini.com/hc/en-us/articles/14829617786139-What-are-the-fees-for-trading-perpetuals | 2026-09-15 | Perpetuals | 2 |
| S5 | What are the eligibility requirements for trading perpetuals? (updated 2026-08-05) | https://support.gemini.com/hc/en-us/articles/12086543664283-What-are-the-eligibility-requirements-for-trading-perpetuals | 2026-09-15 | Gemini Derivatives | 1 |
| S6 | Gemini closing accounts in the UK, EU, and Australia (updated 2026-05-07) | https://support.gemini.com/hc/en-us/articles/46255474469275-Gemini-closing-accounts-in-the-UK-EU-and-Australia-Everything-you-need-to-know | 2026-09-15 | UK, EEA, Australia | 1, 3 |
| S7 | How is the Funding Amount calculated? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12087062625051-How-is-the-Funding-Amount-calculated | 2026-09-15 | Perpetuals | 6 |
| S8 | How does the funding mechanism work? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12086999190683-How-does-the-funding-mechanism-work | 2026-09-15 | Perpetuals | 6 |
| S9 | What is the liquidation process for perpetuals? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12087066283803-What-is-the-liquidation-process-for-perpetuals | 2026-09-15 | Perpetuals | 7 |
| S10 | What derivatives contracts are available for trading? (updated 2026-04-16) | https://support.gemini.com/hc/en-us/articles/12086882792219-What-derivatives-contracts-are-available-for-trading | 2026-09-15 | Non EU and EU perpetuals | 3 |
| S11 | Does Gemini offer dated futures contracts and options contracts? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12087160465051-Does-Gemini-offer-dated-futures-contracts-and-options-contracts | 2026-09-15 | Gemini Derivatives | 3, 7 |
| S12 | Gemini Crypto Perpetuals | https://www.gemini.com/perpetuals | 2026-09-15 | Gemini Artemis Pte. Ltd. | 1 |
| S13 | Gemini Artemis User Agreement | https://www.gemini.com/artemis/legal/user-agreement | 2026-09-15 | Gemini Artemis Pte. Ltd., Singapore | 1, 5, 6, 7 |
| S14 | Gemini Intergalactic EU Artemis Derivatives User Agreement | https://www.gemini.com/legal/gemini-intergalactic-europe-artemis | 2026-09-15 | Gemini Intergalactic EU Artemis, Ltd., Malta | 1 |
| S15 | Gemini Launches Staking and Derivatives for EU Customers (2025-09-05) | https://www.gemini.com/blog/gemini-launches-staking-and-derivatives-for-eu-customers | 2026-09-15 | EU and EEA | 1 |
| S16 | Revision History | https://developer.gemini.com/changelog/revision-history.md | 2026-09-15 | Gemini API | 5 |
| S17 | Gemini Artemis Risk Disclosure Statement | https://www.gemini.com/artemis/legal/risk-disclosure | 2026-09-15 | Gemini Artemis Pte. Ltd. | 1 |
| S18 | What does a negative maker fee mean? (updated 2026-01-21) | https://support.gemini.com/hc/en-us/articles/12087022656027-What-does-a-negative-maker-fee-mean | 2026-09-15 | Perpetuals | 4 |
| S19 | What are your trading fees? (updated 2026-07-20) | https://support.gemini.com/hc/en-us/articles/115004709906-What-are-your-trading-fees | 2026-09-15 | Gemini | 1 |
| S20 | REST OpenAPI specification | https://developer.gemini.com/specs/openapi/rest.yaml | 2026-09-15 | Gemini API | 3, 6 |
| S21 | What do I need to know about Gemini's referral program? (updated 2026-08-17) | https://support.gemini.com/hc/en-us/articles/360032480112-What-do-I-need-to-know-about-Gemini-s-referral-program | 2026-09-15 | Gemini | 5 |
