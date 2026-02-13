const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// PUBLIC: QR scan redirect (no auth needed)
router.get('/scan/:slug', async (req, res) => {
  try {
    const campaign = await prisma.qrCampaign.findUnique({
      where: { slug: req.params.slug }
    });

    if (!campaign || !campaign.isActive) {
      return res.status(404).send('Campagne niet gevonden');
    }

    // Log the scan
    await prisma.qrScan.create({
      data: {
        campaignId: campaign.id,
        ip: req.headers['x-forwarded-for'] || req.ip,
        userAgent: req.headers['user-agent'] || null,
        referer: req.headers['referer'] || null
      }
    });

    // Redirect to WhatsApp
    res.redirect(302, campaign.whatsappUrl);
  } catch (err) {
    console.error('QR scan error:', err);
    res.status(500).send('Er ging iets mis');
  }
});

// ===== PROTECTED ENDPOINTS (require auth) =====

// Get all campaigns with scan counts
router.get('/campaigns', requireAuth, async (req, res, next) => {
  try {
    const campaigns = await prisma.qrCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { scans: true } }
      }
    });

    // Add scan stats per campaign
    const result = await Promise.all(campaigns.map(async (c) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);

      const [scansToday, scansWeek] = await Promise.all([
        prisma.qrScan.count({ where: { campaignId: c.id, scannedAt: { gte: today } } }),
        prisma.qrScan.count({ where: { campaignId: c.id, scannedAt: { gte: weekAgo } } })
      ]);

      return {
        ...c,
        totalScans: c._count.scans,
        scansToday,
        scansWeek
      };
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Create campaign
router.post('/campaigns', requireAuth, async (req, res, next) => {
  try {
    const { name, whatsappUrl, description } = req.body;
    if (!name || !whatsappUrl) {
      return res.status(400).json({ error: 'Naam en WhatsApp URL zijn verplicht' });
    }

    // Generate slug from name
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Date.now().toString(36);

    const campaign = await prisma.qrCampaign.create({
      data: { name, slug, whatsappUrl, description }
    });

    res.json(campaign);
  } catch (err) {
    next(err);
  }
});

// Update campaign
router.put('/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, whatsappUrl, description, isActive } = req.body;
    const campaign = await prisma.qrCampaign.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(whatsappUrl !== undefined && { whatsappUrl }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive })
      }
    });
    res.json(campaign);
  } catch (err) {
    next(err);
  }
});

// Delete campaign
router.delete('/campaigns/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.qrCampaign.delete({ where: { id: req.params.id } });
    res.json({ message: 'Campagne verwijderd' });
  } catch (err) {
    next(err);
  }
});

// Get scan history for a campaign
router.get('/campaigns/:id/scans', requireAuth, async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    const scans = await prisma.qrScan.findMany({
      where: { campaignId: req.params.id, scannedAt: { gte: since } },
      orderBy: { scannedAt: 'desc' },
      take: 500
    });

    // Group by day for chart
    const byDay = {};
    scans.forEach(s => {
      const day = s.scannedAt.toISOString().split('T')[0];
      byDay[day] = (byDay[day] || 0) + 1;
    });

    res.json({ scans, byDay });
  } catch (err) {
    next(err);
  }
});

// Get QR stats overview (for dashboard)
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [totalScans, scansToday, scansWeek, totalCampaigns, totalMessages] = await Promise.all([
      prisma.qrScan.count(),
      prisma.qrScan.count({ where: { scannedAt: { gte: today } } }),
      prisma.qrScan.count({ where: { scannedAt: { gte: weekAgo } } }),
      prisma.qrCampaign.count({ where: { isActive: true } }),
      prisma.whatsAppMessage.count()
    ]);

    res.json({ totalScans, scansToday, scansWeek, totalCampaigns, totalMessages });
  } catch (err) {
    next(err);
  }
});

// ===== WHATSAPP WEBHOOK =====

// Verification endpoint (Meta sends GET to verify)
router.get('/whatsapp/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'cold-outreach-whatsapp-verify';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Incoming messages webhook (Meta sends POST)
router.post('/whatsapp/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          if (change.field === 'messages') {
            const messages = change.value?.messages || [];
            for (const msg of messages) {
              await prisma.whatsAppMessage.create({
                data: {
                  from: msg.from,
                  name: change.value?.contacts?.[0]?.profile?.name || null,
                  body: msg.text?.body || msg.type || '',
                  timestamp: new Date(parseInt(msg.timestamp) * 1000),
                  waId: msg.id
                }
              });
              console.log(`WhatsApp message from ${msg.from}: ${msg.text?.body || msg.type}`);
            }
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.sendStatus(200); // Always 200 to avoid Meta retries
  }
});

// Get WhatsApp messages (for CRM view)
router.get('/whatsapp/messages', requireAuth, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const [messages, total] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        orderBy: { timestamp: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.whatsAppMessage.count()
    ]);
    res.json({ messages, total });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
