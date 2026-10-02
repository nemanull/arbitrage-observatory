# Indodax Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:25 to 04:50 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`).

This profile covers Indodax (CCXT id `indodax`), an Indonesian spot exchange.
Indodax lists no perpetuals, dated futures, options or margin, so the profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records the spot market.
The public numbers come from the `/api/pairs` reply, read by [`rest-probe.mjs`](../../../scripts/probes/venues/indodax/rest-probe.mjs), and from the help center and blog cited in section 10.
The help center HTML pages answer this host with HTTP 403 and a Cloudflare "Just a moment..." challenge, so every help article below was read through its public Zendesk JSON API, `https://help.indodax.com/api/v2/help_center/id/articles/<id>.json`, which answered HTTP 200.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | PT Indodax Nasional Indonesia, a licensed Pedagang Aset Keuangan Digital (PAKD) supervised by Otoritas Jasa Keuangan (OJK) | S9 |
| exchange and clearing | Indodax is an exchange member and clearing member of PT Central Finansial X (CFX) and PT Kliring Komoditi Indonesia (KKI), which is where the CFX fee comes from | S6, S7 |
| who may register | age 17 or more, and a valid identity document: a KTP for Indonesian citizens, or a passport together with a KITAS or KITAP residence permit for foreign nationals | S9 |
| excluded regions | "Tidak berasal dari negara atau yurisdiksi yang dilarang oleh Indodax maupun oleh peraturan perundang-undangan yang berlaku", with no list of those jurisdictions published | S9 |
| US persons | no rule names them, but a foreign national needs an Indonesian KITAS or KITAP, so a US person living in the US cannot meet the identity requirement | S9 |
| products | spot only: 484 pairs on 2026-09-23 UTC, 472 against IDR and 12 against USDT | P1, P2 |
| perpetuals | none, "saat ini Indodax belum support untuk market futures", updated 2026-09-03, and "saat ini pada Indodax belum tersedia fitur Trading Future", updated 2026-09-15 | S3, S4 |
| volume context | CoinGecko on 2026-09-22: trust score 5 of 10, 24 h spot volume $22,830,929, 450 coins, 458 pairs, no derivatives listed, most active pair USDT/IDR | S16 |
| USDT market volume | 155,275 and 158,649 USDT over 24 h across all 12 USDT pairs in the two runs, of which `btc_usdt` was 112,864 and 116,253 USDT | P1, P2 |

Public REST and the market data socket answered this host without refusal: every public REST call returned HTTP 200 except the deliberate error cases, and `wss://ws3.indodax.com/ws/` opened with 101, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
Those results are from the Canadian VPN exit named above, not from a US address.

## 2. Quick answer

The trading fee Indodax calls the service fee, per pair from `/api/pairs` on 2026-09-23 UTC, P1 and P2:

| market | pairs | maker | taker | maker ppm | taker ppm |
|---|---:|---:|---:|---:|---:|
| USDT market | 12 | 0.03 % | 0.06 % | 300 | 600 |
| IDR market | 472 | 0.1 % | 0.2 % | 1,000 | 2,000 |

The fields are `trade_fee_percent_maker` and `trade_fee_percent_taker`, which were identical on every pair of each market in both runs.
The blog post that set this schedule shows the same four numbers, S8.

What a member actually pays is the "All-in-Fee": the service fee plus tax plus the CFX fee, S6.

| component | IDR market | USDT market | source |
|---|---|---|---|
| service fee, taker | 0.2 % | 0.06 % | P1, S8 |
| CFX fee, on buys and sells, from 2026-03-01 00:00 WIB | 0.0111 % | 0.0222 % | S7 |
| tax on a purchase, from 2025-08-01 | none, "pembelian aset kripto tidak lagi dikenakan PPN" | none | S5 |
| tax on a sale, from 2025-08-01 | PPh 0.21 % | PPh 0.21 % | S5 |
| all-in taker, buy | 0.2111 %, 2,111 ppm | 0.0822 %, 822 ppm | sum of the rows above |
| all-in taker, sell | 0.4211 %, 4,211 ppm | 0.2922 %, 2,922 ppm | sum of the rows above |

Whether a USDT market buy also counts as a sale of USDT for the PPh is Not publicly specified.
The 2023 table in S8 charged the tax on both sides of a USDT market trade, so the USDT buy row may be 0.21 % higher.
The help center says the exact all-in fee of an account is shown under Profil and Pengaturan, Biaya Trading, which needs a login, S15.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | S3, S4, CCXT `has.swap` false at `server/node_modules/ccxt/js/src/indodax.js` line 31, and 0 swap markets in `loadMarkets`, P1 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | S3, S4, CCXT `has.future` false at line 32 |
| options | absent | CCXT `has.option` false at line 33, and S3 says only spot trading is supported |
| margin | absent | CCXT `has.margin` false at line 30, CoinGecko lists no margin, S16 |
| spot | present | 484 pairs: 472 IDR, of which 19 had `is_maintenance` 1, and 12 USDT, P1 and P2 |

The help center also names an OTC desk and a "Quick Buy USDT" feature, which were not researched.

## 4. Spot tiers

No volume tier, VIP level or token tier is published.
A search of the help center for "VIP" returned one unrelated article, and the fee articles in section 10 describe one maker and one taker rate per market.
The help article that the fee breakdown links for the maker and taker rates, S18, refused both this host and a fetch from outside it with HTTP 403, and its API returned `{"error":"Couldn't authenticate you"}`, so it was not read.

The schedule in force since 2023-08-22, S8:

| market | before the change | after the change |
|---|---|---|
| IDR, maker | 0 % | 0.1 % |
| IDR, taker | 0.3 % | 0.2 % |
| USDT, maker | 0 % | 0.03 % |
| USDT, taker | 0.09 % | 0.06 % |

The tax columns of the S8 table, 0.11 % and 0.1 % on the IDR market and 0.21 % on the USDT market, are the 2023 rates and were replaced on 2025-08-01 by the PPh of section 2, S5.
The legacy field `trade_fee_percent` still reads 0.2 on the IDR pairs and 0.06 on 11 USDT pairs, but 0.3 on `bonkusdt`, whose maker and taker fields read 0.03 and 0.06 like the other USDT pairs, P1 and P2.

## 5. Discounts that change the spot taker

| item | effect | source |
|---|---|---|
| token holding | none found in the help center search for fee articles | |
| referral | the referrer earns 10 % of the referee's trading fee, and the article names no discount for the referee | S10 |
| market maker program | none published | |
| zero fee promotions | none found: the blog posts matching "fee" since 2024-06-01 are loyalty and merchant promotions, which were listed by title and not read | blog search through `https://blog.indodax.com/wp-json/wp/v2/posts` |
| LITE mode | the same rates as PRO, but LITE always executes as a taker | S11 |
| limit order | the market fee is taken when the order is placed and refunded if the order then fills as a maker | S12 |
| minimum order | PRO orders start at Rp25,000, and a PRO order of Rp10,000 to Rp24,999 is sent through LITE | S5 |

## 6. Funding as a cost

Not applicable.
Indodax lists no perpetual, so it publishes no funding rate, interval, cap or settlement, S3 and S4.

## 7. Liquidation, settlement and delisting

- Liquidation: none, because there is no margin or derivative product, section 3.
- Settlement: spot trades settle into the account balance, and no settlement fee is published beyond the all-in fee of section 2.
- Cancel: a pending order is cancelled for free, and the fee applies only to what executes, S13.
- Delisting: a delisted asset can no longer be traded, its IDR estimate shows 0, and it can still be withdrawn to another platform, S14.
- Deposit and withdrawal: the official schedule is the "Rincian Biaya Transaksi di INDODAX" article, S5, and coin withdrawal fees are shown per network in the wallet screen.

## 8. CCXT

| item | CCXT 4.5.68 | wire or source |
|---|---|---|
| `market.taker` | `this.safeNumber(market, 'trade_fee_percent')` at `server/node_modules/ccxt/js/src/indodax.js` line 394 | a percent: 0.2 on 472 IDR pairs, 0.06 on 11 USDT pairs, 0.3 on `bonkusdt` |
| what the connector would compute | `Math.round(taker * 1_000_000)` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 185 gives 200,000 ppm on IDR pairs, 60,000 on 11 USDT pairs and 300,000 on `bonkusdt`, P1 and P2 | the real taker is 2,000 and 600 ppm, so CCXT's number is 100 times too large |
| `market.maker` | 0 on all 484 markets, P1 and P2, from the class default at line 185, since the market parser sets no maker | 0.1 % and 0.03 % on the wire |
| class default | `'tierBased': false, 'percentage': true, 'maker': 0, 'taker': 0.003` at lines 183 to 186 | the schedule before 2023-08-22, S8 |
| `market.percentage` | true, at line 400 | |
| swap markets | none: every market is `'type': 'spot'`, `'swap': false` at lines 384 and 387 | |
| CCXT Pro | no `pro/indodax.js` exists in 4.5.68 | |

For `BTC/USDT`, CCXT reported `taker` 0.06 and `maker` 0 without credentials, P1 and P2.
The literal is the percent that `/api/pairs` returns, read as a fraction, the same shape as the Coinbase constant that [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) lines 74 to 76 document.

## 9. Recommended registry values

None today.
The connector keeps only active swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 200, and Indodax has none, so the venue would log "no usable swap markets" and be skipped.

If a spot leg on the USDT market is ever modelled, the numbers would be these.

| key | value | reason |
|---|---|---|
| `takerPpm` | 600, or 822 all-in on a buy and 2,922 all-in on a sale | the USDT market service taker, plus the CFX fee and the PPh of section 2 |
| `ccxtTakerPpm` | 60,000 | what CCXT reports on the 11 USDT markets, a percent read as a fraction, line 394 |

`bonkusdt` would report 300,000 and trip the connector's unexpected fee warning at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 140, which is one more reason to set `takerPpm` explicitly.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Indodax official API docs, Public REST API | https://github.com/btcid/indodax-official-api-docs/blob/master/Public-RestAPI.md | 2026-09-22, repo last changed 2026-09-10 | Indodax | endpoints, 180 requests a minute, the `/api/pairs` fee fields |
| S2 | Indodax official API docs, Market Data WebSocket | https://github.com/btcid/indodax-official-api-docs/blob/master/Marketdata-websocket.md | 2026-09-22 | Indodax | socket URL and static token, see [`websocket.md`](./websocket.md) |
| S3 | Apakah di Indodax Support Market Futures?, updated 2026-09-03 | https://help.indodax.com/hc/id/articles/52437855695641-Apakah-di-Indodax-Support-Market-Futures | 2026-09-22 | PT Indodax Nasional Indonesia | no futures, spot only |
| S4 | Apakah Indodax tersedia Fitur Trading Future?, updated 2026-09-15 | https://help.indodax.com/hc/id/articles/36015460522777-Apakah-Indodax-tersedia-Fitur-Trading-Future | 2026-09-22 | PT Indodax Nasional Indonesia | no futures trading |
| S5 | Rincian Biaya Transaksi di INDODAX, updated 2026-09-16 | https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX | 2026-09-22 | PT Indodax Nasional Indonesia | PMK 50/2025: no VAT on purchases, PPh 0.21 % on sales from 2025-08-01, PRO minimum Rp25,000, deposit and withdrawal schedule |
| S6 | Apa Perbedaan Antara Service Fee, Tax (Pajak), dan CFX Fee, updated 2026-07-21 | https://help.indodax.com/hc/id/articles/52021234143769 | 2026-09-22 | PT Indodax Nasional Indonesia | all-in fee is service fee plus tax plus CFX fee |
| S7 | Penurunan Biaya CFX, 2026-02-27 | https://blog.indodax.com/penurunan-biaya-cfx | 2026-09-22 | PT Indodax Nasional Indonesia, CFX, KKI | CFX fee 0.0111 % IDR and 0.0222 % USDT from 2026-03-01, previously 0.0222 % and 0.0444 % |
| S8 | Reduced Taker Fee: 40% Cheaper with No Conditions, 2023-08-22, modified 2025-07-15 | https://blog.indodax.com/fee-taker-maker-update/ | 2026-09-22 | PT Indodax Nasional Indonesia | the maker and taker table in its two images, section 4 |
| S9 | Syarat dan Ketentuan Umum, updated 2026-09-22 | https://help.indodax.com/hc/id/articles/4416650994585-SYARAT-DAN-KETENTUAN-UMUM | 2026-09-22 | PT Indodax Nasional Indonesia, Indonesia | operator, OJK licence, registration requirements |
| S10 | Apakah ada program referral atau afiliasi di Indodax.com?, updated 2026-09-19 | https://help.indodax.com/hc/id/articles/4416488847641 | 2026-09-22 | PT Indodax Nasional Indonesia | referral pays 10 % of the referee's trading fee |
| S11 | Apakah Ada Perbedaan Fee Transaksi Antara Mode LITE dan PRO di Indodax?, updated 2026-09-16 | https://help.indodax.com/hc/id/articles/54505026275865 | 2026-09-22 | PT Indodax Nasional Indonesia | LITE and PRO share rates, LITE executes as taker |
| S12 | Mengapa saat saya melakukan transaksi jual/beli koin dengan metode limit dikenakan fee dari metode market?, updated 2026-07-07 | https://help.indodax.com/hc/id/articles/40302855396505 | 2026-09-22 | PT Indodax Nasional Indonesia | provisional taker fee refunded on a maker fill |
| S13 | Apakah saat melakukan Cancel Order dikenakan biaya/fee?, updated 2026-08-03 | https://help.indodax.com/hc/id/articles/36160816873497 | 2026-09-22 | PT Indodax Nasional Indonesia | free cancel |
| S14 | Mengapa estimasi rupiah pada koin saya menjadi 0 ketika koin tersebut delisting?, updated 2026-09-12 | https://help.indodax.com/hc/id/articles/41414632189209 | 2026-09-22 | PT Indodax Nasional Indonesia | delisting |
| S15 | Dimana saya dapat menemukan menu Biaya Trading Indodax?, updated 2026-07-03 | https://help.indodax.com/hc/id/articles/40043754266265 | 2026-09-22 | PT Indodax Nasional Indonesia | the per account fee screen |
| S16 | CoinGecko, Indodax | https://www.coingecko.com/en/exchanges/indodax | 2026-09-22 | CoinGecko | trust score, volume, pair count, no derivatives |
| S17 | CCXT 4.5.68 `indodax.js` | `server/node_modules/ccxt/js/src/indodax.js` | 2026-09-22 | CCXT | section 8 |
| S18 | Apa itu Market Taker, Market Maker dan Stop Order | https://help.indodax.com/hc/id/articles/4416657645465-Apa-itu-Market-Taker-Market-Maker-dan-Stop-Order- | 2026-09-22, HTTP 403 | PT Indodax Nasional Indonesia | not read, section 4 |
| P1 | `rest-probe.mjs all`, 04:28 to 04:30 UTC 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/indodax/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | pair counts, fee fields, CCXT readings |
| P2 | `rest-probe.mjs all`, rerun at 04:47 to 04:49 UTC 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/indodax/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the second readings |
