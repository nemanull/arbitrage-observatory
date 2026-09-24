# Bitexen Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:53 and 05:12 UTC on 2026-09-23, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers Bitexen, the Turkish exchange at `www.bitexen.com`, which CoinGecko ranks 131 by trust.
Bitexen lists no perpetual, so this profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records its spot market.
Its public API lists one order book market, `USDTTRY`, see [`rest.md`](./rest.md) section 2.
Every access result below is from the Canadian VPN exit, and the network setup was not changed.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 | |
| legal entity | Bitexen Kripto Varlık Alım Satım Platformu A.Ş., renamed from Bitexen Teknoloji A.Ş. to comply with Capital Markets Board (SPK) rules | S3 |
| regulator | the Turkish Capital Markets Board (SPK), whose 2024-09-19 principle decision ended all Bitexen campaigns on 2024-10-03 | S4 |
| who may trade | identity verification needs a valid Turkish Republic identity document, held by a Turkish national or by a foreign national with a temporary residence permit, plus an address document from e-Devlet | S5 |
| excluded regions | no exclusion list is published, but the identity rule above admits only people who hold a Turkish identity document | S5 |
| US persons | may not verify unless they hold a Turkish identity document through Turkish residence | S5 |
| sibling platforms | the web app's configuration names further Bitexen tenants, among them `global.bitexen.com`, `eu.bitexen.com` and `saf.bitexen.com`, and the help center has a second root category named "Bitexen ADGM" | P5, P6, S6 |

Access from this host: every documented public call answered 200, see [`rest.md`](./rest.md) section 1.
Nothing was refused, and no call needed a login.

## 2. Quick answer

| product | maker | taker | maker with KDV | taker with KDV |
|---|---|---|---|---|
| spot `USDTTRY`, the only order book market | 0.15 %, 1,500 ppm | 0.25 %, 2,500 ppm | 0.18 %, 1,800 ppm | 0.30 %, 3,000 ppm |

The help center article gives 0.15 % maker and 0.25 % taker and says the rates exclude KDV, the Turkish value added tax, which "is calculated separately on these rates and included in the trading fee" on every PRO board trade, S1.
The public fee call `GET https://www.bitexen.com/p/v1/account/general_transaction_fees/` returned `"maker_fee_ratio": "0.00150"`, `"taker_fee_ratio": "0.00250"` and `"KDV": "0.20"`, P5.
`market_info` carries the same pair of ratios on `USDTTRY`, `"maker_fee_ratio": "0.00150000"` and `"taker_fee_ratio": "0.00250000"`, P2.
The web app's order form charges `amount × (1 + KDV) × ratio`, and the fee is at least the currency's `min_order_fees` entry, P6.
So the all-in taker is 0.25 % × 1.20 = 0.30 %, which is 3,000 ppm.
The minimum fee is `"0.00"` for TRY and `"0.00000001"` for USDT, so it does not bind on a `USDTTRY` trade, P5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | `market_info` lists one spot market, P2. `feature_status` on `www.bitexen.com` has no `derivatives` flag among its 27 flags, P5 |
| USDC-M perpetuals | absent | as above |
| coin-M perpetuals | absent | as above |
| dated futures | absent | as above |
| options | absent | as above |
| spot, order book (the "PRO" board) | present, one market: `USDTTRY` | P2 |
| spot, instant buy and sell ("Hızlı Al-Sat", `resell_market` true) | present | `market_info/BTCTRY/`, `ETHTRY` and `BTCUSDT` answer with `"resell_market": true`, and their ticker and order book calls return `null`, P2 and P4 |

CoinGecko's exchange page showed 1 coin, 1 pair (`USDT/TRY`) and 24 h volume of $437,490.91 on 2026-09-22, S7.
CoinGecko's derivatives list does not show Bitexen.

The sibling platform `global.bitexen.com` does set `"derivatives": {"A": true, "H": true, "I": true, "W": true}` in its feature flags, P5.
Its web app points derivatives at `https://gmod-api.bitexen.com`, P6.
That host answered `GET /public/contracts` with HTTP 530 and the Cloudflare page titled "Origin DNS error", and a plain `curl` got the body `error code: 1016`, P5 and P7.
`gtmod2-api.bitexen.com`, the host the other tenants name, does not resolve, P5.
So no Bitexen perpetual was reachable from this host on 2026-09-22, and the Global platform's 37 spot markets are outside this profile.

## 4. Spot tiers

No tier table is published.
The fee article gives one maker and one taker rate for every user, S1.
The public fee call returns one pair of ratios and no tier list, P5.
The per-account call `GET /p/v1/account/account_limits_and_fees/` needs a login token in the web app, so it was not called, P6.

## 5. Discounts that change the spot taker

| discount | detail | source |
|---|---|---|
| referral and commission rebate | the fee article links a "Yeni Referans ve Komisyon İade Programı" (new referral and commission refund programme), and the web app has a `reference_fee_rebate_v2` feature flag. Its terms were not read | S1, P5 |
| campaigns | all campaigns and events ended on 2024-10-03 at 23:59 under the SPK decision | S4 |
| token holding | no holding discount is named on the fee article | S1 |

## 6. Funding as a cost

None.
Bitexen lists no perpetual, so no funding is charged.

## 7. Liquidation, settlement and delisting

No margin product exists, so there is no liquidation or settlement fee.
The help center does publish delisting notices, for example the GOLDP delisting, S4.
Instant buy and sell pricing on `resell_market` pairs was not researched.

## 8. CCXT

CCXT 4.5.68 has no Bitexen class.
`require('ccxt').exchanges` from `server/` lists 104 ids and none matches `bitexen` or `exen`, P5.
`grep -ril bitexen server/node_modules/ccxt/js/src` found no file.
The current CCXT master, commit `1d8b674` of 2026-09-22 12:48 UTC, has 105 `.ts` files in `ts/src` and none is named for Bitexen, S8.
A GitHub code search of `ccxt/ccxt` for `bitexen` returned no hit, S8.
So `market.taker` cannot be read, and `ccxtTakerPpm` has no value.

## 9. Recommended registry values

None.
Bitexen cannot join the engine as a perpetual leg, and its one market is quoted in TRY, which the quote family does not merge with USDT, see [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6.
If a spot stage ever used it, `takerPpm` would be 3,000, the taker with KDV, and `ccxtTakerPpm` would stay unset because no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | İşlem Ücreti Oranı Nedir? (modified 2026-03-02) | https://destek.bitexen.com/portal/tr/kb/articles/islem-ucreti-oranlari-nedir | 2026-09-22 | Bitexen, Turkey | maker and taker, KDV on top, referral programme, sections 2, 4 and 5 |
| S2 | Bitexen API Reference | https://docs.bitexen.com/ | 2026-09-22 | Bitexen, Turkey | public endpoints and rate limit, see [`rest.md`](./rest.md) |
| S3 | Bitexen'den Ticari Unvan Değişikliği Hakkında Bilgilendirme | https://destek.bitexen.com/portal/tr/kb/articles/unvan-degisikligi | 2026-09-22 | Bitexen, Turkey | legal entity, section 1 |
| S4 | Sermaye Piyasası Düzenlemeleri Kapsamında Hizmet Güncellemeleri, and GOLDP Listeleme Sonlanması | https://destek.bitexen.com/portal/tr/kb/articles/spk-duzenleme-hizmet-guncelleme and https://destek.bitexen.com/portal/tr/kb/articles/goldp-delist | 2026-09-22 | Bitexen, Turkey | SPK decision, campaigns ended, delisting notice, sections 1, 5 and 7 |
| S5 | Hesabımı Nasıl Onaylatabilirim? | https://destek.bitexen.com/portal/tr/kb/articles/hesab%C4%B1m%C4%B1-nas%C4%B1l-onaylatabilirim-7-1-2022 | 2026-09-22 | Bitexen, Turkey | identity and address rules, section 1 |
| S6 | Help center root categories, Zoho Desk `kbRootCategories` | https://destek.bitexen.com/portal/tr/kb | 2026-09-22 | Bitexen | "Bitexen A.Ş." and "Bitexen ADGM" categories, section 1 |
| S7 | CoinGecko, Bitexen | https://www.coingecko.com/en/exchanges/bitexen | 2026-09-22 | CoinGecko | 1 coin, 1 pair, volume, section 3. The CoinGecko API answered 429 to this host |
| S8 | CCXT master `ts/src` listing and code search, through the authenticated `gh` CLI | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Bitexen class, section 8 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | the one market and its ratios, resell markets, sections 2 and 3 |
| P4 | `rest-probe.mjs errors` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | resell market order book is `null`, section 3 |
| P5 | `rest-probe.mjs context` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | public fee reply, feature flags here and on Global, Modulus hosts, CCXT list, sections 1 to 8 |
| P7 | `curl https://gmod-api.bitexen.com/public/contracts` | `https://gmod-api.bitexen.com/public/contracts` | 2026-09-22 | this host | status 530, body `error code: 1016`, section 3 |
| P6 | The bitexen.com web app bundle, `assets/index-Dtr3JuRb.js` and its tenant chunks, read with grep | https://www.bitexen.com/assets/index-Dtr3JuRb.js | 2026-09-22 | Bitexen | fee formula with KDV and the minimum fee, the derivatives host per tenant, the token-only account fee call, sections 2 to 4 |
