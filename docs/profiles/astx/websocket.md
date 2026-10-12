# ASTX WebSocket Profile

**Status:** Done.
No WebSocket could be opened or even located, so every axis below is Not verified.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:13 to 05:33 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada (Vancouver, AS212238 Datacamp Limited).

ASTX publishes no API documentation and no WebSocket URL, and it has no CCXT class, see [`fees.md`](./fees.md) section 8.
None of the 72 help center articles names an API, a WebSocket or a developer page, and a help center search for "API" returns 0 results, see [`rest.md`](./rest.md) section 1.
The only host the venue serves, `www.astx.io`, refuses the TLS handshake from this exit, so its web bundle, which would name the socket, could not be read.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/astx/ws-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/astx/rest-probe.py).

## 1. Endpoints

| candidate | how it was found | result from this host |
|---|---|---|
| `wss://www.astx.io/` | the venue's only web host | TCP connects, then `ConnectionResetError` after 12,038 to 12,071 ms over two runs with no TLS reply, P1 |
| `wss://www.astx.io/ws`, `/websocket`, `/stream` | common socket paths, guessed | `ConnectionResetError` after 12,013 to 12,092 ms over two runs, P1 |
| `ws.`, `wss.`, `stream.`, `socket.`, `push.`, `api.`, `fapi.`, `futures.` and 15 more names under `astx.io` | DNS over HTTPS through Cloudflare | no A record for any of the 23 names, P2 section "DNS" |

The path guesses never reach HTTP, since the close comes before the TLS handshake ends.
So the result says nothing about which path is real.
Whether one socket carries perpetuals and spot is not known.

## 2. Channel matrix for public market data

Not verified.
No document names a book, best bid and ask, trade, ticker, mark, index or funding channel.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed, P1 |
|---|---|---|
| endpoint split axis | not published | no socket located |
| subscribe frame shape | not published | not sent, handshake refused |
| unknown symbol expectation | not published | Not verified |
| chunk unit and budget | not published | Not verified |
| keepalive mechanism | not published | Not verified |
| connection lifetime and maintenance notice | not published, though the help center posts maintenance notices such as the system upgrade of 2026-07-06 | Not verified |
| handshake and operation rate limits | not published | every TLS handshake closed by the server after about 12 s |
| public market data authentication | not published | Not verified |
| message parse and routing | not published | Not verified |
| subscribe acknowledgement shape | not published | Not verified |
| symbol identifier format | not published. CoinMarketCap's `derivativeTickerId` reads `ETH_USDT`, which is how ASTX reports the pair to CoinMarketCap, not necessarily how a socket spells it. | Not verified |
| number representation | not published | Not verified |
| timestamp representation | not published | Not verified |
| size unit | not published. The parameter tables give a contract value per pair, 0.00001 BTC on BTC/USDT and 0.0001 ETH on ETH/USDT, see [`fees.md`](./fees.md) S2. | Not verified |
| sequence semantics | not published | Not verified |
| idle repeat behaviour | not published | Not verified |

## 4. The book channel in detail

Not verified.
Snapshot behaviour, delta semantics, sequence and gap rule, checksum, level order, size unit, one-sided books, idle repeats and unknown symbol replies all need an open socket.
If a socket is found later, the contract values above are the first thing to check against its sizes, since a book in contracts must be multiplied by them.

## 5. Session

Not verified.
The one session fact is the refusal itself: the edge behind `ha11.shieldedges.com` holds every connection for about 12 s and then closes it without a byte, on port 443 and on port 80, P2 sections "TLS handshakes against the edge" and "plain HTTP on port 80".

## 6. Captured frames

None.
The closest thing to a frame is the error each attempt ends with, from P1:

```text
run at 2026-10-10T05:23:38Z, websockets 17.2
wss://www.astx.io/: ConnectionResetError:  after 12071 ms
wss://www.astx.io/ws: ConnectionResetError:  after 12013 ms
```

## 7. Private channels

Not publicly specified.
No API key page or private channel is documented.

## 8. Recommended feed shape

None.
There is no URL to plan around, and the venue's host refuses this exit before TLS completes.
A feed would need, in order, a reachable host, a published or discoverable socket URL, and a book channel with a snapshot and a sequence.
Until then ASTX cannot carry a book feed for the engine.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/astx/ws-probe.py) | four refused socket attempts on `www.astx.io` |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/astx/rest-probe.py) | DNS for 23 candidate subdomains, the refused TLS handshakes, the help center search |
| S1 | `https://support.astx.io/api/v2/help_center/en-us/articles.json` | 72 articles, none about an API |
| S2 | `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=astx&category=perpetual` | the `derivativeTickerId` spelling |
