// services/mikrotik.js
const cfg = {
  host: process.env.MT_HOST || '192.168.88.1',
  user: process.env.MT_USER || 'admin',
  pass: process.env.MT_PASS || 'admin',
  useRest: (process.env.MT_USE_REST || '1') === '1', // default to REST on v7
  proto: process.env.MT_REST_PROTO || 'http',
  port: process.env.MT_REST_PORT || '80',
};

async function leasesViaREST() {
  const url = `${cfg.proto}://${cfg.host}:${cfg.port}/rest/ip/dhcp-server/lease`;
  const auth = Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64');
  const r = await fetch(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } });
  if (r.status === 401) throw new Error('Unauthorized (check MT_USER/MT_PASS)');
  if (!r.ok) throw new Error(`REST error ${r.status} ${r.statusText}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : []).map(l => ({
    ip: l.address || '',
    mac: l['mac-address'] || '',
    hostname: l['host-name'] || '',
    status: l.status || '',
  }));
}

export async function getDhcpLeases() {
  if (!cfg.useRest) throw new Error('MT_USE_REST is 0 — set it to 1 for RouterOS v7');
  return leasesViaREST();
}
