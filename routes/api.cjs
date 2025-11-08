const express = require('express');
const systemSvc = require('../services/system.cjs');
const mikrotikSvc = require('../services/mikrotik.cjs');
const cloudflaredSvc = require('../services/cloudflared.cjs');

const router = express.Router();

router.get('/battery', systemSvc.getBattery);
router.get('/wifi', systemSvc.getWifi);
router.get('/system', systemSvc.getSystem);
router.get('/network', systemSvc.getNetwork);

router.get('/lan', async (_req, res) => {
  try {
    const leases = await mikrotikSvc.getDhcpLeases();
    res.json(leases);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

router.get('/tunnel', cloudflaredSvc.getStatus);
router.post('/run', cloudflaredSvc.runCommand);

module.exports = router;
