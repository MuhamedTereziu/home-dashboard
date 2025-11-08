// routes/api.js
import { Router } from 'express';
import * as systemSvc from '../services/system.js';
import * as mikrotikSvc from '../services/mikrotik.js';
import * as cloudflaredSvc from '../services/cloudflared.js';

const router = Router();

// Battery, WiFi, System, Network
router.get('/battery', systemSvc.getBattery);
router.get('/wifi', systemSvc.getWifi);
router.get('/system', systemSvc.getSystem);
router.get('/network', systemSvc.getNetwork);

// MikroTik LAN
router.get('/lan', async (_req, res) => {
  try {
    const leases = await mikrotikSvc.getDhcpLeases();
    res.json(leases);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// Cloudflared
router.get('/tunnel', cloudflaredSvc.getStatus);
router.post('/run', cloudflaredSvc.runCommand);

export default router;
