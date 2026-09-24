# OSL Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

OSL Exchange is CoinGecko's single listing for several OSL Group regional sites, and it has no CCXT class.
This profile covers spot trading on OSL HK (OSL Digital Securities Limited), because OSL lists no perpetual that can be traded on 2026-09-22.
The OSL Global perpetual family (OSL Bermuda Limited) is recorded as delisted, with the evidence, and OSL Global spot is named in the coverage matrix.
Deposit, withdrawal, custody and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/osl/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/osl/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| CoinGecko listing | "OSL Exchange", trust score 9, trust score rank 10, 47 pairs, country Hong Kong. Its description calls OSL Exchange "the unified business brand for OSL Group's (HKEX: 863.HK) locally regulated digital asset exchanges" in "Hong Kong, Europe, Indonesia, Japan, and Bermuda" | Published | S15, `rest-probe.mjs main`, tag `coingecko` |
| which site CoinGecko counts | 15 of the 47 tickers are pairs only OSL HK lists, 8 only OSL Global lists, 7 both list, and 17 neither lists (13 IDR pairs plus `BGB/USDT`, `PEPE/USDT`, `USDC/USDT`, `DOGE/USDT`). On the four largest pairs CoinGecko's base volume matched OSL HK's own 24 h base volume and not OSL Global's, for example `BTC/USD` 177.65 against 177.72 BTC on OSL HK and 0.219 BTC on OSL Global in the second `main` run, and 178.80 against 178.43 and 0.218 in the third | Probed | `rest-probe.mjs main`, tag `coingecko` |
| researched venue | OSL HK spot, "Pro Trade", at `trade-hk.osl.com` | | this section |
| legal entity, OSL HK | "OSL Digital Securities Limited, a company incorporated in Hong Kong, licensed with the SFC to carry on Type 1 (dealing in securities) and Type 7 (providing automated trading services) regulated activities, and licensed as a virtual asset service provider", SFC CE number BPJ213, terms v2.4 of May 2026 | Published | S4 |
| restricted locations, OSL HK | "Restricted Jurisdiction means a country or territory that is the target of country-wide or territory-wide Sanctions and such other country or territory in which we may not offer services, as determined by us from time to time." Sanctions include those of the United States, the United Kingdom and the European Union. "If you are not a resident of Hong Kong, or have a relevant connection with another jurisdiction, additional terms and conditions may apply" | Published | S4 |
| who may trade OSL HK spot | A KYC-verified client of OSL Digital Securities Limited. Retail clients may trade 4 tokens and professional investors 25 or more, and the API is "a premium feature available to Corporate, Institutional, Professional Investor (PI), and omnibus clients. General retail users are not eligible for API functionality" | Published | S1, S17 |
| whether US persons may trade OSL HK spot | Not publicly specified. The terms name no country outside sanctions, and leave the rest to OSL's discretion | Not publicly specified | S4 |
| legal entity, OSL Global | "OSL Bermuda Limited is licensed to conduct digital asset business by the Bermuda Monetary Authority." | Published | S10, S11, S12 |
| who may register with OSL Global | A resident of a listed country. The list of 2026-08-21 names no United States, Canada, Hong Kong, mainland China, Singapore, United Kingdom, Japan or European Union member state, and does name Puerto Rico, Guam and the U.S. Virgin Islands | Published | S9 |
| website and docs from this host | Every page in the source ledger answered 200 to `curl` from this host. The docs index `apidocs.bct.host/llms.txt` answered 302 to a Cloudflare Access login, and the token in that redirect carried `real_country` `CA` for this host | Probed | `curl` on 2026-09-22 |
| public API from this host | Every public REST and WebSocket endpoint of OSL HK and OSL Global answered without a challenge or refusal, through Cloudflare colos `SEA` and `YVR`. One v4 socket of 21 opened never completed its handshake | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

Reading public market data is not an account service, and neither site refused it.
Trading is another matter: OSL HK serves only its onboarded clients with the API, and OSL Global's supported list names neither the United States nor Canada.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| OSL HK spot, every non-stablecoin pair | 0.00 % = 0 ppm | 0.05 % = 500 ppm | Published and Probed | S5, the fee page's own config call read `retailMakerFees` `0.00%`, `retailTakerFees` `0.05%`, `tradingMakerFees` `0.00%`, `tradingTakerFees` `0.05%` |
| OSL HK spot, stablecoin pairs | 0 % | 0 % | Published, professional investors only | S6, and the fee config names `USDT/USD`, `USDT/HKD`, `USDGO/USD`, `USDGO/USDC`, `USDGO/USDT`, `RLUSD/HKD` |
| OSL HK, the catalog's own fields | `makerFeeRate` `"0"` on 22 of 22 published pairs | `takerFeeRate` `"0.0005"` on 15, `"0"` on 7 | Probed | `rest-probe.mjs main`, tag `hk_v5_symbols`, see section 4 |
| OSL Global spot, the catalog's own fields | `makerFeeRate` `"0.001"` on 39 of 43 online pairs | `takerFeeRate` `"0.002"` on 36 of 43 | Probed, the rendered fee page shows "No Data" without a browser | `rest-probe.mjs global`, tag `glb_spot_symbols`, S8 |
| OSL Global USDC-margined perpetuals | Not publicly specified | Not publicly specified | Delisted, see section 3 | S13 says rates "are displayed on the platform", and `commissionRate` needs a key |

The engine models a taker cross, so 500 ppm is the OSL HK number that matters for any pair that is not a stablecoin pair.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| OSL HK spot | yes, researched | 22 published of 45 rows: 9 USD, 9 HKD, 2 USDT, 1 USDC, 1 USDGO quoted | Probed, `/api/v5/symbols`, see [`rest.md`](./rest.md) section 2 |
| OSL HK perpetuals, futures or options | Not offered | 0 | S1: "OSL's exchange provides institutional-grade access to spot markets", and the HK API reference has no derivatives call |
| OSL Global USDC-margined perpetuals | listed but not tradable | 25 rows, 24 with `allowTrade` 0, 0 with a live book | Probed, `/openapi/v1/symbols`, `/openapi/v1/depth`, see below |
| OSL Global spot | yes, not detailed | 43 online of 44 rows, 13 with a ticker. Ten of those 13 stop on 2026-09-29 | Probed, `/openapi/v1/spot/public/symbols` and `/tickers`, S12 |
| OSL Indonesia spot (IDR pairs on CoinGecko) | yes on CoinGecko, not researched | 13 IDR tickers | Probed, tag `coingecko`. The osl.com footer links API documentation for "Institutional", "Global Exchange" and "BizPay" only |
| dated futures | Not offered | 0 found on either site | S1, S14 |
| CoinGecko derivatives list | absent | 0 of 214 derivatives venues match `osl` | Probed, `rest-probe.mjs global`, tag `coingecko_derivatives` |

OSL Global launched USDC-margined perpetuals named `BTC-PERP` and so on, the first opening on 2025-12-24 per the catalog's `openTime`.
S10 delisted twenty-one of them: `1000SHIB`, `AAVE`, `ADA`, `AVAX`, `BGB`, `DOT`, `SUI`, `TAO`, `TRX` and `ZEC` on 2026-07-06 at 17:00 UTC+8, and `1000PEPE`, `ASTER`, `BNB`, `DOGE`, `ETH`, `HYPE`, `LINK`, `SOL`, `UNI`, `XAUT` and `XRP` on 2026-07-13 at 17:00 UTC+8.
S11 delisted `BTC-PERP` on 2026-09-16 at 17:00 UTC+8, with new positions closed from 2026-09-14.
The API still lists 25 contract rows on 2026-09-22.
`BTCUSDC` returns an empty book stamped 2026-09-16 09:19:57 UTC.
The 21 July delistings return frozen books stamped on their delisting day, 2026-07-06 09:12 to 09:20 UTC and 2026-07-13 10:38 to 10:39 UTC.
`TONUSDC`, which neither perpetual delisting notice names, returns an empty book stamped 2026-06-22 08:47 UTC, and `SHIBUSDC` and `PEPEUSDC` return no book at all.
`SHIBUSDC` is the only row with `allowTrade` 1, and it has no last price and no book.
So OSL has no perpetual that can be traded, and the rest of this profile is about OSL HK spot.

Deposit, withdrawal and custody fees are looked up on `https://trade-hk.osl.com/pages/fees` for OSL HK (S4 clause 9.1) and on `https://www.osl.com/en/fees` for OSL Global (S8).

## 4. Spot tiers

OSL HK publishes no volume tier table.
The fee config behind the fee page has one retail pair of rates and one "trading" pair of rates, and both read 0.00 % maker and 0.05 % taker (S5).
The VIP programme article of 2026-04-03 says "OSL VIP features a core spot trading fee schedule of 0% Maker and 0.05% Taker" and names tiers such as "OSL VIP 3" without a table (S7).
Its only tier row is "OSL VIP, Standard Tier, 0.00 %, 0.05 %".
So the published schedule is flat at 0 ppm maker and 500 ppm taker, and any lower taker is Not publicly specified.

| source | maker | taker | label |
|---|---|---|---|
| fee config, `retailMakerFees` and `retailTakerFees` | 0.00 % | 0.05 % | Probed, S5 |
| fee config, `tradingMakerFees` and `tradingTakerFees` | 0.00 % | 0.05 %, "0% Fee" on six stablecoin pairs | Probed, S5 |
| `/api/v5/symbols`, 15 non-stablecoin pairs | `"0"` | `"0.0005"` | Probed |
| `/api/v5/symbols`, `USDTUSD`, `USDTHKD`, `RLUSDHKD`, `USDGOHKD`, `USDGOUSD`, `USDGOUSDC`, `USDGOUSDT` | `"0"` | `"0"` | Probed |
| VIP programme article | 0 % | 0.05 % | Published, S7 |

The catalog shows seven zero-taker pairs where the fee page names six, and the extra one is `USDGOHKD`.
S6 says "Any stablecoin pairs added in the future will be automatically included", which fits a pair added after 2026-06-11.
The catalog field is described as "Default taker fee rate" (S3), so it is a default and not a per-client rate.

## 5. Discounts that change the spot taker

| discount | what it does | label | evidence |
|---|---|---|---|
| stablecoin zero fee | 0 % maker and taker on stablecoin pairs from 2026-06-11 08:00 UTC+8, for "All KYC-verified OSL HK professional investor accounts", no end date | Published, account-gated | S6 |
| VIP migration | "an automatic one-level elevation (+1 Level)" and "up to three months" of VIP status for clients moving from another venue | Account-gated | S7 |
| maker rate | already 0 % at the base rate | Published | S5 |
| token holding, referral | none found | Not publicly specified | |

## 6. Funding as a cost

OSL HK spot has no funding.
For the record, OSL Global's perpetual rules charged funding "every 8 hours at 00:00, 08:00, and 16:00 UTC", with "Funding Fee = Notional Value of Held Contracts × Funding Rate" and the notional valued at the mark price (S13).
The residual `!markPrice@arr` stream still publishes `fundingRate` `"0.0001"` for `BTCUSDC` and `SHIBUSDC` on 2026-09-22, see [`websocket.md`](./websocket.md) section 9.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| OSL HK liquidation | none found, the exchange lists spot only | Not offered | S1 |
| OSL HK delisting charge | Not publicly specified | Not publicly specified | |
| OSL Global perpetual delisting | "All open positions for these perpetual futures contracts will be automatically liquidated. The closing price will be determined based on the prevailing market price at the time of delisting." | Published | S10, S11 |
| OSL Global perpetual liquidation fee | "Fee rates depend on the underlying asset and position value and are published on the platform in real time" | Not publicly specified as a number | S13 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version installed | 4.5.68, 104 exchange ids | Probed, `rest-probe.mjs main`, tag `ccxt` |
| an OSL class in 4.5.68 | none, no id matches `osl`, and no file under `server/node_modules/ccxt/js/src/` is named for OSL | Probed, and `ls server/node_modules/ccxt/js/src/` |
| an OSL class in CCXT master | none. `exchanges.json` on master lists 105 ids and none matches `osl`, and `ts/src` at commit `1d8b674` of 2026-09-22 12:48 UTC has no OSL file | S16 |
| an OSL pull request | [ccxt/ccxt#14820](https://github.com/ccxt/ccxt/pull/14820), "Implement balances, markets, and orderbook for OSL", open since 2022-08-29, not merged, one file `js/osl.js` | S16 |
| `market.taker` | none, since there is no class | |

## 9. Recommended registry values

None today, because OSL lists no perpetual that can be traded and has no CCXT catalog.

If a later design adds spot legs, the OSL HK entry would read as follows, and it would need a catalog that does not come from CCXT.

```ts
osl: {
  takerPpm: 500,
  // No CCXT class exists for OSL in 4.5.68 or on master, so there is no CCXT constant to declare. The rate is the fee page's 0.05 % taker.
}
```

`takerPpm: 500` is the published taker for every non-stablecoin pair and matches the catalog's `takerFeeRate` field.
A stablecoin pair would need its own 0 ppm, which the registry cannot express per market today, and the engine does not trade stablecoin pairs.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | OSL API Introduction, updated 2026-06-15 | https://osl.com/reference/introduction.md | 2026-09-22 | OSL HK | spot only exchange, API eligibility, sections 1 and 3 |
| S2 | API Summary | https://osl.com/reference/api-summary.md | 2026-09-22 | OSL HK | REST, WebSocket and FIX availability, HK site, section 1 |
| S3 | Query Trading Pair Configuration, `/api/v5/symbols`, updated 2026-08-18 | https://osl.com/reference/get_api-v5-symbols.md | 2026-09-22 | OSL HK | `takerFeeRate` "Default taker fee rate", section 4 |
| S4 | OSL Digital Securities Limited Client Terms and Conditions, version 2.4, May 2026 | https://static.osl.com/promotion/docs/OSLDS+Terms+and+Conditions-v.2.4+May+2026+(Final).docx.pdf | 2026-09-22 | OSL Digital Securities Limited, Hong Kong | entity, licences, Restricted Jurisdiction, non-resident clause, clause 9.1 fee page, section 1 |
| S5 | OSL HK fee page and its config call | https://trade-hk.osl.com/pages/fees/retail?locale=en_US and https://trade-hk.osl.com/v1/user/pub/config/web/exchange/fee | 2026-09-22 | OSL HK | maker and taker, sections 2 and 4 |
| S6 | Update on Stablecoin Trading Fees for OSL HK, 2026-06-12 | https://www.osl.com/hk-en/announcement/update-on-stablecoin-trading-fees-for-osl-hk | 2026-09-22 | OSL Digital Securities Limited | zero fee pairs, eligibility, sections 2 and 5 |
| S7 | Hong Kong's Lowest Crypto Trading Fees: Why Pro Traders are Migrating to OSL VIP for 0% Maker Fees?, 2026-04-03 | https://www.osl.com/hk-en/bits/article/hong-kong-lowest-crypto-trading-fees-osl-vip | 2026-09-22 | OSL HK | VIP rates and migration, sections 4 and 5 |
| S8 | OSL Fees, OSL Global site | https://www.osl.com/en/fees | 2026-09-22 | OSL Global | the fee tables render "No Data" without a browser, sections 2 and 3 |
| S9 | Which countries and regions does OSL Global support for account registration?, 2026-08-21 | https://www.osl.com/en/support/which-countries-and-regions-does-osl-global-support-for-account-registration | 2026-09-22 | OSL Global | supported countries, section 1 |
| S10 | OSL Global to Delist Selected Perpetual Futures, 2026-06-19 | https://www.osl.com/en/announcement/osl-global-to-delist-selected-perpetual-futures | 2026-09-22 | OSL Bermuda Limited | twenty-one perpetual delistings, entity, sections 1, 3 and 7 |
| S11 | OSL Global to Delist BTC Perpetual Futures, 2026-09-09 | https://www.osl.com/en/announcement/osl-global-to-delist-btc-perpetual-futures | 2026-09-22 | OSL Bermuda Limited | `BTC-PERP` delisting, sections 3 and 7 |
| S12 | OSL Global to Delist Selected Trading Pairs on Pro Trade, 2026-09-21 | https://www.osl.com/en/announcement/osl-global-to-delist-selected-trading-pairs-on-pro-trade5 | 2026-09-22 | OSL Bermuda Limited | ten Global spot pairs stop on 2026-09-29, section 3 |
| S13 | Futures trading rules, 2025-12-30 | https://www.osl.com/en/support/futures-trading-rules | 2026-09-22 | OSL Global | funding, liquidation fee, sections 2, 6 and 7 |
| S14 | OSL Global API Introduction, updated 2026-05-06 | https://docs.glb.osl.com/reference/overview-osl-global-api.md | 2026-09-22 | OSL Global | spot and futures API scopes, section 3 |
| S15 | CoinGecko exchange record `osl-exchange` | https://api.coingecko.com/api/v3/exchanges/osl-exchange | 2026-09-22 | CoinGecko | listing, trust rank, description, section 1 |
| S16 | CCXT master `exchanges.json`, the `ts/src` listing, and pull request 14820 | https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json and https://github.com/ccxt/ccxt/pull/14820 | 2026-09-22 | CCXT | no OSL class, section 8 |
| S17 | OSL Professional Investor page | https://www.osl.com/hk-en/pi | 2026-09-22 | OSL HK | retail sees 4 tokens and PI 25 or more, section 1 |
| P1 | `rest-probe.mjs main`, `poll` and `global`, 21:41 to 21:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/osl/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 4 and 8 |
