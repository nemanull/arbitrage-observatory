# GMO Coin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 03:06 to 03:35 UTC), from the development host near Seattle.

GMO Coin (no CCXT class, see section 8) is a Japanese exchange whose order book venue offers spot and a JPY leverage product.
The leverage product is what CoinGecko lists as "GMO Coin Japan (Futures)" with 5 perpetual pairs, and the API calls it "Margin trading", S2.
It has no expiry, it settles profit and loss in JPY, and it charges a flat daily leverage fee instead of a funding rate, see section 6.
This profile treats those 12 `*_JPY` leverage symbols as the venue's only perpetual family.
Every number below carries a source id from section 10, a probe reference, or a source file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | GMO Coin, Inc. (GMOコイン株式会社) | S1 footer |
| licences | crypto-asset exchange service provider, Kanto Local Finance Bureau No. 00006, and financial instruments business operator, Kanto Local Finance Bureau (Kinsho) No. 3188 | S1 footer, "関東財務局長 第00006号（暗号資産交換業） 関東財務局長（金商）第3188号" |
| associations | JVCEA and the Financial Futures Association of Japan | S1 footer |
| who may open an individual account | "日本国内に居住する２０歳以上の個人であること", an individual aged 20 or over who resides in Japan | S4 |
| who may open a corporate account | a company incorporated under Japanese law with its head office or a branch registered in Japan, whose representative and trader reside in Japan | S5 |
| excluded regions | every place outside Japan, since residence in Japan is a condition of the account | S4, S5 |
| US persons | only a US person who resides in Japan qualifies, and a US resident cannot open an account | S4 |
| leverage | 2x for individuals, and for corporations the JVCEA risk ratio of each coin | S3, "レバレッジ2倍（個人のお客さま）" |
| fee schedule retrieved | 2026-09-22 Pacific time, early on 2026-09-23 UTC | S1 |

The English API documentation is public, S2, but the fee page, product pages and account rules exist only in Japanese.
The support centre at `support.coin.z.com` answered this host with HTTP 403 and a Cloudflare challenge (`cf-mitigated: challenge`), and a fetch from outside this host got 403 too, so no support article was read.

## 2. Quick answer

| family | symbols | VIP 0 maker | VIP 0 taker |
|---|---|---|---|
| JPY leverage, fee-free group | `BTC_JPY`, `ETH_JPY`, `BCH_JPY`, `LTC_JPY`, `XRP_JPY` | 0 %, 0 ppm | 0 %, 0 ppm |
| JPY leverage, other symbols | `DOT_JPY`, `ATOM_JPY`, `ADA_JPY`, `LINK_JPY`, `DOGE_JPY`, `SOL_JPY`, `SUI_JPY` | 0 %, 0 ppm | 0.03 %, 300 ppm |

The fee page states "BTC/JPY、ETH/JPY、BCH/JPY、LTC/JPY、XRP/JPY 無料" and "上記以外の銘柄 Maker：無料 Taker：0.03%", S1.
The public `/v1/symbols` call returns the same per symbol, `"takerFee":"0","makerFee":"0"` on the first five and `"takerFee":"0.0003","makerFee":"0"` on the other seven, in P1 and P2.
The trading fee is not the whole cost: every position held across 06:00 JST pays 0.04 % a day, 400 ppm, see section 6.

## 3. Coverage matrix

| product | present | detail |
|---|---|---|
| JPY leverage, exchange order book (取引所レバレッジ取引) | yes, 12 symbols | the researched family, released between 2018-09-05 (`BTC_JPY`) and 2026-01-17 (`SUI_JPY`), S2 symbol table |
| USDT-margined or USDC-margined perpetuals | absent | the API lists only `*_JPY` leverage symbols, S2, P1 |
| coin-margined perpetuals | absent | |
| dated futures | absent | CoinGecko reports 0 futures pairs, S7 |
| options | absent | none in S2 or S3 |
| spot, exchange order book | yes, 17 symbols | named only, as the scope guard asks: maker -0.01 % and taker 0.05 % on BTC, ETH and XRP, maker -0.03 % and taker 0.09 % on the other 14, S1 and P1 |
| Crypto FX (暗号資産FX) | yes, app only | a dealer-quoted leverage product with GMO Coin as counterparty, not on the public API, trading fee free, S1 |
| retail OTC desk (販売所) | yes | spread priced, not on the public API, S1 |
| foreign exchange FX | yes | a separate API at `forex-api.coin.z.com`, whose public `USD_JPY` ticker answered 200 on 2026-09-23 03:29 UTC |

CoinGecko's derivatives record says 5 perpetual pairs and returned tickers for `BTC_JPY` and `ETH_JPY` only, with `funding_rate` 0, `index` null and `open_interest_usd` 0, S7.
The API lists 12 leverage symbols, so the CoinGecko count is stale or counts only the five fee-free ones.

## 4. Perpetual tiers

No tier table exists.
The fee is a flat rate per symbol, the same for every customer, S1, and `/v1/symbols` carries it per symbol without an account, P1.
The only volume-based tier on the venue is the Private API rate limit: Tier 1 is 20 GET and 20 POST requests a second, and Tier 2 is 30 each for a previous-week volume of 1,000,000,000 JPY or more, S2 section "API Limiting".
It does not change the fee.

## 5. Discounts that change the perpetual taker

| discount | exists | note |
|---|---|---|
| token holding | none found | S1 names no token discount |
| referral | none found | S1 names none |
| market maker programme | none found | S1 names none |
| zero fee promotion | the five fee-free symbols are standing policy, not a promotion with an end date | S1 |
| API surcharge | none on the exchange: "API手数料" is 無料 for 取引所（レバレッジ） | S1 |
| negative maker | spot only, -0.01 % and -0.03 %, and the leverage maker is 0 | S1, P1 |

The API fee column of S1 charges only the separate foreign exchange FX API, 0.002 % of the traded amount.

## 6. Funding as a cost

There is no funding rate, no index and no mark price, S1, S2, S3.
The leverage product charges a flat leverage fee instead.

| item | value | source |
|---|---|---|
| name | レバレッジ手数料, leverage fee | S1 note 3 |
| rate | 0.04 % a day, 400 ppm, per position | S1, "建玉ごとに0.04% / 日" |
| formula | "評価レート × 建玉数量 × 0.04% / 日", valuation rate times position size | S3 note 10 |
| valuation rate | the valuation "計算した評価額" from the trading day's closing price, "当取引日の終値" | S1 note 3 |
| when | a position held across 06:00 JST on each business day, holidays included, which is 21:00 UTC | S1 note 3 |
| who pays | every position, long and short alike, to GMO Coin | S1, "建玉ごとに" |
| cap and floor | none, the rate is fixed | S1 |
| interval | 24 h | S1 |

This is not a transfer between longs and shorts, so it does not pull the leverage price towards spot.
The leverage books traded at a premium over GMO Coin's own spot books during the probe, see [`rest.md`](./rest.md) section 4.
No settlement instant was captured, and no public call reports the fee or its history.
The private `GET /private/v1/account/exchangeFee/history`, released 2026-08-29, carries the exchange leverage fee as `feeType` `LEVERAGE_FEE`, and it excludes the Crypto FX leverage fee, S2 changelog and section "Exchange Fee History".
Its documented example books a `BTC_JPY` leverage fee at `"deliveryDatetime": "2026-06-15T21:01:23.456Z"`, one minute after 06:00 JST, S2.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| loss cut fee | "建玉レート × 建玉数量 × 0.5% / 回", 0.5 % of the position at its open price | S1 note 2, S3 |
| forced settlement when a margin call is not met | 0.5 % of the position at its open price | S1 note 4, S3 |
| margin call | at 06:30 JST each business day, weekends and holidays included, when the maintenance ratio is below 100 % | S3 |
| loss cut trigger | "現在値が建玉のロスカットレートに到達した場合", when the current price reaches the position's loss cut rate, or when the account maintenance ratio reaches the level GMO Coin sets | S3 |
| loss cut rate | long: open price minus 50 % of the margin per unit, short: open price plus 50 % of it | S3 note 7 |
| position limit, `BTC_JPY` | 50 BTC long and 50 BTC short | S3 |
| order limit, `BTC_JPY` | 0.001 to 5 BTC per order, 3,000 BTC of new positions a day | S3, and `minOrderSize` and `maxOrderSize` in P1 |
| settlement | immediate, on the trade date, "即時受渡（約定日と同日）" | S3 |
| delisting | no rule for a leverage symbol was found, and the 2026 changelog removed `XTZ` and `DAI` from the spot list only | S2 changelog |

The loss cut is judged on "現在値", which S3 does not define further.
No mark price exists to judge it against.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68, `ccxt.exchanges` from `server/` | 104 ids, none matching `gmo`, `coinz` or `zcom`, and none in `ccxt.pro`, P1 and P2 |
| CCXT master, `ts/src` on GitHub | no `gmocoin.ts` or `gmo.ts`, both 404 as raw files, and the directory listing of 105 `.ts` files names none, checked on 2026-09-23 at master `1d8b674` of 2026-09-22 |
| open pull request | ccxt/ccxt#27965 "feat(gmocoin): new exchange", opened 2026-02-23, last updated 2026-05-15, open and not merged |

So `market.taker` cannot be read for any GMO Coin market from CCXT 4.5.68.

The open pull request would not give the engine a catalog even if merged.
Its `ts/src/gmocoin.ts` at head `a5c8091` declares `'spot': true`, `'margin': false` and `'swap': false` in its `has` block, at lines 26 to 28.
Its `parseMarket`, from line 285, builds every market as `'type': 'spot'` at line 313, with `taker` and `maker` from `takerFee` and `makerFee` at lines 323 and 324.
It maps both `BTC` and `BTC_JPY` to the symbol `BTC/JPY`, lines 294 to 306, so the spot and leverage markets collide.
The engine keeps only `type === 'swap'` markets, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203, so it would drop them all.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 0 on the five fee-free symbols, 300 on the other seven | S1 and `/v1/symbols`, P1 |
| `ccxtTakerPpm` | not applicable | no CCXT class exists in 4.5.68 or master |

The registry holds one `takerPpm` per venue entry, as at [`../../../server/src/venues/registry.ts`](../../../server/src/venues/registry.ts) line 46, so a per symbol fee would need 300 as the conservative value or a per market override.
Neither matters until the blockers in [`rest.md`](./rest.md) section 8 are solved, since the venue cannot join the engine in its current shape.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 手数料 (fees) | https://coin.z.com/jp/corp/guide/fees/ | 2026-09-22 | GMO Coin, Japan | fee table, notes 1 to 5, footer licences, sections 1 to 7 |
| S2 | GMO Coin API documentation, English | https://api.coin.z.com/docs/en/ | 2026-09-22 | GMO Coin, Japan | symbol table, API limits, Exchange Fee History, changelog, sections 3 to 8 |
| S3 | 取引所（暗号資産の購入・売却・レバレッジ取引） | https://coin.z.com/jp/corp/product/info/exchange/ | 2026-09-22 | GMO Coin, Japan | leverage rules for `BTC_JPY`, margin, loss cut, fees, sections 1, 6 and 7 |
| S4 | 口座開設の流れ (account opening) | https://coin.z.com/jp/corp/guide/flow/ | 2026-09-22 | GMO Coin, Japan | account opening criteria, section 1 |
| S5 | 法人口座 (corporate accounts) | https://coin.z.com/jp/corp/guide/corporate/ | 2026-09-22 | GMO Coin, Japan | corporate criteria, section 1 |
| S6 | ccxt/ccxt pull request 27965, `ts/src/gmocoin.ts` at `a5c8091` | https://github.com/ccxt/ccxt/pull/27965 | 2026-09-22 | CCXT | section 8 |
| S7 | CoinGecko API, `derivatives/exchanges/gmo_japan_futures` and `exchanges/gmo_japan` | https://api.coingecko.com/api/v3/derivatives/exchanges/gmo_japan_futures | 2026-09-22 | CoinGecko | 5 perpetual pairs, 0 futures pairs, 1,103.64 BTC futures volume, spot trust rank 42 and 457.6 BTC spot volume, section 3 |
| P1 | `rest-probe.mjs catalog`, and the other modes, 03:11 to 03:16 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gmo-coin/rest-probe.mjs) | 2026-09-22 | this host | fees per symbol, catalog, CCXT check |
| P2 | `rest-probe.mjs all`, the second pass, 03:23 to 03:25 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/gmo-coin/rest-probe.mjs) | 2026-09-22 | this host | the same, second reading |
