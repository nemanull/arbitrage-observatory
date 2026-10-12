# Picol Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:28 to 03:49 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

Picol is a brand of Pionex, not a separate market.
Its web bundle names its product type `picol` and `pionex_col` in the same enum as `webot`, the Pionex.US brand of [`../webot/`](../webot/), P3.
Its public API answers the Pionex open API shapes on `api.picol.com` and `ws.picol.com`, and the catalog, the socket book frames and the trade ids are those of Pionex, see [`rest.md`](./rest.md) section 2 and [`websocket.md`](./websocket.md) section 4.
So the perpetuals below are the Pionex perpetuals of [`../pionex/fees.md`](../pionex/fees.md), sold through the Picol site under Picol's own fee table.
Two things were found to differ from Pionex.
The VIP 0 perpetual taker is 0.06 % on Picol against 0.05 % on Pionex, P1.
The Picol REST book and trades show every size at 0.882 times the Pionex size, while the Picol socket shows the Pionex sizes unchanged, see [`rest.md`](./rest.md) section 5.
No CCXT class exists for Picol in 4.5.68 or in CCXT master, see section 8.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | section 10 |
| contracting party | "you and Picol.com ("Picol", "our", "we" and "us")". No company name, registration or address appears in the terms | Not publicly specified | S1 |
| governing law | "English Common Law" | Published | S1 |
| terms dates | effective 2021-12-10, page updated 2026-04-15 | Published | S1, P1 |
| prohibited jurisdictions | Democratic Republic of Korea, Iran, Myanmar, Bulgaria, Burkina Faso, Cameroon, Democratic Republic of the Congo, Crimea and the so-called Donetsk and Luhansk People's Republic regions of Ukraine, Croatia, Cuba, Haiti, Jamaica, Kenya, Mali, Mozambique, Namibia, Nigeria, Philippines, Senegal, South Africa, South Sudan, Syria, Tanzania, Türkiye, Vietnam and Yemen, plus persons on sanctions lists | Published | S1 |
| United States and Canada | absent from that list, P1. Pionex itself lists both as Restricted Jurisdictions, see [`../pionex/fees.md`](../pionex/fees.md) section 1 | Published | S1, P1 |
| who may trade the perpetuals | an adult account holder who passed KYC and is outside the list above. No separate futures entity or eligibility test was found | Published | S1 |
| audience | the bundle carries a Traditional Chinese account notice for Picol, a `PICOL_TW` product type, and help links under `support.picol.com/hc/zh-tw/`. `support.picol.com` does not resolve | Probed | P3, P2 |
| website from this exit | `www.picol.com` answered 200 on every page tried, behind CloudFront, with no challenge and no geoblock | Probed | [`rest.md`](./rest.md) section 1 |
| public API from this exit | `api.picol.com`, `www.picol.com/quotation/` and `wss://ws.picol.com/wsPub` answered every public call | Probed | [`rest.md`](./rest.md) section 1 |

Every page of the web app, `/en/fees` included, is one 12,136 character single page shell, so the fee page was read from the JSON it loads, P1 and P3.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| every perpetual family | 0.04 %, 400 ppm | 0.06 %, 600 ppm | `futureMaker` 0.0004 and `futureTaker` 0.0006 in the `vip0` row of S2, P1 |
| spot, for reference | 0.05 %, 500 ppm | 0.05 %, 500 ppm | `spotMaker` and `spotTaker` 0.0005, S2, P1 |

The fee table has one futures column, so the USDT-M, coin-quoted and `USDT_<coin>` families share it.
The same table on Pionex reads 0.02 % and 0.05 % for VIP 0 futures, P1.
The Picol liquidation article still says "the trading fee ratio is up to 0.05%", S4, which is the Pionex number.
The JSON table is what the web app loads, so 600 ppm is the value used below.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals, `<BASE>_USDT_PERP` | yes, 554 including `USD_USDT_PERP`, all `TRADING`. Crypto, tokenized stocks and ETFs such as `AAPLX_USDT_PERP`, and five symbols that are not ASCII, such as `币安人生_USDT_PERP` | [`rest.md`](./rest.md) section 2 |
| coin-quoted perpetuals, `<BASE>_<BTC\|ETH\|SOL>_PERP` | yes, 23: 11 BTC, 9 ETH, 3 SOL | [`rest.md`](./rest.md) section 2 |
| `USDT_<coin>_PERP`, USDT priced in a coin | yes, 24 | [`rest.md`](./rest.md) section 2 |
| `SPCX_TSLAX_PERP`, quoted in the tokenized Tesla stock | yes, 1 | [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | absent from the catalog | [`rest.md`](./rest.md) section 2 |
| dated futures | absent. `type=FUTURES` answers `MARKET_PARAMETER_ERROR` `type error` | [`rest.md`](./rest.md) section 6 |
| options | absent. The catalog has only `PERP` and spot rows | [`rest.md`](./rest.md) section 2 |
| spot | yes, 411 symbols, 340 with `enable` true, the same set as Pionex | [`rest.md`](./rest.md) section 2 |

All 602 perpetual rows equal the Pionex rows field for field, [`rest.md`](./rest.md) section 2.

## 4. Perpetual tiers

From S2, read by P1, ppm in brackets.
The volume rule is the 30-day futures volume in USDT, the spot rule is `spotAndLeverageVol`, and the earn rule is `earnAveDailyAmount` in USDT.
How the three rules combine is not stated in the JSON, and the Pionex tier article reads them as alternatives, see [`../pionex/fees.md`](../pionex/fees.md) section 4.

| tier | futures volume, USDT | spot rule | earn rule, USDT | futures maker | futures taker | Pionex futures maker and taker |
|---|---:|---:|---:|---|---|---|
| vip0 | 0 | 0 | 0 | 0.040 % (400) | 0.060 % (600) | 200 and 500 |
| vip1 | 3,000,000 | 20 | 50,000 | 0.038 % (380) | 0.058 % (580) | 190 and 480 |
| vip2 | 5,000,000 | 30 | 100,000 | 0.036 % (360) | 0.054 % (540) | 180 and 450 |
| vip3 | 10,000,000 | 75 | 200,000 | 0.032 % (320) | 0.048 % (480) | 160 and 400 |
| vip4 | 50,000,000 | 120 | 500,000 | 0.028 % (280) | 0.048 % (480) | 140 and 400 |
| vip5 | 100,000,000 | 180 | 1,000,000 | 0.024 % (240) | 0.042 % (420) | 120 and 350 |
| vip6 | 250,000,000 | 300 | 2,000,000 | 0.020 % (200) | 0.036 % (360) | 100 and 300 |
| vip7 | 500,000,000 | 750 | 5,000,000 | 0.016 % (160) | 0.036 % (360) | 80 and 300 |
| vip8 | 1,000,000,000 | 1,500 | 10,000,000 | 0.012 % (120) | 0.030 % (300) | 60 and 250 |
| vip9 | 2,500,000,000 | 3,000 | 20,000,000 | 0.008 % (80) | 0.030 % (300) | 40 and 250 |
| vip10 | 5,000,000,000 | 6,000 | 50,000,000 | 0.002 % (20) | 0.024 % (240) | 10 and 200 |
| mm | none | none | 50,000,000 | 0 % (0) | 0.020 % (200) | 0 and 200 |

The spot taker is 500 ppm on every tier, and the spot maker falls from 500 ppm at vip0 to 100 ppm at vip9 and vip10, and 0 for mm, P1.
The spot rule's unit is not in the JSON, and the Pionex tier article gives it in BTC.

## 5. Discounts that change the perpetual taker

| item | value | label | source |
|---|---|---|---|
| token holding | none found. The fee table has no token column | Not publicly specified | S2 |
| futures fee discount notices | the bundle has `notice.futures_fee.enjoying` and a `futures_fee_discount` field, which suggests per account discounts. Their terms were not found | Not publicly specified | P3 |
| VIP rebate | the help article "The Trading Pairs Included in the VIP Program Commission Rebate" is linked from the bundle and was not read | Not publicly specified | P3 |
| zero fee promotions | none read | Not publicly specified | |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | `F = P + clamp(I - P, 0.05%, -0.05%)`, where F is the funding rate, P the average premium index and I the interest rate differential, as the article writes it | S3, P1 |
| premium sampling | "Picol calculates the premium index every 5 seconds and then calculates its mean (P) every N* hours. N* = Funding Interval." | S3 |
| payment | "Funding Fee = Position Size x Mark Price x Funding Rate". Longs pay shorts when the rate is positive | S3 |
| interval | per contract. The history read 8 h on `BTC_USDT_PERP`, `ETH_USDT_PERP`, `SOL_USDT_PERP`, `BTC_ETH_PERP` and `USDT_BTC_PERP`, 4 h on `ACE_USDT_PERP` and 1 h on `AAX_USDT_PERP`, identical to Pionex | [`rest.md`](./rest.md) section 3 |
| cap and floor | none published. The clamp bounds only `I - P` | S3 |

The rate, the settlement times and the history match Pionex, see [`rest.md`](./rest.md) sections 3 and 4.
The settlement instant itself was not captured, and no probe waited for one.

## 7. Liquidation, settlement and delisting

- "Liquidation Fee = Value of the position closed by liquidation * Liquidation fee ratio of the trading pair", S4.
- The ratio is per contract and public as `liquidationFeeRate` in the catalog, such as 0.0115 on `BTC_USDT_PERP`, [`rest.md`](./rest.md) section 2, while the article's example uses 1.75 %, S4.
- A liquidated position is taken over at the mark price, and an Insurance Fund first funded by Picol covers a negative balance, S4.
- No dated futures exist, so no settlement or delivery fee applies.
- Delisting terms were not read.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` | 104 `.js` files, none named `picol` or `pionex`, and neither name appears in `js/ccxt.js` | P1 |
| CCXT master on GitHub | 103 `.ts` files directly under `ts/src` in the untruncated tree at 03:36 UTC, none named `picol` or `pionex`. The second pass at 03:48 UTC got HTTP 403 from the unauthenticated GitHub API, so the first reading stands | S5, P1 |

So no `market.taker` exists for any Picol market, and `ccxtTakerPpm` has no CCXT source line to cite.
The Pionex adapter loads its catalog itself from `/api/v1/common/symbols?type=PERP`, [`../../../server/src/venues/pionex/markets.rs`](../../../server/src/venues/pionex/markets.rs) line 13.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 futures taker of S2, one column for every family |
| `ccxtTakerPpm` | none | no CCXT class |

The Pionex adapter's own constant is 500, [`../../../server/src/venues/pionex/markets.rs`](../../../server/src/venues/pionex/markets.rs) line 10.
A Picol leg would read the same book as the Pionex leg and pay 100 ppm more for it.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Picol Terms of Service, effective 2021-12-10, updated 2026-04-15 | https://www.picol.com/blog/en/picol-terms-of-service/ | 2026-10-09 | Picol.com | section 1 |
| S2 | VIP level table the web app loads | https://config.picol.com/vipLevelConfig.picol.json, and https://config.pionex.com/vipLevelConfig.json for Pionex | 2026-10-09 | Picol, and Pionex for comparison | sections 2, 4 and 9 |
| S3 | Funding Fee | https://www.picol.com/blog/en/funding-fee/ | 2026-10-09 | Picol | section 6 |
| S4 | Liquidation | https://www.picol.com/blog/en/liquidation/ | 2026-10-09 | Picol | sections 2 and 7 |
| S5 | CCXT repository tree | https://api.github.com/repos/ccxt/ccxt/git/trees/master?recursive=1 | 2026-10-09 | CCXT | section 8 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/picol/fees-probe.py) | runs from 03:36 to 03:48 UTC | 2026-10-10 UTC | this host | sections 1, 2, 4, 6 and 8 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/picol/rest-probe.py) section "Site access" | runs at 03:28, 03:31, 03:39 and 03:45 UTC | 2026-10-10 UTC | this host | section 1 |
| P3 | [`fees-probe.py`](../../../scripts/probes/venues/picol/fees-probe.py) section "Web app bundle", which counts product types, hosts, fee fields and help links in `https://www.picol.com/static/js3/main.20260828.108.ca5c91c.js`, 9.8 MB | the last two runs, up to 03:48 UTC | 2026-10-10 UTC | this host | sections 1, 5 and the opening |
