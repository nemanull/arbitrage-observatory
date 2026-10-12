# CoinCorner Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:40 to 03:50 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

CoinCorner lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That spot market is a broker desk and not an order book.
A customer buys or sells at a price CoinCorner quotes, on the account's Exchange page, against a flat 1 % fee.
Its public API has a ticker, an undocumented order book path that returns placeholder levels, and no socket, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/coincorner/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | CoinCorner Ltd, company 129003C, 18c Carrs Lane, Tromode, Douglas, Isle of Man. It is registered with the Isle of Man Financial Services Authority under the Designated Business Act 2015. | Published | S3 |
| launched | 2014-07-14 according to CoinMarketCap | Published | S5 |
| supported countries | 15: Alderney, Brazil, Cayman Islands, Curacao, El Salvador, Guernsey, Isle of Man, Jersey, Mauritius, Monaco, New Zealand, Singapore, Switzerland, United Kingdom and the British Virgin Islands | Region-specific | S3, `fees-probe.py page` |
| Canada | not on the supported list, so a resident of the VPN exit's country cannot open an account | Region-specific | S3 |
| who may trade | a verified CoinCorner account holder in a supported country. Market data on the API ticker needs no key. | Account-gated | S1, S4 |
| fee page from this host | `https://www.coincorner.com/fees` answered HTTP 301 to the Zendesk article "CoinCorner Fees and Limits", which the Help Center API served with HTTP 200, last updated 2026-05-20 | Probed | `fees-probe.py page` |
| public API from this host | `api.coincorner.com` answered the ticker and order book paths with HTTP 200 behind Cloudflare, and its help pages with HTTP 500 | Probed | [`rest.md`](./rest.md) section 1 |

No refusal or geoblock was met from the Canadian exit.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot buy and sell of BTC, USDT, ETH and LTC against GBP or EUR | no maker side exists | 1 %, 10,000 ppm | Published | S2 |
| recurring auto-buy | no maker side exists | 1 %, 10,000 ppm | Published | S2 |

The fee article's buy and sell row reads "Fee 1%", with per trade limits of "Minimum - £/€1.00" and "Maximum - £/€250,000.00", S2.
The article also says "Please note some of these fees are variable depending on your account."
The 1 % sits on top of CoinCorner's quoted price, and that quote carries its own spread.
The public order book path showed a BTC/GBP bid 43,973 to 43,988 ppm below the ticker's last price and an ask 19,807 to 19,817 ppm above it, see [`rest.md`](./rest.md) section 5.
So the full cost of a round trip is far above the fee alone.
A CoinCorner spot buy costs twenty times Gate's 500 ppm perpetual taker before the spread, see [`../gate/fees.md`](../gate/fees.md) section 2.
CoinMarketCap's exchange record carries `makerFee` 0.0 and `takerFee` 0.0, which is its placeholder for an unknown fee and not a zero fee, S5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no help article mentions a perpetual, leverage or futures product, S4 |
| coin-margined perpetuals | no | same |
| dated futures | no | same |
| options | no | same |
| spot order book | no, trades fill instantly at a quoted price on the Exchange page | S4 |
| spot broker buy and sell | yes, BTC and USDT against GBP and EUR, ETH and LTC sell-only for UK residents | S4 |
| bitcoin-backed loans | yes, in GBP and USDT, not detailed | S4 |
| Lightning payments, Bolt Card, merchant checkout | yes, not detailed | S1, S4 |
| deposits and withdrawals | yes, GBP and EUR bank transfers, a 2.5 % debit card deposit, BTC on-chain and Lightning | S2 |

Five more checks agree that CoinCorner has no perpetuals.
The help centre search finds no article for "perpetual" or "leverage", and the five hits for "futures" and the 14 for "order book" contain neither phrase in their title or body, S4.
The six hits for "margin" are all about bitcoin-backed loans, S4.
CoinMarketCap's exchange record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 270,500 USD, and its market pair lists hold 2 spot pairs, BTC/GBP and BTC/EUR, and no perpetual or futures pair, S5.
CoinMarketCap's derivatives ranking with `exType=2` lists 104 venues and not CoinCorner, S5.
CoinGecko's derivatives list holds 216 venues and not CoinCorner, and its list of 1,503 exchanges has no CoinCorner row at all, S6.

## 4. Spot tiers

None published.
The fee article gives one flat 1 % for buy and sell and one flat 1 % for auto-buy, with no volume tier, S2.
It says larger trades go to an OTC desk on request, and that some fees vary by account, both without numbers, S2.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| volume tiers | none published | Not publicly specified | S2 |
| account-specific fees | "some of these fees are variable depending on your account", with no numbers | Account-gated | S2 |
| OTC for large trades | on enquiry | Negotiated | S2 |
| token holding | no exchange token seen in the help centre or the fee article | Not publicly specified | S2, S4 |
| referral | Not publicly specified | Not publicly specified | |
| zero fee promotions | none seen | Not publicly specified | S2 |

## 6. Funding as a cost

Not offered.
CoinCorner lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged trading product, so there is no trading liquidation or settlement charge.
The bitcoin-backed loans have their own terms in the loan articles, which this profile does not read, S4.
A delisting charge is Not publicly specified.

## 8. CCXT

CCXT 4.5.68 has no CoinCorner class.
There is no `coincorner.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the `exchanges` map that opens at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` has no line containing "corner".
The current CCXT source agrees, S7.
`exchanges.json` on the `master` branch, read at commit `f0aca06` of 2026-10-08, lists 103 ids and none containing "corner".
The head commit was read once on 2026-10-09, and the second pass's call to the GitHub API met its rate limit for this exit, so `fees-probe.py listings` prints that refusal instead.
`ts/src/coincorner.ts` and `js/src/coincorner.js` on `master` answer HTTP 404.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, a book feed and an anchor, and CoinCorner has no perpetual, no CCXT class, no real public book and no socket.
It cannot enter the registry as a perpetual leg.
If a later design ever priced a broker quote as a spot leg, `takerPpm` would be 10,000 from S2, plus the quoted spread, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.coincorner.com/`, the API landing page | the API base `https://api.coincorner.com/api`, one public call "Ticker", HMAC-SHA256 key, signature and nonce authentication, "The rate limit for CoinCorner's API is 60 requests a minute" |
| S2 | `https://support.coincorner.com/api/v2/help_center/en-us/articles/5901068854812.json`, the article "CoinCorner Fees and Limits" at `https://support.coincorner.com/hc/en-us/articles/5901068854812-CoinCorner-Fees-and-Limits`, updated 2026-05-20 | the 1 % buy and sell fee, the 1 % auto-buy fee, per trade limits, deposit and withdrawal charges |
| S3 | `https://www.coincorner.com/countries` | the 15 supported countries, the legal footer with company number and regulator |
| S4 | `https://support.coincorner.com/api/v2/help_center/articles/search.json` for "futures", "perpetual", "margin", "leverage", "order book", "limit order" and "API", and the articles "Buying bitcoin", "Selling bitcoin", "ETH and LTC functionality" and "Buying and Selling USDT" | no derivative product, the Exchange page's instant buy and sell at a quoted price, the UK restriction on buying ETH and LTC since 2023-10-06, USDT against GBP and EUR, loans |
| S5 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coincorner`, `.../exchange/market-pairs/latest?slug=coincorner` with `category=spot`, `perpetual` and `futures`, and `.../exchange/listing?exType=2` | id 137, launched 2014-07-14, fee fields 0.0, fee URL, spot volume about 270,500 USD, 2 spot pairs, 0 perpetual and 0 futures pairs, 104 derivatives venues without CoinCorner |
| S6 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no CoinCorner in either |
| S7 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, the two class paths on `master`, and `https://api.github.com/repos/ccxt/ccxt/commits?per_page=1&sha=master` | 103 CCXT ids without CoinCorner, two 404s, head commit `f0aca06` of 2026-10-08 |
