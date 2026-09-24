# Hata Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:24 to 05:00 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=SEA`).

Hata is CoinGecko's trust rank 100 in the survey list, it lists no perpetual, and it has no CCXT class.
This profile therefore covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Hata runs two separate platforms with separate hosts, catalogs and fee tables: Hata Global, in USD and USDT, and the Malaysia platform, in MYR.
Both are described, and Hata Global is the one a non-Malaysian account would use.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/hata/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local, 2026-09-23 04:24 to 05:00 UTC | |
| Hata Global operator | Hata Capital Limited, Reg. No. LL 18277, incorporated in the Federal Territory of Labuan, Malaysia, regulated by the Labuan Financial Services Authority | S3, terms last updated Dec 19, 2025 |
| Malaysia platform operator | "operated separately by our affiliated company, Hata Digital Sdn Bhd, which is licensed under the laws of Malaysia", regulated by the Securities Commission Malaysia | S3 |
| Malaysia terms | last updated Jan 29, 2026, and its entity table reads "All countries" with "Hata Capital Limited [LL18277]" | S4 |
| who may trade Hata Global | individuals of 18 or over and business accounts, one account per person | S3, section "Eligibility" |
| excluded regions, Hata Global | the "United States" and "Ontario (Canada)", which Hata "does not onboard", plus sanctioned countries and persons, and any country that exceeds Hata's "risk appetite" | S3, section "Prohibited Countries/Jurisdiction" |
| US persons | may not trade on Hata Global | S3 |
| who may trade the Malaysia platform | Not verified: S4 binds the customer to "a specific Hata entity" by the country the account was verified in, and its only row names Hata Capital Limited for "All countries" | S4 |
| CoinGecko | id `hata`, country Malaysia, established 2023, trust score 5, `trust_score_rank` 103 on 2026-09-23 04:24 UTC, 24 h volume 3.99 BTC | S7 |
| CoinGecko tickers | 20 tickers, all MYR pairs of the Malaysia platform, summing to 346,798 USD in 24 h, and none of Hata Global's pairs | S7 |

Access from this host is recorded in [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
No REST call met a geoblock, challenge or refusal, and 27 of 28 WebSocket opens upgraded, the other one refused by Cloudflare with HTTP 525.
The exit geolocates to Canada, and the Global terms exclude Ontario, so whether an account could be opened from this exit's province is Not verified.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| Hata Global spot, all exchange pairs | 0.00 %, 0 ppm | 0.25 %, 2,500 ppm | S1, Tier 1, 30 day volume $0 to $50,000 |
| Malaysia spot, all exchange pairs | 0.00 %, 0 ppm | 0.40 %, 4,000 ppm | S2, Tier 1, 30 day volume RM0 to RM10,000 |
| any perpetual | absent | absent | section 3 |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps, any margin | absent | the API specification S6 has no futures, margin, funding, index or mark path or field, and no word of them appears on the home, trade, market or OTC pages or in the web app's main bundle, P1. CoinGecko's derivatives exchange list of 214 venues has no Hata, S7 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| spot, Hata Global | present | 6 pairs: `USDTUSD` and 5 USDT pairs, `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `XRPUSDT`, `BIDUSDT`, P2 |
| spot, Malaysia | present | 23 MYR pairs, P2 |
| instant buy and sell, OTC | present | "Instant Buy/Sell Fees" and an OTC desk, S1 and S5, not an order book and outside this survey |

Hata Global says it "offers access to 50+ cryptocurrencies", S5, while its order book catalog lists 6 pairs, P2.
The remainder is reached through instant buy and sell, which has no public API in S6.

## 4. Spot tiers

The tier is set daily from the total 30 day volume "across all markets on the Hata platform", converted to the account's primary currency, and one fee applies to every exchange pair, S1 and S2.

| tier | Hata Global 30 day volume | maker | taker | Malaysia 30 day volume | maker | taker |
|---|---|---:|---:|---|---:|---:|
| 1 | $0 to $50,000 | 0.00 % | 0.25 % | RM0 to RM10,000 | 0.00 % | 0.40 % |
| 2 | $50,001 to $100,000 | 0.00 % | 0.24 % | RM10,001 to RM50,000 | 0.00 % | 0.35 % |
| 3 | $100,001 to $250,000 | 0.00 % | 0.22 % | RM50,001 to RM250,000 | 0.00 % | 0.30 % |
| 4 | $250,001 to $500,000 | 0.00 % | 0.20 % | RM250,001 to RM500,000 | 0.00 % | 0.28 % |
| 5 | $500,001 to $1,000,000 | 0.00 % | 0.18 % | RM500,001 to RM1,000,000 | 0.00 % | 0.25 % |
| 6 | $1,000,001 to $2,500,000 | 0.00 % | 0.16 % | RM1,000,001 to RM2,500,000 | 0.00 % | 0.20 % |
| 7 | $2,500,001 to $5,000,000 | 0.00 % | 0.14 % | RM2,500,001 to RM5,000,000 | 0.00 % | 0.18 % |
| 8 | $5,000,001 to $10,000,000 | 0.00 % | 0.12 % | RM5,000,001 to RM10,000,000 | 0.00 % | 0.15 % |
| 9 | above $10,000,001 | 0.00 % | 0.10 % | above RM10,000,001 | 0.00 % | 0.10 % |

The maker fee is zero at every tier on both platforms.

## 5. Discounts that change the spot taker

The fee pages name no token holding discount, no referral rebate on the fee, no market maker programme and no zero fee promotion, S1 and S2.
An affiliate programme page exists at `https://hata.io/en/gb/legal/affiliate-programme`, and it was not read for fee effects.
The API documentation S6 names no separate API fee schedule.

## 6. Funding as a cost

Not applicable.
Hata lists no perpetual, so there is no funding rate, interval or settlement, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

No liquidation or settlement charge applies to spot.
The Malaysia platform publishes a listing and delisting policy at `https://hata.io/en/my/legal/listing-and-delisting-of-digital-assets`, which was not read.
Deposit, withdrawal and staking charges are on the same fee pages, S1 and S2, and the withdrawal minimums are in the help article S8.

## 8. CCXT

| check | result | evidence |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | no class: `ccxt.exchanges` holds 104 ids and none matches `hata`, and no file in `server/node_modules/ccxt/js/src` matches | P2, `rest-probe.mjs catalog` |
| current CCXT master on GitHub | no class: the `ts/src` listing has 112 entries and `ts/src/pro` 78, and none matches `hata`, at commit `1d8b674` of 2026-09-22 12:48 UTC | S9 |
| CCXT issues | a GitHub issue search for `hata` in `ccxt/ccxt` returned 0 results | S9 |

So there is no `market.taker` to report.

## 9. Recommended registry values

None, because Hata lists no perpetual and has no CCXT class, so it cannot join the engine as a perpetual leg.
If Hata Global spot were ever added through a custom catalog, `takerPpm` would be 2500, the Tier 1 taker of S1, and `ccxtTakerPpm` would stay unset, since no CCXT constant exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hata fees, Global | https://hata.io/en/gb/fees | 2026-09-22 | Hata Capital Limited, Global | maker and taker tiers in USD, sections 2 and 4 |
| S2 | Hata fees, Malaysia | https://hata.io/en/my/fees | 2026-09-22 | Malaysia platform | maker and taker tiers in MYR, sections 2 and 4 |
| S3 | Hata Global Terms of Use, last updated Dec 19, 2025 | https://hata.io/en/gb/legal/termsofuse-ww | 2026-09-22 | Hata Capital Limited, Labuan | entity, regulator, eligibility, excluded regions, section 1 |
| S4 | Hata Terms of Use, Malaysia, last updated Jan 29, 2026 | https://hata.io/en/my/legal/termsofuse-my | 2026-09-22 | Malaysia platform | entity table, section 1 |
| S5 | Hata Global | https://hata.io/en/gb/hata-global/ | 2026-09-22 | Hata Capital Limited | "50+ cryptocurrencies", Labuan FSA licence, section 3 |
| S6 | Hata API Documentation, OpenAPI 3.0 file, changelog last updated 2026-07-03, file `last-modified` 2026-07-24 | https://developers.hata.io/ and https://developers.hata.io/openapi.generated.yaml | 2026-09-22 | both platforms | the absence of any derivatives path, section 3 |
| S7 | CoinGecko API, `exchanges/hata` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/hata | 2026-09-23 04:24 UTC | CoinGecko | rank, volume, tickers, the derivatives list, sections 1 and 3 |
| S8 | Hata Fees FAQ, March 16, 2026 | https://support.hata.io/en/articles/607828-hata-fees-faq | 2026-09-22 | Hata | withdrawal fees and minimums, section 7 |
| S9 | CCXT on GitHub, `ts/src` and `ts/src/pro` listings and issue search | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-23 04:23 UTC | CCXT | section 8 |
| P1 | page and bundle search with `curl` and `grep` | `https://hata.io/en/gb/`, `/trade`, `/market`, `/otc`, `https://app.hata.io/assets/index-Dq8ry-4C.js` | 2026-09-23 04:26 UTC | this host | section 3 |
| P2 | `rest-probe.mjs catalog`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs) | 2026-09-23 | this host | pairs and CCXT, sections 3 and 8 |
