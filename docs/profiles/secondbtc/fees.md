# SecondBTC Fees Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific evening (04:24 to 04:53 UTC on 2026-09-23), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

SecondBTC lists no perpetual, no dated future, no option and no margin product, so this profile covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
SecondBTC publishes no fee schedule page that this host could read.
Every fee number below comes from the venue's own public API, and the unit of those fields is not stated anywhere this research found.
The book, the socket and the anchor question are in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | SecondBTC, `secondbtc.com` | S7 |
| CoinGecko record | name SecondBTC, established 2018, country India, trust score 5, trust score rank 105, 40 coins, 49 pairs, 24 h volume 711.26 BTC | S4, read at 04:32 UTC on 2026-09-23 |
| legal entity | Not verified. A search of the home page HTML and the web app bundle for Ltd, LLC, Limited, jurisdiction and registered office found no company name | S3, S7 |
| who may trade | Not verified. The terms page is rendered by JavaScript, `curl` gets an empty shell, and one headless Chrome render of `https://secondbtc.com/en/term` timed out after 60 s with no output | S8 |
| US persons | Not verified, for the same reason | S8 |
| market signals | the page title is "Buy Trade Bitcoin & Cryptocurrency in India". The bundle ships English and Turkish text, and its English strings say Turkish lira may be sent "via Money Order or EFT only from your individual bank account registered in your name" | S3, S7 |
| access from this host | every public REST call and the Socket.IO polling transport answered 200 through the Canadian VPN exit, at Cloudflare edges SEA and YVR. No geoblock or refusal page was seen. The WebSocket upgrade is refused with 400 for a protocol reason, see [`websocket.md`](./websocket.md) section 1 | P1, P3 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, 61 of 65 listed symbols | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | `tradeFeeMaker` 0.2 and `tradeFeeTaker` 0.2 in `exchangeInfo`, S1 and P1 |

The API returns the bare number `0.2` with no unit.
This profile reads it as a percent, because the same field read as a fraction would be a 20 % fee.
That reading is an inference.
The home page describes the venue as a "Zero Fee Cryptocurrency Exchange", S7, and no public field on 2026-09-22 showed a zero fee on an active market.

The four symbols with another value, from S1 in both runs of P1:

| symbol | `tradeFeeMaker` / `tradeFeeTaker` | status |
|---|---|---|
| `MBASEUSDT` | 0.02 / 0.02 | disabled |
| `CATSUSDT` | 0.02 / 0.02 | disabled |
| `WBTCUSDT` | null / null | disabled |
| `PEPEAIUSDT` | 10000 / 10000 | active |

The `PEPEAIUSDT` value would be a 10,000 % fee under the percent reading, so it looks like a data entry error.
The `assets` call, which follows the CoinMarketCap exchange API field names, repeats the same numbers per asset: `maker_fee` and `taker_fee` are 0.2 on 42 of 43 assets and 10000 on one, S2 and P1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no contract fields in `exchangeInfo`, S1. CoinGecko's derivatives list of 214 venues has no SecondBTC entry, and `/derivatives/exchanges/secondbtc` answers 404 `{"error":"market not found"}`, S5 |
| USDC-margined perpetuals | absent | as above |
| coin-margined perpetuals | absent | as above |
| dated futures | absent | as above. The web app routes are home, exchange, quick trade, earn, staking, bridge, airdrop, wallet, listing, API, support and legal pages, with no futures route, S3 |
| options | absent | as above |
| margin | absent | no margin field in `exchangeInfo`, and order types are `LIMIT`, `MARKET` and `STOP LIMIT` on all 65 symbols, S1 and P1 |
| spot | present | 65 symbols, 56 enabled: 47 against USDT, 6 against USDC and 3 against FDUSD, S1 and P1 |

## 4. Published tiers

SecondBTC publishes no tier table that this research found.
The `exchangeInfo` fee fields are per symbol and carry no volume tiers, S1.
The web app bundle has "Maker", "Taker", "Maker Fee" and "Trading fees" labels but no tier text, S3.

## 5. Discounts

| discount | text | status |
|---|---|---|
| exchange token | "Users who activate commission payment with Token will benefit from a commission discount of up to 50%.", translation key 10336 in S3 | written in the future tense, "It will be able to activate Token for trading commission". The exchange page reads a per user `tokenCommission` object when it prints a fee, S9, so the switch exists in code. Whether it is live was not verified without an account |
| referral, market maker, promotions | none found | S3 |

## 6. Funding as a cost

Not applicable.
SecondBTC lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting charges

Not applicable to spot trading.
No liquidation, settlement or delisting fee appears in any public field or bundle string, S1 and S3.

## 8. CCXT

CCXT 4.5.68 in `server/node_modules` has no SecondBTC class.
`ccxt.exchanges` lists 104 ids and none matches `second` or `sbtc`, P1.
A `grep -rli secondbtc` over `server/node_modules/ccxt/js/src` found no file.
The CCXT master branch on GitHub has no `ts/src/secondbtc.ts` (404), and the `ts/src` listing of 105 TypeScript files has none matching either name, at the latest `ts/src` commit `fbc5f21` of 2026-09-22 10:33 UTC, S6.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
SecondBTC lists no perpetual, so it has no place in [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) as the engine is built today.
If a spot leg were ever added, `takerPpm` would be 2,000 from `tradeFeeTaker` under the percent reading, and `ccxtTakerPpm` would have no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SecondBTC `exchangeInfo` | https://api.secondbtc.com/api/v1/exchangeInfo | 2026-09-22 | SecondBTC, global | fee fields, symbol status, quotes, order types, sections 2 to 4 |
| S2 | SecondBTC `assets` | https://api.secondbtc.com/api/v1/assets | 2026-09-22 | SecondBTC, global | per asset `maker_fee` and `taker_fee`, section 2 |
| S3 | SecondBTC web app bundle `app.bcfdac16.js` | https://secondbtc.com/js/app.bcfdac16.js | 2026-09-22 | SecondBTC | routes, English and Turkish strings, token discount text, fee labels, sections 1, 3 to 5 and 7 |
| S4 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/secondbtc | 2026-09-22 | CoinGecko | country, year, trust score, volume, section 1 |
| S5 | CoinGecko derivatives exchange list and record | https://api.coingecko.com/api/v3/derivatives/exchanges/list and https://api.coingecko.com/api/v3/derivatives/exchanges/secondbtc | 2026-09-22 | CoinGecko | no derivatives listing, section 3 |
| S6 | CCXT master `ts/src` listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-22 | CCXT | no SecondBTC class, section 8 |
| S7 | SecondBTC home page | https://secondbtc.com/ | 2026-09-22 | SecondBTC | title, "Zero Fee" description, section 1 |
| S8 | SecondBTC sitemap and terms page | https://secondbtc.com/sitemap.xml and https://secondbtc.com/en/term | 2026-09-22 | SecondBTC | terms page exists and is rendered client side, section 1 |
| S9 | SecondBTC exchange page chunk `180.fec704b1.js` | https://secondbtc.com/js/180.fec704b1.js | 2026-09-22 | SecondBTC | `tokenCommission` in the fee column, section 5 |
| P1 | `rest-probe.mjs catalog`, runs at 04:33 and 04:47 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/secondbtc/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | fee fields, catalog counts, CCXT check, sections 1 to 3 and 8 |
| P3 | `ws-probe.mjs transport` and `book`, runs at 04:38 to 04:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | socket access, section 1 |
