# Extended Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 at 22:30 and 22:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the perpetual fees of Extended (CCXT id `extended`), a decentralised perpetual venue that settles on Starknet and runs its matching engine in AWS Tokyo.
The researched product is its perpetuals, which split into order book markets and RFQ markets, see [`rest.md`](./rest.md) section 2.
Fees are read from the published docs, F1 to F7, and CCXT is read with [`fees-probe.py`](../../../scripts/probes/venues/extended/fees-probe.py), P1 and P2 in section 10.
The socket is in [`websocket.md`](./websocket.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | X10 Ltd, trading as Extended | F4, Published |
| licence | "Extended is not registered or licensed by any regulatory agency or authority" | F4 clause 12.2, Published |
| country in CCXT | `SG` | `extended.js` line 22 |
| who may trade | anyone with a wallet who is not a Restricted Person | F3 and F4, Published |
| regions excluded | Afghanistan, Canada, China (Hong Kong), Cuba, Iran, North Korea, Russia, Syria, Seychelles, the occupied regions of Ukraine, the United Kingdom and the United States | F3, Published |
| VPN | "circumventing these restrictions using a virtual private network ("VPN") is expressly forbidden" | F4, Published |
| fee page retrieved | 2026-10-12, 2,038 bytes as Markdown | P1 and P2 |

So the US and Canada, where this host's exit sits, are both excluded by the terms.
Every public read answered from this host, and a POST answered the geoblock status 451, see [`rest.md`](./rest.md) section 6.
The settlement chain moves from Starknet to Circle's Arc from 2026-10-22 12:00 UTC, and the migration notice says fee tiers are not affected, F6.

## 2. Quick answer

| family | maker | taker | taker ppm | source |
|---|---|---|---|---|
| crypto perpetuals, order book and RFQ | 0.000 % | 0.025 % | 250 | F1, Published |
| RWA perpetuals (equities, indices, FX, commodities, pre-IPO) | 0.000 % | 0.010 % | 100 | F1, Published |

The schedule is flat, with no volume tiers, F1.
"The team reserves the right to update the fee schedule going forward", F1.
On an RFQ market every order the user places pays the taker fee, even one that rests until a market maker picks it up, F2.
No public call returns the fee, because `GET /api/v1/user/fees` needs an API key, F5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USD-collateral linear perpetuals, order book | yes, 47 ACTIVE | [`rest.md`](./rest.md) section 2, P1 of `rest-probe.py` |
| USD-collateral linear perpetuals, RFQ | yes, 281 ACTIVE | same |
| USDT-margined perpetuals | no, collateral is USDC, which the API names `USD` | [`rest.md`](./rest.md) section 2 |
| coin-margined or inverse perpetuals | no | catalog: 403 perpetual rows, all collateral `USD` |
| dated futures | no | CCXT `'future': false` at `extended.js` line 34, and no such row in the catalog |
| options | no | CCXT `'option': false` at `extended.js` line 35 |
| spot | yes, 3 markets: `BTCSPOT-USD`, `ETHSPOT-USD` and `USDTSPOT-USD` | catalog `type` `SPOT`, named and not detailed |

## 4. Perpetual tiers

There are no taker tiers.
The only volume schedule is the maker rebate below, which never changes the taker, F1.

| maker share of exchange maker volume over 30 days | rebate, crypto | rebate, RWA |
|---|---|---|
| at least 0.5 % | 0.002 % | 0.0008 % |
| at least 1 % | 0.004 % | 0.0016 % |
| at least 2.5 % | 0.006 % | 0.0024 % |
| at least 5 % | 0.010 % | 0.0040 % |

Rebates are paid daily at 00:00 UTC and only when the day's accrual is at least $10, F1.

## 5. Discounts that change the perpetual taker

| discount | effect on the VIP 0 taker | source |
|---|---|---|
| token holding | none published | F1 |
| referral | the referral program exists, and no taker reduction is published on the fee page | F1, Not publicly specified |
| market maker | maker rebates only, section 4 | F1 |
| RWA discount | RWA markets pay 0.010 % instead of 0.025 %, "currently", with no end date | F1, Published |
| builder codes | a front end may add its own `builderFee` on top of the taker, for example `0.0005` | F7, Published |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 1 hour, "charged every hour and applied to all users with open positions at that time" | F8, Published. Funding history rows are 60 minutes apart on every market read, `rest-probe.py` mode `funding` |
| payment | `Position Size * Mark Price * (-Funding Rate)`, so a positive rate makes longs pay shorts | F8 |
| crypto order book formula | `(Average Premium + clamp(Interest Rate - Average Premium, 0.05%, -0.05%)) / 8`, the premium sampled every 5 s with N = 720 and weighted linearly | F8 |
| interest rate | 0.01 % per 8 hours for crypto, 0.0035 % per 8 hours for order book RWA | F8 |
| cap per hour | 0.25 % for groups 1 and 2, 0.5 % for group 3, 0.75 % for group 4, 1 % for group 5, 2 % for groups 6 and 7, and 1 % for RWA | F8. The catalog field `hourlyFundingRateCap` read `0.25` on 4, `0.5` on 8, `0.75` on 28, `1` on 281 and `2` on 7 ACTIVE markets, `rest-probe.py` mode `catalog` |
| RFQ crypto and Binance-sourced RWA | "funding rates are sourced directly from Binance funding" | F8 |
| Hyperliquid-sourced RWA | premium of mark against index, scaled by 0.5 and capped at 1 % per hour | F8 |
| Prime RWA | from the open interest skew, floor 0.0005 % and maximum 0.003 % per hour | F8 |
| when charged | the history stamps each applied rate 849 to 2,094 ms after the whole hour | `rest-probe.py` mode `funding`, P1 and P2 |

The settlement instant itself was not captured, as the survey's rule says.

## 7. Liquidation, settlement and delisting

- A position liquidated at a price better than its bankruptcy price pays a 1 % liquidation fee to the Extended Vault, F9.
- Trading and liquidation fees are not charged in an auto-deleveraging, F9.
- No settlement fee and no delisting fee is published.
  The USDT and wBTC balances closed by the Arc migration are closed "at the mark price with no fees", F6.

## 8. CCXT

CCXT 4.5.68 sets one exchange-wide fee pair, `'taker': this.parseNumber('0.002')` and `'maker': this.parseNumber('0.002')`, at `extended.js` lines 250 to 253.
`parseMarket` copies it into every market at line 576 for the taker and line 577 for the maker.
So `market.taker` is 0.002, which is 2,000 ppm, on all 328 active perpetuals, P1 and P2.
That is eight times the published 250 ppm and twenty times the RWA 100 ppm.
`fetchTradingFee` reads `user/fees`, which needs credentials, at `extended.js` lines 2075 to 2108.
The class puts the pair at the top of `fees` rather than under `fees.trading`, so `ex.fees['trading']['taker']` read `None` in the probe while every market read 0.002.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 250 for crypto markets, 100 for markets whose `category` is `RWA` | F1. The catalog carries `category` on every row, so the loader can set the taker per market |
| `ccxtTakerPpm` | 2,000 | the CCXT constant at `extended.js` line 251, which the parity check should expect and not use |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| F1 | Trading Fees and Rebates | https://docs.extended.exchange/extended-resources/trading/trading-fees-and-rebates.md | 2026-10-12 | Extended, docs | sections 2, 4, 5 and 9 |
| F2 | API docs, RFQ markets, Fees | https://api.docs.extended.exchange/#fees | 2026-10-12 | Extended, API docs | RFQ fee roles, section 2 |
| F3 | Restricted Countries | https://docs.extended.exchange/extended-resources/legal/restricted-countries.md | 2026-10-12 | Extended, legal | section 1 |
| F4 | Terms of Use, last updated 08/10/2026 | https://docs.extended.exchange/extended-resources/legal/terms-of-use.md | 2026-10-12 | X10 Ltd, legal | operator, licence, VPN clause, section 1 |
| F5 | API docs, Get fees | https://api.docs.extended.exchange/#get-fees | 2026-10-12 | Extended, API docs | the fee call is private, section 2 |
| F6 | Migration from Starknet to Arc, published 8 October 2026 | https://docs.extended.exchange/about-extended/migration-from-starknet-to-arc.md | 2026-10-12 | Extended, docs | migration date and fee tiers, sections 1 and 7 |
| F7 | Builder Codes | https://docs.extended.exchange/extended-resources/builder-codes.md | 2026-10-12 | Extended, docs | builder fee, section 5 |
| F8 | Funding Payments | https://docs.extended.exchange/extended-resources/trading/funding-payments.md | 2026-10-12 | Extended, docs | section 6 |
| F9 | Liquidation Logic | https://docs.extended.exchange/extended-resources/trading/liquidation-logic.md | 2026-10-12 | Extended, docs | section 7 |
| C1 | CCXT 4.5.68 `extended.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/extended.js` | 2026-10-12 | CCXT | section 8 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/extended/fees-probe.py), fee page, restricted countries page and CCXT `load_markets`, 22:30 UTC | [`fees-probe.py`](../../../scripts/probes/venues/extended/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 2 and 8 |
| P2 | the same probe rerun in the second pass, 22:39 UTC | [`fees-probe.py`](../../../scripts/probes/venues/extended/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 and 8 |
