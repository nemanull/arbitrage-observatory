# Bybit Fee Profile

**Status:** Done.

**Retrieved:** 2026-07-26.

## Scope and source priority

Bybit operates global and separately regulated regional platforms with different products and fee schedules.
This profile separates the global platform from Bybit EU, Bybit Indonesia, Bybit Türkiye, Bybit Georgia, Bybit Kazakhstan, and tax rules that apply to eligible customers in the United Arab Emirates and India.
Product availability still depends on residence, account entity, eligibility, and the current restricted-jurisdiction policy.

The signed `GET /v5/account/fee-rate` response and the signed-in My Fee Rate page are the sources of record for an account.
The current entity-specific Help Center is the next source of record.
The global Help Center follows after the entity-specific material.
Older Learn articles and old identifier-based Help Center pages are not used to resolve a conflict with a newer fee page.

Values marked dynamic must be read from the stated preview, account page, contract specification, or authenticated API response.
Values marked account-gated require an eligible account.
Values marked negotiated require a Bybit agreement or representative.
The absence of a published number does not mean that a service is free.

## Quick answer for a buy or sell

Buy and sell direction does not determine the maker or taker rate.
An order that immediately consumes resting liquidity is a taker order.
An order that rests and later supplies liquidity is a maker order.
The applicable entity, product family, symbol group, account tier, and order role determine the rate.

```text
spot or linear derivatives fee = executed quantity × execution price × applicable rate
inverse derivatives fee = contract quantity ÷ execution price × applicable rate
round-trip trading fee = opening fee + closing fee
total derivatives cost = round-trip trading fee + funding + settlement or delivery + liquidation costs when applicable
```

A displayed spread is not executable profit until both venues' fees, depth, funding, borrow, conversion, and transfer costs are included.

## Product and fee coverage

| Product or service | Published pricing state | Important boundary |
| --- | --- | --- |
| Spot | Published VIP, Pro, market-maker, and special-zone schedules | Regional schedules can replace global rates |
| Spot margin | Spot trading fee plus dynamic hourly borrowing and a published liquidation fee | Availability and rates are account dependent |
| USDT and USDC perpetuals | Published VIP, Pro, market-maker, and special-market schedules | Funding is dynamic |
| Linear and inverse expiring futures | Published trading rates plus contract-specific settlement treatment | Current official pages conflict on USDT expiry settlement |
| Options | Published trading, delivery, and liquidation formulas | Product and delivery-asset rates differ |
| Spread trading | Discount relative to separate leg execution | Absolute fee remains tier and leg dependent |
| Convert and OTC | No separately stated trading fee | The executable quote contains the economic spread |
| P2P | Usually zero with published currency and advertiser exceptions | Currency and ad direction control the charge |
| Alpha Trading and Alpha Farming | Published trading, investment, and withdrawal rates | Network fees and slippage remain dynamic |
| Trading bots | No separate bot-use fee plus ordinary execution charges | Perpetual bots also incur funding |
| Copy Trading | Ordinary or prescribed trading rates plus profit sharing | Classic, Pro, and TradFi programs differ |
| Unified Trading Account borrowing | Dynamic interest and conversion handling charges | Current repayment flow replaces an older static rate |
| Crypto Loans and institutional loans | Dynamic or negotiated interest plus published liquidation rules | Product agreement controls the final amount |
| Deposits and withdrawals | Usually dynamic by asset, network, fiat currency, and method | Preview is authoritative |
| One-Click Buy and bank cards | Published method tables plus checkout-specific pricing | Payment provider charges can also apply |
| Easy Earn and Liquidity Mining | APR-embedded or no direct add and remove fee | Slippage and unpublished management effects remain |
| On-Chain Earn | Protocol-specific service fee | Product page controls the rate |
| Launchpool and structured products | Product terms, APR, and borrowing costs | A missing fee row is not assumed to be zero |
| TradFi | Spread-inclusive mode or fixed commission per lot | Overnight swaps are dynamic |
| Bybit Card | Published regional schedule | External ATM, merchant, tax, and conversion charges can apply |
| Custody and off-exchange settlement | Agreement and network dependent | No universal public custody percentage is published |
| MNT fee payment | Published retail and VIP discount table | Eligibility and transferable balance rules apply |
| Market-maker and broker programs | Published rebates or account agreement | Qualification and symbol grouping are dynamic |

## Global retail and VIP trading rates

The following global tables come from the Trading Fee Structure page updated on 2026-07-23.
All values are percentages.
The rate in force when an order is placed applies to that order.

### Standard product rates

| Tier | Spot taker | Spot maker | Derivatives taker | Derivatives maker | Options taker | Options maker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| VIP 0 | 0.1000% | 0.1000% | 0.0550% | 0.0200% | 0.0300% | 0.0200% |
| VIP 1 | 0.0800% | 0.0675% | 0.0400% | 0.0180% | 0.0200% | 0.0150% |
| VIP 2 | 0.0775% | 0.0650% | 0.0375% | 0.0160% | 0.0200% | 0.0150% |
| VIP 3 | 0.0750% | 0.0625% | 0.0350% | 0.0140% | 0.0200% | 0.0150% |
| VIP 4 | 0.0600% | 0.0500% | 0.0320% | 0.0120% | 0.0180% | 0.0150% |
| VIP 5 | 0.0500% | 0.0400% | 0.0320% | 0.0100% | 0.0150% | 0.0100% |
| Supreme VIP | 0.0450% | 0.0300% | 0.0300% | 0.0000% | 0.0150% | 0.0050% |

### Global VIP qualifications

A user qualifies by satisfying any one published criterion.
Asset, borrowing, volume, and structured-product values are USD equivalents.
Volumes use trailing 30-day activity unless the page states otherwise.

| Tier | Asset balance | Average borrowing | Spot volume | Derivatives volume | Options volume | Structured products |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| VIP 0 | At least $0 | At most $50,000 | At most $1 million | At most $10 million | At most $5 million | At least $0 |
| VIP 1 | At least $100,000 | At least $50,000 | At least $1 million | At least $10 million | At least $5 million | At least $500,000 |
| VIP 2 | At least $250,000 | At least $500,000 | At least $5 million | At least $25 million | At least $10 million | At least $1 million |
| VIP 3 | At least $500,000 | At least $1 million | At least $10 million | At least $50 million | At least $15 million | At least $1.5 million |
| VIP 4 | At least $1 million | At least $1.5 million | At least $25 million | At least $100 million | At least $25 million | At least $2.5 million |
| VIP 5 | At least $2 million | At least $2 million | At least $50 million | At least $250 million | At least $40 million | At least $4 million |
| Supreme VIP | Not available | Not available | At least $100 million | At least $500 million | At least $100 million | At least $10 million |

VIP 4 and higher volume qualification normally requires API volume to remain at or below 20%.
The published exception is VIP 5 Spot and derivatives volume, where the table does not repeat that API-share restriction.
Main-account and subaccount balances and volume aggregate.
Subaccounts inherit the main account tier.
The tier refresh runs daily at 07:00 UTC.
Zero-fee Spot volume and funding payments do not count.
Alpha buys and sells count toward Spot volume.
An options fill counts only when its price exceeds the underlying price multiplied by the non-VIP taker rate multiplied by four.
TradFi metals and non-oil commodity volume is divided by 60 for qualification.
TradFi oil, foreign exchange, index, and stock volume is divided by 15 for qualification.

### Adventure Zone and xStocks

| Tier | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 | 0.2000% | 0.2000% |
| VIP 1 | 0.1500% | 0.1000% |
| VIP 2 | 0.1300% | 0.0975% |
| VIP 3 | 0.1100% | 0.0925% |
| VIP 4 | 0.0900% | 0.0750% |
| VIP 5 | 0.0750% | 0.0600% |
| Supreme VIP | 0.0675% | 0.0450% |

### Pre-market perpetuals

| Tier | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 | 0.1000% | 0.0400% |
| VIP 1 | 0.0800% | 0.0360% |
| VIP 2 | 0.0700% | 0.0320% |
| VIP 3 | 0.0600% | 0.0280% |
| VIP 4 | 0.0500% | 0.0240% |
| VIP 5 | 0.0500% | 0.0200% |
| Supreme VIP | 0.0450% | 0.0000% |

The call-auction funding rate is zero.
Continuous pre-market trading uses a fixed 0.005% funding rate every four hours.

### Innovation Zone

| Tier | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 | 0.1100% | 0.0400% |
| VIP 1 | 0.0800% | 0.0330% |
| VIP 2 | 0.0690% | 0.0300% |
| VIP 3 | 0.0640% | 0.0260% |
| VIP 4 | 0.0480% | 0.0180% |
| VIP 5 | 0.0480% | 0.0150% |
| Supreme VIP | 0.0450% | 0.0000% |

### Fiat-pair rates

| Tier and trailing 30-day fiat volume | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 below $100,000 | 0.2000% | 0.1500% |
| VIP 0 at least $100,000 | 0.2000% | 0.1000% |
| VIP 0 at least $275,000 | 0.1500% | 0.1000% |
| VIP 0 at least $550,000 | 0.1200% | 0.1000% |
| VIP 1 at least $1 million | 0.1000% | 0.0675% |
| VIP 2 at least $5 million | 0.0775% | 0.0650% |
| VIP 3 at least $10 million | 0.0750% | 0.0625% |
| VIP 4 at least $25 million | 0.0600% | 0.0500% |
| VIP 5 at least $50 million | 0.0500% | 0.0400% |
| Supreme VIP at least $100 million | 0.0450% | 0.0300% |

## Global Pro program

Pro qualification requires API volume above 20%.
Affiliate and referral users cannot receive Pro status even when the API-volume threshold is met.
Fee-bearing Request for Quote volume counts.
Zero-fee Request for Quote volume does not count.

| Pro tier | Spot taker | Spot maker | Derivatives taker | Derivatives maker | Options taker | Options maker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pro 1 | 0.0600% | 0.0400% | 0.0320% | 0.0100% | 0.0180% | 0.0150% |
| Pro 2 | 0.0500% | 0.0300% | 0.0320% | 0.0050% | 0.0150% | 0.0100% |
| Pro 3 | 0.0400% | 0.0200% | 0.0275% or 0.0320% | 0.0000% | 0.0150% | 0.0050% |
| Pro 4 | 0.0300% | 0.0150% | 0.0240% or 0.0280% | 0.0000% | 0.0150% | 0.0050% |
| Pro 5 | 0.0200% | 0.0100% | 0.0210% or 0.0280% | 0.0000% | 0.0100% | 0.0000% |
| Pro 6 | 0.0150% | 0.0050% | 0.0180% or 0.0280% | 0.0000% | 0.0100% | 0.0000% |

The lower Pro 3 through Pro 6 derivatives taker rate applies to inverse contracts, all futures, and the documented top 72 USDT perpetuals.
The other USDT perpetuals use the higher rate.
The public Fee Group Information endpoint is safer than a copied symbol list because Bybit can change group membership.

| Pro tier | Spot volume | Derivatives volume | Options volume |
| --- | ---: | ---: | ---: |
| Pro 1 | At least $25 million | At least $100 million | At least $25 million |
| Pro 2 | At least $50 million | At least $250 million | At least $40 million |
| Pro 3 | At least $100 million | At least $750 million | At least $100 million |
| Pro 4 | At least $200 million | At least $1.5 billion | At least $300 million |
| Pro 5 | At least $500 million | At least $3 billion | At least $500 million |
| Pro 6 | At least $1 billion | At least $5 billion | At least $5 billion |

Pro 5 can also qualify through at least 10% of total maker volume.

| Pro tier and fiat volume | Fiat taker | Fiat maker |
| --- | ---: | ---: |
| Pro 1 at least $25 million | 0.0600% | 0.0500% |
| Pro 2 at least $50 million | 0.0500% | 0.0400% |
| Pro 3 at least $100 million | 0.0450% | 0.0300% |
| Pro 4 at least $200 million | 0.0400% | 0.0300% |
| Pro 5 at least $500 million | 0.0150% | 0.0050% |
| Pro 6 at least $1 billion | Not publicly specified | Not publicly specified |

The official Pro 6 fiat row omits both fee cells.
The missing cells must not be inferred from the Spot table.

## Market-maker incentive program

A negative rate is a rebate paid to the maker.
Taker executions use the participant's Pro schedule.
New participants receive the published one-month trial period.

### Spot market makers

| Level | Qualification | Maker rate |
| --- | --- | ---: |
| MM 1 | More than $25 million in 30-day USDT volume | -0.0010% |
| MM 2 | At least 0.10% maker share | -0.0050% |
| MM 3 | At least 1.00% maker share or the liquidity requirement | -0.0075% |

Zero-fee Spot volume is excluded.

### Perpetual and futures market makers

| Level | Group 1 | Group 2 | Group 3 | Group 4 | Group 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| MM 1 | -0.0010% | -0.0010% | -0.0025% | -0.0050% | -0.0075% |
| MM 2 | -0.0025% | -0.0025% | -0.0050% | -0.0075% | -0.0100% |
| MM 3 | -0.0040% | -0.0040% | -0.0075% | -0.0100% | -0.0125% |

Group weighting factors are 1, 5, 8, 15, and 20.
The weighted maker-share requirements are 0.03%, 0.50%, and 1.00% for MM 1 through MM 3.
An eligible order must be at least ten times the symbol's minimum order size.
Pre-market and Innovation Zone products are excluded.
Bybit reviews symbol groups monthly.

### Options market makers

| Level | Maker rate | Qualification |
| --- | ---: | --- |
| MM 1 | 0.0000% | Published liquidity requirement |
| MM 2 | -0.0050% | Published liquidity requirement |

Bybit evaluates the program monthly and aggregates main-account and subaccount activity.

### Future-dated TradFi market-maker change

An official announcement schedules new TradFi API maker rebates for 2026-07-28.
That date is after this profile's retrieval date.
The announced MM 1, MM 2, and MM 3 rebates are -0.0025%, -0.0050%, and -0.0075%.
They must not be presented as current on 2026-07-26.

## Spot trading

The fee is the purchased quantity multiplied by the applicable rate.
Bybit charges the fee in the asset received.
The unfilled or canceled portion has no trading fee.

```text
buy fee in base asset = filled base quantity × rate
sell fee in quote asset = filled quote quantity × rate
```

## Perpetual and futures trading

### Linear USDT and USDC contracts

```text
fee in settlement asset = executed quantity × execution price × applicable rate
```

A ten BTC taker execution at $8,000 and 0.0550% costs 44 USDT.
A ten BTC maker execution at $8,000 and 0.0200% costs 16 USDT.

### Inverse contracts

```text
fee in base settlement asset = contract quantity ÷ execution price × applicable rate
```

A 10,000 USD inverse taker execution at $8,000 and 0.0550% costs 0.0006875 BTC.
A 10,000 USD inverse maker execution at $8,000 and 0.0200% costs 0.0002500 BTC.

### Expiry, settlement, and delisting

Inverse expiring futures use a fixed 0.0500% automatic settlement fee without VIP discount or rebate.
The current Perpetual and Futures Contract Fees Explained page says USDT expiring futures have no settlement fee.
An official USDT contract FAQ still says that the settlement fee is 0.0500%.
This conflict remains unresolved.
The logged-in contract and fee display must resolve it before trading.

Delisting settlement for all contract types uses a fixed 0.0500% fee.
The standard global fee overview says Bybit does not charge a separate perpetual or futures liquidation fee.

## Perpetual funding

Funding is exchanged between long and short holders.
It is not retained as the ordinary Bybit trading fee.
Positive funding means longs pay shorts.
Negative funding means shorts pay longs.
Only a position held at the funding timestamp participates.
An open or close within about five seconds of the timestamp is not guaranteed to avoid the payment.

```text
linear funding payment = quantity × mark price × funding rate
inverse funding payment = contract quantity ÷ mark price × funding rate
```

A ten BTC linear position at an $8,000 mark and a 0.0100% rate pays 8 USDT.
A 10,000 USD inverse position at an $8,000 mark and a 0.0100% rate pays 0.000125 BTC.

The funding interval and rate limits are symbol specific.
Bybit can change an interval to hourly when the rate reaches its cap.
The standard calculation is shown below.

```text
funding rate = clamp(premium index + clamp(interest rate - premium index, -0.05%, 0.05%), lower limit, upper limit)
```

The interest component is normally 0.0100% for an eight-hour interval.
The normal cap uses the initial-margin and maintenance-margin rates.
Bybit can change the dislocation coefficient from 0.5 to 1 during severe conditions.

## Options

### Trading

The standard non-VIP taker and maker rates are 0.0300% and 0.0200%.
The premium cap prevents the fee from exceeding a percentage of the option premium.

```text
options trading fee = min(rate × index price, premium cap × option premium) × option size
```

The normal premium cap is 7%.
The Pro 1 cap is 7%.
The Pro 2 through Pro 4 cap is 6%.
The Pro 5 and Pro 6 cap is 4%.

### Delivery

| Delivery asset | Rate |
| --- | ---: |
| BTC and ETH | 0.0150% |
| SOL, MNT, XRP, and DOGE | 0.0200% |

The delivery fee is capped at 12.5% of the option's intrinsic value.
Both the exercised buyer and exercised seller pay.
An unexercised option has no delivery fee.
Daily options have no delivery fee.
Bybit derives the delivery price during the published 07:30 to 08:00 UTC window.

```text
call delivery fee = min(rate × delivery price, 12.5% × max(delivery price - strike, 0)) × size
put delivery fee = min(rate × delivery price, 12.5% × max(strike - delivery price, 0)) × size
```

### Liquidation

The options liquidation rate is 0.2000%.
The amount goes to the insurance fund after the trading fee is charged.

```text
options liquidation fee = min(0.2% × index price, 7% × option premium) × size
```

## Reserved order cost

Bybit's displayed order cost can reserve initial margin, opening fee, and an estimated closing fee.
The estimate uses the bankruptcy price and the non-VIP taker rate.
The actual closing fee still uses the real maker or taker role, execution price, and current tier.

```text
linear initial margin = quantity × order price ÷ leverage
inverse initial margin = quantity ÷ order price ÷ leverage
```

The reserve is a capital requirement rather than proof of the final fee.

## Spread trading

Bybit states that Spread Trading fees are 50% lower than executing both legs separately.
The absolute amount still depends on the user's tier and the two component legs.
The profile does not turn that relative discount into a universal static rate.

## Spot margin and Unified Trading Account borrowing

### Spot margin

Spot margin uses the applicable Spot trading rate.
Borrowing interest accrues in hourly increments.
Any partial hour rounds up under the published Spot Margin rule.

```text
hourly interest = borrowed amount × daily interest rate ÷ 24
```

The daily rate is dynamic by asset and VIP level.
Spot Margin liquidation costs 2%.

### Flexible Unified Trading Account borrowing

The first Spot liability accrual is prorated until the next five-minute point after the hour.
Later accrual is hourly.
Derivatives liability is measured at the five-minute point after the hour.
The hourly rate is dynamic.

Perpetual and expiry unrealized losses receive the following published interest-free borrowing ranges.

| Tier | USDT range | USDC range |
| --- | ---: | ---: |
| Non-VIP | $30,000 | $15,000 |
| VIP 1 through VIP 3 | $50,000 | $25,000 |
| VIP 4 through Supreme VIP and Pro 1 through Pro 6 | $70,000 | $35,000 |

The penalty formula increases with utilization.

```text
penalty interest = borrowed amount × hourly rate × utilization³
```

Manual repayment through asset conversion charges the higher current repayment fee rate of the collateral asset and borrowed asset.
The current repayment flow no longer supports the older blanket 0.1000% statement as a universal value.
Automatic repayment triggered at a maintenance-margin rate of at least 100% charges 2%.
Automatic repayment triggered by the maximum borrowing limit charges 1%.

### Fixed Unified Trading Account borrowing

Fixed-loan interest is charged upfront.
Early repayment does not refund that interest.

```text
fixed interest = principal × annual rate × term days ÷ 365
```

## Crypto Loans

Borrower interest and available rates are dynamic.
Flexible-loan interest compounds hourly.
Fixed loans have a published 24-hour grace period.
Penalty interest during the fixed-loan grace process is three times the regular hourly amount.
Early repayment does not refund fixed-loan interest.
Liquidation costs 2%.
Conversion repayment uses the higher current repayment fee rate of the collateral and debt assets.

Suppliers pay a 10% management fee from ordinary interest.
Suppliers pay 30% of overdue interest to Bybit.

## Premier and institutional loans

Premier Loans have a published minimum of $300,000.
Interest is charged upfront and is not refunded on early repayment.

```text
Premier Loan interest = loan amount × annual rate × duration days ÷ 365
```

Premier liquidation costs 2% of the loan amount.
Premier conversion repayment uses the higher current rate of the two assets.

Institutional Loans have a published minimum of $1 million and maximum leverage of five.
The interest rate is negotiated through a representative.
Liquidation conversion or settlement costs 2% of the liquidated amount.

## Asset movement

| Activity | Bybit charge |
| --- | --- |
| On-chain crypto deposit | No Bybit fee |
| Internal transfer between eligible Bybit accounts | No Bybit fee |
| On-chain crypto withdrawal | Dynamic fixed amount by coin and chain in the withdrawal preview |
| Fiat deposit | Dynamic by currency, method, entity, and account |
| Fiat withdrawal | Dynamic by currency, method, entity, and account |
| Unsupported-asset recovery | Dynamic when the recovery flow is available |

Network validators, payment providers, correspondent banks, and receiving institutions can add charges outside Bybit's fee.

## Convert, OTC, and small balances

Standard Convert and OTC publish no separate trading fee.
The final executable quote remains the source of the economic spread.
One-Click OTC supports published sizes from $20,000 through $2 million.
Convert OTC supports published sizes from $50,000 through $10 million.

Small-balance conversion to MNT charges 2%.
Each converted asset must not exceed a $200 equivalent.
The minimum resulting amount is 0.00000001 MNT.

## P2P

Bybit charges only completed P2P orders.
Most combinations are zero, but the detailed currency schedule contains the following exceptions.

| Currency and ad direction | Advertiser level | Maker | Taker |
| --- | --- | ---: | ---: |
| NGN buy ad | General | 0.300% | 0.000% |
| NGN buy ad | Verified | 0.275% | 0.000% |
| NGN buy ad | Block | 0.250% | 0.000% |
| NGN sell ad | All | 0.000% | 0.000% |
| AZN ad against listed crypto | All | 0.250% | 0.250% |
| USD or EUR ad for Azerbaijan-verified advertiser | All | 0.250% | 0.250% |
| RUB buy ad | All | 0.000% | 0.000% |
| RUB sell ad | General | 0.300% | 0.000% |
| RUB sell ad | Verified | 0.275% | 0.000% |
| RUB sell ad | Block | 0.250% | 0.000% |
| GHS buy ad | General | 0.140% | 0.000% |
| GHS buy ad | Bronze | 0.110% | 0.000% |
| GHS buy ad | Silver | 0.100% | 0.000% |
| GHS buy ad | Gold | 0.070% | 0.000% |
| GHS buy ad | Block | 0.050% | 0.000% |
| GHS sell ad | All | 0.000% | 0.000% |

The detailed table overrides the global overview's simplified statement that P2P is free.

## One-Click Buy and sell

The checkout preview controls the final charge.
The current FAQ publishes these method-specific buy charges.

| Buy method | Charge |
| --- | --- |
| PLN through BLIK | 0.9% plus 0.5 PLN |
| JPY through eCheck | 3.5% plus 2,000 JPY |
| ZAR through Instant EFT | 1.5% with a 1 ZAR minimum |
| NGN through bank transfer | 0.5% with a 55 NGN minimum |
| ARS, BRL, BOB, MXN, CLP, or USD through bank card | Current bank-card schedule |

The same FAQ publishes these One-Click sell charges.

| Fiat currency | Charge |
| --- | --- |
| AED | 2.1% plus 35 AED |
| AUD | 2.1% plus 7 AUD |
| BDT | 2.1% plus 350 BDT |
| BND | 2.2% plus 8 BND |
| CRC | 2.5% plus 2,800 CRC |
| DKK | 2.2% plus 40 DKK |
| EUR | 2.1% plus 5 EUR |
| GHS | 2.8% plus 90 GHS |
| HUF | 2.3% plus 1,900 HUF |
| INR | 2.1% plus 340 INR |
| JPY | 2.3% plus 2,700 JPY |
| LKR | 2.0% plus 1,250 LKR |
| NPR | 2.3% plus 500 NPR |
| NOK | 2.1% plus 60 NOK |
| PKR | 2.3% plus 1,300 PKR |
| PLN | 2.1% plus 23 PLN |
| SAR | 2.3% plus 52 SAR |
| SEK | 2.2% plus 53 SEK |
| USD | 2.2% plus 10 USD |
| VND | 2.2% plus 145,000 VND |
| ZAR | 2.2% plus 135 ZAR |

Third-party Buy Crypto providers set their own checkout fee.
Bybit says it does not add a separate charge to the provider's displayed amount.

## Bank-card payments

| Card route | Published charge |
| --- | ---: |
| European Union Visa or Mastercard | 1.10% |
| Non-European Union Visa | 3.05% |
| Non-European Union Mastercard | 2.70% |
| Apple Pay | 1.80% plus 0.24 EUR |

The payment screen controls the exact currency and account charge.
The issuing bank can add cash-advance, foreign-exchange, or other external charges.

## Alpha Trading and Alpha Farming

Alpha Trading charges a fixed 0.5000% of the total spending amount across supported coins and networks.
Network fees and slippage remain dynamic and appear in the confirmation flow.

```text
Alpha Trading fee = total spending amount × 0.5000%
```

The current Alpha Farming page publishes these pool rates.

| Pool | Protocol | Investment fee | Withdrawal fee |
| --- | --- | ---: | ---: |
| SOL-USDC | Orca | 0.0% | 1.0% |
| XAUt0-USDT | Byreal | 0.0% | 0.5% |
| TSLAx-USDC | Byreal | 0.0% | 1.0% |
| NVDAx-USDC | Byreal | 0.0% | 1.0% |
| SPYx-USDC | Byreal | 0.0% | 1.0% |
| QQQx-USDC | Byreal | 0.0% | 1.0% |
| MON-USDC | Byreal | 0.0% | 1.0% |
| HYPE-USDC | Byreal | 0.0% | 1.0% |
| JLP-USDC | Byreal | 0.0% | 1.0% |
| WETH-USDC | Byreal | 0.0% | 1.0% |
| SOL-USDC | Byreal | 0.0% | 1.0% |
| USDC-USDT | Byreal | 0.0% | 0.5% |

The investment fee applies to the paid amount.
The withdrawal fee applies to the received amount.
The supported pool list and rates can change.

## Trading bots and Copy Trading

Bybit does not charge a separate fee for using its Grid, Dollar-Cost Averaging, or Martingale bots.
Every filled bot order still pays the applicable Spot or derivatives trading fee.
A derivatives bot also participates in funding.
The Dollar-Cost Averaging bot uses the ordinary Spot fee schedule and does not add a bot fee.

### Copy Trading Classic

Followers pay the applicable derivatives trading fees and funding.
They also share net copy-trading profit with the Master Trader.

| Master Trader rank | Profit-sharing ratio |
| --- | ---: |
| Cadet | 10% |
| Bronze | 10% |
| Silver | 12% |
| Gold | 15% |

The system offsets profit and loss over the settlement cycle before final profit sharing.
Slippage and different entry points can make follower results differ from Master Trader results.

### Copy Trading Pro

Copy Trading Pro applies the VIP 1 trading rate to all strategy trades regardless of the investor's personal VIP level.
Its derivatives funding uses the ordinary Bybit funding rules.
The strategy can set profit sharing from 0% through 30%.
The exact ratio appears in the strategy terms before investment.

### TradFi Copy Trading

TradFi Copy Trading is fixed to Tight-Spread mode.
Its executions use the TradFi commission and swap schedule in this profile.
The dedicated profit-sharing page publishes the following rank table.

| Master Trader rank | Profit-sharing ratio |
| --- | ---: |
| Cadet | 15% |
| Bronze | 20% |
| Silver | 25% |
| Gold | 30% |

Profit sharing uses a high-water-mark model and is charged only after cumulative net profit exceeds the prior high.
The current general TradFi Copy Trading introduction separately describes a 0% through 15% range.
This conflict must be resolved from the selected Master Trader profile before following.

## On-Chain Earn, Launchpool, and structured products

On-Chain Earn charges a service fee that varies by protocol.
The product page controls the rate, bonding period, unbonding period, payout frequency, and any network effects.
Bybit manages gas and node operations, but it does not publish one universal service percentage.

Launchpool does not publish a separate participation charge in its current FAQ.
Borrow and Stake can create Crypto Loan interest and repayment costs.
Project APR, pool caps, and supported assets are dynamic.

The current Dual Asset FAQ does not list a separate subscription or settlement fee.
Its economic result depends on the target price, settlement price, invested asset, term, and displayed APR.
The confirmation page and current product terms must be checked rather than interpreting the missing fee row as a permanent zero.

## Easy Earn, liquidity, wealth, and custody

Easy Earn does not display a separately debited user fee.
Bybit states that its management fee is reflected in the advertised APR.
The management percentage is not publicly specified.
Flexible and fixed APRs and investment limits are dynamic.

Liquidity Mining does not charge a separate add-liquidity or remove-liquidity fee.
Slippage can still change the received amount.
The current FAQ does not publish one static swap-fee percentage.
Automatic rebalancing conversion does not have a separate fee.

The published classic Wealth Management FAQ states that Bybit does not impose a fee.
Early redemption can reduce the APR.
Private Wealth Management uses tailored plans and a signed-in dashboard.
No universal Private Wealth Management fee table is published.

The off-exchange custody agreement does not publish one universal custody percentage.
It requires the client to pay prevailing withdrawal and network gas charges under the agreement and its schedule.
Bybit can revise those charges under the agreement's notice terms.

## TradFi

Zero-Fee mode embeds Bybit's commission in the quoted spread.
Tight-Spread mode charges the following fixed amount per lot when a position opens.

| Instrument class | Tight-Spread commission |
| --- | ---: |
| Foreign exchange | $6.00 per lot |
| Metals | $6.00 per lot |
| Non-oil commodities | $3.00 per lot |
| Oil | $3.00 per lot |
| Nikkei 225 | $0.10 per lot |
| HK50 | $1.50 per lot |
| TWINDEX | $1.50 per lot |
| HKTECH | $0.50 per lot |
| Other indices | $3.00 per lot |
| United States stock CFDs | $0.02 per lot with a $0.20 order minimum |

```text
Tight-Spread commission = lots × commission per lot
```

Overnight swap rates are dynamic by instrument, direction, and day.
The MT5 contract specification is the source of record.
Many instruments apply a three-day swap on one weekly rollover day.

## Bybit Card

### Issuance and management

| Region or program | Published physical-card issuance |
| --- | --- |
| Australia | 29.99 USD |
| Argentina | 5 USD or USDT |
| Brazil | No Bybit issuance charge |
| AIFC, Georgia, and Kazakhstan | 29.99 USDT |
| Asia-Pacific program | 5 USDT |
| Mexico | No Bybit issuance charge |
| Eligible VIP in Australia, AIFC, Georgia, Kazakhstan, or Asia-Pacific | Waived |

Virtual issuance and replacement are waived until further notice under the current schedule.
The flattened official table lists no annual, inactivity, or cancellation charge for the programs shown.
The live regional card page must resolve any row-alignment ambiguity before issuance.

### Transactions

| Region | Foreign exchange | Crypto conversion | Foreign-exchange padding | Bybit ATM charge |
| --- | ---: | ---: | ---: | --- |
| Australia | 1.0% | 0.9% | 0.0% | 2% after the first $100 USD each month |
| Argentina | 7.0% | 0.5% | 5.0% | 2% after the first 95,000 ARS each month |
| Brazil | 1.5% | 0.9% | 3.0% | 2% after the first 550 BRL each month |
| AIFC, Georgia, Kazakhstan, and Asia-Pacific | 2.0% | 0.9% | 0.0% | 2% after the first $100 USD each month |
| Mexico | 2.0% | 0.9% | 0.0% | 2% after the published USD or MXN threshold |

MNT card conversion is published as zero where the MNT card benefit applies.
Other supported crypto uses the regional conversion rate.
ATM operators and merchants can add external charges.

Argentina card users can also face government tax.
The official Bybit card tax article lists 21% value-added tax for covered digital services, 30% income or personal-property withholding for covered foreign transactions, and provincial gross-income withholding from 1% through 13.2%.
Those amounts are tax rather than Bybit trading fees.

## MNT fee payment

MNT fee payment is available to eligible non-VIP and VIP accounts.
Market makers, institutional users, Pro users, API orders, inverse products, bots, Copy Trading followers, Request for Quote trades, and liquidations are excluded.
Eligible products include Spot, Spot Margin, USDT perpetuals and expiry contracts, and USDC perpetuals.
Pre-market products are included.

The discount is 25% from the applicable Spot rate and 10% from the applicable futures rate.

| Tier | Spot taker | Spot maker | Futures taker | Futures maker |
| --- | ---: | ---: | ---: | ---: |
| VIP 0 | 0.0750% | 0.0750% | 0.0495% | 0.0180% |
| VIP 1 | 0.0600% | 0.0507% | 0.0360% | 0.0162% |
| VIP 2 | 0.0582% | 0.0488% | 0.0338% | 0.0144% |
| VIP 3 | 0.0563% | 0.0469% | 0.0315% | 0.0126% |
| VIP 4 | 0.0450% | 0.0375% | 0.0288% | 0.0108% |
| VIP 5 | 0.0375% | 0.0300% | 0.0288% | 0.0090% |
| Supreme VIP | 0.0338% | 0.0225% | 0.0270% | 0.0000% |

Spot and futures payment must be enabled separately for every main account and subaccount.
The transferable MNT balance must cover the full fee.
An insufficient balance causes settlement in the default fee asset without the discount.
A bonus does not replace the required transferable MNT balance.

## Referral, affiliate, broker, and institutional treatment

Referral and affiliate relationships can change rebates or commissions under the current program terms.
They do not create a universal lower trading rate.
Affiliate and referral users are excluded from Pro qualification.

API Broker rebates depend on program level, eligible customer volume, and the current broker agreement.
The broker FAQ advertises a maximum rebate rather than a universal customer rate.
The signed account fee response remains authoritative for customer trading cost.

Institutional and market-maker pricing can be account-gated or negotiated.
The public market-maker table applies only after program acceptance.

## Legacy leveraged-token schedule

An older official leveraged-token page lists a 0.1000% trading fee, 0.0500% subscription fee, 0.0500% redemption fee, and 0.0050% daily management fee.
Funding is embedded in the token.
Bybit delisted the BTC and ETH leveraged tokens and terminated their API on 2025-07-04.
The old table is historical evidence and must not be presented as a current universal product schedule.

## Regional entities and taxes

### Bybit EU

Bybit EU serves eligible European Economic Area customers except Malta through its regulated European entities.
The documented trading scope is Spot and Spot Margin rather than global derivatives.

#### Crypto-pair Spot

| Tier and trailing 30-day volume | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 below $10,000 | 0.2500% | 0.1000% |
| VIP 0 at least $10,000 | 0.2500% | 0.1000% |
| VIP 0 at least $50,000 | 0.2500% | 0.1000% |
| VIP 0 at least $100,000 | 0.2200% | 0.1000% |
| VIP 0 at least $250,000 | 0.2000% | 0.1000% |
| VIP 0 at least $500,000 | 0.1500% | 0.1000% |
| VIP 1 | 0.1000% | 0.0675% |
| VIP 2 | 0.0775% | 0.0650% |
| VIP 3 | 0.0750% | 0.0625% |
| VIP 4 | 0.0600% | 0.0500% |
| VIP 5 | 0.0500% | 0.0400% |
| Supreme VIP | 0.0450% | 0.0300% |

#### Fiat-pair Spot

| Tier and trailing 30-day volume | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 below $100,000 | 0.2500% | 0.1500% |
| VIP 0 at least $100,000 | 0.2200% | 0.1000% |
| VIP 0 at least $250,000 | 0.2000% | 0.1000% |
| VIP 0 at least $500,000 | 0.1500% | 0.1000% |
| VIP 1 | 0.1200% | 0.0675% |
| VIP 2 | 0.0775% | 0.0650% |
| VIP 3 | 0.0750% | 0.0625% |
| VIP 4 | 0.0600% | 0.0500% |
| VIP 5 | 0.0500% | 0.0400% |
| Supreme VIP | 0.0450% | 0.0300% |

The regional qualification thresholds use USD equivalents.
Asset, average borrowing, and Spot volume thresholds are the same as the global VIP 0 through VIP 5 rows for those three criteria.
Supreme VIP requires at least $100 million in Spot volume.
VIP 4 and higher volume qualification requires API share at or below 20%.

Spot Margin borrowing is dynamic and liquidation costs 2%.
On-chain and internal deposits have no Bybit EU fee.
Withdrawal fees are dynamic.
An official Learn page still says non-VIP Spot costs 0.1000% maker and taker.
That statement conflicts with the newer Help Center's 0.1000% maker and 0.2500% taker base rate.

### Bybit Indonesia

Bybit Indonesia documents Spot products.
Its VIP and Pro crypto platform rates mostly follow the global Spot schedule.
Its fiat Pro 2 maker rate is 0.0400% and its Pro 5 taker and maker rates are 0.0200% and 0.0100%.
Those values differ from the corresponding global fiat Pro rows.

| Tier | Asset threshold in IDR | Spot volume threshold in IDR |
| --- | ---: | ---: |
| VIP 0 | Below 1.5 billion | Below 15 billion |
| VIP 1 | At least 1.5 billion | At least 15 billion |
| VIP 2 | At least 3.75 billion | At least 75 billion |
| VIP 3 | At least 7.5 billion | At least 150 billion |
| VIP 4 | At least 15 billion | At least 375 billion |
| VIP 5 | At least 30 billion | At least 750 billion |
| Supreme VIP | Not published | At least 1.5 trillion |

The Pro Spot thresholds are 375 billion, 750 billion, 1.5 trillion, 3 trillion, 7.5 trillion, and 10 trillion IDR.
Pro qualification requires API share above 20%.

Indonesia adds tax and Commodity Futures Exchange charges even when a voucher removes the platform component.
The additions also apply to Spot, OTC, Spot Grid, Dollar-Cost Averaging, and Convert.

| Trade direction | Base taker | Base maker | Tax | Exchange charge | Total taker | Total maker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Crypto to crypto | 0.1000% | 0.1000% | 0.2100% | 0.0200% | 0.3300% | 0.3300% |
| Fiat used to buy crypto | 0.2000% | 0.1000% | 0.0000% | 0.0100% | 0.2100% | 0.1100% |
| Crypto sold for fiat | 0.2000% | 0.1000% | 0.2100% | 0.0100% | 0.4200% | 0.3200% |

### Bybit Türkiye

Bybit Türkiye documents Spot rather than the global derivatives set.
Crypto pairs use the corresponding published global VIP and Pro Spot rates.
The fiat schedule differs.

| Tier and trailing 30-day fiat volume | Taker | Maker |
| --- | ---: | ---: |
| VIP 0 below $30,000 | 0.1400% | 0.1000% |
| VIP 0 at least $30,000 | 0.1300% | 0.0600% |
| VIP 0 at least $150,000 | 0.1200% | 0.0500% |
| VIP 0 at least $300,000 | 0.1000% | 0.0400% |
| VIP 1 | 0.0800% | 0.0200% |
| VIP 2 | 0.0775% | 0.0175% |
| VIP 3 | 0.0750% | 0.0150% |
| VIP 4 | 0.0700% | 0.0125% |
| VIP 5 | 0.0650% | 0.0100% |
| Supreme VIP | 0.0600% | 0.0100% |
| Pro 1 | 0.0600% | 0.0500% |
| Pro 2 | 0.0500% | 0.0400% |
| Pro 3 | 0.0450% | 0.0300% |
| Pro 4 | 0.0400% | 0.0300% |
| Pro 5 | 0.0150% | 0.0050% |
| Pro 6 | Not publicly specified | Not publicly specified |

The official table gives Pro 6 a $1 billion volume threshold but omits its rate cells.

### Bybit Georgia

Bybit Georgia documents Spot products.
Its Trading Fee Structure page shows the global fiat schedule.
Its VIP Benefits page shows the lower Türkiye-style fiat schedule.
Both sources are official and current enough to create a material conflict.
The signed fee endpoint or My Fee Rate page must decide an eligible account's actual rate.

### Bybit Kazakhstan

The current generic Kazakhstan fee page and current Russian Kazakhstan fee-structure page conflict.
The Russian fee-structure page publishes this detailed table.

| Tier | Spot taker | Spot maker | Derivatives taker | Derivatives maker | Options taker | Options maker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| VIP 0 | 0.1000% | 0.1000% | 0.0550% | 0.0200% | 0.0300% | 0.0200% |
| VIP 1 | 0.0900% | 0.0675% | 0.0400% | 0.0180% | 0.0200% | 0.0150% |
| VIP 2 | 0.0800% | 0.0650% | 0.0375% | 0.0160% | 0.0200% | 0.0150% |
| VIP 3 | 0.0750% | 0.0625% | 0.0350% | 0.0140% | 0.0200% | 0.0150% |
| VIP 4 | 0.0600% | 0.0500% | 0.0320% | 0.0120% | 0.0180% | 0.0150% |
| VIP 5 | 0.0500% | 0.0400% | 0.0320% | 0.0100% | 0.0150% | 0.0100% |
| Supreme VIP | 0.0500% | 0.0300% | 0.0300% | 0.0000% | 0.0150% | 0.0050% |

The generic Kazakhstan overview instead states 0.0600% derivatives taker, 0.0100% derivatives maker, and 0.0300% for both options sides at non-VIP.
The signed fee endpoint or My Fee Rate page must resolve the conflict.

### United Arab Emirates value-added tax

Eligible United Arab Emirates residents whose regulated UAE account was created on or after 2026-01-19 pay 5% value-added tax on top of covered fees.
Covered categories include Spot and Margin trading and liquidation, Unified Trading Account handling and liquidation, third-party One-Click charges, fiat movement, crypto withdrawal and recovery, small-balance conversion, derivatives trading and settlement, on-chain Earn service charges, bot trading, Alpha trading, and network fees.
Funding payments, borrowing interest, and services with no fee do not receive the tax.
The official announcement also raised covered AED BTC, ETH, SOL, and USDT pair fees from 0.1000% to 0.5500% on 2026-06-01.

### India goods and services tax and tax deducted at source

Eligible India accounts pay 18% goods and services tax on covered trading and service fees.
They also face 1% tax deducted at source on covered crypto transfers.
Crypto-to-crypto and crypto-to-fiat transactions can create tax deducted at source.
Convert and OTC can owe goods and services tax on the embedded spread even when no separate trading fee is displayed.
The current India FAQ says Card, bots, and TradFi are unavailable for the covered entity.

### Service restrictions

The global restricted list on the retrieval date includes the United States, mainland China, Hong Kong, Singapore, Canada, North Korea, Cuba, Iran, Uzbekistan, specified Russian-controlled Ukrainian regions, Sudan, Syria, and Dubai.
Regional entities can have additional eligibility rules.
The list can change and must be checked before account or endpoint selection.

## Worked cost examples

### Global VIP 0 Spot taker

Assume a taker buys 0.5 BTC at 50,000 USDT.

```text
notional = 0.5 × 50,000 USDT = 25,000 USDT
fee = 25,000 USDT × 0.1000% = 25 USDT
```

The actual fee can be charged in the purchased asset under Bybit's Spot settlement rule.

### Global VIP 0 linear perpetual round trip with funding

Assume a taker opens one BTC at 50,000 USDT and later closes one BTC at 51,000 USDT as a maker.
Assume one positive funding event at a 50,500 USDT mark and a 0.0100% rate while the long is open.

```text
opening fee = 1 × 50,000 × 0.0550% = 27.50 USDT
closing fee = 1 × 51,000 × 0.0200% = 10.20 USDT
funding payment = 1 × 50,500 × 0.0100% = 5.05 USDT
total fees and funding = 42.75 USDT
```

Slippage and realized trading profit or loss remain separate.

### Global VIP 0 inverse perpetual round trip

Assume a 10,000 USD inverse contract opens as a taker at $40,000 and closes as a maker at $41,000.

```text
opening fee = 10,000 ÷ 40,000 × 0.0550% = 0.00013750 BTC
closing fee = 10,000 ÷ 41,000 × 0.0200% = 0.00004878 BTC
round-trip trading fee = 0.00018628 BTC after rounding
```

Funding remains additional when a funding timestamp is crossed.

### Premium-capped option

Assume an option index price of 42,000 USDT, premium of 30 USDT, size of 0.3, and VIP 0 maker rate of 0.0200%.

```text
rate branch = 42,000 × 0.0200% = 8.40 USDT per option
premium-cap branch = 30 × 7% = 2.10 USDT per option
fee = min(8.40, 2.10) × 0.3 = 0.63 USDT
```

## Values that must be fetched live

| Value | Official lookup |
| --- | --- |
| Account maker and taker rate | Signed `GET /v5/account/fee-rate` or My Fee Rate |
| Current Pro and market-maker symbol group | Public `GET /v5/market/fee-group-info` |
| Funding rate, interval, and caps | Instrument information and ticker data |
| Spot Margin and Unified Trading Account interest | Borrowing page or authenticated account response |
| Loan interest and repayment conversion rate | Loan or repayment preview |
| Crypto withdrawal fee | Withdrawal preview by asset and chain |
| Fiat deposit and withdrawal charge | Fiat funding preview |
| Convert and OTC spread | Executable quote |
| One-Click and third-party payment fee | Checkout preview |
| Easy Earn APR and embedded management effect | Product page |
| TradFi overnight swap | MT5 contract specification |
| Card eligibility and regional rows | Signed-in card schedule |
| Institutional, custody, and wealth pricing | Agreement, representative, or invoice |

## Source ledger

All sources were retrieved on 2026-07-26.

| Official source | Entity or product | Supports |
| --- | --- | --- |
| [Trading Fee Structure](https://www.bybit.com/en/help-center/article/Trading-Fee-Structure) | Global | VIP rates, special markets, fiat pairs, qualifications, refresh, and volume rules |
| [Benefits of the VIP Program](https://www.bybit.com/en/help-center/article/Benefits-of-the-VIP-Program) | Global | Pro and VIP benefits and rates |
| [Introduction to Bybit VIP Program](https://www.bybit.com/en/help-center/article/Introduction-to-Bybit-VIP-Program) | Global | VIP and Pro qualification |
| [Fee Rate API](https://bybit-exchange.github.io/docs/v5/account/fee-rate) | V5 API | Authenticated account rates |
| [Fee Group Information API](https://bybit-exchange.github.io/docs/v5/market/fee-group-info) | V5 API | Current Pro and market-maker symbol groups and rates |
| [Market Maker Incentive Program](https://www.bybit.com/en/help-center/article/Introduction-to-the-Market-Maker-Incentive-Program) | Global institutional | Spot, derivatives, and options rebates |
| [Spot Fees Explained](https://www.bybit.com/en/help-center/article/Bybit-Spot-Fees-Explained) | Global Spot | Fee asset, formula, and unfilled treatment |
| [Perpetual and Futures Contract Fees Explained](https://www.bybit.com/en/help-center/article/Perpetual-Futures-Contract-Fees-Explained) | Global derivatives | Linear and inverse formulas, expiry, delisting, and examples |
| [USDT Perpetual and Expiry Contracts FAQ](https://www.bybit.com/en/help-center/article/FAQ-USDT-Perpetual-and-Expiry-Contracts) | Global derivatives | Conflicting USDT expiry statement |
| [Funding Fee Calculation](https://www.bybit.com/en/help-center/article/Funding-fee-calculation) | Global derivatives | Funding direction and position-value formulas |
| [Introduction to Funding Rate](https://www.bybit.com/en/help-center/article/Introduction-to-Funding-Rate) | Global derivatives | Premium, interest, interval, and cap rules |
| [Options Fees Explained](https://www.bybit.com/en/help-center/article/Bybit-Option-Fees-Explained) | Global options | Trading, delivery, cap, and liquidation formulas |
| [Order Cost](https://www.bybit.com/en/help-center/article/Order-Cost-USDT-Contract) | Global derivatives | Initial margin and reserved closing fee |
| [Spread Trading FAQ](https://www.bybit.com/en/help-center/article/FAQ-Spread-Trading) | Global Spread Trading | Relative fee discount |
| [Spot Margin Trading Fees Explained](https://www.bybit.com/en/help-center/article/Spot-Margin-Trading-Fees-Explained) | Global Spot Margin | Trading, interest, and liquidation |
| [Borrowing and Repayment in the Unified Trading Account](https://www.bybit.com/en/help-center/article/Borrowing-Repayment-UTA) | Global Unified Trading Account | Flexible and fixed interest and automatic repayment |
| [Manual Repayment in the Unified Trading Account](https://www.bybit.com/en/help-center/article/How-to-Make-Manual-Repayment-in-Unified-Trading-Account) | Global Unified Trading Account | Current conversion handling rate rule |
| [Crypto Loans FAQ](https://www.bybit.com/en/help-center/article/FAQ-Crypto-Loans) | Global loans | Interest, penalty, liquidation, repayment, and supplier fees |
| [Premier Loans](https://www.bybit.com/en/help-center/article/Introduction-to-Premier-Loans) | Global loans | Minimum, interest, repayment, and liquidation |
| [Institutional Loan](https://www.bybit.com/en/help-center/article/Introduction-to-Institutional-Loan) | Global institutional | Minimum, leverage, negotiated rate, and liquidation |
| [Fees You Need to Know](https://www.bybit.com/en/help-center/article/Bybit-Fees-You-Need-to-Know) | Global | Deposits, withdrawals, funding, liquidation, loans, and general fee map |
| [OTC FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-OTC) | Global OTC | No added fee, quote behavior, and size ranges |
| [Small Account Balance Conversion](https://www.bybit.com/en/help-center/article/How-to-Convert-Small-Account-Balance-to-MNT) | Global Convert | Small-balance limits and fee |
| [P2P Fees Explained](https://www.bybit.com/en/help-center/article/P2P-on-Bybit-Fees-Explained) | Global P2P | Currency, direction, and advertiser exceptions |
| [One-Click Buy FAQ](https://www.bybit.com/en/help-center/article/FAQ-One-Click-Buy) | Global fiat | Buy and sell method fees |
| [Bank Card Payments FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bank-Card-Payments) | Global fiat | Card and Apple Pay charges |
| [Third-Party Buy Crypto FAQ](https://www.bybit.com/en/help-center/article/FAQ-Buy-Crypto-Third-Party) | Global fiat | Provider fee boundary |
| [Alpha Trading Fee](https://www.bybit.com/en/help-center/article/Bybit-Alpha-Trading-Fee) | Global Alpha | Alpha Trading and Alpha Farming fees |
| [Trading Bot Differences](https://www.bybit.com/en/help-center/article/Difference-between-Bybit-Trading-Bot) | Global bots | No separate bot-use fee and ordinary execution charges |
| [Dollar-Cost Averaging Bot FAQ](https://www.bybit.com/en/help-center/article/FAQ-DCA-Bot) | Global bots | Spot fee treatment |
| [Introduction to Copy Trading](https://www.bybit.com/en/help-center/article/Introduction-to-Copy-Trading-on-Bybit) | Global Copy Trading Classic | Trading scope and profit-sharing tiers |
| [Copy Trading Pro FAQ](https://www.bybit.com/en/help-center/article/FAQ-Copy-Trading-Pro) | Global Copy Trading Pro | VIP 1 rates, funding, and profit-sharing range |
| [TradFi Copy Trading](https://www.bybit.com/en/help-center/article/Introduction-to-TradFi-Copy-Trading) | Global TradFi Copy Trading | Tight-Spread mode and conflicting profit-sharing range |
| [TradFi Copy Trading Profit Sharing](https://www.bybit.com/en/help-center/article/TradFi-Copy-Trading-Profit-Sharing-Explained) | Global TradFi Copy Trading | Rank table and high-water-mark method |
| [Easy Earn FAQ](https://www.bybit.com/en/help-center/article/FAQ-Easy-Earn) | Global Earn | APR and management-fee treatment |
| [On-Chain Earn](https://www.bybit.com/en/help-center/article/Introduction-to-Bybit-On-Chain-Earn) | Global Earn | Protocol-specific service fee |
| [Launchpool FAQ](https://www.bybit.com/en/help-center/article/Launchpool-FAQ) | Global Earn | Participation, borrowing, and dynamic pool terms |
| [Dual Asset FAQ](https://www.bybit.com/en/help-center/article/Dual-Asset-Mining-FAQ) | Global structured products | Subscription and settlement terms |
| [Liquidity Mining FAQ](https://www.bybit.com/en/help-center/article/FAQ-Liquidity-Mining) | Global Earn | Add, remove, rebalancing, and slippage treatment |
| [Wealth Management FAQ](https://www.bybit.com/en/help-center/article/?id=000002038) | Global Wealth Management | Published no-fee statement and early-redemption treatment |
| [TradFi Fees Explained](https://www.bybit.com/en/help-center/article/TradFi-Fees-Explained) | Global TradFi | Commissions and overnight swaps |
| [TradFi Market-Maker Update](https://announcements.bybit.com/en/article/tradfi-perpetuals-new-rpi-maker-rebate-incentive-and-api-maker-rebate-update--art8c0b2e283a8f/) | Global TradFi market makers | Future-dated 2026-07-28 rebate change |
| [Bybit Card Fees and Spending Limits](https://www.bybit.com/en/help-center/article/Fees-and-Spending-Limits-Bybit-Card) | Regional card programs | Issuance, conversion, foreign exchange, padding, and ATM charges |
| [Argentina Card FAQ](https://www.bybit.com/en/help-center/article/FAQ-Bybit-Card-General-Inquiries-Argentina) | Bybit Card Argentina | Government tax categories and rates |
| [Paying Trading Fees with MNT](https://www.bybit.com/en/help-center/article/FAQ-Paying-Trading-Fees-with-MNT) | Global discount | Eligibility and discounted rate table |
| [API Brokers Program FAQ](https://www.bybit.com/en/help-center/article/FAQ-API-Brokers-Program) | Global broker program | Rebate and qualification boundary |
| [Leveraged Token Fees](https://www.bybit.com/en/help-center/article/?id=000001481) | Legacy leveraged tokens | Trading, subscription, redemption, management, and funding charges |
| [V5 API Changelog](https://bybit-exchange.github.io/docs/changelog/v5) | Global API | BTC and ETH leveraged-token delisting and API termination |
| [Off-Exchange Settlement Agreement](https://www.bybit.com/common-static/compliance/legal/BYBIT/8c89025a280ded5cb16164b7c397557d.pdf) | Global institutional custody | Withdrawal and gas-charge responsibility |
| [Bybit EU Trading Fee Structure](https://www.bybit.eu/en-EU/help-center/article/Trading-Fee-Structure) | Bybit EU | Regional Spot and fiat tables |
| [Bybit Indonesia Trading Fee Structure](https://www.bybit.id/en-ID/help-center/article/Trading-Fee-Structure) | Bybit Indonesia | Regional tiers, tax, and exchange charges |
| [Bybit Türkiye Trading Fee Structure](https://www.bybit.tr/en-TUR/help-center/article/Trading-Fee-Structure) | Bybit Türkiye | Regional Spot and fiat tables |
| [Bybit Georgia Trading Fee Structure](https://www.bybitgeorgia.ge/en-GEO/help-center/article/Trading-Fee-Structure) | Bybit Georgia | Regional table and official conflict |
| [Bybit Georgia VIP Benefits](https://www.bybitgeorgia.ge/en-GEO/help-center/article/Benefits-of-the-VIP-Program) | Bybit Georgia | Alternative regional fiat table and Pro rates |
| [Bybit Kazakhstan General Fees](https://www.bybit.kz/en-KAZ/help-center/article/Bybit-Fees-You-Need-to-Know) | Bybit Kazakhstan | General regional rates |
| [Bybit Kazakhstan Trading Fee Structure](https://www.bybit.kz/ru-KAZ/help-center/article/Trading-Fee-Structure) | Bybit Kazakhstan | Detailed regional tiers and conflict |
| [United Arab Emirates Value-Added Tax FAQ](https://www.bybit.com/en/help-center/article/FAQ--Value-Added-Tax-VAT) | Regulated UAE accounts | Value-added tax scope and exclusions |
| [India Goods and Services Tax FAQ](https://www.bybit.com/en/help-center/article/FAQ-Goods-and-Services-Tax-GST-in-India) | India accounts | Goods and services tax and tax deducted at source |
| [Service Restricted Countries](https://www.bybit.com/en/help-center/article/Service-Restricted-Countries) | Global and regional access | Restricted-jurisdiction boundary |

## Known official-source conflicts

The current derivatives fee explainer says USDT expiry settlement has no fee.
The current USDT contract FAQ says it costs 0.0500%.

The global Trading Fee Structure and VIP introduction pages disagree about whether liquidity-mining balances count toward the asset-balance criterion.

The Bybit EU Help Center says non-VIP crypto Spot costs 0.1000% maker and 0.2500% taker.
An official Bybit EU Learn page still says 0.1000% on both sides.

The Bybit Georgia Trading Fee Structure and VIP Benefits pages publish different fiat schedules.

The Bybit Kazakhstan general and detailed fee pages publish different non-VIP derivatives and options rates.

Older Unified Trading Account pages state a fixed 0.1000% manual repayment fee.
The current repayment documentation uses the higher live repayment-fee rate of the two assets.

The TradFi Copy Trading introduction describes a 0% through 15% profit-sharing range.
The dedicated profit-sharing page publishes 15%, 20%, 25%, and 30% by rank.

The signed account rate, current contract display, current regional fee page, and executable preview must resolve these conflicts before an order or repayment.
