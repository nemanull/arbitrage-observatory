# DigiFinex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:13 to 03:44 UTC, and the second pass 03:46 to 03:56 UTC, from the development host near Seattle.

This profile covers the perpetual swaps of DigiFinex (CCXT id `digifinex`), which lists 103 USDT-margined and 8 coin-margined perpetuals.
CoinGecko's derivatives list does not show DigiFinex, but the public swap API does, see [`rest.md`](./rest.md) section 2.
Every number carries a source from section 10, a probe run, or a CCXT file and line.
The help center pages answer HTTP 403 to this host and to a fetch that does not originate here, so every article was read through the Zendesk help center API at `https://support.digifinex.com/api/v2/help_center/en-us/articles/<id>.json`, which answered 200.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "DIGIFINEX LIMITED." reserves the rights in every announcement footer, and the Terms name the provider "Digifinex (the Company)" | S6, S9 |
| governing law | Singapore, with SIAC arbitration | S6 |
| registration country on CoinGecko | Seychelles, established 2018, trust score 7, trust rank 60 on 2026-09-23 UTC | S11 |
| who may trade | registered, KYC verified users outside the excluded list, S6 and S7 | S6, S7 |
| countries and regions not served | Canada, China, Cuba, Democratic Republic of the Congo, Hong Kong, Iran, Iraq, Kazakhstan, North Korea, Singapore, Sudan, Syria, the United Kingdom, the United States, India, Russia | S6 section 28 |
| US persons | may not trade: "the Platform does not accept US and Singapore citizen to register and use the platform." | S6 |
| other entities | a DigiFinex.CA spot fee page exists in the help center, and no Canadian perpetual terms were found | S12 |

The Terms article was edited on 2026-09-21, the day before retrieval.
A second article with the same title, `360011676013`, edited 2025-10-07, carries no country list, so the list above comes from `4408437730329`.

What this host saw, as fact:

- The public swap REST API answered 200 on every well formed call, and the WebSocket upgraded with 101 and streamed, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
- `https://www.digifinex.com/en-ww/fee` answered 302 to `https://www.digifinex.ca/` with the headers `is_ca_country: yes` and `country: CA`.
- `ipinfo.io` placed this host's public address in Vancouver, British Columbia, Canada, on 2026-09-23 UTC.
  So DigiFinex treats this host as Canadian, and Canada is on the not served list, while the public market data API still answered.
- `https://support.digifinex.com/hc/en-us/articles/8474764388505` answered 403 to curl from this host.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-margined perpetuals | 0.03 %, 300 ppm | 0.05 %, 500 ppm | S1, S2 |
| coin-margined perpetuals | 0.03 %, 300 ppm | 0.05 %, 500 ppm | S1, S2 |
| TradFi USDT perpetuals, promotion until 09/30 23:59, time zone and year not stated | 0 %, 0 ppm | 0.02 %, 200 ppm | S3 |

S1 dates the rates from 10:00 on 2020-10-12 (GMT+8), and S2, edited 2024-09-17, repeats them: "For perpetual contracts, the fee rates are as follows: the maker fee rate is 0.03% and the taker fee rate is 0.05%."
No perpetual VIP ladder is published, so these are the only perpetual rates on record.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals, linear | yes, 103 active | `GET /swap/v2/public/instruments`, P1 |
| coin-margined perpetuals, inverse, 1 USD per contract | yes, 8 active: BTC, ETH, FIL, DOT, XRP, UNI, TRX, LINK | P1 |
| USDC-margined perpetuals | absent | no `clear_currency` USDC in P1 |
| simulated perpetuals | 7, returned only with `type=1` | P1 |
| dated futures | absent | every row is `contract_type` `PERPETUAL`, and the docs name no other type, S13 |
| options | absent | no options API in S13 |
| spot | present, 191 spot markets in CCXT, researched no further | P1 |
| margin | present, "up to 10X leverage" | S7 |

Of the 103 USDT perpetuals, 36 carry a contract of 0.01 units and are stocks, ETFs, commodities or pre-IPO names such as `NVDAUSDTPERP`, `QQQUSDTPERP`, `CLUSDTPERP`, `OPENAIUSDTPERP` and `ANTHROPICUSDTPERP`, and `XAUTUSDTPERP` and `XAGUSDTPERP` carry 0.001, P1.

## 4. Perpetual tiers

No perpetual tier table is published.
S1 and S2 state one maker and one taker rate for every perpetual, with no volume or holding qualification.
The spot VIP program ranks users by "near 30-day transaction volume" and offers DFT discounted fees, S14, and nothing in it names perpetuals.
The private call `GET /swap/v2/account/trading_fee_rate` returns the rate for one account and one instrument, and its documented example reads `"taker_fee_rate":"0.00005"` and `"maker_fee_rate":"0.00003"`, S13, while CCXT's comment for the same call reads `0.0005` and `0.0003` at `server/node_modules/ccxt/js/src/digifinex.js` lines 3566 and 3567.
That call needs an API key and was not called.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| TradFi zero fee promotion | maker 0 %, taker 0.02 % on "almost all TradFi pairs", with `SAMSUNG` and `SKHYNIX` excluded, "Now until 09/30 23:59" | S3, edited 2026-08-17 |
| DFT holding | named only for spot, S10 and S14 | none found for perpetuals |
| referral, market maker program | Not publicly specified for perpetuals | |

S3 does not say whether the promotion applies to API orders, and it gives no time zone.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | Funding Rate Of Next Period = Premium index + Clamp(Interest Rate − Premium index, −0.05 %, 0.05 %) | S4 |
| interest rate | 0.06 % denominated less 0.03 % underlying, divided by 3 settlements a day, so 0.01 % per 8 h | S4 |
| premium index | [Max(0, depth weighted bid − index) − Max(0, index − depth weighted ask)] / index, at an impact amount of 0.1 BTC of margin | S4 |
| cap and floor | none published for the rate itself, only the clamp on the interest term | S4 |
| interval | 8 h at 00:00, 08:00 and 16:00 UTC, documented as 08:00, 16:00 and 00:00 GMT+8 | S4 |
| four hour contracts | `SKHYNIXUSDT`, `SAMSUNGUSDT`, `XAUTUSDT`, `HYUNDAIUSDT`, `XAGUSDT`, `CLUSDT`, `BZUSDT` since 2026-07-17 | S5 |
| four hour contracts seen on the wire | the seven above plus `PIUSDTPERP`, 8 of 111, from 4 h steps in the funding history | P2 |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative, only positions open at the settlement | S4 |
| venue share | "Funding is a payment between users. we do not charge any funding from users." | S4 |
| observed range | −0.00147 to 0.00148 per interval over 111 contracts in three runs, `SANDUSDTPERP` highest and `AAVEUSDTPERP` lowest | P2 |

The REST `funding_rate` call reports every contract on the 8 h grid, including the eight four hour ones, and it returns the last settled rate, not the upcoming one, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

- Liquidation triggers on the mark price, S8.
  Opening is blocked, open orders are cancelled, the position is taken over, and the insurance fund covers a deficit, S8.
  No separate liquidation fee is published, and the liquidation price formula includes the trading fee rate `n`, S8.
- Auto-deleveraging follows when a taken over position cannot be closed in the market, S8.
- A delisted perpetual is "cleared according to the market price at the time when the position was delisted", S9.
- Delisted contracts disappear from the instruments call but stay in the `all_ticker` WebSocket push, see [`websocket.md`](./websocket.md) section 2.
- Deposit, withdrawal and margin interest schedules are on S10, which is not recorded here.

## 8. CCXT

CCXT 4.5.68 has no per market fee for `digifinex`.
Every market inherits the exchange constant `'maker': this.parseNumber('0.002')` and `'taker': this.parseNumber('0.002')` at `server/node_modules/ccxt/js/src/digifinex.js` lines 350 and 351, merged into each market by `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735.
Without credentials, `market.taker` read 0.002 on all 109 swap markets `loadMarkets` returned, and `market.maker` read 0.002 too, P1.
That is 2,000 ppm, four times the documented 500 ppm perpetual taker.
The constant's `'fees'` URL points at the spot fee page, S10, at line 123.

CCXT Pro 4.5.68 has no `digifinex` class, since `server/node_modules/ccxt/js/src/pro/digifinex.js` does not exist.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | the published VIP 0 perpetual taker, S1 and S2, flat for every perpetual |
| `ccxtTakerPpm` | 2,000 | what CCXT reports for every swap market, `digifinex.js` line 351 |

The TradFi promotion would lower the taker to 200 ppm on most TradFi contracts until 09/30, but it is temporary, excludes two contracts, and the registry holds one number per venue.
So 500 is the conservative value, and the promotion is a note, not a registry entry.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 【Tutorial】DigiFinex's instructions on futures trading fee rates, edited 2024-08-29 | https://support.digifinex.com/hc/en-us/articles/8474764388505--Tutorial-DigiFinex-s-instructions-on-futures-trading-fee-rates | 2026-09-22 | DigiFinex, global | maker 0.03 %, taker 0.05 %, from 2020-10-12, sections 2 and 4 |
| S2 | [Tutorial]- Trading Fee, edited 2024-09-17 | https://support.digifinex.com/hc/en-us/articles/900000443863--Tutorial-Trading-Fee | 2026-09-22 | DigiFinex, global | the same rates, USDT-M and coin-M fee arithmetic, sections 2 and 4 |
| S3 | 【GIGABRAIN MOVE】Zero-Fee TradFi Perps on DigiFinex, edited 2026-08-17 | https://support.digifinex.com/hc/en-us/articles/61244082196249--GIGABRAIN-MOVE-Zero-Fee-TradFi-Perps-on-DigiFinex-Ape-into-Tech-AI-Giants | 2026-09-22 | DigiFinex, global | TradFi promotion, sections 2 and 5 |
| S4 | [Tutorial]- Funding Calculation, edited 2024-09-14 | https://support.digifinex.com/hc/en-us/articles/900000455266--Tutorial-Funding-Calculation | 2026-09-22 | DigiFinex, global | funding formula, interval, payer, section 6 |
| S5 | Announcement on Funding Fee Settlement Interval Adjustment for Selected TradFi Futures Pairs, 2026-07-17 | https://support.digifinex.com/hc/en-us/articles/60137916251929-Announcement-on-Funding-Fee-Settlement-Interval-Adjustment-for-Selected-TradFi-Futures-Pairs | 2026-09-22 | DigiFinex, global | four hour contracts, section 6 |
| S6 | 【Contract List】- Terms and Conditions, edited 2026-09-21 | https://support.digifinex.com/hc/en-us/articles/4408437730329--Contract-List-Terms-and-Conditions | 2026-09-22 | DigiFinex, global | not served list, US and Singapore citizens, Singapore law, section 1 |
| S7 | About DigiFinex, edited 2025-05-26 | https://support.digifinex.com/hc/en-us/articles/17903899147929-About-DigiFinex | 2026-09-22 | DigiFinex, global | KYC, margin, restricted countries summary, sections 1 and 3 |
| S8 | 【Perpetual Futures】Forced Liquidation And ADL System, edited 2024-05-29 | https://support.digifinex.com/hc/en-us/articles/900000455326--Perpetual-Futures-Forced-Liquidation-And-ADL-System | 2026-09-22 | DigiFinex, global | liquidation and ADL, section 7 |
| S9 | Announcement on DigiFinex Delisted the Following Perpetual Swaps, 2022-08-23 | https://support.digifinex.com/hc/en-us/articles/9780332798361-Announcement-on-DigiFinex-Delisted-the-Following-Perpetual-Swaps | 2026-09-22 | DigiFinex, global | delisting settlement, operator name, sections 1 and 7 |
| S10 | 【Contract List】- Fees, edited 2023-01-13 | https://support.digifinex.com/hc/en-us/articles/360000328422--Contract-List-Fees | 2026-09-22 | DigiFinex, global | spot fee 0.2 % to 0.5 %, DFT discount for spot, withdrawal lookup, sections 5 and 7 |
| S11 | CoinGecko exchange API, `digifinex` | https://api.coingecko.com/api/v3/exchanges/digifinex | 2026-09-23 UTC | CoinGecko | country, year, trust rank, section 1 |
| S12 | 【Contract List】- DigiFinex.CA Fees, edited 2023-06-15 | https://support.digifinex.com/hc/en-us/articles/19613290232089--Contract-List-DigiFinex-CA-Fees | 2026-09-22 | DigiFinex.CA | a Canadian spot fee page exists, section 1 |
| S13 | DigiFinex swap REST API v2 | https://docs.digifinex.com/en-ww/swap/v2/rest.html | 2026-09-22 | DigiFinex, global | private trading fee call, product types, sections 3 and 4 |
| S14 | 【Spot trading】- What is Maker/Taker, How to become VIP and earn discount, edited 2025-02-08 | https://support.digifinex.com/hc/en-us/articles/360015307893--Spot-trading-What-is-Maker-Taker-How-to-become-VIP-and-earn-discount | 2026-09-22 | DigiFinex, global | the VIP program is spot, section 4 |
| S15 | CCXT 4.5.68 `digifinex.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/digifinex.js` | 2026-09-22 | CCXT | fee constant, fee merge, section 8 |
| P1 | `rest-probe.mjs main` at 03:18 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog counts, CCXT `market.taker`, sections 3 and 8 |
| P2 | `rest-probe.mjs funding` at 03:22, 03:34 and 03:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/digifinex/rest-probe.mjs) | 2026-09-23 UTC | this host | funding range, four hour contracts, section 6 |
