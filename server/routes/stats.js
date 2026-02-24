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
      // Alleen cold leads en flyer actie voor funnel conversies
      Promise.all(statuses.map(status => prisma.lead.count({ 
        where: { status, source: { in: ['cold', 'flyer'] } } 
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
    // Alleen cold leads en flyer actie leads tonen (geen warme leads/CRM)
    const statuses = ['NIEUW', 'VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'];
    const counts = await Promise.all(
      statuses.map(status => prisma.lead.count({ 
        where: { 
          status,
          source: { in: ['cold', 'flyer'] } // Alleen cold leads en flyer actie
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

    const now = new Date();
    const selectedYear = req.query.year ? parseInt(req.query.year) : now.getFullYear();
    const currentYear = selectedYear;

    // Helper: calculate remaining months in a year from a given start month (1-indexed)
    // e.g. startMonth=3 (march) => months 3..12 => 10 months remaining
    function remainingMonthsInYear(startDate, year) {
      const d = new Date(startDate);
      const startYear = d.getFullYear();
      if (startYear > year) return 0; // hasn't started yet in this year
      if (startYear < year) return 12; // full year
      // same year: remaining months from start month
      const startMonth = d.getMonth(); // 0-indexed
      return 12 - startMonth;
    }

    // Helper: get quarter for a month (0-indexed)
    function getQuarter(month) {
      if (month < 3) return 'Q1';
      if (month < 6) return 'Q2';
      if (month < 9) return 'Q3';
      return 'Q4';
    }

    // Helper: months in a quarter from a start month
    // e.g. Q1 = months 0,1,2 - if start is month 1 (feb), returns 2 months in Q1
    function monthsInQuarterFromStart(startDate, quarter, year) {
      const qRanges = { Q1: [0,1,2], Q2: [3,4,5], Q3: [6,7,8], Q4: [9,10,11] };
      const months = qRanges[quarter];
      const d = new Date(startDate);
      const startYear = d.getFullYear();
      const startMonth = d.getMonth();
      
      if (startYear > year) return 0;
      
      let count = 0;
      for (const m of months) {
        if (startYear < year || (startYear === year && m >= startMonth)) {
          count++;
        }
      }
      return count;
    }

    // Helper: get array of active months (as 'YYYY-MM' strings) for recurring revenue in a given year
    function getActiveMonths(startDate, endDate, year) {
      const months = [];
      const d = new Date(startDate);
      const startYear = d.getFullYear();
      const startMonth = d.getMonth(); // 0-indexed
      
      const eYear = endDate ? new Date(endDate).getFullYear() : null;
      const eMonth = endDate ? new Date(endDate).getMonth() : null;
      
      for (let m = 0; m < 12; m++) {
        // Check if month is after start date
        const afterStart = startYear < year || (startYear === year && m >= startMonth);
        // Check if month is before end date (if set)
        const beforeEnd = !endDate || eYear > year || (eYear === year && m <= eMonth);
        
        if (afterStart && beforeEnd) {
          months.push(`${year}-${String(m + 1).padStart(2, '0')}`);
        }
      }
      return months;
    }

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

      // Hosting: price is ALWAYS monthly (e.g. 15 or 20 EUR/month)
      // Invoiced yearly. First year = pro-rata (remaining months), next years = 12 months
      const monthlyHostingPrice = deal.hasHosting ? deal.hostingPrice : 0;
      const hostingFullYear = monthlyHostingPrice * 12;
      const hostingMRR = monthlyHostingPrice;

      // Hosting: current year revenue based on start date
      const hostingStart = deal.hostingStartDate || deal.saleDate;
      let hostingCurrentYear = 0;
      let hostingQuarters = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
      
      if (deal.hasHosting && hostingStart) {
        const hasEnded = deal.hostingEndDate && new Date(deal.hostingEndDate) < new Date(currentYear, 0, 1);
        
        if (!hasEnded) {
          // Count active months per quarter in current year
          for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
            const activeMonths = monthsInQuarterFromStart(hostingStart, q, currentYear);
            hostingQuarters[q] = activeMonths * monthlyHostingPrice;
          }
          hostingCurrentYear = Object.values(hostingQuarters).reduce((a, b) => a + b, 0);
        }
      }

      // Upsell monthly: current year calculation
      const upsellStart = deal.saleDate;
      let upsellCurrentYear = 0;
      let upsellQuarters = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
      
      if (upsellMonthly > 0) {
        for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
          const activeMonths = monthsInQuarterFromStart(upsellStart, q, currentYear);
          upsellQuarters[q] = activeMonths * upsellMonthly;
        }
        upsellCurrentYear = Object.values(upsellQuarters).reduce((a, b) => a + b, 0);
      }

      const upsellMonthlyYearly = upsellMonthly * 12;

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
        hostingPrice: deal.hostingPrice,
        hostingInterval: deal.hostingInterval,
        hostingFullYear,
        hostingMRR,
        hostingCurrentYear,
        hostingQuarters,
        hostingStartDate: hostingStart,
        upsellCurrentYear,
        upsellQuarters,
        totalValue: deal.totalValue,
        upsellNames: deal.upsells.map(u => u.upsell.name)
      };
    });

    // Filter: deals sold in selected year (for one-time revenue)
    const dealsInYear = perDeal.filter(d => new Date(d.saleDate).getFullYear() === currentYear);

    // Totals breakdown
    const totOneTime = dealsInYear.reduce((s, d) => s + d.pkgOneTime, 0);
    const totUpsellOneTime = dealsInYear.reduce((s, d) => s + d.upsellOneTime, 0);
    const totDiscount = dealsInYear.reduce((s, d) => s + d.discount, 0);
    const totHostingFullYear = perDeal.reduce((s, d) => s + d.hostingFullYear, 0);
    const totHostingCurrentYear = perDeal.reduce((s, d) => s + d.hostingCurrentYear, 0);
    const totHostingMRR = perDeal.reduce((s, d) => s + d.hostingMRR, 0);
    const totUpsellMRR = perDeal.reduce((s, d) => s + d.upsellMonthly, 0);
    const totUpsellCurrentYear = perDeal.reduce((s, d) => s + d.upsellCurrentYear, 0);
    const totUpsellMonthlyYearly = perDeal.reduce((s, d) => s + d.upsellMonthlyYearly, 0);

    // Total package revenue from ALL years (not just current year)
    const totalPackagesAllTime = perDeal.reduce((s, d) => s + d.pkgOneTime, 0);
    const totalDiscountsAllTime = perDeal.reduce((s, d) => s + d.discount, 0);
    const totalPackageNetto = totalPackagesAllTime - totalDiscountsAllTime;

    // Year revenue = one-time (only deals sold this year) + hosting this year + upsells this year
    const eenmaligNetto = totOneTime + totUpsellOneTime - totDiscount;
    const totalRevenue = eenmaligNetto + totHostingCurrentYear + totUpsellCurrentYear;
    const totalCost = dealsInYear.reduce((s, d) => s + d.acquisitionCost, 0);
    const roi = totalCost > 0 ? (((totalRevenue - totalCost) / totalCost) * 100).toFixed(1) : 0;
    const totalClients = dealsInYear.length;
    const avgDeal = totalClients > 0 ? totalRevenue / totalClients : 0;

    // Quarter totals for current year
    const quarterTotals = { Q1: { hosting: 0, upsells: 0, eenmalig: 0 }, Q2: { hosting: 0, upsells: 0, eenmalig: 0 }, Q3: { hosting: 0, upsells: 0, eenmalig: 0 }, Q4: { hosting: 0, upsells: 0, eenmalig: 0 } };
    perDeal.forEach(d => {
      for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
        quarterTotals[q].hosting += d.hostingQuarters[q];
        quarterTotals[q].upsells += d.upsellQuarters[q];
      }
      // One-time revenue falls in the quarter of the sale date
      const saleMonth = new Date(d.saleDate).getMonth();
      const saleYear = new Date(d.saleDate).getFullYear();
      if (saleYear === currentYear) {
        const saleQ = getQuarter(saleMonth);
        quarterTotals[saleQ].eenmalig += (d.pkgOneTime + d.upsellOneTime - d.discount);
      }
    });

    // Monthly breakdown per type (hosting and monthly upsells distributed across active months)
    const monthlyBreakdown = {};
    
    // Initialize all 12 months for the current year
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${currentYear}-${String(m).padStart(2, '0')}`;
      monthlyBreakdown[monthKey] = { eenmalig: 0, hosting: 0, upsells: 0, korting: 0, total: 0 };
    }
    
    // Process all active deals (not just deals sold this year) for recurring revenue
    perDeal.forEach(d => {
      // One-time revenue only in sale month
      const saleYear = new Date(d.saleDate).getFullYear();
      if (saleYear === currentYear) {
        const saleMonth = d.saleDate.toISOString().slice(0, 7);
        monthlyBreakdown[saleMonth].eenmalig += d.pkgOneTime;
        monthlyBreakdown[saleMonth].upsells += d.upsellOneTime; // one-time upsells
        monthlyBreakdown[saleMonth].korting += d.discount;
      }
      
      // Hosting: distribute monthly price across all active months
      if (d.hasHosting && d.hostingMRR > 0) {
        const hostingStart = d.hostingStartDate || d.saleDate;
        const activeHostingMonths = getActiveMonths(hostingStart, d.hostingEndDate, currentYear);
        activeHostingMonths.forEach(month => {
          monthlyBreakdown[month].hosting += d.hostingMRR;
        });
      }
      
      // Monthly upsells: distribute across all active months from sale date
      if (d.upsellMonthly > 0) {
        const activeUpsellMonths = getActiveMonths(d.saleDate, null, currentYear); // upsells don't have end date
        activeUpsellMonths.forEach(month => {
          monthlyBreakdown[month].upsells += d.upsellMonthly;
        });
      }
    });
    
    // Calculate totals per month
    Object.keys(monthlyBreakdown).forEach(month => {
      const m = monthlyBreakdown[month];
      m.total = m.eenmalig + m.hosting + m.upsells - m.korting;
    });

    // Package breakdown (deals sold in selected year)
    const packageBreakdown = {};
    dealsInYear.forEach(d => {
      if (!packageBreakdown[d.packageName]) packageBreakdown[d.packageName] = { count: 0, eenmalig: 0, hosting: 0, total: 0 };
      packageBreakdown[d.packageName].count++;
      packageBreakdown[d.packageName].eenmalig += d.pkgOneTime;
      packageBreakdown[d.packageName].hosting += d.hostingCurrentYear;
      packageBreakdown[d.packageName].total += (d.pkgOneTime + d.upsellOneTime - d.discount) + d.hostingCurrentYear + d.upsellCurrentYear;
    });

    // Upsell breakdown (deals sold in selected year)
    const upsellBreakdown = {};
    const dealsInYearIds = new Set(dealsInYear.map(d => d.id));
    deals.filter(deal => dealsInYearIds.has(deal.id)).forEach(deal => {
      deal.upsells.forEach(u => {
        const name = u.upsell.name;
        if (!upsellBreakdown[name]) upsellBreakdown[name] = { count: 0, revenue: 0, type: u.upsell.billingType, price: u.upsell.price };
        upsellBreakdown[name].count++;
        if (u.upsell.billingType === 'ONE_TIME') {
          upsellBreakdown[name].revenue += u.upsell.price;
        } else {
          const months = remainingMonthsInYear(deal.saleDate, currentYear);
          upsellBreakdown[name].revenue += u.upsell.price * months;
        }
      });
    });

    // Channel breakdown (deals sold in selected year)
    const flyerDeals = dealsInYear.filter(d => d.acquisitionType === 'flyer');
    const warmDeals = dealsInYear.filter(d => d.acquisitionType !== 'flyer');
    const flyerRevenue = flyerDeals.reduce((s, d) => (s + (d.pkgOneTime + d.upsellOneTime - d.discount) + d.hostingCurrentYear + d.upsellCurrentYear), 0);
    const flyerCost = flyerDeals.reduce((s, d) => s + d.acquisitionCost, 0);
    const warmRevenue = warmDeals.reduce((s, d) => (s + (d.pkgOneTime + d.upsellOneTime - d.discount) + d.hostingCurrentYear + d.upsellCurrentYear), 0);
    const warmCost = warmDeals.reduce((s, d) => s + d.acquisitionCost, 0);

    res.json({
      currentYear,
      // Summary totals
      totalRevenue, totalCost, roi, totalClients, avgDeal,
      // Breakdown totals
      breakdown: {
        eenmalig: totOneTime,
        totalPackageNetto: totalPackageNetto,
        upsellOneTime: totUpsellOneTime,
        upsellMonthlyYearly: totUpsellMonthlyYearly,
        discount: totDiscount,
        hostingFullYear: totHostingFullYear,
        hostingCurrentYear: totHostingCurrentYear,
        actualMRR: totHostingMRR,
        upsellMRR: totUpsellMRR,
        upsellCurrentYear: totUpsellCurrentYear
      },
      // Quarter breakdown for current year
      quarters: quarterTotals,
      // Monthly stacked
      monthlyBreakdown: Object.entries(monthlyBreakdown).map(([month, data]) => ({ month, ...data })),
      // Backward compatible for dashboard
      monthlyRevenue: Object.entries(monthlyBreakdown).map(([month, data]) => ({ month, revenue: data.total })),
      // Package breakdown
      packageBreakdown: Object.entries(packageBreakdown).map(([name, data]) => ({ name, ...data })),
      packageRevenue: Object.entries(packageBreakdown).map(([name, data]) => ({ name, revenue: data.total })),
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

    function buildLocationStats(filteredLeads, isPipelineOnly = false) {
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

        // Only count as 'verstuurd' if it's a cold/flyer lead (not warm CRM leads)
        // For pipeline-only mode (all cold/flyer), count all non-NEW statuses
        // For mixed mode (all leads), only count if source is cold/flyer
        const isColdLead = isPipelineOnly || (lead.source && (lead.source === 'cold' || lead.source === 'flyer'));
        
        if (isColdLead && ['VERSTUURD', 'GEEN_REACTIE', 'GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'].includes(lead.status)) {
          locationStats[city].verstuurd++;
        }
        if (isColdLead && ['GEREAGEERD', 'AFSPRAAK', 'KLANT', 'NIET_GEINTERESSEERD'].includes(lead.status)) {
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
      all: buildLocationStats(leads, false),
      flyer: buildLocationStats(flyerLeads, true),
      warm: buildLocationStats(warmLeads, true)
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
    const selectedYear = req.query.year ? parseInt(req.query.year) : now.getFullYear();
    const currentYear = selectedYear;
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    // Quarter helpers
    function getQuarter(month) {
      if (month < 3) return 'Q1';
      if (month < 6) return 'Q2';
      if (month < 9) return 'Q3';
      return 'Q4';
    }
    
    function monthsInQuarterFromStart(startDate, endDate, quarter, year) {
      const qRanges = { Q1: [0,1,2], Q2: [3,4,5], Q3: [6,7,8], Q4: [9,10,11] };
      const months = qRanges[quarter];
      const d = new Date(startDate);
      const startYear = d.getFullYear();
      const startMonth = d.getMonth();
      const eYear = endDate ? new Date(endDate).getFullYear() : null;
      const eMonth = endDate ? new Date(endDate).getMonth() : null;
      if (startYear > year) return 0;
      let count = 0;
      for (const m of months) {
        const afterStart = startYear < year || (startYear === year && m >= startMonth);
        const beforeEnd = !endDate || eYear > year || (eYear === year && m <= eMonth);
        if (afterStart && beforeEnd) count++;
      }
      return count;
    }

    // Filter: only deals with hosting active during the selected year
    const activeDeals = deals.filter(d => {
      const hostingStart = d.hostingStartDate || d.saleDate;
      if (!hostingStart) return false;
      const start = new Date(hostingStart);
      // Hosting must have started before end of selected year
      if (start > yearEnd) return false;
      // Hosting must not have ended before start of selected year
      if (d.hostingEndDate && new Date(d.hostingEndDate) < yearStart) return false;
      return true;
    });

    const totalClients = activeDeals.length;
    // Hosting price is always monthly (e.g. 15 or 20 EUR/month)
    const totalMRR = activeDeals.reduce((sum, d) => sum + d.hostingPrice, 0);

    // Calculate current year revenue per client with quarters
    const quarterTotals = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    let totalCurrentYear = 0;

    const needsInvoicing = activeDeals.filter(d => d.nextInvoiceDate && new Date(d.nextInvoiceDate) <= now);
    const expiringSoon = activeDeals.filter(d => d.hostingEndDate && new Date(d.hostingEndDate) <= in30Days && new Date(d.hostingEndDate) > now);
    const upcomingInvoices = activeDeals.filter(d => d.nextInvoiceDate && new Date(d.nextInvoiceDate) > now && new Date(d.nextInvoiceDate) <= in30Days);

    const clients = activeDeals.map(d => {
      const hostingStart = d.hostingStartDate || d.saleDate;
      
      let clientCurrentYear = 0;
      let clientQuarters = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
      
      // Always calculate based on monthly price x active months per quarter
      for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
        const activeMonths = monthsInQuarterFromStart(hostingStart, d.hostingEndDate, q, currentYear);
        clientQuarters[q] = activeMonths * d.hostingPrice;
      }
      clientCurrentYear = Object.values(clientQuarters).reduce((a, b) => a + b, 0);
      
      // Add to totals
      for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) quarterTotals[q] += clientQuarters[q];
      totalCurrentYear += clientCurrentYear;

      return {
        id: d.id,
        companyName: d.lead.companyName,
        city: d.lead.city,
        packageName: d.package.name,
        hostingPrice: d.hostingPrice,
        hostingInterval: d.hostingInterval,
        hostingStartDate: d.hostingStartDate,
        hostingEndDate: d.hostingEndDate,
        nextInvoiceDate: d.nextInvoiceDate,
        currentYearRevenue: clientCurrentYear,
        yearlyPrice: d.hostingPrice * 12,
        quarters: clientQuarters,
        status: d.hostingEndDate && new Date(d.hostingEndDate) <= now ? 'expired' :
                d.hostingEndDate && new Date(d.hostingEndDate) <= in30Days ? 'expiring' :
                d.nextInvoiceDate && new Date(d.nextInvoiceDate) <= now ? 'overdue' : 'active'
      };
    });

    res.json({
      currentYear,
      totalClients,
      totalMRR,
      totalCurrentYear,
      quarterTotals,
      avgPerClient: totalClients > 0 ? totalMRR / totalClients : 0,
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
