const { exec } = require('child_process');
const sh = (cmd, timeout = 60000) => new Promise((resolve) => {
  exec(cmd, { maxBuffer: 16 * 1024 * 1024, timeout, shell: '/bin/bash' }, (err, stdout, stderr) => {
    if (err) return resolve({ ok: false, error: String(err), stdout: String(stdout||''), stderr: String(stderr||'') });
    resolve({ ok: true, stdout: String(stdout||''), stderr: String(stderr||'') });
  });
});

const token = process.env.CLOUDFLARED_TOKEN || '';

async function getStatus(_req, res) {
  const ps = await sh('pgrep cloudflared >/dev/null 2>&1 && echo running || echo stopped');
  res.json({ status: ps.ok ? ps.stdout.trim() : 'unknown' });
}

const START_SCRIPT = `
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
  'tunnel-start': START_SCRIPT,
  'tunnel-stop': 'pkill cloudflared || true',
  'tunnel-status': 'pgrep cloudflared >/dev/null 2>&1 && echo running || echo stopped'
};

async function runCommand(req, res) {
  const { cmd } = req.body || {};
  if (!cmd || !(cmd in ALLOW_CMDS)) return res.status(400).json({ error: 'Command not allowed' });
  if (cmd === 'tunnel-start' && !token) return res.status(400).json({ error: 'CLOUDFLARED_TOKEN not set in .env' });
  const r = await sh(ALLOW_CMDS[cmd]);
  res.json({ ok: r.ok, stdout: r.stdout, stderr: r.stderr });
}

module.exports = { getStatus, runCommand };
