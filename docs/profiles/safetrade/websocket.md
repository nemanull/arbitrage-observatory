# SafeTrade WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:50 and 04:56 UTC), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that Cloudflare places in Canada.
Every handshake was refused with HTTP 403 before the upgrade, so no frame was captured.

This profile covers the public spot WebSocket of SafeTrade, which has no CCXT class and lists no perpetual, see [`fees.md`](./fees.md) sections 3 and 8.
SafeTrade publishes no WebSocket documentation.
The only first-party description is its example client on GitHub, S1, and a help center note that "The recommended method going forward is Websockets for intensive integrations (REST will still work)", S2.
[`ws-probe.mjs`](../../../scripts/probes/venues/safetrade/ws-probe.mjs) opened a socket on each candidate URL with `perMessageDeflate: false`, and each got a Cloudflare 403 with SafeTrade's notice that it does not serve Canadians.
No route around that refusal was tried.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, public | `wss://safe.trade/api/v2/websocket/public`, built by `ws.py` from the base URL `https://safe.trade/api/v2` in `main.py`, S1 | HTTP 403 in 46 ms and 63 ms, `cf-mitigated: challenge`, P3 |
| spot, public, new domain | `wss://safetrade.com/api/v2/websocket/public`, not documented | HTTP 403 in 54 ms and 34 ms, no `cf-mitigated` header, P3 |
| spot, public, legacy Peatio ranger | `wss://safe.trade/api/v2/ranger/public/?stream=global.tickers`, the Openware path, not documented by SafeTrade | HTTP 403 in 61 ms and 214 ms, `cf-mitigated: challenge`, P3 |
| spot, private | `wss://safe.trade/api/v2/websocket/private`, S1 | not probed |
| perpetuals | none listed | |

SafeTrade said in 2024 that it keeps `safe.trade` "for various technical purposes such as our API", S3, and its example client still uses that host, S1.
Whether one socket carries several markets is Not verified from this host, but the example subscribes three streams on one socket, S1.

## 2. Channel matrix for public market data

| stream | documented | probed |
|---|---|---|
| `<market>.depth` | `qubicusdt.depth` in the example subscribe frame, S1. Depth, speed and semantics Not publicly specified | refused |
| `<market>.trades` | `qubicusdt.trades`, S1 | refused |
| `global.tickers` | one stream for every market, and the example reads `amount`, `avg_price`, `high`, `last`, `low`, `open`, `price_change_percent` and `volume` from it, S1 | refused |
| best bid and ask | Not publicly specified. The ticker fields above carry no bid or ask | |
| mark, index, funding | none, spot only | |

The route names and the authentication headers match Openware's OpenDAX stack, see [`rest.md`](./rest.md) section 2.
Openware's Rango socket server documents the same subscribe frame and names its incremental book stream `<market>.ob-inc`, S4.
Whether SafeTrade serves `ob-inc` or `ob-snap` beside `depth` is Not verified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column is the same for every axis past the endpoint, because no socket opened.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | public and private by path, `/websocket/public` and `/websocket/private`, S1 | all three public URLs answered 403 |
| subscribe frame shape | `{"event": "subscribe", "streams": ["global.tickers", "qubicusdt.depth", "qubicusdt.trades"]}`, S1 | not reached |
| unknown symbol expectation | Not publicly specified | not reached |
| chunk unit and budget | Not publicly specified | not reached |
| keepalive mechanism | Not publicly specified. The example client sends none, S1 | not reached |
| connection lifetime and maintenance notice | Not publicly specified. Maintenance is announced in the help center, S2 | not reached |
| handshake and operation rate limits | Not publicly specified | not reached |
| public market data authentication | none, the example opens the public socket with no header, S1 | not reached |
| message parse and routing | the example routes by top level key, `global.tickers` holding one object per market id, S1 | not reached |
| subscribe acknowledgement shape | Not publicly specified | not reached |
| symbol identifier format | lower case base and quote joined, `qubicusdt` and `xtmusdt`, S1, matching the market `id` in the web app state, such as `btcusdt`, see [`rest.md`](./rest.md) section 2 | not reached |
| number representation | not shown for the book. The web app's ticker state holds decimal strings, see [`rest.md`](./rest.md) section 2 | not reached |
| timestamp representation | Not publicly specified | not reached |
| size unit | Not publicly specified, spot base units by inference | not reached |
| sequence semantics | Not publicly specified | not reached |
| idle repeat behaviour | Not publicly specified | not reached |

## 4. The book channel in detail

Nothing in this section could be observed.
The snapshot on subscribe, the delta semantics, the per market sequence and its gap rule, any checksum, the level order, the size unit, one-sided and empty books, idle repeats, and the answer to an unknown or disabled market are all Not verified.
SafeTrade publishes none of them, and the handshake never reached the upgrade.
The size unit would be base currency by inference, since spot has no contract size, and CCXT offers no `contractSize` to compare.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | not reached |
| silence the server tolerates | Not publicly specified | not reached |
| forced disconnect | Not publicly specified | not reached |
| maintenance notice | help center articles such as "Safetrade Maintenance" of 2024-09-18, S2 | not reached |
| compression | Not publicly specified | the 403 carried no `sec-websocket-extensions` header, since no upgrade happened, P3 |
| handshake | | refused at the Cloudflare edge in 34 to 214 ms over two runs, `cf-ray` suffixes `YVR` and `SEA`, P3 |
| subscription limits | Not publicly specified | not reached |

## 6. Captured frames

No frame was captured.
The probe's record of the first refusal, trimmed, P3.

```json
{"tag":"refused","url":"wss://safe.trade/api/v2/websocket/public","ms":46,"status":403,"cfMitigated":"challenge","cfRay":"a3f6edbaef0f6951-YVR","server":"cloudflare","extensions":null,"canadaNotice":true,"text":"If you are seeing this page, you may be from Canada. Safetrade does not currently allow trading or new signups for Canadians as of June 1, 2020. Your wallets ar"}
```

The page behind that 403 goes on, as captured by the probe.

```text
If you are from Canada and would like to access your wallet, please sign in at https://safe.trade/login.
If you are Not from Canada and are receiving this message in error (such as a VPN), please complete the Captcha below for access to trading:
```

The subscribe frame the example client sends, documented and not captured, S1.

```json
{"event": "subscribe", "streams": ["global.tickers", "qubicusdt.depth", "qubicusdt.trades"]}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- URL `wss://safe.trade/api/v2/websocket/private`, opened with the headers `X-Auth-Apikey`, `X-Auth-Nonce` and `X-Auth-Signature`, where the signature is HMAC-SHA256 of the nonce joined to the key, S1, which is Openware Barong's scheme, S5.
- Streams `order`, `trade` and `balance`, S1.

## 8. Recommended feed shape

None.
SafeTrade offers no perpetual leg, CCXT has no class for it, and its socket refuses this host.
A spot feed, if one were ever wanted, would first need a probe from a host SafeTrade serves, to settle the `depth` stream's snapshot, sequence and keepalive, which nothing public describes.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SafeTrade example client, commit `e463039` of 2026-02-12, files `main.py`, `ws.py`, `wsstore.py`, `manager.py`, `api.py` | https://github.com/safetrade-exchange/example-client | 2026-09-22 | SafeTrade | URLs, subscribe frame, stream names, private auth, sections 1 to 3 and 7 |
| S2 | "Server maintenance: Safetrade 3.0 is loading", help center, created 2023-11-18, and "Safetrade Maintenance", 2024-09-18 | https://support.safetrade.com/hc/en-us/articles/21459723961741-Server-maintenance-Safetrade-3-0-is-loading | 2026-09-22 | SafeTrade | WebSocket recommended, API 95 % backwards compatible, maintenance notices |
| S3 | "Safetrade.com is now the offical home of Safetrade!", help center, 2024-06-19 | https://support.safetrade.com/hc/en-us/articles/27715005079693-Safetrade-com-is-now-the-offical-home-of-Safetrade | 2026-09-22 | SafeTrade | `safe.trade` kept for the API, section 1 |
| S4 | Openware Rango README, "Subscribe to a stream list" | https://github.com/openware/rango/blob/master/README.md | 2026-09-22 | Openware | the same subscribe frame, `ob-inc` stream name, section 2 |
| S5 | Openware Barong, `docs/general/api-keys.md` lines 110 to 131 | https://github.com/openware/barong/blob/2-6-stable/docs/general/api-keys.md | 2026-09-22 | Openware | `X-Auth-*` headers and signature, section 7 |
| P3 | `ws-probe.mjs handshake`, run at 04:50 UTC and rerun at 04:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/safetrade/ws-probe.mjs) | 2026-09-22 | this host, Canadian exit | the 403 on every URL, sections 1, 5 and 6 |
