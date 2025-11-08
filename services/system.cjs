const { exec } = require('child_process');
const sh = (cmd, timeout = 60000) => new Promise((resolve) => {
  exec(cmd, { maxBuffer: 16 * 1024 * 1024, timeout, shell: '/bin/bash' }, (err, stdout, stderr) => {
    if (err) return resolve({ ok: false, error: String(err), stdout: String(stdout||''), stderr: String(stderr||'') });
    resolve({ ok: true, stdout: String(stdout||''), stderr: String(stderr||'') });
  });
});
const parseJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
const which = async (cmd) => {
  const r = await sh(`command -v ${cmd} >/dev/null 2>&1 && echo 1 || echo 0`);
  return r.ok && r.stdout.trim() === '1';
};

async function getBattery(_req, res) {
  if (await which('termux-battery-status')) {
    const r = await sh('termux-battery-status');
    if (r.ok) {
      const j = parseJSON(r.stdout);
      if (j) return res.json(j);
    }
  }
  const d = await sh('dumpsys battery || true');
  if (!d.ok) return res.status(503).json({ error: 'battery-unavailable' });
  const o = d.stdout;
  const m = (re) => (o.match(re) || [])[1];
  const level = parseInt(m(/level:\s*(\d+)/), 10);
  const tempTenthC = parseInt(m(/temperature:\s*(\d+)/), 10);
  const statusCode = parseInt(m(/status:\s*(\d+)/), 10);
  const charging = [2,5].includes(statusCode);
  res.json({
    percentage: Number.isFinite(level) ? level : null,
    temperature: Number.isFinite(tempTenthC) ? (tempTenthC/10).toFixed(1) : null,
    status: charging ? 'CHARGING' : 'DISCHARGING'
  });
}

async function getWifi(_req, res) {
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
          source: 'termux-api'
        });
      }
    }
  }
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
  const pr = await sh(`awk 'NR==3{gsub(/\./,""); print $4}' /proc/net/wireless 2>/dev/null || true`);
  if (pr.ok && pr.stdout.trim()) {
    const sig = parseInt(pr.stdout.trim(), 10);
    return res.json({ ssid: null, rssi: Number.isFinite(sig) ? sig : null, ip: null, link_speed: null, source: 'proc' });
  }
  res.status(503).json({ error: 'wifi-info-unavailable' });
}

async function getSystem(_req, res) {
  const [mem, up, load, therm] = await Promise.all([
    sh('termux-mem-info || true'),
    sh('uptime -p || true'),
    sh('cat /proc/loadavg || true'),
    sh('termux-thermal-sensor || true')
  ]);
  const memJSON = parseJSON(mem.stdout) || null;
  const uptimePretty = up.ok ? up.stdout.trim() : null;
  const loadavg = load.ok ? (load.stdout.trim().split(/\s+/).slice(0,3)) : [];
  let thermal = parseJSON(therm.stdout);
  if (!thermal) {
    const tz = await sh(`for f in /sys/class/thermal/thermal_zone*/temp; do [ -r "$f" ] && cat "$f"; done | head -n1 || true`);
    if (tz.ok && tz.stdout.trim()) {
      const c = parseInt(tz.stdout.trim(),10);
      if (Number.isFinite(c)) thermal = [{ type: 'cpu', temperature: (c/1000).toFixed(1) }];
    }
  }
  res.json({ mem: memJSON, uptime: uptimePretty, loadavg, thermal });
}

async function getNetwork(_req, res) {
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
}

module.exports = { getBattery, getWifi, getSystem, getNetwork };
