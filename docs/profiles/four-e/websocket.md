# 4E WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:48 UTC by the host clock, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=YVR`).

4E publishes no WebSocket documentation and no public socket URL.
Its web client learns the socket URL at run time from a signed call, so no book channel could be subscribed without imitating that client, and this survey does not do that.
What follows is what was checked, what failed, and what the public web bundle shows about the client's socket, labelled as such.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | none published | five guessed URLs refused the upgrade, section 5 |

The web bundle `https://www.eeee.com/js/app.78077933.js` sets the socket URL from `ws3_url` in the reply of `POST https://app.eeee.com/Publics/getWebInitInfo`.
That call needs `app_id`, a nonce and an MD5 signature over an application key the page receives from `/Site/config`, and without them it answers `{"status":-101,"msg":"app_id 参数错误"}` ("app_id parameter error"), see [`rest.md`](./rest.md) section 2.
`ws.eeee.com` and `openapi.eeee.com` do not resolve.

## 2. Channel matrix for public market data

Not published.
The web bundle subscribes with `{"action": "Topic.sub", "data": {"type": ..., "app_id": ...}}` and handles pushes named `Pushdata.depth`, `Pushdata.orderbook`, `Pushdata.kline`, `Pushdata.marketM`, `Pushdata.futureM`, `Pushdata.contractM`, `Pushdata.derivativesM`, `Pushdata.stock` and `Pushdata.assets`.
Depth levels, speeds and payloads are Not publicly specified and were not probed.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | not reachable |
| subscribe frame shape | Not publicly specified | the web bundle sends `{"action": "Topic.sub", "data": {"type", "app_id"}}`, not sent by the probe |
| unknown symbol expectation | Not publicly specified | not reachable |
| chunk unit and budget | Not publicly specified | not reachable |
| keepalive mechanism | Not publicly specified | the web bundle sends a text `ping` on a 6 s timer and accepts a text `pong`, not probed |
| connection lifetime and maintenance notice | Not publicly specified | not reachable |
| handshake and operation rate limits | Not publicly specified | not reachable |
| public market data authentication | Not publicly specified | the URL itself is only handed out by a signed call, section 1 |
| message parse and routing | Not publicly specified | the web bundle routes on `action`, not probed |
| subscribe acknowledgement shape | Not publicly specified | not reachable |
| symbol identifier format | Not publicly specified | not reachable |
| number representation | Not publicly specified | the web bundle unpacks a comma-joined `data` row against a `field` list and parses numbers from strings, not probed |
| timestamp representation | Not publicly specified | not reachable |
| size unit | Not publicly specified | not reachable |
| sequence semantics | Not publicly specified | not reachable |
| idle repeat behaviour | Not publicly specified | not reachable |

## 4. The book channel in detail

Not verified.
No snapshot, delta, sequence, checksum, level order or size unit could be observed, because no socket URL answered an upgrade from this host without the signed bootstrap.

## 5. Session

[`ws-probe.mjs`](../../../scripts/probes/venues/four-e/ws-probe.mjs) opened each guessed URL once with `perMessageDeflate: false` at 06:48 UTC.

| URL | reply |
|---|---|
| `wss://www.eeee.com/ws` | HTTP 200 with the site's HTML, no upgrade |
| `wss://api.eeee.com/ws` | HTTP 200 `{"status":-122,"source":"API","msg":"FAIL",...}`, no upgrade |
| `wss://app.eeee.com/ws` | HTTP 200 `{"status":-122,...,"msg":"无访问权限"}` ("no access permission"), no upgrade |
| `wss://contract.eeee.com/ws` | HTTP 200 `{"status":10001,"msg":"路由不存在",...}` ("route does not exist"), no upgrade |
| `wss://apiuni.eeee.com/ws` | HTTP 200 `{"status":10001,...,"msg":"路由不存在",...}`, no upgrade |

Compression: the web bundle reads binary frames as gzip with an `ungzip` call and text frames as plain JSON, so binary pushes are gzip inside the frame.
That is the shape the design flags, because the engine refuses permessage deflate and does not inflate payloads, see [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section 3.
It was read from the bundle and not observed on the wire.

Keepalive tolerance, forced disconnects, maintenance notices and limits are Not verified.

## 6. Captured frames

None.
The only replies captured are the HTTP bodies in section 5.

## 7. Private channels

Not publicly specified.
The web bundle's push `Pushdata.assets` looks account scoped, and the user centre offers API key management through `/UCenter/ApiSecret/create`, `getList`, `getSecretInfo`, `updateInfo` and `delete`, without any published API it would serve.

## 8. Recommended feed shape

None.
A feed would need a published socket URL, subscribe format and sequence rule, and 4E publishes none of them.
Building one on the web client's signed bootstrap would mean imitating the web page with its embedded key, which the survey does not recommend.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 4E web client bundle `app.78077933.js`, read with grep for the socket class and API paths | https://www.eeee.com/js/app.78077933.js | 2026-09-24 | 4E | sections 1, 2, 3, 5 and 7 |
| S2 | 4E help centre English article list, 375 articles, none titled with API | https://hcapi.eeee.com/api/news?locale=en | 2026-09-24 | 4E, global | no socket documentation |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/four-e/ws-probe.mjs), run at 06:48 UTC | | 2026-09-24 | this host, Canadian VPN exit | section 5 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/four-e/rest-probe.mjs), run at 06:47 UTC | | 2026-09-24 | this host, Canadian VPN exit | section 1 |
