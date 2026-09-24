# Websea Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:10 and 20:52 local time, which is 2026-09-23 03:10 to 03:52 UTC.

This profile covers the fees of the Websea USDT-margined perpetuals, the only perpetual family the venue lists.
Websea has no CCXT class, in 4.5.68 or in the current CCXT source, see section 8.
The published futures fee schedule is an image in a help center article, S1, and it was read from the image itself.
The help center is a Zendesk site, and its articles were read through the public Zendesk help center API, which serves the same article bodies.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | |
| legal entity | The Service Agreement names no company. It is "between you and the following service providers … depending on your residency and date of registration", and the only provider listed is "Websea, for all other Users eligible to access and use Websea's Services." | S3 |
| governing law and forum | laws of England and Wales, clause 19.1, mediation then arbitration seated in Hong Kong, clauses 20.1 to 20.3 | S3 |
| regulators named in the terms | "any relevant laws of the Seychelles, the Bahamas", clause 13.2, and "Competent Authority … whether in Bahamas or the Seychelles" in the definitions | S3 |
| other registrations claimed | an ASIC business name "WEBSEA GLOBAL", and a FinCEN MSB and a FINTRAC MSB registration, claimed in an announcement and not checked against the registers | S4 |
| country on CoinGecko | British Virgin Islands, established 2023, trust score 7, trust rank 53 | S13 |
| restricted locations | Hong Kong for retail derivatives, Cuba, Iran, North Korea, Crimea, Malaysia, Singapore, Syria, the United States of America with Puerto Rico, American Samoa, Guam, the Northern Mariana Islands and the US Virgin Islands, the Bahamas, Canada for Ontario and Quebec, the United Kingdom for retail derivatives, Bangladesh, Bolivia, Donetsk, Luhansk and Malta, clause 2.2 | S3 |
| may US persons trade the perpetuals | No. The United States and its territories are Restricted Locations, clause 2.2 | S3 |
| who may trade the perpetuals | users of 18 or more who are not in a Restricted Location and not on a sanctions list, clause 2.1 and 2.2 | S3 |
| withdrawals | suspended in April 2026, then reopened in rounds with a quota, from the second round "10% of each user's account assets at the time of the snapshot" per round. The fourth round was announced on 2026-08-18 with the rules unchanged, and "we also expect to fully open withdrawals in the near future". No full reopening was found in the help center on 2026-09-22 | S8 |
| public API from this host | every public REST and WebSocket endpoint in this profile answered from this host, with no geoblock and no refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | P1, P3 |

The withdrawal quota matters for any future execution stage, because profit made on Websea could not be moved off the venue freely on the day of retrieval.
The April notice attributes the suspension to "high-yield product obligations" and losses in the GameFi segment, S8.
A separate notice says an AWS network failure caused "abnormal activity in certain Websea Futures trading pairs" from 20:28 to 21:58 UTC on 2026-05-16, and that positions and fills of that window were rolled back, S11.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-margined perpetuals | 0.035 %, 350 ppm | 0.06 %, 600 ppm | S1 |

S1 publishes one table for all futures, and no separate schedule was found for the 85 TradFi and 6 CFD perpetuals among the 246, see [`rest.md`](./rest.md) section 2.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | source |
|---|---|---|---|
| USDT-margined perpetuals | yes | 246, every one `contract_type` `future`, and the documentation says "future indicates a perpetual contract" | P1, S12 |
| USDC-margined perpetuals | no | 0, every row of `/v1/futures/symbols` has `quote_currency` `USDT` | P1 |
| coin-margined perpetuals | no | 0 | P1 |
| dated futures | no | none in the API or the web app | P1 |
| options | no | none in the API or the web app | P1 |
| spot | yes | 106 pairs, all quoted in USDT, maker 0.2 % and taker 0.2 % | P1, S2 |

CoinGecko's derivatives exchange list of 2026-09-22 has 214 entries and none is Websea, S13.
CoinGecko lists Websea as a spot venue with 105 pairs and 17,079 BTC of 24 h volume.
The perpetuals exist anyway, and the help center announced ten new ones between 2026-09-14 and 2026-09-21.

## 4. Perpetual tiers

From the image in S1, attachment 9445434171023, last updated 2024-08-22 and shown in the article, which was updated 2026-07-21.

| level | 30 day futures volume, USDT | hold WBS | maker | taker | taker ppm |
|---|---:|---:|---:|---:|---:|
| VIP 0 | 0 | 0 | 0.035 % | 0.06 % | 600 |
| VIP 1 | 10,000,000 | 10,000 | 0.03 % | 0.055 % | 550 |
| VIP 2 | 20,000,000 | 25,000 | 0.025 % | 0.05 % | 500 |
| VIP 3 | 35,000,000 | 40,000 | 0.02 % | 0.045 % | 450 |
| VIP 4 | 80,000,000 | 70,000 | 0.015 % | 0.04 % | 400 |
| VIP 5 | 200,000,000 | 100,000 | 0.01 % | 0.035 % | 350 |
| VIP 6 | 600,000,000 | 150,000 | 0.008 % | 0.03 % | 300 |
| VIP 7 | 2,000,000,000 | 220,000 | 0.006 % | 0.025 % | 250 |
| VIP 8 | 6,000,000,000 | 500,000 | 0.004 % | 0.02 % | 200 |
| VIP 9 | 20,000,000,000 | 800,000 | 0.002 % | 0.01 % | 100 |
| VIP 10 | 80,000,000,000 | 2,000,000 | 0.001 % | 0.005 % | 50 |

### Qualification

The table is titled "Upgrade Plan" and has one column for 30 day futures volume and one for WBS held.
Whether a level needs both, or either one, is Not publicly specified.
The fee page of the web app, `/en/vipLevel`, loads its rates from a call that answers `401` "User information is not obtained" without a login, so it could not be read, P1.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| WBS holding | a qualification column of the tier table, section 4 | S1 |
| referral and affiliate | a "Trading Fee Rebate" exists and its withdrawal rules changed on 2026-07-22, the rebate rate is not published in the articles read | help center search, "Notice on Adjustments to Websea Trading Fee Rebate Withdrawal Rules" |
| market maker | Not publicly specified | |
| zero fee promotions | none found for perpetuals | |

The symbol detail stream shows `"serviceRate":"Maker:100%/Taker:100%"` to an anonymous socket, and `/v1/futures/symbols` returns `maker_fee` 1 and `taker_fee` 1 on all 246 contracts, P1 and P3.
Both read as a multiplier of 100 % on the scheduled rate, which is an inference.
The OpenAPI page describes `taker_fee` as "Taker fee rate (range: 0–1, e.g. 0.01 = 1%)", S12, so a literal reading of the field gives a taker of 100 %, and a poller must not read it.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "Funding Rate = clamp [Average Premium Index + clamp (Interest Rate – Average Premium Index, 0.05%, -0.05%), Upper Limit, Lower Limit]" | S5 |
| interest rate | "0.03% / (24 / Funding Interval)", 0.01 % for an 8 h contract | S5 |
| premium index | from a depth weighted bid and ask against the index, where the depth weighted notional is 200 times the contract's maximum leverage | S5 |
| averaging | time weighted over the per minute premium readings of the interval, weights 1 to n | S5 |
| interval | 8 h by default at 00:00, 08:00 and 16:00 UTC, 4 h for some contracts, and hourly after a settlement that hit the cap, which never reverts | S5, S6 |
| intervals on the wire | 135 contracts had their next settlement at 07:59:59 UTC and 111 at 03:59:59 UTC in the probes at 03:28 and 03:45 UTC, and the three of the 111 that were read had a `feeCycle` of 4 h | P2 |
| cap | per contract. `capitalRateMin` and `capitalRateMax` read `-2` and `2` percent on BTC and ETH and `-3` and `3` on LAPTOP. The new listings of September announce "+3.00% / -3.00%". The announcement S6 uses "+0.3 % / –0.3 %" as its BTC example, which disagrees with the 2 % on the wire | P2, S6, S9 |
| settled history | the last 50 BTC settlements were 8 h apart, and 22 of them read `-0.0100` percent | P2 |
| rate used at settlement | "the funding rate calculated at 15:59" for the 16:00 settlement, and the history rows carry a `snapshotTime` exactly 60 s before `settleTime` | S5, P2 |
| who pays whom | positive rate, longs pay shorts, and negative, shorts pay longs | S5 |
| mechanics | "The platform collects the funding fees in full" and then "distributes the full amount to eligible users pro-rata according to their position size". "The platform does not charge any fees for funding payments." | S5 |
| who is charged | holders of a position at the funding timestamp, and a position opened within the settlement minute may still pay | S5 |

The settlement instant itself was not captured, and the numbers above come from the history call and the documentation.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | margin ratio of 100 % or more, warning at 90 % | S7 |
| liquidation fee | "a liquidation fee is charged and transferred to the Insurance Fund", with no rate published. The web symbol detail, read once with curl, carries `"liquidationRate":"1.25%"` for BTC, whose meaning is not documented | S7 |
| delisting | open orders are cancelled when trading stops, and open positions left open are settled by the platform, with no settlement price rule published | S10 |
| trade reversal | Websea "may, at its sole discretion, reverse a Trade under certain extraordinary conditions", clause 5.7 (b) of the terms, and rolled back positions and fills of 2026-05-16 | S3, S11 |

## 8. CCXT

| check | result | source |
|---|---|---|
| `require('ccxt').exchanges` in `server/`, version 4.5.68 | 104 exchanges, none named `websea` and none matching `sea` | S14 |
| current CCXT source, `ts/src` on the `master` branch | 112 entries at commit `1d8b674`, 2026-09-22 12:48 UTC, and none for Websea | S14 |

No CCXT class exists, so there is no `market.taker` to report and no source line to cite.
The engine builds its catalog from CCXT `loadMarkets`, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) line 68, so Websea needs a catalog path that does not go through CCXT before any fee value matters.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 perpetual taker of S1 |
| `ccxtTakerPpm` | unset | no CCXT class exists |

These are recommendations for a later design, not decisions.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Futures fee, article updated 2026-07-21, table image 9445434171023 | https://webseahelp.zendesk.com/hc/en-us/articles/7128392889999-Futures-fee | 2026-09-22 | Websea, global | sections 2, 4, 5 |
| S2 | Spot fee | https://webseahelp.zendesk.com/hc/en-us/articles/7128375627791-Spot-fee | 2026-09-22 | Websea, global | section 3 |
| S3 | Websea Service Agreement, updated 2026-08-02 | https://webseahelp.zendesk.com/hc/en-us/articles/7064836323983-Websea-Service-Agreement | 2026-09-22 | Websea, global | sections 1, 7 |
| S4 | ASIC Authorizes "WEBSEA GLOBAL" to Conduct Business in Australia | https://webseahelp.zendesk.com/hc/en-us/articles/13188158806543 | 2026-09-22 | Websea, Australia, US, Canada | section 1 |
| S5 | Funding Rate Mechanism, updated 2026-04-03 | https://webseahelp.zendesk.com/hc/en-us/articles/9168254698895-Funding-Rate-Mechanism | 2026-09-22 | Websea, global | section 6 |
| S6 | Important Update on Funding Rate Settlement Frequency for USDT-Margined Perpetual Contracts | https://webseahelp.zendesk.com/hc/en-us/articles/13226515985807 | 2026-09-22 | Websea, global | section 6 |
| S7 | Liquidation Mechanism | https://webseahelp.zendesk.com/hc/en-us/articles/7162449318927-Liquidation-Mechanism | 2026-09-22 | Websea, global | section 7 |
| S8 | Notice on Websea Withdrawal Services and Recovery Progress, 2026-04-30. Announcement on Websea's Second-Round Withdrawal Arrangements, 2026-06-18. Explanation of Websea's Fourth-Round Withdrawal Arrangements, 2026-08-18 | https://webseahelp.zendesk.com/hc/en-us/articles/15972013950863, https://webseahelp.zendesk.com/hc/en-us/articles/16522446947855, https://webseahelp.zendesk.com/hc/en-us/articles/17264546628239 | 2026-09-22 | Websea, global | section 1 |
| S9 | Websea Will Launch GSTOCKBSC/USDT 1–50x USDT-M Perpetual Contract in the Trending Watchlist, 2026-09-21 | https://webseahelp.zendesk.com/hc/en-us/articles/17695274072207 | 2026-09-22 | Websea, global | section 6 |
| S10 | Websea will Delist USDⓈ-M HUSDT Perpetual Contract, 2026-06-09 | https://webseahelp.zendesk.com/hc/en-us/articles/16419825657999 | 2026-09-22 | Websea, global | section 7 |
| S11 | Notice on Abnormal Activity in Certain Websea Futures Trading Pairs and Handling Plan, 2026-05-17 | https://webseahelp.zendesk.com/hc/en-us/articles/16145338547471 | 2026-09-22 | Websea, global | sections 1, 7 |
| S12 | Websea Open Interface, futures market pages, v2.3.0 of 2026-08-04 | https://webseaex.github.io/en/futures-market/futures/ | 2026-09-22 | Websea, global | sections 3, 5 |
| S13 | CoinGecko API, `exchanges/websea` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/websea | 2026-09-22 | CoinGecko | sections 1, 3 |
| S14 | CCXT 4.5.68 in `server/node_modules`, and the GitHub contents listing of `ts/src` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | section 8 |
| P1 | `rest-probe.mjs catalog`, `latency` and `errors`, runs at 03:24 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/websea/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 3, 4, 5 |
| P2 | `rest-probe.mjs funding` and `anchor`, runs at 03:25 to 03:29 and 03:43 to 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/websea/rest-probe.mjs) | 2026-09-22 | this host | sections 6, 7 |
| P3 | `ws-probe.mjs mark` | [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
