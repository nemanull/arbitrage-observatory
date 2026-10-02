# BTCBOX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:00 UTC), from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

BTCBOX (CCXT id `btcbox`) is a Japanese exchange with a yen order book on four coins and a dealer desk, and it lists no perpetual, dated future or option.
This profile therefore covers its spot order book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | BTCボックス株式会社, BtcBox Co., Ltd., founded 2014-03-06, head office Nihonbashi Kayabacho, Tokyo | S4 |
| licence | crypto-asset exchange service provider, Kanto Local Finance Bureau registration No. 00008 | S4 |
| associations | JVCEA member No. 1008, and Japan Payment Service Association member No. 00745 | S4 |
| business line | crypto-asset exchange only, "暗号資産交換業： 暗号資産取引所「BTCBOX」運営" | S4 |
| country | Japan | S4, and CCXT `countries: ['JP']` at `server/node_modules/ccxt/js/src/btcbox.js` line 24 |
| products researched | spot order book, 7 markets listed by CCXT, 4 tradable, all quoted in JPY | P1, see [`rest.md`](./rest.md) section 2 |
| CoinGecko | trust score 2, `trust_score_rank` 423 in the API reply, one tracked ticker `BTC/JPY` with 1.31 BTC of 24 h volume | S7, read twice, 2026-09-23 04:48 and 04:55 UTC |

The fee page S3 carries a post date of 2019-09-02, yet it names DOGE, DOT and TRX and a restriction that starts in April 2026, so its content is current.

Who may trade:

- The terms of service, last revised 2025-06-24 (令和7年6月24日), Article 2, bar anyone residing or located in a country or region that is uncooperative in anti money laundering and terrorist financing, and anyone residing or located in the United States, S5.
- The same article bars anyone residing or located in a country or jurisdiction whose law does not allow it to hold a bank account in Japan, S5.
- Article 8 takes yen deposits only by bank transfer in yen, and pays yen withdrawals only to a bank account in the customer's name that was registered in advance, S5.
- A minor needs a parental consent form and the parent's identity documents, S5 Article 2.
- A US person therefore may not trade here, and in practice an account needs a Japanese bank account.
- The English support article that CCXT names as its fee URL answered HTTP 403 to curl from this host and HTTP 403 to the documentation fetch, S6, so no English fee page was read.

The public REST endpoints answered this host with HTTP 200 and data, through the Canadian VPN exit, and no geoblock or refusal was seen, see [`rest.md`](./rest.md) section 1.
No WebSocket exists, see [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

BTCBOX publishes one flat schedule with no tiers, S3.

| market | maker | taker | maker ppm | taker ppm |
|---|---|---|---:|---:|
| BTC/JPY | 0.05 % | 0.05 % | 500 | 500 |
| BCH/JPY | 0.10 % | 0.10 % | 1,000 | 1,000 |
| ETH/JPY | 0.10 % | 0.10 % | 1,000 | 1,000 |
| LTC/JPY | 0.10 % | 0.10 % | 1,000 | 1,000 |

The rates include Japanese consumption tax, "手数料はすべて消費税込みとなっています", S3.
The fee is charged on the crypto or yen received, "売買される暗号資産又は日本円に手数料率をかけて、売買手数料を計算します", S3.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | CCXT `'swap': false` at `server/node_modules/ccxt/js/src/btcbox.js` line 32, no product on the fee page S3, the business line is the exchange licence only, S4, and none of the 214 ids in CoinGecko's derivatives exchange list is BTCBOX, S9 |
| dated futures | absent | CCXT `'future': false` at line 33, S3, S4 |
| options | absent | CCXT `'option': false` at line 34, S3, S4 |
| margin | absent | CCXT `'margin': false` at line 31, and no margin product on S3 |
| spot order book (取引所) | present | BTC/JPY, BCH/JPY, ETH/JPY, LTC/JPY, S3 and P1 |
| dealer desk (かんたん売買, 販売所) | present | BTC, ETH, DOGE, DOT and TRX against JPY, no fee, a spread instead, S3 |
| Bitcoin lending (ビットコイン融資) | present, not a trading product | company history entry of 2016-02, S4, and terms Article 9, S5 |
| recurring purchase (あんしん定期購入) | present, not a trading product | company history entry of 2021-09, S4 |

Every market is quoted in JPY, so none falls into the engine's USD, USDC and USDT quote family at `server/src/engine/cluster/quoteFamily.ts` lines 3 to 6.

`DOGE_JPY`, `DOT_JPY` and `TRX_JPY` appear in the public `tickers` reply and in CCXT's catalog, but the web coin table marks their order book disabled, `trade.enable` 0, and their `depth` reply is one locked level, which is the dealer desk's quote, see [`rest.md`](./rest.md) section 2.

## 4. Spot tiers

There are no tiers, S3.

| market | maker | taker | minimum order | source |
|---|---|---|---|---|
| BTC/JPY | 0.05 % | 0.05 % | 0.00001 BTC | S3 |
| BCH/JPY | 0.10 % | 0.10 % | 0.001 BCH | S3 |
| ETH/JPY | 0.10 % | 0.10 % | 0.0001 ETH | S3 |
| LTC/JPY | 0.10 % | 0.10 % | 0.001 LTC | S3 |

The page states that no upper order size applies, "売買数量の上限はありません", S3.
A market buy of BTC needs at least the yen value of 0.001 BTC, and a market buy of ETH, BCH or LTC needs at least 10,000 JPY, S3.
The API documentation lists error 202, "The price is 20% more than or less than current price", and error 204, an order price cap of 10 million JPY for BTC and 1 million JPY for other coins, S1.
BTC traded near 13.7 million JPY on 2026-09-23, P3, so the 204 cap as written is stale and was not tested, because testing it needs an order.

## 5. Discounts that change the spot taker

- No token, volume tier, referral or market maker programme is published, S3.
- S3 says the rate may be changed for some customers, "一部のお客様に対しては、売買手数料率を変更させていただく可能性がございます", and names no criterion.
- The dealer desk charges no fee and earns a spread instead, S3, so it is not a cheaper taker.
- No zero fee promotion was listed on S3 on 2026-09-22.

## 6. Funding as a cost

Not applicable.
BTCBOX lists no perpetual and no margin product, section 3, so no funding or borrowing interest applies to a spot trade.

Deposit, withdrawal and yen transfer charges are listed on S3.
S3 also says that from April 2026 withdrawals to exchanges outside the travel rule's jurisdictions are restricted for the time being, "2026年4月より当面の間、防犯上の理由によりトラベルルール法域外の暗号資産交換業者への出庫は制限させていただきます", and that crypto withdrawals are processed by hand, within 24 hours when requested between 9:00 and 17:30 on a weekday and by the next business day otherwise, S3.
That makes moving inventory between BTCBOX and a foreign venue slow and possibly refused.

## 7. Liquidation, settlement and delisting

- No liquidation or settlement charge exists, since nothing is leveraged.
- No delisting charge is published on S3.
- Terms Article 21 lets BTCBOX suspend or interrupt the service, S5.

## 8. CCXT

CCXT 4.5.68 sets the fee inside `fetchMarkets`, at `server/node_modules/ccxt/js/src/btcbox.js` line 260.

```js
const fee = (id === 'BTC') ? this.parseNumber('0.0005') : this.parseNumber('0.0010');
```

`id` is the lower case base, built at line 257 as `baseCurr.toLowerCase()`, so the comparison with `'BTC'` never matches.
Every market, BTC/JPY included, therefore reports `taker` 0.001 and `maker` 0.001, lines 279 and 280, which P1 confirmed on all 7 markets without credentials.

| market | CCXT `taker` | published taker | difference |
|---|---:|---:|---|
| BTC/JPY | 0.001, 1,000 ppm | 0.0005, 500 ppm | CCXT is double the published rate |
| BCH/JPY, ETH/JPY, LTC/JPY | 0.001, 1,000 ppm | 0.001, 1,000 ppm | none |

The class declares no `fees` block of its own and no `fetchTradingFees`, so the per market constant above is the only fee it reports.

## 9. Recommended registry values

BTCBOX should not be added to [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts), because it lists no perpetual, the connector keeps only active swaps at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 199 to 201, and every market is quoted in JPY.

If a spot stage ever takes it:

- `ccxtTakerPpm`: 1,000, the constant at `server/node_modules/ccxt/js/src/btcbox.js` line 260, as P1 read it on every market.
- `takerPpm`: 500 is correct only for BTC/JPY, and 1,000 for the other three markets, so one venue level override cannot be right for both, and a per market override would be needed.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTCBOX API Documentation, English, dated 2020.06.11 | https://blog.btcbox.jp/en/archives/8762 | 2026-09-22 | BtcBox Co., Ltd., Japan | error codes 202 and 204, section 4 |
| S2 | BTCBOX API ドキュメント, Japanese, dated 2023.04.14 | https://blog.btcbox.jp/archives/8759 | 2026-09-22 | BtcBox Co., Ltd., Japan | the same limits and codes, see [`rest.md`](./rest.md) |
| S3 | 手数料・入出金の説明、発注数量について | https://blog.btcbox.jp/fees-introduction-3 | 2026-09-22 | BtcBox Co., Ltd., Japan | every fee, minimum and withdrawal note, sections 2 to 6 |
| S4 | 会社概要 | https://blog.btcbox.jp/company-profile | 2026-09-22 | BtcBox Co., Ltd., Japan | operator, licence, associations, history, sections 1 and 3 |
| S5 | 利用規約, revised 2025-06-24 | https://blog.btcbox.jp/jp-usage-agreement | 2026-09-22 | BtcBox Co., Ltd., Japan | Articles 2, 8, 9 and 21, sections 1, 3 and 7 |
| S6 | Fees introduction, the URL CCXT names at `btcbox.js` line 127 | https://support.btcbox.co.jp/hc/en-us/articles/360001235694-Fees-introduction | 2026-09-22 | BtcBox Co., Ltd. | HTTP 403 to curl and to the documentation fetch, section 1 |
| S7 | CoinGecko API `exchanges/btcbox` | https://api.coingecko.com/api/v3/exchanges/btcbox | 2026-09-23 UTC | CoinGecko | trust score, tracked ticker, volume, section 1 |
| S8 | CCXT 4.5.68 `btcbox.js` | `server/node_modules/ccxt/js/src/btcbox.js` | 2026-09-22 | CCXT | `has` flags lines 30 to 34, fee constant line 260, section 8 |
| S9 | CoinGecko API `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 04:55 UTC | CoinGecko | 214 derivatives venues, BTCBOX not among them, section 3 |
| P1 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | CCXT `taker` and `active` per market, sections 1, 3 and 8 |
| P3 | `rest-probe.mjs book` | [`rest-probe.mjs`](../../../scripts/probes/venues/btcbox/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | BTC price level, section 4 |
