# BitTap Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 02:18 to 02:44 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers perpetual trading on BitTap, which has no CCXT id, so the folder is the slug `bittap`.
BitTap lists one perpetual family, USDT-margined linear perpetuals, and nothing else on its futures side.
Spot, margin, deposit, withdrawal, mining and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/bittap/rest-probe.py) and [`anchor-probe.py`](../../../scripts/probes/venues/bittap/anchor-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified. The Terms of Service define "BitTap Operators" as "all parties that run the Platform, including but not limited to legal persons, unincorporated organisations and teams" and name no company. | Not publicly specified | S15 |
| restricted regions | "The United States and all its territories", "Canada (including the province of Alberta)", Singapore, North Korea, Cuba, Iran, Syria, Sudan, South Sudan, Afghanistan, Iraq, Libya, Yemen, Lebanon, Somalia, Central African Republic, Democratic Republic of Congo, Guinea-Bissau, Haiti, the Russian-controlled regions of Ukraine, and France, dated April 21, 2025 | Published | S9 |
| VPN rule | "Any attempt to bypass regional restrictions by using VPNs, false identity information, or similar methods will be considered a severe violation." | Published | S9 |
| who may trade the perpetuals | A verified account holder outside the restricted regions. Fee discount vouchers and the VIP display both require a verified account. | Region-specific | S9, S14, S16 |
| public API from this exit | Every public call answered 200 with data. The website's region check `GET https://api.bittap.com/ucenter/public/api/v1/compliance/check` returned `"level":0` and `"ruleCode":null` for this exit. | Probed | [`rest.md`](./rest.md) sections 1 and 6 |
| website and docs from this exit | `www.bittap.com`, `developers.bittap.com` and `support.bittap.com` all answered 200. | Probed | `curl` on 2026-10-09 |

The exit geolocates to Vancouver, Canada, and Canada is a restricted region under S9.
So trading from this exit is not allowed, while reading public market data is not an account service and was served without a challenge.
The development host itself sits in the United States, which is restricted too.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M linear perpetuals | 0.02 % = 200 ppm | 0.06 % = 600 ppm | Published and Probed | S10, S11, and the VIP table the website's fee page reads, section 4 |

The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters.
The catalog also carries a per contract `takerFeeRate`, and 277 of the 282 open contracts state `0.0006`, see section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 282 OPEN and 34 SETTLED in the website catalog, all `contractSide` FORWARD and `contractType` PERPETUAL | Probed, [`rest.md`](./rest.md) section 2 |
| USDT-M TradFi perpetuals | yes, inside the same family and untagged. 12 open contracts carry a stock, index or metal ticker: XAU, XAG, TSLA, MSTR, NVDA, COIN, CRCL, AAPL, AMZN, MSFT, GOOGL and QQQ | Probed, name check in `rest-probe.py` |
| USDC-M perpetuals | absent, every contract quotes USDT | Probed |
| coin-margined (inverse) perpetuals | absent. The docs define `REVERSE` for coin-margined contracts, and no contract uses it. | S2, Probed |
| dated futures | absent. The docs define `DELIVERY`, and no contract uses it. | S2, Probed |
| options | absent, no options product on the website or in the API docs | S1, website bundle S16 |
| spot | present, 86 OPEN and 36 SETTLED pairs in the website catalog, with a documented spot API. Not detailed here. | Probed, [`rest.md`](./rest.md) section 2 |
| pre-market | a BTB pre-market product launched on June 15, 2026 per a support announcement. Not detailed. | support centre search result, 2026-10-09 |
| margin, mining, earn, card, deposit and withdrawal | named only. The withdrawal schedule is in the support article "BitTap Withdrawal Fee Explanation". | support centre search result, 2026-10-09 |

## 4. Perpetual tiers

The website's fee page is `https://www.bittap.com/vip/funding-rate`, which the footer labels `footer.bittap.feeStandard`, S16.
It is rendered in the browser, and its numbers come from the public call `GET https://api.bittap.com/vip/public/api/v1/vip-config/getVipConfigInfo`, read by [`rest-probe.py`](../../../scripts/probes/venues/bittap/rest-probe.py) section "fees".

| level | contract maker | contract taker | taker ppm | 30-day contract volume, USDT | 30-day spot volume, USDT | asset, USDT | 30-day BTB asset | 30-day invites |
|---|---|---|---|---|---|---|---|---|
| VIP0 | 0.0002 | 0.0006 | 600 | none | none | 0 | none | none |
| VIP1 | 0.0002 | 0.0005 | 500 | 2,000,000 | 200,000 | 1,000 | 500 | 10 |
| VIP2 | 0.00016 | 0.0005 | 500 | 10,000,000 | 1,000,000 | 10,000 | 5,000 | 50 |
| VIP3 | 0.00014 | 0.0004 | 400 | 16,000,000 | 1,600,000 | 50,000 | 25,000 | 250 |
| VIP4 | 0.00012 | 0.000375 | 375 | 40,000,000 | 4,000,000 | 200,000 | 100,000 | 500 |
| VIP5 | 0.0001 | 0.00035 | 350 | 100,000,000 | 8,000,000 | 1,000,000 | 500,000 | 1,000 |
| VIP6 | 0.00008 | 0.000315 | 315 | 200,000,000 | 12,000,000 | 2,000,000 | 1,000,000 | 1,500 |
| VIP7 | 0.00006 | 0.0003 | 300 | 400,000,000 | 16,000,000 | 3,000,000 | 1,500,000 | 2,000 |
| VIP8 | 0.000055 | 0.000285 | 285 | 800,000,000 | 20,000,000 | 4,000,000 | 2,000,000 | 2,500 |
| VIP9 | 0.00005 | 0.00027 | 270 | 1,600,000,000 | 24,000,000 | 5,000,000 | 2,500,000 | 3,000 |

The asset column is the reply's `dayAsset` and `thirtyAsset`, which are equal on every level.
The spot VIP 0 rate in the same reply is 0.002 maker and 0.002 taker.

### Qualification

Whether one condition or all of them lift an account to a level is Not publicly specified, since the call returns the thresholds without a rule and the rendered page was not read.
The call's field names suggest 30-day contract volume, 30-day spot volume, a daily or 30-day asset balance, a 30-day BTB token balance and a 30-day invite count.

### History and published text

The "BitTap Contract Trading Fee Rate Adjustment Notice", dated July 9, 2025, moved the taker from 0.0005 to 0.0006 and the maker from 0.0003 to 0.0002, S11.
"What Fees Are Incurred in Futures Trading?" states a maker fee of 0.02 % and a taker fee of 0.06 %, S10.
The fee is "Position Value × Fee Rate", with position value the size times the trade price, S11.
The documented private call `GET /ftapi/v1/account/fee` returns the account's own rates per contract, S8, and was not called.

### Per contract rates in the catalog

The website catalog states a `takerFeeRate` and a `makerFeeRate` on every contract, Probed in [`rest.md`](./rest.md) section 2.

| field | OPEN contracts |
|---|---|
| `takerFeeRate` 0.0006 | 277 |
| `takerFeeRate` other | ALGO 0.0005, NMR 0.00006, BB 0.00006, MSTR 0.0002, USDC 0.0008 |
| `makerFeeRate` 0.0002 | 146 |
| `makerFeeRate` 0.0003 | 134 |
| `makerFeeRate` 0.0006 | 2, MSTR and USDC |
| `enableVipRate` true | 173 |
| `enableVipRate` false | 109 |

The 134 contracts at a 0.0003 maker disagree with the published 0.0002, and the catalog is what the matching engine is likely to charge.
`enableVipRate` false most likely means the VIP discount does not apply on that contract, which is an inference from the name and is not documented.
None of this changes the VIP 0 taker on 277 contracts.

## 5. Discounts that change the perpetual taker

| discount | effect | label | evidence |
|---|---|---|---|
| futures fee discount voucher | "10% of the trading fee on each order will be deducted using the voucher", from a fixed voucher balance with an expiry, on USDT-margined perpetuals, for verified accounts only | Published | S14 |
| referral and commission rebate | a rebate programme exists, and a limited-time referral rebate increase was announced on 2025-10-28 | Published, not detailed | support centre search result, 2026-10-09 |
| BTB token | a 30-day BTB balance is one of the VIP conditions in section 4. No direct BTB fee deduction was found. | Published | section 4 |
| market maker programme | Not publicly specified | Not publicly specified | none found |
| zero fee promotions | a zero spot fee promotion was announced on 2025-09-18 for spot only. None was found for perpetuals. | Published | support centre search result, 2026-10-09 |

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | "Funding Fee = Position Value × Funding Rate", and "Funding Rate = Interest Rate + Premium Index" | Published | S12, S13 |
| who pays | the side the rate's sign names pays the other side, and "the exchange does not collect any portion of these fees" | Published | S12 |
| interval, documented | "funding fees are settled every 8 hours", at "00:00, 08:00, and 16:00 UTC" | Published | S12, S13 |
| interval, catalog | `settleCycle` hours per contract: 186 contracts at 4, 95 at 8, and KAIA at 1 | Probed | `rest-probe.py` section 2 |
| next settlement on the socket | `T` of every contract sat on the UTC grid of its `settleCycle` and within one cycle ahead, on 282 of 282 | Probed | `anchor-probe.py` |
| cap | the catalog's `fundRateLimit` is 0.0005 on BTC and on 104 contracts in all, and 0.02 on 171. TRX streamed a rate of -0.00068 and -0.000689 in two runs against a `fundRateLimit` of 0.0005, so the field is not a hard cap on the published rate. | Probed | `rest-probe.py` section 2, `anchor-probe.py` |
| settlement delay | "the settlement and crediting of funding fees may be delayed by 10-30 seconds" | Published | S11 |

The documented 8 hour schedule is stale for two thirds of the catalog, so the interval must come from `settleCycle`.
The settlement instant itself was not captured, because the survey never waits for a clock event.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation fee | "Notional Value × Liquidation Fee Rate", paid into the insurance fund | Published | S10 |
| liquidation fee rate | per contract `liquidationFeeRate`, 0.005 on BTC. Across the 282 OPEN contracts: 125 at 0.01, 121 at 0.003, 26 at 0.0005, 8 at 0.005, one each at 0.001 and 0.002. | Probed | `rest-probe.py` section 2 |
| delivery or settlement fee | none, since there are no dated futures | Not offered | section 3 |
| delisting | 34 contracts carry status `SETTLED`. The documented `/fmapi/v1/exchangeInfo` lists them beside the live ones with no status field, and they still stream and return a book. | Probed | [`rest.md`](./rest.md) section 2 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version installed | 4.5.68 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/package.json` line 3 |
| BitTap class in 4.5.68 | none. `js/src/` holds 104 exchange files and no `bittap.js`, and the import list runs `bitstamp`, `bitteam`, `bittrade` with nothing between | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` lines 67 to 69 |
| BitTap class on CCXT master | none. `ts/ccxt.ts` at version 4.5.85 imports `bitstamp`, `bitteam` and `bittrade` with nothing between, and `ts/src/bittap.ts` answers 404 | S17, lines 45 and 70 to 72 |
| `market.taker` without credentials | none, because no class exists | |

## 9. Recommended registry values

The Rust server builds each venue's catalog itself, as [`gate/markets.rs`](../../../server/src/venues/gate/markets.rs) does, and holds the taker as a constant beside it.

```rust
const TAKER_PPM: u32 = 600; // published VIP 0 taker, and the catalog's takerFeeRate on 277 of 282 open contracts on 2026-10-09
```

`takerPpm` 600 is the published VIP 0 taker of S10 and S11 and the VIP 0 row of the fee table.
`ccxtTakerPpm` has no meaning here, because CCXT has no BitTap class.
A loader may read the per contract `takerFeeRate` instead, which would pick up the five exceptions in section 4, but a constant is the boring choice and matches 277 of 282 contracts.

## 10. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | `https://developers.bittap.com/en/futures/getting-started`, last updated January 26, 2026 | 2026-10-09 | hosts, rate limit, response shape |
| S2 | `https://developers.bittap.com/en/futures/market/exchange-info`, last updated January 28, 2026 | 2026-10-09 | contract side and type enums |
| S8 | `https://developers.bittap.com/en/futures/trading/account-fee`, last updated January 26, 2026 | 2026-10-09 | private fee call |
| S9 | `https://support.bittap.com/hc/en-us/articles/12483651688079`, "Restricted / Prohibited Countries and Regions for BitTap Services", updated 2025-07-21 | 2026-10-09 | restricted regions, VPN rule |
| S10 | `https://support.bittap.com/hc/en-us/articles/10731602565135`, "What Fees Are Incurred in Futures Trading?", updated 2025-07-12 | 2026-10-09 | maker and taker, liquidation fee |
| S11 | `https://support.bittap.com/hc/en-us/articles/13196551712271`, "BitTap Contract Trading Fee Rate Adjustment Notice", dated July 9, 2025, updated 2026-04-15 | 2026-10-09 | fee change, fee formula, funding delay |
| S12 | `https://support.bittap.com/hc/en-us/articles/10736347474959`, "BitTap Futures Funding Fees", updated 2025-06-19 | 2026-10-09 | funding formula and schedule |
| S13 | `https://support.bittap.com/hc/en-us/articles/15504743474831`, "BitTap Funding Rate Explanation", updated 2026-03-18 | 2026-10-09 | funding formula and schedule |
| S14 | `https://support.bittap.com/hc/en-us/articles/13189936405775`, "BitTap Futures Fee Discount Voucher User Guide", updated 2026-03-19 | 2026-10-09 | voucher |
| S15 | `https://support.bittap.com/hc/en-us/articles/10753185078671`, "Terms of Service", updated 2026-02-24 | 2026-10-09 | operator definition |
| S16 | `https://www.bittap.com/assets/261009-164923376-2g/index.c47c34d0.js`, the website bundle | 2026-10-09 | fee page route, KYC gate on the VIP display, socket URL builder |
| S17 | `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts`, master at commit `f0aca06` of 2026-10-08 | 2026-10-09 | CCXT master |

The support articles were read through the Zendesk Help Center API at `https://support.bittap.com/api/v2/help_center/en-us/articles/<id>.json`.
Rows S3 to S7 and S18 to S20 are used by [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).
