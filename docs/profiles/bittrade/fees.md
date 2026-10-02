# BitTrade Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:12 to 03:41 UTC), from the development host near Seattle.

BitTrade (CCXT id `bittrade`, formerly Huobi Japan) is a Japanese spot exchange, and it lists no perpetual, dated future or option.
This profile therefore covers its spot order book market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Its only leveraged product is a BTC/JPY contract for difference at up to 2x that the API does not serve, so it is named in the coverage matrix and its daily charge is recorded in section 6.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| legal entity | ビットトレード株式会社 (BitTrade Inc.), crypto asset exchange service provider registered as 関東財務局長 第00007号, and Type I Financial Instruments Business 関東財務局長（金商）第3295号, member of the Japan Virtual and Crypto assets Exchange Association | S3 |
| former name | Huobi Japan, rebranded to BitTrade | S6 |
| who may open an account | "口座開設は日本にお住まいの方のみ可能となります。", only people living in Japan | S3 |
| excluded persons | "外国の重要な公的地位にある方(外国PEPs)、米国の納税義務がある方、または反社会的勢力に該当する方は、口座を開設いただけません。", so foreign politically exposed persons, anyone with a US tax obligation, and antisocial forces are refused | S3 |
| US persons | may not trade, since an account needs residence in Japan and no US tax obligation | S3 |
| regions excluded | every region outside Japan | S3 |
| API scope | "現在、レバレッジ取引には未対応です。", the API does not serve leverage trading | S2 |
| public API from this host | `https://api-cloud.bittrade.co.jp` answered 200 on every public call, through a Cloudflare edge in Vancouver, see [`rest.md`](./rest.md) section 1 | P1 |
| public WebSocket from this host | `wss://api-cloud.bittrade.co.jp/ws` opened in 427 to 503 ms over 29 sockets and served the documented public topics, see [`websocket.md`](./websocket.md) section 1 | P2 |
| help center | `https://bittrade.zendesk.com/hc/ja/articles/...` answered 403 with a Cloudflare "Just a moment..." challenge, to curl from this host and to a fetch that does not originate here | S7 |

The fee page at S1 renders its exchange fee table in the browser, so the served HTML reads "データなし".
The table is filled from the site call `GET https://www.bittrade.co.jp/-/j/open/v1/trade_rule/exchange/list`, found in the page's script and read directly, S4.
The site's own setting call `GET https://www.bittrade.co.jp/-/j/open/v1/exchange/setting/fees` returns the same rates, S5.

## 2. Quick answer

| product | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---:|---:|---|
| spot order book (取引所), all 17 JPY pairs | 0.00 % | 0.10 % | 0 | 1,000 | S4, S5, S3 |
| dealer (販売所) | no fee, the spread is the charge | no fee, the spread is the charge | | | S1 |
| BTC/JPY leverage trading | no fee | no fee | | | S1 |

S4 gives `"min_maker_fee":"0","max_maker_fee":"0"` and `"min_taker_fee":"0.1","max_taker_fee":"0.1"` in percent on each of the 17 pairs, and S5 gives `"maker_fee":"0"` and `"taker_fee":"0.001"` as a fraction on the same 17.
The site states it in one sentence, "取引所ではメイカー取引手数料が0.00％、テイカー取引手数料が0.1％となります。", S3.

## 3. Coverage matrix

| product | present | detail | source |
|---|---|---|---|
| USDT-margined perpetuals | absent | | S2, CCXT `bittrade.js` line 34 `'swap': false` |
| USDC-margined perpetuals | absent | | S2 |
| coin-margined perpetuals | absent | | S2 |
| dated futures | absent | CCXT line 35 `'future': false` | S2 |
| options | absent | CCXT line 36 `'option': false` | S2 |
| spot order book | present | 45 symbols `online`, all quoted in JPY, of which 17 carry `api-trading` `enabled` and appear in the fee table | P1, S4 |
| spot margin | absent today | six BTC-quoted symbols still carry a `leverage-ratio` of 2 to 5, and all six are `offline` | P1 |
| leverage trading (レバレッジ取引) | present, not on the API | "ビットコイン/日本円のレバレッジ取引。レバレッジ倍率を最大2倍で取引して頂けます。", a BTC/JPY contract for difference at up to 2x, quoted with a bid and ask spread | S3, S2 |
| dealer (販売所) | present | the company is the counterparty, "取引相手は当社になります。" | S3 |

The site script also holds the line "レバレッジ取引は現在、新規でのサービスはご利用いただけません。", which says leverage trading takes no new service at present.
When the page shows that line was Not verified, S3.

## 4. Spot tiers

There is no tier table on the order book.
Each pair's fee rule has a minimum and a maximum maker and taker rate, and they are equal on all 17 pairs, S4.
CCXT declares `'tierBased': false` at `server/node_modules/ccxt/js/src/bittrade.js` line 249.

## 5. Discounts that change the spot taker

| discount | effect on the taker | source |
|---|---|---|
| 取引手数料割引ランク, a rank from HT holding and 30 day volume | none: `takerDiscount` is `"1"` at all eight levels, and `makerDiscount` is `"0.9"` from level 3, which leaves a 0 maker at 0 | S8 |
| paying fees in HT | the site offers it, and "手数料の支払い時に、利用可能なHTが足りない場合、自動的に通常の手数料に切り替わります。" | S3 |
| referral programme | "紹介プログラムの手数料配当" names a fee dividend to the referrer, not a taker cut | S3 |
| market maker programme | Not publicly specified | |
| zero fee promotion | none found on S1, S3 or S4 on 2026-09-22 | S1, S4 |

The HT token pair `htjpy` is `offline`, so buying HT on the exchange is not possible today, P1.
The volume and holding units of S8 are not stated beside the numbers.

## 6. Funding as a cost

Spot carries no funding.
The only periodic charge is on the leverage product.

| item | value | source |
|---|---|---|
| name | レバレッジ手数料, also called 建玉管理費 | S1, S3 |
| rate | "建玉ごとに 0.03%／日", 0.03 % of the position value a day, 300 ppm | S1 |
| instant | "毎営業日（祝日を含む）日本時間0:00時点の建玉保有状況を基準に判定します。", positions held across 00:00 JST, valued at the 00:00 price | S1 |
| cap and floor | a flat rate, so none | S1 |
| who pays | the holder, on each position held across 00:00 JST, and S1 names no side | S1 |

The charge instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| loss cut fee (ロスカット手数料) on leverage trading | 無料, free | S1 |
| spot delisting | pairs move to `offline`, and 49 of 95 symbols were `offline` and 1 `suspend` on 2026-09-23 | P1 |
| crypto withdrawal | per asset, see the official table on S1 | S1 |

## 8. CCXT

| item | value | source |
|---|---|---|
| `market.taker` and `market.maker` for a spot market without credentials | 0.002 on 93 of 95 markets, 0 on the two OMG markets, both offline | CCXT 4.5.68 `bittrade.js` line 563, `const fee = (base === 'OMG') ? this.parseNumber('0') : this.parseNumber('0.002');`, P1 |
| `fees.trading` | `maker` and `taker` 0.002, `tierBased` false | `bittrade.js` lines 246 to 253 |
| swap markets | 0 | `bittrade.js` lines 34 and 576, P1 |

CCXT's 2,000 ppm is twice the published 1,000 ppm taker and states a 2,000 ppm maker where the venue charges 0.

## 9. Recommended registry values

None.
The connector keeps only active swap markets, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202, so BitTrade would contribute no market and be skipped with "no usable swap markets" at line 51.
If a spot leg is ever built, the values would be `takerPpm: 1000` from S4 and S5, and `ccxtTakerPpm: 2000` from `bittrade.js` line 563.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 手数料一覧 | https://www.bittrade.co.jp/ja-jp/support/fee | 2026-09-22 | BitTrade Inc., Japan | dealer and leverage fees, 0.03 % a day, loss cut fee, sections 2, 6, 7 |
| S2 | BitTrade API documentation | https://api-doc.bittrade.co.jp/ | 2026-09-22 | BitTrade Inc., Japan | API scope without leverage trading, no derivatives, sections 1 and 3 |
| S3 | site script `app.67587e6b.js`, the strings behind the fee, account opening, leverage and dealer pages | https://www.bittrade.co.jp/static/js/app.67587e6b.js | 2026-09-22 | BitTrade Inc., Japan | registration numbers, residency and US tax rule, fee sentence, leverage description, HT payment, referral, sections 1 to 6 |
| S4 | exchange trade rule list, the source of the fee page table | https://www.bittrade.co.jp/-/j/open/v1/trade_rule/exchange/list | 2026-09-22 | BitTrade Inc., Japan | per pair maker and taker, section 2 |
| S5 | exchange fee setting | https://www.bittrade.co.jp/-/j/open/v1/exchange/setting/fees | 2026-09-22 | BitTrade Inc., Japan | per pair maker and taker as fractions, section 2 |
| S6 | CoinGecko exchange record `huobi_japan` | https://api.coingecko.com/api/v3/exchanges/huobi_japan | 2026-09-22 | CoinGecko | former name, trust score 7, 24 h volume 127.5 BTC, 27 tickers |
| S7 | BitTrade help center | https://bittrade.zendesk.com/hc/ja/articles/43494132256537 | 2026-09-22 | BitTrade Inc., Japan | 403 challenge to this host, section 1 |
| S8 | fee discount rank table | https://www.bittrade.co.jp/-/x/hbg/v1/fee/fee-rate | 2026-09-22 | BitTrade Inc., Japan | eight levels, taker multiplier 1, section 5 |
| C1 | CCXT 4.5.68 `bittrade.js` | `server/node_modules/ccxt/js/src/bittrade.js` | 2026-09-22 | CCXT | lines 34 to 36, 246 to 253, 563 and 576, sections 3 and 8 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/bittrade/rest-probe.mjs) `catalog` at 03:18 UTC, rerun at 03:34 UTC | | 2026-09-23 UTC | this host | symbol states, CCXT fees, sections 3, 5, 7, 8 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/bittrade/ws-probe.mjs), every mode, 03:19 to 03:41 UTC | | 2026-09-23 UTC | this host | socket reachability, section 1 |
