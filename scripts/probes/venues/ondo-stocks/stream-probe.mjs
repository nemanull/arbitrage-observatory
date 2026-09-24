// Ondo Stocks streaming probe: what the gRPC streaming surface at grpc.gm.ondo.finance:443 answers without an API key, and whether either API host accepts a WebSocket upgrade.
// The venue documents no WebSocket, so the upgrade attempts only record the refusal, and each socket opens with perMessageDeflate false like server/src/feeds/book/VenueFeed.ts.
// gRPC is spoken over node:http2 with hand-built frames, because @grpc/grpc-js is not in server/node_modules.
// Public, unauthenticated, read-only. It sends no x-api-key, and every call is closed within 10 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/ondo-stocks/stream-probe.mjs
// Recorded in docs/profiles/ondo-stocks/websocket.md.
import { createRequire } from 'node:module';
import http2 from 'node:http2';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const GRPC = 'https://grpc.gm.ondo.finance';
const SERVICE = '/ondo.gm.backend.v1.BackendService';
const CALL_TIMEOUT_MS = 10_000;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// A gRPC message is one flag byte, a four byte big-endian length, then the protobuf bytes.
function grpcFrame(payload) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

// Protobuf field `n` of wire type 2 (string, bytes or message).
function lenField(n, bytes) {
  return Buffer.concat([Buffer.from([(n << 3) | 2, bytes.length]), bytes]);
}

// Lists the top level fields of a protobuf message, printing each length-delimited field as text.
function decodeFields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = buf[i++];
      v += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return v;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const key = varint();
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ field, varint: varint() });
    else if (wire === 2) {
      const len = varint();
      const bytes = buf.subarray(i, i + len);
      i += len;
      out.push({ field, text: bytes.toString('utf8').slice(0, 200) });
    } else {
      out.push({ field, wire, unparsed: true });
      break;
    }
  }
  return out;
}

function splitMessages(buf) {
  const msgs = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const len = buf.readUInt32BE(i + 1);
    msgs.push(buf.subarray(i + 5, i + 5 + len));
    i += 5 + len;
  }
  return msgs;
}

function grpcCall(client, path, body) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const result = { path, headers: null, trailers: null, messages: [], bytes: 0 };
    const chunks = [];
    const req = client.request({
      ':method': 'POST',
      ':path': path,
      'content-type': 'application/grpc',
      te: 'trailers',
    });
    const finish = (why) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      result.bytes = buf.length;
      result.messages = splitMessages(buf).slice(0, 3).map(decodeFields);
      result.messageCount = splitMessages(buf).length;
      result.ms = Math.round(performance.now() - t0);
      result.end = why;
      resolve(result);
    };
    const timer = setTimeout(() => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      finish('timeout');
    }, CALL_TIMEOUT_MS);
    req.on('response', (h) => {
      result.headers = pick(h);
    });
    req.on('trailers', (t) => {
      result.trailers = pick(t);
    });
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => finish('end'));
    req.on('error', (e) => {
      result.error = e.message;
      finish('error');
    });
    req.end(grpcFrame(body));
  });
}

// A plain HTTP/2 GET, which is not a gRPC call, to see how the load balancer answers it.
function plainGet(client, path) {
  return new Promise((resolve) => {
    const req = client.request({ ':method': 'GET', ':path': path });
    let headers = null;
    let bytes = 0;
    req.on('response', (h) => (headers = pick(h)));
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => resolve({ path, headers, bytes }));
    req.on('error', (e) => resolve({ path, error: e.message }));
    req.end();
  });
}

function pick(h) {
  const keep = {};
  for (const k of [':status', 'content-type', 'grpc-status', 'grpc-message', 'server', 'date', 'www-authenticate']) {
    if (h[k] !== undefined) keep[k] = h[k];
  }
  return keep;
}

async function probeGrpc() {
  const t0 = performance.now();
  const client = http2.connect(GRPC);
  client.on('error', (e) => log('grpc_session_error', { error: e.message }));
  await new Promise((r) => client.once('connect', r));
  log('grpc_connect', { ms: Math.round(performance.now() - t0), alpn: client.alpnProtocol });

  const tsla = lenField(1, Buffer.from('TSLAon'));
  const calls = [
    [`${SERVICE}/HealthCheck`, Buffer.alloc(0)],
    [`${SERVICE}/StreamPriceUpdates`, Buffer.alloc(0)],
    [`${SERVICE}/StreamPriceUpdates`, tsla],
    [`${SERVICE}/StreamSoftQuoteDepth`, tsla],
    [`${SERVICE}/StreamOHLC`, tsla],
    [`${SERVICE}/StreamPriceUpdates`, lenField(1, Buffer.from('NOPE'))],
    [`${SERVICE}/NoSuchMethod`, Buffer.alloc(0)],
    // Server reflection, list_services is field 7 of ServerReflectionRequest.
    ['/grpc.reflection.v1.ServerReflection/ServerReflectionInfo', lenField(7, Buffer.alloc(0))],
    ['/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo', lenField(7, Buffer.alloc(0))],
  ];
  for (const [path, body] of calls) {
    log('grpc_call', await grpcCall(client, path, body));
  }
  log('h2_get', await plainGet(client, '/'));
  client.close();
}

function tryUpgrade(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ws = new WebSocket(url, { perMessageDeflate: false, handshakeTimeout: CALL_TIMEOUT_MS });
    const done = (r) => {
      resolve({ url, ms: Math.round(performance.now() - t0), ...r });
      ws.terminate();
    };
    ws.on('open', () => done({ opened: true }));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => done({ opened: false, status: res.statusCode, errorType: res.headers['x-amzn-errortype'], body: body.slice(0, 200) }));
    });
    ws.on('error', (e) => done({ opened: false, error: e.message }));
  });
}

async function probeUpgrades() {
  for (const url of ['wss://api.gm.ondo.finance/', 'wss://api.gm.ondo.finance/v1/ws', 'wss://grpc.gm.ondo.finance/']) {
    log('ws_upgrade', await tryUpgrade(url));
  }
}

log('start', { at: new Date().toISOString() });
await probeGrpc();
await probeUpgrades();
log('end', { at: new Date().toISOString() });
