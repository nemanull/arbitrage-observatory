# AstralX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, which is 2026-09-23 06:44 to 07:09 UTC, from the development host near Seattle through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the USDT-margined perpetuals of AstralX (CoinMarketCap slug `astralx`), and nothing else.
AstralX has no CCXT class, see section 8, so there is no CCXT id.
AstralX publishes no API documentation, see [`rest.md`](./rest.md) section 2, so the probed numbers come from the endpoints the `www.astralx.com` web front calls.
Every number carries a source ledger row, a probe reference, or a file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/astralx/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 local, 2026-09-23 UTC, for every source row | | source ledger |
| legal entity | "ASTRALX SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ LIMITED LIABILITY COMPANY (the "Company" EGON No.: 523795598, NIP No:. 8762502655) is a company incorporated in Poland under relevant Polish law and operates the website www.astralX.com" | Published | S3 |
| governing law | "The entire contents of this Term are a contract under the laws of the Republic of Singapore" | Published | S3 |
| restricted locations | "Any person located in the United States of America is prohibited from using the services provided by the Site." No other country list was found in the terms. | Published | S3 |
| who may trade the perpetuals | A registered account holder outside the United States. KYC is required for the promotions read, S10. | Region-specific | S3, S10 |
| launch | CoinMarketCap lists `dateLaunched` 2025-03-19 | Published | S1 |
| website from this host | `www.astralx.com` served every page and the public calls below through Cloudflare, `colo=SEA`, `loc=CA` | Probed | [`rest.md`](./rest.md) section 1 |
| help center from this host | the Zendesk JSON API at `support.astralx.com/api/v2/help_center/` served every public article. The HTML page of the VIP article answered 403 with a Cloudflare "Just a moment..." challenge | Probed | [`rest.md`](./rest.md) section 6 |
| `api.astralx.com` from this host | 403 from a SafeLine WAF page on every path. Every name under `astralx.com` that is not a Cloudflare host resolves to the same address, so this host name may not be a real API host | Probed | [`rest.md`](./rest.md) section 1 |

Every access result in this profile was taken through the Canadian VPN exit named in the Probed line, not from a United States address.
The development host itself sits in the United States, which the terms exclude, so trading from it is not allowed under S3.
Reading public market data is not an account service, and the web front served it without a challenge.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetuals | 0.0200 % = 200 ppm | 0.0600 % = 600 ppm | Published and Probed | S4 lists "Maker Buy Fee Rates 0.0200%" and "Taker Buy Fee Rates 0.0600%" for `BTCUSDT Perp` and ten other rows. The futures page embeds `"takerBuyFee":"0.0006"` and `"makerBuyFee":"0.0002"` on 32 of 32 listed contracts, `rest-probe.mjs catalog`, two runs |

Buy and sell rates are equal on every row of S4 and on every embedded contract.
The embedded contract also carries `"fixFee":true`.
The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters.

## 3. Coverage matrix

| product | present | count on 2026-09-23 UTC | evidence |
|---|---|---:|---|
| USDT-margined perpetuals | yes | 32 listed, plus 19 hidden ids with no volume, see note | Probed, `rest-probe.mjs catalog` |
| USDC-margined perpetuals | Not found | 0 | all 51 ids end in `USDT_PERP` |
| coin-margined perpetuals | Not found | 0 | all 51 ids are USDT-quoted. The help article S21 describes coin-margined contracts in general terms only |
| dated futures | Not found | 0 | no dated contract in the 51 ids or in the web front routes |
| options | Not found | 0 | no options route in the web front |
| "Standard contracts" and TradFi | yes, not detailed | not counted | web route `/en-us/stFutures/EURUSD` and socket host `stws.astralx.com`, S14. Help section "TradFi" with trading sessions, S12 |
| spot | yes, not detailed | not counted | web route `/en-us/exchange/BTC/USDT`. CoinMarketCap reports 688.8M USD of spot volume, S2 |
| stocks | yes, not detailed | not counted | socket host `stock.astralx.com`, S14, and "Stock Trading Online Terms and Conditions", S12 |

The 32 listed contracts include `XAUUSDT_PERP` and `XAGUSDT_PERP`, gold and silver, beside 30 crypto contracts.
The ticker and funding calls return 51 ids, and the 19 that the futures page does not list had zero 24 h volume in both runs.
CoinMarketCap's derivatives ranking read at 06:44 UTC listed AstralX at rank 55 with 32 derivatives market pairs, 7,408,794,071 USD of 24 h derivatives volume and 851,127,359 USD of open interest, S2.
The survey brief named rank 53 for the same list on 2026-09-23, and the rank moves between reads.
The 24 h quote volume of the 32 contracts in the ticker call summed to 7,415,107,253 and 7,415,793,502 USDT in `rest-probe.mjs compare` at 07:04 and 07:05 UTC, within 0.1 % of the CoinMarketCap figure, so CoinMarketCap reads this ticker.
Spot, deposit and withdrawal fees are looked up in the help center section "Trading Fees", S4.

## 4. Perpetual tiers

No perpetual tier table could be read.
The help center article "VIP Levels and Discounts" at `https://support.astralx.com/hc/en-001/articles/6735922392335-VIP-Levels-and-Discounts` is linked from the home page, and its HTML answered 403 with a Cloudflare challenge while the help center JSON API answered `{"error":"RecordNotFound","description":"Not found"}` for the same id, S5.
The fee article S4 names a single rate per contract and no tier.
So every tier above VIP 0 is Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | effect on the taker | status | evidence |
|---|---|---|---|
| perpetual maker promotion, 0 fee plus a 0.003 % rebate | none, "Perpetual Futures Taker orders are excluded" | ran from 2026-06-03 and ended early on 2026-06-08 at 13:00 | S10 |
| TradFi fee rebate up to 35 % | applies to TradFi trades, not the USDT perpetuals, by its title "Exclusive for TradFi, Enjoy Up to 35% Fee Rebate on Trades" | article updated 2026-09-02, body not read | S12 |
| "Astral Fee Rebate and Futures Bonus Voucher Usage Guidelines" | Not measured | linked from the home page, not read | S14 |
| token holding, referral tiers, market maker program | Not publicly specified | | no article found |

No discount found changes the VIP 0 taker of 600 ppm for a retail account.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | "Funding Rate = ((Bid1 + Ask1) / 2 - Index Price) / Index Price - Funding Rate Settlement Interest, calculated every minute" | Published | S6 |
| interval | 8 h. The 10 contracts with a last settlement show `nextSettleTime - lastSettleTime` of 28,800,000 ms, and all 51 ids show a `nextSettleTime` of 2026-09-23 08:00 UTC | Probed | `rest-probe.mjs catalog`, two runs |
| settlement instants | 00:00, 08:00 and 16:00 UTC by the 8 h interval from 00:00 UTC. The instant itself was not captured | Inferred | same |
| cap and floor | Not publicly specified by AstralX. The rate equalled OKX's on 6 of 6 contracts, so OKX's caps would bind: OKX reported `maxFundingRate` 0.00375 for BTC and 0.0075 or 0.01 for the other five | Not publicly specified | S6, S18, `rest-probe.mjs compare` at 07:05 UTC |
| source of the rate | the `fundingRate` of `BTCUSDT_PERP`, `ETHUSDT_PERP`, `SOLUSDT_PERP`, `DOGEUSDT_PERP`, `GIGGLEUSDT_PERP` and `ZKPUSDT_PERP` equalled the OKX `fundingRate` of the same contract digit for digit, for example `"0.000022054270312200"` against `"0.0000220542703122"`, and the OKX `fundingTime` equalled AstralX's `nextSettleTime` on all six | Probed | `rest-probe.mjs compare` at 07:05 UTC |
| who pays whom | the article says the rate "represents the rate paid or received between contract holders", with no sign rule | Published, incomplete | S6 |
| upcoming or settled | `fundingRate` equalled `settleRate` on 51 of 51 ids, and it moved once in 60 one second polls, so it is the minute rate for the coming settlement | Probed | `rest-probe.mjs anchor`, two runs |
| history | `GET /futures/history_funding_rates?tokenId=BTCUSDT_PERP` answered `{"code":"330001","msg":"Request failed, please try again later"}` | Probed | `rest-probe.mjs catalog`, two runs |
| never settled | 22 of the 32 listed contracts carried `lastSettleTime` 0, among them `DOGEUSDT_PERP`, `LINKUSDT_PERP` and `XAUUSDT_PERP` | Probed | same |

A rate is a fraction per 8 h interval, for example `"0.000022148304249300"` on `BTCUSDT_PERP` at 06:55 UTC.
The help center has no article on funding charges beyond S6, so when the charge is booked and whether a position opened after the instant pays is Not publicly specified.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| liquidation fee | Not publicly specified. The liquidation articles describe the mechanism and the mark price trigger only | S20 |
| maintenance margin | per contract and tier. The embedded `riskLimits` of `BTCUSDT_PERP` start at a maintenance margin of 0.004 and an initial margin of 0.01 for a `riskLimitAmount` of 1000, and rise to 0.25 and 0.5 at 1940000. The help table S9 gives other numbers for BTC, 0.4 % at 100x up to 3777 | `rest-probe.mjs catalog` at 07:05 UTC, S9 |
| delisting | contracts close at an announced time. "ORDI, W, PNUT and RIVER U-Standard Contracts" were to close at 18:00 UTC+8 on 2026-07-07 | S13 |
| delisting against the wire | `PNUTUSDT_PERP` and `RIVERUSDT_PERP` are among the 19 hidden ids, while `ORDIUSDT_PERP` and `WUSDT_PERP` are still listed and traded, so the announcement and the catalog disagree on two of four | `rest-probe.mjs catalog` |
| settlement charge | none named | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| CCXT 4.5.68 class | none. `require('ccxt').exchanges` from `server/` lists 104 ids and none matches `astral` | `rest-probe.mjs catalog`, two runs |
| CCXT master | none. The GitHub listing of `ts/src` in `ccxt/ccxt` on 2026-09-23 had 112 entries and none matches `astral` or `alx` | S15 |
| `market.taker` | none, because there is no class | |

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 600, only if the venue is ever added | S4 and the embedded fee on 32 of 32 contracts |
| `ccxtTakerPpm` | none | there is no CCXT class, so the connector has no constant to expect |

The venue is not recommended for the registry, see [`rest.md`](./rest.md) section 8.
Its order books are a copy of the OKX books and its index is its mark, see [`websocket.md`](./websocket.md) section 4 and [`rest.md`](./rest.md) section 4.

## 10. Source ledger

The ids are shared by the three AstralX files, so an id that one file does not use is missing from its table.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange page | https://coinmarketcap.com/exchanges/astralx/ | 2026-09-23 | global | website, fee link, launch date, section 1 |
| S2 | CoinMarketCap derivatives exchange ranking, the AstralX row | https://coinmarketcap.com/rankings/exchanges/derivatives/ | 2026-09-23 06:44 UTC | global | rank, volumes, open interest, pair count, section 3 |
| S3 | Terms of Service, updated 2026-09-02 | https://support.astralx.com/hc/en-001/articles/6695948907279-Terms-of-Service, read through `https://support.astralx.com/api/v2/help_center/en-001/articles/6695948907279.json` | 2026-09-23 | AstralX Sp. z o.o., Poland | entity, United States exclusion, governing law, section 1 |
| S4 | Futures Trading Fee Rates, updated 2026-09-02, last edited 2025-03-24, in section "Trading Fees" | https://support.astralx.com/hc/en-001/articles/6748133268111-Perpetual-Fee-Rates | 2026-09-23 | global | VIP 0 maker and taker, section 2 |
| S5 | VIP Levels and Discounts | https://support.astralx.com/hc/en-001/articles/6735922392335-VIP-Levels-and-Discounts | 2026-09-23 | global | unreadable, section 4 |
| S6 | Mark Price, updated 2026-08-25 | https://support.astralx.com/hc/en-001/articles/7249041373839 | 2026-09-23 | global | funding formula, section 6 |
| S9 | Trading Parameters, updated 2026-09-02 | https://support.astralx.com/hc/en-001/articles/14923495986703 | 2026-09-23 | global | margin tiers, section 7 |
| S10 | Perpetual Futures Maker Exclusive Offer, and its early termination notice | https://support.astralx.com/hc/en-001/articles/16337418431119 and https://support.astralx.com/hc/en-001/articles/16401382008079 | 2026-09-23 | global | maker promotion dates, KYC, section 5 |
| S12 | help center sections "TradFi", "Protocol" and "Trading Fees", listed through `/api/v2/help_center/en-001/sections/<id>/articles.json` | https://support.astralx.com/hc/en-001 | 2026-09-23 | global | TradFi and stock products, rebate articles, sections 3 and 5 |
| S13 | Announcement on the Delisting of ORDI, W, PNUT, and RIVER U-Standard Contracts | https://support.astralx.com/hc/en-001/articles/16751184623247 | 2026-09-23 | global | delisting, section 7 |
| S14 | `www.astralx.com` web front JavaScript, chunk `6353-8b2c4ccebb467228.js` for the socket hosts | https://www.astralx.com/_next/static/chunks/6353-8b2c4ccebb467228.js | 2026-09-23 | global | product hosts, section 3 |
| S15 | CCXT master `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-09-23 | CCXT | no class, section 8 |
| S18 | OKX public funding rate | https://www.okx.com/api/v5/public/funding-rate | 2026-09-23 | OKX | comparison, section 6 |
| S20 | Futures Liquidation, updated 2026-08-25 | https://support.astralx.com/hc/en-001/articles/6736290774543 | 2026-09-23 | global | liquidation, section 7 |
| S21 | USD-M Futures Trading and COIN-M Futures Trading | https://support.astralx.com/hc/en-001/articles/6735978171279 | 2026-09-23 | global | no coin-margined contract named, section 3 |
| P1 | `rest-probe.mjs catalog`, `access`, `latency`, `compare`, `anchor` at 06:44 to 06:45 UTC and again at 06:55 to 06:57 UTC, `compare` again at 07:04 and 07:05 UTC, `catalog` again at 07:05 and 07:07 UTC and `access` again at 07:09 UTC after fields were added | [`rest-probe.mjs`](../../../scripts/probes/venues/astralx/rest-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 1 to 8 |
