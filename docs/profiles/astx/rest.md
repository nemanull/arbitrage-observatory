# ASTX REST Profile

**Status:** Done.
No REST call on the trading site could be made from this host, so the catalog below comes from ASTX's help center and from CoinMarketCap.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:13 to 05:33 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada (Vancouver, AS212238 Datacamp Limited).

ASTX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
Its trading site refuses every TLS handshake from this exit, so no REST path could be discovered from its web bundle or tried.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/astx/rest-probe.py) and [`fees-probe.py`](../../../scripts/probes/venues/astx/fees-probe.py), section by section.

## 1. Host and latency from this machine

| host | resolved on 2026-10-10 UTC | role | result, P1 |
|---|---|---|---|
| `www.astx.io` | CNAME `ha11.shieldedges.com`, 12 addresses in `23.145.196.0/24` and `23.147.76.0/24` | the trading site CoinMarketCap names | TCP connects, the server reads the Client Hello, sends nothing and closes after 12,007 to 12,103 ms over two runs, `SSLEOFError: UNEXPECTED_EOF_WHILE_READING` |
| `astx.io` | the same 12 addresses, served by Cloudflare DNS (`maisie` and `matt.ns.cloudflare.com`) | apex | the same close after 12,008 to 12,009 ms |
| port 80 on the same edge | the same addresses | plain HTTP | connected, 0 bytes read, closed after 12,009 to 12,024 ms |
| `support.astx.io` | CNAME `astxtechltd.zendesk.com`, `216.198.53.6` and `216.198.54.6` | the Zendesk help center, behind Cloudflare | `GET /hc/en-us` and the fee article page answered 200 in 258 to 668 ms in the probe runs. The first manual request of the session, for the fee article page, got 403 with `cf-mitigated: challenge` and a "Just a moment..." page. The Zendesk JSON API answered 200 in 349 to 394 ms every time. |
| 23 candidate API names such as `api.`, `fapi.`, `openapi.`, `futures.`, `ws.` and `stream.` | no A record from Cloudflare's DNS over HTTPS | none | not reachable, P1 section "DNS" |

The close happened on four of the twelve addresses tried with SNI `www.astx.io`, and on one address with SNI `astx.io`, `example.com` and none, P1 section "TLS handshakes against the edge".
The same happened with curl and with openssl during exploration, so it is not a Python TLS quirk.
The behaviour is the same for any SNI and on port 80, so the edge drops this source address, not a name or a protocol.
Whether it drops only this Canadian VPN exit, all of Canada, or every client cannot be told from here without another route, and none was used.
The help center documents no API: none of its 72 articles names an API, a WebSocket or a developer page, and its search for "API" returns `{"count":0}`, P1 section "support.astx.io" and P2 section "help center article list".
ASTX is alive: CoinMarketCap pair rows were stamped minutes before each probe, and the help center posted a listing notice on 2026-10-09, see [`fees.md`](./fees.md) section 3.

## 2. Catalog

No instruments call was found or reached.
Two outside sources give the perpetual list.

| source | rows | settlement | evidence |
|---|---|---|---|
| Perpetual Contract Parameter Tables (I) and (II) in the help center | 88 plus 94, 182 distinct pairs | all USDT | P2 section "perpetual parameter tables" |
| CoinMarketCap perpetual pairs | 153, every one also in the tables | all USDT | P2 section "CoinMarketCap market pairs" |
| CoinMarketCap spot pairs, for the coverage matrix | 149 | all USDT | the same section |

Each table row carries the contract value, price precision, funding cap, funding interval and risk tiers.
BTC/USDT has contract value 0.00001 and price precision 1, and ETH/USDT has 0.0001 and 2.
So a socket or REST book that reports sizes in contracts would need a per-pair `contractSize` from this table, since no CCXT class supplies one.
CoinMarketCap carries `derivativeTickerId` values such as `ETH_USDT` and `TAO_USDT`, which is the only native symbol spelling seen.

### What CoinMarketCap's numbers say about the venue

CoinMarketCap marks every ASTX pair, spot and perpetual, `priceExcluded 1` and `volumeExcluded 1`.
Its exchange record counts 108,635 USD of perpetual and 11,020 USD of spot volume in 24 h, while the excluded pair rows sum to 8.98 to 8.99 billion USD perpetual and 1.43 billion USD spot over two runs, P2.
145 of 147 perpetuals that Binance also lists sit within 1% of Binance's USD-M last price, with a median gap of 0.07% to 0.13% over two runs.
ETH/USDT is the outlier, at about 3,201.8 against Binance's 2,493 to 2,496, 28.3% to 28.4% away, while ASTX's own ETH/USDT spot row on CoinMarketCap sits near 2,492.
`fundingRate` is 0 on all 153 perpetual rows.
These rows are what ASTX reports to CoinMarketCap, and none could be compared with ASTX's own API.

## 3. Anchor

Not verified.
ASTX names an index price and a mark price in its help center but documents no call that returns them, or the funding rate, the interval or the next settlement.
The only outside view is CoinMarketCap's per-pair `indexPrice` and `fundingRate`, and the funding field reads 0 on every row, so it cannot stand in for an anchor.

| `AnchorRow` column | field | evidence |
|---|---|---|
| index | Not verified | no call found |
| mark | Not verified | no call found |
| funding rate | Not verified | no call found |
| funding interval | Published per pair in the parameter tables, 8 h on 176 pairs and 4 h on 6 | [`fees.md`](./fees.md) section 6 |
| next settlement | Not publicly specified | no call or schedule found |

## 4. Anchor semantics

| item | value | evidence |
|---|---|---|
| index formula | "A weighted average price calculated from multiple exchanges' spot prices", with no basket or weights named | ASTX Contract Order Guide, S3, P2 section "contract order guide" |
| index basket call | Not publicly specified | S2 |
| mark formula | Not publicly specified. Liquidation and event contracts both use the mark price. | S2 |
| funding formula | Not publicly specified beyond "based on the difference between the futures contract price and the spot market price" | S2 |
| funding cap | ±0.3% per interval on all 182 pairs | S1 |
| upcoming or last settled rate | Not verified | no call found |
| change over a minute of polls | Not verified | no call found |

## 5. REST book snapshot

Not verified.
No book call is documented, and none could be discovered.

## 6. Rate limits and errors

Not publicly specified.
The only error seen is the edge's silent close after about 12 s, which carries no status code and no body.
The Zendesk API answered every request with 200, at about two requests a second at most.

## 7. Server time and clock offset

Not verified.
No server time call is documented, and the edge sends no `Date` header because it sends no bytes.

## 8. Recommended poller shape

None.
ASTX cannot join the engine as a perpetual leg in its current shape.
It lists 182 USDT-margined perpetuals at a published 0.04% taker, but it offers no public API, no catalog call, no book socket and no anchor call, and its only host refuses this exit.
A later attempt would first need the site to answer, then the API paths from its web bundle, then a full probe of the catalog, the book channel and an anchor call.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | Perpetual Contract Parameter Tables (I) and (II), `https://support.astx.io/api/v2/help_center/en-us/articles/14834308052111.json` and `.../14832769069967.json` | 182 pairs, contract value, precision, funding cap and interval |
| S2 | `https://support.astx.io/api/v2/help_center/en-us/articles.json`, 72 articles, and `.../articles/search.json?query=API` | no API article, the funding, mark and liquidation text |
| S3 | ASTX Contract Order Guide, article 14576071558031 | the index price definition |
| S4 | `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=astx&category=<spot,perpetual,futures>` | pair counts, exclusion flags, prices, `derivativeTickerId`, `fundingRate` |
| S5 | `https://fapi.binance.com/fapi/v1/ticker/price` | Binance USD-M last prices for the comparison |
| S6 | `https://archive.org/wayback/available?url=www.astx.io` | one probe run got 200 with a home page snapshot from 2026-01-09, and the next got 429. Every fetch of that snapshot and of the CDX index got 429 from the Wayback Machine, so the web bundle was not read from the archive either. |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/astx/rest-probe.py) | DNS, the refused handshakes, port 80, the help center statuses, the Wayback answers |
| P2 | [`fees-probe.py`](../../../scripts/probes/venues/astx/fees-probe.py) | the catalog counts, the CoinMarketCap comparison, the parameter tables, the index text |
