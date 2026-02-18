const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { normalizeCity } = require('../utils/normalize');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/dashboard', async (req, res, next) => {
  try {
    // Count ALL leads (including CRM) for total overview
    const statuses = ['NIEUW', 'VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'];
    const [allCounts, pipelineCounts, deals, clientCount] = await Promise.all([
      // All leads for totals
      Promise.all(statuses.map(status => prisma.lead.count({ where: { status } }))),
      // Pipeline-only leads for funnel conversions (exclude direct clients)
      Promise.all(statuses.map(status => prisma.lead.count({ 
        where: { status, source: { not: 'CRM' } } 
      }))),
      prisma.deal.aggregate({ _sum: { totalValue: true }, _avg: { totalValue: true, acquisitionCost: true } }),
      prisma.client.count()
    ]);

    // All leads for display
    const current = {};
    statuses.forEach((s, i) => current[s] = allCounts[i]);
    const totalLeads = allCounts.reduce((a, b) => a + b, 0);

    // Pipeline-only for funnel conversions
    const pipelineTotal = pipelineCounts.reduce((a, b) => a + b, 0);
    const pNieuw = pipelineCounts[0];
    const pVerstuurd = pipelineTotal - pNieuw;
    const pGereageerd = pipelineCounts[3] + pipelineCounts[4] + pipelineCounts[5] + pipelineCounts[6];
    const pInteresse = pipelineCounts[4] + pipelineCounts[5];
    const pKlant = pipelineCounts[5];

    const totalRevenue = deals._sum.totalValue || 0;
    const avgDealValue = deals._avg.totalValue || 0;
    const avgAcquisitionCost = deals._avg.acquisitionCost || 0;

    res.json({
      totalLeads,
      totalClients: clientCount,
      current,
      funnel: {
        verstuurd: pVerstuurd,
        gereageerd: pGereageerd,
        interesse: pInteresse,
        klant: pKlant
      },
      totalRevenue,
      avgDealValue,
      avgAcquisitionCost,
      conversions: {
        sendRate: pipelineTotal > 0 ? ((pVerstuurd / pipelineTotal) * 100).toFixed(1) : 0,
        responseRate: pVerstuurd > 0 ? ((pGereageerd / pVerstuurd) * 100).toFixed(1) : 0,
        interestRate: pGereageerd > 0 ? ((pInteresse / pGereageerd) * 100).toFixed(1) : 0,
        closeRate: pInteresse > 0 ? ((pKlant / pInteresse) * 100).toFixed(1) : 0
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/funnel', async (req, res, next) => {
  try {
    // Exclude leads with source 'CRM' (direct clients that didn't go through pipeline)
    const statuses = ['NIEUW', 'VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'];
    const counts = await Promise.all(
      statuses.map(status => prisma.lead.count({ 
        where: { 
          status,
          source: { not: 'CRM' } // Exclude direct clients
        } 
      }))
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

    const flyerDeals = deals.filter(d => d.acquisitionType === 'flyer');
    const warmDeals = deals.filter(d => d.acquisitionType !== 'flyer');

    const flyerRevenue = flyerDeals.reduce((sum, d) => sum + d.totalValue, 0);
    const flyerCost = flyerDeals.reduce((sum, d) => sum + d.acquisitionCost, 0);
    const warmRevenue = warmDeals.reduce((sum, d) => sum + d.totalValue, 0);
    const warmCost = warmDeals.reduce((sum, d) => sum + d.acquisitionCost, 0);

    res.json({
      monthlyRevenue: Object.entries(monthlyRevenue).map(([month, revenue]) => ({ month, revenue })),
      packageRevenue: Object.entries(packageRevenue).map(([name, revenue]) => ({ name, revenue })),
      totalRevenue,
      totalCost,
      roi,
      flyer: {
        revenue: flyerRevenue,
        cost: flyerCost,
        count: flyerDeals.length,
        roi: flyerCost > 0 ? (((flyerRevenue - flyerCost) / flyerCost) * 100).toFixed(1) : '0'
      },
      warm: {
        revenue: warmRevenue,
        cost: warmCost,
        count: warmDeals.length,
        roi: warmCost > 0 ? (((warmRevenue - warmCost) / warmCost) * 100).toFixed(1) : '0'
      }
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
      acquisitionType: deal.acquisitionType || 'manual',
      roi: deal.acquisitionCost > 0
        ? (((deal.totalValue - deal.acquisitionCost) / deal.acquisitionCost) * 100).toFixed(1)
        : 0,
      saleDate: deal.saleDate
    }));

    const flyerDeals = deals.filter(d => d.acquisitionType === 'flyer');
    const warmDeals = deals.filter(d => d.acquisitionType !== 'flyer');

    const flyerCost = flyerDeals.reduce((sum, d) => sum + d.acquisitionCost, 0);
    const flyerRevenue = flyerDeals.reduce((sum, d) => sum + d.totalValue, 0);
    const warmCost = warmDeals.reduce((sum, d) => sum + d.acquisitionCost, 0);
    const warmRevenue = warmDeals.reduce((sum, d) => sum + d.totalValue, 0);

    res.json({
      avgCost: avgCost.toFixed(2),
      perClient,
      flyer: {
        count: flyerDeals.length,
        totalCost: flyerCost,
        totalRevenue: flyerRevenue,
        avgCost: flyerDeals.length > 0 ? (flyerCost / flyerDeals.length).toFixed(2) : '0.00',
        roi: flyerCost > 0 ? (((flyerRevenue - flyerCost) / flyerCost) * 100).toFixed(1) : '0'
      },
      warm: {
        count: warmDeals.length,
        totalCost: warmCost,
        totalRevenue: warmRevenue,
        avgCost: warmDeals.length > 0 ? (warmCost / warmDeals.length).toFixed(2) : '0.00',
        roi: warmCost > 0 ? (((warmRevenue - warmCost) / warmCost) * 100).toFixed(1) : '0'
      }
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

router.get('/locations', async (req, res, next) => {
  try {
    // Include all leads for location stats (CRM leads count as warm leads)
    const leads = await prisma.lead.findMany({
      select: {
        city: true,
        status: true,
        source: true,
        deal: {
          select: {
            totalValue: true,
            acquisitionType: true
          }
        }
      }
    });

    function isFlyer(lead) {
      if (lead.deal && lead.deal.acquisitionType === 'flyer') return true;
      if (lead.source && lead.source.toLowerCase().includes('flyer')) return true;
      return false;
    }

    function buildLocationStats(filteredLeads) {
      const locationStats = {};
      const cityNameMap = {};

      filteredLeads.forEach(lead => {
        let city;
        if (!lead.city) {
          city = 'Onbekend';
        } else {
          const normalizedKey = lead.city.toLowerCase().trim();
          if (!cityNameMap[normalizedKey]) {
            cityNameMap[normalizedKey] = normalizeCity(lead.city);
          }
          city = cityNameMap[normalizedKey];
        }

        if (!locationStats[city]) {
          locationStats[city] = { total: 0, verstuurd: 0, gereageerd: 0, klanten: 0, revenue: 0 };
        }

        locationStats[city].total++;

        if (['VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'].includes(lead.status)) {
          locationStats[city].verstuurd++;
        }
        if (['GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'].includes(lead.status)) {
          locationStats[city].gereageerd++;
        }
        if (lead.status === 'KLANT') {
          locationStats[city].klanten++;
          if (lead.deal) {
            locationStats[city].revenue += lead.deal.totalValue;
          }
        }
      });

      return Object.entries(locationStats).map(([city, stats]) => ({
        city,
        ...stats,
        responseRate: stats.verstuurd > 0 ? ((stats.gereageerd / stats.verstuurd) * 100).toFixed(1) : 0,
        conversionRate: stats.gereageerd > 0 ? ((stats.klanten / stats.gereageerd) * 100).toFixed(1) : 0
      })).sort((a, b) => b.total - a.total);
    }

    const flyerLeads = leads.filter(l => isFlyer(l));
    const warmLeads = leads.filter(l => !isFlyer(l));

    res.json({
      all: buildLocationStats(leads),
      flyer: buildLocationStats(flyerLeads),
      warm: buildLocationStats(warmLeads)
    });
  } catch (err) {
    next(err);
  }
});

router.get('/hosting', async (req, res, next) => {
  try {
    const deals = await prisma.deal.findMany({
      where: { hasHosting: true },
      include: {
        lead: { select: { companyName: true, city: true } },
        package: { select: { name: true } }
      },
      orderBy: { nextInvoiceDate: 'asc' }
    });

    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    const totalClients = deals.length;
    const monthlyRevenue = deals.reduce((sum, d) => sum + (d.hostingInterval === 'MONTHLY' ? d.hostingPrice : d.hostingPrice / 12), 0);
    const yearlyRevenue = monthlyRevenue * 12;

    const needsInvoicing = deals.filter(d => d.nextInvoiceDate && new Date(d.nextInvoiceDate) <= now);
    const expiringSoon = deals.filter(d => d.hostingEndDate && new Date(d.hostingEndDate) <= in30Days && new Date(d.hostingEndDate) > now);
    const upcomingInvoices = deals.filter(d => d.nextInvoiceDate && new Date(d.nextInvoiceDate) > now && new Date(d.nextInvoiceDate) <= in30Days);

    const clients = deals.map(d => ({
      id: d.id,
      companyName: d.lead.companyName,
      city: d.lead.city,
      packageName: d.package.name,
      hostingPrice: d.hostingPrice,
      hostingInterval: d.hostingInterval,
      hostingStartDate: d.hostingStartDate,
      hostingEndDate: d.hostingEndDate,
      nextInvoiceDate: d.nextInvoiceDate,
      status: d.hostingEndDate && new Date(d.hostingEndDate) <= now ? 'expired' :
              d.hostingEndDate && new Date(d.hostingEndDate) <= in30Days ? 'expiring' :
              d.nextInvoiceDate && new Date(d.nextInvoiceDate) <= now ? 'overdue' : 'active'
    }));

    res.json({
      totalClients,
      monthlyRevenue,
      yearlyRevenue,
      avgPerClient: totalClients > 0 ? monthlyRevenue / totalClients : 0,
      needsInvoicing: needsInvoicing.length,
      expiringSoon: expiringSoon.length,
      upcomingInvoices: upcomingInvoices.length,
      clients
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
