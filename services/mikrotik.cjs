const http = require('http');
const https = require('https');

const cfg = {
  host: process.env.MT_HOST || '192.168.88.1',
  user: process.env.MT_USER || 'admin',
  pass: process.env.MT_PASS || 'admin',
  useRest: (process.env.MT_USE_REST || '1') === '1',
  proto: process.env.MT_REST_PROTO || 'http',
  port: process.env.MT_REST_PORT || '80',
};

function fetchJson(url, opts={}){
  return new Promise((resolve, reject)=>{
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method:'GET', headers: opts.headers || {} }, (res)=>{
      let data='';
      res.on('data', (d)=> data+=d);
      res.on('end', ()=>{
        if(res.statusCode===401) return reject(new Error('Unauthorized (check MT_USER/MT_PASS)'));
        if(res.statusCode<200 || res.statusCode>=300) return reject(new Error(`REST error ${res.statusCode}`));
        try{ resolve(JSON.parse(data)); }catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function leasesViaREST() {
  const url = `${cfg.proto}://${cfg.host}:${cfg.port}/rest/ip/dhcp-server/lease`;
  const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
  const data = await fetchJson(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } });
  return (Array.isArray(data) ? data : []).map(l => ({
    ip: l.address || '',
    mac: l['mac-address'] || '',
    hostname: l['host-name'] || '',
    status: l.status || '',
  }));
}

async function getDhcpLeases() {
  if (!cfg.useRest) throw new Error('MT_USE_REST is 0 — set it to 1 for RouterOS v7');
  return leasesViaREST();
}

module.exports = { getDhcpLeases };
