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
      leadId, packageId, upsellIds = [], acquisitionCost = 0, acquisitionType = 'manual', saleDate,
      websiteGoal, targetAudience, hasExistingWebsite, existingWebsiteUrl,
      mood, heroType, toneOfVoice, referenceUrls, usps, primaryCta,
      features, languages, contentStatus, urgency, specialRequests,
      hasHosting = true, hostingStartDate, hostingEndDate, hostingPrice = 20, hostingCostPrice = 0, hostingInterval = 'MONTHLY',
      domainCost = 0, emailCostMonthly = 0,
      discountType = 'none', discountPercentage = 0, discountAmount = 0
    } = req.body;

    if (!leadId || !packageId) {
      return res.status(400).json({ error: 'Lead en pakket zijn verplicht' });
    }

    const pkg = await prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) {
      return res.status(404).json({ error: 'Pakket niet gevonden' });
    }

    let upsellTotal = 0;
    let upsellOneTime = 0;
    if (upsellIds.length > 0) {
      const upsells = await prisma.upsell.findMany({
        where: { id: { in: upsellIds } }
      });
      upsellOneTime = upsells.filter(u => u.billingType === 'ONE_TIME').reduce((sum, u) => sum + u.price, 0);
      const upsellMonthly = upsells.filter(u => u.billingType === 'MONTHLY').reduce((sum, u) => sum + u.price, 0);
      upsellTotal = upsellOneTime + (upsellMonthly * 12);
    }

    // Calculate discount
    const oneTimeTotal = pkg.oneTimePrice + upsellOneTime;
    let calculatedDiscount = 0;
    if (discountType === 'percentage') {
      calculatedDiscount = (oneTimeTotal * parseFloat(discountPercentage)) / 100;
    } else if (discountType === 'fixed') {
      calculatedDiscount = parseFloat(discountAmount);
    }
    const oneTimeAfterDiscount = Math.max(0, oneTimeTotal - calculatedDiscount);

    const hostingMonthly = hasHosting ? parseFloat(hostingPrice || pkg.monthlyPrice) : 0;
    const totalValue = oneTimeAfterDiscount + (hostingMonthly * 12) + (upsellTotal - upsellOneTime);

    const saleDateObj = saleDate ? new Date(saleDate) : new Date();
    let nextInvoice = null;
    if (hasHosting) {
      const start = hostingStartDate ? new Date(hostingStartDate) : saleDateObj;
      nextInvoice = new Date(start);
      if (hostingInterval === 'YEARLY') {
        nextInvoice.setFullYear(nextInvoice.getFullYear() + 1);
      } else {
        nextInvoice.setMonth(nextInvoice.getMonth() + 1);
      }
    }

    const deal = await prisma.deal.create({
      data: {
        leadId,
        packageId,
        acquisitionCost: parseFloat(acquisitionCost),
        acquisitionType: acquisitionType || 'manual',
        saleDate: saleDateObj,
        totalValue,
        hasHosting: hasHosting,
        hostingStartDate: hasHosting && hostingStartDate ? new Date(hostingStartDate) : (hasHosting ? saleDateObj : null),
        hostingEndDate: hasHosting && hostingEndDate ? new Date(hostingEndDate) : null,
        hostingPrice: hostingMonthly,
        hostingCostPrice: parseFloat(hostingCostPrice) || 0,
        hostingInterval: hostingInterval || 'MONTHLY',
        nextInvoiceDate: nextInvoice,
        domainCost: parseFloat(domainCost) || 0,
        emailCostMonthly: parseFloat(emailCostMonthly) || 0,
        websiteGoal: websiteGoal || null,
        targetAudience: targetAudience || null,
        hasExistingWebsite: hasExistingWebsite || false,
        existingWebsiteUrl: existingWebsiteUrl || null,
        mood: mood || null,
        heroType: heroType || null,
        toneOfVoice: toneOfVoice || null,
        referenceUrls: referenceUrls || null,
        usps: usps || null,
        primaryCta: primaryCta || null,
        features: features || null,
        languages: languages || null,
        contentStatus: contentStatus || null,
        urgency: urgency || null,
        specialRequests: specialRequests || null,
        discountType: discountType || 'none',
        discountPercentage: parseFloat(discountPercentage) || 0,
        discountAmount: parseFloat(discountAmount) || 0,
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

    // Auto-create client account from lead data
    const lead = deal.lead;
    await prisma.client.create({
      data: {
        companyName: lead.companyName,
        vatNumber: lead.vatNumber || null,
        contactPerson: lead.contactPerson || null,
        email: lead.email || null,
        phone: lead.phone || null,
        address: lead.address || null,
        city: lead.city || null,
        website: lead.website || null,
        dealId: deal.id
      }
    });

    res.status(201).json(deal);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { 
      packageId, upsellIds = [], acquisitionCost, acquisitionType, saleDate,
      websiteGoal, targetAudience, hasExistingWebsite, existingWebsiteUrl,
      mood, heroType, toneOfVoice, referenceUrls, usps, primaryCta,
      features, languages, contentStatus, urgency, specialRequests,
      hasHosting, hostingStartDate, hostingEndDate, hostingPrice, hostingCostPrice, hostingInterval,
      domainCost, emailCostMonthly,
      discountType, discountPercentage, discountAmount
    } = req.body;

    const existing = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }

    const pkgId = packageId || existing.packageId;
    const pkg = await prisma.package.findUnique({ where: { id: pkgId } });

    let upsellTotal = 0;
    let upsellOneTime = 0;
    if (upsellIds.length > 0) {
      const upsells = await prisma.upsell.findMany({
        where: { id: { in: upsellIds } }
      });
      upsellOneTime = upsells.filter(u => u.billingType === 'ONE_TIME').reduce((sum, u) => sum + u.price, 0);
      const upsellMonthly = upsells.filter(u => u.billingType === 'MONTHLY').reduce((sum, u) => sum + u.price, 0);
      upsellTotal = upsellOneTime + (upsellMonthly * 12);
    }

    // Calculate discount
    const useDiscountType = discountType !== undefined ? discountType : existing.discountType;
    const useDiscountPercentage = discountPercentage !== undefined ? parseFloat(discountPercentage) : existing.discountPercentage;
    const useDiscountAmount = discountAmount !== undefined ? parseFloat(discountAmount) : existing.discountAmount;
    
    const oneTimeTotal = pkg.oneTimePrice + upsellOneTime;
    let calculatedDiscount = 0;
    if (useDiscountType === 'percentage') {
      calculatedDiscount = (oneTimeTotal * useDiscountPercentage) / 100;
    } else if (useDiscountType === 'fixed') {
      calculatedDiscount = useDiscountAmount;
    }
    const oneTimeAfterDiscount = Math.max(0, oneTimeTotal - calculatedDiscount);

    const useHosting = hasHosting !== undefined ? hasHosting : existing.hasHosting;
    const useHostingPrice = useHosting ? parseFloat(hostingPrice !== undefined ? hostingPrice : existing.hostingPrice) : 0;
    const totalValue = oneTimeAfterDiscount + (useHostingPrice * 12) + (upsellTotal - upsellOneTime);

    let nextInvoice = existing.nextInvoiceDate;
    if (hasHosting !== undefined) {
      if (useHosting) {
        const start = hostingStartDate ? new Date(hostingStartDate) : (existing.hostingStartDate || new Date());
        const interval = hostingInterval || existing.hostingInterval || 'MONTHLY';
        nextInvoice = new Date(start);
        if (interval === 'YEARLY') {
          nextInvoice.setFullYear(nextInvoice.getFullYear() + 1);
        } else {
          nextInvoice.setMonth(nextInvoice.getMonth() + 1);
        }
      } else {
        nextInvoice = null;
      }
    }

    await prisma.dealUpsell.deleteMany({ where: { dealId: req.params.id } });

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data: {
        packageId: pkgId,
        acquisitionCost: acquisitionCost !== undefined ? parseFloat(acquisitionCost) : existing.acquisitionCost,
        acquisitionType: acquisitionType !== undefined ? acquisitionType : existing.acquisitionType,
        saleDate: saleDate ? new Date(saleDate) : existing.saleDate,
        totalValue,
        hasHosting: useHosting,
        hostingStartDate: hostingStartDate !== undefined ? (hostingStartDate ? new Date(hostingStartDate) : null) : existing.hostingStartDate,
        hostingEndDate: hostingEndDate !== undefined ? (hostingEndDate ? new Date(hostingEndDate) : null) : existing.hostingEndDate,
        hostingPrice: useHostingPrice,
        hostingCostPrice: hostingCostPrice !== undefined ? parseFloat(hostingCostPrice) : existing.hostingCostPrice,
        hostingInterval: hostingInterval !== undefined ? hostingInterval : existing.hostingInterval,
        domainCost: domainCost !== undefined ? parseFloat(domainCost) : existing.domainCost,
        emailCostMonthly: emailCostMonthly !== undefined ? parseFloat(emailCostMonthly) : existing.emailCostMonthly,
        nextInvoiceDate: nextInvoice,
        websiteGoal: websiteGoal !== undefined ? websiteGoal : existing.websiteGoal,
        targetAudience: targetAudience !== undefined ? targetAudience : existing.targetAudience,
        hasExistingWebsite: hasExistingWebsite !== undefined ? hasExistingWebsite : existing.hasExistingWebsite,
        existingWebsiteUrl: existingWebsiteUrl !== undefined ? existingWebsiteUrl : existing.existingWebsiteUrl,
        mood: mood !== undefined ? mood : existing.mood,
        heroType: heroType !== undefined ? heroType : existing.heroType,
        toneOfVoice: toneOfVoice !== undefined ? toneOfVoice : existing.toneOfVoice,
        referenceUrls: referenceUrls !== undefined ? referenceUrls : existing.referenceUrls,
        usps: usps !== undefined ? usps : existing.usps,
        primaryCta: primaryCta !== undefined ? primaryCta : existing.primaryCta,
        features: features !== undefined ? features : existing.features,
        languages: languages !== undefined ? languages : existing.languages,
        contentStatus: contentStatus !== undefined ? contentStatus : existing.contentStatus,
        urgency: urgency !== undefined ? urgency : existing.urgency,
        specialRequests: specialRequests !== undefined ? specialRequests : existing.specialRequests,
        discountType: useDiscountType,
        discountPercentage: useDiscountPercentage,
        discountAmount: useDiscountAmount,
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

router.put('/:id/hosting', async (req, res, next) => {
  try {
    const { hostingPrice, hostingCostPrice, hostingInterval, hostingStartDate, hostingEndDate, nextInvoiceDate, domainCost, emailCostMonthly } = req.body;

    const existing = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }

    const data = {};
    if (hostingPrice !== undefined) data.hostingPrice = parseFloat(hostingPrice);
    if (hostingCostPrice !== undefined) data.hostingCostPrice = parseFloat(hostingCostPrice);
    if (hostingInterval !== undefined) data.hostingInterval = hostingInterval;
    if (hostingStartDate !== undefined) data.hostingStartDate = hostingStartDate ? new Date(hostingStartDate) : null;
    if (hostingEndDate !== undefined) data.hostingEndDate = hostingEndDate ? new Date(hostingEndDate) : null;
    if (nextInvoiceDate !== undefined) data.nextInvoiceDate = nextInvoiceDate ? new Date(nextInvoiceDate) : null;
    if (domainCost !== undefined) data.domainCost = parseFloat(domainCost);
    if (emailCostMonthly !== undefined) data.emailCostMonthly = parseFloat(emailCostMonthly);

    const deal = await prisma.deal.update({
      where: { id: req.params.id },
      data,
      include: {
        lead: { select: { companyName: true, city: true } },
        package: { select: { name: true } }
      }
    });

    res.json(deal);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/hosting', async (req, res, next) => {
  try {
    const existing = await prisma.deal.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }

    await prisma.deal.update({
      where: { id: req.params.id },
      data: {
        hasHosting: false,
        hostingPrice: 0,
        hostingStartDate: null,
        hostingEndDate: null,
        nextInvoiceDate: null
      }
    });

    res.json({ message: 'Hosting verwijderd' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deal = await prisma.deal.findUnique({ 
      where: { id: req.params.id },
      include: { client: { select: { id: true } } }
    });
    if (!deal) {
      return res.status(404).json({ error: 'Deal niet gevonden' });
    }

    // Delete related records in correct order
    await prisma.dealUpsell.deleteMany({ where: { dealId: req.params.id } });
    if (deal.client) {
      await prisma.client.delete({ where: { id: deal.client.id } });
    }
    await prisma.deal.delete({ where: { id: req.params.id } });

    // Reset lead status since deal is removed
    await prisma.lead.update({
      where: { id: deal.leadId },
      data: { status: 'AFSPRAAK' }
    });

    res.json({ message: 'Deal verwijderd' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
