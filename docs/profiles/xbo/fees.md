# XBO.com Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:23 to 04:38 UTC, second pass 04:41 to 04:45 UTC), from the development host near Seattle, through its Canadian VPN exit.

XBO.com lists USDT-margined perpetual futures, and this profile covers them.
Every perpetual market data call XBO documents needs an API key, and the public API it offers without one is spot REST only.
So the perpetual numbers below come from XBO's documentation and help pages, and the wire could confirm only the refusals.
No CCXT class exists for XBO.com, see section 8.
Every number below carries a source id from section 10, a probe reference, or a CCXT note.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator named in the terms | CLICKJOINT B.V., incorporated in Curaçao | S6 section 1 |
| registered address | the terms give Emancipatie Boulevard Dominico "Don" Martina 29, Suite 15, Willemstad, and the website footer gives Zuikertuintjeweg Z/N (Zuikertuin Tower), Curaçao | S6 section 1, S4 footer |
| terms version | "Last Updated: 3rd of September 2026." | S6 |
| registrations | Central Bank of Curaçao 164279 for Clickjoint B.V., FINTRAC money services business M22370088 for XBO Trading (Canada) Limited, FSC Mauritius GB24203975 for Xion Investments | S7 |
| country on CoinGecko | Isle of Man, established 2022 | S10 |
| CoinGecko trust rank | 123 in the API reply at 04:29 UTC on 2026-09-23, while the survey list of 2026-09-22 had 119 | S10 |
| 24 h spot volume | 304 BTC on CoinGecko, and USD 38.4 to 38.5 million summed over `last24HTradeVolumeUsd` of XBO's own `/trading-pairs` in two runs | S10, P1 `catalog` |
| products researched | USDT-margined perpetuals, from documentation only | S1, S3, S4 |

Who may trade:

- Terms section 4.6 bars use of the services in any Restricted Jurisdiction and by any Restricted Person, S6.
- Terms section 2.20 defines Restricted Territories as any jurisdiction XBO classifies as restricted at its discretion, any jurisdiction that prohibits the services, and any territory under sanctions of the US, the EU, the UK or the UN, S6.
- The terms publish no list of countries.
- Every product page, including the futures landing page and the futures help page, carries the footer "This information is not intended for distribution to, or use by, residents of certain countries or jurisdictions, including but not limited to the United States, Iran, Russia, and others, as the Company does not offer its services in these jurisdictions.", S3, S4.
- The same footer says "We do not hold a licence nor are registered in the United Kingdom, and do not actively offer services to UK residents.", S3.
- A US person therefore may not trade the perpetuals.
- Which other countries may trade futures is Not publicly specified.
- A natural person must be at least 18 and of age where they reside and where they are a citizen, S6 section 4.1.
- Terms section 3.17 says related parties of the company "may serve as counterparties to users' Trades", and that when the company is the counterparty it keeps the gains, S6.
- The futures catalog documents a `403 Forbidden customer type` answer, "Your account does not support the functionality", so a key alone does not guarantee access to futures market data, S1.

What this host saw, through a Surfshark WireGuard exit that geolocates to Canada and reaches Cloudflare's SEA and YVR edges:

- Every public spot endpoint answered HTTP 200 with data, see [`rest.md`](./rest.md) section 1.
- The futures catalog `GET https://api.xbo.com/v1/futures/trading-pairs` answered HTTP 401 with an empty body, P3.
- The futures socket `wss://api.xbo.com/ws/v1/futures` refused the upgrade with HTTP 401 and an empty body, see [`websocket.md`](./websocket.md) section 1.
- Both refusals are the documented answer to a missing key, S1, and not a geoblock.
- No page or endpoint answered with a regional block.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-margined perpetuals | 0.030 % = 300 ppm | 0.060 % = 600 ppm | S3, "Our trading fees are simple and flat" |
| spot, context only | 0.25 % = 2,500 ppm at the entry loyalty tier, or 0.3 % = 3,000 ppm in a fee article | 0.40 % = 4,000 ppm | S5, S8 |

The futures schedule is one flat rate, so VIP 0 is the only tier.
The spot numbers disagree between the loyalty table and the fee article on the maker side, and both are written.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes | instrument id `BTC-USDT-PERP` and "Bitcoin perpetual futures" in the futures catalog example, S1. The landing page claims "Over 100 assets" and "Up to 125x leverage", S4. The count could not be probed, since the catalog answered 401, P3 |
| USDC-margined perpetuals | Not publicly specified | no USDC example or mention in S1, S3 or S4 |
| coin-margined perpetuals | Not publicly specified | no inverse example or mention in S1, S3 or S4 |
| dated futures | yes | "Expiry Futures" with weekly, monthly and quarterly cycles, S3. Instrument id example `BTC-USDT-260626`, S1 |
| options | no | not named in S1, S3, S4 or S9 |
| spot | yes | 294 pairs, all `isEnabled` true, P1 `catalog` |
| margin | named only | the API hub names "spot, futures, and margin trading", S9, and the token page names "spot, margin & futures markets", S13. No margin API or fee is documented |
| stock and ETF CFDs | yes | "+100 Stocks and ETFs", S12 |

CoinGecko's derivatives exchange list held 214 exchanges on 2026-09-23 and none was XBO, S10.

## 4. Perpetual tiers

XBO publishes no tier table for futures.
The help page gives the flat 0.030 % maker and 0.060 % taker, S3.
The page `https://www.xbo.com/en/fees` answered HTTP 200 with "Something went wrong with this page." and no table, in a plain fetch from this host at 04:25 UTC on 2026-09-23.
The loyalty tiers change spot fees only, and their table lists "Spot Maker/Taker fees" and no futures line, S5, S11.
Futures volume does earn loyalty XP at "7 XP/$100", against "7 XP/$10" for spot, S11.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| XBO token holding | "Reduce your fees on spot, margin & futures markets.", with no rate or threshold | S13 |
| loyalty tiers | spot only: Silver 0.25 % / 0.40 %, Gold 0.23 % / 0.38 %, Platinum 0.21 % / 0.36 %, Diamond 0.18 % / 0.32 % maker and taker, Black Diamond "Revealed privately" | S5 |
| referral | a referral help page exists, and its effect on futures fees was not read | Not verified |
| market maker programme | Not publicly specified | |
| zero fee promotion | none found | |

## 6. Funding as a cost

XBO documents funding only in general terms.

- "Funding Fee : A recurring fee paid between traders in a perpetual futures contract to ensure that the contract price closely tracks the underlying asset's spot price.", S3.
- "The funding fee is determined by the difference between the perpetual contract price and the spot price.", S3.
- "Long positions may pay funding to short positions, or vice versa, depending on market conditions.", S3.
- "Funding fees are typically settled at fixed intervals, often every 8 hours.", S3, which is a generic statement and not XBO's schedule.
- "Funding fees are not applicable for Expiry Futures", S3.
- The formula, the interval per contract, the cap, the floor and the settlement instants are Not publicly specified.
- Neither API reference names a funding rate, a funding history or a next settlement time, S1, S2.

No funding settlement was observed, because no funding number is reachable without a key.

## 7. Liquidation, settlement and delisting

- Liquidation closes positions automatically, "without warning", until the margin covers the rest, and cancels all open orders, S6 section 3.17.
- A liquidation fee is Not publicly specified.
- An expiry future settles at a final price, realises profit and loss, and cancels pending orders, S3.
- Delisting rules for perpetuals are Not publicly specified.
- The unrealised profit formula uses the mark price, "(Mark Price – Entry Price) × Position Size + Trading Fees + Funding Fees", S3.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 `ccxt.exchanges` from `server/` | 104 ids, none contains `xbo`, and the only id with `xb` is `foxbit` | P1 `catalog` |
| `server/node_modules/ccxt/js/src/` | no `xbo*.js` file | directory listing on 2026-09-23 |
| CCXT master `ts/src` | 112 entries, only `foxbit.ts` contains `xb` | S14 at commit `1d8b674`, 2026-09-22 12:48 UTC |
| CCXT master `ts/src/pro` | 78 entries, none contains `xbo` | S14 |
| GitHub issue search `repo:ccxt/ccxt xbo` | 0 results | S14 |

`market.taker` therefore has no value, since no market exists.
The engine's catalog comes from CCXT `loadMarkets`, so XBO would also need a catalog written outside CCXT.

## 9. Recommended registry values

No registry entry is recommended, because the perpetual catalog, book and ticker are closed to an unauthenticated client, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.
If XBO is ever added with a key, `takerPpm` would be 600 from S3.
`ccxtTakerPpm` stays unset, since no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | XBO Client API reference | https://docs.xbo.com/ | 2026-09-22 | XBO, global | futures market data socket, futures catalog, 401 and 403 answers, spot catalog, error shapes, API updates of 02/07/2026, sections 1, 3, 6 |
| S2 | XBO Exchange Public API reference | https://public-docs.xbo.com/ | 2026-09-22 | XBO, global | the unauthenticated spot endpoints, section 6 |
| S3 | Futures trading help centre | https://www.xbo.com/en/support-futures-trading | 2026-09-22 | XBO, global | flat 0.030 % and 0.060 %, funding text, expiry futures, footer, sections 1 to 7 |
| S4 | Crypto futures trading landing page | https://www.xbo.com/en/futures-trading | 2026-09-22 | CLICKJOINT B.V. | "Over 100 assets", "Up to 125x leverage", footer address, sections 1 and 3 |
| S5 | Spot trading page with loyalty tiers | https://www.xbo.com/en/spot-trading | 2026-09-22 | XBO, retail | spot maker and taker per loyalty tier, sections 2 and 5 |
| S6 | XBO Terms of Use, PDF | https://www.xbo.com/files/Terms&Conditions.pdf | 2026-09-22 | CLICKJOINT B.V., Curaçao | entity, eligibility, restricted territories, section 3.17 futures and liquidation, sections 1 and 7 |
| S7 | Licenses and registrations | https://www.xbo.com/en/licenses-and-registrations | 2026-09-22 | XBO group | Curaçao, Canada and Mauritius registrations, section 1 |
| S8 | Crypto exchange fees explained | https://www.xbo.com/en/crypto-exchange/crypto-exchange-fees-explained | 2026-09-22 | XBO | "starting at 0.4% for takers and 0.3% for makers", section 2 |
| S9 | API hub | https://www.xbo.com/en/api-hub | 2026-09-22 | XBO | the three APIs, "spot, futures, and margin trading", section 3 |
| S10 | CoinGecko API `exchanges/xbo_com` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/xbo_com | 2026-09-23 04:29 UTC | CoinGecko | trust rank, volume, country, no derivatives listing, sections 1 and 3 |
| S11 | Loyalty programme help centre | https://www.xbo.com/en/support-loyalty-program | 2026-09-22 | XBO, retail | XP per futures and spot volume, section 4 |
| S12 | CFD landing page | https://www.xbo.com/en/cfd | 2026-09-22 | XBO | stock and ETF CFDs, UK and US footer, section 3 |
| S13 | XBO token page | https://www.xbo.com/en/xbo-token | 2026-09-22 | XBO | token fee discount without a rate, sections 3 and 5 |
| S14 | CCXT GitHub `ts/src`, `ts/src/pro` and issue search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no XBO class on master, section 8 |
| P1 | `rest-probe.mjs catalog`, at 04:30 UTC and again at 04:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xbo/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | spot pair count, volume sum, CCXT ids, sections 1, 3 and 8 |
| P3 | `rest-probe.mjs refused`, at 04:34 UTC and again at 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xbo/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | 401 on the futures catalog, sections 1 and 3 |
