// Cryptal WebSocket probe: whether the web client's socket at wss://wss.cryptal.com/gex serves a plain client, and what protocol the web client speaks on it.
// Cryptal documents no WebSocket API, so the URL and frames come from the public web bundle at https://cryptal.com/ex/.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except the one trial that asks for deflate.
// No Origin header is ever sent, because claiming https://cryptal.com as the origin would impersonate the website to get past its check.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/cryptal/ws-probe.mjs [refusal|client]
//   refusal  six short sockets: each resolved address with nothing sent, then a subscribe, a ping, a deflate offer and a self-identifying User-Agent. About 10 s.
//   client   fetches the web bundle and prints the socket URL, subscribe frames, ping frame and interval, and the listen key path. About 3 s.
// Set PROBE_OUT_DIR to keep the raw close frames. Recorded in docs/profiles/cryptal/websocket.md.
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const WS_HOST = 'wss.cryptal.com';
const WS_URL = `wss://${WS_HOST}/gex`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const SUBSCRIBE_BOOK = JSON.stringify({ action: 'SUBSCRIBE', channel: 'ORDER_BOOK', depth: 25, pair: 'BTC-USD' });
const PING = JSON.stringify({ action: 'PING' });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text + '\n');
}

function trial(name, { address, deflate = false, userAgent, send = [] }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const at = () => Math.round(performance.now() - t0);
    const opts = { perMessageDeflate: deflate, handshakeTimeout: 10_000 };
    if (userAgent) opts.headers = { 'User-Agent': userAgent };
    // Pins the TCP connection to one resolved address while TLS still names the host.
    if (address) opts.lookup = (_h, o, cb) => (o && o.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4));
    const ws = new WebSocket(WS_URL, opts);
    const rec = { name, address: address ?? 'dns', frames: 0, raw: [] };
    const done = setTimeout(() => ws.terminate(), 8_000);
    ws.on('upgrade', (res) => {
      rec.upgradeStatus = res.statusCode;
      rec.upgradeMs = at();
      rec.extensions = res.headers['sec-websocket-extensions'] ?? null;
      rec.server = res.headers.server;
      rec.rateLimit = { burst: res.headers['x-ratelimit-burst-capacity'], rate: res.headers['x-ratelimit-replenish-rate'], remaining: res.headers['x-ratelimit-remaining'] };
    });
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        log('trial', { ...rec, unexpectedStatus: res.statusCode, body: body.slice(0, 200), atMs: at() });
        clearTimeout(done);
        resolve();
      });
    });
    ws.on('open', async () => {
      rec.openMs = at();
      ws._socket.prependListener('data', (b) => {
        rec.raw.push({ atMs: at(), bytes: b.length, hex: b.subarray(0, 32).toString('hex') });
        capture('raw.txt', `${name} ${at()} ${b.toString('hex')}`);
      });
      for (const s of send) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(s);
        rec.sentMs = rec.sentMs ?? at();
        await sleep(200);
      }
    });
    ws.on('message', () => rec.frames++);
    ws.on('error', (e) => (rec.error = e.message));
    ws.on('close', (code, reason) => {
      clearTimeout(done);
      log('trial', { ...rec, closeCode: code, closeReason: reason.toString(), closeMs: at(), openToCloseMs: rec.openMs === undefined ? null : at() - rec.openMs, serverSentClose: ws._closeFrameReceived });
      resolve();
    });
  });
}

async function refusal() {
  const addrs = (await lookup(WS_HOST, { all: true })).map((a) => a.address);
  log('dns', { host: WS_HOST, addrs });
  for (const address of addrs) {
    await trial('nothing sent', { address });
    await sleep(500);
  }
  await trial('subscribe ORDER_BOOK on open', { send: [SUBSCRIBE_BOOK] });
  await sleep(500);
  await trial('PING on open', { send: [PING] });
  await sleep(500);
  await trial('deflate offered', { deflate: true, send: [SUBSCRIBE_BOOK] });
  await sleep(500);
  await trial('self-identifying User-Agent', { userAgent: 'arbitrage-observatory-probe/1.0 (read-only research)', send: [SUBSCRIBE_BOOK] });

  for (const url of [`https://${WS_HOST}/`, `https://${WS_HOST}/gex`]) {
    const res = await fetch(url);
    const text = await res.text();
    log('https_get', { url, status: res.status, bytes: text.length, title: text.match(/<title>([^<]*)/)?.[1] ?? null, body: text.startsWith('<') ? null : text.slice(0, 120), socketInPage: text.match(/new WebSocket\("([^"]+)"/)?.[1] ?? null });
  }
}

async function client() {
  const index = await (await fetch('https://cryptal.com/ex/')).text();
  const bundle = index.match(/src="(main\.[0-9a-f]+\.bundle\.js)"/)?.[1];
  log('bundle', { page: 'https://cryptal.com/ex/', bundle });
  const js = await (await fetch(`https://cryptal.com/ex/${bundle}`)).text();
  const around = (needle, before, after) => {
    const i = js.indexOf(needle);
    return i < 0 ? null : js.slice(Math.max(0, i - before), i + needle.length + after);
  };
  log('client', {
    bytes: js.length,
    socketUrls: [...new Set(js.match(/wss:\/\/[a-z0-9.\-/]+/g) ?? [])],
    constructed: around('new ql("wss', 0, 90),
    subscribeFrames: [...new Set(js.match(/\{action:"SUBSCRIBE",channel:"[A-Z_]+"(?:,depth:\d+)?(?:,pair:e)?\}/g) ?? [])],
    pingFrame: around('JSON.stringify({action:"PING"})', 0, 0),
    pingIntervalField: around('this._pingMessageInterval=', 0, 3),
    listenKey: around('ga.post("/gex")', 0, 70),
    listenKeyBase: around('WS_LISTEN_KEY_URL:', 0, 40),
    channelsHandled: [...new Set(js.match(/"(?:ORDER_BOOK|TICKER|LIVE_TRADE|CANDLE_STICK|OPEN_ORDERS|BALANCE)"===[a-z]\.channel/g) ?? [])],
    bookHandler: around('"ORDER_BOOK"===i.channel', 0, 80),
    closeHandler: around('4001===e.code', 0, 30),
  });
}

const mode = process.argv[2] ?? 'refusal';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'refusal') await refusal();
else if (mode === 'client') await client();
else throw new Error(`unknown mode ${mode}`);
log('done', { mode, at: new Date().toISOString() });
