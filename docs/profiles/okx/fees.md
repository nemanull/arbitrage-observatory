# OKX Fee Profile

**Status:** Done.

**Retrieved:** 2026-07-26.

## Scope and important limitation

OKX is a group of regulated and unregulated entities rather than one universal exchange.
Trading products, fee schedules, account classifications, fiat services, cards, and API hosts vary by legal entity and region.
This profile records every current public schedule found for global accounts, the United States, the European Economic Area, Australia, Singapore, the United Arab Emirates, Turkey, and Brazil.
It also records product fees that OKX publishes globally.

An authenticated fee response or local fee page is the source of record for a specific account and instrument.
Pair groups, zero-fee pairs, market-maker rates, RPI rates, withdrawal charges, interest rates, and some service prices can change without a complete static replacement table.
The absence of a public number does not mean that a service is free.

## Evidence labels

| Label | Meaning |
| --- | --- |
| Published | OKX publishes a current numeric rate or formula. |
| Dynamic | OKX calculates the value at request time or displays it in a preview. |
| Account-gated | The value requires an eligible authenticated account. |
| Negotiated | The value depends on an institutional or market-maker agreement. |
| Region-specific | The value applies only to a named entity, customer class, or jurisdiction. |
| Not offered | The cited regional entity does not offer the product. |
| Not publicly specified | No universal current number was found in official public material. |

## Legal entity and schedule map

| Entity or account family | Documented scope | Fee treatment |
| --- | --- | --- |
| OKX Europe Limited | Eligible EEA customers | Separate spot schedules for accounts with and without X-Perps access. |
| OKX Australia Pty Ltd | Australian spot, convert, and fiat services | Separate retail and wholesale spot schedules. |
| OKX Australia Financial Pty Ltd | Australian wholesale derivatives and margin | Wholesale futures schedule. |
| OKX INC. | United States customers | Spot schedule only in the current US product navigation. |
| OKX Middle East Fintech FZE | UAE customers | Separate AED qualification thresholds and spot and derivatives rates. |
| OKX Serviços Digitais Ltda | Brazilian customers | BRL and non-BRL spot schedules. |
| OKX SG Pte Ltd | Regulated Singapore digital payment token services | Standard retail spot schedule and an accredited investor schedule. |
| OKX Financial Pte Ltd | Eligible Singapore derivatives and other activities | Eligibility and product availability are account dependent. |
| OKX TR Kripto Varlık Alım Satım Platformu A.Ş. | Turkish customers | TRY, USDT-TRY, and non-TRY schedules. |
| OKX Fintech S.A. de C.V. | El Salvador and specified Latin American products | Local product availability applies. |
| OKX Bahamas FinTech Co Ltd | Specified Mexican and institutional cohorts | Account routing depends on registration date and customer type. |
| Aux Cayes FinTech Co Ltd | Other eligible global customers | Global fee framework applies unless a local schedule overrides it. |

## Quick answer for opening a futures buy or sell

Buy and sell direction does not select the trading rate.
The account tier, product family, instrument group, and execution role select the rate.
An order is a maker only for the quantity that rests and is later executed from the book.
A crossing limit order and a market order normally execute as taker flow.

```text
percentage trading fee = trade notional × applicable maker or taker rate
round-trip trading fee = opening fee + closing fee
total position cost = round-trip trading fee + funding or borrowing + settlement or exercise + liquidation cost when applicable
```

Negative fee rates are rebates.
Leverage changes required margin but does not reduce traded notional.

## Product coverage

| Product or service | Public pricing state |
| --- | --- |
| Spot and margin execution | Published regional and global tiers plus dynamic pair overrides. |
| Perpetual swaps and expiry futures | Published global and selected regional tiers. |
| Options | Published global and Singapore accredited tiers. |
| Event contracts | Published coefficient formula. |
| Nitro Spreads and RFQ | Published discount rule with product and account gates. |
| RPI liquidity | Account-gated dynamic maker rate. |
| Perpetual funding | Published formula with dynamic rates, intervals, caps, and floors. |
| Margin borrowing | Dynamic currency and tier rate with a published hourly formula. |
| Flexible and institutional loans | Dynamic or contract-specific rates and published repayment rules. |
| Convert and P2P | Published zero service fee with quote or third-party cost limitations. |
| Crypto deposits and withdrawals | Zero deposit fee and dynamic withdrawal fee. |
| Fiat deposits and withdrawals | Region and rail specific. |
| Simple Earn and On-chain Earn | Published service-fee rule or dynamic preview. |
| Cards | Region-specific published schedules. |
| Broker, OTC, custody, and managed accounts | Negotiated or not publicly specified. |

## Live fee lookup

The signed-in fee page, order preview, and authenticated API should be checked before every cost-sensitive strategy run.
The API endpoint is `GET /api/v5/account/trade-fee`.
The request accepts an instrument type and the appropriate instrument identifier or family.
Market-maker users should pass `instId` for spot or margin and `instFamily` for futures, swaps, or options.
Omitting the specific instrument can return organic base rates instead of a special agreement rate.

The response groups fees by `instType` and `groupId`.
Commission rates normally use negative signs and rebates use positive signs in the API.
Delivery and exercise commission fields use positive values.
The response can include `rpiMaker` for the current RPI maker rate.
The API does not identify every temporary zero-fee pair reliably.
The current local fee page and pair order panel remain necessary.

Official live pages include:

- Use the [Global fee page](https://www.okx.com/vip/fees) for eligible global accounts.
- Use the [EEA fee page](https://www.okx.com/en-eu/vip/fees) for OKX Europe accounts.
- Use the [Australia fee page](https://www.okx.com/en-au/vip/fees) for Australian accounts.
- Use the [United States fee page](https://www.okx.com/en-us/vip/fees) for OKX INC. accounts.

## Global VIP qualification

The current global qualification rules were updated on 2026-07-19.
The account receives the highest tier reached through assets or one published 30-day product volume.
All values below are USD-equivalent minimums.

| Tier | Assets | Spot volume | Futures volume | Options volume |
| --- | ---: | ---: | ---: | ---: |
| Regular | Below VIP1 | Below VIP1 | Below VIP1 | Below VIP1 |
| VIP1 | $100,000 | $1 million | $5 million | $3 million |
| VIP2 | $200,000 | $5 million | $10 million | $5 million |
| VIP3 | $2 million | $10 million | $50 million | $10 million |
| VIP4 | $5 million | $20 million | $200 million | $25 million |
| VIP5 | $20 million | $100 million | $600 million | $50 million |
| VIP6 | $50 million | $200 million | $1 billion | $100 million |
| VIP7 | $100 million | $500 million | $1.5 billion | $1.5 billion |
| VIP8 | $250 million | $1 billion | $2 billion | $2 billion |
| VIP9 | $500 million | $5 billion | $20 billion | $20 billion |

OKX calculates the tier at 16:00 UTC each day.
The new tier normally applies between 20:00 UTC and 22:00 UTC.
A deposit of at least $1,000 can trigger an immediate review.

### Global spot fees

Every rate in this section is a maker fee followed by a taker fee.
All rates are percentages.

| Tier | Group 1 | Group 2 | Group 3 | Special pairs | Zero-fee pairs |
| --- | --- | --- | --- | --- | --- |
| Regular | 0.080% / 0.100% | 0.080% / 0.100% | 0.080% / 0.100% | 0.100% / 0.150% | 0% / 0% |
| VIP1 | 0.0675% / 0.080% | 0.0675% / 0.080% | 0.0675% / 0.080% | 0.060% / 0.120% | 0% / 0% |
| VIP2 | 0.060% / 0.070% | 0.060% / 0.070% | 0.060% / 0.070% | 0.030% / 0.100% | 0% / 0% |
| VIP3 | 0.055% / 0.065% | 0.055% / 0.065% | 0.055% / 0.065% | 0.020% / 0.070% | 0% / 0% |
| VIP4 | 0.030% / 0.045% | 0.030% / 0.050% | 0.030% / 0.055% | 0.010% / 0.050% | 0% / 0% |
| VIP5 | 0.025% / 0.035% | 0.025% / 0.045% | 0.025% / 0.050% | 0.010% / 0.045% | 0% / 0% |
| VIP6 | 0% / 0.030% | 0% / 0.040% | 0% / 0.045% | 0.010% / 0.040% | 0% / 0% |
| VIP7 | -0.002% / 0.025% | -0.005% / 0.035% | -0.010% / 0.040% | 0.010% / 0.035% | 0% / 0% |
| VIP8 | -0.005% / 0.020% | -0.010% / 0.030% | -0.015% / 0.035% | 0.010% / 0.030% | 0% / 0% |
| VIP9 | -0.0075% / 0.0175% | -0.010% / 0.025% | -0.020% / 0.030% | 0.010% / 0.025% | 0% / 0% |

### Current global spot groups

The current Group 1 list is:

```text
ADA-USDT
BTC-USD
BTC-USDT
DOGE-USDT
ETH-USD
ETH-USDT
HYPE-USDT
LTC-USDT
PEPE-USDT
PUMP-USDT
SOL-USDT
SUI-USDT
XAUT-USDT
XRP-USDT
```

The current Group 2 list is:

```text
AAVE-USDT, APE-USDT, APT-USDT, ARB-USDT, ASTER-USDT, AVAX-USDT, AXS-USDT
BASED-USDT, BCH-USDT, BIO-USDT, BNB-USDT, BONK-USDT
CC-USDT, CFG-USDT, CFX-USDT, CHIP-USD, CHIP-USDT, CHZ-USDT, CORE-USDT
DASH-USDT, DOT-USDT, DYDX-USDT
EDGE-USD, EDGE-USDT, ENA-USDT, ENJ-USDT, ETC-USDT, ETHFI-USDT
FIL-USDT
GRASS-USD, GRASS-USDT
HBAR-USDT, HUMA-USDT
ICP-USDT, IP-USDT
KAT-USDT, KITE-USDT
LINK-USDT, LIT-USDT
MEGA-USD, MEGA-USDT, MERL-USDT, MON-USD, MON-USDT, MOODENG-USDT
NEAR-USDT, NIGHT-USDT
OFC-USD, OFC-USDT, OKB-USDT, ONDO-USDT, ONT-USDT, OP-USDT, ORDI-USDT
PAXG-USDT, PENGU-USDT, PI-USDT, POL-USDT
RENDER-USDT, ROBO-USDT
SHIB-USDT, SOL-USD, SPACE-USDT, SPK-USDT, STETH-USDT, STRK-USDT
TON-USDT, TRUMP-USDT, TRX-USDT
UNI-USDT, USDT-USD
VIRTUAL-USDT
W-USDT, WIF-USDT, WLD-USDT, WLFI-USDT
XLM-USDT, XPL-USDT
ZAMA-USDT, ZEC-USDT, ZRO-USDT
```

Group 3 contains every other eligible spot pair.
Later stablecoin notices override the base group rate.
The live fee page controls if the displayed pair symbol differs from the notice.

### Global futures fees

| Tier | Group 1 maker / taker | Group 2 maker / taker |
| --- | --- | --- |
| Regular | 0.020% / 0.050% | 0.020% / 0.050% |
| VIP1 | 0.018% / 0.040% | 0.018% / 0.040% |
| VIP2 | 0.013% / 0.035% | 0.013% / 0.035% |
| VIP3 | 0.010% / 0.028% | 0.010% / 0.028% |
| VIP4 | 0.008% / 0.027% | 0.008% / 0.027% |
| VIP5 | 0.005% / 0.026% | 0.005% / 0.026% |
| VIP6 | 0% / 0.025% | 0% / 0.025% |
| VIP7 | -0.002% / 0.020% | -0.005% / 0.025% |
| VIP8 | -0.005% / 0.020% | -0.010% / 0.025% |
| VIP9 | -0.005% / 0.015% | -0.010% / 0.020% |

Current Group 1 includes the instruments retained by the 2026-06-01 notice plus the later additions.
The later additions are `MU-USDT`, `SNDK-USDT`, and `SPCX-USDT`.
The later removals to Group 2 are `PUMP-USDT`, `LTC-USDT`, `RIVER-USDT`, and `SOL-USD`.
The current fee page must resolve newly listed and renamed futures.

### Global options fees

| Tier | Maker / taker |
| --- | --- |
| Regular | 0.030% / 0.030% |
| VIP1 | 0.028% / 0.030% |
| VIP2 | 0.025% / 0.030% |
| VIP3 | 0.020% / 0.030% |
| VIP4 | 0.020% / 0.025% |
| VIP5 | 0.015% / 0.020% |
| VIP6 | 0.010% / 0.020% |
| VIP7 | -0.005% / 0.015% |
| VIP8 | -0.010% / 0.015% |
| VIP9 | -0.010% / 0.013% |

### Spread and block trading

Nitro Spreads charges 50% of the applicable account rate on each leg.
The published 30-day spread-volume floors for VIP1 through VIP9 are $15 million, $75 million, $150 million, $300 million, $900 million, $1.5 billion, $2.25 billion, $3 billion, and $30 billion.
The RFQ block minimum notional is $1,000.
Options combination RFQs can receive up to a 50% fee discount.
For an options combination under one underlying, OKX charges only the higher-notional buy or sell side.
Only fee-bearing legs count toward options trading volume.

### Global stablecoin overrides

`RLUSD-USDT` and `USDG-USDT` charge 0% maker and 0.05% taker from 2026-07-01.
`USDT-USD` or the displayed USD stable basket charges 0% maker and 0.05% taker from 2026-07-13.
The older framework list that showed `USDG-USDT` and `USDT-USD` as 0% on both sides is stale.

## United States spot schedule

OKX INC. currently documents spot and convert in the United States.
The current US navigation does not offer the global derivatives schedule.
The account qualifies through the better of assets or 30-day spot volume.

| Tier | Asset floor | Volume floor | Group 1 | Group 2 | Group 3 |
| --- | ---: | ---: | --- | --- | --- |
| Regular | $0 | $0 | 0.200% / 0.350% | 0.200% / 0.350% | 0.200% / 0.350% |
| VIP1 | $100,001 | $100,001 | 0.100% / 0.200% | 0.100% / 0.200% | 0.100% / 0.200% |
| VIP2 | $200,000 | $250,001 | 0.075% / 0.150% | 0.075% / 0.150% | 0.075% / 0.150% |
| VIP3 | $2 million | $500,001 | 0.060% / 0.125% | 0.060% / 0.125% | 0.060% / 0.125% |
| VIP4 | $5 million | $1,000,001 | 0.050% / 0.100% | 0.050% / 0.100% | 0.050% / 0.100% |
| VIP5 | $20 million | $2,500,001 | 0.045% / 0.080% | 0.045% / 0.080% | 0.045% / 0.080% |
| VIP6 | $50 million | $5,000,001 | 0.040% / 0.070% | 0.040% / 0.070% | 0.040% / 0.070% |
| VIP7 | $100 million | $50,000,001 | -0.002% / 0.025% | -0.005% / 0.035% | -0.010% / 0.040% |
| VIP8 | $250 million | $75,000,001 | -0.005% / 0.020% | -0.010% / 0.030% | -0.015% / 0.035% |
| VIP9 | $500 million | $125,000,001 | -0.0075% / 0.0175% | -0.010% / 0.025% | -0.020% / 0.030% |

`RLUSD-USDT`, `USDG-USDT`, and `USDT-USD` charge 0% maker and 0.04% taker under later US notices.
The published US VIP6 range contains an apparent overlap or endpoint typo.
The live US fee page must resolve the exact qualification boundary.

## European Economic Area schedules

OKX Europe Limited publishes separate spot schedules for accounts with and without X-Perps access.
The better result from assets or 30-day volume determines the tier.

### EEA account with X-Perps access

| Tier | Asset floor | Volume floor | Spot maker / taker |
| --- | ---: | ---: | --- |
| Regular | $0 equivalent | $0 equivalent | 0.080% / 0.100% |
| VIP1 | $100,001 equivalent | $1,000,001 equivalent | 0.0675% / 0.080% |
| VIP2 | $200,001 equivalent | $5,000,001 equivalent | 0.060% / 0.070% |
| VIP3 | $2,000,001 equivalent | $10,000,001 equivalent | 0.055% / 0.065% |
| VIP4 | $5,000,001 equivalent | $20,000,001 equivalent | 0.030% / 0.045% |
| VIP5 | $20,000,001 equivalent | $100,000,001 equivalent | 0.025% / 0.035% |
| VIP6 | $50,000,001 equivalent | $200,000,001 equivalent | 0% / 0.030% |
| VIP7 | $100,000,001 equivalent | $500,000,001 equivalent | -0.002% / 0.025% |
| VIP8 | $250,000,001 equivalent | $1,000,000,001 equivalent | -0.005% / 0.020% |
| VIP9 | $500,000,001 equivalent | $5,000,000,001 equivalent | -0.0075% / 0.0175% |

### EEA account without X-Perps access

| Tier | Asset floor | Volume floor | Spot maker / taker |
| --- | ---: | ---: | --- |
| Regular | $0 equivalent | $0 equivalent | 0.20% / 0.35% |
| VIP1 | $100,000 equivalent | $100,001 equivalent | 0.10% / 0.20% |
| VIP2 | $200,000 equivalent | $250,001 equivalent | 0.09% / 0.18% |
| VIP3 | $2 million equivalent | $500,001 equivalent | 0.08% / 0.15% |
| VIP4 | $5 million equivalent | $1,000,001 equivalent | 0.075% / 0.10% |
| VIP5 | $20 million equivalent | $2,500,001 equivalent | 0.07% / 0.085% |
| VIP6 | $50 million equivalent | $5,000,001 equivalent | 0.06% / 0.07% |
| VIP7 | $100 million equivalent | $10,000,001 equivalent | 0.055% / 0.065% |
| VIP8 | $250 million equivalent | $20,000,001 equivalent | 0.045% / 0.06% |
| VIP9 | $500 million equivalent | $50,000,001 equivalent | 0.03% / 0.055% |

The current EEA article does not publish one complete static X-Perps derivative matrix.
The EEA fee page and authenticated API are the source of record for derivative rates.
Zero-fee trades and qualifying market-maker zero-fee trades do not count toward published spot volume.

## Australia schedules

Australian retail spot and wholesale spot use different schedules.
Wholesale derivatives are offered through OKX Australia Financial Pty Ltd to eligible wholesale clients.

### Australia retail spot

| Tier | Asset floor | Volume floor | Maker / taker |
| --- | ---: | ---: | --- |
| Regular | $0 | $0 | 0.700% / 0.700% |
| VIP1 | $150,000 | $200,000 | 0.450% / 0.500% |
| VIP2 | $300,000 | $600,000 | 0.400% / 0.400% |
| VIP3 | $3 million | $2 million | 0.250% / 0.300% |
| VIP4 | $7.5 million | $5 million | 0.120% / 0.200% |
| VIP5 | $30 million | $10 million | 0.080% / 0.150% |
| VIP6 | $75 million | $20 million | 0.060% / 0.100% |
| VIP7 | $150 million | $30 million | 0.040% / 0.080% |
| VIP8 | $375 million | $50 million | 0.025% / 0.060% |
| VIP9 | $750 million | $300 million | 0% / 0.050% |

### Australia wholesale spot

| Tier | Asset floor | Volume floor | AUD pairs | Non-AUD Group 1 | Group 2 | Group 3 |
| --- | ---: | ---: | --- | --- | --- | --- |
| Regular | $0 | $0 | 0.4% / 0.4% | 0.08% / 0.10% | 0.08% / 0.10% | 0.08% / 0.10% |
| VIP1 | $150,000 | $1.5 million | 0.25% / 0.30% | 0.0675% / 0.08% | 0.0675% / 0.08% | 0.0675% / 0.08% |
| VIP2 | $300,000 | $7.5 million | 0.10% / 0.20% | 0.06% / 0.07% | 0.06% / 0.07% | 0.06% / 0.07% |
| VIP3 | $3 million | $15 million | 0.08% / 0.10% | 0.055% / 0.065% | 0.055% / 0.065% | 0.055% / 0.065% |
| VIP4 | $7.5 million | $30 million | 0.04% / 0.08% | 0.03% / 0.045% | 0.03% / 0.05% | 0.03% / 0.055% |
| VIP5 | $30 million | $150 million | 0.025% / 0.06% | 0.025% / 0.035% | 0.025% / 0.045% | 0.025% / 0.05% |
| VIP6 | $75 million | $300 million | 0% / 0.04% | 0% / 0.03% | 0% / 0.04% | 0% / 0.045% |
| VIP7 | $150 million | $750 million | -0.005% / 0.035% | -0.002% / 0.025% | -0.005% / 0.035% | -0.010% / 0.04% |
| VIP8 | $375 million | $1.5 billion | -0.010% / 0.030% | -0.005% / 0.020% | -0.010% / 0.030% | -0.015% / 0.035% |
| VIP9 | $750 million | $7.5 billion | -0.010% / 0.025% | -0.0075% / 0.0175% | -0.010% / 0.025% | -0.020% / 0.030% |

### Australia wholesale futures

| Tier | Asset floor | Volume floor | Group 1 maker / taker | Group 2 maker / taker |
| --- | ---: | ---: | --- | --- |
| Regular | $0 | $0 | 0.020% / 0.050% | 0.020% / 0.050% |
| VIP1 | $150,000 | $7.5 million | 0.016% / 0.045% | 0.016% / 0.045% |
| VIP2 | $300,000 | $15 million | 0.015% / 0.036% | 0.015% / 0.036% |
| VIP3 | $3 million | $75 million | 0.010% / 0.028% | 0.010% / 0.028% |
| VIP4 | $7.5 million | $300 million | 0.008% / 0.027% | 0.008% / 0.027% |
| VIP5 | $30 million | $900 million | 0.005% / 0.026% | 0.005% / 0.026% |
| VIP6 | $75 million | $1.5 billion | 0% / 0.025% | 0% / 0.025% |
| VIP7 | $150 million | $2.25 billion | -0.002% / 0.020% | -0.005% / 0.025% |
| VIP8 | $375 million | $3 billion | -0.005% / 0.020% | -0.010% / 0.025% |
| VIP9 | $750 million | $30 billion | -0.005% / 0.015% | -0.010% / 0.020% |

`USDT-USD` currently charges 0% maker and 0.04% taker.
An Australian notice schedules `USDT/USDⓈ`, `USDG-USDT`, and `RLUSD-USDT` at 0% maker and 0.05% taker on 2026-07-30.
That future change is not current on the retrieval date.

## Singapore schedules

Standard retail customers and accredited investors use different schedules.

### Singapore standard retail spot

| Tier | Asset floor | Volume floor | Maker / taker |
| --- | ---: | ---: | --- |
| Regular | $0 | $0 | 0.10% / 0.20% |
| VIP1 | $125,001 | $1.25 million | 0.08% / 0.125% |
| VIP2 | $300,001 | $6.25 million | 0.065% / 0.10% |
| VIP3 | $625,001 | $12.5 million | 0.055% / 0.065% |
| VIP4 | $2.5 million | $25 million | 0.035% / 0.055% |
| VIP5 | $6.25 million | $125 million | 0.025% / 0.05% |
| VIP6 | $12.5 million | $250 million | 0.015% / 0.045% |
| VIP7 | Not published | $750 million | 0% / 0.04% |
| VIP8 | Not published | $1.25 billion | 0% / 0.035% |
| VIP9 | Not published | $6.25 billion | 0% / 0.03% |

### Singapore accredited investor spot

| Tier | Asset floor | Volume floor | Group 1 | Group 2 | Group 3 |
| --- | ---: | ---: | --- | --- | --- |
| Regular | $0 | $0 | 0.08% / 0.10% | 0.08% / 0.10% | 0.08% / 0.10% |
| VIP1 | $125,001 | $1.25 million | 0.0675% / 0.08% | 0.0675% / 0.08% | 0.0675% / 0.08% |
| VIP2 | $250,001 | $6.25 million | 0.06% / 0.07% | 0.06% / 0.07% | 0.06% / 0.07% |
| VIP3 | $2.5 million | $12.5 million | 0.055% / 0.065% | 0.055% / 0.065% | 0.055% / 0.065% |
| VIP4 | $6.25 million | $25 million | 0.03% / 0.045% | 0.03% / 0.05% | 0.03% / 0.055% |
| VIP5 | $25 million | $125 million | 0.025% / 0.035% | 0.025% / 0.045% | 0.025% / 0.05% |
| VIP6 | $62.5 million | $250 million | 0% / 0.03% | 0% / 0.04% | 0% / 0.045% |
| VIP7 | $125 million | $750 million | -0.002% / 0.025% | -0.005% / 0.035% | -0.010% / 0.04% |
| VIP8 | $320 million | $1.25 billion | -0.005% / 0.02% | -0.010% / 0.03% | -0.015% / 0.035% |
| VIP9 | $625 million | $6.25 billion | -0.0075% / 0.0175% | -0.010% / 0.025% | -0.020% / 0.03% |

The published accredited zero-fee pairs are `DAI-USDT`, `PYUSD-USDT`, `USDC-USDT`, and `USDG-USDT`.
Zero-fee pair volume does not count toward 30-day spot volume.

### Singapore accredited investor futures

| Tier | Asset floor | Volume floor | Group 1 | Group 2 |
| --- | ---: | ---: | --- | --- |
| Regular | $0 | $0 | 0.02% / 0.05% | 0.02% / 0.05% |
| VIP1 | $125,001 | $6.25 million | 0.016% / 0.045% | 0.016% / 0.045% |
| VIP2 | $250,001 | $12.5 million | 0.015% / 0.036% | 0.015% / 0.036% |
| VIP3 | $2.5 million | $62.5 million | 0.01% / 0.028% | 0.01% / 0.028% |
| VIP4 | $6.25 million | $250 million | 0.008% / 0.027% | 0.008% / 0.027% |
| VIP5 | $25 million | $750 million | 0.005% / 0.026% | 0.005% / 0.026% |
| VIP6 | $62.5 million | $1.25 billion | 0% / 0.025% | 0% / 0.025% |
| VIP7 | $125 million | $1.5 billion | -0.002% / 0.02% | -0.005% / 0.025% |
| VIP8 | $320 million | $2.5 billion | -0.005% / 0.02% | -0.010% / 0.025% |
| VIP9 | $625 million | $25 billion | -0.005% / 0.015% | -0.010% / 0.02% |

### Singapore accredited investor options

| Tier | Asset floor | Volume floor | Maker / taker |
| --- | ---: | ---: | --- |
| Regular | $0 | $0 | 0.03% / 0.03% |
| VIP1 | $125,001 | $3.75 million | 0.028% / 0.03% |
| VIP2 | $250,001 | $6.25 million | 0.025% / 0.03% |
| VIP3 | $2.5 million | $12.5 million | 0.02% / 0.03% |
| VIP4 | $6.25 million | $32 million | 0.02% / 0.025% |
| VIP5 | $25 million | $62.5 million | 0.015% / 0.02% |
| VIP6 | $62.5 million | $125 million | 0.01% / 0.02% |
| VIP7 | $125 million | $1.8 billion | -0.005% / 0.015% |
| VIP8 | $320 million | $2.5 billion | -0.010% / 0.015% |
| VIP9 | $625 million | $25 billion | -0.010% / 0.013% |

## United Arab Emirates schedules

The current May threshold notice updates qualification but does not replace the January rate matrix.
The account receives the best tier from assets or one qualifying product volume.
All threshold values are AED.

| Tier | Asset floor | Published volume floor |
| --- | ---: | ---: |
| Regular | Below 400,000 | Below 1 million |
| VIP1 | 400,000 | 1 million |
| VIP2 | 750,000 | 5 million |
| VIP3 | 7.5 million | 10 million |
| VIP4 | 20 million | 25 million |
| VIP5 | 75 million | 50 million |
| VIP6 | 180 million | 100 million |
| VIP7 | 360 million | 500 million |
| VIP8 | 900 million | 1 billion |
| VIP9 | 1.8 billion | 2 billion |

| Tier | Spot maker / taker | Zero pairs | Futures and options maker / taker |
| --- | --- | --- | --- |
| Regular | 0.400% / 0.600% | 0% / 0% | 0.100% / 0.250% |
| VIP1 | 0.350% / 0.550% | 0% / 0% | 0.050% / 0.125% |
| VIP2 | 0.300% / 0.500% | 0% / 0% | 0.040% / 0.100% |
| VIP3 | 0.250% / 0.450% | 0% / 0% | 0.025% / 0.090% |
| VIP4 | 0.200% / 0.400% | 0% / 0% | 0.015% / 0.085% |
| VIP5 | 0.150% / 0.350% | 0% / 0% | 0.008% / 0.080% |
| VIP6 | 0.100% / 0.300% | 0% / 0% | 0% / 0.075% |
| VIP7 | 0.050% / 0.250% | 0% / 0% | 0% / 0.070% |
| VIP8 | 0.020% / 0.200% | 0% / 0% | 0% / 0.060% |
| VIP9 | 0% / 0.150% | 0% / 0% | 0% / 0.050% |

The May notice labels its volume column as futures volume.
Its prose says the highest result from any single product line determines the account tier.
This official inconsistency requires the local UAE fee page for a final answer.
The current UAE `USDT-USD` rate is 0% maker and 0.04% taker.

## Turkey schedule

The later 2026-06-26 notice overrides the TRY-pair rates from the base table.
USDT-TRY and non-TRY rates remain in the base schedule.
All thresholds are TRY.

| Tier | Asset floor | Volume floor | Current TRY pairs | USDT-TRY | Non-TRY pairs |
| --- | ---: | ---: | --- | --- | --- |
| Regular | 0 | 0 | 0.10% / 0.22% | 0.10% / 0.15% | 0.08% / 0.10% |
| VIP1 | 4 million | 1 million | 0.07% / 0.19% | 0.06% / 0.12% | 0.07% / 0.09% |
| VIP2 | 10 million | 10 million | 0.065% / 0.125% | 0.03% / 0.10% | 0.06% / 0.08% |
| VIP3 | Source contains a typo | 50 million | 0.03% / 0.11% | 0.02% / 0.07% | 0.05% / 0.07% |
| VIP4 | 80 million | 150 million | 0.02% / 0.10% | 0.01% / 0.05% | 0.04% / 0.055% |
| VIP5 | 200 million | 300 million | 0.01% / 0.09% | 0.01% / 0.045% | 0.035% / 0.05% |
| VIP6 | 400 million | 500 million | 0% / 0.08% | 0.01% / 0.04% | 0.03% / 0.045% |
| VIP7 | Not published | 1 billion | -0.005% / 0.06% | 0.01% / 0.035% | 0.025% / 0.04% |
| VIP8 | Not published | 10 billion | -0.010% / 0.05% | 0.01% / 0.03% | -0.005% / 0.035% |
| VIP9 | Not published | 40 billion | -0.020% / 0.04% | 0.01% / 0.025% | -0.0075% / 0.03% |

The official table prints the VIP3 asset lower bound as `20,000,0001`.
Interpreting that value as `20,000,001` is reasonable but remains an inference.

## Brazil schedule

The better result from BRL assets or 30-day volume determines the tier.

| Tier | Asset floor | Volume floor | BRL pairs | Non-BRL pairs | Zero pairs |
| --- | ---: | ---: | --- | --- | --- |
| Regular | R$0 | R$0 | 0.10% / 0.40% | 0.10% / 0.40% | 0% / 0% |
| VIP1 | R$500,000 | R$200,000 | 0.07% / 0.32% | 0.07% / 0.32% | 0% / 0% |
| VIP2 | R$1.25 million | R$500,000 | 0.065% / 0.25% | 0.065% / 0.25% | 0% / 0% |
| VIP3 | R$2.5 million | R$1 million | 0.03% / 0.15% | 0.055% / 0.15% | 0% / 0% |
| VIP4 | R$10 million | R$5 million | 0.02% / 0.115% | 0.03% / 0.115% | 0% / 0% |
| VIP5 | R$25 million | R$20 million | 0.01% / 0.11% | 0.025% / 0.11% | 0% / 0% |
| VIP6 | R$50 million | R$50 million | 0% / 0.105% | 0% / 0.105% | 0% / 0% |
| VIP7 | Not published | R$100 million | -0.03% / 0.10% | 0% / 0.10% | 0% / 0% |
| VIP8 | Not published | R$200 million | -0.05% / 0.09% | 0% / 0.09% | 0% / 0% |
| VIP9 | Not published | R$400 million | -0.05% / 0.08% | 0% / 0.08% | 0% / 0% |

## Derivative notional and trading formulas

### Linear USDT and USDC contracts

```text
trade notional = contracts × multiplier × contract size × fill price
trading fee = trade notional × maker or taker rate
```

The result is charged in the linear contract settlement currency.

### Crypto-margined inverse contracts

```text
trade notional in settlement coin = contracts × multiplier × USD face value ÷ fill price
trading fee = trade notional in settlement coin × maker or taker rate
```

### Expiry settlement

OKX publishes a 0.01% expiry settlement fee for every user tier.
The settlement fee is separate from opening and closing execution fees.

### TradFi perpetuals

OKX calculates a TradFi perpetual execution fee from trade value and the applicable rate.

```text
TradFi perpetual fee = trade value × applicable maker or taker rate
```

The public product FAQ uses 0.02% maker and 0.05% taker as the standard example.
Designated market-maker, market-maker, and taker-market-maker discounts require application and approval.
The authenticated account rate is the source of record for an approved program.

### Options trading

The options execution fee is the lower of the standard notional fee and 7% of premium.

```text
standard fee = fee rate × multiplier × contract size × contracts
premium cap = 7% × premium × multiplier × contract size × contracts
options trading fee = minimum of standard fee and premium cap
```

### Options exercise and forced liquidation

The exercise fee is the lowest of the 0.02% schedule, the user taker-rate schedule, and 7% of settlement value.
Day options have no exercise fee.
Unexercised options have no exercise fee.
An options forced-liquidation fee is capped at 7% of mark-price notional.

### Options VIP volume

OKX uses effective notional for options tier qualification.

```text
effective notional = minimum of notional and absolute actual fee ÷ absolute fee rate
```

Coin-settled options fees are converted to USD with the index price.
USDT-settled options already use a USDT value.
Eligible structured-product trading volume counts toward options volume under the current volume notice.

## Perpetual funding

Funding is a transfer between long and short holders.
OKX does not charge a separate service fee on that transfer.
Positive funding means longs pay shorts.
Negative funding means shorts pay longs.

The common assessment times are 00:00 UTC, 08:00 UTC, and 16:00 UTC.
Some contracts use one-hour, two-hour, or four-hour intervals.
The live instrument fields must determine the next interval.

```text
funding fee = position value × funding rate
linear position value = contracts × contract size × multiplier × mark price
inverse position value = contracts × face value × multiplier ÷ mark price
```

The current formula uses average premium, interest, a small inner clamp, an interval divisor, and contract-specific cap and floor values.

```text
rate = clamp((average premium + clamp(interest - average premium, -0.05%, 0.05%)) ÷ (8 ÷ N), floor, cap)
```

The default interest input is 0.01%.
`N` is the number of funding assessments in eight hours.
The premium uses impact bid, impact ask, and index prices.
Impact value is 200 times the maximum leverage under the current mechanism.

## Event contracts

The authenticated fee schema documents the event-contract formulas directly.
`C` is the number of contracts and `P` is the contract price.

```text
taker fee = K1 × C × P × (1 - P)
maker fee = K2 × C × P × (1 - P)
```

The current published coefficients are `K1 = 0.045` and `K2 = -0.009`.
The negative maker coefficient is a rebate.
The newer event-contract fee notice waives settlement fees.
An older FAQ example still mentions a settlement deduction and is stale.

## Retail Price Improvement

The Retail Price Improvement program replaces the Enhanced Liquidity Program.
Dedicated makers use RPI order types under an approved agreement.
The current maker rate is dynamic and appears as `rpiMaker` in the authenticated fee endpoint.
The instrument metadata indicates whether RPI is disabled, taker enabled, or maker enabled.
Historical ELP rebate notices must not be treated as the current RPI schedule.

## Rebates, promotions, and institutional pricing

Negative maker rates in the published tables are rebates.
Zero-fee and special-pair rates override the normal pair group only while the current regional fee page applies them.
Temporary campaigns, referral rewards, and promotional discounts do not establish a permanent universal trading rate.

Market-maker, designated market-maker, taker-market-maker, broker, custody, managed-account, and some institutional rates require an agreement or authenticated account.
OKX does not publish one universal current price table for custody or managed trading subaccounts.
These services are negotiated or not publicly specified.
The account agreement, authenticated fee endpoint, relationship manager, and invoice are the applicable sources of record.

## Convert, P2P, and OTC

OKX Convert publishes no transaction fee and no slippage.
Its firm quote can differ from the spot order book.
That quote difference is an economic cost even though it is not labeled a fee.

OKX charges no service fee for P2P trading.
The external payment provider can charge a separate fee.
P2P users set their own quoted price.

OTC, block, broker, and institutional execution prices can be negotiated or account-gated.
No universal current OTC commission table was found.

## Crypto deposits, withdrawals, and transfers

OKX charges no crypto deposit fee.
Crypto withdrawals use a dynamic network fee shown before confirmation.
OKX says this single withdrawal charge includes operational cost and current network conditions.
The fee can change with congestion, asset, network, and amount.
Recovery of a deposit below the supported minimum can require an additional fee.

Internal transfers within an eligible OKX account structure do not use a blockchain withdrawal.
The account preview remains the source of record for any product-specific transfer restriction.

## Fiat funding

| Region and method | Deposit | Withdrawal | Limitation |
| --- | --- | --- | --- |
| United States domestic wire | 0 OKX fee | $30 | Sending or receiving banks can add charges. |
| United States debit-card purchase | 2.49% | Not applicable | The card issuer can add charges. |
| EEA SEPA | 0 | 0 | Bank and eligibility rules apply. |
| EEA card cash deposit | Dynamic preview | Not applicable | Residence and card determine the fee. |
| EEA cash-balance express buy | 0 | Not applicable | The customer must already hold an eligible cash balance. |
| Australia bank transfer | 0 | 0 | Supported bank and account rules apply. |
| Generic cash rails | Dynamic | Dynamic | The preview can show a flat fee, percentage, or both. |

The US ACH fee table displays `N/A` rather than an explicit zero.
This profile does not reinterpret `N/A` as free.

## Margin borrowing and loans

### Margin borrowing

Margin borrowing has no interest-free quota.
Interest accrues and is deducted hourly on the hour.
Cross and isolated liabilities accrue separately.

```text
hourly interest = interest-bearing liability × daily asset rate ÷ 24
```

The daily asset rate is dynamic by currency and account tier.

### Flexible Loan

Flexible Loan publishes a variable APR range from 1% through 365%.
Interest accrues hourly on principal plus previously accrued interest.
There is no fixed maturity or standard overdue fee.
The current APR can change hourly.
Loan-to-value risk can trigger repayment or liquidation.

### VIP and institutional loans

VIP Loan terms are contract specific.
Overdue interest accrues hourly.
The current institutional agreement contains wording that cites 30% for USDT and 10% for BTC in its overdue-interest provision.
That wording should be quoted only with the product agreement because its exact basis is not fully clear.
A position can be forcibly liquidated after 14 days under the cited agreement.
Repayment more than 120 hours before maturity requires all remaining interest.
Repayment within 120 hours of maturity requires interest through the current hour.

## Earn and structured products

### Simple Earn Flexible

OKX deducts 15% of accrued return as a service fee.
The customer receives 85% of gross accrued return.

```text
customer hourly return = amount lent × APR ÷ 365 ÷ 24 × 85%
```

### Simple Earn Fixed

The fixed-term agreement does not apply the Flexible product's 15% service fee automatically.
Early termination and borrower compensation depend on the order terms and remaining duration.

### On-chain Earn

The service fee varies by product and appears in the subscription preview.
The displayed APY is net of the published OKX service fee.
Historical launch rates for individual assets are not a current universal schedule.

### BTC Yield+

BTC Yield+ publishes no subscription or redemption fee.
Eligibility is limited to supported VIP tiers and regions.

### Dual Investment and other structured products

OKX does not publish one universal service-fee rate for Dual Investment.
The product terms and order preview determine the economic return.

```text
term rate = APR ÷ 100 ÷ 365 × term days
yield = investment amount × term rate
```

Other structured products also use product-specific order terms.
No missing public rate is treated as zero.

## Card fees

### United States Card

OKX publishes zero foreign-exchange fee over the Mastercard rate.
Supported stablecoin conversion to USD is zero.
Issuance, monthly, annual, and inactivity fees are zero.

### EEA Card

The foreign-exchange fee is zero.
USDC or USDG conversion to EUR includes a 0.10% conversion spread.
Issuance, monthly, annual, and inactivity fees are zero.

### Singapore Card

The foreign-exchange fee is zero.
USDG or USDC conversion to USD is zero.
USDT conversion to USD is 0.10%.
Supported stablecoin conversion to SGD is 0.10%.
Issuance, monthly, annual, and inactivity fees are zero.

### Brazil Card

The current card page lists issuance, funding, domestic and international transaction, crypto conversion, foreign exchange, IOF, monthly, annual, replacement, inactivity, and closure charges as zero.

### Australia Card

Bano Pty Ltd issues the Australian card.
OKX Australia acts as distributor and authorized representative.
OKX applies a 0.10% conversion spread to card transactions.
The Mastercard conversion rate or spread can also affect the result.
Acquisition, annual, monthly, and inactivity fees are zero.

## Worked examples

### Global regular linear perpetual taker round trip

Assume a regular global account opens a $10,000 Group 1 linear perpetual as a taker and closes the same notional as a taker.

```text
opening fee = $10,000 × 0.050% = $5.00
closing fee = $10,000 × 0.050% = $5.00
round-trip trading fee = $10.00
```

Funding and slippage remain additional.

### Global VIP7 Group 1 spot maker rebate

Assume a VIP7 global account receives a maker execution for $50,000 on a Group 1 spot pair.

```text
maker rebate = $50,000 × 0.002% = $1.00
```

The authenticated response can express the rebate with a positive API value even though the public table displays a negative fee rate.

### Inverse contract fee

Assume a contract has a $100 face value, one contract, a multiplier of one, a $50,000 fill price, and a 0.05% taker rate.

```text
coin notional = 1 × $100 ÷ $50,000 = 0.002 BTC
fee = 0.002 BTC × 0.05% = 0.000001 BTC
```

## What must be fetched live

| Value | Official lookup |
| --- | --- |
| Current account tier and standard rates | Signed-in regional fee page or `GET /api/v5/account/trade-fee`. |
| Pair group and zero-fee override | Live regional fee page and pair order panel. |
| Market-maker and RPI rates | Authenticated fee endpoint with the instrument or family. |
| Funding rate, interval, cap, and floor | Public funding endpoint or WebSocket funding channel. |
| Margin and loan interest | Borrowing or loan preview and authenticated account data. |
| Crypto withdrawal fee | Withdrawal preview. |
| Fiat funding fee | Deposit or withdrawal preview. |
| Convert economic price | Convert quote. |
| Earn service fee and net APY | Subscription preview. |
| Structured-product economics | Product order terms. |
| Broker, custody, managed-account, and OTC pricing | Agreement, relationship manager, or invoice. |

## Known official-source conflicts

The current July global VIP qualification article supersedes the older November 2025 qualification thresholds.
The June and July pair notices supersede the original framework group lists and zero-fee list.
The US framework contains an apparent VIP6 volume-range typo.
The Turkey framework contains `20,000,0001` as the VIP3 asset lower bound.
The UAE threshold notice labels the volume column as futures volume while its prose says any single product line can qualify.
The current EEA article does not publish a complete static X-Perps derivative rate matrix.
The event-contract FAQ mentions settlement in an example while the newer fee notice waives settlement.
The Australian 2026-07-30 stablecoin update is future-dated relative to this profile.
Historical ELP rates do not establish the current RPI maker rate.

## Source ledger

Every source below is an official OKX source retrieved on 2026-07-26.

| Official source | Region or product | Supports |
| --- | --- | --- |
| [OKX Terms of Service](https://www.okx.com/en-eu/help/terms-of-service) | Global entity routing | Legal entities and regional account boundaries. |
| [Australia Terms of Service](https://www.okx.com/en-au/help/terms-of-service-australia) | Australia | Spot, wholesale derivatives, and Web3 entity boundaries. |
| [API V5 documentation](https://www.okx.com/docs-v5/en/) | Global API | Authenticated trade-fee lookup, signs, fee groups, event formula, and special rates. |
| [Current VIP qualification](https://www.okx.com/en-gb/help/whats-okx-vip-and-how-do-i-qualify-for-it) | Global | Current assets and product-volume thresholds. |
| [Trading Fee FAQ](https://www.okx.com/en-us/help/trading-fee-rules-faq) | Global products | Maker and taker rules, formulas, settlement, options caps, and liquidation treatment. |
| [Global fee framework](https://www.okx.com/en-gb/help/updates-to-global-fee-framework) | Global | Static spot, futures, options, special, and zero-fee matrices. |
| [Pair-group update](https://www.okx.com/en-us/help/upcoming-fee-token-pairs-group-1-2-3) | Global and US | Current published spot and futures grouping baseline. |
| [July fee-group update](https://www.okx.com/en-gb/help/fee-group-update-for-fee-tokens-update-july) | Global | Later futures group movements and stablecoin overrides. |
| [SPCX futures fee update](https://www.okx.com/en-gb/help/fee-update-for-perp-trading-pairs-spcx-usdt) | Global | SPCX-USDT movement to Group 1. |
| [USDT-USD fee update](https://www.okx.com/en-gb/help/fee-adjustment-for-spot-trading-pair-usdt-usd) | Global | Current global stablecoin rate. |
| [Nitro Spreads introduction](https://www.okx.com/en-gb/help/nitro-spreads-introduction) | Global | Per-leg discount and product behavior. |
| [Block trading basics](https://www.okx.com/en-gb/help/block-trading-basics) | Global | RFQ block minimum. |
| [Options volume adjustment](https://www.okx.com/en-gb/help/options-vip-trading-volume-calculation-adjustment) | Global | Effective notional formula. |
| [Structured-product volume treatment](https://www.okx.com/en-gb/help/structured-products-trading-volume-to-count-towards-options-volume-for-vip) | Global | Structured-product volume contribution to options tiering. |
| [TradFi perpetuals FAQ](https://www.okx.com/en-gb/help/stock-perpetuals-faq) | TradFi perpetuals | Trade-value formula, standard rate example, and gated market-maker programs. |
| [US fee framework](https://www.okx.com/en-us/help/updates-to-us-fee-framework-2026) | United States | US spot tiers and published volume ranges. |
| [US asset-threshold update](https://www.okx.com/en-us/help/notice-updates-to-okx-inc-trading-fees-april-22nd-2026) | United States | Current US asset thresholds. |
| [US stablecoin update](https://www.okx.com/en-us/help/notice-fee-update-for-rlusd-usdt-and-usdg-usdt-effective-june-19-2026) | United States | RLUSD-USDT and USDG-USDT override. |
| [US USDT-USD update](https://www.okx.com/en-us/help/notice-fee-update-for-usdt-usd-effective-july-13-2026) | United States | USDT-USD override. |
| [Current EEA fees](https://www.okx.com/en-eu/help/what-are-the-new-trading-fees-for-eea-users) | EEA | Accounts with and without X-Perps access. |
| [Australia fee framework](https://www.okx.com/en-au/help/notice-updates-to-okx-au-trading-fees) | Australia | Retail spot, wholesale spot, and wholesale futures. |
| [Australia stablecoin update](https://www.okx.com/en-au/help/fee-update-for-spot-trading-pair-usdt-usds-usdg-usdt-rlusd-usdt-au) | Australia | Current and future-dated stablecoin treatment. |
| [Singapore retail fees](https://www.okx.com/en-sg/help/updates-to-okx-sg-trading-fees-27feb-2026) | Singapore | Standard retail spot tiers. |
| [Singapore accredited investor fees](https://www.okx.com/en-sg/help/sg-accredited-investor-trading-fees) | Singapore | Accredited spot, futures, options, pair groups, and zero pairs. |
| [UAE fee framework](https://www.okx.com/en-ae/help/upcoming-change-to-vip-tier-uae) | UAE | Spot and derivative rates. |
| [UAE threshold update](https://www.okx.com/en-ae/help/updates-to-okx-middle-east-fintech-fze-vip-tier-thresholds-may-2026) | UAE | Current asset and volume qualification floors. |
| [Turkey fee framework](https://www.okx.com/en-gb/help/upcoming-change-to-tr-vip-tier) | Turkey | TRY, USDT-TRY, and non-TRY tiers. |
| [Turkey TRY-pair update](https://www.okx.com/en-us/help/important-notice-upcoming-fee-adjustment-to-try-pairs) | Turkey | Current TRY-pair maker and taker rates. |
| [Brazil fee framework](https://www.okx.com/en-gb/help/upcoming-change-to-br-vip-tier) | Brazil | BRL and non-BRL spot tiers. |
| [Perpetual funding mechanism](https://www.okx.com/en-us/help/perps-funding-fee-mechanism) | Perpetuals | Current funding formula, intervals, and position value. |
| [Event contract fee update](https://www.okx.com/en-eu/help/notice-on-event-contracts-fee-updates) | Event contracts | Coefficients and settlement waiver. |
| [RPI program](https://www.okx.com/en-gb/help/okx-retail-price-improvement-program-rpi) | RPI | Eligibility, migration, account fields, and rate lookup. |
| [Convert introduction](https://www.okx.com/en-gb/help/what-is-okx-convert) | Convert | Zero transaction fee and quote behavior. |
| [P2P introduction](https://www.okx.com/en-us/help/what-is-p2p-trading) | P2P | Zero OKX service fee and third-party charges. |
| [Crypto deposit and withdrawal fees](https://www.okx.com/en-us/help/do-i-need-to-pay-fees-for-deposit-and-withdrawal) | Asset movement | Zero deposits and dynamic withdrawal fees. |
| [Cash deposit limits, fees, and processing](https://www.okx.com/en-eu/help/limits-fees-and-processing-time-details-for-cash-deposit) | Fiat funding | Dynamic flat and percentage cash-rail fees. |
| [United States debit-card purchase](https://www.okx.com/en-gb/help/how-do-i-buy-crypto-with-debit-cards) | United States fiat purchase | Published debit-card percentage. |
| [United States domestic wire deposit](https://www.okx.com/en-us/help/how-do-i-deposit-usd-with-us-domestic-wire-transfer) | United States fiat funding | Zero OKX deposit fee and possible bank charges. |
| [United States USD transfers](https://www.okx.com/en-us/help/introducing-usd-deposits-and-withdrawals) | United States fiat funding | Domestic wire withdrawal charge. |
| [EEA SEPA deposit](https://www.okx.com/en-eu/help/how-do-i-deposit-eur-with-sepa-bank-transfer) | EEA fiat funding | Zero SEPA deposit fee. |
| [EEA SEPA withdrawal](https://www.okx.com/en-us/help/how-do-i-withdraw-eur-with-sepa-bank-transfer) | EEA fiat funding | Zero SEPA withdrawal fee. |
| [EEA card cash deposit](https://www.okx.com/en-eu/help/how-do-i-deposit-eur-with-a-debit-or-credit-card) | EEA fiat funding | Residence-dependent preview fee. |
| [EEA cash-balance purchase](https://www.okx.com/en-gb/help/how-do-i-buy-crypto-with-my-cash-balance-eea) | EEA fiat purchase | Zero express-buy transaction fee. |
| [Australia bank deposit](https://www.okx.com/en-us/help/how-do-i-deposit-aud-with-bank-transfer) | Australia fiat funding | Zero bank-transfer deposit fee. |
| [Australia bank withdrawal](https://www.okx.com/en-au/help/how-do-i-withdraw-aud-with-bank-transfer) | Australia fiat funding | Zero bank-transfer withdrawal fee. |
| [Margin borrowing interest](https://www.okx.com/en-gb/help/how-to-calculate-borrowing-interest) | Margin | Hourly interest formula. |
| [Flexible Loan terms](https://www.okx.com/en-us/help/flexible-crypto-loan-service-terms) | Loans | APR range and hourly accrual. |
| [OKX Loan overview](https://www.okx.com/en-us/help/whats-an-okx-loan) | Loans | Flexible maturity, hourly rate changes, and loan-to-value risk. |
| [Institutional Loan agreement](https://www.okx.com/en-us/help/institutional-loan-user-agreement) | Loans | Overdue and early-repayment terms. |
| [VIP Loan interest-free-period change](https://www.okx.com/en-us/help/interest-free-period-change-for-vip-loan) | Loans | Current 120-hour early-repayment rule. |
| [Simple Earn Flexible](https://www.okx.com/en-gb/help/introduction-to-okx-simple-earn-flexible) | Earn | 15% service fee. |
| [Simple Earn FAQ](https://www.okx.com/en-us/help/simple-earn-faq) | Earn | Customer-return formula. |
| [Simple Earn Fixed](https://www.okx.com/en-us/help/how-do-i-use-simple-earn-fixed) | Earn | Fixed-term and early-termination behavior. |
| [On-chain Earn](https://www.okx.com/en-gb/help/how-do-i-use-onchain-earn) | Earn | Dynamic service fee and net APY. |
| [BTC Yield+ FAQ](https://www.okx.com/en-us/help/btc-yield-faq) | Earn | Subscription and redemption fee treatment. |
| [Dual Investment terms](https://www.okx.com/en-gb/help/dual-investment-product-service-terms) | Structured products | Product-specific return terms. |
| [Structured Products subscription terms](https://www.okx.com/en-gb/help/structured-products-subscription-terms) | Structured products | Order-specific pricing boundary. |
| [United States Card fees](https://www.okx.com/en-us/help/what-fees-apply-when-im-using-my-okx-card) | United States Card | Conversion and recurring charges. |
| [EEA Card fees](https://www.okx.com/en-eu/help/what-fees-apply-when-using-my-card) | EEA Card | Conversion spread and recurring charges. |
| [Singapore Card fees](https://www.okx.com/en-sg/help/what-fees-apply-when-i-am-using-my-okx-card-sg) | Singapore Card | Stablecoin conversion and recurring charges. |
| [Brazil Card fees](https://www.okx.com/en-br/help/what-fees-and-limits-apply-when-using-my-card) | Brazil Card | Published zero-fee categories. |
| [Australia Card financial services guide](https://www.okx.com/en-au/help/okx-card-financial-services-guide) | Australia Card | Issuer, spread, and recurring charges. |
