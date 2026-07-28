# Binance Fee Profile

Status: Done.

Retrieved: 2026-07-26.

This profile covers Binance.com, Binance.US, and publicly documented regional boundaries.
It covers spot, margin, USD-M futures, COIN-M futures, TradFi perpetuals, options, funding, liquidation, convert, P2P, deposits, withdrawals, loans, stocks, Wallet swaps, staking, and institutional programs.
Availability and rates depend on the legal entity, residence, product, symbol, account tier, promotion, and account configuration.

## Quick answer for opening and closing positions

A Binance buy or sell is not inherently maker or taker.
Each fill is classified by whether it added or removed liquidity.

For spot, USD-M futures, and most linear products:

```text
fill notional = execution price × executed quantity
fill commission = fill notional × effective maker or taker rate
```

For COIN-M inverse contracts:

```text
position value in coin = contract count × contract multiplier ÷ execution price
fill commission in coin = position value in coin × effective maker or taker rate
```

For a round trip:

```text
total position cost
= opening commissions
+ closing commissions
+ funding or borrowing
+ settlement or delivery charges
+ conversion and liquidation charges when applicable
+ spread and slippage
```

Calculate every fill independently.
One order can contain both maker and taker fills at different prices.

## Authority order

Use the following authority order for production:

1. Use the actual commission reported on each private execution event.
2. Use the authenticated account and symbol commission endpoint.
3. Use the signed-in fee page and order preview.
4. Use the current public fee schedule.
5. Use a static example only to demonstrate a formula.

Promotional rates, pair exceptions, manual adjustments, and market-maker agreements can override headline tiers.
A missing public value is not zero.

## Entities and regional scope

The current Binance.com terms name Nest Exchange Limited, Nest Clearing and Custody Limited, and Nest Trading Limited in Abu Dhabi Global Market.
Those entities have separate exchange, clearing and custody, and broker-dealer functions.

Binance also lists separate operators or platforms for Kazakhstan, Bahrain, Dubai, Australia, India, Indonesia, Japan, New Zealand, Thailand, Mexico, El Salvador, Argentina, Brazil, and South Africa.
The Binance.com rate table must not be applied automatically to a local platform.

Binance.US is operated through BAM entities.
Its terms state that it is separate from Binance Holdings despite common ownership.
Binance.US has its own spot and staking schedules and does not offer the Binance.com derivatives schedule.

## Product coverage

| Product family | Fee model | Static public table quality |
| --- | --- | --- |
| Binance.com spot | VIP maker and taker percentage | Complete current table is public. |
| Binance.com margin | Spot fee plus dynamic hourly borrow interest | Spot table is complete and interest is live-only. |
| USD-M futures | VIP maker and taker percentage plus funding | Current tier page is client-rendered and account lookup is authoritative. |
| COIN-M perpetuals and delivery | Coin-denominated maker and taker percentage | Current tier page is client-rendered and account lookup is authoritative. |
| TradFi perpetuals | Product-specific futures fee and funding | Current table is client-rendered. |
| Options | Maker and taker percentage plus exercise and liquidation rules | Current account rate is authoritative. |
| Convert | Executable quote | No separate advertised commission, but the quote can contain spread. |
| P2P | Fiat, pair, role, and merchant-specific | Published ranges and regional exceptions exist. |
| Flexible Loan | Dynamic interest with conflicting published cadence plus liquidation fee | Rate is live-only. |
| Fixed Rate Loan and VIP Loan | Contract APR or account-specific fixed and flexible rates | The executed loan agreement is authoritative. |
| Stocks Trading | Platform fee or spread by order size | Current public rule is available. |
| bStocks | Spot commission, free 1:1 conversion, network withdrawal fee, and withholding tax | Current public rules are available. |
| Binance Wallet swap | Token-group service percentage | Current group table is public. |
| Deposits and withdrawals | Asset, network, fiat, and rail-specific | Live confirmation is authoritative. |
| Regional platforms | Local trading, tax, and payment-rail schedules | The entity matrix records every listed operator, and verified public schedules are reproduced below. |
| VIP and institutional | Public baseline plus negotiated programs | Complete customer terms are account-gated. |

## Binance.com spot and margin trading tiers

The spot table uses trailing 30-day spot volume and a minimum BNB balance.
The published rates are percentages of executed trade value.
The BNB columns already include the current 25% spot fee discount.
The USDC columns are pair-specific.
The word `Standard` means that the standard maker value for that row remains applicable.

| VIP tier | 30-day spot volume | Minimum BNB | Standard maker | Standard taker | BNB maker | BNB taker | USDC maker | USDC taker | USDC plus BNB maker | USDC plus BNB taker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Regular | Less than $1 million | 0 | 0.100% | 0.100% | 0.0750% | 0.0750% | Standard | 0.095% | Standard | 0.07125% |
| VIP 1 | $1 million | 5 | 0.090% | 0.100% | 0.06750% | 0.0750% | Standard | 0.095% | Standard | 0.07125% |
| VIP 2 | $5 million | 25 | 0.080% | 0.100% | 0.0600% | 0.0750% | Standard | 0.095% | Standard | 0.07125% |
| VIP 3 | $20 million | 100 | 0.040% | 0.060% | 0.0300% | 0.0450% | Standard | 0.055% | Standard | 0.04125% |
| VIP 4 | $75 million | 500 | 0.040% | 0.052% | 0.0300% | 0.0390% | Standard | 0.047% | Standard | 0.03525% |
| VIP 5 | $150 million | 1,000 | 0.025% | 0.031% | 0.01875% | 0.02325% | Standard | 0.026% | Standard | 0.01950% |
| VIP 6 | $400 million | 1,750 | 0.020% | 0.029% | 0.0150% | 0.02175% | Standard | 0.024% | Standard | 0.01800% |
| VIP 7 | $800 million | 3,000 | 0.019% | 0.028% | 0.01425% | 0.0210% | Standard | 0.023% | Standard | 0.01725% |
| VIP 8 | $2 billion | 4,500 | 0.016% | 0.025% | 0.0120% | 0.01875% | Standard | 0.020% | Standard | 0.01500% |
| VIP 9 | $4 billion | 5,500 | 0.011% | 0.023% | 0.00825% | 0.01725% | Standard | 0.018% | Standard | 0.01350% |

Spot volume includes Spot, Margin, Convert, Copy Trading, and Trading Bots under the current VIP rules.
Multi-Asset mode uses a USD-equivalent calculation.
VIP benefits apply across eligible products, but a product can still have its own rate table.

Spot fees are normally deducted from the asset received.
When BNB fee payment is enabled and sufficiently funded, Binance deducts the discounted equivalent in BNB.
The authenticated `GET /api/v3/account/commission` response provides current account and symbol rates.
The `POST /api/v3/order/test` method with `computeCommissionRates=true` provides an exact hypothetical order calculation.

Pre-Market spot uses the normal spot schedule unless a current promotion says otherwise.
Zero-fee pairs and temporary promotions are symbol-specific and time-specific.

## Binance.com margin costs

Margin fills use the spot maker and taker schedule.
The 25% BNB trading-fee discount can apply when enabled and funded.

Borrow interest is separate from execution commission.
Interest accrues hourly and the rate can change hourly.
Cross Margin interest can receive a 5% BNB discount when the account has enough BNB.

The system must retrieve the live borrow rate for the exact asset, account mode, and hour.
It must include expected interest for every started interest period under the current product rule.
It must also include any forced-liquidation or repayment conversion cost shown for the account.

## USD-M futures

USD-M commission is:

```text
commission = contract quantity × execution price × effective rate
```

The commission asset is the margin asset.
That asset is normally USDT for USDT-margined contracts.
The current BNB futures discount is 10% when the option is enabled and the futures wallet has enough BNB.

Spot VIP status carries to Futures.
Binance states that futures volume qualification is five times the spot threshold.
The implied futures volume gates below are an inference and are not a substitute for the live fee table:

| VIP tier | Inferred futures volume gate | Minimum BNB |
| --- | ---: | ---: |
| VIP 1 | $5 million | 5 |
| VIP 2 | $25 million | 25 |
| VIP 3 | $100 million | 100 |
| VIP 4 | $375 million | 500 |
| VIP 5 | $750 million | 1,000 |
| VIP 6 | $2 billion | 1,750 |
| VIP 7 | $4 billion | 3,000 |
| VIP 8 | $10 billion | 4,500 |
| VIP 9 | $20 billion | 5,500 |

The current full USD-M tier rows are rendered by the web client.
The public HTML returned no usable records during this research.
The profile therefore does not repeat remembered legacy rates.
Use the live USD-M fee page and authenticated `/fapi/v1/commissionRate` endpoint.
Portfolio Margin uses `/papi/v1/um/commissionRate`.

The official formula article uses 0.02% maker and 0.05% taker in examples.
Those values are examples and are not a complete current tier schedule.

## COIN-M perpetuals and delivery futures

COIN-M position value and commission are:

```text
position value in coin = contract count × contract multiplier ÷ execution price
commission in coin = position value in coin × effective rate
```

The current full COIN-M tier rows are also client-rendered.
Use the live delivery fee page and authenticated `/dapi/v1/commissionRate` endpoint.
Portfolio Margin uses `/papi/v1/cm/commissionRate`.

Delivery, settlement, symbol, and contract-specific charges must be read from the current contract and account configuration.
A missing static row must not be interpreted as zero.

## TradFi perpetuals

TradFi equity and commodity perpetuals are products inside the USD-M system.
They use the current TradFi fee page and account commission configuration.

The cited official article verifies a fixed eight-hour interval, a 0% interest component, and a plus or minus 2% cap for stock perpetual contracts.
Those stock perpetual contracts are exempt from the automatic one-hour interval shortening rule and settle in USDT.
Do not infer those parameters for every commodity or forex TradFi contract without its current specification.

## Futures funding

Funding is transferred between long and short position holders.
Binance states that it does not charge a separate funding service fee.
Only a position held at the actual funding timestamp pays or receives.

For USD-M:

```text
funding payment = mark price × contract size × funding rate
```

COIN-M uses its coin-denominated contract value.

The usual schedule is 00:00, 08:00, and 16:00 UTC.
Some symbols use four-hour or one-hour intervals.
The actual settlement can differ from the nominal time by about 15 seconds.
The system must query the current symbol interval and rate.

The default fixed interest component is 0.03% per day.
That is 0.01% per eight-hour interval.
Exceptions such as ETHBTC can use 0%.

Binance samples the premium every five seconds.
The published formula is:

```text
funding rate
= [average premium + clamp(interest - premium, -0.05%, +0.05%)]
÷ (8 ÷ interval hours)
```

Major symbols use a floor of `-0.75 × maintenance margin rate` and a cap of `0.75 × maintenance margin rate`.
Other USD-M symbols normally use plus or minus 2%.
The `/fapi/v1/fundingInfo` response is authoritative for current exceptions.

Since 2025-05-02, an eligible USD-M symbol can shorten to one-hour funding when the previous settlement reaches its cap or floor.
Since 2026-01-02, an eligible one-hour symbol can revert to four hours after the documented 16-cycle condition.

## Futures liquidation

Futures liquidation can include an insurance clearance fee.
USD-M uses:

```text
clearance fee = contract quantity × trade price × clearance rate
```

COIN-M uses:

```text
clearance fee = contract count × contract size ÷ trade price × clearance rate
```

The clearance rate is symbol-specific and risk-tier-specific.
The current Trading Rules display is authoritative.
No current universal static clearance-rate table was verified.

## Options

Binance Options are European-style and cash-settled.
Trading uses maker and taker rates from the current live page or account configuration.
Use the authenticated `/eapi/v1/commission` endpoint for the account.

The current static tier rows were not recoverable from first-party public HTML.
No remembered legacy rate is copied here.

Options liquidation is 0.19% of position notional, capped at 25% of option premium:

```text
liquidation fee
= min(
  0.19% × price index × contract unit × absolute position size,
  option premium at liquidation × 25%
)
```

Exercise, settlement, and symbol-specific limits must be taken from the current contract and clearing procedures.

## Convert

Binance Convert does not advertise a separately itemized trading commission.
The executable quote can contain spread and slippage relative to the spot order book.
Use `/sapi/v1/convert/getQuote` and compare the received amount with the current executable spot curve.
Do not substitute the spot maker or taker rate for a Convert quote.

## P2P

One official support schedule states that P2P maker and taker charges can range from 0% to 0.35% by fiat currency, pair, and role.
Verified merchant VIP discounts can range from 20% to 50% based on monthly volume and completion.
Other current Binance material says that takers can be free in some regions.
The live advertisement and confirmation screen therefore control.

## Stocks Trading

Binance Stocks Trading is a broker product of Nest Trading Limited.
It is different from TradFi perpetuals.

| Order or service | Current charge |
| --- | --- |
| Stock order of $350 or less | $0.35 platform fee |
| Stock order over $350 | No $0.35 minimum and a 0.10% spread |
| ADR custody | Usually $0.01 to $0.03 per share once or twice per year |
| Residual holding below $5 after 120 inactive days | Binance may sell the shares for USDC and charge $0.01 |
| Account maintenance | No current charge stated |
| Inactivity | No current charge stated |
| Custody | No current charge stated |

FX, regulatory, dividend, tax, and third-party charges can still apply.

## bStocks

bStocks are tokenized securities and are different from Stocks Trading positions.
Direct bStocks trades use the Spot interface and must use the displayed Spot rate for that symbol.
Conversion between eligible stocks and the corresponding bStocks is advertised at a 1:1 ratio with no conversion fee.
A withdrawal has a BNB Smart Chain network fee, and the minimum varies by token.
The current guide states that US dividends have 30% withholding before automatic reinvestment.
A conversion residual beyond eight decimal places is retained by the issuer as rounding and is explicitly not a fee.

## Binance Wallet swap service

This schedule belongs to the self-custody Binance Wallet service.
It is not the Binance Exchange spot schedule.

### App and Agentic Wallet

| Token group combination | Charged token | Rate |
| --- | --- | ---: |
| Group 1 with Group 1 | None | 0% |
| Group 1 with Group 2 | None | 0% |
| Group 2 with Group 2 | None | 0% |
| Other with Other | None | 0% |
| Group 1 with Other | Group 1 token | 0.50% |
| Group 2 with Other | Group 2 token | 0.50% |

### Web Wallet

| Token group combination | Charged token | Rate |
| --- | --- | ---: |
| Group 1 with Group 1 | None | 0% |
| Group 1 with Group 2 | Group 1 token | 0.01% |
| Group 1 with Other | Group 1 token | 0.50% |

Swaps on the TON blockchain, through Bridge, or with Use Exchange Balance are listed as exempt.
The service fee is `transaction amount × applicable rate`.
The token group list can change.

## Binance Loans

Binance publishes Flexible Loans, Fixed Rate Loans, and VIP Loans.
An older official Flexible Loan guide says interest is calculated each minute.
A guide updated on 2026-06-26 says Flexible Loan interest is calculated hourly.
Treat the account accrual record, live quote, and executed agreement as authoritative.
The older guide states no separate transaction fee and a 2% liquidation fee based on the loan amount.
Fixed Rate Loans lock an annual percentage rate for the term and can have product-specific early repayment conditions.
VIP Loans serve qualifying institutional and high-volume users with fixed or flexible rates.

## Deposits and withdrawals

Binance generally charges no exchange fee for a crypto deposit.
Asset-specific address setup, protocol, or third-party costs can still exist.

Crypto withdrawal fees and minimums vary by asset, network, and network conditions.
Use the live crypto fee page and the withdrawal confirmation.
Do not cache a universal withdrawal fee.

Fiat deposits and withdrawals vary by country, currency, rail, payment provider, and account.
Use the signed-in transfer preview.
Card purchase and sell charges are also region-specific and previewed.

## Published regional schedules

These tables apply only to the named local operator.
They do not replace the Binance.com schedule or another regional platform's schedule.
The following matrix records the public pricing result for every local operator named in the current Binance entity disclosure:

| Platform or operator | Public fee result on 2026-07-26 | Production treatment |
| --- | --- | --- |
| Binance Kazakhstan | No separate complete static local schedule was verified. | Use the signed-in local fee page, order preview, and account commission response. |
| Binance Bahrain | No separate complete static local trading schedule was verified. | Use the signed-in local fee page and account response. |
| Binance Dubai | No separate complete static local schedule was verified. | Use the signed-in local fee page and account response. |
| Binance Australia | No separate complete static local schedule was verified. | Use the signed-in local fee page and account response. |
| Binance India | No separate complete static trading and tax schedule was verified. | Use the signed-in fee page, order preview, and local tax treatment. |
| Tokocrypto in Indonesia | A current local trading, tax, deposit, withdrawal, staking, and DCA schedule is published. | Use the table below and recheck the transaction preview. |
| Binance Japan | The regional spot fee page repeats the Binance.com spot rows, and a PayPay rail charge is published. | Use the regional fee page, account response, and PayPay rule below. |
| Binance New Zealand | No separate complete static local schedule was verified. | Use the signed-in local fee page and account response. |
| Binance TH | A current Broker Pair and Exchange Pair VIP schedule is published. | Use the table below. |
| Binance Mexico | No separate complete static local schedule was verified. | Use the signed-in local fee page and account response. |
| Binance El Salvador | No separate complete static local schedule was verified. | Use the signed-in local fee page and account response. |
| Binance Argentina | No separate complete static local schedule was verified. | Use the signed-in local fee page, payment preview, and local tax treatment. |
| Binance Brazil | No separate complete static local schedule was verified. | Use the signed-in local fee page, payment preview, and local tax treatment. |
| Binance South Africa | No separate complete static local schedule was verified. | Use the signed-in local fee page, payment preview, and local tax treatment. |
| Binance.US | A separate spot, staking, Convert, and market-maker schedule is published. | Use the Binance.US sections below. |

`No separate complete static local schedule was verified` is an evidence result.
It does not mean that the service is free or that the Binance.com schedule applies.

### Binance TH spot

Binance TH separates Broker Pairs from Exchange Pairs.
The following schedule has been effective since 2025-04-30 and remains effective until the operator announces a change:

| VIP tier | 30-day spot volume | Broker maker | Broker taker | Exchange maker | Exchange taker |
| --- | ---: | ---: | ---: | ---: | ---: |
| VIP 0 | Less than $150,000 | 0.10% | 0.10% | 0.25% | 0.25% |
| VIP 1 | $150,000 | 0.10% | 0.10% | 0.20% | 0.25% |
| VIP 2 | $500,000 | 0.09% | 0.10% | 0.15% | 0.20% |
| VIP 3 | $1.5 million | 0.08% | 0.10% | 0.10% | 0.15% |
| VIP 4 | $3 million | 0.07% | 0.09% | 0.10% | 0.10% |
| VIP 5 | $8 million | 0.05% | 0.07% | 0.07% | 0.09% |
| VIP 6 | $20 million | 0.045% | 0.065% | 0.065% | 0.085% |
| VIP 7 | $40 million | 0.035% | 0.045% | 0.055% | 0.075% |
| VIP 8 | $75 million | 0.025% | 0.031% | 0.040% | 0.052% |

Binance TH publishes 0% trading fees for the USDC/USDT Spot pair from 2026-05-19 until further notice.
The operator evaluates trailing 30-day Spot volume daily at 00:00 and updates the VIP tier and fees at 01:00 Thailand time.

### Tokocrypto

The current Tokocrypto schedule combines trading charges, Indonesian tax, and an ICEx fee:

| Transaction | Taker fee | Maker fee | Tax | ICEx fee | Total taker | Total maker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Buy | 0.20% | 0.10% | 0% VAT | 0.0222% | 0.2222% | 0.1222% |
| Buy with USDT or crypto | 0.15% | 0.15% | 0.21% final income tax | 0.0444% | 0.4044% | 0.4044% |
| Sell | 0.20% | 0.10% | 0.21% final income tax | 0.0222% | 0.4322% | 0.3322% |
| Sell with USDT or crypto | 0.15% | 0.15% | 0.21% final income tax | 0.0444% | 0.4044% | 0.4044% |

Tokocrypto publishes a Rp10,000 fiat withdrawal fee.
QRIS and named e-wallet deposits cost 2%.
The published staking tax is 5%, while DCA tax is 0%.

### Binance Japan PayPay

Binance Japan charges JPY 110 for each PayPay deposit or withdrawal.
The current guide states a JPY 300,000 daily deposit limit and a JPY 1,000,000 rolling 30-day deposit limit.

## Bots, copy trading, Alpha, staking, and other services

Trading Bots, Copy Trading, and most algorithmic execution tools inherit the commission of the underlying fills.
Strategy-provider terms, profit sharing, and campaign rules can add separate charges.

Binance Alpha uses product-specific trading rules and promotions.
The account and symbol fee display is authoritative.

Earn and staking products can quote rewards net of service terms or validator charges.
No universal current public staking commission table was verified across every asset and entity.
Use each product's subscription confirmation and terms.

NFT and some legacy fee-page tabs are client-rendered or regionally unavailable.
No current universal static NFT fee table was verified.
These values remain not publicly specified rather than zero.

## VIP, market-maker, and custody programs

Binance publishes VIP services, futures taker programs, and liquidity programs.
Complete negotiated rebates and custody arrangements are not public.
Store them as account-specific configuration.
Do not overwrite an authenticated commission response with the public VIP row.

### VIP Borrower qualification

A Binance announcement mirrored on the Binance Bahrain site publishes this alternative path to a higher VIP level:

| VIP tier | 30-day daily average net borrowing | Minimum daily average BNB |
| --- | ---: | ---: |
| VIP 1 | 100,000 USDT equivalent | 5 |
| VIP 2 | 500,000 USDT equivalent | 25 |
| VIP 3 | 2 million USDT equivalent | 100 |
| VIP 4 | 10 million USDT equivalent | 500 |
| VIP 5 | 20 million USDT equivalent | 1,000 |
| VIP 6 | 40 million USDT equivalent | 1,750 |
| VIP 7 | 65 million USDT equivalent | 3,000 |
| VIP 8 | 120 million USDT equivalent | 4,500 |
| VIP 9 | 160 million USDT equivalent | 5,500 |

Qualification counts net borrowing from Crypto Loans and VIP Loans in full and Margin net borrowing at 20%.
Because the evidence is hosted on Binance Bahrain, confirm eligibility and thresholds on the production account before applying them to another entity.

## Binance.US spot

Binance.US uses separate Tier 0 and Tier I pair groups.
The account's 30-day volume is recalculated daily at 20:00 Eastern Time.
Self-trades and Tier 0 volume do not count.

Tier 0 pairs use 0% maker and 0.01% taker at all volumes.
Tier I uses the following current schedule:

| VIP tier | Trailing 30-day volume | Maker | Taker | BNB maker | BNB taker |
| --- | ---: | ---: | ---: | ---: | ---: |
| VIP 1 | Less than $10,000 | 0% | 0.0200% | 0% | 0.0190% |
| VIP 2 | $10,000 to less than $50,000 | 0% | 0.0200% | 0% | 0.0190% |
| VIP 3 | $50,000 to less than $100,000 | 0% | 0.0200% | 0% | 0.0190% |
| VIP 4 | $100,000 to less than $1 million | 0% | 0.0200% | 0% | 0.0190% |
| VIP 5 | $1 million to less than $20 million | 0% | 0.0200% | 0% | 0.0190% |
| VIP 6 | $20 million to less than $100 million | 0% | 0.0200% | 0% | 0.0190% |
| VIP 7 | $100 million to less than $300 million | 0% | 0.0200% | 0% | 0.0190% |
| VIP 8 | $300 million to less than $500 million | 0% | 0.0200% | 0% | 0.0190% |
| VIP 9 | $500 million or more | 0% | 0.0100% | 0% | 0.0095% |

The current Binance.US BNB discount is 5%.
Tier 0 with BNB uses 0% maker and 0.0095% taker.
An API documentation sentence still mentions 25%.
The current fee website is used here.

The signed `GET /sapi/v1/asset/query/trading-fee` response returns the account's maker and taker values.
That response excludes the BNB discount.

### Binance.US market-maker program

Accounts with more than $10 million in monthly volume can apply.
All participants receive 0% maker on selected pairs.
The top 75% receive 0% maker on all pairs.
Rank 1 receives an additional 0.005% maker rebate.
Ranks 2 through 5 receive an additional 0.002% maker rebate.
The two-week grace period uses zero maker with no rebate.
Taker pricing follows the account's VIP tier.

### Binance.US staking and transfers

Crypto deposits are free from Binance.US.
Crypto withdrawals use dynamic network and asset fees shown before confirmation.
Fiat transfer fees vary by rail.
Deposit recovery displays its fee before confirmation.

Staking retains 9.95% to 39.95% of earned rewards.
Soft Staking retains 90% of earned rewards.
Binance.US advertises 0% Convert transaction fees, but the executable quote can include spread.
Buy and Sell prices can also include spread.
Advanced Trading does not add that consumer spread.

Binance.US does not publish a futures or options schedule because those products are not offered by Binance.US.

## Worked examples

### Binance.com spot taker

A Regular account buys 10 ETH at 2,000 USDT with no BNB discount.

```text
notional = 10 × 2,000 = 20,000 USDT
commission = 20,000 × 0.100% = 20 USDT equivalent
```

With the current 25% BNB discount, the equivalent commission is 15 USDT in BNB before conversion and rounding effects.

### USD-M futures round trip

Assume the authenticated endpoint returns a 0.05% taker rate for a specific account and symbol.
The client opens and later closes 100,000 USDT of notional as a taker.

```text
opening commission = 100,000 × 0.05% = 50 USDT
closing commission = 100,000 × 0.05% = 50 USDT
round-trip commission = 100 USDT
```

Funding, spread, slippage, and liquidation risk remain separate.
The 0.05% rate in this example is not a universal tier value.

### COIN-M inverse fill

Assume 100 contracts with a $100 multiplier execute at $50,000 and the authenticated taker rate is 0.05%.

```text
coin position value = 100 × 100 ÷ 50,000 = 0.2 BTC
commission = 0.2 × 0.05% = 0.0001 BTC
```

The live contract multiplier and account rate must replace the illustrative values.

## Required observatory fields

| Field | Reason |
| --- | --- |
| `venueEntity` | Binance.com, local operators, and Binance.US differ. |
| `productFamily` | Spot, USD-M, COIN-M, options, and consumer products use different formulas. |
| `symbol` | Promotions and rates can be symbol-specific. |
| `accountTier` | VIP and market-maker status changes rates. |
| `makerRate` and `takerRate` | A direction is not a liquidity role. |
| `bnbPaymentEnabled` | Spot and futures discounts differ. |
| `promotionId` | Temporary zero or reduced fees can override the table. |
| `contractMultiplier` | COIN-M notional requires it. |
| `fundingRate` and `fundingTime` | Perpetual holding cost is dynamic. |
| `borrowRate` and `interestPeriod` | Margin and loan costs are dynamic. |
| `clearanceRate` | Liquidation cost is symbol-specific. |
| `feeAsset` | Spot, linear, and inverse products deduct different assets. |
| `sourceUrl` and `retrievedAt` | Every cached rate needs provenance. |
| `effectiveAt` and `expiresAt` | Promotions and announced changes are time-bound. |
| `accountVerified` | Authenticated rates override public defaults. |

## Known conflicts and live-only values

| Topic | Limitation | Required treatment |
| --- | --- | --- |
| USD-M tier rows | Current page is client-rendered and returned no records in public HTML. | Query `/fapi/v1/commissionRate` and retain the live page as a human check. |
| COIN-M tier rows | Current page is client-rendered and returned no records in public HTML. | Query `/dapi/v1/commissionRate`. |
| Options tier rows | Current public static table was not recoverable. | Query `/eapi/v1/commission`. |
| TradFi tier rows | Current table is client-rendered. | Use the live TradFi page and account rate. |
| Binance.US BNB discount | API prose says 25% and the current fee site says 5%. | Use 5% and confirm the account display. |
| Flexible Loan interest cadence | An older official guide says minute calculation and the 2026-06-26 guide says hourly calculation. | Use the account accrual record and executed loan agreement. |
| P2P | Official pages differ by region and role. | Use the live advertisement and preview. |
| Withdrawal and fiat fees | Values change by asset, network, country, and rail. | Use the confirmation preview. |
| Staking and Earn | Product-specific terms differ. | Use the individual product confirmation. |
| Institutional pricing | Rebates and custody terms are negotiated. | Store account-specific terms. |

## Source ledger

Every source below was retrieved on 2026-07-26.

| Official source | Applies to | Supports |
| --- | --- | --- |
| [Binance.com spot trading fee rate](https://www.binance.com/en/fee/trading) | Binance.com Spot | VIP thresholds, maker and taker rates, BNB rates, and USDC rates |
| [How to calculate transaction fees](https://academy.binance.com/ur-PK/articles/how-to-calculate-transaction-fees-on-binance) | Binance.com Spot and Futures | Commission formulas and BNB discount examples |
| [Binance margin guide](https://academy.binance.com/ky-KG/articles/what-is-binance-margin-and-how-to-use-it) | Binance.com Margin | Trading fees, hourly interest, and liquidation concepts |
| [Binance Pre-Market](https://academy.binance.com/ur-PK/articles/what-is-binance-pre-market) | Binance.com Pre-Market | Spot-fee inheritance |
| [USD-M fee page](https://www.binance.com/en/fee/futureFee) | Binance.com USD-M | Current live fee lookup boundary |
| [COIN-M delivery fee page](https://www.binance.com/en/fee/deliveryFee) | Binance.com COIN-M | Current live fee lookup boundary |
| [TradFi fee page](https://www.binance.com/en/fee/tradFiFee) | Binance.com TradFi | Current live fee lookup boundary |
| [Futures fee calculation](https://www.binance.com/en/support/faq/detail/360033544231) | Binance.com USD-M and COIN-M | Linear and inverse formulas plus example rates |
| [Futures commissions, funding, and clearance](https://www.binance.com/en/support/faq/detail/98488a516eb84e3eb34605683dffd554) | Binance.com Futures | Commission, funding, and insurance-clearance mechanics |
| [Futures funding rates](https://www.binance.com/en/support/faq/detail/360033525031) | Binance.com Futures | Funding schedule, components, caps, and interval changes |
| [TradFi perpetual funding](https://academy.binance.com/ur-PK/articles/how-to-trade-stock-perpetual-contracts-on-binance) | Binance.com stock perpetuals | Funding interval, interest component, cap, and settlement asset |
| [Options product guide](https://academy.binance.com/ur-PK/articles/what-is-options-trading) | Binance.com Options | European exercise and cash settlement |
| [Options clearing procedures](https://bin.bnbstatic.com/static/cms/cg08ou2ak0tn7mcplvfg/file/53197b612332da02c20b5b7d19b81ff53ee5f4938c6330c72a30a1ca4f91049f.pdf) | Binance.com Options | Liquidation, exercise, and clearing rules |
| [Crypto withdrawal fee page](https://www.binance.com/en/fee/cryptoFee) | Binance.com transfers | Dynamic asset and network fees |
| [Binance Convert](https://academy.binance.com/en/articles/what-is-binance-convert-and-how-to-use-it) | Binance.com Convert | Quote and spread treatment |
| [P2P fees](https://www.binance.com/ru-KZ/support/faq/detail/360043895111) | Binance P2P | Maker, taker, merchant, fiat, and pair variability |
| [Binance Stocks Trading](https://academy.binance.com/ur-PK/articles/what-is-binance-stocks-trading) | Binance Stocks Trading | Platform fee and spread rules |
| [bStocks guide](https://academy.binance.com/ur-PK/articles/what-are-bstocks-a-guide-to-tokenized-stocks-on-binance) | Binance bStocks | Trading, conversion, withdrawal, and tax treatment |
| [Binance Wallet service fees](https://www.binance.com/en-AU/support/faq/detail/87cbb1ca0df34a348eaecb73c26167d7) | Binance Wallet | App, Agentic Wallet, and Web Wallet service charges |
| [Flexible Loan](https://academy.binance.com/ur-PK/articles/what-is-a-binance-flexible-loan) | Binance Flexible Loan | Interest cadence and liquidation treatment |
| [Binance Loans guide](https://academy.binance.com/ky-KG/articles/a-beginner-s-guide-to-binance-loans) | Binance Loans | Product families and loan terms |
| [VIP and institutional services](https://www.binance.com/en/vip-institutional-services) | Binance VIP and institutional accounts | Public program scope and negotiated boundary |
| [VIP Borrower program on Binance Bahrain](https://www.binance.bh/pt-BR/support/announcement/detail/d3f18ac600b34e2c8d32669f979fd7d7) | Binance Bahrain publication | Borrowing qualification and BNB thresholds |
| [Binance.com terms](https://bin.bnbstatic.com/static/cms/cg08ou2ak0tn7mcplvfg/file/bf4879710c904b991848972ec4818ba2cf9e4ce314c09adae84fa2750d3477f7.pdf) | Binance.com | Named service entities and product boundary |
| [Binance license and regional entity page](https://bin.bnbstatic.com/static/cms/cg08ou2ak0tn7mcplvfg/file/a60b6908e64f3e4fe3200a60726d56531384e55ab000939fe6be13d1e27f78f9.pdf) | Binance regional operators | Entity inventory used by the regional matrix |
| [Binance TH VIP schedule](https://www.binance.th/th/faq/spot-trading/4900a0792af24f5e853e2373b84f94e7) | Binance TH | Broker and Exchange Pair tiers, timing, and USDC promotion |
| [Tokocrypto transaction fees](https://support.tokocrypto.com/hc/en-us/articles/360004044591-Tokocrypto-Transaction-Fee-Details) | Tokocrypto in Indonesia | Trading, tax, ICEx, withdrawal, deposit, staking, and DCA charges |
| [Binance Japan spot fee page](https://www.binance.com/en-JP/fee/trading) | Binance Japan | Regional spot rows |
| [Binance Japan PayPay](https://academy.binance.com/ur-PK/articles/what-is-paypay) | Binance Japan | PayPay deposit and withdrawal fee and limits |
| [Binance.US fees](https://www.binance.us/fees) | Binance.US | Tier 0, Tier I, staking, and transfer schedules |
| [Binance.US Convert](https://www.binance.us/convert) | Binance.US Convert | Quote-based conversion treatment |
| [Binance.US terms](https://www.binance.us/terms-of-use) | Binance.US | Entity and service boundary |
| [Binance.US market-maker program](https://support.binance.us/en/articles/9843058-binance-us-market-maker-program) | Binance.US market makers | Volume gates and maker rebates |
| [Binance.US API documentation](https://docs.binance.us/) | Binance.US accounts | Account and commission lookup surfaces |

## Production validation

The following work requires a live account or negotiated terms and remains outside this documentation-only research:

- Recheck every live fee page with the production account entity.
- Capture authenticated USD-M, COIN-M, Options, and Portfolio Margin rates.
- Verify active zero-fee and promotional pair lists.
- Capture current network and fiat transfer previews.
- Capture negotiated market-maker and custody terms.
