# Bitkub Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 01:25 to 01:58 UTC, from the development host near Seattle.

Bitkub Exchange is CoinGecko's trust rank 23 on 2026-09-22, it lists no perpetual, and it has no CCXT class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Bitkub's own web pages refuse this host and the web fetch tool with a Cloudflare challenge, so fee numbers come from an archived copy of the official fee page and from the search index of the current one, and each row says which.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitkub/ws-probe.mjs).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 for every source row | source ledger |
| operator | Bitkub Online Co., Ltd., Thailand, holder of a Digital Asset Exchange licence and, since 2025-05-15, a Digital Asset Broker licence from the Thai Ministry of Finance | S6 |
| CoinGecko listing | "Bitkub", country Thailand, established 2018, trust score 8, trust rank 23, 24 h volume 703.8 BTC | S7, read 2026-09-23 01:27 UTC |
| who may open an account | Thai nationals, and foreign nationals who reside or work in Thailand and can show a Thai residence or work document such as a work permit, a non-immigrant visa or a household registration, plus a passport valid for more than 3 months | S5, read through the search index only |
| US persons | no document names US persons, and none was readable that lists excluded countries | Not publicly specified. A US person who does not live in Thailand cannot meet the residence documents of S5 |
| fiat | THB only. The fiat endpoints list "approved bank accounts" with Thai bank codes such as `KBANK` and withdraw "to an approved bank account" | S2 |
| official pages from this host | `https://www.bitkub.com/en/fee/cryptocurrency`, `https://www.bitkub.com/en/fee` and `https://support.bitkub.com/...` answer HTTP 403 with `cf-mitigated: challenge` and the title "Just a moment...", and the web fetch tool got 403 as well | curl at about 01:25 UTC and again at 01:58 UTC on 2026-09-23 |
| API from this host | public REST and WebSocket answer normally, no geoblock | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

Bitkub lists no perpetual, so there is no perpetual VIP 0 fee.
The spot VIP 0 numbers are below.

| market | maker | taker | evidence |
|---|---|---|---|
| THB pairs, 356 active | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | S3, the official fee page as archived on 2025-08-14, and S4, the search index of the same page in September 2026 |
| USDT pairs, 10 active | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S4 only, the search index of the official fee page, not read directly |

The USDT pairs are `source` `broker` markets whose books track Bybit spot with about 1,400 ppm added to each side, see [`rest.md`](./rest.md) section 2.
So the cost of crossing a USDT pair against the Bybit touch is the fee plus about 1,400 ppm, not the fee alone.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals, any settlement | absent | `/api/v3/market/symbols` returns 473 rows and every row has `market_segment` `SPOT`, probe run 1 and run 2. CoinGecko's derivatives exchange list of 214 venues has no Bitkub entry, S7 |
| dated futures | absent | same catalog, no documented futures endpoint in S1 |
| options | absent | same |
| margin | absent | no margin endpoint or margin field in S1 |
| spot, THB, `source` `exchange` | present, 249 active and 88 stopped | catalog, run 1 and run 2 |
| spot, THB, `source` `broker` | present, 107 active and 19 stopped | catalog |
| spot, USDT, `source` `broker` | present, 10 active: `BTC_USDT`, `XRP_USDT`, `ETH_USDT`, `DOGE_USDT`, `ADA_USDT`, `SOL_USDT`, `BCH_USDT`, `SUI_USDT`, `XAUT_USDT`, `NEAR_USDT`, nine created on 2026-06-16 and `NEAR_USDT` on 2026-06-24 | catalog |
| crypto derivatives on the Thai market | a framework only | the Thai SEC reported Cabinet approval on 2026-02-10 of wider underlyings under the Derivatives Act, and said it would draft the rules that let licensed digital asset operators offer such contracts, S8. Bitkub lists none on 2026-09-22 |

Deposit and withdrawal fees are published on the official fee page, S3, and are not recorded here.

## 4. Spot tiers

The official fee page lists one row, "All cryptocurrencies 0.25% / Transaction", for maker and taker, with no tier table and no volume rule, S3.
It says "The 0.25% maker fee is charged on the amount of each matched bid or ask order" and "The 0.25% taker fee is charged on the amount of each matched buy or sell order", S3.
The search index of the current page adds 0.1 % for USDT pairs, S4.

A review site states that Bitkub drops to 0.1 % maker and taker at 5 million USD of 30 day volume, S9.
No official page or API field seen here supports that tier, so it is Not verified.
The documentation example of `place-bid` shows `amt` 1000 THB with `fee` 2.5, which is 0.25 %, S1.

## 5. Discounts that change the spot taker

| discount | rule | effect | evidence |
|---|---|---|---|
| fee credits bought with KUB | KUB converts into fee credits valued at the KUB market price, with a floor of 30 THB per KUB, and a bonus of 10 % at 100,000 THB converted and up to 20 % above that. Fee credits pay trading fees in the THB market only and cannot be withdrawn | KUB_THB last traded at 21.09 THB on 2026-09-23 01:36 UTC, so the floor values one KUB 1.42 times its price, and a fee paid this way costs about 0.25 % times 21.09 / 30, or 1,758 ppm, before any bonus | S10 and S11, read through the search index only, KUB price from probe run 1 |
| zero fee on USDT pairs | 0 % on every USDT pair from 2026-07-14 to 2026-08-12 | ended before this survey | S4 and S12 |
| market maker programme | Not publicly specified | | |
| referral | Not publicly specified | | |

## 6. Funding as a cost

Bitkub has no perpetual, so there is no funding rate, interval, cap or settlement.

## 7. Liquidation, settlement and delisting

- There is no margin or derivative product, so there is no liquidation fee and no settlement charge.
- 107 of 473 catalog rows had `status` `stopped` with `freeze_buy`, `freeze_sell` and `freeze_cancel` all true, probe run 1 and run 2.
  `LTC_THB`, `EOS_THB`, `OMG_THB`, `WAN_THB` and `BSV_THB` are among them, each with `modified_at` 2026-06-16.
- A stopped pair returns an empty REST book, `{"error":0,"result":{"asks":[],"bids":[]}}`, and `error` 11 from the ticker, see [`rest.md`](./rest.md) section 5.
- A delisting charge is Not publicly specified.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids and none matches `kub`, from `node -e "console.log(require('ccxt').exchanges)"` run from `server/`, and `rest-probe.mjs catalog` |
| CCXT master on GitHub | `ts/src` has 105 files and `ts/src/pro` has 78 entries at commit `1d8b674434fde39ef282988b066812adf8d19b9e` of 2026-09-22 12:48 UTC, and no file name contains `kub`, S13 |
| other traces | `server/node_modules/ccxt/js/src/mexc.js` line 626 holds a commented network alias `// 'BITKUB': 'KUB',`, which is a MEXC network name and not a Bitkub class |
| open requests | CCXT issue 4488 "New exchange: bitkub" of 2019 and pull requests 5860 of 2019 and 7021 of 2020, "New Exchange: bitkub", are still open, S13 |
| `market.taker` | none, there is no class to report one |

## 9. Recommended registry values

No registry entry is recommended.
Bitkub has no swap market and no CCXT class, so the connector at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 64 to 68 and 200 to 201 would load nothing.
If a THB spot leg were ever built outside CCXT, `takerPpm` would be 2,500 for THB pairs and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitkub Official API Docs, `rest-v3.md` | https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v3.md | 2026-09-22, repository head `d65eafa538` of 2026-09-09 | Bitkub | endpoints, error codes, rate limits, `place-bid` fee example, sections 3 and 4 |
| S2 | Bitkub Official API Docs, `rest-v4.md` | https://github.com/bitkub/bitkub-official-api-docs/blob/master/rest-v4.md | 2026-09-22 | Bitkub | fiat account endpoints, section 1 |
| S3 | Bitkub fee page, Wayback Machine copy of 2025-08-14 00:59 UTC | https://web.archive.org/web/20250814005910/https://www.bitkub.com/en/fee/cryptocurrency | 2026-09-22 | Bitkub, Thailand | 0.25 % maker and taker, charging rule, sections 2 and 4 |
| S4 | search index entry of `https://www.bitkub.com/en/fee/cryptocurrency` | https://www.bitkub.com/en/fee/cryptocurrency | 2026-09-22, page itself refused with 403 | Bitkub, Thailand | 0.25 % THB, 0.1 % USDT pairs, zero fee from 2026-07-14 to 2026-08-12, sections 2 and 5 |
| S5 | Account Verification KYC Level 1 for foreign nationals, search index entries | https://support.bitkub.com/en/support/solutions/articles/151000034765-account-verification-kyc-level-1-for-foreign-nationals-on-website | 2026-09-22, page refused with 403 | Bitkub, Thailand | residence and work documents for foreigners, passport validity, section 1 |
| S6 | Bitkub Online Digital Asset Broker licence press release | https://www.thaipr.net/en/finance_en/3601973 | 2026-09-22 | Bitkub Online Co., Ltd. | operator and licences, section 1 |
| S7 | CoinGecko API `exchanges/bitkub` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/bitkub | 2026-09-23 01:27 UTC | CoinGecko | listing context, no derivatives entry, sections 1 and 3 |
| S8 | Thai SEC news on derivatives referencing digital assets | https://www.sec.or.th/EN/Pages/News_Detail.aspx?SECID=12552 | 2026-09-22, search index only | Thai SEC | derivatives framework, section 3 |
| S9 | Traders Union, All Bitkub Fees | https://tradersunion.com/brokers/crypto/view/bitkub/fees/ | 2026-09-22, search index only | third party | the unverified 5 million USD tier, section 4 |
| S10 | How to Convert Fee Credit Using KUB Coin | https://support.bitkub.com/en/support/solutions/articles/151000033904-how-to-convert-fee-credit-using-kub-coin-kub- | 2026-09-22, search index only | Bitkub | KUB to fee credit, section 5 |
| S11 | What are fee credits, and Bitkub on X about the 30 THB floor | https://support.bitkub.com/en/support/solutions/articles/151000034489-what-are-fee-credits- and https://x.com/BitkubOfficial/status/2078344012549779792 | 2026-09-22, search index only | Bitkub | THB market only, floor and bonuses, section 5 |
| S12 | Traders Union, Bitkub zero fee USDT trading | https://tradersunion.com/news/brokers-news/show/3046522-bitkub-unveils-zero-fee-usdt-trading/ | 2026-09-22, search index only | third party | promotion dates, section 5 |
| S13 | CCXT repository, `ts/src` listing, master commit, issues and pull requests | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | no Bitkub class, section 8 |
| P1 | `rest-probe.mjs catalog`, run 1 at 01:36 UTC and run 2 at 01:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog counts, KUB price, CCXT list, sections 3, 5, 7 and 8 |
| P2 | `rest-probe.mjs mirror`, run 1 at 01:38 UTC and run 2 at 01:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitkub/rest-probe.mjs) | 2026-09-23 UTC | this host | the broker markup, section 2 |
