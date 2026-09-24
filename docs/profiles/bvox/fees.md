# BVOX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:16 to 03:45 UTC, from the development host near Seattle, which Cloudflare places in Canada (`loc=CA`, colo `YVR`).
Every BVOX host refused this machine, so no live fee number could be read, see [`rest.md`](./rest.md) section 1.

This profile covers BVOX, formerly BitVenus, a venue built on the BHEX broker platform.
It has no CCXT class, see section 8.
Its site serves this host a static page that reads "Services are temporarily unavailable in your region. Current IP: Not Support Region.", and its API documentation link returns 404.
So the fee numbers below come from archived copies of BVOX's own web app replies and from CoinGecko, and none was confirmed live.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | BVOX, formerly BitVenus, founded 2018 | S1, S2 |
| legal entity | not found. The Terms and Conditions link on the served page has `href="#"`. The archived home configuration points the user agreement at `https://www.bvox.com/en-US/support/articles/10000088`, and its archived copy of 2024-12-12 holds only the app shell with no agreement text | P1, S4, S11 |
| country of incorporation | British Virgin Islands, as CoinGecko lists it | S1 |
| platform | BHEX broker cloud: the web app used `exchangeId=301`, the `-SWAP-USDT` symbol style and `static.bvox.io/bhop/` assets, and its bundle falls back to `www.bhex.com` on a local host | S5, S6 |
| who may register | 197 countries in the archived registration list of 2025-04-21 | S7 |
| excluded regions | absent from that list: United States, Canada, mainland China, Singapore, United Kingdom, Netherlands, Russia, North Korea, Iran, Cuba, Syria, Myanmar | S7 |
| US persons | may not register, since the United States is not in the list | S7 |
| region check in the web app | the config reply archived on 2026-08-02 carries `"riskIpDisabled":{"enableStatus":"1","countryName":"United States","ip":"207.241.225.86"}` and ARIN registers that address to the Internet Archive, so the web app placed the crawler in the United States. The meaning of `enableStatus` `"1"` is not documented | S9, S10 |
| this host | every site host serves the region refusal page, see [`rest.md`](./rest.md) section 1 | P1 |

The region refusal page is a static file with `Last-Modified: Mon, 24 Aug 2026 13:13:45 GMT`, P1.
The Internet Archive saw the working web app at `www.bvox.com` on 2026-04-30, 2026-06-22, 2026-07-21 and 2026-08-01, and the refusal page on 2026-09-02 and 2026-09-11, S4.
So the crawler, whose location is not published, is refused as well.
Whether a visitor in a supported country still reaches the exchange was not checked, because that would need a route around the refusal.
CoinGecko still receives BVOX futures data: its ticker reply read at about 03:30 UTC held last trade times up to 2026-09-23 03:27:52 UTC, S3.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | `feeConfig` of 97 of 97 contracts in BVOX's own config reply archived on 2026-08-02, S9, and of 20 of 20 in its catalog reply archived on 2026-08-19, S5 |
| USD-quoted perpetuals, 5 contracts | Not verified | Not verified | no archived BVOX reply lists them |

Both replies carry `makerBuyFee`, `makerSellFee`, `takerBuyFee` and `takerSellFee` per contract, and every contract in them carries `"0.0002"` and `"0.0006"`, S5 and S9.
Whether that per contract configuration is the retail VIP 0 rate is an inference, since no fee page could be read.
CoinGecko's futures exchange page reads "Fees: 0.1%" with no maker and taker split, S2, which disagrees with the catalog.
CoinGecko does not say where that figure comes from.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals, `<BASE>-SWAP-USDT` | present: 97 in BVOX's own config on 2026-08-02, 383 CoinGecko tickers on 2026-09-23 | S9, S3 |
| USD-quoted perpetuals, `<BASE>-SWAP-USD` | 5 CoinGecko tickers: BCH, ETH, LINK, LTC, XRP. BVOX's config of 2026-08-02 lists no contract outside USDT and none with `isReverse` true | S3, S9 |
| all perpetuals | 389 by CoinGecko's API count, 388 ticker rows of which one symbol, `1000SHIB-SWAP-USDT`, appears twice. CoinGecko's page says 1,352 trading pairs, which this profile could not reconcile | S3, S2 |
| dated futures | absent, `number_of_futures_pairs` 0 | S3 |
| options | absent from every source read | S1, S3 |
| spot | present, named on the served page's menu and listed by CoinGecko as a separate exchange | P1, S1 |
| pre-market | named on the served page's menu | P1 |

All 97 contracts of BVOX's config appear among CoinGecko's tickers, and CoinGecko carries 290 more symbols.
Whether BVOX listed those after 2026-08-02 or CoinGecko reads a wider set than the web app showed is Not verified.
The same config lists 477 spot symbols, all quoted in USDT, and no option symbol, S9.

## 4. Perpetual tiers

No tier table could be read.
The served page names "VIP Benefits" and "Trading Fee" in its menu and footer, and every link on it has `href="#"`, P1.
The Wayback Machine index holds no fee or VIP page for `bvox.com` or `bitvenus.me`, S4.

## 5. Discounts that change the perpetual taker

Not verified.
The archived web app bundle names futures coupon endpoints, `/futures/coupon/balance/account` and `/futures/coupon/record`, which are private, S6.
No token discount, referral rebate or zero fee promotion could be read.

## 6. Funding as a cost

The formula, interval, cap and floor are Not verified, since the funding pages and replies were not reachable.
The archived web app bundle names `/contract/funding_rates` and `/contract/history_funding_rates` under the `/api` prefix, S6.
`GET https://www.bvox.com/api/contract/funding_rates` returns 404 to this host, like every API path tried on that host, P1.
CoinGecko shows a funding rate on every ticker row, S3.
At about 03:30 UTC on 2026-09-23, 347 of 388 rows read 0 and the other 41 read between 0.004 and 0.742, in CoinGecko's percent unit.
A settlement instant was not captured, and no funding history could be read.

## 7. Liquidation, settlement and delisting

The archived catalog gives each perpetual a `settlementDate` of 2145888000000 ms, 2038-01-01 UTC, which marks it as perpetual, S5.
Maximum leverage ran from 12 to 125 across the 97 contracts of the config reply, with 50 on 39 and 75 on 37, S9.
The catalog gives each contract a risk limit ladder, which for `XAUT-SWAP-USDT` runs from a maintenance margin of 0.008 at 40,000 USDT to 0.5 at 15,000,000 USDT, S5.
A liquidation fee, an insurance fund charge and a delisting rule are Not verified.
The bundle names `/contract/asset/insurance_fund` and `/contract/insurance_funding_balance`, S6.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `bvox`, `venus`, `bhex`, `hbtc` or `bhop`, P1 |
| CCXT master on 2026-09-23 | `ts/ccxt.ts` at version 4.5.82 imports 105 exchange classes from line 49 (`alpaca`) to line 153 (`zebpay`), and none is BVOX, BitVenus, BHEX or HBTC, S8 |
| `ts/src/bvox.ts`, `bitvenus.ts`, `bhex.ts`, `hbtc.ts` on master | 404 each, S8 |

So `market.taker` does not exist for this venue, and `ccxtTakerPpm` has nothing to declare.

## 9. Recommended registry values

None, because the venue cannot join the engine, see [`rest.md`](./rest.md) section 8.
If it ever becomes reachable and gains a CCXT class, `takerPpm` 600 is the starting point, to be confirmed against a live fee page, and `ccxtTakerPpm` follows that class's constant.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinGecko exchange page, BVOX | https://www.coingecko.com/en/exchanges/bvox | 2026-09-22 | CoinGecko | former name, 2018, British Virgin Islands, API documentation link `https://www.bitvenus.me/docs/v1/intro`, sections 1 and 3 |
| S2 | CoinGecko exchange page, BVOX (Futures) | https://www.coingecko.com/en/exchanges/bvox-futures | 2026-09-22 | CoinGecko | "Fees: 0.1%", 1,352 trading pairs on the page, API id `bitvenus`, sections 2 and 3 |
| S3 | CoinGecko API, derivatives exchange `bitvenus` with tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/bitvenus?include_tickers=unexpired | 2026-09-23 03:30 UTC | CoinGecko | 389 perpetual pairs, 0 futures pairs, 388 ticker rows, funding rates, last trade times, sections 1, 3 and 6 |
| S4 | Wayback Machine index and captures of `www.bvox.com` | https://web.archive.org/cdx/search/cdx?url=www.bvox.com/&from=2025&collapse=digest | 2026-09-23 | Internet Archive | the web app until 2026-08-01, the refusal page from 2026-09-02, no fee page, section 1 |
| S5 | BVOX web app catalog reply, archived 2026-08-19 | https://web.archive.org/web/20260819011814id_/https://www.bvox.com/api/contract/symbol-newest/list?categories=FUTURES,COIN | 2026-09-23 | BVOX, via Internet Archive | `feeConfig`, `contractMultiplier`, leverage, risk limits, `settlementDate`, sections 2 and 7 |
| S6 | BVOX web app bundle `main-be17c5a6.297cc435.chunk.js`, archived 2025-09-14 | https://web.archive.org/web/20250914055128id_/https://www.bitvenus.me/static/js/main-be17c5a6.297cc435.chunk.js | 2026-09-23 | BVOX, via Internet Archive | BHEX platform, API path names, sections 1, 5, 6 and 7 |
| S7 | BVOX registration country list, archived 2025-04-21 | https://web.archive.org/web/20250421070418id_/https://www.bvox.com/s_api/basic/countries | 2026-09-23 | BVOX, via Internet Archive | 197 countries and the ones missing, section 1 |
| S8 | CCXT master `ts/ccxt.ts` and `ts/src/<id>.ts` | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-23 | CCXT | no class on master, section 8 |
| S9 | BVOX web app config reply `s_api/basic/config_v2_js`, archived 2026-08-02 | https://web.archive.org/web/20260802151113id_/https://www.bvox.com/s_api/basic/config_v2_js?custom_keys=loginReg,analytics&callback=window.__set_config&tab=exchange&type=all&platform=1&without_country=true | 2026-09-23 | BVOX, via Internet Archive | 97 futures symbols with `feeConfig`, 477 spot symbols, `riskIpDisabled`, sections 1 to 3 |
| S10 | ARIN RDAP for 207.241.225.86 | https://rdap.arin.net/registry/ip/207.241.225.86 | 2026-09-23 | ARIN | `INTERNET-ARCHIVE-1`, 207.241.224.0 to 207.241.239.255, section 1 |
| S11 | BVOX web app home configuration `s_api/basic/index_config`, archived 2026-06-16 | https://web.archive.org/web/20260616143125id_/https://www.bvox.com/s_api/basic/index_config?preview=false | 2026-09-23 | BVOX, via Internet Archive | user agreement article link, section 1 |
| P1 | `rest-probe.mjs`, runs at 03:25, 03:38 and 03:40 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bvox/rest-probe.mjs) | 2026-09-22 local | this host, Cloudflare `loc=CA` | refusal page, 404 on every API path, CCXT 4.5.68 ids, sections 1, 4, 6 and 8 |
