# EarnBIT Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:20 to 05:04 UTC on 2026-09-23, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare `loc=CA`, edges `SEA` and `YVR`).

This profile covers the fees of EarnBIT, which has no CCXT class, on its spot market.
EarnBIT lists no perpetual, dated future, option or margin market, so the survey plan's template change 1 applies and the spot market is researched instead, see section 3.
Its documentation publishes no trading fee schedule at all, so the only fee numbers below are third-party or indirect, and each is labelled as such.
Probe references are to [`rest-probe.mjs`](../../../scripts/probes/venues/earnbit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs), and the run times are in section 10.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | the Terms of Use are "an electronic agreement between you (hereinafter the "User") and the companies managing the platform Earnbit.com – Earnbit LLC and affiliates" | S6 |
| legal entity | "Earnbit LLC registered in Saint Vincent and Grenadines, registration number 2180LLC2022, located at First Floor, First St Vincent Bank Ltd Building, James Street Kingstown VC0100", from the AML policy | S6 |
| country on CoinGecko | Lithuania, established 2022, with the address "Republic of Lithuania, Vilnius, Eišiškių Sodų 18-oji g. 11" on the exchange page | S8, S9 |
| terms version | "Last updated: July 4th 2022." | S6 |
| regulator or licence | none named, beyond the AML policy being "regulated by acts and regulations of Financial Intelligence Unit of Saint Vincent and the Grenadines" | S6 |
| excluded regions | Not publicly specified for spot trading. The Terms of Use name no country, and ask the user to follow "the rules and laws in his/her country of residence and/or country from which he/she accesses this Site and Services" | S6 |
| registration check | the sign-up form asks the user to confirm "I hereby confirm that l am neither a citizen nor a resident of the following countries:", and the list is loaded at run time from the web app's backend, which never answered this host, see [`rest.md`](./rest.md) section 1 | S6, P1 |
| US persons | not excluded by name for spot trading. The Launchpad form requires "I am not a citizen/natural or a resident of the USA, a person or legal entity under the U.S. jurisdiction.", and the airdrop terms list the United States among their prohibited jurisdictions | S6 |
| KYC | "Depending on your verification level, KYC may be required to access specific products and services." | S3 |
| age | "is at least 18 years old" | S6 |
| public API from this host | every public REST call answered in its documented shape, with 200, 400 or 404, and every WebSocket handshake answered 101, through Cloudflare edges `SEA` and `YVR`, with no geoblock | P1, P2 |

Who may open an account is therefore decided at registration against a list this host could not read.
The access results above are from a Canadian VPN exit, and a US or other exit was not tried.

## 2. Quick answer

| product | maker | taker | evidence |
|---|---|---|---|
| spot, base tier | Not publicly specified | 0.2 %, 2,000 ppm, unverified | CoinGecko shows one "Fees" value of "0.2%" with no maker and taker split, S8. The affiliate calculator on the site says "all calculations are based on the assumption that trading fees are 0.2%", S6 |

The EarnBIT help center has a "Trading Fees" page under "Spot Trading" whose body is only its heading, S5.
The public fee schedule page at `https://earnbit.com/fees` has two tabs, "Deposit/Withdrawal" and "P2P", and no trading fee tab, S6.
The web app reads the user's fee from a logged in call (`setFeeSettings` with `fee`, `fee_plc` and `fee_plc_buy`), so the base rate is not in any public reply, S6.
So 2,000 ppm is the best available reading of the spot taker and not a verified schedule.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | the help center section is "Futures Trading (Coming Soon)", and its four pages, "Futures Overview", "Order Types", "Trading Fees" and "Risk Management", hold only their headings, S4. Six candidate futures paths on the public API answered 404 `Cannot GET`, and `ws-futures.earnbit.com`, `futures.earnbit.com` and `api-futures.earnbit.com` do not resolve, P1 |
| coin-margined perpetuals | absent | as above |
| USDC-margined perpetuals | absent | as above |
| dated futures | absent | as above |
| options | absent | no page, route or market names one, S1, S6 |
| margin | absent | the site state carries `MARGIN_LIST:[]` and market tabs `Spot` and `Defi` only, S7. CoinGecko's exchange page says "Margin Trading" "Yes", S8, which the site does not bear out |
| spot | present | 26 markets, 24 quoted in USDT and 2 in BTC, see [`rest.md`](./rest.md) section 2 |
| Web3 terminal | present, out of scope | `https://web3.earnbit.com/`, a DEX front end, S3 |

The web bundle carries notification types `FUTURES_TRANSFER` and `FUTURES_LIQUIDATION` and referral labels "Futures Commission", S6.
Those strings are shared code of the platform EarnBIT runs on, which PointPay also runs, see section 8, and no EarnBIT futures market is live.
CoinGecko's derivatives list does not show EarnBIT either.

## 4. Spot tiers

No spot tier table is published, S1, S3, S5.
The web app does model user levels, each with `volumeFrom`, `volumeTo`, `tradePercentTaker`, `tradePercentMaker`, `tradeCoreTokenPercentTaker` and `tradeCoreTokenPercentMaker`, S6.
Their values come from a logged in call and were not read.
The Reward Hub text says a fee discount voucher "applies to Maker and Taker fees for non-VIP users", so VIP levels exist, S6.
Their qualification rule is Not publicly specified.

## 5. Discounts that change the spot taker

| discount | rule | size | source |
|---|---|---|---|
| paying fees in EBT | "When paying trading fees with EBT tokens, you get a discount on fees. The discount is applied to both taker and maker fees." | Not publicly specified, it is the `tradeCoreTokenPercent*` field of the user's level | S6 |
| Reward Hub fee discount voucher | "The fee discount offers reductions on trading fees and applies to Maker and Taker fees for non-VIP users." | per voucher, Not publicly specified | S6 |
| referral | a referrer earns a share of the referee's trading fees, and a default link can share part of it back, "Invite The percentage of referral trading fees that are shared back with the referrals" | per link | S6 |
| affiliate | "Earn up to {percent} of trading fees when you bring new users to EarnBIT." | the percent is filled at run time | S6 |
| zero fee promotion | none found | | S3, S6 |

Every resting order in every public book carried `takerFee` and `makerFee` of `"0"`: 5,200, 5,200, 5,194 and 5,200 of as many orders over 26 markets and both sides, in four runs, P1.
Each side held 98 to 100 orders in those scans, so every visible order belongs to a market maker account that trades at zero fee, see [`rest.md`](./rest.md) section 5.
That tells nothing about the retail rate.

## 6. Funding as a cost

None.
EarnBIT lists no perpetual, so there is no funding rate, interval, cap or settlement, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

None apply to spot.
Deposit and withdrawal fees are listed per coin on the "Deposit/Withdrawal" tab of `https://earnbit.com/fees`, which reads them from the web app's backend, S6.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 installed in `server/` | `require('ccxt').exchanges` holds 104 ids and none contains `earn`, in four runs | P1 |
| CCXT master on GitHub | `GET https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master` answered 200 with 112 entries, 105 of them `.ts` files including `whitebit.ts` and `gate.ts`, and no `earnbit.ts` | S10 |

So `market.taker` has no value to report, and no `server/node_modules/ccxt/js/src/<venue>.js` exists for EarnBIT.
The API is the same white-label spot engine that PointPay runs, since one of EarnBIT's own example requests posts to `https://api.pointpay.io/api/v1/public/history/result`, S2, and the web bundle links the "PointPay P2P (peer-to-peer) Terms of Use", S6.
See [`../pointpay/websocket.md`](../pointpay/websocket.md) for that sibling venue.

## 9. Recommended registry values

None.
EarnBIT has no perpetual, so it cannot join the engine as a perpetual leg, and no `VENUE_REGISTRY` entry is recommended.
If a spot leg were ever wanted, `takerPpm` would be 2,000 on the strength of S8 and the calculator assumption in S6, and `ccxtTakerPpm` would have no source, because there is no CCXT class and the catalog would need a custom loader.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | EarnBIT Exchange API Documentation | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation.md | 2026-09-22 | EarnBIT, global | public and private HTTP and WebSocket method lists, sections 3 and 4 |
| S2 | EarnBIT API, Market History Data | https://earnbit.gitbook.io/earnbit/developers/exchange-api-documentation/public-endpoints-or-http/market-history-data.md | 2026-09-22 | EarnBIT, global | the `api.pointpay.io` example request, section 8 |
| S3 | EarnBIT help center index, with the pages "What is EarnBIT" and "KYC Verification" | https://earnbit.gitbook.io/earnbit/llms.txt | 2026-09-22 | EarnBIT, global | KYC wording, product list, sections 1, 3, 4, 5 |
| S4 | Futures Trading (Coming Soon) and its four subpages | https://earnbit.gitbook.io/earnbit/trading/futures-trading-coming-soon.md | 2026-09-22 | EarnBIT, global | no futures product, section 3 |
| S5 | Spot Trading, Trading Fees | https://earnbit.gitbook.io/earnbit/trading/spot-trading/trading-fees.md | 2026-09-22 | EarnBIT, global | the page holds only its heading, sections 2 and 4 |
| S6 | EarnBIT web app bundle: Terms of Use, AML policy, Launchpad and airdrop terms, fee schedule labels, trade form, referral, affiliate and Reward Hub text | https://earnbit.com/_nuxt/d6d52ea.js | 2026-09-22 | Earnbit LLC | sections 1 to 5, 7, 8 |
| S7 | EarnBIT site state for `/terms-of-use` | https://earnbit.com/_nuxt/static/1789490771/terms-of-use/payload.js | 2026-09-22 | EarnBIT | `MARGIN_LIST`, market tabs, section 3 |
| S8 | CoinGecko, EarnBIT exchange page | https://www.coingecko.com/en/exchanges/earnbit | 2026-09-22 | third party | "Fees" "0.2%", "Margin Trading" "Yes", Vilnius address, sections 1 to 3 |
| S9 | CoinGecko API, exchange record, read by P1 | https://api.coingecko.com/api/v3/exchanges/earnbit | 2026-09-22 | third party | Lithuania, 2022, trust score 5, trust rank 118, 24 coins, 26 pairs, section 1 |
| S10 | CCXT master source listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no EarnBIT class, section 8 |
| P1 | `rest-probe.mjs main`, four runs at 04:34, 04:47, 04:53 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/earnbit/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | CCXT check, DNS, catalog, futures paths, fee scan, sections 1, 3, 5, 8 |
| P2 | `ws-probe.mjs` modes `book`, `batch`, `session`, `deflate` and `errors`, 04:37 to 05:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/earnbit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | WebSocket access, section 1 |
