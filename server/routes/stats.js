const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/dashboard', async (req, res, next) => {
  try {
    const statuses = ['NIEUW', 'VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'];
    const [counts, deals] = await Promise.all([
      Promise.all(statuses.map(status => prisma.lead.count({ where: { status } }))),
      prisma.deal.aggregate({ _sum: { totalValue: true }, _avg: { totalValue: true, acquisitionCost: true } })
    ]);

    const current = {};
    statuses.forEach((s, i) => current[s] = counts[i]);
    const totalLeads = counts.reduce((a, b) => a + b, 0);

    const funnelVerstuurd = totalLeads - current.NIEUW;
    const funnelGereageerd = current.GEREAGEERD + current.AFSPRAAK + current.KLANT + current.NIET_GEINTERESSEERD;
    const funnelInteresse = current.AFSPRAAK + current.KLANT;
    const funnelKlant = current.KLANT;

    const totalRevenue = deals._sum.totalValue || 0;
    const avgDealValue = deals._avg.totalValue || 0;
    const avgAcquisitionCost = deals._avg.acquisitionCost || 0;

    res.json({
      totalLeads,
      current,
      funnel: {
        verstuurd: funnelVerstuurd,
        gereageerd: funnelGereageerd,
        interesse: funnelInteresse,
        klant: funnelKlant
      },
      totalRevenue,
      avgDealValue,
      avgAcquisitionCost,
      conversions: {
        sendRate: totalLeads > 0 ? ((funnelVerstuurd / totalLeads) * 100).toFixed(1) : 0,
        responseRate: funnelVerstuurd > 0 ? ((funnelGereageerd / funnelVerstuurd) * 100).toFixed(1) : 0,
        interestRate: funnelGereageerd > 0 ? ((funnelInteresse / funnelGereageerd) * 100).toFixed(1) : 0,
        closeRate: funnelInteresse > 0 ? ((funnelKlant / funnelInteresse) * 100).toFixed(1) : 0
      }
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
    const nieuw = counts[0];
    const verstuurd = counts[1];
    const geenReactie = counts[2];
    const geenInteresse = counts[3];
    const interesse = counts[4];
    const klant = counts[5];
    const nietGeinteresseerd = counts[6];

    const totalVerstuurd = verstuurd + geenReactie + geenInteresse + interesse + klant + nietGeinteresseerd;
    const totalGereageerd = geenInteresse + interesse + klant + nietGeinteresseerd;
    const totalInteresse = interesse + klant;

    res.json({
      funnel,
      counts: {
        totalLeads,
        totalVerstuurd,
        totalGereageerd,
        totalInteresse,
        klant
      },
      conversions: {
        sendRate: totalLeads > 0 ? ((totalVerstuurd / totalLeads) * 100).toFixed(1) : 0,
        responseRate: totalVerstuurd > 0 ? ((totalGereageerd / totalVerstuurd) * 100).toFixed(1) : 0,
        interestRate: totalGereageerd > 0 ? ((totalInteresse / totalGereageerd) * 100).toFixed(1) : 0,
        closeRate: totalInteresse > 0 ? ((klant / totalInteresse) * 100).toFixed(1) : 0
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
