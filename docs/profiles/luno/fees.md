# Luno Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 01:24 to 01:39 UTC, from the development host near Seattle.

This profile covers spot trading on the Luno Exchange (CCXT id `luno`), because Luno lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/luno/ws-probe.mjs).
The help centre pages at `guide.luno.com` answered this host with HTTP 403 and a Cloudflare challenge (`cf-mitigated: challenge`), and WebFetch got 403 as well.
Their text was read through the public Zendesk article API of the same help centre, `https://guide.luno.com/api/v2/help_center/en-gb/articles/<id>.json`, which answered 200.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22, help centre articles updated between 2026-08-11 and 2026-09-21 | S1 to S8, S10 to S12, S14 |
| contracting entity in the terms served to this host | Luno (Pty) Ltd, "a company incorporated under the laws of South Africa", terms last updated 14 May 2026 | S9 |
| licence line on the same page | "Luno (Pty) Ltd is an authorised financial services provider (FSP No. 53314), and registered credit provider (NCRCP22123)." | S9 |
| countries where a person may open an account | Kenya, Nigeria, South Africa, Indonesia and Malaysia, for residents of those countries | S7 |
| business accounts | South Africa, Nigeria, Kenya, Uganda, Malaysia and Indonesia, and case by case elsewhere | S8 |
| excluded regions | 33 named countries, among them China, Russia, Iran, North Korea, Egypt, Morocco, Qatar and Ukraine, plus any country under a US embargo, UN sanctions or the HM Treasury regime | S7, S8, S9 |
| US persons | may not open an account: the United States is not a supported country, and only residents of a supported country may sign up | S7 |
| UK | the help centre says "Luno is not regulated in the UK" | S10 |

The entities behind the Malaysian, Indonesian, Nigerian and Kenyan accounts were not verified, because the licence page on `www.luno.com` is rendered by script and its text did not reach this host.
The catalog still lists `GBP` and `AUD` markets, see section 3, although neither country is on the supported list.

Luno's fee schedule is per country.
A trader pays the schedule of the country the account is verified in, S1: "Select the country/region your Luno account is verified in to see the fees and transaction limits that apply to you".

## 2. Quick answer

The markets that matter to the engine are the 16 quoted in USDT or USDC, the settlement family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), see [`rest.md`](./rest.md) section 2.
Luno files them under "Crypto/crypto pairs".

| schedule | VIP 0 taker | VIP 0 maker | source |
|---|---|---|---|
| South Africa, crypto/crypto pairs | 0.10 %, 1,000 ppm | 0.08 %, 800 ppm | S2 |
| Nigeria, all pairs except USDT/NGN and USDC/NGN | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S3 |
| Kenya, all pairs | 0.10 %, 1,000 ppm | -0.01 %, -100 ppm | S4 |
| Uganda, all pairs | 0.10 %, 1,000 ppm | 0 %, 0 ppm | S5 |
| Malaysia, all pairs, no crypto/crypto pair offered | 0.60 %, 6,000 ppm | 0.35 %, 3,500 ppm | S6, S11 |
| Indonesia, no crypto/crypto pair offered | 0.2122 % buy and 0.3722 % sell | 0.1122 % buy and 0.2822 % sell | S12 |

The USDT and USDC pairs cost a VIP 0 taker 0.10 %, 1,000 ppm, in every country that offers them.
The maker differs by country, and this profile uses South Africa's 0.08 %, 800 ppm, as the reference, because the contracting entity in S9 is South African.
CCXT reports a taker of 0.001, 1,000 ppm, and a maker of 0, see section 8.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | 145 of 145 catalog rows are spot in P1 and P5, no market id looks like a contract, and CCXT sets `'swap': false` at `server/node_modules/ccxt/js/src/luno.js` line 31 |
| dated futures | absent | CCXT `'future': false` at line 32, and no row in the catalog |
| options | absent | CCXT `'option': false` at line 33 |
| margin | absent | CCXT `'margin': false` at line 30 |
| spot | present, 145 markets, all `ACTIVE` | `GET /api/exchange/1/markets` in P1 and P5 |
| tokenised stocks and ETFs, prediction markets | present in South Africa, outside the exchange API | S2 |

The spot quotes on 2026-09-22 were 51 `MYR`, 25 `ZAR`, 14 `USDT`, 14 `NGN`, 13 `XBT`, 8 `IDR`, 4 `KES`, 4 `UGX`, 4 `AUD`, 2 `USDC`, 2 `GBP`, 2 `ZARU`, 1 `ADA` and 1 `XRP`, in P1 and P5.
CoinGecko ranks Luno 25th by trust score with a score of 8, and gave it 208 BTC of 24 h volume on 49 tickers on 2026-09-22, S13.
Deposit, withdrawal, card, staking and bundle fees are in the per country articles "Luno fees and limits in <country>", S2 to S6 and S12, and are not recorded here.

## 4. Spot tiers

### South Africa

Taker, from S2.

| tier | 30 day volume | USDT/ZAR and USDC/ZAR | other crypto/ZAR | crypto/crypto |
|---:|---|---:|---:|---:|
| 1 | R0 to R20,000 | 0.20 % | 0.60 % | 0.10 % |
| 2 | R20,000 to R200,000 | 0.20 % | 0.50 % | 0.10 % |
| 3 | R200,000 to R1,000,000 | 0.20 % | 0.40 % | 0.10 % |
| 4 | R1,000,000 to R2,000,000 | 0.20 % | 0.30 % | 0.09 % |
| 5 | R2,000,000 to R5,000,000 | 0.20 % | 0.20 % | 0.08 % |
| 6 | R5,000,000 to R10,000,000 | 0.10 % | 0.15 % | 0.07 % |
| 7 | R10,000,000 to R20,000,000 | 0.10 % | 0.10 % | 0.06 % |
| 8 | R20,000,000 to R40,000,000 | 0.09 % | 0.09 % | 0.06 % |
| 9 | R40,000,000 to R80,000,000 | 0.08 % | 0.08 % | 0.06 % |
| 10 | R80,000,000 to R120,000,000 | 0.07 % | 0.07 % | 0.05 % |
| 11 | R120,000,000 to R160,000,000 | 0.06 % | 0.06 % | 0.05 % |
| 12 | R160,000,000 to R300,000,000 | 0.05 % | 0.05 % | 0.04 % |
| 13 | over R300,000,000 | 0.05 % | 0.05 % | 0.03 % |

Maker, from S2.

| tier | USDT/ZAR and USDC/ZAR | other crypto/ZAR | crypto/crypto |
|---:|---:|---:|---:|
| 1 | -0.01 % | 0.40 % | 0.08 % |
| 2 | -0.01 % | 0.30 % | 0.07 % |
| 3 | -0.01 % | 0.20 % | 0.06 % |
| 4 | -0.01 % | 0.10 % | 0.05 % |
| 5 | -0.01 % | 0.08 % | 0.04 % |
| 6 | -0.01 % | 0.06 % | 0.03 % |
| 7 | -0.01 % | 0 % | 0.02 % |
| 8 | -0.01 % | 0 % | 0.01 % |
| 9 | -0.01 % | -0.01 % | 0.01 % |
| 10 | -0.01 % | -0.01 % | 0.01 % |
| 11 | -0.02 % | -0.02 % | 0.01 % |
| 12 | -0.02 % | -0.02 % | 0.01 % |
| 13 | -0.02 % | -0.02 % | 0.01 % |

The general fee article S1 disagrees with this table on the bands.
Its example puts R16 million in "Tier 6" at 0.15 % taker and 0.06 % maker, and R20 million in "Tier 7" at 0.10 % and 0 %.
Those rates are the "other crypto/ZAR" column of tiers 6 and 7 above, but the table puts R16 million in tier 7.
The per country table S2 was edited on 2026-09-17 and the example in S1 on 2026-01-30, so S2 is taken as current.

### Other countries

| country | tiers | VIP 0 taker | top tier taker | VIP 0 maker | top tier maker | source |
|---|---:|---:|---:|---:|---:|---|
| Nigeria, all pairs but the two stablecoin pairs | 11 | 0.10 % | 0.05 % above ₦15,000,000,000 | 0.10 % | -0.02 % | S3 |
| Nigeria, USDT/NGN and USDC/NGN | 11 | 0.10 % | 0.05 % | -0.01 % | -0.02 % | S3 |
| Kenya | 6 | 0.10 % | 0.05 % above KSh 1,500,000,000 | -0.01 % | -0.02 % | S4 |
| Uganda | 8 | 0.10 % | 0.03 % above Sh 32 million | 0 % | 0 % | S5 |
| Malaysia | 9 | 0.60 % | 0.13 % above RM 14,000,000 | 0.35 % | 0 % from RM 1,000,000 | S6 |
| Indonesia | 1 | 0.2122 % buy, 0.3722 % sell | same | 0.1122 % buy, 0.2822 % sell | same | S12 |

The Indonesian fee "includes Final Income tax (FIT) of 0.21% for selling, plus a 0.0111% fee that goes to CFX", S12.

### Qualification

The tier is set by the 30 day volume "excluding the current day", recalculated "each day at midnight, 00h00 GMT", S1.
The volume sums "all of your trading activity across all markets on the Luno Exchange platform over the last 30 days (converted to your primary currency)", S2.
So a trader's crypto/crypto tier depends on ZAR, NGN or KES volume, not on the USDT volume itself.

## 5. Discounts that change the taker

| discount | effect | end | source |
|---|---|---|---|
| USDT/ZARU and USDC/ZARU promotion | taker 0.05 % at every tier, and the maker rebate of USDT/ZAR and USDC/ZAR | 3 November 2026 | S2 |
| business accounts | "the possibility of customised fee arrangements" | none stated | S8 |
| token holding, referral rebate, market maker programme | none published in the articles read | | S1 to S6 |

The ZARU promotion does not touch the USDT and USDC crypto/crypto pairs the engine would read.

## 6. Funding as a cost

None.
Luno lists no perpetual, so no funding rate, interval or settlement exists, see section 3 and [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

No liquidation or settlement charge exists on spot.
The exchange has a circuit breaker, S14.
"Every 5 minutes, our automated monitoring systems calculate the average volume-weighted trade price, and if there are any price movements that are 10% higher or lower than the average, the circuit breaker is triggered."
"When the circuit breaker triggers, trading is halted for a period of 5 minutes."
"During this time, only post-only limit orders are processed."
On the stream a halt arrives as a `status_update`, see [`websocket.md`](./websocket.md) section 4.
No delisting charge is published in the articles read.

## 8. CCXT

| item | value | source |
|---|---|---|
| exchange level fees | `'tierBased': true`, `'percentage': true`, `'taker': this.parseNumber('0.001')`, `'maker': this.parseNumber('0')` | `server/node_modules/ccxt/js/src/luno.js` lines 220 to 227, taker at line 224, maker at line 225 |
| how a market gets them | `deepExtend(this.safeMarketStructure(), {...}, this.fees['trading'], value)` | `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3732 to 3735 |
| `market.taker` for `BTC/USDT` without credentials | `0.001`, 1,000 ppm | P1 and P5 |
| `market.maker` for `BTC/USDT` without credentials | `0` | P1 and P5 |
| per account fee | `fetchTradingFee` calls the private `fee_info` endpoint | `luno.js` lines 1210 to 1234, the call at line 1218 |

CCXT's taker equals the published VIP 0 crypto/crypto taker in every country that offers those pairs.
CCXT's maker of 0 matches Uganda only, and is 800 ppm under South Africa's crypto/crypto maker.

## 9. Recommended registry values

None today.
The connector keeps only markets with `type === 'swap'`, `swap === true` and `active !== false`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203, and logs `no usable swap markets; skipping the venue` when none remain, at lines 49 to 52.
Luno would contribute zero markets, so a registry entry would do nothing.

If a later design ever admits spot legs, the values would be `takerPpm: 1000` and `ccxtTakerPpm: 1000`.
The reason is that CCXT's constant at `luno.js` line 224 equals the published VIP 0 crypto/crypto taker, S2 to S5.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | What are the fees for trading on the Luno Exchange?, updated 2026-09-21, edited 2026-01-30 | https://guide.luno.com/hc/en-gb/articles/11035643557277 | 2026-09-22 | Luno, all countries | per country schedule, 30 day volume rule, the Tier 6 example, sections 1 and 4 |
| S2 | Luno fees and limits in South Africa, edited 2026-09-17 | https://guide.luno.com/hc/en-gb/articles/14158595648541 | 2026-09-22 | South Africa | taker and maker tables, ZARU promotion, tokenised stocks, sections 2 to 5 |
| S3 | Luno fees and limits in Nigeria, updated 2026-08-24 | https://guide.luno.com/hc/en-gb/articles/14962563616157 | 2026-09-22 | Nigeria | tiers, section 4 |
| S4 | Luno fees and limits in Kenya, updated 2026-09-16 | https://guide.luno.com/hc/en-gb/articles/22778038728605 | 2026-09-22 | Kenya | tiers, section 4 |
| S5 | Luno fees and limits in Uganda, updated 2026-08-11 | https://guide.luno.com/hc/en-gb/articles/14962780234525 | 2026-09-22 | Uganda | tiers, section 4 |
| S6 | Luno fees and limits in Malaysia, updated 2026-08-29 | https://guide.luno.com/hc/en-gb/articles/14581451031709 | 2026-09-22 | Malaysia | tiers, section 4 |
| S7 | Which countries can I use my Luno account in?, updated 2026-09-01 | https://guide.luno.com/hc/en-gb/articles/11035628803101 | 2026-09-22 | all | supported and unsupported countries, section 1 |
| S8 | Which countries can I use my Luno Business account in?, updated 2026-09-15 | https://guide.luno.com/hc/en-gb/articles/34989364367773 | 2026-09-22 | all | business countries, custom fees, sections 1 and 5 |
| S9 | Luno Terms of Use, last updated 14 May 2026 | https://www.luno.com/legal/terms-of-use | 2026-09-22 | Luno (Pty) Ltd, South Africa | entity, licence line, sanctions clause, section 1 |
| S10 | Is Luno regulated?, updated 2026-08-31 | https://guide.luno.com/hc/en-gb/articles/11035604867485 | 2026-09-22 | UK note | section 1 |
| S11 | Which trading pairs are available on the Luno Exchange?, updated 2026-09-21 | https://guide.luno.com/hc/en-gb/articles/11035603693597 | 2026-09-22 | all | pairs per country, no crypto/crypto in Malaysia and Indonesia, section 2 |
| S12 | Luno fees and limits in Indonesia, updated 2026-08-18 | https://guide.luno.com/hc/en-gb/articles/14962638427165 | 2026-09-22 | Indonesia | fees with tax, section 4 |
| S13 | CoinGecko exchange API, `luno` | https://api.coingecko.com/api/v3/exchanges/luno | 2026-09-22 | CoinGecko | trust rank, score, volume, section 3 |
| S14 | The circuit breaker for traders explained, updated 2026-09-21 | https://guide.luno.com/hc/en-gb/articles/11035596105629 | 2026-09-22 | all | halt rule, section 7 |
| S15 | CCXT 4.5.68 `luno.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/luno.js` | 2026-09-22 | CCXT | sections 3 and 8 |
| P1 | `rest-probe.mjs main` at 01:29 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) | 2026-09-22 | this host | catalog, CCXT fees, sections 3 and 8 |
| P5 | `rest-probe.mjs main`, second pass at 01:37 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/luno/rest-probe.mjs) | 2026-09-22 | this host | the same, second reading |

The probe ids match those of [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).
