# Digitalexchange.id Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:25 UTC), from the development host near Seattle, through its Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

Digitalexchange.id is an Indonesian spot exchange that quotes every pair in rupiah (IDR), and it lists no perpetual, dated future or option.
CCXT 4.5.68 has no class for it, and neither does the current CCXT master, see section 8.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.
The venue publishes no API documentation, so every API fact here comes from the probes and from the venue's own web pages.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local time, 2026-09-23 UTC | |
| legal entity | PT Indonesia Digital Exchange, founded 14 August 2018, launched in 2019 with PT Anabatic Technologies Tbk, ownership changed in 2022 | S3 |
| supervision | the home page says "Digitalexchange.id berizin dan diawasi oleh Otoritas Jasa Keuangan (OJK)", licensed and supervised by OJK | S4 |
| registrations named in the terms | BAPPEBTI decree 008/BAPPEBTI/CP-AK/05/2020, and a KOMINFO electronic system registration | S3, S8 |
| product | "perdagangan fisik aset kripto", physical crypto asset trading, spot only | S3 |
| who may open an account | a person of at least 18 or an organisation with full legal capacity, verified with a KTP (Indonesian identity card), a driving licence, a passport or a KITAS (an Indonesian stay permit for foreigners) | S3 |
| funding | IDR by Indonesian bank transfer or virtual account, and the terms cap IDR withdrawals at Rp 200,000,000 a day for Indonesian citizens | S3, S4 |
| excluded regions | Not publicly specified. The terms name no excluded country and say nothing about US persons | S3 |
| US persons | Not publicly specified. Onboarding and funding presume an Indonesian identity document or stay permit and an Indonesian bank account | S3 |
| public API from this host | the web page, `/api/<pair>/ticker`, `/api/<pair>/depth`, `/api/<pair>/trades` and both Socket.IO hosts answered from the Canadian VPN exit with no refusal, see [`rest.md`](./rest.md) section 1 | P1, W1 |

CoinGecko ranked the venue 137 by trust score on 2026-09-23 UTC, tracked 20 of its pairs, and put its 24 h volume at 0.0638 BTC, S8.
The survey list of 2026-09-22 had it at rank 133.

## 2. Quick answer

| product | maker | taker | ppm | source |
|---|---|---|---|---|
| spot, published schedule | 0.36 % "All In Fee" | 0.36 % "All In Fee" | 3,600 and 3,600 | S1, S2 |
| spot, per pair field on the trading page, 87 of 91 pairs | 0.26 % | 0.26 % | 2,600 and 2,600 | P3 |

The help center publishes one flat rate for every trade: buying costs "All In Fee 0,36% (Termasuk Fee Bursa + PPN*)" and selling costs "All In Fee 0,36% (Termasuk Fee Bursa + PPh*)", with "PPN 0% dan PPh 0,21%" effective 1 August 2025, S1 and S2.
So the published cost is 3,600 ppm a side for a maker and for a taker, and it already includes the exchange levy ("fee bursa") and the tax.
The trading page of each pair embeds an `asset_data` object whose `taker_fee` and `maker_fee` read `"0.26"` on 87 of 91 pairs, P3.
The same object carries `lp_taker_fee` and `lp_maker_fee`, and `taker_fee` plus `lp_taker_fee` equals 0.36 on all 91 pairs, as does `maker_fee` plus `lp_maker_fee`, P3.
The sum was checked in the second fee run, and the first run's field counts were identical.
So the 0.26 % field is the venue's share and the published 0.36 % is the whole charge, which is why section 9 uses 3,600 ppm.
The guest trading page computes no fee, so the probe could not see an order being charged.

## 3. Coverage matrix

| product | present | detail | source |
|---|---|---|---|
| USDT-M perpetuals | absent | | S3, S4, S9, P2 |
| USDC-M perpetuals | absent | | S3, S4, S9 |
| coin-M perpetuals | absent | | S3, S4, S9 |
| dated futures | absent | `https://digitalexchange.id/futures` answers 404 | P2 |
| options | absent | | S3, S4 |
| margin | absent | no margin or leverage product on the home, market or trading pages | P2 |
| spot | present | 91 pairs on the `/market` page, all quoted in IDR | S6, P2 |

The terms describe the business as physical crypto asset trading, S3.
The words "futures", "perpetual", "derivatif", "leverage" and "margin trading" appear on none of the home, market, BTCIDR trading and help pages, and the only hits in the terms are the regulator's name and a list of prohibited goods, P2.
CoinGecko's derivatives exchange list held 214 entries on 2026-09-23 UTC and none of them is this venue, S9.

## 4. Spot tiers

No tier, VIP or volume schedule is published.
The fee article gives one all in rate for every buyer and seller, S1.

The per pair fields differ on four pairs, P3 and S5.

| pairs | `taker_fee` | `maker_fee` | `lp_taker_fee` | `lp_maker_fee` | `integrasi` |
|---|---|---|---|---|---|
| 87 pairs, BTCIDR among them | 0.26 | 0.26 | 0.1 | 0.1 | 1 |
| DCTIDR, VEXIDR | 0.36 | 0.36 | 0 | 0 | 0 |
| USDCIDR | 0.18 | 0.25 | 0.18 | 0.11 | 2 |
| USDTIDR | 0.15 | 0.16 | 0.21 | 0.2 | 2 |

Each row sums to 0.36 for the taker and for the maker, P3.
`lp_taker_fee` of 0.1 and `integrasi` of 1 go together on the pairs whose book is a scaled Binance book, see [`rest.md`](./rest.md) section 4.
Reading `lp_*` as the fee the venue pays a liquidity provider is an inference from the field name.
Minimum orders are Rp 50,000 on the IDR market and US$6 on the "IDR new" market, S1.

## 5. Discounts that change the spot taker

| discount | effect on the taker | source |
|---|---|---|
| token holding | none found | S1, S4 |
| referral | none found on the fee article | S1 |
| market maker programme | none published | S1 |
| zero fee promotion | none published on 2026-09-22 | S1 |
| Point Center | an event that awards points for prizes, filed under past events, and it names no fee discount | S7 |

## 6. Funding as a cost

Spot has no funding, and the venue offers no margin, so no borrowing cost exists either.
Nothing here feeds an `AnchorRow`.

## 7. Liquidation, settlement and delisting

- No liquidation or settlement charge exists on a spot only venue with no margin.
- The help center home lists delisting announcements, for example "Pengumuman Delisting 5 Juni 2026", and the terms publish no delisting charge, S11 and S3.
- 126 pairs sit in the page's `integrasi` list and 37 of them are not on the `/market` page, which reads as pairs delisted or paused without the list being pruned, P2.
- Deposit and withdrawal fees are "Dinamis Sesuai jaringan yang di pilih", set by the chosen network, and the lookup is the same fee article, S1.

## 8. CCXT

CCXT 4.5.68 lists 104 exchange ids and none is this venue, P2.
No id contains "digital", "indonesia" or "dexid", and the two Indonesian venues it does list, `indodax` and `tokocrypto`, are other exchanges, P2.
The current CCXT master on GitHub, version 4.5.82, imports 105 exchange classes in `ts/ccxt.ts` and none is this venue, and `ts/src/digitalexchange.ts`, `ts/src/digitalexchangeid.ts` and `ts/src/digitalexchange_id.ts` answer 404, S10.
So there is no `market.taker` to report, and the engine's connector, which keeps only active swap markets at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202, has nothing to load.

## 9. Recommended registry values

None, because the venue has no perpetual and no CCXT class, so it cannot join the engine as a perpetual leg.

If a later design adds spot legs, `takerPpm` would be 3,600, the published all in rate, because no CCXT value exists to fall back on.
Every pair is quoted in IDR, which the quote family does not merge with USD, USDC or USDT, at [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a market here could only pair with another IDR market.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Rincian Biaya Fee Transaksi di digitalexchange.id | https://help.digitalexchange.id/artikel/id/fee-transaksi | 2026-09-22 | PT Indonesia Digital Exchange | the all in rate, PPN and PPh, minimum orders, withdrawal fee lookup, sections 2, 4, 5 and 7 |
| S2 | Fee table image on S1, "TRADING FEE" | https://helpdesk-asset.oss-ap-southeast-5.aliyuncs.com/uploads/upload-1754020287.jpeg | 2026-09-22 | same | "All In Fee 0,36%" for buy and sell, section 2 |
| S3 | Terms of service | https://digitalexchange.id/term-of-services | 2026-09-22 | same | entity, history, registrations, identity documents, withdrawal cap, spot only, sections 1 and 3 |
| S4 | Home page | https://digitalexchange.id/ | 2026-09-22 | same | OJK line, section 1 |
| S5 | BTCIDR trading page | https://digitalexchange.id/basic-trading/BTCIDR | 2026-09-22 | same | `asset_data` fields, the `integrasi` list, section 4 |
| S6 | Market page | https://digitalexchange.id/market | 2026-09-22 | same | the 91 listed pairs, section 3 |
| S7 | POINT CENTER | https://help.digitalexchange.id/artikel/id/Point-center | 2026-09-22 | same | no fee discount, section 5 |
| S8 | CoinGecko API, exchange `digitalexchange_id` | https://api.coingecko.com/api/v3/exchanges/digitalexchange_id | 2026-09-22 | CoinGecko | trust rank, tracked pairs, volume, registration numbers, section 1 |
| S9 | CoinGecko API, derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | venue absent, section 3 |
| S10 | CCXT master `ts/ccxt.ts`, version 4.5.82 | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-22 | CCXT | no class, section 8 |
| S11 | Help center home | https://help.digitalexchange.id/home/id | 2026-09-22 | PT Indonesia Digital Exchange | delisting and listing announcements, section 7 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `host` and `errors` | | 2026-09-22 | this host | access from this host, section 1 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `catalog`, plus page greps with curl | | 2026-09-22 | this host | the catalog, CCXT 4.5.68 list, absent products, sections 3, 7 and 8 |
| P3 | [`rest-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/rest-probe.mjs) `fees` | | 2026-09-22 | this host | per pair fee fields on 91 trading pages, sections 2 and 4 |
| W1 | [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs) `book` | | 2026-09-22 | this host | both Socket.IO hosts accept this host, section 1 |
