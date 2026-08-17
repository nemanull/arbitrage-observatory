import WebSocket from 'ws';
const mode = process.argv[2];
const r = await (await fetch('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000')).json();
const ids = r.result.list.filter(x => x.status==='Trading' && x.contractType==='LinearPerpetual').map(x=>x.symbol).slice(0,300);
const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear', { perMessageDeflate: mode==='on' });
let msgs=0, payload=0, wire=0;
ws.on('message', d => { msgs++; payload += d.length; });
ws.on('open', () => {
  ws._socket.on('data', d => { wire += d.length; });
  for (let i=0;i<ids.length;i+=100) ws.send(JSON.stringify({op:'subscribe', args: ids.slice(i,i+100).map(s=>'orderbook.1.'+s)}));
  setTimeout(() => {
    const m0=msgs,p0=payload,w0=wire; const c0=process.cpuUsage(); const t0=Date.now();
    setTimeout(() => {
      const c=process.cpuUsage(c0); const secs=(Date.now()-t0)/1000;
      console.log(JSON.stringify({mode, n:ids.length, msgs:msgs-m0, msgsPerSec:Math.round((msgs-m0)/secs),
        wireMB:+((wire-w0)/1e6).toFixed(2), payloadMB:+((payload-p0)/1e6).toFixed(2),
        cpuMs:+((c.user+c.system)/1000).toFixed(0), usPerMsg:+(((c.user+c.system)/(msgs-m0))).toFixed(2)}));
      process.exit(0);
    }, 15000);
  }, 5000);
});
ws.on('error', e => { console.log('ERR',e.message); process.exit(1); });
