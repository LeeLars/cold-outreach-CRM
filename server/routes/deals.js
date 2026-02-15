const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [deals, total] = await Promise.all([
      prisma.deal.findMany({
        skip,
        take: parseInt(limit),
        orderBy: { saleDate: 'desc' },
        include: {
          lead: { select: { companyName: true, city: true } },
          package: { select: { name: true, oneTimePrice: true, monthlyPrice: true } },
          upsells: { include: { upsell: true } }
        }
      }),
      prisma.deal.count()
    ]);

    res.json({
      deals,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: req.params.id },
      include: {
        lead: true,
        package: true,
        upsells: { include: { upsell: true } }
      }
    });
    if (!deal) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }
    res.json(deal);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { 
      leadId, packageId, upsellIds = [], acquisitionCost = 0, saleDate,
      websiteGoal, targetAudience, hasExistingWebsite, existingWebsiteUrl,
      mood, heroType, toneOfVoice, usps, primaryCta,
      features, languages, contentStatus, urgency, specialRequests
    } = req.body;

    if (!leadId || !packageId) {
      return res.status(400).json({ error: 'Lead en pakket zijn verplicht' });
    }

    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) {
      return res.status(404).json({ error: 'Pakket niet gevonden' });
    }

    let upsellTotal = 0;
    if (upsellIds.length > 0) {
      const upsells = await prisma.upsell.findMany({
        where: { id: { in: upsellIds } }
      });
      upsellTotal = upsells.reduce((sum, u) => {
        return sum + (u.billingType === 'ONE_TIME' ? u.price : u.price * 12);
      }, 0);
    }

    const totalValue = pkg.oneTimePrice + (pkg.monthlyPrice * 12) + upsellTotal;

    const deal = await prisma.deal.create({
      data: {
        leadId,
        packageId,
        acquisitionCost: parseFloat(acquisitionCost),
        saleDate: saleDate ? new Date(saleDate) : new Date(),
        totalValue,
        websiteGoal: websiteGoal || null,
        targetAudience: targetAudience || null,
        hasExistingWebsite: hasExistingWebsite || false,
        existingWebsiteUrl: existingWebsiteUrl || null,
        mood: mood || null,
        heroType: heroType || null,
        toneOfVoice: toneOfVoice || null,
        usps: usps || null,
        primaryCta: primaryCta || null,
        features: features || null,
        languages: languages || null,
        contentStatus: contentStatus || null,
        urgency: urgency || null,
        specialRequests: specialRequests || null,
        upsells: {
          create: upsellIds.map(upsellId => ({ upsellId }))
        }
      },
      include: {
        lead: true,
        package: true,
        upsells: { include: { upsell: true } }
      }
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'KLANT' }
    });

    res.status(201).json(deal);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { 
      packageId, upsellIds = [], acquisitionCost, saleDate,
      websiteGoal, targetAudience, hasExistingWebsite, existingWebsiteUrl,
      mood, heroType, toneOfVoice, usps, primaryCta,
      features, languages, contentStatus, urgency, specialRequests
    } = req.body;

    const existing = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }

    const pkgId = packageId || existing.packageId;
    const pkg = await prisma.package.findUnique({ where: { id: pkgId } });

    let upsellTotal = 0;
    if (upsellIds.length > 0) {
      const upsells = await prisma.upsell.findMany({
        where: { id: { in: upsellIds } }
      });
      upsellTotal = upsells.reduce((sum, u) => {
        return sum + (u.billingType === 'ONE_TIME' ? u.price : u.price * 12);
      }, 0);
    }

    const totalValue = pkg.oneTimePrice + (pkg.monthlyPrice * 12) + upsellTotal;

    await prisma.dealUpsell.deleteMany({ where: { dealId: req.params.id } });

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data: {
        packageId: pkgId,
        acquisitionCost: acquisitionCost !== undefined ? parseFloat(acquisitionCost) : existing.acquisitionCost,
        saleDate: saleDate ? new Date(saleDate) : existing.saleDate,
        totalValue,
        websiteGoal: websiteGoal !== undefined ? websiteGoal : existing.websiteGoal,
        targetAudience: targetAudience !== undefined ? targetAudience : existing.targetAudience,
        hasExistingWebsite: hasExistingWebsite !== undefined ? hasExistingWebsite : existing.hasExistingWebsite,
        existingWebsiteUrl: existingWebsiteUrl !== undefined ? existingWebsiteUrl : existing.existingWebsiteUrl,
        mood: mood !== undefined ? mood : existing.mood,
        heroType: heroType !== undefined ? heroType : existing.heroType,
        toneOfVoice: toneOfVoice !== undefined ? toneOfVoice : existing.toneOfVoice,
        usps: usps !== undefined ? usps : existing.usps,
        primaryCta: primaryCta !== undefined ? primaryCta : existing.primaryCta,
        features: features !== undefined ? features : existing.features,
        languages: languages !== undefined ? languages : existing.languages,
        contentStatus: contentStatus !== undefined ? contentStatus : existing.contentStatus,
        urgency: urgency !== undefined ? urgency : existing.urgency,
        specialRequests: specialRequests !== undefined ? specialRequests : existing.specialRequests,
        upsells: {
          create: upsellIds.map(upsellId => ({ upsellId }))
        }
      },
      include: {
        lead: true,
        package: true,
        upsells: { include: { upsell: true } }
      }
    });

    res.json(deal);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!deal) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }

    await prisma.dealUpsell.deleteMany({ where: { dealId: req.params.id } });
    await prisma.deal.delete({ where: { id: req.params.id } });

    res.json({ message: 'Deal verwijderd' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
