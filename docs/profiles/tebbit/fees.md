# Tebbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:03 to 03:36 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers perpetual trading on Tebbit, which has no CCXT id, so the folder is the slug `tebbit`.
Tebbit lists one perpetual family, USDT-margined linear perpetuals, and two USDT-settled event contracts.
Spot, copy trading, C2C, deposit and withdrawal schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/tebbit/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/tebbit/rest-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | "Tebbit Technology Ltd.", "incorporated and operated in Singapore", operating "the website http://www.Tebbit.io" | Published | S12 |
| US registration | a FinCEN MSB registration, "MSB Registration No.: 31000281812392", legal name "TEBBIT TECHNOLOGY LTD.", with a Denver address. The same page claims "dual MSB licenses in Canada and the United States" | Published | S13 |
| official domains | `https://www.tebbit.io` and the backup `https://www.tebbit.vip`, per a help center warning against impostor sites | Published | S11 |
| restricted regions | No restricted country list is published. The User Agreement only says service may stop where use "is illegal under the laws of your jurisdiction". The iOS app is not listed in "Mainland China, Macao, North Korea, Iran, Syria, India, United Kingdom, Canada, all European Union member states", Cuba, Bolivia, Algeria, Iraq, Morocco and Zimbabwe | Not publicly specified | S12, S7 |
| who may trade the perpetuals | A registered account holder. A KYC notice sets daily withdrawal limits by level and was not read further. | Account-gated | help center article "Notice on KYC Verification and Daily Withdrawal Limits", 2026-01-09 |
| arbitrage rule | The risk control rules list "Prohibited quant/arbitrage trading: Using illegal algorithms or methods to evade rules or conduct improper cross-market arbitrage" and "hedging to game fees" | Published | S14 |
| public API documentation | None found. The help center has no API article, and a search for "API" returns three listing announcements. Every endpoint in these profiles comes from the website's own bundle, S16 | Not offered | [`fees-probe.py`](../../../scripts/probes/venues/tebbit/fees-probe.py) |
| public data from this exit | Every public market data call on `tebbit.io` answered HTTP 200 with data, and the WebSocket delivered | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |
| website from this exit | `tebbit.io`, `tebbit.vip` and `www.tebbit.vip` answered 200. `www.tebbit.io`, `tebbit.com` and `www.tebbit.com` resolve to the `ha11.shieldedges.com` edge, accept TCP, and never answer the TLS client hello, so the handshake timed out. CoinMarketCap lists `https://tebbit.com/` as the website. | Probed | [`rest.md`](./rest.md) section 1 |

The exit geolocates to Vancouver, Canada.
No published rule bars Canadian users, while the app is not offered in Canada's store.
Reading public market data needed no account and met no challenge.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M linear perpetuals | 0.04 % = 400 ppm | 0.04 % = 400 ppm | Published and Probed | S1, and the catalog's `takerFee` of `0.0004` on 409 of 412 perpetuals |

The engine models a taker cross at the base retail tier, so 400 ppm is the number that matters.
Three contracts differ in the catalog: `xau_usdt` and `paxg_usdt` charge 0.01 % taker, and `blur_usdt` charges 0.05 %, section 4.
CoinMarketCap shows maker 0.04 and taker 0.04 for the venue, S15.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 412 rows with `contractType` PERPETUAL, `underlyingType` U_BASED, `state` 0 and `tradeSwitch` true | Probed, [`rest.md`](./rest.md) section 2 |
| TradFi perpetuals | yes, inside the same family: 173 contracts in the `Stocks` partition and 11 in `Commodities` | Probed, [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | absent, every contract quotes `usdt` | Probed |
| coin-margined perpetuals | absent. The website has a coin-margined path, and `GET /futures/dapi/market/v1/public/symbol/list` returns `"data":[]` | Probed, S16 |
| event contracts | yes, `btcevent_usdt` and `ethevent_usdt`, `contractType` EVENT. The service agreement says they "generally do not charge additional transaction fees, funding fees, forced liquidation fees, or margin call fees". Not detailed. | Probed, S9 |
| dated futures | absent from the catalog | Probed |
| options | absent from the catalog | Probed |
| spot | present, 21 USDT pairs in `GET /pro/p/symbol/list`, all with `takerFee` `0` in the catalog while the spot fee article says "Taker: 0.1% (no fee discount)" and lists 0 per pair. Not detailed. | Probed, S3 |
| copy trading, C2C, deposit and withdrawal | named only. The withdrawal schedule is the help center article "Tebbit Withdrawal Fee Schedule for Different Networks". | help center listing, 2026-10-09 |

## 4. Perpetual tiers

No VIP table is published.
The fee page is a per contract table, "Perpetual Contract Parameters and Fees", updated 2026-10-07, S1, and CoinMarketCap links it as the venue's fee page, S15.
An older table from 2025-09-14 lists 151 contracts, all at 0.0004 for both sides, S2.

| (maker, taker) | contracts in S1 | contracts in the catalog | label |
|---|---|---|---|
| 0.0004, 0.0004 | 392 | 382 | Published and Probed |
| 0, 0.0004 | 17, mostly stock tickers | 27, such as `pltr_usdt`, `nvda_usdt` and `hk1810_usdt` | Published and Probed |
| 0.0001, 0.0001 | 3: `xau`, `PAXG`, `LSK` | 2: `xau_usdt`, `paxg_usdt` | Published and Probed |
| 0.0003, 0.0005 | 1, the row named `meme` | 1, `blur_usdt` | Published and Probed |
| 0.0002, 0.0006 | 2: `uvxy`, `bmnr` | 0 | Published |

S1 has 415 rows, and 24 of them name no live perpetual, such as `iota`, `mkr` and `ip`.
Fifteen rows disagree with the catalog, including ten TradFi contracts, such as `nvda` and `meituan`, that the catalog charges no maker fee, and `lsk`, which the catalog charges 0.0004.
The catalog is what the matching engine reads, so a feed would take each contract's `takerFee` from it.
The account level fee call, `/v1/user/step-rate/getUserStepRate` in the website bundle, needs a login, S16.

## 5. Discounts that change the perpetual taker

| discount | effect | label | evidence |
|---|---|---|---|
| gold contracts | maker and taker "uniformly reduced to as low as 0.01%" on XAU/USDT and PAXG/USDT, from 2026-09-12, with no end date | Published and Probed | S4, catalog |
| TradFi maker | "the limit order (maker) fees for TradFi contract trading pairs will be uniformly adjusted to 0", from 2026-08-12. The taker stays 0.0004. | Published and Probed | S5, catalog |
| token holding, referral, market maker | Not publicly specified | Not publicly specified | help center search, 2026-10-09 |

## 6. Funding as a cost

Tebbit publishes no funding formula, interval, cap or floor.
The only description is generic: "If the contract price deviates from the spot market price, funding fees will cause the market to revert to equilibrium", S8.
The public funding call returned `fundingRate`, `collectionInterval` and `nextCollectionTime` all `null` on 60 of 60 contracts sampled across the catalog, and the funding history call returned no items on 10 of 10, see [`rest.md`](./rest.md) section 3.
A help center search for "funding" returns nothing in English.
A 2025-10-25 notice says accounts exploited a "zero funding fee" system loophole "by shorting certain tokens in bulk during normal settlement cycles", and their assets were frozen, S6.
The gold announcement exempts holders from "two-way holding fees", which reads as a holding charge in place of, or beside, funding, S4.
So whether and how funding is charged is Not publicly specified, and no settlement instant was captured.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation trigger | "Long: Triggered when the mark price falls below the liquidation price", and the mirror for shorts | Published | S10 |
| liquidation fee | the catalog field `liquidationFee`: `0` on 316 perpetuals, `0.0001` on 94, `0.015` on `btc_usdt` and `0.01` on one other. What the field charges is Not publicly specified. | Probed | [`fees-probe.py`](../../../scripts/probes/venues/tebbit/fees-probe.py) |
| settlement and delisting charges | Not publicly specified | Not publicly specified | help center search, 2026-10-09 |

## 8. CCXT

CCXT 4.5.68 has no Tebbit class.
No file named `tebbit.js` exists under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file in that folder contains the string `tebbit`.
On GitHub, `ts/src/tebbit.ts` returns 404 on master at commit `f0aca06` of 2026-10-08, `exchanges.json` on master does not name it, and a code search of `ccxt/ccxt` for `tebbit` returns 0 results.
The website bundle also links `labs.megabit.vip`, and `robots.txt` points to `www.megabit.vip/sitemap.xml`, so the frontend is a reskin of another platform, S16.
The REST paths match XT's futures API with a different prefix, while the WebSocket protocol does not, so CCXT's `xt` class does not fit either, see [`websocket.md`](./websocket.md) section 1.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 400 | S1 and the catalog agree on 0.0004 for 409 of 412 perpetuals |
| `ccxtTakerPpm` | none | no CCXT class, so a catalog would be written by hand from `symbol/list`, whose `takerFee` gives the per contract value |

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [Perpetual Contract Parameters and Fees](https://support.tebbitdocs.com/hc/en-001/articles/43055037110681), updated 2026-10-07 | 2026-10-09 |
| S2 | [Perpetual Contract Parameters & Fees](https://tebbit.zendesk.com/hc/en-001/articles/50639438129689), updated 2025-09-14 | 2026-10-09 |
| S3 | [Spot Trading Fee Explanation](https://tebbit.zendesk.com/hc/en-001/articles/43055264652313), updated 2026-05-21 | 2026-10-09 |
| S4 | [Special Trading Benefits Announcement for Gold Perpetual Contracts](https://tebbit.zendesk.com/hc/en-001/articles/62180329502233), 2026-09-12 | 2026-10-09 |
| S5 | [Announcement on Adjusting TradFi Contract Limit Order Fees to 0](https://tebbit.zendesk.com/hc/en-001/articles/61093150998425), 2026-08-12 | 2026-10-09 |
| S6 | [Announcement on Handling of Violating Accounts by TEBBIT](https://tebbit.zendesk.com/hc/en-001/articles/51841572728601), 2025-10-25 | 2026-10-09 |
| S7 | [Tebbit App Now Live in Multiple Regions on Apple App Store](https://tebbit.zendesk.com/hc/en-001/articles/50631807271321), 2025-09-12 | 2026-10-09 |
| S8 | [About Perpetual Contracts](https://tebbit.zendesk.com/hc/en-001/articles/42597014186393), updated 2026-01-09 | 2026-10-09 |
| S9 | [TEBBIT Event Contract Service Agreement](https://tebbit.zendesk.com/hc/en-001/articles/60855137532569), 2026-08-06 | 2026-10-09 |
| S10 | [Explanation of Maintenance Margin and Forced Liquidation](https://tebbit.zendesk.com/hc/en-001/articles/50654204175001), 2025-09-13 | 2026-10-09 |
| S11 | [official domain warning, zh-cn](https://tebbit.zendesk.com/hc/zh-cn/articles/57290419502361), 2026-04-24 | 2026-10-09 |
| S12 | [Tebbit User Agreement](https://tebbit.zendesk.com/hc/en-001/articles/41977608050201), updated 2026-01-09 | 2026-10-09 |
| S13 | [Tebbit Exchange](https://tebbit.zendesk.com/hc/en-001/articles/42692489331097), updated 2026-01-09 | 2026-10-09 |
| S14 | [Tebbit Announcement on Risk Controls for Abnormal Trading Behavior](https://tebbit.zendesk.com/hc/en-001/articles/41977719930777), updated 2026-01-09 | 2026-10-09 |
| S15 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=tebbit` | 2026-10-09 |
| S16 | website bundle `https://tebbit.io/static/js/main.28a3fab6.chunk.js`, and `https://tebbit.io/robots.txt` | 2026-10-09 |
