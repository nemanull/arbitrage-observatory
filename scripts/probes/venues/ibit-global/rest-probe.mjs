// IBIT Global REST probe: what the web host, its unsigned /v1 web API paths and the help center return to this host, plus the fee and VIP numbers as the help center API serves them.
// Public, unauthenticated, read-only. No signature is computed and no header beyond a plain request is sent.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/ibit-global/rest-probe.mjs
// Set PROBE_OUT_DIR to keep the raw bodies. Recorded in docs/profiles/ibit-global/rest.md and fees.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const WEB = 'https://www.ibitglobal.ai';
const HC = 'https://ibitglobal.zendesk.com/api/v2/help_center/en-us/articles';
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function hit(url, name) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'manual' });
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  keep(name, body);
  const title = /<TITLE>([^<]*)<\/TITLE>/i.exec(body)?.[1];
  const ref = /Reference&#32;&#35;([^<\s]*)/.exec(body)?.[1]?.replace(/&#46;/g, '.');
  log('http', { url, status: res.status, ms, bytes: body.length, type: res.headers.get('content-type'), location: res.headers.get('location'), server: res.headers.get('server'), title, akamaiRef: ref, retryAfter: res.headers.get('retry-after') });
  return body;
}

// Web host, cold then warm.
await hit(`${WEB}/`, 'root-cold.html');
await hit(`${WEB}/`, 'root-warm.html');

// Paths the web app calls with a signed query. Sent here unsigned, as any public client would.
for (const p of ['/v1/futures/symbolList', '/v1/futures/contractConfig', '/v1/coMarket/marketSnapshot', '/v1/coMarket/klineHistory']) {
  await hit(`${WEB}${p}`, p.replaceAll('/', '_') + '.html');
}

// Help center, fee article and VIP table.
function text(html) {
  return html.replace(/<\/t[dh]>/g, ' |').replace(/<\/tr>/g, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');
}
for (const [id, what] of [['21506118458900', 'fee'], ['21321062998804', 'vip']]) {
  const res = await fetch(`${HC}/${id}.json`);
  const j = await res.json();
  const t = text(j.article.body);
  keep(`hc-${id}.txt`, t);
  log('article', { id, status: res.status, title: j.article.title, updated: j.article.updated_at });
  if (what === 'fee') {
    log('fee', { maker: /Maker:\s*([\d.]+\s*%)/.exec(t)?.[1], taker: /Taker:\s*([\d.]+\s*%)/.exec(t)?.[1] });
  } else {
    for (const row of t.split('\n').join(' ').split(/(?=VIP \d \|)/).filter((r) => /^VIP \d \|/.test(r))) {
      log('vip', { row: row.replace(/\s+/g, ' ').trim().slice(0, 160) });
    }
  }
}
