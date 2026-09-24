# Bit2c Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:08 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers Bit2c (CCXT id `bit2c`), an Israeli spot exchange that lists no perpetuals, so it is profiled on its spot market as the survey plan's template change 1 asks.
The official pages are in Hebrew, except the API page, whose public section is in English.
Every quoted rate below comes from the fee page S1 as served on 2026-09-22, and the Hebrew headings are translated in place.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | `ביטוסי איטורו בע"מ`, company number 517169447, 30 Derech Sheshet HaYamim, Bnei Brak, Israel | S2, S3 |
| licence | extended financial asset service licence number 72080 from the Israel Capital Market, Insurance and Savings Authority | S2, S3 |
| operating since | 2013 | S3, and CoinGecko `year_established` 2013, S6 |
| who may trade | residents of Israel who hold an Israeli identity card and are 18 or older, with registration and service in Hebrew only | S2 |
| excluded | everyone else, so a US person who is not an Israeli resident with an Israeli identity card may not open an account | S2 |
| governing law | Israeli law, courts of the Tel Aviv district | S2 |
| trading hours | 24/7, 365 days a year, apart from occasional maintenance | S5 |
| fees include VAT | "כל העמלות כוללות מע"מ", all fees include VAT | S1 |

The terms say the site's services "ניתנים בעברית ומיועדים לתושבי ישראל בלבד, הנושאים תעודת זהות ישראלית, שמלאו להם 18 שנים", which is "given in Hebrew and intended for residents of Israel only, holding an Israeli identity card, aged 18 or over", S2.

Access from this host is recorded as fact in [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5.
Every public REST call and the site's socket answered normally through the Canadian VPN exit, and no geoblock or refusal was seen.

## 2. Quick answer

The exchange product, which the fee page calls "Bit2C Pro", charges one rate for maker and taker alike at every tier.

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot order book, every NIS pair | 1.25 %, 12,500 ppm | 1.25 %, 12,500 ppm | S1, column "עמלת מייקר/טייקר", maker/taker fee, tier 1 |
| perpetuals | absent | absent | section 3 |

CCXT 4.5.68 disagrees, and its per market `taker` is not set at all, see section 8.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no derivatives page, fee row or API call on S1, S4 or S5, CCXT `has.swap` false at `server/node_modules/ccxt/js/src/bit2c.js` line 30 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | CCXT `has.future` false at line 31, none on the site |
| options | absent | CCXT `has.option` false at line 32, none on the site |
| margin | absent | CCXT `has.margin` false at line 29, none on the site |
| spot order book | present, 4 live pairs: `BtcNis`, `EthNis`, `LtcNis`, `UsdcNis` | S4, and [`rest.md`](./rest.md) section 2 |
| spot pairs named but dead | 6: `BchabcNis`, `BchsvNis`, `EtcNis`, `BtgNis`, `GrinNis`, `LtcBtc` | the ticker answers with null bid and ask and zero volume, and the book call redirects, [`rest.md`](./rest.md) section 2 |
| broker, instant conversion | present, not an order book | S1 section "ביטוסי ברוקר" |

Every live pair is quoted in Israeli new shekels.
NIS is outside the USD, USDC and USDT settlement family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so no Bit2c market would share a cluster with a USDT perpetual even if it were a swap.
CoinGecko lists Bit2c with trust score 3, trust score rank 143, 2 coins and 2 pairs, S6.
Its 24 h volume read 4.645 BTC at about 04:55 UTC and 4.688 BTC at 05:08 UTC on 2026-09-23, S6.
Its one ticker row was BTC/NIS, with 4.714 then 4.699 BTC of 24 h volume, about 405,848 then 406,049 USD, and a 0.74 % then 0.55 % bid and ask spread, S6.
The survey's rank 138 for Bit2c differs from the 143 that the record carried on 2026-09-23 UTC.

## 4. Spot tiers

### Bit2C Pro, the order book

The tier is set by the NIS value of the account's trading on Bit2C Pro and the broker over the 30 days before the order executes, S1.
The discount column is relative to tier 1, and the page prints one rate for maker and taker.

| tier | 30 day volume, NIS | maker and taker | ppm | discount on tier 1 |
|---|---|---:|---:|---:|
| 1 | 0 to 20,000 | 1.25 % | 12,500 | |
| 2 | 20,001 to 50,000 | 1.13 % | 11,300 | 10 % |
| 3 | 50,001 to 75,000 | 1.00 % | 10,000 | 20 % |
| 4 | 75,001 to 100,000 | 0.88 % | 8,800 | 30 % |
| 5 | 100,001 to 250,000 | 0.75 % | 7,500 | 40 % |
| 6 | 250,001 to 500,000 | 0.50 % | 5,000 | 60 % |
| 7 | 500,001 to 750,000 | 0.38 % | 3,800 | 70 % |
| 8 | 750,001 to 1,000,000 | 0.25 % | 2,500 | 80 % |
| 9 | 1,000,001 to 2,000,000 | 0.20 % | 2,000 | 84 % |
| 10 | 2,000,001 to 3,000,000 | 0.15 % | 1,500 | 88 % |
| 11 | 3,000,001 to 4,000,000 | 0.10 % | 1,000 | 92 % |
| 12 | 4,000,001 and above | 0.05 % | 500 | 96 % |

### Broker

The broker converts "at an international currency rate against Bit2C", translated from S1, rather than matching an order book, and its fee is set per trade by the trade's size, starting at 5 % for a trade of at least 50 NIS and falling to 3.2 % at 2,000,000 NIS, S1.
It is out of scope for the engine and recorded here only in this line.

### Qualification

The fee page says the tier is fixed when the order executes, from the 30 days of Pro and broker activity before it, S1.
The account API returns the account's own `FeeMaker` and `FeeTaker` per pair, as CCXT reads them at `server/node_modules/ccxt/js/src/bit2c.js` lines 511 to 526, which suggests the two can differ for an account, but the public page shows one rate.
That call needs a key and was not made.

## 5. Discounts that change the taker

| discount | exists | source |
|---|---|---|
| token holding | none published | S1 |
| referral | a referral link exists, CCXT `urls.referral` at `server/node_modules/ccxt/js/src/bit2c.js` line 125, and no fee effect is published | S1 |
| market maker programme | Not publicly specified | S1, S4 |
| zero fee promotion | none on S1 on 2026-09-22 | S1 |

## 6. Funding as a cost

Not applicable.
Bit2c lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement charge, because nothing is margined.
A monthly custody fee of up to 7 NIS for holding shekels and up to 7 NIS for holding crypto is charged at the start of each month, and it is waived for a month that follows a month with any buy, sell, deposit or withdrawal, S1.
Deposit and withdrawal fees are on the same page, section "עמלות הפקדה ומשיכה", S1.
Six pair codes still answer the ticker call with no book, see section 3, and no delisting charge is published.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `bit2c`, `pro: false`, `has.ws` false | `server/node_modules/ccxt/js/src/bit2c.js` lines 25 and 117 |
| markets | four hard coded spot markets, `BTC/NIS`, `ETH/NIS`, `LTC/NIS`, `USDC/NIS`, no `fetchMarkets` call | lines 166 to 171 |
| exchange level fee | `fees.trading.maker` 0.025 and `fees.trading.taker` 0.03, `percentage` true, `tierBased` true | lines 172 to 178 |
| exchange level tiers | 12 tiers on the same NIS thresholds as S1, taker 0.03 down to 0.002 and maker 0.025 down to 0.001 | lines 179 to 206 |
| `market.taker` | `undefined` on all four markets, printed by both runs of P1 | P1 |

Each hard coded market is built with `safeMarketStructure`, which sets `taker`, `maker`, `active`, `linear` and `contractSize` to `undefined`, at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3648 to 3655.
`setMarkets` then merges `fees.trading` under the market with `deepExtend`, at `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3732 to 3735, and `deepExtend` copies an `undefined` value over the earlier one, at `server/node_modules/ccxt/js/src/base/functions/generic.js` line 173.
So the 0.03 never reaches the market, and `market.taker` is `undefined`.

The exchange level constants would also be wrong if they did reach it.
As a CCXT fraction, 0.03 is 3 %, or 30,000 ppm, against the 1.25 % on S1.
The thresholds match S1 tier for tier while every rate differs, so the CCXT table looks like an older schedule, which is an inference.

## 9. Recommended registry values

Bit2c should not be registered.
The connector keeps only active swap markets, at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 79 with the filter at lines 196 to 203, so its four spot markets give an empty catalog and the venue is skipped with "no usable swap markets", at lines 49 to 51.

If a spot stage ever takes it, `takerPpm` must be 12,500 from S1.
`ccxtTakerPpm` has no value to declare, because CCXT reports no per market taker.
Without a registry `takerPpm`, the connector's fallback to `market.taker` at line 162 goes through `toPpm`, which returns null for `undefined` at lines 180 to 183, and every market is dropped at lines 164 and 165.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bit2C fee page, "עמלת מסחר" | https://bit2c.co.il/home/Fees | 2026-09-22 | Bit2c, Israel | Pro tiers, broker fees, custody fee, VAT, sections 2, 4, 5 and 7 |
| S2 | Bit2C terms of use, "תנאי שימוש" | https://bit2c.co.il/terms-of-use | 2026-09-22 | Bit2c, Israel | operator, licence, eligibility, law, section 1 |
| S3 | Bit2C about page, "החברה שלנו" | https://bit2c.co.il/home/about | 2026-09-22 | Bit2c, Israel | operator, licence, founding year, section 1 |
| S4 | Bit2C API documentation | https://bit2c.co.il/home/api | 2026-09-22 | Bit2c, Israel | the four pairs, no derivatives calls, section 3 |
| S5 | Bit2C FAQ | https://bit2c.co.il/home/faq | 2026-09-22 | Bit2c, Israel | 24/7 trading, section 1 |
| S6 | CoinGecko exchange record `bit2c` | https://api.coingecko.com/api/v3/exchanges/bit2c | 2026-09-23 UTC | CoinGecko | trust rank, pairs, volume, section 3 |
| S7 | CCXT 4.5.68 `bit2c.js` | `server/node_modules/ccxt/js/src/bit2c.js` | 2026-09-22 | CCXT | `has`, markets, fee constants, section 8 |
| S8 | CCXT 4.5.68 base `Exchange.js` and `generic.js` | `server/node_modules/ccxt/js/src/base/Exchange.js` | 2026-09-22 | CCXT | why `market.taker` is undefined, section 8 |
| P1 | `rest-probe.mjs survey` at 04:44 and 04:59 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bit2c/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | CCXT `market.taker` `undefined` in both runs, live and dead pairs, sections 3 and 8 |
