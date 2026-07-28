# Kraken Fee Profile

Status: Done.

Retrieved: 2026-07-26.

This profile covers public Kraken fees that can affect an arbitrage system.
It separates Kraken Pro spot, spot margin, international derivatives, EEA derivatives, United States futures, options, consumer trading, xStocks, securities brokerage, staking, borrowing, transfers, cards, and institutional services.
Availability and rates depend on the client entity, residence, product eligibility, asset, and account.

## Quick answer for opening and closing positions

A plain Kraken Pro spot fill costs the maker or taker rate for the account's current cross-platform tier.
A spot margin position also pays a margin opening fee and a rollover fee every four hours.
An international perpetual or futures fill costs the current derivatives maker or taker rate.
Perpetual funding is a separate transfer between long and short positions.
A United States futures trade uses per-contract fees instead of the international percentage schedule.
Consumer Instant Buy, recurring orders, and custom orders do not use the Kraken Pro order-book schedule.

Use this execution-cost model for a candidate trade:

```text
entry cost
= entry execution fee
+ entry margin opening fee when applicable
+ expected spread and slippage

holding cost
= expected funding transfers
+ margin rollover or loan interest when applicable
+ expected conversion or collateral costs

exit cost
= exit execution fee
+ settlement, exercise, or liquidation charges when applicable
+ expected spread and slippage
```

## Authority order

Use the following order when two published values disagree:

1. Use the signed-in order preview, transfer preview, or account-specific fee display.
2. Use the current product-specific support article for the applicable legal entity.
3. Use the current public Kraken fee schedule.
4. Use an older operational article only for mechanics that newer pages do not replace.
5. Never infer a zero fee from a missing table cell or unavailable product.

The observatory should record the source URL, retrieval time, entity, region, product, symbol, and account tier with every cached fee.

## Product and entity map

| Product family | Typical fee model | Important scope rule |
| --- | --- | --- |
| Kraken Pro spot | Percentage maker and taker tiers | Current tiers can qualify through spot volume, futures volume, or assets on platform. |
| Spot margin | Spot execution fee plus dynamic opening and four-hour rollover fees | Liquidation uses a separate 3% fee. |
| International Coin-M and Multi-M derivatives | Percentage maker and taker tiers | Funding, collateral conversion, and liquidation are separate. |
| EEA derivatives | Separate regional percentage schedule | Do not substitute the global derivatives table. |
| United States futures | Per-contract and per-side charges | CME and Bitnomial products use different schedules. |
| Options | Derivatives rate with a premium cap | Exercise, settlement, and liquidation rules also matter. |
| Consumer Kraken | Fixed service percentage plus spread | Kraken+ can waive only the qualifying transaction fee. |
| xStocks | Separate Pro and consumer treatment | Fiat purchases and non-fiat consumer conversions differ. |
| United States securities | Zero Kraken commission plus regulatory and transfer fees | Options and custody events have additional pass-through charges. |
| Staking and Auto Earn | Commission on rewards | Bonded and flexible products use different rates. |
| Borrow and Flexline | Origination plus dynamic interest | Conversion and early termination can add costs. |
| Cash and crypto transfers | Rail-specific or network-specific | The signed-in preview is authoritative. |
| OTC, Prime, and Custody | Quote-based or negotiated | Public static schedules are incomplete. |

## Kraken Pro cross-platform tiers

Kraken's current main schedule selects the best qualifying tier from trailing 30-day spot volume, trailing 30-day futures volume, or assets on platform.
Assets on platform are abbreviated as AoP in Kraken's schedule.
The selected tier applies to both the current spot and international derivatives tables.

| Tier | Spot volume | Futures volume | AoP |
| --- | ---: | ---: | ---: |
| 1 | $0 | Less than $5 million | Not applicable |
| 2 | $2,500 | $5 million | Not applicable |
| 3 | $10,000 | $10 million | $20,000 |
| 4 | $25,000 | $15 million | $50,000 |
| 5 | $50,000 | $25 million | $100,000 |
| 6 | $100,000 | $40 million | $200,000 |
| 7 | $250,000 | $50 million | $400,000 |
| 8 | $500,000 | $75 million | $600,000 |
| 9 | $1 million | $100 million | $1 million |
| 10 | $2.5 million | $150 million | $2.5 million |
| 11 | $5 million | $250 million | $5 million |
| 12 | $10 million | $300 million | $10 million |
| Pro 1 | $50 million | $400 million | $20 million |
| Pro 2 | $100 million | $500 million | $25 million |
| Pro 3 | $250 million | $1 billion | $50 million |
| Pro 4 | $400 million | $2 billion | $80 million |
| Pro 5 | $500 million | More than $5 billion | $100 million |

Spot qualification includes trailing 30-day Kraken Pro spot and margin trades in crypto-cash, crypto-crypto, and xStocks markets.
It excludes forex pairs, stablecoin pairs, Instant Buy, and conversions.
AoP uses the current USD value of eligible crypto, tokenized assets, fiat, Opt-In Rewards, staked assets, and Dual Investment balances.
It excludes loans, Embed parent client balances, and equities.
AoP is assessed at a point in time rather than averaged over 30 days.
An AoP-qualified tier can therefore change immediately when holdings or their USD values change.

Kraken states that futures volume from Canada, New Zealand, and the United States does not count toward this cross-platform qualification.
An official support article still describes qualification through spot volume or AoP without futures volume.
The current fee schedule and Kraken's July 2026 announcement are newer and are used here.
The signed-in tier remains authoritative for a specific account.

## Kraken Pro spot

The following rates apply to the standard spot order book.
Rates are percentages of executed notional.

| Tier | Maker | Taker |
| --- | ---: | ---: |
| 1 | 0.40% | 0.80% |
| 2 | 0.30% | 0.60% |
| 3 | 0.22% | 0.38% |
| 4 | 0.20% | 0.35% |
| 5 | 0.15% | 0.30% |
| 6 | 0.12% | 0.25% |
| 7 | 0.10% | 0.22% |
| 8 | 0.08% | 0.20% |
| 9 | 0.06% | 0.18% |
| 10 | 0.04% | 0.15% |
| 11 | 0.02% | 0.12% |
| 12 | 0.00% | 0.10% |
| Pro 1 | 0.00% | 0.09% |
| Pro 2 | 0.00% | 0.08% |
| Pro 3 | 0.00% | 0.07% |
| Pro 4 | 0.00% | 0.06% |
| Pro 5 | 0.00% | 0.05% |

The execution fee is `executed notional × rate`.
Kraken applies the fee to each fill.
A small trade can be subject to the minimum fee precision of its pair.
The order form can let the user express a preferred fee currency, but Kraken does not guarantee that preference when the balance is insufficient.

### Eligible spot maker-rebate pairs

Some named pairs use the following schedule.
A negative maker rate is a rebate.
The live pair list must be checked before applying this table.

| Tier | Maker | Taker |
| --- | ---: | ---: |
| 1 | 0.38% | 0.80% |
| 2 | 0.28% | 0.60% |
| 3 | 0.20% | 0.38% |
| 4 | 0.18% | 0.35% |
| 5 | 0.13% | 0.30% |
| 6 | 0.10% | 0.25% |
| 7 | 0.08% | 0.22% |
| 8 | 0.06% | 0.20% |
| 9 | 0.04% | 0.18% |
| 10 | 0.02% | 0.15% |
| 11 | 0.00% | 0.12% |
| 12 | -0.02% | 0.10% |
| Pro 1 | -0.02% | 0.09% |
| Pro 2 | -0.02% | 0.08% |
| Pro 3 | -0.02% | 0.07% |
| Pro 4 | -0.02% | 0.06% |
| Pro 5 | -0.02% | 0.05% |

### Stablecoin and foreign-exchange pairs

Named stablecoin and foreign-exchange pairs use a separate symmetric schedule.
These trades do not contribute to standard spot 30-day volume.

| Trailing 30-day volume | Maker | Taker |
| --- | ---: | ---: |
| $0 | 0.20% | 0.20% |
| $50,000 | 0.16% | 0.16% |
| $100,000 | 0.12% | 0.12% |
| $250,000 | 0.08% | 0.08% |
| $500,000 | 0.04% | 0.04% |
| $1 million | 0.02% | 0.02% |
| $10 million | 0.00% | 0.01% |
| $100 million | 0.00% | 0.001% |

USDG base pairs use 0.00% maker and 0.01% taker below $100 million.
USDG base pairs use 0.00% maker and 0.001% taker from $100 million.
Kraken's 0.00% USDe promotion ended on 2026-06-30 and is not a current default rate.

## Spot margin

Spot margin pays the normal spot fee on opening and closing order-book fills.
It also pays an opening fee on the amount Kraken extends and a rollover fee on that extended amount every four hours.
Settling a margin position without an order-book close does not incur the normal closing trade fee.

Rates are dynamic and appear in the order form.
The rollover rate is locked when the order executes.
The following published bands are useful only as validation ranges:

| Extended asset | Opening fee | Rollover fee every four hours |
| --- | ---: | ---: |
| BTC | 0.01% to 0.02% | 0.01% to 0.02% |
| USD | 0.025% to 0.05% | 0.025% to 0.05% |
| Other listed assets and currencies | 0.02% to 0.04% | 0.02% to 0.04% |

A liquidation pays 3% on the amount involved in Kraken's index-price liquidation process.
The liquidation order does not also pay the standard trading fee because it does not pass through the order book.

The observatory must obtain the displayed opening and rollover rates before estimating a margin route.
It must not use the validation bands as executable quotes.

## International derivatives

The current global table covers eligible international Coin-M and Multi-M perpetuals and futures.
Rates are percentages of executed notional.
A negative maker value is a rebate.

| Tier | Maker | Taker |
| --- | ---: | ---: |
| 1 | 0.0200% | 0.0500% |
| 2 | 0.0175% | 0.0450% |
| 3 | 0.0150% | 0.0400% |
| 4 | 0.0125% | 0.0350% |
| 5 | 0.0100% | 0.0300% |
| 6 | 0.0075% | 0.0275% |
| 7 | 0.0050% | 0.0250% |
| 8 | 0.0050% | 0.0225% |
| 9 | 0.0000% | 0.0200% |
| 10 | 0.0000% | 0.0180% |
| 11 | -0.0030% | 0.0175% |
| 12 | -0.0030% | 0.0170% |
| Pro 1 | -0.0030% | 0.0160% |
| Pro 2 | -0.0050% | 0.0150% |
| Pro 3 | -0.0060% | 0.0135% |
| Pro 4 | -0.0060% | 0.0130% |
| Pro 5 | -0.0060% | 0.0125% |

Inverse single-collateral fees are charged in the contract's collateral currency.
Linear Multi-M fees are charged in USD.

```text
inverse fee in collateral currency
= fee rate × USD contract quantity ÷ trade price

linear fee in USD
= fee rate × contract quantity × entry price
```

An older product article contains a different derivatives tier table and says that spot activity does not qualify.
The current main schedule and July 2026 announcement supersede that table for current pricing.
The older article remains useful for contract mechanics.

### Funding and settlement

Perpetual funding is exchanged between traders.
Kraken does not classify the transfer as a trading commission.
The rate is continuous and funding is realized hourly.

The system should estimate `position notional × expected funding rate × holding fraction`.
It should use the current instrument rate and next realization time.
It should never substitute the derivatives execution rate for funding.

Fixed-maturity settlement is charged at the taker rate.
A liquidated party is charged as a taker and the other side is charged as a maker.
Assignments charge both parties at the taker rate.
A termination that causes one party is charged as taker for that party and maker for the other party.
Fee Credits can offset qualifying trading fees but do not offset funding, conversion, liquidation, or interest.

### Derivatives liquidation

A full liquidation fee equals 50% of the contract's minimum maintenance margin.
A partial liquidation fee is based on the absolute price difference defined by Kraken between the protected execution or mark price and the zero-equity price, multiplied by quantity.
These charges are separate from the ordinary entry and exit commission model.

### Multi-M collateral conversion

Kraken can convert collateral when the Multi-M account requires it.
The current conversion fee groups are:

| Conversion group | Fee |
| --- | ---: |
| CAD, EUR, GBP, AUD, CHF, EURC, USDG, USDC, and USDT | 0.00% |
| BTC and ETH | 0.20% |
| Other supported crypto collateral and tokenized equities | 0.50% |

The 0.50% group currently includes XAUT, SOL, ADA, DOGE, LTC, ALGO, FET, ARB, AVAX, TIA, LINK, ATOM, CRV, ENA, ONDO, SEI, TRX, WIF, FARTCOIN, FIL, HYPE, INJ, KAS, KSM, MINA, PAXG, PEPE, DOT, XRP, SHIB, SPX, GRT, and UNI.
The live collateral page also defines haircuts and limits.
Those are risk parameters rather than fees, but they affect usable capital.

Uncovered non-USD unrealized losses can incur an hourly charge:

| Uncovered loss band | Hourly charge |
| --- | ---: |
| $0 to $100,000 | 0.0025% |
| $100,000 to $500,000 | 0.0050% |
| $500,000 to $1 million | 0.0075% |
| $1 million to $2.5 million | 0.0100% |
| $2.5 million to $5 million | 0.0125% |

Kraken can automatically convert at the $5 million threshold.

### Options

XBT/USD and ETH/USD options use the applicable derivatives maker or taker rate.
They are European options that settle in USD cash.
The trading fee is capped at 12.5% of premium paid.
The effective fee is therefore the smaller of the notional fee and the premium cap.
The current public contract specification does not list a separate expiration or exercise fee.
Liquidation and region eligibility must still be checked for the applicable account.

## EEA derivatives

Eligible EEA clients use the following regional derivatives schedule.
This schedule is not the same as the current global cross-platform table.

| Trailing 30-day derivatives volume | Maker | Taker |
| --- | ---: | ---: |
| $0 | 0.0200% | 0.0500% |
| $2.5 million | 0.0150% | 0.0450% |
| $5 million | 0.0125% | 0.0400% |
| $10 million | 0.0100% | 0.0350% |
| $20 million | 0.0075% | 0.0300% |
| $30 million | 0.0050% | 0.0250% |
| $50 million | 0.0030% | 0.0200% |
| $75 million | 0.0015% | 0.0150% |
| $100 million | 0.0000% | 0.0125% |
| $250 million | -0.0015% | 0.0100% |
| $500 million | -0.0030% | 0.0100% |
| $1 billion | -0.0050% | 0.0100% |

## United States futures

United States futures use per-contract and per-side fees.
A round turn pays the applicable charges twice.
The signed-in order preview includes exchange, NFA, clearing, and commission values.

| Product example | Kraken commission per contract per side | Other charges |
| --- | ---: | --- |
| CME Micro E-mini Nasdaq-100 and Micro E-mini S&P 500 | $0.39 | Dynamic exchange, NFA, and clearing charges appear in preview. |
| CME E-mini Nasdaq-100 and E-mini S&P 500 | $1.29 | Dynamic exchange, NFA, and clearing charges appear in preview. |
| Bitnomial perpetual | $0.03 | $0.10 exchange and clearing plus $0.02 NFA, for $0.15 all-in. |

United States futures also require the applicable market data entitlement:

| Client and market | Level 1 | Level 2 |
| --- | ---: | ---: |
| Funded non-professional CME client | Free | $16 monthly |
| Professional CME client | Not available separately | $140 monthly |
| Any Bitnomial client | Free | Not offered |

At least Level 1 is required to place a CME futures order.
Bitnomial perpetual market data requires no subscription.

Bitnomial perpetual funding is accumulated and settled daily at 15:00 Central Time.
CME-only liquidation costs $25 for the first liquidation and $50 for each subsequent liquidation.
Perpetual-only liquidation costs $10 for the first and each subsequent liquidation.
An account with both CME and perpetual futures pays $25 for the first liquidation and $50 for each subsequent liquidation.

## Consumer trading and Kraken+

Consumer purchases use a service charge and a quoted spread.
They do not use the Kraken Pro maker and taker table.

| Consumer action | Kraken charge | Additional economic cost |
| --- | ---: | --- |
| Instant Buy or Sell | 1.00% | Dynamic spread and payment-rail fees can apply. |
| Recurring order | 1.00% | Dynamic spread and payment-rail fees can apply. |
| Custom order | 1.50% | Dynamic spread can apply. |
| Convert Small Balances below the normal minimum | 3.00% | This is a fixed conversion fee. |
| Consumer perpetual open in eligible regions | 0.25% of opening notional | Funding and spread are separate. |
| Consumer perpetual close in eligible regions | 0.25% of closing notional | Funding and spread are separate. |

Kraken+ costs $4.99 per month or $49.99 per year in USD.
The same numeric prices are listed in GBP, CAD, AUD, EUR, and CHF.
Other currencies use a dynamic conversion.
The app offers monthly and annual billing.
The web flow offers annual billing.

Kraken+ can waive the qualifying consumer transaction fee on up to $10,000 of monthly trading volume.
It does not waive spread, card charges, Kraken Pro fees, API fees, OTC fees, or unrelated product charges.

## xStocks

Kraken Pro xStocks use a separate order-book table for eligible pairs:

| Qualification | Maker | Taker |
| --- | ---: | ---: |
| Standard | -0.02% | 0.10% |
| Eligible institutional client with more than $100 million combined spot and xStocks volume | -0.02% | 0.08% |

The institutional rate also requires activity in Futures, Custody, or Staked.
Consumer xStocks purchases with USD or USDG have no stated trading fee.
Consumer xStocks purchases with another asset use the 1% Instant Buy charge plus spread.

## United States securities brokerage

Kraken advertises zero commission for eligible stock trading.
Regulatory, clearing, custody, and transfer charges still apply.
The current getting-started article also lists availability for eligible clients in Germany, the Netherlands, and France.
The detailed schedule below belongs to Kraken Securities LLC and must not be substituted for EEA entity terms.

| Charge | Current public amount |
| --- | --- |
| FINRA Trading Activity Fee for equity sells | $0.000166 per share, capped at $8.30 and rounded to the nearest cent |
| SEC Section 31 fee for equity sells | $27.80 per $1 million of principal, rounded up to the next cent |
| FINRA Trading Activity Fee for option sells | $0.00279 per contract |
| Options Regulatory Fee | $0.02685 per contract on buys and sells |
| OCC fee for up to 2,750 contracts | $0.02 per contract, capped at $55 per trade |
| OCC fee above 2,750 contracts | $55 per trade |
| Option regulatory transaction fee on sells | 0.0000278 times trade amount, with a $0.01 minimum |
| CAT fee for listed equities | $0.000053 per share |
| CAT fee for OTC equities | $0.000053 per share adjusted by the published 1 to 0.01 ratio |
| CAT fee for options | $0.000053 per equivalent share |
| ADR custody fee | Usually $0.01 to $0.03 per share |
| ACATS incoming transfer | Free |
| ACATS outgoing transfer | $100 |
| DWAC incoming or outgoing transfer | $250 per security |
| DWAC rejection | $100 |
| DRS incoming or outgoing transfer | $125 per security |
| DRS rejection | $200 |
| DTC incoming transfer | Free |
| DTC outgoing transfer | $50 per security per submission |
| Internal brokerage transfer | $50 for a full or partial transfer |
| Voluntary corporate action | $100 per security |
| Easy-to-borrow securities lending cost | Pass-through lender cost with no current Kraken markup |

The current July 2026 regulatory-fee article lists a nonzero SEC Section 31 fee.
An older brokerage schedule PDF lists the equity Section 31 fee as zero.
The newer article is used here.
Hard-to-borrow stock is currently unavailable through the published brokerage schedule.

## Staking and Auto Earn

Kraken does not charge a transaction fee to stake or unstake.
It retains a percentage of network rewards.

Bonded staking uses total eligible assets under management at the weekly reward payout:

| Eligible bonded AUM | Kraken commission |
| --- | ---: |
| $0 to $1 million | 25% |
| $1 million to $5 million | 20% |
| $5 million to $50 million | 10% |
| $50 million to $100 million | 5% |
| $100 million or more | 0% |

Flexible staking and Auto Earn use a 30% commission.
Flexible ADA, MINA, and TAO use the bonded tier calculation.
An older top-level fee page says that flexible staking uses 20%.
The product-specific staking article was updated more recently and is used here.

## Borrow and Flexline

| Product | Origination or opening charge | Ongoing charge | Other charge |
| --- | ---: | --- | --- |
| Borrow | 0.50% | Dynamic APR capped at 25%, accrued every four hours | Normal trade fee if EURC or USDG is converted |
| Flexline | 0.50% | Asset-specific and term-specific fixed interest every four hours | Early termination costs half of remaining scheduled interest |

Kraken can change a Borrow APR with 60 days of notice.
Borrow loans and repayments use EURC in the EEA and USDG in other supported markets.
Borrow repayments are fee-free.
OTC loans, Prime financing, and institutional credit can use negotiated terms.

## Cash deposits

The following table records current published Kraken charges.
An intermediary bank or payment provider can add a separate fee.

| Currency and rail | Kraken fee |
| --- | ---: |
| USD ACH | Free |
| USD PayPal | Dynamic |
| USD debit card | $0.25 plus 3.75% |
| USD FedWire through Dart | Free |
| USD SWIFT through Customers Bank | Free |
| USD SWIFT through Bank Frick | $3 |
| EUR SEPA rails | Free |
| EUR PayPal | Dynamic |
| EUR debit card | €0.25 plus 3.75% |
| EUR SWIFT through Bank Frick | €3 |
| EUR iDEAL | Free |
| CAD domestic wire | Free from Kraken, with a published $13.74 intermediary charge |
| CAD Interac e-Transfer | Free |
| CAD debit card | C$0.25 plus 3.75% |
| CAD SWIFT | C$3 |
| CAD Bill Pay | 0.25%, capped at C$30 |
| AUD bank transfer or Osko | Free |
| AUD PayPal | Dynamic |
| AUD RTGS | A$33 |
| GBP Faster Payments | Free |
| GBP PayPal | Dynamic |
| GBP debit card | £0.25 plus 3.75% |
| GBP SWIFT | £3 |
| CHF SIC | Free |
| CHF SWIFT | CHF 0.75 |
| ARS bank transfer | Free |
| BRL PIX | 0.30% IOF tax |
| MXN SPEI | Free |

## Cash withdrawals

| Currency and rail | Kraken fee |
| --- | ---: |
| USD ACH | Free |
| USD FedWire through Customers Bank | $4 |
| USD FedWire through Dart | $4 |
| USD SWIFT through Bank Frick | $13 |
| USD RTP | 1.50%, capped at $50 |
| EUR SEPA through Bank Frick | €1 |
| EUR SEPA or SEPA Instant through Banking Circle | €1 |
| EUR SEPA Instant through Clear Junction | €0.90 |
| EUR SEPA through OpenPayd | €1 |
| EUR SWIFT through Bank Frick | €5 |
| GBP Faster Payments through Banking Circle or OpenPayd | £1.95 |
| GBP SWIFT | £13 |
| CAD EFT | 0.35% |
| CAD Interac e-Transfer | C$10 |
| CAD SWIFT | C$13 |
| AUD bank transfer or Osko | Free |
| CHF SIC or SWIFT | CHF 1 |
| JPY SWIFT through Etana | $35 equivalent |
| ARS bank withdrawal | 1.50% |
| BRL PIX | 0.50% |
| MXN SPEI | 0.50% |

Internal Krak transfers are free.
An automatic conversion can still charge a conversion fee when the sender does not hold the recipient's requested currency.
The signed-in funding page must be checked because rails, minimums, limits, and regional availability change.

## Crypto deposits, withdrawals, and recovery

Most on-chain crypto deposits are free.
Bitcoin Lightning deposits cost 0.30%.
The first MINA deposit address setup costs 1 MINA.
Paxos charges 0.02% on each PAXG on-chain transaction.
A PAXG deposit can incur that Paxos charge on the client transfer and again on Kraken's hot-wallet sweep.
Those Paxos charges are in addition to Kraken's signed-in flat PAXG deposit fee.

Crypto withdrawal fees and minimums vary by asset and network.
Kraken can update them with network conditions.
The signed-in withdrawal preview is the executable source.
PAXG withdrawals can add the 0.02% Paxos charge to Kraken's displayed flat withdrawal fee.

Published recovery charges are:

| Recovery case | Charge |
| --- | ---: |
| Deposit not credited | Free |
| Missing or incorrect tag or memo | Network fee |
| Deposit sent to a Kraken hot wallet | Network fee |
| Unsupported token on a supported network | $200 |
| Unlisted asset on an unsupported network | $500 |

Recovery is not guaranteed.
Kraken can quote a different charge when the case requires additional work.

## Kraken Card

Kraken does not list an annual fee, monthly fee, transaction fee, foreign-exchange markup, or Kraken ATM fee for the current Krak Card.
A crypto sale spread can apply when funding a purchase.
Mastercard performs currency conversion without a Kraken markup.
An ATM operator can charge its own fee.
The issuer can charge under its agreement when a card is cancelled within six months.
A replacement physical card costs $4.99 or the equivalent in the card currency.

## Kraken Prop

Kraken Prop plan prices are dynamic and appear before purchase.
Current account sizes are $5,000, $10,000, $25,000, $50,000, $100,000, and $200,000.
The default profit split is 80% to the participant and 20% to Kraken Prop.
A 90% participant split add-on costs 20% of the base plan price.
Trading commission is 0.04% per side at opening and closing.
Margin funding is 0.033% per day and is charged every four hours.

## OTC, Prime, Custody, and institutional programs

OTC spread, Prime service, custody, financing, and institutional liquidity terms can be quote-based or negotiated.
The public pages do not provide a complete universal rate table.
The observatory must represent these as account-specific terms instead of zero.
Account storage, maintenance, inactivity, and transfers between eligible Kraken futures wallets are currently described as free where the product article says so.

## Worked position examples

### Spot taker example

A Tier 8 client buys $100,000 of BTC/USD as a taker.

```text
execution fee = $100,000 × 0.20% = $200
```

A later $105,000 taker sale pays another `105,000 × 0.20% = $210`.
The round-trip execution cost is $410 before spread and slippage.

### International perpetual taker example

A Tier 8 client opens a $100,000 perpetual position as a taker.

```text
entry commission = $100,000 × 0.0225% = $22.50
```

An equal-notional taker close costs another $22.50.
The round-trip commission is $45 before funding, spread, slippage, collateral conversion, and liquidation risk.

### Spot margin example

A client receives $100,000 of extended USD.
The displayed opening rate is 0.025% and the locked rollover rate is 0.025% every four hours.
The opening order and later closing order are taker fills at 0.20%.
The position remains open for eight hours and closes at the same notional.

```text
opening trade fee = $100,000 × 0.20% = $200
margin opening fee = $100,000 × 0.025% = $25
two rollover fees = $100,000 × 0.025% × 2 = $50
closing trade fee = $100,000 × 0.20% = $200
total = $475
```

This example uses displayed rates only to show the calculation.
Live margin rates can differ.

## Required observatory fields

Store at least these fields for every fee rule:

| Field | Reason |
| --- | --- |
| `venueEntity` | Global, EEA, United States, and brokerage schedules differ. |
| `productFamily` | Spot, margin, perpetual, futures, options, and consumer products use different models. |
| `symbolOrGroup` | Pair-specific and collateral-group exceptions exist. |
| `accountTier` | Maker and taker rates depend on the effective tier. |
| `makerRate` and `takerRate` | Both paths are needed for execution simulation. |
| `fixedCharge` | United States futures and transfer rails can use fixed amounts. |
| `fundingRate` and `nextFundingTime` | Funding changes the holding cost. |
| `marginOpenRate` and `rolloverRate` | Spot margin has dynamic non-trading charges. |
| `conversionRate` | Multi-M collateral conversion can change realized cost. |
| `minimum`, `cap`, and `currency` | Options, transfers, and regulatory charges use caps and fixed currencies. |
| `sourceUrl` and `retrievedAt` | Current values need an audit trail. |
| `effectiveAt` and `expiresAt` | Promotions and announced changes must not leak into the wrong period. |
| `accountVerified` | Signed-in rates should override public defaults. |

## Known conflicts and live-only values

| Topic | Public conflict or limitation | Required treatment |
| --- | --- | --- |
| Cross-platform tier qualification | One support page omits futures qualification. | Use the newer main schedule and signed-in tier. |
| International derivatives tiers | An older operational article shows the previous table. | Use the current main schedule for rates. |
| Flexible staking commission | The top-level fee page says 20% and the newer staking article says 30%. | Use 30% and retain the conflict note. |
| SEC Section 31 fee | An older brokerage PDF says zero and the newer article lists $27.80 per $1 million. | Use the newer article. |
| USDe promotion | The zero-fee period ended on 2026-06-30. | Do not use it for current estimates. |
| Margin opening and rollover | Rates are dynamic. | Capture the order form values. |
| Crypto withdrawals | Asset and network fees are dynamic. | Capture the confirmation preview. |
| Cash rails | Availability and provider charges vary by region and account. | Capture the signed-in funding page. |
| OTC, Prime, Custody, and institutional credit | Complete public schedules do not exist. | Store negotiated or quoted account terms. |

## Source ledger

Every source below was retrieved on 2026-07-26.

| Official source | Applies to | Supports |
| --- | --- | --- |
| [Kraken fee schedule](https://www.kraken.com/gb/features/fee-schedule) | Kraken Pro and international derivatives | Cross-platform tiers, pair groups, derivatives, options, staking, and brokerage summary |
| [July 2026 cross-platform tier announcement](https://blog.kraken.com/product/pro/new-kraken-pro-fee-tiers) | Kraken Pro | Current tier effective date and qualification model |
| [Cross-platform fee tier changes](https://support.kraken.com/articles/cross-platform-fee-tier-changes) | Kraken Pro accounts | Volume and asset qualification scope |
| [How trading fees work](https://support.kraken.com/articles/201893638-how-trading-fees-work-on-kraken) | Kraken Pro Spot | Maker, taker, currency, and rounding mechanics |
| [Spot margin opening and rollover fees](https://support.kraken.com/articles/206161568-what-are-the-fees-opening-and-rollover-for-trading-using-margin-) | Kraken Pro Margin | Dynamic opening and four-hour rollover charges |
| [International derivatives fee schedule and mechanics](https://support.kraken.com/articles/360048917612-fee-schedule) | Kraken international derivatives | Tier rates, notional, funding, settlement, and liquidation |
| [EEA derivatives fees](https://support.kraken.com/articles/fees-for-derivatives-trading-eea) | Kraken EEA derivatives | Regional maker and taker tiers |
| [Multi-M collateral conversion fees](https://support.kraken.com/hc/en-us/articles/4843323030164) | Kraken Multi-M | Collateral conversion schedules |
| [Options contract specifications](https://support.kraken.com/articles/options-contract-specifications) | Kraken Options | Pair identifier, notional, premium cap, and cash settlement |
| [United States futures fees](https://support.kraken.com/articles/us-futures-fees) | Kraken Derivatives US | Per-contract commissions and pass-through charges |
| [United States futures liquidations](https://support.kraken.com/articles/us-futures-liquidations) | Kraken Derivatives US | CME, perpetual, and mixed-account liquidation charges |
| [United States futures market data](https://support.kraken.com/articles/market-data) | Kraken Derivatives US | CME and Bitnomial entitlements and monthly prices |
| [Consumer Kraken fees](https://support.kraken.com/articles/360030303832-overview-of-fees-on-kraken) | Kraken consumer | Instant, recurring, custom, conversion, and consumer perpetual charges |
| [Kraken+ subscription](https://support.kraken.com/articles/kraken-faq-subscription-service-overview) | Kraken+ | Subscription price, waiver limit, and exclusions |
| [Stocks availability and current regulatory fees](https://support.kraken.com/articles/getting-started-with-equities) | Kraken securities brokerage | Availability, lending costs, and current regulatory charges |
| [United States brokerage fee schedule](https://assets-cms.kraken.com/files/51n36hrp/facade/49b02a823b4edc743b8c0488f2ed8ae5231663ca.pdf) | Kraken United States brokerage | Commission, transfer, service, and regulatory schedule |
| [Staking overview](https://support.kraken.com/articles/360037682011-overview-of-staking-on-kraken) | Kraken staking and Auto Earn | Commission tiers, bonded terms, and regional boundaries |
| [Borrow](https://support.kraken.com/articles/borrow) | Kraken Borrow | Interest, origination, liquidation, and repayment treatment |
| [Flexline fees](https://support.kraken.com/articles/flexline-fees) | Kraken Flexline | Subscription, interest, late, and liquidation charges |
| [Cash deposit fees](https://support.kraken.com/articles/360000381846-cash-deposit-options-fees-minimums-and-processing-times-) | Kraken cash deposits | Rail, currency, fee, minimum, and provider treatment |
| [Cash withdrawal fees](https://support.kraken.com/articles/360000423043-cash-withdrawal-options-fees-minimums-and-processing-times) | Kraken cash withdrawals | Rail, currency, fee, and minimum treatment |
| [Crypto deposit fees](https://support.kraken.com/articles/360000292886-cryptocurrency-deposit-fees-and-minimums) | Kraken crypto deposits | Asset, address, and minimum charges |
| [Crypto withdrawal fees](https://support.kraken.com/articles/360000767986-cryptocurrency-withdrawal-fees-and-minimums) | Kraken crypto withdrawals | Dynamic asset and network charges |
| [Crypto deposit recovery](https://support.kraken.com/articles/crypto-assets-deposit-recovery) | Kraken deposit recovery | Recovery eligibility and charge |
| [Krak Card FAQ](https://support.kraken.com/articles/krak-card-faqs) | Krak Card | Card, conversion, and replacement charges |
| [Kraken Prop plans and pricing](https://support.kraken.com/articles/kraken-prop-plans-and-pricing) | Kraken Prop | Evaluation, reset, activation, and reward terms |

## Production validation

The following work requires a live account or negotiated terms and remains outside this documentation-only research:

- Recheck the signed-out main fee table against a signed-in account.
- Verify every regional entity applicable to the production accounts.
- Confirm all current maker-rebate pair memberships.
- Capture account-specific OTC, Prime, Custody, and financing terms.
- Recheck dynamic rail and network fees during implementation.
