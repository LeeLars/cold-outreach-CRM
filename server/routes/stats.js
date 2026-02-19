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
        lead: { select: { companyName: true, city: true } },
        package: true,
        upsells: { include: { upsell: true } }
      },
      orderBy: { saleDate: 'asc' }
    });

    // Per-deal breakdown
    const perDeal = deals.map(deal => {
      const pkgOneTime = deal.package.oneTimePrice;
      const upsellOneTime = deal.upsells
        .filter(u => u.upsell.billingType === 'ONE_TIME')
        .reduce((s, u) => s + u.upsell.price, 0);
      const upsellMonthly = deal.upsells
        .filter(u => u.upsell.billingType === 'MONTHLY')
        .reduce((s, u) => s + u.upsell.price, 0);

      // Discount on one-time
      let discount = 0;
      if (deal.discountType === 'percentage') {
        discount = ((pkgOneTime + upsellOneTime) * deal.discountPercentage) / 100;
      } else if (deal.discountType === 'fixed') {
        discount = deal.discountAmount;
      }

      // Hosting calculation - respect interval
      const hostingMonthly = deal.hasHosting ? deal.hostingPrice : 0;
      const hostingYearly = deal.hasHosting 
        ? (deal.hostingInterval === 'YEARLY' ? hostingMonthly : hostingMonthly * 12)
        : 0;
      const upsellMonthlyYearly = upsellMonthly * 12;
      
      // Calculate actual monthly recurring (for MRR insight)
      const actualMonthlyRecurring = deal.hasHosting
        ? (deal.hostingInterval === 'YEARLY' ? hostingMonthly / 12 : hostingMonthly)
        : 0;

      return {
        id: deal.id,
        companyName: deal.lead.companyName,
        city: deal.lead.city,
        packageName: deal.package.name,
        saleDate: deal.saleDate,
        acquisitionType: deal.acquisitionType,
        acquisitionCost: deal.acquisitionCost,
        pkgOneTime,
        upsellOneTime,
        upsellMonthly,
        upsellMonthlyYearly,
        discount,
        discountType: deal.discountType,
        hostingMonthly,
        hostingYearly,
        hostingInterval: deal.hostingInterval,
        actualMonthlyRecurring,
        totalValue: deal.totalValue,
        upsellNames: deal.upsells.map(u => u.upsell.name)
      };
    });

    // Totals breakdown
    const totOneTime = perDeal.reduce((s, d) => s + d.pkgOneTime, 0);
    const totUpsellOneTime = perDeal.reduce((s, d) => s + d.upsellOneTime, 0);
    const totUpsellMonthlyYearly = perDeal.reduce((s, d) => s + d.upsellMonthlyYearly, 0);
    const totDiscount = perDeal.reduce((s, d) => s + d.discount, 0);
    const totHostingYearly = perDeal.reduce((s, d) => s + d.hostingYearly, 0);
    const totHostingMonthly = perDeal.reduce((s, d) => s + d.hostingMonthly, 0);
    const totActualMRR = perDeal.reduce((s, d) => s + d.actualMonthlyRecurring, 0);
    const totUpsellMRR = perDeal.reduce((s, d) => s + d.upsellMonthly, 0);
    const totalRevenue = perDeal.reduce((s, d) => s + d.totalValue, 0);
    const totalCost = perDeal.reduce((s, d) => s + d.acquisitionCost, 0);
    const roi = totalCost > 0 ? (((totalRevenue - totalCost) / totalCost) * 100).toFixed(1) : 0;
    const totalClients = perDeal.length;
    const avgDeal = totalClients > 0 ? totalRevenue / totalClients : 0;

    // Monthly breakdown per type
    const monthlyBreakdown = {};
    perDeal.forEach(d => {
      const month = d.saleDate.toISOString().slice(0, 7);
      if (!monthlyBreakdown[month]) monthlyBreakdown[month] = { eenmalig: 0, hosting: 0, upsells: 0, korting: 0, total: 0 };
      monthlyBreakdown[month].eenmalig += d.pkgOneTime;
      monthlyBreakdown[month].hosting += d.hostingYearly;
      monthlyBreakdown[month].upsells += d.upsellOneTime + d.upsellMonthlyYearly;
      monthlyBreakdown[month].korting += d.discount;
      monthlyBreakdown[month].total += d.totalValue;
    });

    // Package breakdown
    const packageBreakdown = {};
    perDeal.forEach(d => {
      if (!packageBreakdown[d.packageName]) packageBreakdown[d.packageName] = { count: 0, eenmalig: 0, hosting: 0, total: 0 };
      packageBreakdown[d.packageName].count++;
      packageBreakdown[d.packageName].eenmalig += d.pkgOneTime;
      packageBreakdown[d.packageName].hosting += d.hostingYearly;
      packageBreakdown[d.packageName].total += d.totalValue;
    });

    // Upsell breakdown
    const upsellBreakdown = {};
    deals.forEach(deal => {
      deal.upsells.forEach(u => {
        const name = u.upsell.name;
        if (!upsellBreakdown[name]) upsellBreakdown[name] = { count: 0, revenue: 0, type: u.upsell.billingType, price: u.upsell.price };
        upsellBreakdown[name].count++;
        upsellBreakdown[name].revenue += u.upsell.billingType === 'ONE_TIME' ? u.upsell.price : u.upsell.price * 12;
      });
    });

    // Channel breakdown
    const flyerDeals = perDeal.filter(d => d.acquisitionType === 'flyer');
    const warmDeals = perDeal.filter(d => d.acquisitionType !== 'flyer');
    const flyerRevenue = flyerDeals.reduce((s, d) => s + d.totalValue, 0);
    const flyerCost = flyerDeals.reduce((s, d) => s + d.acquisitionCost, 0);
    const warmRevenue = warmDeals.reduce((s, d) => s + d.totalValue, 0);
    const warmCost = warmDeals.reduce((s, d) => s + d.acquisitionCost, 0);

    res.json({
      // Summary totals
      totalRevenue, totalCost, roi, totalClients, avgDeal,
      // Breakdown totals
      breakdown: {
        eenmalig: totOneTime,
        upsellOneTime: totUpsellOneTime,
        upsellMonthlyYearly: totUpsellMonthlyYearly,
        discount: totDiscount,
        hostingYearly: totHostingYearly,
        hostingMonthly: totHostingMonthly,
        actualMRR: totActualMRR,
        upsellMRR: totUpsellMRR
      },
      // Monthly stacked
      monthlyBreakdown: Object.entries(monthlyBreakdown).map(([month, data]) => ({ month, ...data })),
      // Package breakdown
      packageBreakdown: Object.entries(packageBreakdown).map(([name, data]) => ({ name, ...data })),
      // Upsell breakdown
      upsellBreakdown: Object.entries(upsellBreakdown).map(([name, data]) => ({ name, ...data })),
      // Per deal detail
      perDeal,
      // Channel
      flyer: {
        revenue: flyerRevenue, cost: flyerCost, count: flyerDeals.length,
        roi: flyerCost > 0 ? (((flyerRevenue - flyerCost) / flyerCost) * 100).toFixed(1) : '0'
      },
      warm: {
        revenue: warmRevenue, cost: warmCost, count: warmDeals.length,
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
