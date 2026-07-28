# Exchange Fees Comparison

**Status:** Done.

**Retrieved:** 2026-07-26.

## Purpose

This document compares fee models that affect an arbitrage observatory across Binance, Bybit, OKX, Coinbase, and Kraken.
It does not repeat every regional table or service charge.
The exhaustive schedules live in the exchange profiles.

## Detailed profiles

| Exchange | Source of record |
| --- | --- |
| Binance | [`fees.md`](../profiles/binance/fees.md) |
| Bybit | [`fees.md`](../profiles/bybit/fees.md) |
| OKX | [`fees.md`](../profiles/okx/fees.md) |
| Coinbase | [`fees.md`](../profiles/coinbase/fees.md) |
| Kraken | [`fees.md`](../profiles/kraken/fees.md) |

## Evidence labels

| Label | Meaning |
| --- | --- |
| Published | The exchange publishes a current numeric value or formula. |
| Dynamic | The exchange calculates the value at request time or changes it with live conditions. |
| Account-gated | The current value is available only after authentication. |
| Negotiated | The exchange sets the value through a private agreement. |
| Region-specific | The value or product applies only to a named entity or jurisdiction. |
| Not offered | The exchange states that the product or service is unavailable. |
| Not publicly specified | No current public official value was found. |

## The most important conclusion

There is no truthful exchange-wide fee number.
The effective rate is a function of legal entity, product, symbol or fee group, account tier, liquidity role, discount configuration, promotion, and time.

The production system must resolve this tuple before comparing an opportunity:

```text
effective fee key
= venue entity
+ product family
+ symbol or fee group
+ maker or taker role
+ account tier
+ discount program
+ promotion
+ effective timestamp
```

Actual fill commission remains the final source of truth.

## Normalized cost model

Buy and sell direction does not select maker or taker pricing.
The execution's liquidity role selects the rate.

```text
opening fee = opening notional × opening rate
closing fee = closing notional × closing rate
round-trip trading fee = opening fee + closing fee
holding cost = funding + margin interest + borrow cost
total execution cost
= round-trip trading fee
+ holding cost
+ conversion
+ transfer
+ settlement
+ expected slippage
+ liquidation cost when applicable
```

Inverse contracts require their exchange-specific coin notional before applying the rate.
Per-contract futures require the contract count multiplied by the per-side charge.
Rebates use a negative rate.
Funding can be paid or received.

## Public baseline trading rates

The table uses the lowest public global or eligible account tier for one representative order-book product.
It is an orientation table, not an account quote.
Maker is shown before taker.

| Exchange | Spot baseline | Perpetual or futures baseline | Options baseline | Important boundary |
| --- | ---: | ---: | ---: | --- |
| Binance.com | 0.100% and 0.100% | Account-gated current tier | Account-gated current tier | BNB can reduce eligible spot fees by 25% and futures fees by 10%. |
| Bybit global VIP 0 | 0.100% and 0.100% | 0.020% and 0.055% | 0.020% and 0.030% | Special zones, MNT payment, Pro, market-maker, and regional tables override this row. |
| OKX global Regular | 0.080% and 0.100% | 0.020% and 0.050% | 0.030% and 0.030% | Pair groups, stablecoin overrides, RPI, VIP status, and regional entities override this row. |
| Coinbase Exchange and International | 0.400% and 0.600% on Exchange | 0.020% and 0.040% on International Tier 10 | Per-contract on Coinbase Derivatives | Advanced is account-gated and United States regulated futures use per-contract pricing. |
| Kraken Pro Tier 1 | 0.400% and 0.800% | 0.020% and 0.050% on international derivatives | Derivatives rate with premium cap | EEA derivatives and United States futures have separate schedules. |

Coinbase Exchange spot and Coinbase International perpetuals are different venues.
The row combines them only to provide each product's public entry tier.
Binance publishes current spot rows, but its current derivatives tables return no static records in public HTML.
The authenticated commission endpoints are therefore required.

## Representative taker round trip

This example opens and closes $100,000 of equal notional as a taker.
It ignores funding, spread, slippage, discounts, settlement, and liquidation.
It uses the public baseline in the prior table.

| Venue and product | Opening rate | Closing rate | Illustrative round-trip commission |
| --- | ---: | ---: | ---: |
| Binance USD-M | Live account rate | Live account rate | `100,000 × entry rate + 100,000 × exit rate` |
| Bybit global derivatives VIP 0 | 0.055% | 0.055% | $110 |
| OKX global futures Regular | 0.050% | 0.050% | $100 |
| Coinbase International Tier 10 | 0.040% | 0.040% | $80 |
| Kraken international Tier 1 | 0.050% | 0.050% | $100 |

This table does not rank real accounts.
Regional availability, tier qualification, symbol grouping, and live funding can reverse the order.

## Tier and discount model comparison

| Exchange | Primary public qualification model | Token discount | Professional and market-maker treatment |
| --- | --- | --- | --- |
| Binance | Trailing 30-day volume plus BNB balance | 25% Spot and 10% Futures on eligible Binance.com accounts | VIP benefits, liquidity programs, and negotiated institutional terms |
| Bybit | Best result from assets, borrowing, or product volume | 25% Spot and 10% Futures through eligible MNT payment | Supreme, Pro 1 through Pro 6, and separate maker incentive tables |
| OKX | Best result from assets under management or product volume | No universal exchange-token discount in the current framework | VIP 1 through VIP 9, fee groups, market-maker agreements, and RPI rates |
| Coinbase | Venue-specific volume, balance, and account programs | No exchange-token fee discount | Liquidity Program, Prime, market maker, cost-plus, and negotiated pricing |
| Kraken | Best result from spot volume, futures volume, or assets on platform | No exchange-token fee discount | Pro 1 through Pro 5, eligible maker-rebate pairs, and negotiated institutional terms |

Every exchange has cases where the public tier is insufficient.
Authenticated fee lookup should occur at startup, after a tier refresh, and before execution when the platform exposes an order-specific preview.

## Derivatives formula comparison

| Exchange | Linear notional | Inverse notional | Per-contract model |
| --- | --- | --- | --- |
| Binance | Quantity multiplied by execution price | Contracts multiplied by multiplier and divided by execution price | Product-specific options units |
| Bybit | Quantity multiplied by execution price | Quantity divided by execution price | Options multiply effective fee by size |
| OKX | Contracts multiplied by multiplier, contract size, and fill price | Contracts multiplied by multiplier and face value, divided by fill price | Event contracts use probability-based coefficients |
| Coinbase | International uses contract size multiplied by mark or fill price | Product-specific | Coinbase Derivatives charges each side per contract |
| Kraken | Product contract specification controls notional | Product contract specification controls inverse value | United States CME and Bitnomial products charge per contract per side |

Leverage changes required margin.
It does not reduce traded notional or execution commission.

## Funding comparison

| Exchange | Transfer model | Common interval | Required live input |
| --- | --- | --- | --- |
| Binance | Peer-to-peer with no Binance service fee | Commonly eight hours, with four-hour and one-hour variants | Funding rate, cap, floor, next time, and current interval |
| Bybit | Peer-to-peer with no Bybit service fee | Commonly eight hours, but symbol rules can change | Funding rate, cap, floor, next time, and interval |
| OKX | Peer-to-peer with no separate OKX funding service fee | Commonly eight hours, with one-hour, two-hour, and four-hour variants | `fundingTime`, `nextFundingTime`, rate, cap, and floor |
| Coinbase | Hourly on International and eligible perpetual-style products | One hour | Current hourly rate, mark price, multiplier, and open contracts |
| Kraken | Continuous rate realized hourly on international derivatives | One hour realization | Current rate, prediction where available, and next realization |

Never hard-code an eight-hour schedule.
The WebSocket or REST value for the exact instrument controls.

## Liquidation, settlement, and exercise

| Exchange | Ordinary futures or perpetual liquidation | Settlement and options notes |
| --- | --- | --- |
| Binance | Symbol and risk-tier insurance clearance rate | Options liquidation is 0.19% of notional capped at 25% of premium. |
| Bybit | No separate ordinary perpetual or futures liquidation fee | Inverse expiry and delisting rules can charge 0.05%, and options liquidation is 0.20% with a premium cap. |
| OKX | Forced liquidation uses the account's taker tier | Expiry settlement is 0.01%, and options trading and exercise use published premium caps. |
| Coinbase | International liquidation costs 1.0% of amount liquidated | Coinbase Derivatives charges both sides per contract and brokers can add charges. |
| Kraken | International full liquidation costs 50% of minimum maintenance margin | Fixed maturity settles at taker, options cap the trading fee at 12.5% of premium, and US futures have fixed liquidation charges. |

Liquidation is not a routine exit strategy.
The observatory should model it for risk limits and emergency-close cost.

## Margin and borrowing

| Exchange | Spot margin or borrowing cost | Static or live |
| --- | --- | --- |
| Binance | Spot execution fee plus hourly asset borrow interest | Live hourly rate |
| Bybit | Spot fee plus rounded hourly interest, with product-specific repayment and liquidation charges | Live rate |
| OKX | Spot fee plus hourly liability interest from a currency and tier daily rate | Live rate |
| Coinbase | Product and region-specific margin, loan, or broker financing | Account-gated |
| Kraken | Spot fee plus dynamic opening fee and rollover every four hours | Order-preview rate |

Holding cost can dominate a small price spread.
It must be projected for the expected exposure time and for a delayed second leg.

## Regional risk

| Exchange | Examples of material regional divergence |
| --- | --- |
| Binance | Binance.US is a separate spot venue, and multiple local operators have their own scope. |
| Bybit | EU, Indonesia, Türkiye, Georgia, Kazakhstan, UAE tax, and India tax treatments differ. |
| OKX | US, EEA, Australia retail and wholesale, Singapore, UAE, Türkiye, and Brazil publish separate matrices. |
| Coinbase | Consumer, Exchange, International, CDE, CFM, and Prime differ by eligibility and entity. |
| Kraken | EEA derivatives, United States futures, securities brokerage, and Bitnomial-routed margin differ from international products. |

An adapter must attach the legal entity to the account.
Selecting a fee by exchange brand alone is unsafe.

## Asset movement and conversion

| Exchange | Crypto deposit baseline | Crypto withdrawal | Internal or convert treatment |
| --- | --- | --- | --- |
| Binance | Generally free | Dynamic by asset and network | Convert has no separate advertised commission, but quote spread applies. |
| Bybit | Free from Bybit | Dynamic by asset and network | Convert and OTC advertise no separate fee, but quote spread applies. |
| OKX | Free | Dynamic network fee | Convert advertises no transaction fee, but quote economics can differ from spot. |
| Coinbase | Hosted balances and internal primary transfers are free | Dynamic network estimate with named processing exceptions | Simple conversion includes spread and a dynamic fee. |
| Kraken | Most deposits are free, with Lightning and named asset exceptions | Dynamic by asset and network | Consumer orders charge a service percentage plus spread. |

Transfer-based arbitrage also needs minimums, confirmation times, deposit status, withdrawal status, chain compatibility, and destination credit rules.
The static profile cannot replace a signed confirmation preview.

## Non-trading fee families

| Exchange | Material published families |
| --- | --- |
| Binance | Wallet swaps, loans, Stocks Trading, P2P, staking, bots, and regional payment rails |
| Bybit | Loans, TradFi, cards, P2P, Easy Earn, MNT conversion, and regional tax additions |
| OKX | Loans, Simple Earn, On-chain Earn, cards, event contracts, cash rails, and regional matrices |
| Coinbase | Subscription plans, market data, staking, cards, securities, DEX access, recovery, Prime, and Custody |
| Kraken | Consumer plans, futures market data, staking, Borrow, Flexline, brokerage, xStocks, cards, Kraken Prop, and cash rails |

Negotiated, quote-based, or account-gated pricing must be represented as unknown until the account supplies it.
Unknown does not mean free.

## Market data access charges

| Exchange | Public pricing result |
| --- | --- |
| Binance | No separate public WebSocket subscription price was verified. |
| Bybit | No separate public WebSocket subscription price was verified. |
| OKX | No separate public WebSocket subscription price was verified. |
| Coinbase Exchange | Ten subscriptions per product and channel cost $0, while higher limits cost $250 to $10,000 per month. |
| Kraken Derivatives US | Funded non-professional CME Level 1 is free, non-professional CME Level 2 is $16 monthly, professional CME Level 2 is $140 monthly, and Bitnomial data is free. |

An absent public price is not proof that every institutional, colocated, or negotiated data arrangement is free.

## Arbitrage fee-resolution checklist

1. Identify the exact account entity and region.
2. Identify the product, symbol, contract family, settlement asset, and fee group.
3. Retrieve the effective account tier and maker and taker rates.
4. Apply token-payment, market-maker, promotional, or stable-pair overrides.
5. Compute notional with the product's contract multiplier.
6. Estimate entry and exit role separately.
7. Add current funding or borrow cost for the expected holding period.
8. Add conversion, collateral, settlement, exercise, and delivery costs.
9. Add network and transfer costs only for routes that move assets.
10. Simulate order-book slippage at target size.
11. Reject opportunities whose profit depends on an unresolved or stale fee.
12. Record actual fill commission and use it for reconciliation.

## Recommended fee data model

| Field | Purpose |
| --- | --- |
| `venueEntity` | Selects the legal and regional schedule. |
| `productFamily` | Selects the formula and lifecycle charges. |
| `symbolOrGroup` | Selects pair and fee-group overrides. |
| `accountTier` | Selects the applicable row. |
| `liquidityRole` | Selects maker or taker. |
| `rate` and `fixedCharge` | Supports percentage and per-contract pricing. |
| `discountProgram` | Records BNB, MNT, liquidity, market-maker, and subscription effects. |
| `fundingRate` and `fundingTime` | Supports holding-cost projection. |
| `borrowRate` and `interestPeriod` | Supports margin-cost projection. |
| `cap`, `minimum`, and `currency` | Supports options, transfers, and fixed charges. |
| `sourceUrl` and `retrievedAt` | Provides provenance. |
| `effectiveAt` and `expiresAt` | Prevents stale promotions. |
| `accountVerified` | Distinguishes account truth from public fallback. |

## Source ledger

| Exchange | Official source | Applies to | Retrieved | Verification |
| --- | --- | --- | --- | --- |
| Binance | [Spot fee rate](https://www.binance.com/en/fee/trading) | Binance.com Spot and BNB tiers | 2026-07-26 | Published |
| Binance | [Futures fee calculation](https://www.binance.com/en/support/faq/detail/360033544231) | USD-M and COIN-M formulas and discount | 2026-07-26 | Published |
| Binance | [Binance.US fees](https://www.binance.us/fees) | Binance.US Spot and staking | 2026-07-26 | Region-specific |
| Bybit | [Trading Fee Structure](https://www.bybit.com/en/help-center/article/Trading-Fee-Structure) | Global VIP and special product tables | 2026-07-26 | Published |
| Bybit | [Account fee-rate API](https://bybit-exchange.github.io/docs/v5/account/fee-rate) | Account-specific maker and taker rates | 2026-07-26 | Account-gated |
| Bybit | [Market-maker program](https://www.bybit.com/en/help-center/article/Introduction-to-the-Market-Maker-Incentive-Program) | Maker rebates | 2026-07-26 | Published |
| OKX | [Global fee framework](https://www.okx.com/en-gb/help/updates-to-global-fee-framework) | Global Spot, Futures, and Options matrices | 2026-07-26 | Published |
| OKX | [Current VIP qualification](https://www.okx.com/en-gb/help/whats-okx-vip-and-how-do-i-qualify-for-it) | Global tier thresholds | 2026-07-26 | Published |
| OKX | [Trading fee FAQ](https://www.okx.com/en-us/help/trading-fee-rules-faq) | Formulas, settlement, exercise, and liquidation | 2026-07-26 | Published |
| Coinbase | [Coinbase Exchange fees](https://help.coinbase.com/en/exchange/trading-and-funding/exchange-fees) | Exchange Spot and stable pairs | 2026-07-26 | Published |
| Coinbase | [Coinbase Exchange market data connections](https://help.coinbase.com/en/exchange/managing-my-account/market-data-connections) | WebSocket subscription plans | 2026-07-26 | Published |
| Coinbase | [International Exchange fees](https://help.coinbase.com/en/international-exchange/trading-deposits-withdrawals/international-exchange-fees) | International Spot and perpetuals | 2026-07-26 | Published with a threshold conflict |
| Coinbase | [Coinbase Derivatives fee schedule](https://assets.ctfassets.net/k3n74unfin40/sgInuF26edJX4v4nUlE29/87f18103cd35feede93f0bb92a5f1065/Fee_Schedule_1.26.2026.pdf) | United States per-contract futures | 2026-07-26 | Published |
| Kraken | [Kraken fee schedule](https://www.kraken.com/gb/features/fee-schedule) | Cross-platform Spot and international derivatives | 2026-07-26 | Published |
| Kraken | [EEA derivatives fees](https://support.kraken.com/articles/fees-for-derivatives-trading-eea) | EEA derivatives | 2026-07-26 | Region-specific |
| Kraken | [United States futures fees](https://support.kraken.com/articles/us-futures-fees) | CME and Bitnomial per-contract fees | 2026-07-26 | Region-specific |
| Kraken | [United States futures market data](https://support.kraken.com/articles/market-data) | CME and Bitnomial subscription prices | 2026-07-26 | Region-specific |

## Remaining account-specific work

- Capture authenticated fees for every production account.
- Confirm each account's legal entity and product eligibility.
- Capture active symbol promotions and market-maker terms.
- Capture live transfer, network, funding, and borrow values.
- Re-run this comparison whenever a fee source changes.
