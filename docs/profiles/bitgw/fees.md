# BitGW Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:47 to 04:06 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers BitGW Exchange, CoinMarketCap rank 186, which has no CCXT id, so the folder is the slug `bitgw`.
BitGW lists no perpetuals, so by change 1 of the survey plan's template this profile covers its spot market.
BitGW publishes no API documentation and no fee page outside its help center.
Every fee number below comes from the help center article the web app loads, or from the trade form's own `service` field, both read anonymously by [`fees-probe.py`](../../../scripts/probes/venues/bitgw/fees-probe.py).
The derivative search, the CCXT check and the CoinGecko check are in [`endpoints-probe.py`](../../../scripts/probes/venues/bitgw/endpoints-probe.py).

The finding that matters most is in [`websocket.md`](./websocket.md) section 4 and [`rest.md`](./rest.md) section 5.
BitGW's order book and trade feed are OKX's spot book and trades relayed unchanged, with OKX's sequence ids and trade ids.
So BitGW adds no independent price to compare against OKX, whatever its fees are.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | "BitGW Co., LTD", in the Terms of Service and the Privacy Policy. No incorporation place is published | Published | S4 |
| governing law | "the laws of the State of Washington, United States", with courts in Washington | Published | S4 |
| registration | "Registered with Money Service Business (MSB)", "MSB Registration Number: 31000237275963", on the About page. The number was not checked against FinCEN's search | Published | S5 |
| Canada | A 2023 article says BitGW "is actively preparing to submit an application" for a Canadian licence covering spot and derivatives trading. A 2025 welcome bonus lists Canada among 23 eligible countries | Published | S8, S9 |
| restricted regions | No list is published. An April 2026 article says KYC now covers "30 countries and regions" and names seven added ones, and the Earn rules tell users to make sure they "do not reside in any restricted jurisdiction" | Not publicly specified | S6, S4 |
| who may trade | A registered account holder. Fiat and crypto trading follow KYC in a supported jurisdiction | Account-gated | S6 |
| public API documentation | None found. The terms mention "APIs", the bundle has no API page, and the help center's 159 articles have none on an API | Not offered | [`endpoints-probe.py`](../../../scripts/probes/venues/bitgw/endpoints-probe.py) |
| public data from this exit | The website, the signed anonymous POST calls under `https://bitgw.com/api/` and the socket `wss://bitgw.com:8443` all answered, with no challenge and no refusal | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The exit's Cloudflare edge was `YVR`, Vancouver, in every `CF-RAY` header.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| perpetuals | Not offered | Not offered | Not offered | section 3 |
| spot, USDT pairs | 0.20 % = 2000 ppm | 0.20 % = 2000 ppm | Published and Probed | S3 tier "Regular", and `service` of `"0.2"` on 91 of 91 markets |

BitGW publishes one "Spot & Swap Fee" per tier and no separate maker and taker rate.
The trade form charges `size × service / 100` on both sides, so 0.2 means 0.2 %, see section 4.
The engine models a taker cross at the base retail tier, so 2000 ppm is the spot number, and there is no perpetual number.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| perpetuals, any margin | No | The web app has 13 page routes and none is a futures, contract or perpetual page. The words perpetual, futures, contract, leverage, funding and liquidation appear in no chunk of the bundle. The catalog has only spot pairs. CoinGecko's derivatives list of 216 exchanges has no BitGW. All by [`endpoints-probe.py`](../../../scripts/probes/venues/bitgw/endpoints-probe.py) |
| dated futures | No | as for perpetuals |
| options | No | as for perpetuals |
| spot | Yes, 91 USDT pairs | `marketInit`, see [`rest.md`](./rest.md) section 2 |
| margin trading | Named in the terms as "Margin trading (where enabled)", with a risk clause. No page, call or setting for it exists in the bundle | S4 and the bundle |
| Swap | Yes. In BitGW's words this is "an instant crypto-to-crypto conversion feature", not a perpetual swap. The tab labelled "Swap" opens `/pages/exchange/exchange` | S10 and the bundle |
| AMM pools, OTC, Earn | AMM is switched on. OTC and Earn are switched off in the anonymous `more` reply (`otcSwitch` 0, `financingSwitch` 0) | `fees-probe.py` section scope |

The "Swap" in "Spot & Swap Fee" and in the 30 day volume rule is the conversion feature above.

## 4. Spot tiers

The tier table is help center article 809, "Tiered Trading Fee Discount Program", created 2026-01-10 and updated 2026-02-28, S3.
A user meets a tier by any one of 30 day trading volume, total assets, or the total assets of direct referrals.
The tier is snapshotted at 00:00 UTC daily and holds for 24 hours.

| tier | 30 day volume, USD | total assets, USDT | referral assets, USDT | Spot & Swap fee | ppm | AMM fee |
|---|---|---|---|---|---|---|
| Regular | ≤ 1,000,000 | ≤ 10 | ≤ 10 | 0.20 % | 2000 | 35 % |
| VIP1 | ≤ 1,000,000 | ≤ 10 | ≤ 10 | 0.20 % | 2000 | 35 % |
| VIP2 | ≤ 5,000,000 | ≤ 1,000 | ≤ 4,000 | 0.18 % | 1800 | 25 % |
| VIP3 | ≤ 20,000,000 | ≤ 8,000 | ≤ 32,000 | 0.15 % | 1500 | 17 % |
| VIP4 | ≤ 75,000,000 | ≤ 60,000 | ≤ 220,000 | 0.12 % | 1200 | 11 % |
| VIP5 | ≤ 210,000,000 | ≤ 400,000 | ≤ 1,500,000 | 0.10 % | 1000 | 8 % |
| VIP6 | ≤ 500,000,000 | ≤ 1,500,000 | ≤ 5,000,000 | 0.09 % | 900 | 7 % |
| VIP7 | ≤ 900,000,000 | ≤ 8,000,000 | ≤ 32,000,000 | 0.08 % | 800 | 6 % |

The thresholds are printed with "≤" in the article, which reads as an upper bound, so the qualification rule as written is ambiguous.
The article says "Trading fees are charged as a percentage of the executed trade value", and it never says maker or taker.
The VIP page labels its fee box "Your Maker / Taker Fee Rate" in the English strings of the bundle, which fits one rate for both sides.

The anonymous `marketDetail` reply carries `service: "0.2"` for every one of the 91 markets.
The trade form computes the buy fee as `buyNum × service / 100` and the sell fee as `sellTotal × service / 100`, in the k page chunk of the bundle.
So the buy fee is taken in the base coin and the sell fee in USDT.
A logged in user may see another `service` value for a higher tier, which was not checked.

## 5. Discounts that change the taker

| discount | effect | label | evidence |
|---|---|---|---|
| VIP tiers | down to 0.08 % at VIP7, section 4 | Published | S3 |
| zero fee promotion | 0 % on BTC and ETH spot for new KYC users, from 2025-09-15 to 2025-10-15. It ended a year before retrieval | Published | S7 |
| market making | "BitGW offers Market Making Incentive Scheme for professional liquidity providers", with no rates | Negotiated | S3 |
| token holding | Not publicly specified. The terms name a "BitGW Token" and "BitGW Credits" with no fee effect | Not publicly specified | S4 |

## 6. Funding as a cost

Not offered.
BitGW lists no perpetuals, so it charges no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered for derivatives.
The terms name margin trading "where enabled" but publish no liquidation charge, and no margin page exists in the web app.
Deposit is free and withdrawal fees are fixed per coin in the same article S3, which is the official lookup for them.

## 8. CCXT

BitGW has no class in CCXT 4.5.68.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has `gw` in its name or mentions `bitgw`.
On CCXT master on GitHub, `ts/src/bitgw.ts` and `js/src/bitgw.js` answered 404, and none of the 103 ids in `exchanges.json` contains `gw`, S12.
So there is no `market.taker` to read and no `ccxtTakerPpm`.

## 9. Recommended registry values

None.
BitGW has no perpetuals, so it cannot be a perpetual leg, and it has no CCXT class for the catalog.
If a spot leg were ever built, the spot `takerPpm` would be 2000 and there would be no `ccxtTakerPpm`.
Even then BitGW's book is OKX's spot book, see [`websocket.md`](./websocket.md) section 4, so OKX itself is the venue to add.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.bitgw.com/`, title "BitGW \| Crypto Exchange", and its bundle `/assets/index-B2YCeHws.js` with 33 page chunks | 2026-10-09 |
| S2 | the bundle's `globalData`: `host: "https://bitgw.com/api/"`, the client key, `version: "2.1.2"`, and the socket class with `wss://bitgw.com:8443` | 2026-10-09 |
| S3 | help center article 809, "Tiered Trading Fee Discount Program", from POST `https://bitgw.com/api/home` with `type=help` | 2026-10-09 |
| S4 | `user_rules` (Terms of Service), `policy` and `financing_rules` from POST `https://bitgw.com/api/home` with `type=more` | 2026-10-09 |
| S5 | `about` from the same `type=more` reply | 2026-10-09 |
| S6 | help article 876, "BitGW Expands KYC Support to New Jurisdictions", 2026-04-02 | 2026-10-09 |
| S7 | help article 247, "BitGW Launches Zero Trading Fee Promotion for New Users" | 2026-10-09 |
| S8 | help article 72, "BitGW Applies for Canadian Crypto Trading License" | 2026-10-09 |
| S9 | help article 375, "BitGW Welcome Bonus Event" | 2026-10-09 |
| S10 | help articles 463, "Swap Feature FAQ: Crypto-to-Crypto Instant Exchange", and 450, "How to Use BitGW Swap" | 2026-10-09 |
| S11 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list`, 216 entries | 2026-10-09 |
| S12 | `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/bitgw.ts`, `js/src/bitgw.js` and `exchanges.json` | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/bitgw/fees-probe.py), the tier table, the terms and `service` on 91 markets | 2026-10-09 |
| P2 | [`endpoints-probe.py`](../../../scripts/probes/venues/bitgw/endpoints-probe.py), the site, the bundle, CCXT and CoinGecko | 2026-10-09 |
