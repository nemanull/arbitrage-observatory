# OneEx Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time (2026-10-10 02:18 to 02:50 UTC), from the development host near Seattle, through the user's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

This profile covers perpetual trading on OneEx (`www.oneex.vip`), which has no CCXT class, see section 8.
Spot is named once in the coverage matrix with its published rates.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/oneex/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/oneex/ws-probe.py), run from the repository root with `uv run`.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 local time for every source row | | source ledger |
| legal entity | CoinMarketCap's exchange description says "Registered as ONE BYTE SP. Z O.O. in Poland, OneEx operates under the Poland VASP regulatory framework". The Terms of Service name no company and give the support address `support@one.vip`. The Polish register was not checked. | Published, not verified | S5, S3 |
| who may trade the perpetuals | The site's country table lists 188 countries, and every row, including Canada and the United States, carries `allowRegister` 1 and `allowKyc` 1. The Terms of Service list no restricted jurisdiction. So no page read excludes any region. | Not publicly specified | Probed, `GET /s_api/basic/config_v2`, S3 |
| prohibited conduct | The Terms of Service list "Automated bot trading or market manipulation" under Prohibited Activities. That matters for a future execution stage, not for reading public market data. | Published | S3 |
| website from this host | `www.oneex.vip` answered 200 with a single page app, and every public market data call the probe made answered 200, apart from the deliberate error cases. | Probed | [`rest.md`](./rest.md) section 1 |
| public API from this host | The site's own JSON calls on `www.oneex.vip` and its socket `wss://ws.oneex.vip/ws/quote/v1` served market data with no key. The broker OpenAPI host `open-api.oneex.vip` answered every path with CloudFront 403 "Request blocked". | Probed | [`rest.md`](./rest.md) sections 1 and 6, [`websocket.md`](./websocket.md) section 5 |

All access results were taken from the Canadian VPN exit named in the Probed line, not from a US address.
No API documentation is published, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetuals | 0.04 % = 400 ppm | 0.08 % = 800 ppm | Published | S1, an image table, row "ALL USDT Futures", "Maker 0.04%", "Taker. 0.08%" |
| USDH-margined perpetuals | 0.02 % = 200 ppm | 0.05 % = 500 ppm | Published, not tradable | S1, row "ALL USDH Futures". Every USDH row in the catalog has `status` false and `canTrade` false, see section 3. |

CoinMarketCap lists `makerFee` 0.04 and `takerFee` 0.08 for OneEx in S5, the same pair as the USDT row.
The engine models a taker cross at the base retail tier, so 800 ppm is the number that matters.

## 3. Coverage matrix

| product | present | count on 2026-10-10 UTC | evidence |
|---|---|---:|---|
| USDT-margined perpetuals | yes | 30 tradable, 28 shown on the site and 2 hidden (`BANANA-SWAP-USDT`, `G-SWAP-USDT`) | Probed, `futuresSymbol` in `GET /s_api/basic/config_v2?tab=exchange&type=all`, `status` true and `canTrade` true |
| USDH-margined perpetuals | listed, closed | 30 rows, all `status` false | Probed, same call |
| coin-margined (inverse) perpetuals | no | 0 | Probed, every row has `isReverse` false |
| dated futures | no | 0 | Probed, all 60 rows carry `settlementDate` 2145888000000 (2038-01-01) and the `-SWAP-` symbol form |
| options | no | 0 | Probed, `optionSymbol` is empty |
| spot | yes, not detailed | 72 rows, 30 shown USDT pairs, 1 USD pair (`USDTUSD`) | Probed, `symbol` in the same call |

CoinMarketCap's exchange data on 2026-10-10 02:14 UTC gave a perpetual volume of about 1,380 million USD and a spot volume of about 278 million USD for 24 hours (S5).
Spot fees from S1 are 0.2 % maker and 0.2 % taker on "Other Spot USDT Pairs", 1 % to buy and 0 % to sell `USDT/USD`, and 3 % to buy and 0 % to sell on USDH pairs.

## 4. Perpetual tiers

No VIP tier table was found.
The fee article S1 is one image with one maker and one taker rate per family and no tiers.
The site configuration reports `userLevel` false in its `functions` block, which suggests no user level programme is switched on.

## 5. Discounts that change the perpetual taker

| discount | value | label | evidence |
|---|---|---|---|
| XO token | CoinMarketCap's description says "XO can be used to pay trading fees at a discount". No OneEx page read gives the size of the discount or how to enable it. | Not publicly specified | S5 |
| referral, agent | The site has `/invite` and an agent centre. No page read gives a fee rebate for the referred account. | Not publicly specified | site navigation in `GET /s_api/basic/index_config` |
| market maker programme | none found | Not publicly specified | S1 |
| zero fee promotions | none found | Not publicly specified | S1 |

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | Funding fee equals notional position value times the funding rate, and notional value equals contracts times contract face value times the underlying price. The source renders each multiplication sign as the Unicode replacement character. | Published | S2 |
| direction | "When the contract price is higher than the index price, long position holders pay the funding fee to short position holders", and the reverse when it is lower. S4 adds that a positive rate makes the long side pay. | Published | S2, S4 |
| interval | S2 says "The most common practice is every 8 hours" and gives example times 00:00, 08:00 and 16:00 UTC. On the wire every one of the 60 funding rows has `nextSettleTime - lastSettleTime` of 8 h, with the next settlement at 04:00 UTC and the last at 20:00 UTC, so the live clock is 04:00, 12:00 and 20:00 UTC, not the example. | Published and Probed | S2, `GET /api/contract/funding_rates` in [`rest.md`](./rest.md) section 3 |
| cap and floor | No cap or floor is published. The two hidden USDT rows read `fundingRate` -0.02 and the closed USDH rows read -0.003, while the 28 shown USDT rows read between -0.00062 and 0.00005 in the last run. | Not publicly specified, Probed | S2, [`rest.md`](./rest.md) section 4 |
| to whom | "the payment of the funding rate takes place exclusively between traders and the exchange does not charge any fees" | Published | S4 |

The settlement instant itself was not captured, because the survey never waits for a clock event.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation fee | S6 says "The system will charge a liquidation fee, which is typically higher than standard closing fees" and gives no rate. | Not publicly specified | S6 |
| liquidation trigger | Liquidation is judged on the mark price, when the position margin ratio falls to the maintenance margin rate. The BTC catalog row's first risk tier has `maintainMargin` 0.004 up to 80,000 USDT. | Published, Probed | S6, `riskLimits` in `GET /s_api/basic/config_v2` |
| insurance fund and ADL | Losses past the account's margin go to the insurance fund, and auto-deleveraging follows if the fund is short. | Published | S6 |
| settlement or delivery | none, the contracts are perpetual | Not offered | section 3 |
| delisting | No delisting rule was found in the 78 help centre articles. | Not publicly specified | `GET /api/v1/learning/center/article/list` |

## 8. CCXT

OneEx has no CCXT class.
CCXT 4.5.68 has no `oneex.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and its exchange map in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` goes from `okxus` to `onetrading` at line 320 with no `oneex` id, and the pro map has `onetrading` at line 404 and no `oneex`.
No file there mentions `oneex.vip`.
The GitHub listing of `ts/src` on `ccxt/ccxt` branch `master`, at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 UTC, holds no file named after OneEx, and the only names containing "one" are `bigone.ts`, `coinone.ts` and `onetrading.ts`.
So `market.taker` cannot be read, and there is no CCXT source line to cite.

## 9. Recommended registry values

A recommendation for a later design, not a decision.

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 800 | the VIP 0 USDT perpetual taker in S1, which CoinMarketCap repeats in S5 |
| `ccxtTakerPpm` | not applicable | there is no CCXT class to declare a constant for |
| catalog | hand written | The Rust adapters build their catalog themselves, as [`../../../server/src/venues/gate/markets.rs`](../../../server/src/venues/gate/markets.rs) does, so OneEx needs a loader over `futuresSymbol` in `GET /s_api/basic/config_v2`, see [`rest.md`](./rest.md) section 2. |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | OneEx Trading Fees, released 2025-06-18, one image table | https://www.oneex.vip/guide/detail/c03a5461c0b744c0b541c758155ef64d, image https://stadata.oneex.vip/resource/image/snNltlLMYdXSdw_gDZmnKW-ZQ5RIQneKwT6Mv58wgvM.png | 2026-10-09 | OneEx, global | sections 2 to 5 |
| S2 | Funding Fee Introduction, released 2025-04-30 | https://www.oneex.vip/guide/detail/b64d2f35186f412098c999f8c9fea0e7 | 2026-10-09 | OneEx, global | section 6 |
| S3 | Terms of Service, released 2025-04-30 | https://www.oneex.vip/guide/detail/ba15ee02c21b45749adbbbf7602b7ede | 2026-10-09 | OneEx, global | section 1 |
| S4 | USDT Perpetual Futures: A Complete Guide, released 2025-06-19 | https://www.oneex.vip/guide/detail/a2c9694b7f804132ab3554224cabeaab | 2026-10-09 | OneEx, global | section 6 |
| S5 | CoinMarketCap exchange detail for `oneex`, id 33080, description, fees and 24 h volumes at 2026-10-10 02:14 UTC | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=oneex | 2026-10-09 | CoinMarketCap | sections 1 to 3 and 5 |
| S6 | Forced Liquidation Explanation (Liquidation Mechanism), released 2025-04-30 | https://www.oneex.vip/guide/detail/f4ef74598a554e7bb04ddd9e08e6dd99 | 2026-10-09 | OneEx, global | section 7 |
| S7 | Introduction to Index Price and Mark Price, released 2025-04-30 | https://www.oneex.vip/guide/detail/b5f5eb28160c41808b1d627ba3b5832e | 2026-10-09 | OneEx, global | [`rest.md`](./rest.md) section 4 |

The help centre pages are a single page app, and their text comes from `GET /api/v1/learning/center/article/detail?articleBaseId=<id>`, which [`rest-probe.py`](../../../scripts/probes/venues/oneex/rest-probe.py) reads for S1, S2, S3 and S7.
