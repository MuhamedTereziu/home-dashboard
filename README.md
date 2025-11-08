# Termux Dashboard (CommonJS build)

This build avoids ESM issues on Node 18–24 by using `.cjs` + `require()` everywhere.

## Quick start
```bash
unzip termux-dashboard-cjs.zip
cd termux-dashboard-cjs
npm install
cp .env.example .env   # set MT_* and CLOUDFLARED_TOKEN
npm start              # runs server.cjs
```

If LAN table is empty, check RouterOS v7 REST settings and credentials (see README in previous zip).
