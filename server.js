// server.js — Termux Dashboard (works without Termux:API via Android fallbacks)
// Node >= 18
//
// Quick install on Termux:
//   pkg update && pkg upgrade -y
//   pkg install -y nodejs
//   # Optional but recommended if you have Termux:API app installed:
//   pkg install -y termux-api
//   mkdir -p ~/dashboard && cd ~/dashboard
//   # place index.html + server.js here
//   npm init -y && npm i express cors compression routeros-client
//
// ENV (edit ~/.bashrc then `source ~/.bashrc`):
//   export PORT=3000
//   export MT_HOST="192.168.88.1"
//   export MT_USER="admin"
//   export MT_PASS="admin"
//   export MT_USE_REST="0"          # set to 1 only on RouterOS v7 with REST
//   export MT_REST_PROTO="http"     # http or https
//   export MT_REST_PORT="80"        # 443 if https
//   export CLOUDFLARED_TOKEN="eyJ..."
//
// Run:
//   node server.js
//
// Endpoints used by your HTML:
//   GET  /api/battery
//   GET  /api/wifi
//   GET  /api/system
//   GET  /api/network
//   GET  /api/lan
//   GET  /api/tunnel
//   POST /api/run   { cmd: "tunnel-start"|"tunnel-stop"|"tunnel-status"|"update"|"wifi-scan" }
//
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { exec } = require('child_process');

// ---------- Config ----------
const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static('.'));

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

// MikroTik
const MT_HOST = process.env.MT_HOST || '192.168.88.1';
const MT_USER = process.env.MT_USER || 'admin';
const MT_PASS = process.env.MT_PASS || 'admin';
const MT_USE_REST = process.env.MT_USE_REST === '1';
const MT_REST_PROTO = process.env.MT_REST_PROTO || 'http';
const MT_REST_PORT = process.env.MT_REST_PORT || '80';

// Cloudflared
const CLOUDFLARED_TOKEN = process.env.CLOUDFLARED_TOKEN || '';

// ---------- Utils ----------
function sh(cmd, timeout = 60000) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 16 * 1024 * 1024, timeout, shell: '/bin/bash' }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: String(err), stdout: String(stdout || ''), stderr: String(stderr || '') });
      resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function which(cmd) {
  const r = await sh(`command -v ${cmd} >/dev/null 2>&1 && echo 1 || echo 0`);
  return r.ok && r.stdout.trim() === '1';
}

function parseJSON(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- Battery ----------
// Prefer termux-battery-status; fallback to `dumpsys battery`
app.get('/api/battery', async (_req, res) => {
  if (await which('termux-battery-status')) {
    const r = await sh('termux-battery-status');
    if (r.ok) {
      const j = parseJSON(r.stdout);
      if (j) return res.json(j);
    }
  }
  // Fallback: dumpsys battery
  const d = await sh(`dumpsys battery || true`);
  if (!d.ok) return res.status(503).json({ error: 'battery-unavailable' });
  const o = d.stdout;
  const get = (re) => (o.match(re) || [])[1];
  const level = parseInt(get(/level:\s*(\d+)/), 10);
  const tempTenthC = parseInt(get(/temperature:\s*(\d+)/), 10); // tenths of degree C
  const statusCode = parseInt(get(/status:\s*(\d+)/), 10); // Android BatteryManager
  const charging = [2, 5].includes(statusCode); // CHARGING or FULL
  return res.json({
    percentage: Number.isFinite(level) ? level : null,
    temperature: Number.isFinite(tempTenthC) ? (tempTenthC / 10).toFixed(1) : null,
    status: charging ? 'CHARGING' : 'DISCHARGING'
  });
});

// ---------- Wi‑Fi ----------
// Order: termux-wifi-connectioninfo → dumpsys wifi → /proc/net/wireless (signal only)
app.get('/api/wifi', async (_req, res) => {
  // Termux:API
  if (await which('termux-wifi-connectioninfo')) {
    const r = await sh('termux-wifi-connectioninfo');
    if (r.ok) {
      const j = parseJSON(r.stdout);
      if (j) {
        return res.json({
          ssid: j.ssid ?? j.SSID ?? null,
          rssi: j.rssi ?? j.RSSI ?? null,
          ip: j.ip ?? j.ip_address ?? null,
          link_speed: j.link_speed ?? j.linkSpeed ?? null,
          bssid: j.bssid ?? null,
          source: 'termux-api',
        });
      }
    }
  }
  // dumpsys wifi (no Termux:API)
  const d = await sh(`dumpsys wifi | sed -n '1,160p' || true`);
  if (d.ok) {
    const o = d.stdout;
    const mSsid = (o.match(/SSID:\s*(.+)/) || [])[1];
    const mRssi = (o.match(/RSSI:\s*(-?\d+)/) || [])[1];
    const mLink = (o.match(/Link speed:\s*([0-9]+)\s*Mbps/i) || [])[1];
    const ipr = await sh(`ip -4 addr show wlan0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 || true`);
    const ssid = mSsid ? mSsid.trim() : null;
    const rssi = mRssi ? parseInt(mRssi, 10) : null;
    const link_speed = mLink || null;
    const ip = ipr.ok ? ipr.stdout.trim() || null : null;
    if (ssid || rssi !== null || link_speed || ip) {
      return res.json({ ssid, rssi, link_speed, ip, source: 'dumpsys' });
    }
  }
  // /proc/net/wireless
  const pr = await sh(`awk 'NR==3{gsub(/\\./,""); print $4}' /proc/net/wireless 2>/dev/null || true`);
  if (pr.ok && pr.stdout.trim()) {
    const sig = parseInt(pr.stdout.trim(), 10);
    return res.json({ ssid: null, rssi: Number.isFinite(sig) ? sig : null, ip: null, link_speed: null, source: 'proc' });
  }
  return res.status(503).json({ error: 'wifi-info-unavailable' });
});

// ---------- System ----------
app.get('/api/system', async (_req, res) => {
  const [mem, up, load, therm] = await Promise.all([
    sh('termux-mem-info || true'),
    sh('uptime -p || true'),
    sh('cat /proc/loadavg || true'),
    sh('termux-thermal-sensor || true')
  ]);
  const memJSON = parseJSON(mem.stdout) || null;
  const uptimePretty = up.ok ? up.stdout.trim() : null;
  const loadavg = load.ok ? (load.stdout.trim().split(/\s+/).slice(0,3)) : [];
  // If termux-thermal-sensor fails, try kernel thermal zones (millideg C)
  let thermal = parseJSON(therm.stdout);
  if (!thermal) {
    const tz = await sh(`for f in /sys/class/thermal/thermal_zone*/temp; do [ -r "$f" ] && cat "$f"; done | head -n1 || true`);
    if (tz.ok && tz.stdout.trim()) {
      const c = parseInt(tz.stdout.trim(),10);
      if (Number.isFinite(c)) thermal = [{ type: 'cpu', temperature: (c/1000).toFixed(1) }];
    }
  }
  res.json({ mem: memJSON, uptime: uptimePretty, loadavg, thermal });
});

// ---------- Network bytes (for charts) ----------
app.get('/api/network', async (_req, res) => {
  // Pick the active interface (route to internet) or first non-loopback UP
  let iface = null;
  const r0 = await sh(`ip route get 1.1.1.1 2>/dev/null | awk '/dev /{for(i=1;i<=NF;i++) if($i=="dev"){print $(i+1); exit}}'`);
  if (r0.ok && r0.stdout.trim()) iface = r0.stdout.trim();
  if (!iface) {
    const r1 = await sh(`ip -o link show | awk -F': ' '$2!="lo"{print $2}' | head -n1`);
    if (r1.ok) iface = r1.stdout.trim() || 'wlan0';
  }
  const stats = await sh(`ip -s -j link show ${iface} || true`);
  if (!stats.ok) return res.status(500).json({ error: 'ip link failed', detail: stats.error });
  try {
    const j = JSON.parse(stats.stdout);
    const first = j && j[0];
    const st = first && (first.stats64 || first.stats) ? (first.stats64 || first.stats) : null;
    const rx = st ? (st.rx ? (st.rx.bytes || st.rx_bytes || 0) : 0) : 0;
    const tx = st ? (st.tx ? (st.tx.bytes || st.tx_bytes || 0) : 0) : 0;
    res.json({ iface: (first && first.ifname) || iface, rx, tx, ts: Date.now() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse ip output', detail: e.message });
  }
});

// ---------- MikroTik Leases ----------
async function mikrotikLeasesREST() {
  const url = `${MT_REST_PROTO}://${MT_HOST}:${MT_REST_PORT}/rest/ip/dhcp-server/lease`;
  const auth = Buffer.from(`${MT_USER}:${MT_PASS}`).toString('base64');
  const r = await fetch(url, { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } });
  if (r.status === 401) throw new Error('HTTP 401 Unauthorized');
  if (!r.ok) throw new Error(`REST error ${r.status} ${r.statusText}`);
  const data = await r.json();
  return (Array.isArray(data) ? data : []).map(l => ({
    ip: l.address || '',
    mac: l['mac-address'] || '',
    hostname: l['host-name'] || '',
    status: l.status || '',
  }));
}

async function mikrotikLeasesAPI() {
  const { RouterOSClient } = require('routeros-client');
  const api = new RouterOSClient({ host: MT_HOST, user: MT_USER, password: MT_PASS, timeout: 6000 });
  await api.connect();
  try {
    const menu = api.menu('/ip/dhcp-server/lease');
    const leases = await menu.print();
    await api.close();
    return (leases || []).map(l => ({
      ip: l['address'] || '',
      mac: l['mac-address'] || '',
      hostname: l['host-name'] || '',
      status: l['status'] || '',
    }));
  } catch (e) {
    await api.close().catch(()=>{});
    throw e;
  }
}

app.get('/api/lan', async (_req, res) => {
  try {
    const leases = MT_USE_REST ? await mikrotikLeasesREST() : await mikrotikLeasesAPI();
    return res.json(leases);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message || err) });
  }
});

// ---------- Cloudflared ----------
app.get('/api/tunnel', async (_req, res) => {
  const ps = await sh('pgrep cloudflared >/dev/null 2>&1 && echo running || echo stopped');
  res.json({ status: ps.ok ? ps.stdout.trim() : 'unknown' });
});

const CLOUD_FLARE_START_SCRIPT = `
CF_BIN="$(command -v cloudflared || echo $PREFIX/bin/cloudflared || echo $HOME/cloudflared)"
if [ ! -x "$CF_BIN" ]; then
  echo "cloudflared not found"; exit 127
fi
termux-wake-lock >/dev/null 2>&1 || true
nohup "$CF_BIN" tunnel run --token "${CLOUDFLARED_TOKEN}" > "$HOME/cloudflared.log" 2>&1 &
echo "started"
`;

const ALLOW_CMDS = {
  'update': 'pkg update -y && pkg upgrade -y',
  'wifi-scan': `(command -v termux-wifi-scaninfo >/dev/null 2>&1 && termux-wifi-scaninfo) || (dumpsys wifi | sed -n '1,200p')`,
  'tunnel-start': CLOUD_FLARE_START_SCRIPT,
  'tunnel-stop': 'pkill cloudflared || true',
  'tunnel-status': 'pgrep cloudflared >/dev/null 2>&1 && echo running || echo stopped',
};

app.post('/api/run', async (req, res) => {
  const { cmd } = req.body || {};
  if (!cmd || !(cmd in ALLOW_CMDS)) return res.status(400).json({ error: 'Command not allowed' });
  if (cmd === 'tunnel-start' && !CLOUDFLARED_TOKEN) return res.status(400).json({ error: 'CLOUDFLARED_TOKEN not set' });
  const r = await sh(ALLOW_CMDS[cmd]);
  res.json({ ok: r.ok, stdout: r.stdout, stderr: r.stderr });
});

// ---------- Health ----------
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, HOST, () => {
  console.log(`✅ Dashboard on http://${HOST}:${PORT}`);
  console.log(`   MikroTik via ${MT_USE_REST ? 'REST' : 'API'} — host=${MT_HOST} user=${MT_USER}`);
  console.log(`   Cloudflared token set: ${CLOUDFLARED_TOKEN ? 'yes' : 'no'}`);
});
