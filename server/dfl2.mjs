import WebSocket from 'ws';
const mode = process.argv[2];
const DUR = 20000;
const info = await (await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')).json();
const syms = info.symbols.filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING').map(s => s.symbol.toLowerCase());
const streams = syms.map(s => s + '@bookTicker');
const pmd = mode === 'off' ? false : (mode === 'on' ? true : { threshold: 1e9 });
const ws = new WebSocket('wss://fstream.binance.com/ws', { perMessageDeflate: pmd });
let msgs = 0, payload = 0, wire = 0;
ws.on('open', () => {
  ws._socket.on('data', (d) => { wire += d.length; });
  // chunk the subscribe into 100-stream frames to stay small
  for (let i = 0; i < streams.length; i += 100) {
    ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: streams.slice(i, i+100), id: i }));
  }
  setTimeout(() => {
    const m0=msgs,p0=payload,w0=wire; const c0=process.cpuUsage(); const t0=Date.now();
    setTimeout(() => {
      const c=process.cpuUsage(c0); const secs=(Date.now()-t0)/1000;
      console.log(JSON.stringify({mode, nStreams: streams.length, msgs: msgs-m0, msgsPerSec: Math.round((msgs-m0)/secs),
        wireMB:+((wire-w0)/1e6).toFixed(2), payloadMB:+((payload-p0)/1e6).toFixed(2),
        cpuMs:+((c.user+c.system)/1000).toFixed(0), usPerMsg:+(((c.user+c.system)/(msgs-m0))).toFixed(2)}));
      process.exit(0);
    }, DUR);
  }, 5000);
});
ws.on('message', d => { msgs++; payload += d.length; });
ws.on('error', e => { console.log('ERR', e.message); process.exit(1); });
