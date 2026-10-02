# BitKan Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:34 UTC, from the development host near Seattle.

This profile covers perpetual trading on BitKan, which has no CCXT class, and nothing else.
BitKan publishes no API and no readable fee schedule to this host, so most rows below say what was checked and what failed.
BitKan's perpetuals are Binance USD-M contracts that BitKan brokers, see section 3 and [`rest.md`](./rest.md) section 2.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitkan/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 | |
| operator | BitKan, established 2012, country British Virgin Islands | S1 |
| self description | "a leading cryptocurrency broker exchange, partnering with over 7 major exchanges, including Binance and OKX" | S1 |
| perpetual counterparty | Binance: "BitKan, as Binance's official partner broker", users who trade Binance futures on BitKan must pass Binance futures KYC, which Binance reviews | S5, S6 |
| legal entity of the BitKan platform | Not verified: the terms page `https://bitkan.com/help/protocol` answers 403 to this host, and its Wayback copies are an empty single page app shell | P1, S7 |
| who may trade the perpetuals | a BitKan account holder who also passes Binance futures KYC, and mainland China ID cards are accepted | S5, S6 |
| excluded regions | Not publicly specified in anything readable. The website string `futures_risk_warning` says "Futures trading is limited for users from restricted regions." without a list | S8 |
| US persons | Not verified from BitKan. Since every perpetual order needs Binance KYC, Binance's own exclusion of US persons would apply, which is an inference | S5 |

The fee page `https://bitkan.com/help/fee` answered 403 with `cf-mitigated: challenge` to this host, with curl's agent and with a browser agent, see [`rest.md`](./rest.md) section 1.
WebFetch from outside this host got 403 as well.
Its 18 distinct Wayback captures, from 2022-05-19 to 2026-07-25, are single page app shells that say "You need to enable JavaScript to run this app.", and the three opened held no percentage, P3.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals (Binance USD-M, brokered) | Not publicly specified | Not publicly specified | S8, P1 |

The website loads the rates per user from `/proxy/v2/contract/account/fees`, which sits behind the same challenge, S9.
Its fee page has separate "Binance Fee Rate" and "OKX Fee Rate" rows for futures, S8, so BitKan sets or passes on a rate per underlying venue.
Binance's own USD-M VIP 0 taker is 0.05 %, 500 ppm, at `server/node_modules/ccxt/js/src/binance.js` line 1248 as cited in [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) line 38.
Whether BitKan adds a markup to that rate is Not verified, so no BitKan number is recorded.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 723 contracts on CoinGecko, all USDT, all found in Binance USD-M | CoinGecko lists 726 perpetual pairs, and its ticker list returned 723, every one a Binance USD-M symbol, 720 of them trading on Binance and 3 settling, P2 |
| coin-margined perpetuals | documented, not observed | the help article says BitKan offers "Coin-Margined Futures (Inverse Contracts)", S4, but CoinGecko lists no USD-quoted contract and the 2023 catalog copy held only USDT contracts, P2, P4 |
| USDC-M perpetuals | absent from every source | P2, P4 |
| OKX perpetuals | named only | the fee page names an "OKX Fee Rate", S8, and the positions bundle switches on an `okex` prefix, S9. No OKX contract appears on CoinGecko, P2 |
| dated futures | absent | CoinGecko `number_of_futures_pairs` 0, P2 |
| options | absent | none named in any source |
| spot | present, brokered | CoinGecko lists 602 spot pairs, S1, P2. Not detailed here |

Deposit, withdrawal and card fees: the official lookup is the fee page `https://bitkan.com/help/fee`, which this host cannot read.

## 4. Perpetual tiers

Not publicly specified.
The locale bundle names the columns "Level", "Futures Fee Rate", "Binance Fee Rate" and "OKX Fee Rate", and says "Trading fee rates in these VIP tiers are negotiable. Please contact our relationship manager for more information: business@bitkan.com", S8.
The numbers themselves come from the account API behind the challenge.
The only tier text readable anywhere is spot.
A 2020 article says, translated from Chinese, "BitKan uses tiered fees, the entry fee is 0.1 %", S10.
Its 2024-10-24 rewrite says users are tiered by 30 day volume and puts the table in an image named `现货交易费率.jpg`, spot trading fee rates, which was not read, S10.
Neither is a perpetual rate.

## 5. Discounts that change the perpetual taker

| discount | detail | source |
|---|---|---|
| KAN token | the 2020 spot article gives 12 % to 34 % off for paying in KAN, and its 2024-10-24 rewrite says at most 25 % off. Whether either applies to perpetuals is Not verified | S10 |
| token fee switch | the fee page bundle reads a per user `use_token_fee` flag and a timed `discount` with start and end, S9 | S9 |
| referral | a help article title reads "BitKan Launches Referral Rebate, Rebate rate is up to 30%", captured from 2021, body not read | S7 |
| market maker, zero fee promotions | Not publicly specified | |

## 6. Funding as a cost

Funding is Binance's, relayed unchanged.
The website's socket sent a `rate` equal to Binance's `lastFundingRate` and a `next_time` equal to Binance's `nextFundingTime` on 121 of 121 frames over three runs on BTC and ETH, and a `prev_rate` equal to Binance's settled rate at 2026-09-23 00:00 UTC for both, see [`rest.md`](./rest.md) section 4.
The website states the charge as "Funding fee=Position value * funding rate", S8.
Formula, interval, cap and floor are Binance USD-M's, and this profile does not restate them.
Who is charged at settlement, and whether BitKan adds anything, is Not publicly specified.
No settlement instant was captured.

## 7. Liquidation, settlement and delisting

Not publicly specified by BitKan.
Positions live at Binance under Binance KYC, S5, S6, so Binance's liquidation and delisting rules are the working assumption, which is an inference.

## 8. CCXT

CCXT 4.5.68 has no BitKan class.
`require('ccxt').exchanges` run from `server/` lists 104 ids and none matches `/kan|bitk/i`, P1.
`grep -ril bitkan server/node_modules/ccxt/js/src/` returns nothing.
CCXT master has none either.
`GET https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master` returned 200 with 112 entries at about 03:05 UTC on 2026-09-23, and none matches `/kan|bitk/i`.
The rerun at 03:33 UTC got 403 from GitHub's unauthenticated limit, so the second read used `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, which lists 105 ids with none matching, while `ts/src/bitkan.ts` and `ts/src/pro/bitkan.ts` answered 404.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
BitKan cannot join the registry: it has no CCXT class, no public API, and its perpetuals are Binance's contracts, which the registry already carries as `binance`.
If it ever joined, `takerPpm` would need BitKan's own rate from an account, since the public schedule is unreadable.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinGecko exchange entry `bitkan` | https://api.coingecko.com/api/v3/exchanges/bitkan | 2026-09-22 | BitKan, British Virgin Islands | year, country, self description, 602 pairs, trust rank 43, section 1 and 3 |
| S2 | CoinGecko derivatives entry `bitkan-futures` | https://www.coingecko.com/en/exchanges/bitkan-futures | 2026-09-22 | BitKan | 726 perpetual pairs, section 3 |
| S3 | CoinGecko derivatives API | https://api.coingecko.com/api/v3/derivatives/exchanges/bitkan-futures | 2026-09-22 | BitKan | 0 dated futures, 723 tickers, section 3 |
| S4 | "How to Trade Binance Futures on BitKan?", Wayback capture 2025-05-19 | https://web.archive.org/web/20250519212733/https://help.bitkan.com/hc/en-us/articles/39651642002585-How-to-Trade-Binance-Futures-on-BitKan | 2026-09-22 | BitKan | coin-margined and USDT-margined perpetuals, 125x on BTCUSDT, section 3 |
| S5 | "How to Complete KYC Verification on Binance?", Wayback capture 2025-01-18 | https://web.archive.org/web/20250118012445/https://help.bitkan.com/hc/en-us/articles/41056314070425-How-to-Complete-KYC-Verification-on-Binance | 2026-09-22 | BitKan, Binance | Binance KYC required, reviewed by Binance, mainland China ID accepted, section 1 |
| S6 | Chinese KYC article 30130562216857, Wayback capture 2024-07-25 | https://web.archive.org/web/20240725012305/https://help.bitkan.com/hc/zh-cn/articles/30130562216857-%E5%A6%82%E4%BD%95%E5%AE%8C%E6%88%90%E5%B8%81%E5%AE%89%E5%90%88%E7%BA%A6KYC-%E8%BA%AB%E4%BB%BD%E8%AE%A4%E8%AF%81 | 2026-09-22 | BitKan, Binance | "币看作为币安的官方合作经纪商", BitKan as Binance's official partner broker, KYC deadline 2024-04-30, section 1 |
| S7 | Wayback CDX listings of `help.bitkan.com/hc/*` and `bitkan.com/help/*` | https://web.archive.org/cdx/search/cdx?url=help.bitkan.com/hc/* | 2026-09-22 | BitKan | 83 English article captures, none about an API, section 1 and 5 |
| S8 | website English locale bundle `en.loader-3KP_aEIN.js` | https://cdn.bitkan.net/cdn/static/js/en.loader-3KP_aEIN.js | 2026-09-22 | BitKan | fee page labels, restricted regions string, funding formula, sections 1 to 6 |
| S9 | website bundles `fee-7u8EQZ75.js`, `common-CFRo43IM.js`, `futures.symbols-BmA1Mca9.js`, `binance-BRhfXiOc.js` | https://cdn.bitkan.net/cdn/static/js/ | 2026-09-22 | BitKan | fee API path, token fee flag, `okex` prefix, sections 2, 3 and 5 |
| S10 | Chinese fee article 360041023032, Wayback captures 2020-11-24 and 2024-11-10 | https://web.archive.org/web/20241110073835/https://help.bitkan.com/hc/zh-cn/articles/360041023032-%E4%BA%A4%E6%98%93%E8%B4%B9%E7%8E%87 | 2026-09-22 | BitKan | spot tiers from 0.1 % in 2020, a spot table image in 2024, KAN discount, section 4 and 5 |
| P1 | `rest-probe.mjs reach` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs) | 2026-09-22 | this host | 403 challenge on fee and terms pages, CCXT ids, section 1, 2 and 8 |
| P2 | `rest-probe.mjs coingecko` and `tickers` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs) | 2026-09-22 | this host | 723 tickers all on Binance USD-M, section 3 |
| P3 | Wayback CDX of `bitkan.com/help/fee` | https://web.archive.org/cdx/search/cdx?url=bitkan.com/help/fee | 2026-09-22 | BitKan | fee page captures are empty shells, section 1 |
| P4 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkan/rest-probe.mjs) | 2026-09-22 | Wayback copy | 2023 catalog of 169 Binance USDT perpetuals, section 3 |
| P5 | `ws-probe.mjs mark` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkan/ws-probe.mjs) | 2026-09-22 | this host | funding fields equal to Binance's, section 6 |
