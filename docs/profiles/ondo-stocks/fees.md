# Ondo Stocks Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:21 and 03:26 UTC, from the development host near Seattle, see [`rest.md`](./rest.md) section 1.

Ondo Stocks, formerly Ondo Global Markets, is the primary market that mints and redeems Ondo's tokenized US stocks and ETFs against its USDon stablecoin.
It lists no perpetuals, so this profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and covers the spot product.
That product is not an order book.
Every buy is a mint and every sell is a redemption, priced by a quote the platform signs for about 30 seconds, S2.
No fee schedule is published, because the platform's margin is inside the quote price, S3.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 | S1 to S11 |
| issuer and counterparty | Ondo Global Markets (BVI) Limited, a bankruptcy-remote special purpose vehicle in the British Virgin Islands | S5 |
| owners of the issuer | 90.01% Flux Finance Inc., a subsidiary of the Ondo Foundation, and 9.99% Ondo Finance Inc. | S5 |
| legal form of a token | a structured note of the issuer, governed by Swiss law under the issuer's Sales Terms | S5 |
| offering exemption | Regulation S under the US Securities Act of 1933 only | S5 |
| who may mint or redeem | onboarded persons who passed KYC and AML, outside the United States and not US persons | S4, S5 |
| prohibited | Afghanistan, Belarus, Canada, the occupied Ukrainian regions, Cuba, North Korea, Iran, Libya, Myanmar, Russia, Somalia, South Sudan, Sudan, Syria, and the United States with its states, possessions and territories | S4 |
| US persons | prohibited, including anyone placing a buy order from inside the United States or acting for a US person under Rule 902 of Regulation S | S4 |
| restricted to professional, qualified, accredited or sophisticated investors | Brazil, every European Economic Area state, Hong Kong, Malaysia, Singapore, Switzerland and the United Kingdom | S4 |
| programmatic access | an API key issued after onboarding, requested from onboarding@ondo.finance | S7 |
| transfer | tokens are transferable outside the US on Ethereum, BNB Chain, Solana and HyperEVM, subject to the same eligibility restrictions | S11 |

The development host is in the United States, so its operator is a Prohibited Person under S4.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| mint and redeem of tokenized stocks against USDon | not published | not published | S3 |
| perpetuals | absent | absent | section 3 |

S3 says "the price may be slightly more (or less) than the price at which Ondo Stocks buys (or sells) the underlying stock, with any difference and any fees being retained by Ondo Stocks."
So the cost of a trade is the spread between the signed quote and the underlying price, and S2 says it depends on "quote size, target profit, and several other proprietary considerations."
There is no maker side, because a user cannot rest an order against the platform.
The only public view of that spread is CoinGecko's `bid_ask_spread_percentage` for the venue's pairs.
It read 0.011% to 4.15% with a median of 0.113% across the 100 pairs the API returned at 03:21 UTC, and 0.013% to 4.15% with a median of 0.105% at 03:26 UTC, see [`rest.md`](./rest.md) section 2.
That is a full bid to ask width measured by CoinGecko, not a fee, and it is not converted to ppm here for that reason.
The user also pays gas on the chain used, S3.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals, any settlement family | absent | no perpetual, margin or funding appears in the documentation index S1 or in any Ondo Stocks page read, CoinGecko lists the venue as a centralized exchange with 347 pairs whose quote is USDON, and its derivatives list does not show it |
| dated futures | absent | same |
| options | absent | same |
| spot, as primary mint and redeem against USDon | present | S2, S6, S7 |
| off-hours trading | present for a per-asset list | weekends and US holidays, with wider spreads and per-asset limits, S8 |

CoinGecko lists a separate derivatives venue named Ondo Perps, id `ondo-perps`, with the site `app.ondoperps.xyz`, Panama as its country and 2026 as its year, S10.
Its derivatives record showed 65 perpetual pairs, 0 futures pairs, open interest of 1,030 BTC and 24 h volume of 2,074 BTC at 03:26 UTC, in the P1 rerun.
It is a different CoinGecko entry from Ondo Stocks, with a different country, it is not in the survey tracker, and its relation to Ondo Finance and its API were not researched here.

Trading hours follow the US market: pre-market 4:01 to 9:29 am ET, core 9:31 am to 3:59 pm ET, post-market 4:01 to 7:59 pm ET, and overnight 8:05 pm to 3:55 am ET, from Sunday evening to Friday evening, S8.
Trading pauses for a few minutes around each session boundary, S8.

## 4. Spot tiers

No tier schedule is published.
The quote spread is set per order, and no volume tier, VIP level or rebate appears in S1, S2 or S3.

## 5. Discounts that change the taker

None are published.
No token holding discount, referral rebate or market maker programme for Ondo Stocks appears in S1.

## 6. Funding as a cost

Not applicable.
The venue lists no perpetual and publishes no funding rate.
A token is a total-return tracker: dividends, net of a 30% US withholding tax for US companies, are reinvested into the underlying, and the token's price diverges from the stock's price by the shares-per-token multiplier, S2 and S3.

## 7. Liquidation, settlement and delisting

There is no leverage, so there is no liquidation charge.
Settlement is atomic on chain: the quote's signed attestation is submitted with USDon or USDC to the issuer's contract, which mints the token or redeems it in the same transaction, S7.
USDC converts to USDon one for one through the platform's swapper, subject to the swapper's balance and to whitelisting, S6.
The minimum mint or redemption is 1 US dollar, S6.
Corporate actions pause the affected asset, S8, and the API reports an `ASSET_REDEEM_ONLY` state for an asset that can only be redeemed, S9.
No delisting charge is published.

## 8. CCXT

CCXT 4.5.68, the version in `server/node_modules`, has no class for this venue.
`ccxt.exchanges` lists 104 ids, and none matches `ondo`, `stock` or `gm`, in [`rest-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/rest-probe.mjs) and in a direct `node -e` check run from `server/`.
The CCXT master branch on GitHub at commit `1d8b674`, dated 2026-09-22 12:48 UTC, has 105 TypeScript classes in `ts/src`, and none is named for Ondo, read through the GitHub contents API.
So `market.taker` does not exist for this venue.

## 9. Recommended registry values

None.
The venue has no CCXT class, no perpetual and no public market data, so it cannot be added to [`registry.ts`](../../../server/src/venues/registry.ts), and `takerPpm` and `ccxtTakerPpm` stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Ondo documentation index | https://docs.ondo.finance/llms.txt | 2026-09-22 | Ondo, global | page list, no perpetual or margin page, section 3 |
| S2 | Token and Quote Pricing | https://docs.ondo.finance/ondo-stocks/token-and-quote-pricing.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | 30 s quote, spread factors, total-return tracking, sections 2, 4 and 6 |
| S3 | Fees and Taxes | https://docs.ondo.finance/ondo-stocks/fees-and-taxes.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | fee retained inside the quote, gas, 30% withholding, sections 2 and 6 |
| S4 | Eligibility | https://docs.ondo.finance/ondo-stocks/eligibility.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | prohibited and restricted jurisdictions, US persons, section 1 |
| S5 | Legal and Regulatory | https://docs.ondo.finance/ondo-stocks/legal-and-regulatory.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | issuer, owners, note structure, Regulation S, section 1 |
| S6 | Investing and Redeeming, Available Assets | https://docs.ondo.finance/ondo-stocks/investing-and-redeeming.md and https://docs.ondo.finance/ondo-stocks/available-assets.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | USDon, USDC swapper, 1 USD minimum, sections 1 and 7 |
| S7 | API Overview and Quickstart | https://docs.ondo.finance/api-reference/overview.md and https://docs.ondo.finance/api-reference/quickstart.md | 2026-09-22 | Ondo, global | API key by onboarding, attestation flow, sections 1 and 7 |
| S8 | Market Hours and Trading Availability, Off-Hours Trading | https://docs.ondo.finance/ondo-stocks/market-hours-and-trading-availability.md and https://docs.ondo.finance/ondo-stocks/off-hours-trading.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | sessions, pauses, off-hours, sections 3 and 7 |
| S9 | Error Codes | https://docs.ondo.finance/api-reference/error-codes.md | 2026-09-22 | Ondo, global | `ASSET_REDEEM_ONLY`, section 7 |
| S10 | CoinGecko exchange pages and API | https://www.coingecko.com/en/exchanges/ondo-stocks, https://api.coingecko.com/api/v3/exchanges/ondo_global_markets and https://api.coingecko.com/api/v3/derivatives/exchanges/ondo-perps | 2026-09-22 | CoinGecko | classification, pair count, spreads, Ondo Perps, sections 2 and 3 |
| S11 | Transferability | https://docs.ondo.finance/ondo-stocks/transferability.md | 2026-09-22 | Ondo Global Markets (BVI) Limited | chains and the outside-the-US transfer rule, section 1 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/rest-probe.mjs) at 03:21 and 03:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/ondo-stocks/rest-probe.mjs) | 2026-09-22 | this host | CCXT catalog check, CoinGecko spreads, Ondo Perps record, sections 2, 3 and 8 |
