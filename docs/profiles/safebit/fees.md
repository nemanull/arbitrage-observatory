# SAFEbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:15 to 03:45 UTC), from the development host near Seattle.

SAFEbit is the Turkish spot exchange that was Bitci TR until its 2025 rebrand, and CoinGecko still lists it under the id `bitci`, S4.
It lists no perpetual, dated future or option, so this profile covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
CCXT has no class for it, see section 8.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22, Pacific time, which was 2026-09-23 in UTC | |
| operator | Safebit Kripto Varlık Alım Satım Platformu A.Ş., Türkiye | S3, and the default company name in the web bundle, S6 |
| history | the platform was owned by Bitci Teknoloji A.Ş. from 2018 and restructured under the SAFEbit brand in 2025 | S4 |
| regulation named | Capital Markets Law No. 6362, and Capital Markets Board communiqués III-35/B.1 and III-35/B.2 on crypto asset service providers | S3 |
| other brands in the same web build | `SAFEbit España S.L.`, `SAFEbit Brasil`, `SAFEbit Georgia`, `SAFEbit Global`, `Cryptorium`, `Izzyex` | S6. Whether any of them operates was not checked, and the Turkish site is the only one CoinGecko tracks |
| agreement version | "This text was last updated on 14.10.2025." | S3 |

Who may trade, from the user agreement, S3:

- A natural person needs full legal capacity, and a minor may use the services only through a parent or guardian.
- Due diligence differs "depending on whether the Customer is a natural or legal person, a citizen of the Republic of Türkiye or a foreign national", so foreign nationals are contemplated.
- The customer declares residence "in a country where the Services provided by Safebit do not constitute a violation of the legislation of the country of residence".
- Persons on the OFAC SDN list or on UN, EU, Turkish Treasury or MASAK sanctions lists are excluded.
- The agreement names no excluded country list and does not exclude US persons by name.
  It says a citizen of the USA or the EU accepts that information may be shared with that country's authorities, which implies such customers are accepted.
- A corporate customer that uses "high-volume transactions or algorithmic trading models" must notify SAFEbit in advance.
- The agreement forbids "Accessing the Services or extracting data using any robot, spider, crawler, scraper, or other automated method or interface not provided by Safebit".
  The public aggregator API of [`rest.md`](./rest.md) is an interface SAFEbit provides, and the web app's internal calls and socket are not documented for outside use, see [`websocket.md`](./websocket.md) section 1.

Whether the onboarding flow accepts a non-Turkish phone number or identity document was not tested, because the survey opens no account.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, standard rate | 0.40 %, 4,000 ppm | 0.50 %, 5,000 ppm | S1, S2 |
| spot, `SAFE`, `ROMEO` and `LIQUID` pairs | 2 %, 20,000 ppm | 2 %, 20,000 ppm | S1, S2 |
| spot, `ROSA`, `BROSA`, `DOLO`, `PENGU`, `FLAME`, `BIO`, `BULLET` and `BITNUR` pairs | 1 %, 10,000 ppm | 1 %, 10,000 ppm | S1, S2 |
| perpetuals | absent | absent | section 3 |

The page says "Commission rates include 20% VAT", S1.
So the fee net of VAT is 0.40 / 1.2 = 0.333 % maker and 0.50 / 1.2 = 0.417 % taker, which is arithmetic and not a published number.
The page also says "Invoice information will be sent to your email address every Friday.", S1.
The Turkish page reads "Piyasa Yapıcı: %0,40" and "Piyasa Alıcı: %0,50" with the same special pairs and "Komisyon oranlarına %20 KDV dahildir!", S2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-M perpetuals | absent | no futures, perpetual, leverage or funding word in the home page, the trade page or 30 script chunks of the web app, S6. The user agreement covers buying, selling and holding crypto assets only, S3. CoinGecko's derivatives list of 214 venues does not include `bitci`, S5. The public API has no contract call, S7 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | absent as a product | the only match is an API key permission label, `"enableSpotMarginTrading":"Enable Spot and Margin Trading"`, in the web app strings, S6. No margin page, borrow call or interest schedule exists |
| spot | present | 123 pairs, 114 quoted in TRY and 9 in USDT, all `Trading`, P1 |
| other | easy buy and sell converter, staking, launchpad | links on the home page, S6. Not researched, per the scope guard |

## 4. Spot tiers

None are published.
The commissions page lists one standard maker and taker rate and two groups of special pairs, and no volume or balance tier, S1.

## 5. Discounts that change the spot taker

| discount | what is published | effect on the taker |
|---|---|---|
| per pair tags | the commissions page ships labels "0 Fee", "0 Maker", "0 Taker", with "0 Taker" described as "No commission is charged for transactions that immediately fill existing orders (liquidity takers).", S1 | which pairs carry a tag is served by the web app's internal market list, which answered 403 to this host, so Not verified |
| SAFE Arena | "A special trading area where commission-free trading is available for 1 week on pairs selected by community vote.", S1 | zero on the chosen pairs for one week. The current pairs and dates are Not verified |
| referral | the web app has calls named `CreateCustomerReferralCommisionRate` and `GetCustomerReferralCommisionRates`, S6 | account side only, no public schedule |
| loyalty | the web app has `/api/loyaltyapi/program` and a rewards catalog, S6 | no public schedule |
| token holding | none published | none |
| market maker | none published | none |

## 6. Funding as a cost

No perpetual exists, so there is no funding rate, interval or settlement.
The user agreement adds an annual commission fee: "Safebit collects an annual commission fee each year", which "accrues separately from transaction-based commissions", S3.
Its amount is "announced via the platform's website or Customer interface", S3, and it does not appear on the commissions page, S1, so the amount is Not verified.
The web app has a call named `GetCustomerMaintenanceFeeList`, S6, which is presumably where an account sees it.

## 7. Liquidation, settlement and delisting

- No liquidation charge exists, since no leveraged product exists.
- No delivery or settlement fee exists for spot.
- A delisting charge is Not publicly specified.
  On termination of the agreement, assets are "returned upon request within ninety (90) days at the latest", and without a valid wallet address they are converted to TRY and refunded, S3.
- Deposit and withdrawal rules are on the limits page, S10, and no fee schedule was found there, so none is recorded here, per the scope guard.
  The same page caps a verified account's crypto withdrawals at 3,000 USDT or equivalent per 24 hours and 50,000 USDT per 30 days, and TRY withdrawals at 20,000,000 TRY and 100,000,000 TRY, S10.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 class | none. `ccxt.exchanges` from `server/` lists 104 ids and none matches `safe` or `bitci` | P1 `ccxt` line, and `node -e "console.log(require('ccxt').exchanges)"` |
| CCXT 4.5.68 source | `grep -ril safebit server/node_modules/ccxt/js/src/` finds nothing | run on 2026-09-22 |
| CCXT master | `ts/src` of `github.com/ccxt/ccxt` holds 105 files and none matches `safe` or `bitci`, at master commit `1d8b674434` of 2026-09-22 12:48 UTC. `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/safebit.ts` returned 404 | S9 |
| `market.taker` | none, since no class exists | |

## 9. Recommended registry values

None.
SAFEbit has no perpetual, no CCXT class, no documented WebSocket, and no index, mark or funding, so it cannot join [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) as a perpetual leg.
If the spot book were ever wanted as a reference, the taker would be `takerPpm: 5000` from S1, and `ccxtTakerPpm` would stay unset because no CCXT class exists to report one.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Commissions, English | https://www.safebit.com.tr/en/page/commissions | 2026-09-22 | Safebit, Türkiye | standard and special rates, VAT, invoices, fee tag texts, sections 2, 4 and 5 |
| S2 | Komisyonlar, Turkish | https://www.safebit.com.tr/tr/page/commissions | 2026-09-22 | Safebit, Türkiye | the same numbers in Turkish, section 2 |
| S3 | User Agreement, last updated 14.10.2025 | https://www.safebit.com.tr/en/legals/user-agreement | 2026-09-22 | Safebit, Türkiye | operator, regulation, eligibility, sanctions, automated access, annual fee, termination, sections 1, 6 and 7 |
| S4 | CoinGecko exchange record `bitci` | https://api.coingecko.com/api/v3/exchanges/bitci, page https://www.coingecko.com/en/exchanges/bitci | 2026-09-22 | CoinGecko | name SAFEbit, country Turkey, the Bitci history, rebrand notice, trust rank 77 on the day, 24 h volume 0.61 BTC |
| S5 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | 214 venues, SAFEbit and Bitci absent, section 3 |
| S6 | SAFEbit web app, home and trade pages and their script chunks | https://www.safebit.com.tr/en and https://www.safebit.com.tr/en/exchange/advanced/BTC_TRY | 2026-09-22 | Safebit | brand and company names, API key labels, internal call names, absence of derivatives words, sections 1, 3, 5 and 6 |
| S7 | SAFEbit public API, Swagger `WebApplication2 v1` | https://api.safebit.com.tr/swagger/index.html and https://api.safebit.com.tr/swagger/v1/swagger.json | 2026-09-22 | Safebit | the public calls, no contract call, section 3 |
| S8 | CCXT 4.5.68 exchange list | `server/node_modules/ccxt` | 2026-09-22 | CCXT | no class, section 8 |
| S9 | CCXT master `ts/src` listing | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no class in master, section 8 |
| S10 | Limits | https://www.safebit.com.tr/en/page/limits | 2026-09-22 | Safebit, Türkiye | deposit and withdrawal caps, section 7 |
| P1 | `rest-probe.mjs catalog` at 03:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/safebit/rest-probe.mjs) | 2026-09-22 | this host | pair counts, CCXT lookup, sections 3 and 8 |
