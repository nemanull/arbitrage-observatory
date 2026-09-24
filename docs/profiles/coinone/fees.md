# Coinone Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:15 to 03:41 UTC), from the development host near Seattle.

Coinone (CCXT id `coinone`) is a South Korean spot exchange with one quote market, KRW, and it lists no perpetual, dated future or option.
This profile therefore covers its KRW spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every number below carries a source id from section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Coinone, Inc. (주식회사 코인원), CEO 차명훈, business registration 261-81-07437 | S8 footer |
| address | 45F Parkone Tower 1, 108 Yeouidae-ro, Yeongdeungpo-gu, Seoul | S8 footer |
| country | South Korea | CCXT `countries: ['KR']` at `server/node_modules/ccxt/js/src/coinone.js` line 23, and S10 |
| established | 2016 | S10 |
| products researched | KRW spot, 363 pairs listed, all 363 with `trade_status` 1 | P1, see [`rest.md`](./rest.md) section 2 |
| CoinGecko context | trust score 6, trust score rank 88, 24 h volume 1,711 BTC, read on 2026-09-23 UTC | S10 |

Who may trade:

- A natural person aged 19 or over may register, and a minor may not, S5.
- A foreign national, a non-resident included, cannot register, S5.
- An existing foreign member cannot verify the real-name KakaoBank account that KRW deposits need, so trading is restricted too, S5 and S6.
- S6 says domestic banks will not open or register a real-name account for a foreign national, and that this holds for every Korean virtual asset service provider.
- A person who became a Korean citizen by naturalisation may register, S5.
- A person living abroad cannot complete the non-face-to-face customer verification, so service is "difficult", S5.
- Registration is refused to nationals of 32 countries drawn from the FATF and OFAC lists, as of July 2024, among them Iran, North Korea, Russia, Vietnam, the Philippines and Monaco, S5.
- A corporate account is opened on request through a separate inquiry page, S5.
- A US person who is not a Korean national therefore cannot open an account, and a Korean national living in the United States cannot complete verification while abroad, as far as S5 and S6 show.

Access from this host:

- The public REST host `api.coinone.co.kr` answered every call with HTTP 200 and data, see [`rest.md`](./rest.md) section 1.
- The public socket `wss://stream.coinone.co.kr` opened on every attempt and delivered data, see [`websocket.md`](./websocket.md) section 1.
- The developer documentation at `docs.coinone.co.kr` answered HTTP 200, and its pages were read as Markdown by appending `.md` to each URL, S1 and S9.
- The marketing site `https://coinone.co.kr/` answered curl's default user agent with HTTP 403, `cf-mitigated: challenge` and `server: cloudflare`, a Cloudflare bot challenge, not a geoblock.
- The same pages answered HTTP 200 to a request carrying a browser `User-Agent` header, and the fee guide and notices below were read that way.

## 2. Quick answer

The engine would trade through the Open API, so the Open API rate is the one that matters.

| channel | maker | taker | in force | source |
|---|---|---|---|---|
| Open API, personal API key, standing rate | 0.02 %, 200 ppm | 0.02 %, 200 ppm | since 2025-01-02 | S1, S4 |
| Open API, personal API key, promotion | 0 %, 0 ppm | 0 %, 0 ppm | from 2026-08-21 00:00 KST until further notice | S1, S2 |
| app and web, no voucher | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | current | S4 |
| app and web, with the free voucher | 0 %, 0 ppm | 0 %, 0 ppm | from 2026-08-26 11:00 KST until further notice | S3, S4 |

There is no VIP 0 in a published tier table, because Coinone publishes one rate per channel and no volume tiers, see section 4.
The VIP 0 taker for this survey is taken as the standing Open API rate, 200 ppm, because the zero rate is a promotion with no end date.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-M perpetuals | absent | CCXT `swap: false` at `coinone.js` line 31, no derivative endpoint in the documentation index S9, and Coinone is absent from CoinGecko's 214 derivatives exchanges S10 |
| dated futures | absent | CCXT `future: false` at line 32, S9 |
| options | absent | CCXT `option: false` at line 33, S9 |
| margin | absent | CCXT `margin: false` at line 30. The site menu names a coin borrowing product (코인빌리기), S4, which is not margin on the order book and was not researched |
| spot, KRW quote | present, 363 pairs | P1 |
| spot, USDT, BTC or USDC quote | absent | `GET /public/v2/markets/USDT`, `/BTC` and `/USDC` each returned `"markets":[]`, P1 |

`USDT/KRW` and `USDC/KRW` are themselves spot pairs, and they were the two largest by 24 h KRW volume in the ticker poll, see [`rest.md`](./rest.md) section 4.

## 4. Spot tiers

There are none.

- The fee guide shows one standing rate, 0.25 % for maker and taker, and a voucher rate of 0 %, S4.
- The guide adds that pair-specific variable rates, other than the standing rate, are listed on the fee event page, S4, which was not read.
- The five VIP CLUB grades (PRESTIGE, PLATINUM, GOLD, SILVER, BRONZE) were merged into one VIP grade on 2026-08-01, S7.
- A VIP member gets no automatic fee discount and has to issue the voucher like anyone else, S7.

### Qualification

- Open API rates apply only to orders placed with a personal API key.
  Orders from a partner or external service linked to the account pay the standard rate, S1 and S2.
- A personal API key must carry registered IPv4 addresses, at most five per key, and expires after one year, S12.
- The voucher is issued free with one click, lasts 30 days, can be reissued from 7 days before expiry, and has no issue limit, S3 and S7.

## 5. Discounts that change the spot taker

| discount | effect on taker | ends | scope and exclusions | source |
|---|---|---|---|---|
| Open API zero fee | 200 to 0 ppm | "until further notice", and may change or end early | personal API keys only. Excludes pairs designated for caution (거래유의) or scheduled for delisting, partner and external service trades, and AI grid trades. Orders created before 2026-08-21 00:00 KST keep the old rate | S1, S2 |
| app and web voucher | 2,500 to 0 ppm | "until further notice" | orders placed and filled directly in the app or web only. Excludes smart trading, coin accumulation (코인모으기), coin borrowing repayment, Open API trades and partner API trades | S3, S7 |
| token holding, referral, market maker | none published | | | S4 |

The two zero-fee programmes do not stack, since each excludes the other's channel.

## 6. Funding as a cost

There is no funding rate, because Coinone lists no perpetual.
Coinone publishes no index or mark price either, see [`rest.md`](./rest.md) section 3.
The coin borrowing product charges its own fee, which is outside the scope guard and was not read.

## 7. Liquidation, settlement and delisting

- Spot has no liquidation or settlement charge.
- Delisting (거래지원 종료) and caution designations (거래유의) are announced as notices at `https://coinone.co.kr/info/notice/`, and a caution-designated pair loses the Open API zero fee, S2.
- Deposit and withdrawal fees are listed per network in the fee guide, S4, and are not recorded here.
  The guide's first row lists a KRW withdrawal fee of 1,000 KRW.

## 8. CCXT

| item | value | source |
|---|---|---|
| `fees.trading.taker` | `0.002` | `server/node_modules/ccxt/js/src/coinone.js` line 226 |
| `fees.trading.maker` | `0.002` | line 227 |
| `tierBased` | `false` | line 224 |
| `market.taker` without credentials | `0.002` on all 363 markets, in all four `loadMarkets` calls of the two runs | P1 |
| `market.maker` without credentials | `0.002` on all 363 markets | P1 |

The markets carry no fee of their own, so CCXT fills every market from the exchange-wide constant.
That constant is 0.2 %, which matches neither the standing Open API rate of 0.02 %, the promotion of 0 %, nor the app rate of 0.25 %.
The private endpoint `account/trade_fee` exists in CCXT's API table at line 206, but it needs a key and was not called.

## 9. Recommended registry values

No registry entry is recommended, because the connector keeps only active swap markets, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 203, and Coinone has none.

If a later spot design ever adds Coinone:

| field | value | reason |
|---|---|---|
| `takerPpm` | 200 | the standing Open API taker. The promotion's 0 ppm has no end date, may end early, and does not cover pairs designated for caution or scheduled for delisting |
| `ccxtTakerPpm` | 2000 | `coinone.js` line 226 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | API 거래 수수료율 안내 (API trading fee rates), page updated 2026-09-08 | https://docs.coinone.co.kr/docs/api-거래-수수료율-안내 | 2026-09-22 | Coinone, Korea | Open API 0.02 % since 2025-01-02, 0 % since 2026-08-21, exclusions, sections 2, 4 and 5 |
| S2 | Notice 5669, Open API zero fee from 8/21 00:00, registered 2026-08-19, updated 2026-08-21 | https://coinone.co.kr/info/notice/5669 | 2026-09-22 | Coinone, Korea | promotion dates, scope and exclusions, sections 2, 5 and 7 |
| S3 | Notice 5695, zero trading fee on every pair, registered 2026-08-25 | https://coinone.co.kr/info/notice/5695 | 2026-09-22 | Coinone, Korea | voucher from 2026-08-26 11:00 KST, 30 day validity, exclusions, sections 2 and 5 |
| S4 | 수수료 안내 (fee guide) | https://coinone.co.kr/support/fee-guide/ | 2026-09-22 | Coinone, Korea | 0.25 % standing rate, voucher 0 %, Open API 0.02 % and 0 %, variable rates, deposit and withdrawal table, sections 2 to 7 |
| S5 | Support article 31000152200, sign-up and corporate members | https://support.coinone.co.kr/support/solutions/articles/31000152200 | 2026-09-22 | Coinone, Korea | age, foreigners, residents abroad, 32 refused nationalities, corporate accounts, section 1 |
| S6 | Support article 31000177591, can foreigners use the service | https://support.coinone.co.kr/support/solutions/articles/31000177591 | 2026-09-22 | Coinone, Korea | real-name account rule for foreign nationals, section 1 |
| S7 | Support articles 31000179205, 31000179208, 31000179215 and 31000179217, voucher and VIP | https://support.coinone.co.kr/support/solutions/articles/31000179205 and the three sibling ids | 2026-09-22 | Coinone, Korea | voucher terms, voucher exclusions, VIP merge on 2026-08-01, no automatic VIP discount, sections 4 and 5 |
| S8 | Footer of the notice pages | https://coinone.co.kr/info/notice/5669 | 2026-09-22 | Coinone, Korea | company name, CEO, registration number, address, section 1 |
| S9 | Coinone developer documentation index | https://docs.coinone.co.kr/llms.txt | 2026-09-22 | Coinone | no derivative endpoint among the public, private and WebSocket pages, section 3 |
| S10 | CoinGecko API, `/exchanges/coinone` and `/derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/coinone | 2026-09-22 | CoinGecko | trust rank, volume, established year, absence from the derivatives list, sections 1 and 3 |
| S11 | CCXT 4.5.68 `coinone.js` | `server/node_modules/ccxt/js/src/coinone.js` | 2026-09-22 | CCXT | `countries`, market type flags, fee constants, `account/trade_fee`, sections 1, 3 and 8 |
| S12 | Changelog, Open API security policy change, IP registration and one year key validity | https://docs.coinone.co.kr/changelog/open-api-보안-정책-변경-안내 | 2026-09-22 | Coinone, Korea | API key IP registration and expiry, section 4 |
| P1 | `rest-probe.mjs catalog`, at 03:20 UTC and in the rerun | [`rest-probe.mjs`](../../../scripts/probes/venues/coinone/rest-probe.mjs) | 2026-09-22 | this host | pair count, other quotes empty, `market.taker`, sections 1, 3 and 8 |
