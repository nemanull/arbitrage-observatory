# CoinUp.io Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:03 to 04:22 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, edge `SEA` and `YVR`), see [`rest.md`](./rest.md) section 1.

This profile covers the USDT-margined perpetuals of CoinUp.io, the only perpetual family CoinGecko lists for the venue.
CoinUp's own website, fee page, user agreement and API documentation answered this host with a Cloudflare challenge, HTTP 403, on every request, see [`rest.md`](./rest.md) section 1.
The fee numbers below therefore come from the venue's Zendesk help center, read through the public Zendesk API at `helpcenter-coinup.zendesk.com`, and from archived pages of the venue's 2024 contract guide.
Where a number could not be read from the venue itself, the profile says so.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | CoinUp.io, futures site `futures.coinup.io`, founded 2021 | S10 |
| country CoinGecko lists | Singapore | S10, S11 |
| CoinGecko trust rank | 144 in the survey's list, 150 in the `exchanges/coinup` API reply of 2026-09-22 | S11 |
| legal entity | Not verified, the user agreement at `https://www.coinup.io/en_US/cms/agreement` answered 403 with `cf-mitigated: challenge` | P1 |
| who may trade the perpetuals | Not verified, same page | P1 |
| excluded regions | a restricted countries list exists, since a campaign article says "users in restricted regions cannot participate (refer to the platform's restricted countries/regions list)", but the list itself was not readable | S12, P1 |
| US persons | Not verified | P1 |
| KYC | the Prediction Market FAQ requires KYC "due to regulatory requirements in certain jurisdictions", and campaign rules require personal or institutional verification | S12, S13 |

Access from this host, as fact.
Every CoinUp host that serves the website, the API or the documentation answered HTTP 403 with `cf-mitigated: challenge` and a "Just a moment..." page, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
That covered 22 REST URLs on 13 host names and 7 WebSocket URLs on 4 host names, 15 host names in all.
The WebFetch tool, which fetches from outside this host, also got 403 from `www.coinup.io`, `doc.coinup.io` and `support.coinup.io`.
The Wayback Machine holds Cloudflare challenge captures of `coinup.io` from 2025-06-28 to 2026-09-12, S14.
So the challenge is not shown to be specific to the Canadian exit, but that was not tested from another network, as the survey rules forbid it.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-margined perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1 |

S1 is the help center article "Understanding CoinUp.io Contract Fees: Taker vs. Maker Explained", created 2025-03-13 and updated 2026-03-17.
It says "When are you a Taker (paying a 0.06% fee)?" and "When are you a Maker (paying a 0.02% fee)?", and that fees are charged on both opening and closing.
It does not name a tier, so reading it as VIP 0 is an inference from its being the only rate the venue publishes for everyone.
The fee schedule page `https://www.coinup.io/en_US/cms/fee` answered 403, so the rate was not confirmed from the schedule itself, P1.
A promotion sets the futures maker to 0 % from 2026-09-08 05:00 to 2026-09-30 15:59 UTC, and leaves the taker unchanged, section 5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes | CoinGecko lists 97 tickers, all `contract_type` `perpetual` with target USDT, and a summary of 98 perpetual pairs, P2. 38 of the 97 are pairs the venue delisted on 2026-09-20, S4, so 59 remain |
| USDC-margined perpetuals | Not verified, none in CoinGecko's list | P2 |
| coin-margined perpetuals | Not verified. The 2024 contract guide documents "Coin margined perpetual contracts" such as BTC/USD, S9, and CoinGecko lists none | S9, P2 |
| dated futures | absent in CoinGecko, `number_of_futures_pairs` 0 | P2 |
| options | Not verified, none named in any source read | |
| spot | yes, 461 pairs on CoinGecko, and a 0 % spot fee campaign ran from 2026-08-25 07:00 to 2026-09-24 16:00 UTC | S11, S15 |
| tokenized US stocks | yes, a "U.S. Stocks Zone" traded by buy and sell, launched June 2026 | S16 |
| prediction markets | yes | S13 |

## 4. Perpetual tiers

No tier table was readable.
The VIP article, S2, says the level depends on "trading volume or transaction amount within a set period (e.g., 30 days)" or on "a certain amount of USDT or designated tokens", is assessed on a 30 day cycle, and gives "Discounted trading fees" as a benefit.
It publishes no thresholds and no rates.
The schedule at `https://www.coinup.io/en_US/cms/fee` answered 403, P1, and its Wayback captures of 2025 hold only the empty page shell, S14.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | source |
|---|---|---|
| VIP level | "Discounted trading fees", no rate published | S2 |
| Futures 0-Fee Carnival, 2026-09-08 13:00 to 2026-09-30 23:59 UTC+8 | none: "Taker fees are not affected by this campaign", the maker is 0 % | S3 |
| CPX ecosystem token | the CPX IEO article lists "Trading fee discounts and enhanced privileges" among planned uses, with no rate | S17 |
| referral and affiliate | Not verified, affiliate articles describe rebates to the referrer, not the taker rate | help center, not quoted |

Campaign rules exclude "API users, market maker accounts, institutional accounts, and other restricted accounts" from several promotions, S18.
A notice of 2026-07-06, updated 2026-08-31, says accounts suspected of "abnormal arbitrage activities" are reviewed and may have functions restricted, S19.

## 6. Funding as a cost

The only published formula is the archived 2024 contract guide, S6, which may be out of date: its index page still names FTX as a source, S8.

| item | value in S6 |
|---|---|
| interval | every 8 hours, at 00:00, 08:00 and 16:00, "ALL GMT-8 time" as written |
| who pays | "Only users who hold positions at the time of settlement", longs pay shorts when the rate is positive, and "Funds are settled entirely between users" |
| amount | position value times rate, where position value is contracts times face value times mark price |
| rate | `clamp(average premium index + clamp(interest rate - average premium index, 0.05 %, -0.05 %), 0.375 %, -0.375 %)` |
| interest rate | (0.06 % - 0.03 %) / 3 = 0.01 % per period |
| premium index | from depth-weighted bid and ask prices at 8,000 USDT of depth against a "reasonable price", computed every minute and averaged over the last hour |
| when fixed | the rate for a period is fixed at the start of the period from the previous period's data, and applied at its end |

The cap and floor are ±0.375 % per 8 h, 3,750 ppm.
CoinGecko reported rates from -0.01 to 0.036 on the 59 live perpetuals, with 27 at 0.01, P2.
Read as percent, 0.01 is 100 ppm, which equals S6's interest rate with no premium.
Read as a fraction, 27 contracts would sit above S6's cap, so percent is the consistent reading, though CoinGecko's unit was not verified against the venue.
The settlement instant itself was not captured, and no funding history call was reachable, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

- Liquidation: the mark price triggers it, the risk engine takes the position over and closes it at market, and "A forced liquidation fee may apply in accordance with the platform's fee schedule (where applicable)", S5.
  No rate is published outside the unreadable schedule.
- Insurance fund: the 2024 guide has a page on it, `insurance_fund_and_allocation.html`, which was not read.
- Delisting: on 2026-09-20 the venue delisted 39 perpetual pairs, among them ICP, APE, TRB and KSM, said "From 19:30 to September 21, 2026, users will be unable to add new positions", and that it "will automatically liquidate the perpetual contracts" at 20:00 UTC+8, 12:00 UTC, S4.
  No delisting fee is named.
  The notice also reserves unannounced changes to leverage, margin and funding parameters "including the base interest rate, premium index, and fee cap".

## 8. CCXT

- CCXT 4.5.68 has no CoinUp class: `ccxt.exchanges` lists 104 ids and none matches `coinup`, P2.
- CCXT master on GitHub, commit `1d8b674` of 2026-09-22 12:48 UTC, has 105 TypeScript files directly under `ts/src` and none named `coinup`, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/coinup.ts` answers 404.
  GitHub's issue search for "coinup" in `ccxt/ccxt` returned 0 results.
- So there is no `market.taker` to report, and no source line.

## 9. Recommended registry values

None.
The venue cannot be registered in its current shape, because a registry entry is built on a CCXT class, `createExchange: () => ccxt.Exchange` at [`registry.ts`](../../../server/src/venues/registry.ts) line 29, and none exists.
If the access and catalog problems of [`rest.md`](./rest.md) section 8 were solved, `takerPpm` would be 600 from S1, and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Understanding CoinUp.io Contract Fees: Taker vs. Maker Explained, updated 2026-03-17 | https://notice.coinup.io/hc/en-us/articles/44454802247193, read as https://helpcenter-coinup.zendesk.com/api/v2/help_center/en-us/articles/44454802247193.json | 2026-09-22 | CoinUp, global | taker 0.06 %, maker 0.02 %, sections 2 and 9 |
| S2 | How to Become a CoinUp.io VIP User, updated 2026-03-04 | https://notice.coinup.io/hc/en-us/articles/50804909839641 | 2026-09-22 | CoinUp, global | VIP rules without numbers, sections 4 and 5 |
| S3 | CoinUp "Futures 0-Fee Carnival", updated 2026-09-08 | https://notice.coinup.io/hc/en-us/articles/62020538776729 | 2026-09-22 | CoinUp, global | maker 0 % to 2026-09-30, taker unchanged, sections 2 and 5 |
| S4 | Delisting Notice, Announcement on the Delisting of Certain Perpetual Contract Trading Pairs, 2026-09-20 | https://notice.coinup.io/hc/en-us/articles/62438443551129 | 2026-09-22 | CoinUp, global | 39 pairs delisted and liquidated, sections 3 and 7 |
| S5 | Explanation of the Forced Liquidation Execution Mechanism, updated 2026-07-01 | https://notice.coinup.io/hc/en-us/articles/59560359341209 | 2026-09-22 | CoinUp, global | liquidation process and fee wording, section 7 |
| S6 | Funding Rate, CoinUp contract guide, Wayback capture of 2024-04-20 | https://web.archive.org/web/20240420231330/https://coinup.io/en/Overview/funding_rate.html | 2026-09-22 | CoinUp, global | funding interval, formula, clamps, section 6 |
| S7 | Mark Price, same guide, capture of 2024-04-20 | https://web.archive.org/web/20240420230754/https://coinup.io/en/Overview/mark_price.html | 2026-09-22 | CoinUp, global | mark formula, [`rest.md`](./rest.md) section 4 |
| S8 | Index Price, same guide, capture of 2024-04-20 | https://web.archive.org/web/20240420221150/https://coinup.io/en/Overview/index_price.html | 2026-09-22 | CoinUp, global | index sources including FTX, section 6 |
| S9 | USDT perpetual contract introduction and contract variety elements, same guide, captures of 2024-04-20 | https://web.archive.org/web/20240420235805/https://coinup.io/en/usdt_margined_perpetual_contract/usdt_perpetual_contract_introduction.html | 2026-09-22 | CoinUp, global | coin-margined family, face values, section 3 |
| S10 | CoinGecko derivatives exchange `coinup-futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/coinup-futures?include_tickers=unexpired | 2026-09-22 | CoinGecko | 98 perpetuals, 97 USDT tickers, country, sections 1 and 3 |
| S11 | CoinGecko exchange `coinup` | https://api.coingecko.com/api/v3/exchanges/coinup | 2026-09-22 | CoinGecko | trust rank 150, 461 spot pairs, section 1 |
| S12 | New Version Fever Continues, campaign rules, updated 2025-11-24 | https://notice.coinup.io/hc/en-us/articles/51846807587737 | 2026-09-22 | CoinUp, global | restricted countries list exists, section 1 |
| S13 | CoinUp Prediction Market FAQ, updated 2026-06-11 | https://notice.coinup.io/hc/en-us/articles/58883650355097 | 2026-09-22 | CoinUp, global | KYC for regulatory reasons, sections 1 and 3 |
| S14 | Wayback Machine CDX index of `*.coinup.io` | https://web.archive.org/cdx/search/cdx?url=*.coinup.io | 2026-09-22 | Internet Archive | challenge captures from 2025-06-28 to 2026-09-12, empty fee page shells, sections 1 and 4 |
| S15 | CoinUp All Spot Trading 0-Fee Month, updated 2026-08-31 | https://notice.coinup.io/hc/en-us/articles/61549089161753 | 2026-09-22 | CoinUp, global | spot promotion dates, section 3 |
| S16 | CoinUp U.S. Stocks Trading Carnival, updated 2026-06-28 | https://notice.coinup.io/hc/en-us/articles/58685902845337 | 2026-09-22 | CoinUp, global | US stocks zone, section 3 |
| S17 | Announcement on the CPX Genesis IEO, updated 2026-07-30 | https://notice.coinup.io/hc/en-us/articles/58725309942041 | 2026-09-22 | CoinUp, global | CPX fee discount named, section 5 |
| S18 | CoinUp Summer Million Rewards Festival, updated 2026-07-22 | https://notice.coinup.io/hc/en-us/articles/60302527160985 | 2026-09-22 | CoinUp, global | API users excluded from campaigns, section 5 |
| S19 | Notice on the Handling of Abnormal Arbitrage Accounts, updated 2026-08-31 | https://notice.coinup.io/hc/en-us/articles/59742422983449 | 2026-09-22 | CoinUp, global | arbitrage account review, section 5 |
| P1 | `rest-probe.mjs access` at 04:14 and 04:21 UTC on 2026-09-23, and `ws-probe.mjs` at 04:15 and 04:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinup/rest-probe.mjs) | 2026-09-22 | this host, Canadian exit | every CoinUp page and API call answered 403 challenge, sections 1, 2 and 4 |
| P2 | `rest-probe.mjs context` at 04:14 and 04:21 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinup/rest-probe.mjs) | 2026-09-22 | this host | CCXT check, CoinGecko counts and rates, help center articles, sections 2, 3, 6 and 8 |
