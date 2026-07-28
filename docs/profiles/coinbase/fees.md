# Coinbase Fee Profile

**Status:** Done.

**Retrieved:** 2026-07-26.

## Scope and important limitation

Coinbase is a group of products and legal entities rather than one fee schedule.
This profile separates Coinbase consumer trading, Coinbase Advanced, Coinbase Exchange, Coinbase International Exchange, Coinbase Derivatives Exchange, Coinbase Financial Markets, Coinbase Prime, Coinbase One, staking, cards, and securities.
Product availability and pricing vary by country, account, entity, payment method, and negotiated agreement.

Values marked dynamic must be read from the transaction preview or authenticated account response.
Values marked account-gated require an eligible Coinbase account.
Values marked negotiated require a Coinbase agreement or account manager.
The absence of a public number does not mean that the service is free.

## Quick answer for opening a futures buy or sell

Buy and sell direction does not select the trading rate.
The venue, product, account class, and liquidity role select the rate.
Coinbase uses percentage-of-notional fees for International Exchange perpetuals and per-contract fees for Coinbase Derivatives Exchange products.

```text
percentage fee = position notional × maker or taker rate
per-contract fee = number of contracts × per-side contract fee
round-trip trading fee = opening fee + closing fee
total position cost = round-trip trading fee + funding + broker charges + liquidation cost when applicable
```

An order that executes immediately is normally a taker order.
A resting order is not guaranteed to be a maker order because it may execute immediately or cross when submitted.

## Product and account map

| Product | Primary market or service | Public pricing state |
| --- | --- | --- |
| Coinbase | Quoted crypto buys, sells, converts, transfers, DEX access, loans, and staking | Dynamic preview plus published processing charges |
| Coinbase Advanced | Spot and eligible derivatives through an order book | Full current tier is account-gated |
| Coinbase Exchange | Institutional spot order books | Published standard and stable-pair tables |
| Coinbase International Exchange | Eligible non-US spot and perpetual futures | Published public tiers |
| Coinbase Derivatives Exchange | US regulated futures exchange | Published per-contract exchange schedule |
| Coinbase Financial Markets | Futures commission merchant access through Coinbase Advanced | Exchange and brokerage pricing can both apply |
| Coinbase Prime and Custody | Institutional trading, financing, custody, and staking | Published baseline custody charges plus negotiated or account-gated pricing |
| Coinbase One | Consumer subscription and fee benefits | Benefits published, subscription price account and region dependent |
| Coinbase Card | Consumer debit card | Published Coinbase charges plus third-party charges |
| Coinbase One Card | US credit card | Published card charges |
| Coinbase Capital Markets | US stocks and funds | No Coinbase commission plus clearing and regulatory charges |

## Coinbase consumer fees

### Storage and internal transfers

Coinbase publishes no charge for cash and hosted crypto balances.
Transfers between Coinbase users' primary balances are free.

### Simple buy, sell, and convert

The Coinbase fee is dynamic.
Coinbase says it can depend on the payment method, order size, market conditions, jurisdiction, asset, and Coinbase's facilitation costs.
The final fee and spread appear in the order preview.
Simple buys, sells, and converts include a spread in the quoted price or exchange rate.
Coinbase may retain excess spread.

### DEX trading

DEX trades can include the standard Coinbase fee, an additional Coinbase service fee, blockchain costs, aggregator effects, and slippage.
The DEX service fee is dynamic and is not covered by Coinbase One zero-fee trading.
The preview is the source of record for a particular order.

### Hosted balance, transfer, and processing charges

| Activity | Coinbase charge | Additional charge or condition |
| --- | --- | --- |
| Hold cash or supported crypto | Free | Product and custody terms still apply. |
| Transfer between Coinbase primary balances | Free | Both users must remain on Coinbase. |
| Send crypto off platform | Dynamic network estimate | The estimate can differ from Coinbase's final network cost. |
| Send Bitcoin through Lightning | 0.20% of transferred BTC | This is a Coinbase processing fee. |
| Withdraw USDT | 0.01% with a maximum of 20 USDT | A separate network fee also applies. |
| Net USDC conversion above $5 million in a rolling 30 days | 0.10% on the net amount above the threshold | Coinbase nets qualifying USD or PYUSD mints against USDC redemptions. |
| Add cash or cash out | Dynamic by method | The preview shows the applicable charge. |
| Forced BTC collateral sale for a Coinbase credit transaction | 2% of the total sale | This applies when authorized by the loan agreement. |
| Recover an unsupported asset worth at most $100 | Network fee | Eligibility is asset and network dependent. |
| Recover an unsupported asset worth more than $100 | Network fee plus 5% of the estimated value above $100 | Estimated recovery value can differ from market value. |
| Instant unstaking | Dynamic preview | Standard unstaking after the full unbonding period has no Coinbase fee. |

## Coinbase Advanced

Coinbase Advanced uses maker and taker pricing without an embedded spread.
Coinbase says tiers depend on trailing 30-day activity and may also use assets on platform for current programs.
Tiers based on trading volume update hourly according to the Advanced fee help page.
The broader Advanced disclosure says a pricing-tier change can take up to ten minutes.
The current full table is displayed after sign-in rather than on a stable public fee page.
The authenticated Transaction Summary API returns the applicable pricing tier, maker rate, taker rate, balance thresholds, volume thresholds, margin rate, volume breakdown, and whether cost-plus pricing applies.

The API can be filtered by:

- Spot or futures.
- Expiring or perpetual futures.
- Coinbase Exchange, Coinbase Financial Markets, or Coinbase International Exchange venue.

The public help material states that Advanced rates do not exceed 0.40% maker and 0.60% taker.
This range is not a substitute for the authenticated tier returned for an order.

## Coinbase Exchange spot

The standard table applies to clients outside the separate Liquidity Program.
The tier is based on trailing 30-day USD-equivalent trading volume.
Stable-pair volume does not contribute to this standard volume.
The rate in force when the order is placed applies.

| Trailing 30-day volume | Taker | Maker |
| --- | --- | --- |
| $0 to less than $10,000 | 0.60% | 0.40% |
| $10,000 to less than $50,000 | 0.40% | 0.25% |
| $50,000 to less than $100,000 | 0.25% | 0.15% |
| $100,000 to less than $1 million | 0.20% | 0.10% |
| $1 million to less than $15 million | 0.18% | 0.08% |
| $15 million to less than $75 million | 0.16% | 0.06% |
| $75 million to less than $250 million | 0.10% | 0.03% |
| $250 million to less than $400 million | 0.06% | 0.00% |
| $400 million or more | 0.04% | 0.00% |

### Coinbase Exchange stable pairs

The `fx_stablecoin` field in the Exchange Products API identifies stable pairs.
Stable-pair makers pay 0.00%.
The separate Liquidity Program determines the lower taker tiers.

| Liquidity Program tier | Taker | Maker |
| --- | --- | --- |
| Tier 1 | 0.0010% | 0.00% |
| Tier 2 | 0.0015% | 0.00% |
| Tier 3 | 0.0020% | 0.00% |
| Tier 4 | 0.0030% | 0.00% |
| Other Exchange users | 0.0045% | 0.00% |

USDT-USDC and USDT-USD have used the standard schedule rather than stable-pair pricing since 2025-05-01.

### Coinbase Exchange fiat funding

| Method | Deposit | Withdrawal |
| --- | --- | --- |
| ACH | Free | Free |
| USD wire | $10 | $25 |
| EUR SEPA | €0.15 | Free |
| USD SWIFT | $25 | $25 |
| GBP SWIFT | Free | £1 |

Crypto withdrawals use a dynamic estimate of the anticipated network charge.

### Coinbase Exchange USDC to USD conversion

This table became effective on 2026-06-01.
It applies outside the separate Liquidity Program.
The fee is marginal as net conversion volume crosses a band.

| Rolling 30-day net conversion | Rate |
| --- | --- |
| Up to $2 million | 0.00% |
| More than $2 million through $30 million | 0.03% |
| More than $30 million | 0.05% |

Qualifying USDC Exchange Loans create temporary conversion-fee exemption credits equal to the loan amount.
The credits waive corresponding loan-related conversion fees for 30 days.
Unused credits expire when the loan is fully repaid.

### Coinbase Exchange market data subscriptions

Coinbase Exchange accounts receive ten WebSocket subscriptions per product and channel by default.
The following monthly plans raise that limit:

| Subscriptions per product and channel | Monthly cost |
| ---: | ---: |
| 10 | $0 |
| 15 | $250 |
| 25 | $1,000 |
| 50 | $2,000 |
| 100 | $3,500 |
| 250 | $6,500 |
| 500 | $10,000 |

These are data-access charges rather than trading commissions.
The account manages the plan through the Coinbase Developer Platform interface.

## Coinbase International Exchange

Availability is jurisdiction and eligibility dependent.
The public perpetual table uses trailing 30-day perpetual volume.
Coinbase says fees are evaluated monthly on this page, while spot fee inputs refresh every ten minutes.

### Perpetual futures

| Public tier | Trailing 30-day perpetual volume | Maker | Taker |
| --- | --- | --- | --- |
| 10 | At least $0 | 0.020% | 0.040% |
| 9 | At least $10 million | 0.018% | 0.030% |
| 8 | At least $25 million | 0.015% | 0.029% |
| 7 | At least $50 million | 0.012% | 0.027% |
| 6 | Official page displays no coherent lower bound and shows `≤$100M` | 0.012% | 0.025% |
| 5 | At least $500 million | 0.008% | 0.023% |
| 4 | At least $1 billion | 0.005% | 0.021% |
| 3 | At least $5 billion | 0.002% | 0.019% |
| 2 | At least $10 billion | 0.000% | 0.017% |
| 1 | At least $20 billion | 0.000% | 0.015% |

The official page appears to contain a Tier 6 threshold typo and leaves the range from $100 million to $500 million unclear.
An eligible account or the authenticated fee endpoint must resolve the actual tier before trading.

Liquidation costs 1.0% of the amount liquidated.
The liquidation fee contributes to the insurance and risk framework.

Coinbase separately advertises 0.00% maker and 0.00% taker fees for perpetual futures in eligible markets for non-US users in select jurisdictions.
The marketing page does not define the eligible markets or an end date.
This claim conflicts with the standing public perpetual table, so the authenticated order preview must determine whether the zero-fee offer applies.

### Spot

| Public tier | Qualification | Maker | Taker |
| --- | --- | --- | --- |
| 1 | Any published volume or USDC balance | 0.00% | 0.020% |

### Funding

Perpetual funding is exchanged hourly between long and short holders.
The payment is not an exchange trading fee, but it changes the position's economic cost.

```text
funding payment = position notional × hourly funding rate
position notional = contract size × mark price
```

Positive funding means longs pay shorts.
Negative funding means shorts pay longs.

### USDC Borrow

International Exchange USDC Borrow accrues at 10% APY.
Coinbase calculates interest every 30 seconds and pays accrued interest at midnight UTC before reducing principal.
The program requires cross collateral and can lead to collateral liquidation or rolling debt if the account cannot cover a USDC deficit.

## Coinbase Derivatives Exchange

The official schedule is effective from trade date 2026-01-26.
Coinbase Derivatives charges each buy side and each sell side per contract.
The market maker class requires a market-maker agreement.
The non-professional definition excludes regulated professionals, financial businesses, advisers, and fully automated order generators.
Every other participant is professional under the schedule.

### Full-size crypto futures

This group contains Bitcoin Futures `BTI`, Ether Futures `ETI`, Solana Futures `SLC`, and XRP Futures `XRL`.

| Participant class | Electronic per side | Block per side |
| --- | --- | --- |
| Market maker | $0.45 per contract | $0.20 per contract |
| Non-professional | $0.75 per contract | $0.20 per contract |
| Professional | $0.75 per contract | $0.20 per contract |

### Nano, perpetual-style, altcoin, commodity, and index futures

The published group contains `BIT`, `BIP`, `ET`, `ETP`, `BCH`, `BCP`, `LC`, `LCP`, `DOG`, `DOP`, `DOT`, `POP`, `SHB`, `SHP`, `XLM`, `XLP`, `AVA`, `AVP`, `LNK`, `LNP`, `HED`, `HEP`, `SOL`, `SLP`, `ADA`, `ADP`, `XRP`, `XPP`, `SUI`, `SUP`, `GOL`, `SLR`, `CU`, `PT`, `NOL`, `NGS`, and `MC`.

| Participant class | Electronic per side | Block per side |
| --- | --- | --- |
| Market maker | $0.07 per contract | $0.05 per contract |
| Non-professional | $0.10 per contract | $0.05 per contract |
| Professional | $0.10 per contract | $0.05 per contract |

A broker, futures commission merchant, clearing organization, market-data vendor, or routing provider may add separate charges.
Those third-party charges are not part of the exchange schedule.

## Coinbase Financial Markets through Advanced

Coinbase Financial Markets is the futures commission merchant used by eligible Advanced users.
An official API guide says the introductory beta rate was 0.05%.
The same guide also says the product uses the Advanced fee structure.
The guide does not establish that the introductory rate is still current on 2026-07-26.
The authenticated Transaction Summary response and order preview are the current sources of record.

Prediction markets are offered through Coinbase Financial Markets.
Coinbase publishes no standing numerical prediction-market fee table.
The order confirmation page displays the applicable fee breakdown before submission.

US perpetual-style contracts exchange hourly funding.

```text
funding payment = funding rate × open contracts × contract multiplier × futures mark price × -1
```

The contracts can have broker, exchange, clearing, funding, and liquidation effects.
The Coinbase Derivatives exchange fee table alone is therefore not a complete customer cost.

## Coinbase One

Subscription price depends on account, billing cycle, region, and offer.
Coinbase directs users to the authenticated membership page for the amount.

| Benefit | Basic | Preferred | Premium |
| --- | --- | --- | --- |
| Simple-trade fee benefit | Up to $500 monthly volume on the current account page | Up to $10,000 monthly volume on the current account page | Unlimited |
| Advanced spot fee rebate | None | 25% with up to $100 monthly rebate | 25% without a published monthly rebate cap |
| Domestic US Coinbase wire charge | Not waived | Waived | Waived |
| Staking reward boost | 5% | 10% | 15% |

The simple-trade benefit excludes Advanced, DEX service fees, and derivatives.
A spread still applies.
Open limit orders can consume the applicable monthly volume cap at order creation.
Coinbase publishes promotional material with different temporary limits.
The authenticated membership page controls the user's actual limit.

## Staking

There is no Coinbase charge to place assets into standard staking.
Coinbase deducts a commission from network rewards.

| Asset group | Standard commission | Coinbase One Basic | Coinbase One Preferred | Coinbase One Premium |
| --- | --- | --- | --- | --- |
| ADA, ATOM, AVAX, DOT, ETH, MATIC, SOL, and XTZ | 35.00% | See next row for eligible assets | See next row for eligible assets | See next row for eligible assets |
| ADA, ATOM, DOT, ETH, SOL, and XTZ | 35.00% | 31.75% | 28.50% | 25.25% |

AVAX and MATIC do not appear in Coinbase's published discounted-member list.
Instant unstaking has a dynamic preview fee.
Waiting through the standard unbonding period has no Coinbase unstaking fee.
Promotional rates and regional availability can differ.

## Loans and financing

Eligible consumer USDC loans use the Morpho protocol on Base.
The interest rate is variable and appears on the loan details page.
A one-time processing fee applies each time the customer borrows, including when adding to an existing loan.
The processing fee is added to principal, and interest accrues on the borrowed amount plus that fee.
Coinbase sponsors the gas fees for this loan interface.
A separate 1% spread applies when a customer claims MORPHO lending rewards and converts them to USDC.
A forced BTC collateral sale under an applicable Coinbase credit agreement costs 2% of the total sale.
Exchange Loan conversion credits are described in the Coinbase Exchange section.
International Exchange USDC Borrow is described in the Coinbase International Exchange section.
Prime financing rates and terms are negotiated.

## Cards

### Coinbase debit card

| Charge | Coinbase amount |
| --- | --- |
| Purchase transaction | Free |
| Coinbase ATM charge | Free |
| Crypto conversion | Dynamic spread |
| ATM operator charge | Third-party and dynamic |

The cardholder agreement can contain other program and regional terms.

### Coinbase One credit card

| Charge | Amount |
| --- | --- |
| Cash advance | Greater of $10 or 5% |
| Late payment | Up to $41 |
| Returned payment | Up to $41 |
| First replacement card | Waived |
| Later replacement card | Up to $40 each |
| Coinbase ATM charge | Free |
| ATM operator charge | Third-party and dynamic |
| Separate holding charge | None beyond the qualifying Coinbase One membership |

## Stocks and funds

Coinbase Capital Markets publishes this standard schedule for self-directed individual cash brokerage accounts:

| Stocks and funds item | Published value |
| --- | --- |
| US-listed equities and ETFs traded through the app or website | $0 commission |
| Outgoing ACATS transfer | $75 per account |
| SEC fee | $0 |
| Trading Activity Fee on equity sells from 2026-01-01 | $0.000195 per share, rounded to the nearest penny, with a $9.79 maximum per execution |
| Consolidated Audit Trail fee | $0 |
| Electronic statements and trade confirmations | $0 |

Coinbase says customers are not responsible for regulatory trading fees assessed on Coinbase Capital Markets.
Processing and service charges assessed by third parties can still be passed through.
Some American Depositary Receipts commonly deduct about $0.01 to $0.03 per share through the depositary bank.
Special offers and arrangements can vary the standard schedule.

## Prime, custody, institutional staking, and OTC

Coinbase Prime integrates trading, financing, settlement, custody, and staking.
Public help material does not publish one universal Prime price table.
Prime pricing is negotiated or communicated during onboarding and appears in account agreements, the authenticated Plan & Fees page, and monthly invoices.

Coinbase separately publishes these baseline Coinbase Custody values:

| Custody item | Public value |
| --- | --- |
| Implementation fee | $0 to $10,000 depending on the use case |
| Annualized custody fee | 50 basis points annually |
| Minimum balance | $500,000 |

The custody agreement controls the actual client price.
Prime financing remains negotiated.

Public-validator staking fees normally vary by asset and validator and are deducted as a percentage of rewards.
For ETH on a Coinbase Custody or Coinbase Developer Platform public validator, Coinbase Prime invoices 10% of earned ETH rewards after rewards are paid.
Coinbase Developer Platform dedicated validators charge an account-specific subscription fee and a variable participatory fee.
Prime LsETH custody uses the existing custody rate and Liquid Collective charges a 15% gross protocol service fee on staking rewards.

Prime RFQ prices are inclusive of trading fees and commissions, with any included financing reflected in the quote.
Funding or settling a Prime USD-book trade with USDC adds no separate conversion fee, although the normal Prime trading fees and commissions still apply.
OTC and routed Prime executions can include negotiated spreads, commissions, financing, custody, and third-party venue costs.

## Worked examples

### International perpetual taker round trip

Assume a Public Tier 10 trader opens a $10,000 position as a taker and later closes the same notional as a taker.

```text
opening fee = $10,000 × 0.040% = $4.00
closing fee = $10,000 × 0.040% = $4.00
round-trip trading fee = $8.00
```

Funding and slippage remain additional.
A liquidation would use the separate 1.0% charge on the liquidated amount.

### Coinbase Derivatives nano contract

Assume a non-professional electronically buys one nano contract and later electronically sells it.

```text
opening exchange fee = 1 × $0.10 = $0.10
closing exchange fee = 1 × $0.10 = $0.10
round-trip exchange fee = $0.20
```

Brokerage, clearing, funding, and other customer charges can make the final amount higher.

### Coinbase Exchange first-tier spot taker

Assume an Exchange client in the first standard tier takes $10,000 of spot liquidity.

```text
fee = $10,000 × 0.60% = $60.00
```

## What must be fetched live

| Value | Official lookup |
| --- | --- |
| Consumer trade fee and spread | Order preview and transaction history |
| Advanced maker and taker tier | Signed-in fee page or Transaction Summary API |
| Coinbase Financial Markets customer rate | Transaction Summary API and futures order preview |
| Crypto network charge | Send or withdrawal preview |
| Fiat funding charge | Payment-method preview |
| Instant unstaking charge | Unstaking preview |
| Consumer loan APR and processing fee | Loan preview |
| Prediction-market contract fee | Order confirmation |
| Coinbase One subscription price and current limits | Membership page |
| Prime trading, financing, institutional staking, and OTC price | Plan & Fees page, client agreement, account manager, or invoice |
| Contract-specific custody price | Custody agreement, with the public baseline as a reference |
| Third-party broker and clearing charges | Applicable broker, FCM, clearing, and custody disclosures |

## Source ledger

All sources were retrieved on 2026-07-26.

| Official source | Entity or product | Supports |
| --- | --- | --- |
| [Coinbase pricing and fees disclosures](https://help.coinbase.com/en/coinbase/trading-and-funding/pricing-and-fees/fees) | Coinbase consumer | Storage, network, payment, credit sale, processing, trading, DEX, card, staking, and recovery charges |
| [Coinbase Advanced fees](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees) | Coinbase Advanced | Account-gated tier behavior and calculation basis |
| [Coinbase Advanced](https://www.coinbase.com/advanced-trade) | Coinbase Advanced | Asset-balance tier input and ten-minute update disclosure |
| [What is Coinbase Advanced](https://help.coinbase.com/en-gb/coinbase/trading-and-funding/advanced-trade/what-is-advanced-trade) | Coinbase Advanced | Public maximum maker and taker rates |
| [Get Transaction Summary](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/fees/get-transaction-summary) | Advanced API | Authenticated rate, tier, venue, product, volume, balance, and margin fields |
| [Coinbase Exchange fees](https://help.coinbase.com/en/exchange/trading-and-funding/exchange-fees) | Coinbase Exchange | Spot tiers, stable pairs, fiat funding, miners, conversion fees, and loan credits |
| [Coinbase Exchange market data connections](https://help.coinbase.com/en/exchange/managing-my-account/market-data-connections) | Coinbase Exchange | WebSocket subscription limits and monthly plan prices |
| [Coinbase International Exchange fees](https://help.coinbase.com/en/international-exchange/trading-deposits-withdrawals/international-exchange-fees) | Coinbase International Exchange | Public perpetual and spot tiers plus liquidation fee |
| [Coinbase derivatives trading](https://www.coinbase.com/derivatives-trading) | Coinbase Advanced international derivatives | Jurisdiction-limited zero-fee perpetual marketing claim |
| [International derivatives funding](https://help.coinbase.com/en/coinbase/derivatives/funding-rate) | International derivatives | Hourly funding direction and formula |
| [International Exchange USDC Borrow](https://help.coinbase.com/en/international-exchange/portfolio-balances/usdc-borrow) | Coinbase International Exchange | Borrow rate, accrual interval, payment order, and collateral consequences |
| [Coinbase Derivatives fee schedule](https://assets.ctfassets.net/k3n74unfin40/sgInuF26edJX4v4nUlE29/87f18103cd35feede93f0bb92a5f1065/Fee_Schedule_1.26.2026.pdf) | Coinbase Derivatives Exchange | Per-side contract charges and participant definitions |
| [US perpetual-style futures overview](https://help.coinbase.com/en/coinbase/derivatives/us-perpetual-futures-overview) | Coinbase Financial Markets | Product structure and funding calculation |
| [Advanced Trade futures guide](https://docs.cdp.coinbase.com/coinbase-business/advanced-trade-apis/guides/futures) | Coinbase Financial Markets | Advanced integration and historical beta fee statement |
| [Prediction markets introduction](https://help.coinbase.com/en/coinbase/trading-and-funding/prediction-markets/intro) | Coinbase Financial Markets | Dynamic order-confirmation fee disclosure |
| [Coinbase One](https://help.coinbase.com/en/coinbase/other-topics/coinbase-one/account) | Coinbase One | Current published tiers and benefits |
| [Coinbase One benefit disclosures](https://help.coinbase.com/en/coinbase/other-topics/coinbase-one/benefit-disclosures) | Coinbase One | Exclusions, limits, and Advanced rebates |
| [Crypto-backed loans](https://help.coinbase.com/en/coinbase/trading-and-funding/loan/loan-intro) | Coinbase consumer | Variable Morpho interest, processing fee, principal treatment, and sponsored gas |
| [Claim lending rewards](https://help.coinbase.com/en/coinbase/trading-and-funding/loan/claim-lending-rewards) | Coinbase consumer | MORPHO-to-USDC conversion spread |
| [Coinbase debit card fees](https://help.coinbase.com/en/coinbase/trading-and-funding/coinbase-card/cb-card-fees-tax) | Coinbase Card | Purchase, ATM, and spread treatment |
| [Coinbase One credit card fees](https://help.coinbase.com/en/creditcard/fees-and-interest) | Coinbase One Card | Cash advance, late, returned-payment, replacement, and ATM charges |
| [Stock pricing and fees](https://help.coinbase.com/en/trading-and-funding/pricing-and-fees/stock-pricing-fees) | Coinbase Capital Markets | Commission, clearing, and ADR treatment |
| [Coinbase Capital Markets fee schedule](https://images.ctfassets.net/o10es7wu5gm1/15gaaAIKknqZUL2LQVQ5sN/7b369aefcc0bb423fb88cd7c258119b3/CCM_Fee_Schedule.pdf) | Coinbase Capital Markets | Standard commission, transfer, regulatory, and service charges |
| [Prime Custody introduction](https://help.coinbase.com/en/prime/prime-custody/introduction) | Coinbase Prime and Custody | Product and negotiated onboarding boundaries |
| [Coinbase Custody pricing](https://www.coinbase.com/custody/pricing) | Coinbase Custody | Public implementation fee, annualized custody fee, and minimum balance |
| [Prime billing](https://help.coinbase.com/en/prime/billing) | Coinbase Prime | Monthly invoices and authenticated Plan & Fees details |
| [Prime staking fees](https://help.coinbase.com/en/prime/staking/fees) | Coinbase Prime | Public-validator, ETH, and dedicated-validator fee treatment |
| [Prime LsETH](https://help.coinbase.com/en/prime/staking/lseth-liquid-staking-on-coinbase-prime) | Coinbase Prime | LsETH custody and protocol service fees |
| [Prime RFQ](https://help.coinbase.com/en/prime/trading-and-funding/rfq) | Coinbase Prime | All-inclusive quote treatment |
| [Prime USDC trading](https://help.coinbase.com/en/prime/trading-and-funding/trade-with-usdc) | Coinbase Prime | Normal commissions with no extra USDC funding or settlement fee |

## Known official-source conflicts

The International Exchange page displays `≤$100M` for Public Tier 6 between higher minimum thresholds.
This appears internally inconsistent and must not be silently corrected.
The Advanced fee help page says volume-based tiers update hourly, while the Advanced product disclosure says pricing-tier changes can take up to ten minutes.
The order preview remains the controlling source for a particular trade.
The standing International Exchange fee page publishes nonzero perpetual maker and taker rates, while Coinbase's current derivatives marketing page advertises 0.00% rates for selected non-US markets.
The marketing page does not publish enough eligibility detail to reconcile the two claims without an authenticated preview.
The Advanced futures guide contains an introductory 0.05% beta statement without a current end date.
The authenticated transaction summary is safer than assuming that beta statement remains current.
Coinbase One promotional pages can publish temporary limits that differ from the standing account page.
The authenticated membership page controls the user's current benefit.
