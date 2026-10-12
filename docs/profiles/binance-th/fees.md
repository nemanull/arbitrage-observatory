# Binance TH Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time (2026-10-10 UTC), from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

This profile covers spot trading on Binance TH (CoinMarketCap rank 30, no CCXT id), because Binance TH lists no perpetual, see section 3.
It follows change 1 of the template in [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), so it records the spot VIP 0 maker and taker and the spot tiers.
The numbers come from the public VIP tier call that the VIP page loads and from the platform fee FAQ, both read by [`fees-probe.py`](../../../scripts/probes/venues/binance-th/fees-probe.py).
The global Binance venue is a separate profile, [`../binance/`](../binance/), and none of its fees apply here.

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| retrieval date | 2026-10-09 | | S1 to S6 |
| legal entity | Gulf Binance Co., Ltd., a joint venture of Gulf Edge Co., Ltd. and Binance (AP) Holdings Limited | Published | S3 |
| licences | Thai SEC digital asset exchange licences No. 310180100002 and No. 310280150004, and digital asset broker licences No. 210180120007 and No. 210280120004, all obtained 2023-05-18 | Published | S3 |
| what the licences split | THB pairs are traded on the exchange, crypto pairs through the broker, in the venue's words "digital asset exchange (THB pairing) and brokerage (Crypto pairing)" | Published | S3 |
| who may trade | users who pass KYC, natural persons of at least 20 years, "of Thai or other nationalities", and a foreign national must upload "evidence of permission to stay in Thailand" | Published | S4, sections Definitions and Eligibility |
| regions excluded | anyone who resides in or accesses the platform from "a high-risk area", with no list given | Published | S4 |
| access from the Canadian exit | every public call answered, no geoblock and no refusal | Probed | [`rest-probe.py`](../../../scripts/probes/venues/binance-th/rest-probe.py) `host`, `errors` |

So an account needs Thai residence or a Thai stay permit, and the public market data is open to any host.

## 2. Quick answer

| market group | pairs | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|---|
| exchange pairs, quoted in THB | 11 | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | Published, Probed |
| broker pairs, quoted in USDT, USDC or FDUSD | 501 | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | Published, Probed |

The FAQ states both rates for "regular users" and says each is "inclusive of VAT" (S2).
The VIP tier call returns the same two pairs of numbers for `vipLevel 0` (S1, `fees-probe.py`).
The pair counts come from the catalog, see [`rest.md`](./rest.md) section 2.
The fee is "charged from the assets which you will receive from the transaction" (S2).

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| perpetuals, any margin | absent | the API reference has no futures section and no funding, mark or index call (S5), `/fapi/v1/exchangeInfo` and `/dapi/v1/exchangeInfo` on `api.binance.th` answer HTTP 404, and `https://www.binance.th/en/futures` answers HTTP 404 (`rest-probe.py catalog`) |
| dated futures | absent | same evidence as perpetuals |
| options | absent | the API reference and the site navigation name no options product (S5, S3) |
| margin | absent | the API reference has no margin call (S5) |
| spot | present, 512 pairs, all `TRADING` | `rest-probe.py catalog`, `GET /api/v1/exchangeInfo` |

The licences in section 1 cover exchange and broker services only.
The web pages carry futures and derivatives strings, such as `futures-trade-seo-keywords`, but they are SEO keys of a shared page template, and no route behind them answers.
So this profile, its WebSocket profile and its REST profile describe spot.

## 4. Spot tiers

From `GET https://www.binance.th/bapi/accounts/v1/public/account/vip-info/get`, which needs no login and returned `userVipLevel null` (S1, `fees-probe.py`).
The VIP page at S6 renders this table.

| level | 30 day volume, USD | broker maker ppm | broker taker ppm | exchange maker ppm | exchange taker ppm |
|---|---|---|---|---|---|
| VIP 0, Regular User | 0 | 1,000 | 1,000 | 2,500 | 2,500 |
| VIP 1 | 150,000 | 1,000 | 1,000 | 2,000 | 2,500 |
| VIP 2 | 500,000 | 900 | 1,000 | 1,500 | 2,000 |
| VIP 3 | 1,500,000 | 800 | 1,000 | 1,000 | 1,500 |
| VIP 4 | 3,000,000 | 700 | 900 | 1,000 | 1,000 |
| VIP 5 | 8,000,000 | 500 | 700 | 700 | 900 |
| VIP 6 | 20,000,000 | 450 | 650 | 650 | 850 |
| VIP 7 | 40,000,000 | 350 | 450 | 550 | 750 |
| VIP 8 | 75,000,000 | 250 | 310 | 400 | 520 |

### Qualification

The table header on S6 calls the volume "30-Day Volume (USD)", and the calculator asks for "30-Day Spot Volume (USDT)".
The page's own description says the venue evaluates "your THB pair trading volume over the past 30-day period" at 00:00 daily and updates the fees at 1:00 AM (S6, key `vip-tier-table-desc`).
The page names no time zone, and it does not say whether broker pair volume counts.
Volume on pairs under a zero fee campaign is excluded (S6, key `vip-tier-table-note-1`).
The page labels levels 10 to 20 "Institutional" and level 99 "Special User", and the public call returns no row for them.

## 5. Discounts that change the spot taker

| discount | effect | label | source |
|---|---|---|---|
| VIP levels | section 4, up to "75% off trading fees compared to non-VIP rates" by the page's own claim | Published | S1, S6 |
| BNB discount | named in a VIP note, "BNB discounts, referral rebates, and any other adjustments will also not apply" on zero fee pairs, with no rate | Not publicly specified | S6, key `vip-tier-table-note-2` |
| referral rebates | named in the same note, with no rate | Not publicly specified | S6 |
| zero fee campaigns | the VIP notes say they exist and point to each campaign's terms, and no current campaign was read | Not publicly specified | S6 |
| VIP terms set case by case | "We may stipulate the condition and applicable trading fee for the VIP customers as announced and/or informed to you later" | Negotiated | S2 |
| account specific rate | `GET /api/v1/asset/tradeFee` is a signed call and answered HTTP 401 `{"code":-2014,"msg":"API-key format invalid."}` without a key | Account-gated | `fees-probe.py` |

## 6. Funding as a cost

Not offered.
Binance TH lists no perpetual, so no funding is charged, see section 3.

## 7. Liquidation, settlement and delisting

Not offered for liquidation and settlement, because spot has no leverage on this venue.
No delisting charge is published in the FAQ or the terms (S2, S4).
Deposit and withdrawal fees are on the platform fee FAQ (S2), and crypto withdrawal fees are "dynamic", so they are not recorded here.

## 8. CCXT

Binance TH has no class in CCXT 4.5.68.
The installed directory `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds `binance.js`, `binancecoinm.js`, `binanceus.js` and `binanceusdm.js`, and no file under it contains `binance.th`.
The current CCXT master, commit `f0aca06eb7` of 2026-10-08 (package version 4.5.85), lists the same four Binance files under `ts/src`, and `ts/src/binanceth.ts` answers HTTP 404 (S7).
So there is no `market.taker` to read.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 1,000 on broker pairs, 2,500 on THB exchange pairs | the VIP 0 rates of section 2, one value per market group |
| `ccxtTakerPpm` | none | no CCXT class exists |

The engine trades perpetuals, and this venue has none, so these values are for the survey record only.
A future spot leg would need a per market taker, because one registry value cannot hold both groups.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | VIP tier call `https://www.binance.th/bapi/accounts/v1/public/account/vip-info/get`, found in the site bundle `https://static.binance.th/static/cloud/thailand/static/chunks/commons.82c32a85.js` | 2026-10-09 |
| S2 | platform fee FAQ `https://www.binance.th/en/faq/spot-trading/91605c2481714f41becb6951906d6927`, linked as "Platform Fee" in the site footer | 2026-10-09 |
| S3 | About Us `https://www.binance.th/en/terms/about-us/22c0541e34e84ce19c94d79713c66f07` | 2026-10-09 |
| S4 | Terms and Conditions `https://www.binance.th/en/terms/terms/4aefcc734230446e99bb8f47cf04851c` | 2026-10-09 |
| S5 | API reference `https://www.binance.th/api-docs/en/` | 2026-10-09 |
| S6 | VIP page `https://www.binance.th/en/universal/landing/vip`, its tier table notes in the page's embedded locale strings | 2026-10-09 |
| S7 | CCXT master `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/binanceth.ts` (404) | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/binance-th/fees-probe.py) | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/binance-th/rest-probe.py) | 2026-10-10 UTC |
