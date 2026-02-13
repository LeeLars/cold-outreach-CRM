const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

const WHATSAPP_URL = 'https://wa.me/32470089888?text=Dag%20Lars%2C%20ik%20wil%20graag%20wat%20meer%20info%20over%20een%20nieuwe%20website.%20Wanneer%20kunnen%20we%20eens%20samen%20zitten%3F';

// Public router: /qr/:campaign - no auth
const publicRouter = express.Router();

publicRouter.get('/:campaign', async (req, res) => {
  try {
    const campaign = req.params.campaign;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    await prisma.qrScan.create({
      data: { campaign, ip, userAgent }
    });
  } catch (err) {
    console.error('QR scan log error:', err.message);
  }

  res.redirect(WHATSAPP_URL);
});

// API router: /api/qr/* - requires auth
const apiRouter = express.Router();
apiRouter.use(requireAuth);

apiRouter.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));

    const [total, today, thisWeek] = await Promise.all([
      prisma.qrScan.count(),
      prisma.qrScan.count({ where: { scannedAt: { gte: todayStart } } }),
      prisma.qrScan.count({ where: { scannedAt: { gte: weekStart } } })
    ]);

    const fourteenDaysAgo = new Date(todayStart);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);

    const recentScans = await prisma.qrScan.findMany({
      where: { scannedAt: { gte: fourteenDaysAgo } },
      select: { scannedAt: true },
      orderBy: { scannedAt: 'asc' }
    });

    const perDay = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(fourteenDaysAgo);
      d.setDate(d.getDate() + i);
      perDay[d.toISOString().slice(0, 10)] = 0;
    }
    recentScans.forEach(s => {
      const key = s.scannedAt.toISOString().slice(0, 10);
      if (perDay[key] !== undefined) perDay[key]++;
    });

    res.json({
      total,
      today,
      thisWeek,
      perDay: Object.entries(perDay).map(([date, count]) => ({ date, count }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Fout bij ophalen statistieken' });
  }
});

module.exports = { publicRouter, apiRouter };
