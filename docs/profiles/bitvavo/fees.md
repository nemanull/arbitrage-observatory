# Bitvavo Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 01:21 and 01:33 UTC on 2026-09-23.

Bitvavo (CCXT id `bitvavo`) lists no perpetual, no dated future and no option on 2026-09-22.
This profile therefore covers its spot market, as template change 1 of the venue survey plan says.
Margin trading exists as a spot borrowing product in the app only, and it is named in the coverage matrix.
Deposit, withdrawal and staking schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitvavo/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitvavo/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| CoinGecko listing | "Bitvavo", country Netherlands, established 2018, trust score 9, trust score rank 15, 5,974.7 and 5,946.5 BTC of 24 h volume in two reads | Probed | S11, `rest-probe.mjs main`, tag `coingecko_exchange` |
| CoinGecko derivatives list | Bitvavo is absent from all 214 derivatives venues | Probed | S11, tag `coingecko_derivatives` |
| legal entity | "Bitvavo B.V. is officially licensed as a Crypto-Asset Service Provider (CASP) under the Markets in Crypto-Assets Regulation (MiCAR). This license is granted by the AFM" | Published | S5 |
| licensed services | custody and administration of crypto-assets, operation of a trading platform, and transfer services | Published | S5 |
| who may trade | a resident of one of 24 listed SEPA countries: Austria, Belgium, Bulgaria, Czech Republic, Denmark, Estonia, Finland, France, Germany, Ireland, Italy, Latvia, Lithuania, Luxembourg, Malta, Netherlands, Norway, Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden. Residents of 13 overseas regions, among them Réunion, the Canary Islands, Curaçao and Aruba, may register but need an ID or IBAN from a listed country to complete verification | Published | S4 |
| excluded regions | "At this time, Bitvavo only supports users who reside within the SEPA zone. It's not possible to create an account from countries outside this region." | Published | S4 |
| whether US persons may trade | No for a US resident, since the United States is outside the SEPA zone. The case of a US citizen resident in a listed country is Not publicly specified | Published | S4 |
| fee page from this host | `https://bitvavo.com/en/fees` answered 403 with `cf-mitigated: challenge` and the title "Just a moment...", which is a Cloudflare browser challenge. The WebFetch tool got 403 as well. Every other `bitvavo.com` page tried answered the same way | Probed | `curl` on 2026-09-22 |
| fee schedule used here | the Internet Archive capture of the fee page of 2025-11-13, the newest capture that answered 200. The four captures from 2026-01-14 to 2026-09-19 all recorded the 403 challenge | Published, ten months old | S2 |
| help center and API docs from this host | `docs.bitvavo.com` answered 200. The help center pages answered 403, and its public Zendesk JSON API at `support.bitvavo.com/api/v2/help_center/` answered 200, which is how S3 to S8 were read | Probed | `curl` on 2026-09-22 |
| public API from this host | every public REST and WebSocket call answered without a challenge, through the Cloudflare colo `YVR` | Probed | [`rest.md`](./rest.md) section 1 |

Reading public market data is not an account service, and Bitvavo did not refuse it.
Trading is another matter: an account needs residence in the SEPA zone, so the operator of this host could not open one from the United States.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, fee category A (422 of 438 markets, among them `BTC-EUR`) | 0.15 % = 1,500 ppm | 0.25 % = 2,500 ppm | Published on 2025-11-13. The 0.25 % taker is confirmed on 2026-09-22 by S3, which reserves "the maximum fee of 0.25%" on a resting order | S2, S3, the first tier of CCXT's table at `server/node_modules/ccxt/js/src/bitvavo.js` lines 232 and 243 |
| spot, other categories | 0.05 % to 0.15 % | 0.05 % to 0.25 % on the 2025-11-13 page | Published, but the letters on the wire no longer match that page, see section 4 | S2, `rest-probe.mjs main`, tag `markets` |
| perpetuals | Not offered | Not offered | | section 3 |

The engine models a taker cross, so 2,500 ppm is the number that matters.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| spot | yes, researched | 438 markets: 437 `trading` and 1 `halted` (`WMTX-EUR`). 427 quoted in EUR and 11 in USDC | Probed, `GET /v2/markets`, see [`rest.md`](./rest.md) section 2 |
| USDT-M, USDC-M or coin-M perpetuals | Not offered | 0 | CCXT has `swap: false` at `server/node_modules/ccxt/js/src/bitvavo.js` line 32 and builds every market as `type: 'spot'` at lines 493 to 498. CCXT 4.5.68 `loadMarkets` returned 438 spot and 0 swap markets. The REST and WebSocket specs S9 have no derivatives call. CoinGecko's derivatives list does not show Bitvavo |
| dated futures | Not offered | 0 | as above, `future: false` at line 33 |
| options | Not offered | 0 | as above, `option: false` at line 34 |
| margin trading | yes, app only, not researched | up to 5x leverage, shorts by borrowing crypto against euros, longs by borrowing stablecoins such as EURC, still "being rolled out" | S6. The word margin does not occur in either API spec, so there is no API access, S9 |
| deposit, withdrawal, staking | looked up on `https://bitvavo.com/en/fees` | | S2 |

Bitvavo margin is not a perpetual.
It has no funding rate, no mark price and no contract, and it charges an hourly borrowing fee instead, see section 6.

## 4. Spot tiers

The tier is set by the 30 day trading volume in EUR across all Bitvavo crypto markets, recalculated "nightly around 01:00 UTC", S3.
Trades on stablecoin pairs do not count toward that volume, S2.
Personal fee deals are refused: "It is not possible to have personalized fees or agree on these in advance.", S3.

### Category A, from the page captured on 2025-11-13

| 30 day volume | maker | taker | taker in ppm | CCXT 4.5.68 taker | CCXT 4.5.68 maker |
|---|---:|---:|---:|---:|---:|
| €0 + | 0.15 % | 0.25 % | 2,500 | 0.0025 | 0.0015 |
| €100,000 + | 0.10 % | 0.20 % | 2,000 | 0.0020 | 0.0010 |
| €250,000 + | 0.08 % | 0.16 % | 1,600 | 0.0016 | 0.0008 |
| €500,000 + | 0.06 % | 0.12 % | 1,200 | 0.0012 | 0.0006 |
| €1,000,000 + | 0.05 % | 0.10 % | 1,000 | 0.0010 | 0.0005 |
| €2,500,000 + | 0.04 % | 0.08 % | 800 | 0.0008 | 0.0004 |
| €5,000,000 + | 0.04 % | 0.06 % | 600 | 0.0006 | 0.0004 |
| €10,000,000 + | 0.00 % | 0.05 % | 500 | 0.0005 | 0.0003 |
| €25,000,000 + | 0.00 % | 0.02 % | 200 | 0.0004 | 0.0003 |
| €100,000,000 + | 0.00 % | 0.01 % | 100 | absent | absent |
| €500,000,000 + | 0.00 % | 0.01 % | 100 | absent | absent |

The CCXT columns are the tier table at `server/node_modules/ccxt/js/src/bitvavo.js` lines 230 to 253.
The taker column agrees with the page up to €10,000,000 and the maker column up to €5,000,000.
Above those, CCXT keeps a dearer table, and it stops at €25,000,000.

### The other categories on 2025-11-13

| category on the 2025-11-13 page | markets named | VIP 0 maker | VIP 0 taker | lowest taker |
|---|---|---:|---:|---:|
| B | stablecoin pairs `USDC/EUR`, `EURC/EUR`, `EUROP/EUR` | 0.10 % | 0.10 % | 0.01 % from €1,000,000 |
| C | "All other euro pairs" | 0.15 % | 0.25 % | 0.04 % from €25,000,000 |
| D | "USDC markets" | 0.05 % | 0.05 % | 0.01 % from €100,000,000 |

### The categories on the wire on 2026-09-22

Each market in `GET /v2/markets` carries a `feeCategory`, which the REST spec describes as "The fee category of the market", S9.

| `feeCategory` | markets on 2026-09-22 | what they are |
|---|---:|---|
| `A` | 422 | every EUR crypto market, and the halted `WMTX-EUR` |
| `B` | 10 | `BTC-USDC`, `ETH-USDC`, `SOL-USDC`, `XRP-USDC`, `DOGE-USDC`, `PEPE-USDC`, `TIA-USDC`, `SUI-USDC`, `ADA-USDC`, and `USDCV-USDC` |
| `C` | 5 | `USDC-EUR`, `EURC-USDC`, `EUROP-EUR`, `EURCV-EUR`, `USDCV-EUR` |
| `D` | 1 | `EURC-EUR` |

Source: `rest-probe.mjs main`, tag `markets`, identical in both runs.
The wire's `B` holds the USDC markets that the 2025-11-13 page called `D`, and the wire's `C` holds stablecoin pairs that the page called `B`.
So the page has been renumbered since that capture, and which rate each letter now carries is Not verified.
Category `A` still holds `BTC-EUR` and every other EUR crypto market, and its 0.25 % first-tier taker is confirmed by S3 on 2026-09-22.
S3 also says "Trading pairs involving USDC (USD Coin) typically have lower fees than Euro-based pairs."
The account's own rate per market comes from `GET /v2/account/fees?market=`, which needs an API key, S10.

## 5. Discounts that change the spot taker

| discount | effect | label | evidence |
|---|---|---|---|
| exchange token | none, Bitvavo has no fee token | Not publicly specified | S2, S3 name none |
| referral | "Every new user who registers with a referral or affiliate link automatically receives € 10.000 in fee-free trading during their first 7 days." The referrer earns 15 % of the referred user's trading fees | Published | S8 |
| market maker program | the 2025-11-13 page speaks of "attractive rates for high-volume traders and market makers" and names no program | Not publicly specified | S2 |
| personalized fees | refused, "The fees shown on our fee page apply equally to everyone." | Published | S3 |
| zero fee promotion | none found | Not publicly specified | S2, S3 |

The referral window is a one-off for a new account, so the engine's steady taker is the category A first tier.

## 6. Funding as a cost

Spot has no funding.
Margin positions pay a borrowing fee "expressed as an hourly rate (% per hour), which varies depending on the asset", accrued hourly and deducted when the position closes, with an example of 0.0023 % per hour, S7.
That is an interest charge on a spot loan and not a perpetual funding payment, and it plays no part in the engine's model.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| margin liquidation fee | "an additional 2% liquidation fee is applied on top of the standard trading and borrowing fees" | S7 |
| settlement | none, spot settles on the trade | |
| delisting | the market status enum is `trading`, `halted`, `auction`, `auctionMatching` and `cancelOnly`, S9. A halted market answers `getBook` with error 431, see [`rest.md`](./rest.md) section 6. No delisting charge is published | S9, probe |
| fee rounding | "Fiat transactions are rounded to two decimal places. Crypto transactions are rounded to eight decimal places." so a fee always meets or exceeds the percentage | S3 |

## 8. CCXT

CCXT 4.5.68 without credentials reports `market.taker` 0.0025 and `market.maker` 0.002 on all 438 markets, from `rest-probe.mjs main`, tag `ccxt`, in both runs.
`parseMarkets` copies `fees['trading']['taker']` and `['maker']` into every market at `server/node_modules/ccxt/js/src/bitvavo.js` lines 508 and 509.
Those constants are `'taker': this.parseNumber('0.0025')` and `'maker': this.parseNumber('0.002')` at lines 228 and 229.

The taker constant matches the published first tier.
The maker constant does not: CCXT's own tier table starts at 0.0015 at line 243, and the published first-tier maker is 0.15 %, S2.
Every market gets the category A constant, so a USDC market that is cheaper on the fee page still reads 0.0025 in CCXT.
`fetchTradingFees` at line 954 reads the account's real rate and needs a key.

## 9. Recommended registry values

Bitvavo has no perpetual, so the engine's catalog would load no market from it and skip the venue.
`isActiveSwapMarket` keeps only `type === 'swap'` markets at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203, and a venue with no market is skipped at lines 49 to 51.
No registry entry is recommended.

If the engine ever takes a spot leg, the values would be these.

| field | value | reason |
|---|---|---|
| `takerPpm` | 2,500 | the category A first-tier taker, which covers `BTC-EUR` and every EUR crypto market, S2 and S3 |
| `ccxtTakerPpm` | 2,500 | the constant at `server/node_modules/ccxt/js/src/bitvavo.js` line 228, which the connector compares with `market.taker` |

A USDC market's own rate would need a per-market override, and its current value is Not verified, see section 4.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitvavo fees page | https://bitvavo.com/en/fees | 2026-09-22, 403 Cloudflare challenge to `curl` and to WebFetch | Bitvavo B.V. | section 1 |
| S2 | Bitvavo fees page, Internet Archive capture of 2025-11-13 10:33:13 UTC | http://web.archive.org/web/20251113103313/https://bitvavo.com/en/fees | 2026-09-22 | Bitvavo B.V. | tier tables and categories, stablecoin volume rule, sections 2 to 5 |
| S3 | What is the trading fee when I buy or sell crypto?, updated 2026-09-22 | https://support.bitvavo.com/hc/en-us/articles/4405175148689 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V. | 0.25 % maximum fee, 30 day tier, 01:00 UTC recalculation, rounding, no personal fees |
| S4 | In which countries can I use Bitvavo?, updated 2026-09-21 | https://support.bitvavo.com/hc/en-us/articles/4405238046993 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V. | eligible countries and regions, SEPA only |
| S5 | What does Bitvavo's MiCAR license from the AFM mean for me?, updated 2026-09-12 | https://support.bitvavo.com/hc/en-us/articles/4405243980945 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V., Netherlands | legal entity and licence |
| S6 | What is margin trading and how does it work?, updated 2026-09-22 | https://support.bitvavo.com/hc/en-us/articles/38119430437393 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V. | margin product, leverage up to 5x |
| S7 | What fees do I pay for margin trading?, updated 2026-09-20 | https://support.bitvavo.com/hc/en-us/articles/47113521166097 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V. | hourly borrowing fee, 2 % liquidation fee |
| S8 | How does the Bitvavo Friend Referral Program work?, updated 2026-08-21 | https://support.bitvavo.com/hc/en-us/articles/4405239714577 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V. | referral fee-free volume and rebate |
| S9 | Bitvavo Exchange REST API and WebSocket API specs, version 2.10.0 | https://docs.bitvavo.com/api-specs/exchange-rest-api.yaml and https://docs.bitvavo.com/api-specs/exchange-websocket-api.yaml | 2026-09-22 | Bitvavo B.V. | `feeCategory`, market status enum, no derivatives or margin call |
| S10 | Get market fees | https://docs.bitvavo.com/docs/rest-api/get-market-fees/ | 2026-09-22 | Bitvavo B.V. | per-market account fee needs a key |
| S11 | CoinGecko API, `exchanges/bitvavo` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/bitvavo | 2026-09-22 | CoinGecko | trust rank, volume, absence from derivatives |
| S12 | CCXT 4.5.68 `bitvavo.js` | `server/node_modules/ccxt/js/src/bitvavo.js` | 2026-09-22 | CCXT | fee constants and tiers, spot-only market build, sections 3, 4 and 8 |
| P1 | `rest-probe.mjs main`, runs at 01:21 and 01:32 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitvavo/rest-probe.mjs) | 2026-09-22 | this host | catalog counts, fee categories, CCXT fields, CoinGecko |
