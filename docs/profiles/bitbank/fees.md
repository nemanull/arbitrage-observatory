# Bitbank Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 01:30 to 01:50 UTC), from the development host near Seattle.

Bitbank (CCXT id `bitbank`) is a Japanese spot exchange, and it lists no perpetual, dated future or option.
This profile therefore covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Margin trading exists on five pairs and trades against the spot market, so it is named in the coverage matrix and its interest is recorded in section 6.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | bitbank, inc. (ビットバンク株式会社) | S3 footer, S6 |
| licence | crypto-asset exchange service provider, registration No. 00004 with the Kanto Local Finance Bureau | S3 footer, "暗号資産交換業者 登録番号 第00004号" |
| other registration | money lender, Tokyo Governor (2) No. 31821, used for margin lending | S3 footer |
| associations | Japan Virtual and Crypto Assets Exchange Association (JVCEA) and Japan Crypto Business Association | S3 footer |
| country | Japan | CCXT `countries: ['JP']` at `server/node_modules/ccxt/js/src/bitbank.js` line 22 |
| products researched | spot, 62 pairs listed, 44 tradable | P1, see [`rest.md`](./rest.md) section 2 |

Who may trade:

- The terms of service, revised 2026-04-01, let a natural person or a legal entity register when it meets the Article 3 conditions: an adult, not an antisocial force, and not under guardianship, S6.
- Article 3 names no residency condition in so many words.
- Article 4 lets bitbank restrict access or login from specific countries or regions for sanctions and anti money laundering reasons, S6.
- Article 15 lets bitbank suspend or force-close an account when the IP address used for the registration is assigned to a country outside Japan, or does not match the registered address, S6.
- The support article for prospective customers and the article "For International Enterprises" say, in search snippets, that accounts for people living outside Japan are usually not permitted and that a foreign national resident in Japan registers with a residence card, S7.
- Those support pages sit behind a Cloudflare challenge that answered HTTP 403 to this host and to the documentation fetch, so the residency rule is taken from the search snippets and not read in full.
- A US person resident in the United States therefore cannot open an account, and a US citizen resident in Japan can, as far as S6 and S7 show.
- Margin trading additionally asks an individual for proof of employment and income, and is open from age 20, S5.

The public REST and WebSocket endpoints all answered this host with HTTP 200 and data, and no geoblock or refusal was seen, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

There is no VIP 0 in a published tier table, because bitbank publishes a single retail schedule, see section 4.

| product | pairs | maker | taker | source |
|---|---|---|---|---|
| spot, BTC/JPY | 1 | 0 %, 0 ppm | 0.10 %, 1,000 ppm | S2, S3, and `btc_jpy` in P1 |
| spot, every other JPY pair | 43 tradable | -0.02 %, -200 ppm, a rebate | 0.12 %, 1,200 ppm | S3, and 61 pairs in P1 |
| spot, BTC-quoted pairs | 15 listed, all suspended | -0.02 %, -200 ppm | 0.12 %, 1,200 ppm | P1 |
| margin, open and close | 5 pairs | same as the pair's spot maker | same as the pair's spot taker | S2, P1 |

The wire agrees with the fee page.
`GET https://api.bitbank.cc/v1/spot/pairs` returned `"taker_fee_rate_quote":"0.001"` and `"maker_fee_rate_quote":"0"` for `btc_jpy`, and `"0.0012"` and `"-0.0002"` for the other 61 pairs, on 2026-09-23 01:30 UTC and again in the second pass, P1.
The `_base` fee fields were `"0"` on all 62 pairs, so the fee is charged in the quote currency, P1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | the pairs catalog lists spot pairs only, P1. CCXT declares `'swap': false` at `bitbank.js` line 29 and every parsed market has `'swap': false` at line 328. The CoinGecko derivatives list of 112 venues had no bitbank entry on 2026-09-22, S8 |
| USDC, coin-margined or JPY perpetuals | absent | same evidence |
| dated futures | absent | CCXT `'future': false` at line 30, and no futures page or API on bitbank.cc was found |
| options | absent | CCXT `'option': false` at line 31 |
| spot | present | 62 pairs, 47 quoted in JPY and 15 in BTC, 44 JPY pairs tradable, P1 |
| margin trading (信用取引) | present on `btc_jpy`, `xrp_jpy`, `eth_jpy`, `sol_jpy`, `doge_jpy` | pairs with non-null `margin_long_interest`, P1. Up to 2x for individuals, S5. It uses "現物市場と同じ価格・流動性", the spot market's prices and liquidity, S9, and the API publishes no separate margin book, P1 |
| dealer desk (販売所) | present, not researched | the private stream names a `dealer_order_new` method, S4 |
| deposits and withdrawals | named only | JPY withdrawal 550 or 770 JPY, the lookup is https://bitbank.cc/guide/fee, S3 |

CCXT's own `has` block says `'margin': false` at line 28, although the venue offers margin trading since 2024-11-11, S9.

## 4. Spot tiers

No tier table is published.
The fee guide lists one maker and one taker per pair "2026年2月2日時点", with 43 JPY pairs at -0.02 % and 0.12 % and BTC/JPY at 0.00 % and 0.10 %, S3.

The only volume programme is the ビットバンクVIPプログラム for large traders.
It promises "手数料の優遇や専用窓口の開設など" to customers above an unstated trading volume, on application through a form, S10.
No threshold, rate or tier of it is public.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| exchange token | none, bitbank has no fee token | S3 lists no token discount |
| referral | none found | |
| VIP programme | unpublished, on application | S10 |
| zero fee campaigns | the fee guide says a pair's fee is free while a zero fee campaign runs on it, note ※3 | S3 |
| BTC/JPY revision | taker from 0.12 % to 0.10 % and maker from -0.02 % to 0 %, from about 12:00 JST on 2026-02-02, spot and margin | S2 |

No campaign was active on the wire, since every pair in P1 carried one of the two standard fee pairs.

The circuit breaker changes which side pays taker.
While a pair reopens by auction (板寄せ), the fee type is `SELL_MAKER`, `BUY_MAKER` or `DYNAMIC`, and every buy or every sell is charged taker by side, "注文のタイプ、オプションによらず" and including PostOnly orders, S11.
The pair's current `fee_type` is published in `circuit_break_info`, see [`rest.md`](./rest.md) section 3.

## 6. Funding as a cost

Spot has no funding.
Margin positions pay interest to bitbank, not to another trader.

| item | value | source |
|---|---|---|
| interest | 0.04 % per day, 14.60 % a year, long and short | S5 |
| on the wire | `"margin_long_interest":"0.0004"` and `"margin_short_interest":"0.0004"` on all five margin pairs | P1 |
| basis | the average entry price, times position quantity and days held, "日歩単位" | S5 |
| settlement | accrued and settled in JPY when the position is closed | S5 |

This is a borrowing cost, and no rate is exchanged between longs and shorts, so nothing here feeds an `AnchorRow`.

## 7. Liquidation, settlement and delisting

- Margin positions face a margin call and forced settlement under the margin trading rules, S5, and no separate liquidation fee was found there.
- 18 pairs are listed with `is_enabled` true but with `stop_order`, `stop_market_order`, `stop_buy_order` and `stop_sell_order` true, and their books are empty: `mkr_jpy`, `rndr_jpy`, `matic_jpy` and all 15 BTC-quoted pairs, P1.
- `mkr_jpy` is in `FULL_RANGE_CIRCUIT_BREAK` with `fee_type` `DYNAMIC`, and its `circuit_break_info` timestamp is 1759195766006, 2025-09-30 01:29 UTC, so that state has not changed for almost a year, P1.
- No settlement or delisting charge is published in S3.

## 8. CCXT

CCXT 4.5.68 has no fee constant for bitbank.
`market.taker` and `market.maker` are read per pair from the live `spot/pairs` reply, `taker_fee_rate_quote` at `server/node_modules/ccxt/js/src/bitbank.js` line 335 and `maker_fee_rate_quote` at line 336.
`fetchTradingFees` reads the same two fields, with `tierBased: false`, at lines 516 to 563.

Without credentials, loadMarkets returned 62 spot markets, 0 swaps, 62 active, P1.

| symbol | `market.taker` | `market.maker` |
|---|---:|---:|
| `BTC/JPY` | 0.001 | 0 |
| `XRP/JPY` and 60 other markets | 0.0012 | -0.0002 |

So CCXT reports 1,200 ppm for a typical pair and 1,000 ppm for BTC/JPY, which matches the fee page exactly.
The engine's connector keeps only markets with `type === 'swap'` and `swap === true`, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 195 to 202, so bitbank contributes no market and the connector logs "no usable swap markets", at line 51.

## 9. Recommended registry values

None, because bitbank cannot join the engine as a perpetual leg.

If a later design adds spot legs, `takerPpm` can stay unset so the per market CCXT value applies, since that value is read live from the venue and already differs by pair.
`ccxtTakerPpm` would then be 1,200, with BTC/JPY at 1,000 as the known exception.
Every bitbank market is quoted in JPY or BTC, which the quote family does not merge with USD, USDC or USDT, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a bitbank market would only ever pair with another JPY or BTC market.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | bitbank API docs repository, README and CHANGELOG, last change 2026-09-11 | https://github.com/bitbankinc/bitbank-api-docs | 2026-09-22 | bitbank, Japan | API layout, sections 3 and 8 |
| S2 | BTC/JPYの取引所手数料改定のお知らせ（2026年2月2日実施）, published 2026-01-09 | https://bitbank.cc/blog/articles/726061459 | 2026-09-22 | bitbank, Japan | BTC/JPY revision, sections 2 and 5 |
| S3 | 手数料 (fee guide), "2026年2月2日時点" | https://bitbank.cc/guide/fee | 2026-09-22 | bitbank, Japan | per pair fees, footer registrations, campaign note, sections 1 to 5 |
| S4 | Private stream | https://github.com/bitbankinc/bitbank-api-docs/blob/master/private-stream.md | 2026-09-22 | bitbank, Japan | dealer desk method, section 3 |
| S5 | 信用取引ルール (margin trading rules) | https://bitbank.cc/guide/margin-trading-rule | 2026-09-22 | bitbank, Japan | interest, leverage, age, documents, sections 1, 6 and 7 |
| S6 | 利用規約 (terms of service), revised 2026-04-01 | https://bitbank.cc/doc/tos | 2026-09-22 | bitbank, Japan | Articles 3, 4 and 15, section 1 |
| S7 | Support articles on account opening, seen as search snippets only, the pages answered 403 | https://support.bitbank.cc/hc/en-us/articles/360019587173-For-International-Enterprises | 2026-09-22 | bitbank, Japan | residency, section 1 |
| S8 | CoinGecko exchange and derivatives lists | https://api.coingecko.com/api/v3/exchanges/bitbank | 2026-09-22 | CoinGecko | trust rank 27, no derivatives listing, section 3 |
| S9 | CoinPost, bitbank starts margin trading on three pairs | https://coinpost.jp/?p=571087 | 2026-09-22 | press, Japan | margin start date 2024-11-11, shared book, section 3 |
| S10 | ビットバンクVIPプログラム announcements of 2023-11-21 and 2024-03-06 | https://bitbank.cc/blog/articles/502047567 | 2026-09-22 | bitbank, Japan | VIP programme, sections 4 and 5 |
| S11 | サーキットブレーカー制度の説明 (circuit breaker rules) | https://bitbank.cc/guide/circuit-breaker-mode | 2026-09-22 | bitbank, Japan | fee types during an auction, section 5 |
| S12 | CCXT 4.5.68 `bitbank.js` | `server/node_modules/ccxt/js/src/bitbank.js` | 2026-09-22 | CCXT | lines 22 to 31, 278, 328, 331, 335 to 337, 516 to 563 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbank/rest-probe.mjs) `catalog`, at 01:30 and 01:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbank/rest-probe.mjs) | 2026-09-23 UTC | this host | fees on the wire, margin interest, suspended pairs, CCXT values |
