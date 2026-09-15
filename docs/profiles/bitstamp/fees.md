# Bitstamp Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

## 1. Scope and freshness

This profile covers the perpetual futures that Bitstamp lists, and nothing else of its fee schedule.
Every source was reread, and the REST and socket probes rerun, in a second pass from 19:20 to 19:25 UTC on 2026-09-15.
Bitstamp is branded "Bitstamp by Robinhood" on every page read on 2026-09-15.
Robinhood Markets, Inc. closed its acquisition of Bitstamp Ltd. on 2025-06-02, per the Bitstamp blog post in the source ledger.

The perpetuals are not offered by the entities that run Bitstamp's spot exchange.
The site footer names Bitstamp Financial Services Ltd. (BFS), Dalmatinova ulica 2, 1000 Ljubljana, Slovenia, as the provider of "investment services with regards to trading in derivatives".
BFS "is authorized and supervised by the Slovenian Securities Market Agency (ATVP) as a MiFiD investment firm", and the derivatives fee schedule is issued in its name.
The launch post says "Bitstamp Europe S.A. is not authorized to provide derivatives trading services", and the site footer says "BFS does not provide crypto-asset services".
The trading information page calls the venue an MTF, and says each MTF trading session is 15 minutes long.

Who may trade them, as published:

| question | answer | evidence label | source |
|---|---|---|---|
| operating entity | Bitstamp Financial Services Ltd., Slovenia, MiFID investment firm under ATVP | Published | footer of every page read, fee schedule |
| intended clients | "eligible EU traders", "institutional and retail investors" | Region-specific | launch post of 2026-04-09 |
| excluded regions | "Derivatives trading is not available to customers in the US, Canada, Japan and some other countries" | Region-specific | site footer |
| full country list | Not publicly specified. The general terms refer to jurisdictions "from which only professional clients are accepted" without naming them | Not publicly specified | general terms and conditions, section 1.17 |
| client categories | retail, professional, eligible counterparty, under a Client Categorisation Policy that is not linked from the pages read | Published | general terms and conditions |
| US persons | excluded | Region-specific | site footer |

A US based operator of this observatory cannot open a BFS derivatives account on this evidence.
Observing the public market data needs no account, and every public endpoint answered from this host, see [`rest.md`](./rest.md) section 1.

Deposit, withdrawal and spot trading fees are out of scope.
The official lookup is the unified fee schedule at `https://www.bitstamp.net/fee-schedule/`, and the SEPA and wire fees that BFS charges are in section 2 of the derivatives fee schedule.

## 2. Quick answer

There is one perpetual family, USD settled linear perpetuals, and one rate card for all 20 contracts.

| role | rate | ppm | who | label |
|---|---:|---:|---|---|
| taker | 0.015 % | 150 | every client, both promotions | Published |
| maker | -0.005 % | -50 | Early Bird, clients who joined after 14 October 2025, as the pricing overview words it | Published |
| maker | -0.01 % | -100 | Super Early Bird, clients who joined before 2025-10-14 | Published |

A negative maker rate is a rebate.
The derivatives fee schedule, last updated 2025-06-11, prints the Early Bird row as its base table: "All derivatives contracts", maker "-0.005% (-0.5 basis points)", taker "0.015% (1.5 basis points)".
The same page carried the banner "Super Early Bird and Early Bird trading fees are currently active" on 2026-09-15, linked to the pricing overview PDF dated October 2025.

The VIP 0 perpetual taker the engine should model is 0.015 %, which is 150 ppm.

## 3. Coverage matrix

Counts are from `GET /api/v2/markets/` and CCXT 4.5.68 on 2026-09-15, the same in the morning and in the second pass, see [`rest.md`](./rest.md) section 2.

| product | present | detail |
|---|---|---|
| USD settled linear perpetual | yes | 20 contracts, `market_type: "PERPETUAL"`, `payoff_type: "Linear"`, `contract_size: "1.00000000"` |
| USDT margined perpetual | no | no market with another counter currency |
| USDC margined perpetual | no | none |
| coin margined perpetual | no | `payoff_type` is `Linear` on all 20 |
| dated futures | no | the catalog carries only `SPOT` and `PERPETUAL` market types |
| options | no | none listed, and CCXT declares `option: false` at `server/node_modules/ccxt/js/src/bitstamp.js` line 35 |
| spot | yes | 257 markets, out of scope |

The 20 perpetuals span four asset classes, per the `asset_class` field and the contract specifications page.

| asset class | contracts |
|---|---|
| CRYPTO | BTC, ETH, XRP, SOL, DOGE, SUI, ADA, LINK, AVAX, HYPE, TAO, ASTER, PAXG |
| COMMODITIES | GOLD, SILVER, WTI, BRENT |
| ETF | QQQ, EWY |
| FX | EUR |

Collateral may be posted in USD, EUR or BTC, with haircuts in cross margin mode, per the trading information page section 2.3.
Maximum leverage is 10x for crypto, QQQ and EUR, and 5x for GOLD, SILVER, EWY, WTI and BRENT, per the contract specifications table.

## 4. Every published perpetual tier

There are no tiers today.

| tier | qualification | maker | taker |
|---|---|---:|---:|
| Super Early Bird | "clients who joined the platform before 14 October 2025" | -0.01 % (-100 ppm) | 0.015 % (150 ppm) |
| Early Bird | "Clients joining after that date", "Until tier-based fee structure implementation" | -0.005 % (-50 ppm) | 0.015 % (150 ppm) |

The fee schedule footnote reads "Current pricing structure is intended to stay in place for an introductory period."
It continues "Bitstamp intends to introduce volume-based rate card in the future."
The pricing overview reads "The Early Bird pricing will remain in effect until Bitstamp introduces a volume-based tiered rate structure".
No end date is published, so both promotions are open-ended until that rate card appears.

The spot unified fee schedule, "Valid from 1 September 2026", is a separate 30 day volume tier table and does not apply to perpetuals.
Trading fees on perpetuals "are charged in the settlement currency of the derivatives contract being traded", which is USD.

## 5. Discounts that change the perpetual taker

| discount | status | label | source |
|---|---|---|---|
| token holding | none published, Bitstamp has no exchange token in the schedules read | Not publicly specified | derivatives fee schedule |
| referral | none found for derivatives | Not publicly specified | derivatives fee schedule, pricing overview |
| market maker programme | none published for derivatives | Not publicly specified | derivatives fee schedule |
| negotiated schedules | "we reserve the right to offer negotiated fee schedules, discounts, or other incentives to certain customers" | Negotiated | derivatives fee schedule section 4 |
| zero or reduced fee promotions | the two Early Bird rows above change the maker only, the taker is 0.015 % in both | Published | pricing overview, October 2025 |

The spot schedule advertises a "FastPass" offer for traders above $500k.
It is a spot offer and nothing on the derivatives pages ties it to perpetuals.

## 6. Funding as a cost

The fee schedule section 1.3 says funding payments "are not categorized as costs or fees", and "Bitstamp does not partake in or benefit from this exchange".
The formula is on the trading information page section 1.5, and [`rest.md`](./rest.md) section 4 records it in full with the probe behind it.

| item | value | label |
|---|---|---|
| interval | every 8 hours, the same for all 20 contracts | Published, and Probed from the history of all 20 |
| settlement instants | 00:00, 08:00 and 16:00 UTC | Published, and Probed |
| premium | a time weighted average over the trailing 8 hours of (fair price minus raw index) over fair price, weighted toward recent seconds, rounded down to 6 decimal places | Published |
| interest component | none in the formula | Published |
| rate | `Max(1 bp, premium) + Min(-1 bp, premium)`, so a premium inside plus or minus 1 bp gives 0, and a larger one is reduced by 1 bp toward zero | Published |
| cap and floor | none published beyond that dead band | Not publicly specified |
| payment | `Full Trade Notional in Settlement Currency * Funding Rate`, which price sets the notional is not stated | Published, price Not publicly specified |
| direction | positive rate, longs pay shorts, negative rate, shorts pay longs | Published, FAQ |
| settled through | the 15 minute periodic settlement, in USD | Published, trading information section 1.6 and FAQ |
| skipped | for contracts with index publishing hours, whenever the benchmark index is unavailable and for 1 hour after it resumes | Published, section 1.5, and Probed: inside their 18:00 to 00:00 UTC closed window, WTI and BRENT read `next_funding_time` 08:00 UTC, skipping the 00:00 instant |

A position opened and closed between two funding instants pays no funding, because payment happens only at a funding application time.
The engine's modelled trade crosses no settlement, so funding is zero for it.

WTI and BRENT have published a funding rate of exactly 0 at every one of the last 100 settlements, from 2026-08-13 00:00 UTC to 2026-09-15 00:00 UTC, while their mark sat 1,300 to 14,889 ppm above the index during the morning probe.
The second pass read the same 100 zeros through 2026-09-15 16:00 UTC, with WTI's mark 4,293 ppm above its index and BRENT's 5,496 ppm below it, inside their closed publishing window.
Nothing in the published formula explains that, so it is recorded as an open question in [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting charges

| charge | rate | label | source |
|---|---|---|---|
| position liquidation fee | 0.05 % (500 ppm), "charged in the settlement currency" | Published | derivatives fee schedule section 1.2 |
| collateral liquidation | the user's spot taker fee, charged in the collateral currency | Published | trading information section 4.3 |
| periodic settlement every 15 minutes | no fee published | Not publicly specified | trading information section 1.6 |
| automatic platform-wide position closure | positions closed "at the last available Index Price", no fee published | Published price, fee Not publicly specified | trading information section 3.6 |
| socialized losses | profits since the last periodic settlement can be reduced when the insurance fund draw exceeds 30 % per 15 minute period or 50 % per 24 hours | Published | trading information sections 3.3 and 3.5 |
| delisting | no delisting charge found | Not publicly specified | none |
| minimum trade amount | 10.00 USD | Published | derivatives fee schedule section 3.1 |
| fee rounding | fiat and stablecoin fees to 5 decimal places | Published | derivatives fee schedule section 3.2 |

## 8. CCXT

CCXT 4.5.68 reports `taker: 0.004` and `maker: 0.004` on all 20 perpetual markets when loaded without credentials, which is 4,000 ppm.

- The constant is `'taker': this.parseNumber('0.004')` at `server/node_modules/ccxt/js/src/bitstamp.js` line 439, inside `fees.trading`.
- The public markets reply carries no fee, and the base class copies `fees.trading` into every market at `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735.
- 0.40 % is the first row taker of Bitstamp's spot unified fee schedule, "< $10,000" 30 day volume, "Standard Taker fee % 0.40%".
  So the constant is a spot number applied to the perpetuals, and it is 26.7 times the published perpetual taker.
- The probe confirmed the value, `takers: [0.004]` over 20 active swaps, in the morning and in the second pass, see [`../../../scripts/probes/bitstamp-venue-probe.mjs`](../../../scripts/probes/bitstamp-venue-probe.mjs).

## 9. Recommended registry values

These are recommendations for a later design, not decisions.

| key | value | reason |
|---|---:|---|
| `takerPpm` | 150 | the published taker for every perpetual, 0.015 %, identical under both open-ended promotions |
| `ccxtTakerPpm` | 4000 | the CCXT constant at `server/node_modules/ccxt/js/src/bitstamp.js` line 439, so the connector expects it instead of warning on every market |

A registry comment in the style of the existing entries would read as follows.

```text
takerPpm: 150,
// The public markets reply carries no fee, so CCXT falls back to its spot constant at ccxt/js/src/bitstamp.js:439.
// 0.40 percent is the first spot tier taker. The perpetuals charge 0.015 percent under the Early Bird card of October 2025.
ccxtTakerPpm: 4000,
```

## 10. Source ledger

The `www.bitstamp.net` pages below sit behind an Imperva JavaScript challenge.
Plain `curl` and WebFetch received a 212 byte challenge page, so they were rendered with headless Google Chrome on this host on 2026-09-15 and read as text.
`https://www.bitstamp.net/api/` and `blog.bitstamp.net` answered plain requests.

| title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|
| Fee Schedule - Derivatives | https://www.bitstamp.net/legal/fee-schedule/perpetuals-related-services/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | sections 1, 2, 4, 5, 6, 7 |
| Derivatives Pricing Overview, October 2025 (PDF) | https://assets.bitstamp.net/msc/Bitstamp_Derivatives_Pricing_Overview_35d12324e1.pdf | 2026-09-15 | Bitstamp Financial Services Ltd., EU | sections 2, 4, 5 |
| Perpetual futures trading information | https://www.bitstamp.net/derivatives/perpetual-futures/trading-information/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | sections 3, 6, 7 |
| Perpetual futures contract specifications | https://www.bitstamp.net/derivatives/perpetual-futures/contract-specifications/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | section 3 |
| Pricing, Index, and Funding Mechanism (FAQ) | https://www.bitstamp.net/faq/pricing-index-and-funding-mechanism/ | 2026-09-15 | Bitstamp by Robinhood, all entities in the footer | sections 1, 6 |
| General Terms and Conditions, financial services | https://www.bitstamp.net/legal/financial-services/general-terms-and-conditions/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | section 1 |
| Bitstamp by Robinhood announces general launch for crypto perpetual futures | https://blog.bitstamp.net/post/bitstamp-by-robinhood-announces-general-launch-for-crypto-perpetual-futures-for-institutional-and-retail-investors/ | 2026-09-15 | Bitstamp Financial Services Ltd., EU | section 1 |
| Robinhood Completes Acquisition of Bitstamp | https://blog.bitstamp.net/post/robinhood-completes-acquisition-of-bitstamp/ | 2026-09-15 | Robinhood Markets, Inc. and Bitstamp Ltd. | section 1 |
| Unified Fee Schedule | https://www.bitstamp.net/fee-schedule/ | 2026-09-15 | spot entities by residency | sections 1, 4, 8 |
| Bitstamp API reference, OpenAPI 3.0.3 spec embedded in the page | https://www.bitstamp.net/api/ | 2026-09-15 | all entities | section 3 |
| CCXT 4.5.68 bitstamp class | `server/node_modules/ccxt/js/src/bitstamp.js` lines 35 and 439, `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735 | 2026-09-15 | not applicable | section 8 |
| REST probe | [`../../../scripts/probes/bitstamp-venue-probe.mjs`](../../../scripts/probes/bitstamp-venue-probe.mjs), run 2026-09-15 07:11 UTC and 19:20 UTC | 2026-09-15 | this host | sections 3, 6, 8 |
