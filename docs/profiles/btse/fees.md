# BTSE Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:15 to 03:47 UTC), from the development host near Seattle.

This profile covers the trading fees, funding and CCXT view of BTSE's perpetual futures, the one perpetual family the venue lists.
BTSE has no class in CCXT 4.5.68, the version the server pins, see section 8.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/btse/rest-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | BTSE, perpetual futures on `api.btse.com` and `ws.btse.com` | S1 |
| operating entity | Not verified. The terms page `https://www.btse.com/en/termsandconditions` is rendered by script and returned only a 3,692 byte page shell to curl and to a web fetch on 2026-09-22 | S9 |
| registration | CCXT lists the country as `VG`, British Virgin Islands, at `ts/src/btse.ts` line 22 of CCXT master. CoinGecko lists British Virgin Islands and a 2018 start | S7, S8 |
| prohibited jurisdictions | Cuba, Iran, North Korea, Syria, Russia, Myanmar, Afghanistan, Central African Republic, Eritrea, Ethiopia, Iraq, Somalia, Sudan, South Sudan, Libya, Venezuela, Lebanon, Belarus, Democratic Republic of Congo, Cote d'Ivoire, Yemen | S5 |
| unavailable or restricted | United States, Canada, Taiwan, United Kingdom (discontinued 21 February 2025), Malaysia, Singapore, and the European Union, where BTSE holds no MiCAR licence and serves only reverse-solicitation users | S5, S6 |
| US persons | may not trade: the United States is on the unavailable list | S5 |
| this host | every public REST and WebSocket endpoint answered from near Seattle with no refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | P1, P2 |

The fee article carries no revision date.
The liquidation article's margin examples use a taker of 0.05 %, while the fee table's General User taker is 0.055 %.
The fee table is taken as current, see section 4.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-quoted perpetuals, multi-collateral | 0.0200 %, 200 ppm | 0.0550 %, 550 ppm | S2, "General User" row |

The same rate applies to the 131 crypto, 74 stock and 6 commodity perpetuals, since S2 publishes one futures table and no per category schedule.
Fees are charged on opening and on closing, on a notional of mark price times position size, S2.

## 3. Coverage matrix

| product | present | notes |
|---|---|---|
| perpetuals, USDT-quoted, multi-collateral | yes, 211 active | 131 `CRYPTO`, 74 `STOCK`, 6 `COMMODITIES` on 2026-09-23, P1. One contract per base, settled in any of 17 or 19 currencies from `availableSettlement` |
| coin-margined or inverse perpetuals | no | every perpetual has `quoteCurrency` `USDT`, P1 |
| USDC-quoted perpetuals | no | USDC is a settlement currency of the one contract, not a separate family, P1 |
| dated futures | yes, 4 | `BTC-260925`, `BTC-261225`, `ETH-260925`, `ETH-261225`, P1 |
| options | no | none in the catalog, P1 |
| spot | yes, 1,100 markets | 15 quote currencies, P1 |

CoinGecko's derivatives list shows "BTSE (Futures)" with 212 perpetual pairs and 4 futures pairs, open interest 24,913 BTC and 24 h volume 7,723.74 BTC on 2026-09-23, S8.
The catalog read 211 active perpetuals at the same time.

## 4. Perpetual tiers

Futures trading fees, from S2.

| level | 30-day volume | maker | taker | taker ppm |
|---|---|---|---|---:|
| General User | none | 0.0200 % | 0.0550 % | 550 |
| VIP 1 | $500,000 | 0.0100 % | 0.0500 % | 500 |
| VIP 2 | $1,000,000 | 0.0075 % | 0.0475 % | 475 |
| VIP 3 | $25,000,000 | 0.0050 % | 0.0450 % | 450 |
| VIP 4 | $50,000,000 | 0.0050 % | 0.0425 % | 425 |
| VIP 5 | $100,000,000 | 0.0025 % | 0.0400 % | 400 |
| VIP 6 | $250,000,000 | 0.0025 % | 0.0375 % | 375 |
| VIP 7 | $500,000,000 | 0.0000 % | 0.0350 % | 350 |
| VIP 8 | $1,000,000,000 | 0.0000 % | 0.0300 % | 300 |
| VIP 9 | $2,000,000,000 | -0.0025 % | 0.0250 % | 250 |
| VIP 10 | $4,000,000,000 | -0.0050 % | 0.0200 % | 200 |

### Qualification

- VIP levels are re-evaluated daily on the preceding 30-day volume, S2.
- S3 says the status is set by volume "with different requirements for spot and futures markets", and S2 says either spot or futures volume can qualify.
- VIP 1 to VIP 3 can also be reached by staking 100, 1,000 or 10,000 BTSE tokens, and VIP 4 and above only by volume, S3.

## 5. Discounts that change the perpetual taker

| discount | effect on the VIP 0 taker | source |
|---|---|---|
| BTSE token staking | 100 tokens lifts an account to VIP 1, 500 ppm | S3 |
| VIP and promotions | "cannot be combined. If both are available, the larger discount prevails." | S2 |
| referral | a commission paid to the referrer, 25 % of the referred user's fees for a standard referral, not a discount to the referred taker | S10 |
| spam order rule | an order below 5 USDT notional is hidden and always pays the taker fee | S1 |
| zero fee promotion | none found on 2026-09-22 | S2 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | Funding Rate = Average Premium Index + Clamp(Interest Rate - Average Premium Index, 0.05 %, -0.05 %) | S11 |
| premium index | [Max(0, Impact Bid - Index) - Max(0, Index - Impact Ask)] / Index, time-weighted over the funding period | S11 |
| interest rate | Not published as a number. On 2026-09-23, 64 of the 66 crypto perpetuals on 8 h read exactly `0.0001` and 60 of the 65 on 4 h read exactly `0.00005`, which is 0.01 % per 8 h prorated | S11, P1 funding |
| stock and commodity rate | `0` on 65 of 74 stock and 6 of 6 commodity perpetuals on 2026-09-23, and `0` at every settlement of `SNDK-PERP-USDT` in 7 days. The 9 others, such as `SKHYNIX-PERP-USDT` at `0.00148944`, carried a premium | P1 funding |
| cap and floor | Not publicly specified. The live rates ran from `-0.00125256` to `0.00154144` | S11, P1 funding |
| interval | 480 minutes on 144 perpetuals and 240 minutes on 67, from `fundingIntervalMinutes`. S11 says the interval "may vary by market". The older perpetual article still says every 1 hour | P1 anchor, S11, S12 |
| settlement instants | 00:00, 08:00 and 16:00 UTC for 8 h, every 4 h from 00:00 UTC for 4 h. The history stamps land 0.2 to 1.0 s after the hour | P1 funding |
| who pays | a positive rate: longs pay shorts, a negative rate: shorts pay longs. Only positions open at the settlement instant pay, and nothing is exchanged at a rate of 0 | S11 |
| amount | Notional Value × Funding Rate, where Notional Value = Mark Price × Position Size × Contract Multiplier | S11 |
| published rate | the running estimate for the upcoming settlement, see [`rest.md`](./rest.md) section 4 | P1 funding |

The settlement instant itself was not captured.
Settlement behaviour here comes from `recentFundingHistory` and from S11.

## 7. Liquidation, settlement and delisting

- S4 publishes no separate liquidation fee.
- Maintenance margin is Notional × (Maintenance Margin % + Taker Fee % + |Funding Rate %|), so the taker fee and the funding rate sit inside the margin that a liquidation consumes, S4.
- A position that cannot close at the liquidation price draws on the insurance fund, S4.
- No delisting settlement charge is published.
  The delisting article covers spot withdrawals and token recovery only, S13.

## 8. CCXT

| item | value | source |
|---|---|---|
| CCXT 4.5.68, installed in `server/` | no `btse` class. `require('ccxt').exchanges` holds 104 ids and none matches `/bts/i` | P1 catalog |
| first release with the class | 4.5.74, published 2026-08-17. `js/src/btse.js` answers 404 on jsDelivr for 4.5.69 to 4.5.73 and 200 for 4.5.74, 4.5.76, 4.5.78 and 4.5.82 | S14 |
| CCXT master | `ts/src/btse.ts` at commit `1d8b674`, 2026-09-22, `'pro': false`, so no CCXT Pro WebSocket class | S7 |
| `market.taker` for a swap | 0.00055, 550 ppm, from `fees.contract.taker` at `ts/src/btse.ts` line 512 of master and `js/src/btse.js` line 513 of 4.5.82, applied per market at line 770 of master | S7, S14 |
| `market.maker` for a swap | 0.0002, 200 ppm, line 511 of master | S7 |
| what 4.5.68 reports | nothing, since the class does not exist | P1 catalog |

The CCXT constant equals the published VIP 0 rate.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 550 | the "General User" futures taker of S2, the base retail tier the engine models |
| `ccxtTakerPpm` | 550 | CCXT's `fees.contract.taker` of `0.00055`, which the connector will read once CCXT is at 4.5.74 or later |

Neither value can be used while `server/` pins CCXT 4.5.68, because the connector has no `btse` class to load.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTSE API documentation, Futures API overview | https://docs.btse.com/futures/overview/ | 2026-09-22 | BTSE, global | hosts, rate limits, spam order rule |
| S2 | Futures Trading Fees | https://support.btse.com/en/support/solutions/articles/43000533620 | 2026-09-22 | BTSE, global | tier table, notional basis, qualification, discounts do not stack |
| S3 | Updated VIP Program and BTSE Token Staking Policy | https://support.btse.com/en/support/solutions/articles/43000736162 | 2026-09-22 | BTSE, global | staking path to VIP 1 to 3 |
| S4 | Liquidation and Partial Liquidation | https://support.btse.com/en/support/solutions/articles/43000460019 | 2026-09-22 | BTSE, global | margin formulas, insurance fund |
| S5 | Which jurisdictions are restricted and users prohibited? | https://support.btse.com/en/support/solutions/articles/43000781560 | 2026-09-22 | BTSE, global | prohibited and restricted lists |
| S6 | Is BTSE licensed under the EU's Markets in Crypto-Assets Regulation (MiCAR)? | https://support.btse.com/en/support/solutions/articles/43000788786 | 2026-09-22 | BTSE, EU | reverse solicitation only |
| S7 | CCXT master `ts/src/btse.ts`, commit `1d8b674` | https://github.com/ccxt/ccxt/blob/master/ts/src/btse.ts | 2026-09-22 | CCXT | country, fees, `pro` flag, market parse |
| S8 | CoinGecko derivatives exchange `btse_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/btse_futures | 2026-09-23 | CoinGecko | pair counts, volume, country |
| S9 | BTSE terms and conditions page | https://www.btse.com/en/termsandconditions | 2026-09-22 | BTSE | not readable without a script engine |
| S10 | Referral Program Details | https://support.btse.com/en/support/solutions/articles/43000061463 | 2026-09-22 | BTSE, global | referral commission |
| S11 | Funding Fees | https://support.btse.com/en/support/solutions/articles/43000460020 | 2026-09-22 | BTSE, global | funding formula, clamp, who pays |
| S12 | Perpetual Contracts | https://support.btse.com/en/support/solutions/articles/43000460017 | 2026-09-22 | BTSE, global | older text: hourly funding, index venues |
| S13 | Delisting | https://support.btse.com/en/support/solutions/articles/43000705189 | 2026-09-22 | BTSE, global | no futures charge named |
| S14 | CCXT npm releases on jsDelivr, `js/src/btse.js` | https://cdn.jsdelivr.net/npm/ccxt@4.5.82/js/src/btse.js | 2026-09-22 | CCXT | first release with the class, 4.5.82 line numbers |
| P1 | `rest-probe.mjs` modes `catalog`, `anchor` and `funding`, first runs at 03:22 to 03:26 UTC and the second pass at 03:40 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btse/rest-probe.mjs) | 2026-09-23 UTC | this host | counts, rates, intervals, CCXT 4.5.68 check |
| P2 | `ws-probe.mjs` | [`ws-probe.mjs`](../../../scripts/probes/venues/btse/ws-probe.mjs) | 2026-09-23 UTC | this host | socket reachability |
