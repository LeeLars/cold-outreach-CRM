const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/dashboard', async (req, res, next) => {
  try {
    const [
      totalLeads,
      verstuurd,
      gereageerd,
      afspraken,
      klanten,
      deals
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { status: { in: ['VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'] } } }),
      prisma.lead.count({ where: { status: { in: ['GEREAGEERD', 'AFSPRAAK', 'KLANT'] } } }),
      prisma.lead.count({ where: { status: { in: ['AFSPRAAK', 'KLANT'] } } }),
      prisma.lead.count({ where: { status: 'KLANT' } }),
      prisma.deal.aggregate({ _sum: { totalValue: true }, _avg: { totalValue: true, acquisitionCost: true } })
    ]);

    const totalRevenue = deals._sum.totalValue || 0;
    const avgDealValue = deals._avg.totalValue || 0;
    const avgAcquisitionCost = deals._avg.acquisitionCost || 0;

    res.json({
      totalLeads,
      verstuurd,
      gereageerd,
      afspraken,
      klanten,
      totalRevenue,
      avgDealValue,
      avgAcquisitionCost,
      conversionRate: totalLeads > 0 ? ((klanten / totalLeads) * 100).toFixed(1) : 0,
      responseRate: verstuurd > 0 ? ((gereageerd / verstuurd) * 100).toFixed(1) : 0
    });
  } catch (err) {
    next(err);
  }
});

router.get('/funnel', async (req, res, next) => {
  try {
    const statuses = ['NIEUW', 'VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'];
    const counts = await Promise.all(
      statuses.map(status => prisma.lead.count({ where: { status } }))
    );

    const funnel = statuses.map((status, i) => ({
      status,
      count: counts[i]
    }));

    const totalLeads = counts.reduce((a, b) => a + b, 0);
    const verstuurd = totalLeads - counts[0];
    const gereageerd = counts[3] + counts[4] + counts[5];
    const afspraken = counts[4] + counts[5];
    const klanten = counts[5];

    res.json({
      funnel,
      conversions: {
        sendRate: totalLeads > 0 ? ((verstuurd / totalLeads) * 100).toFixed(1) : 0,
        responseRate: verstuurd > 0 ? ((gereageerd / verstuurd) * 100).toFixed(1) : 0,
        appointmentRate: gereageerd > 0 ? ((afspraken / gereageerd) * 100).toFixed(1) : 0,
        closeRate: afspraken > 0 ? ((klanten / afspraken) * 100).toFixed(1) : 0
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/revenue', async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({
      include: {
        package: true,
        upsells: { include: { upsell: true } }
      },
      orderBy: { saleDate: 'asc' }
    });

    const monthlyRevenue = {};
    const packageRevenue = {};

    deals.forEach(deal => {
      const month = deal.saleDate.toISOString().slice(0, 7);
      monthlyRevenue[month] = (monthlyRevenue[month] || 0) + deal.totalValue;

      const pkgName = deal.package.name;
      packageRevenue[pkgName] = (packageRevenue[pkgName] || 0) + deal.totalValue;
    });

    const totalRevenue = deals.reduce((sum, d) => sum + d.totalValue, 0);
    const totalCost = deals.reduce((sum, d) => sum + d.acquisitionCost, 0);
    const roi = totalCost > 0 ? (((totalRevenue - totalCost) / totalCost) * 100).toFixed(1) : 0;

    res.json({
      monthlyRevenue: Object.entries(monthlyRevenue).map(([month, revenue]) => ({ month, revenue })),
      packageRevenue: Object.entries(packageRevenue).map(([name, revenue]) => ({ name, revenue })),
      totalRevenue,
      totalCost,
      roi
    });
  } catch (err) {
    next(err);
  }
});

router.get('/acquisition', async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({
      include: {
        lead: { select: { companyName: true } }
      },
      orderBy: { saleDate: 'asc' }
    });

    const avgCost = deals.length > 0
      ? deals.reduce((sum, d) => sum + d.acquisitionCost, 0) / deals.length
      : 0;

    const perClient = deals.map(deal => ({
      companyName: deal.lead.companyName,
      acquisitionCost: deal.acquisitionCost,
      dealValue: deal.totalValue,
      roi: deal.acquisitionCost > 0
        ? (((deal.totalValue - deal.acquisitionCost) / deal.acquisitionCost) * 100).toFixed(1)
        : 0,
      saleDate: deal.saleDate
    }));

    res.json({
      avgCost: avgCost.toFixed(2),
      perClient
    });
  } catch (err) {
    next(err);
  }
});

router.get('/recent-leads', async (req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        city: true,
        status: true,
        createdAt: true
      }
    });
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
