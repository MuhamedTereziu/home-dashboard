# Termux Dashboard (Beginner Friendly, RouterOS v7)

A cleaner structure for your Termux dashboard with:
- System, battery, Wi‑Fi info
- MikroTik DHCP leases via **RouterOS v7 REST API**
- Cloudflared tunnel controls
- Simple weather widget (Open‑Meteo)

## 1) Install (Termux, Node 18+)
```bash
pkg update && pkg upgrade -y
pkg install -y nodejs
# optional, improves sensors:
pkg install -y termux-api
```

## 2) Get the code
```bash
git clone <your-fork-url> termux-dashboard
cd termux-dashboard
npm install
cp .env.example .env
# edit .env and set your values (host, passwords, cloudflared token)
```

## 3) Start
```bash
npm start
```
Then open `http://<phone-ip>:3000` in a browser on the same LAN.

---

## MikroTik (RouterOS v7) — Required settings
On your MikroTik (WinBox/WebFig or terminal):
```rsc
/ip service set www disabled=no port=80
/ip service set www-ssl disabled=yes
/ip service set api-ssl disabled=yes
/ip service set api disabled=yes
/ip service set rest-api disabled=no port=80
/ip firewall filter add chain=input action=accept protocol=tcp dst-port=80 src-address=192.168.88.0/24 comment="Allow REST from LAN"
# If on v7.14+ 'rest-api' is integrated in 'www' service; ensure www is enabled.
```
Make sure you can open: `http://<router-ip>/rest/ip/dhcp-server/lease` in a browser (it will prompt for user/password).

### If LAN devices table is empty
- Check `.env` credentials (`MT_USER`/`MT_PASS`).
- Ensure **DHCP** is actually running on the router and has leases.
- Verify the REST URL above returns JSON when you log in manually.
- If you use a different port/protocol, set `MT_REST_PORT` or `MT_REST_PROTO=https` and add a certificate.

## Cloudflared tunnel (optional)
Put your **`CLOUDFLARED_TOKEN`** into `.env`. Buttons in the dashboard can start/stop/status.
For auto-start on Termux boot, add to `~/.bashrc` or use `Termux:Boot` app with:
```bash
cloudflared tunnel run --token "$CLOUDFLARED_TOKEN"
```

## Project structure
```
termux-dashboard/
├── server.js
├── routes/
│   └── api.js
├── services/
│   ├── cloudflared.js
│   ├── mikrotik.js
│   └── system.js
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/main.js
├── package.json
├── .env.example
└── README.md
```

## Notes
- This build **defaults to RouterOS v7 REST** (`MT_USE_REST=1`).
- Credentials are read from `.env`. Never commit `.env` to GitHub.
- If you want to “hardcode” admin/admin, just edit `services/mikrotik.js` and replace the env reads.
