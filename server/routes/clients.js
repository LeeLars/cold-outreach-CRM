const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

router.use(requireAuth);

// Get all clients
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          deal: {
            include: {
              package: true,
              upsells: { include: { upsell: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.client.count({ where })
    ]);

    res.json({
      clients,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    next(err);
  }
});

// Get single client
router.get('/:id', async (req, res, next) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        deal: {
          include: {
            lead: true,
            package: true,
            upsells: { include: { upsell: true } }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'Klant niet gevonden' });
    }

    res.json(client);
  } catch (err) {
    next(err);
  }
});

// Create new client
router.post('/', async (req, res, next) => {
  try {
    const { 
      companyName, vatNumber, contactPerson, email, phone, address, city, website, notes,
      hasHosting = false, hostingPrice = 20, hostingInterval = 'MONTHLY', hostingStartDate
    } = req.body;

    if (!companyName) {
      return res.status(400).json({ error: 'Bedrijfsnaam is verplicht' });
    }

    // Create a lead first (required for deal relationship)
    const lead = await prisma.lead.create({
      data: {
        companyName,
        vatNumber,
        contactPerson,
        email,
        phone,
        address,
        city,
        website,
        notes,
        source: 'CRM',
        status: 'KLANT',
        createdById: req.session.userId
      }
    });

    // Get or create a default package for direct clients
    let defaultPackage = await prisma.package.findFirst({
      where: { name: 'Direct klant' }
    });

    if (!defaultPackage) {
      defaultPackage = await prisma.package.create({
        data: {
          name: 'Direct klant',
          oneTimePrice: 0,
          monthlyPrice: hasHosting ? (parseFloat(hostingPrice) || 20) : 0,
          description: 'Standaard pakket voor directe klanten'
        }
      });
    }

    // Create deal (required before client since client needs dealId)
    const saleDateObj = new Date();
    const start = hostingStartDate ? new Date(hostingStartDate) : saleDateObj;
    let nextInvoice = null;
    
    if (hasHosting) {
      nextInvoice = new Date(start);
      if (hostingInterval === 'YEARLY') {
        nextInvoice.setFullYear(nextInvoice.getFullYear() + 1);
      } else {
        nextInvoice.setMonth(nextInvoice.getMonth() + 1);
      }
    }

    const hostingMonthly = hasHosting ? (parseFloat(hostingPrice) || 20) : 0;
    const totalValue = hostingMonthly * 12;

    const deal = await prisma.deal.create({
      data: {
        leadId: lead.id,
        packageId: defaultPackage.id,
        acquisitionCost: 0,
        acquisitionType: 'none',
        totalValue,
        saleDate: saleDateObj,
        hasHosting,
        hostingPrice: hostingMonthly,
        hostingInterval: hostingInterval || 'MONTHLY',
        hostingStartDate: hasHosting ? start : null,
        hostingEndDate: null,
        nextInvoiceDate: nextInvoice
      }
    });

    // Now create client with the dealId
    const client = await prisma.client.create({
      data: {
        companyName,
        vatNumber,
        contactPerson,
        email,
        phone,
        address,
        city,
        website,
        notes,
        dealId: deal.id
      }
    });

    // Return client with deal info
    const clientWithDeal = await prisma.client.findUnique({
      where: { id: client.id },
      include: {
        deal: {
          include: {
            package: true
          }
        }
      }
    });

    res.status(201).json(clientWithDeal);
  } catch (err) {
    next(err);
  }
});

// Update client
router.put('/:id', async (req, res, next) => {
  try {
    const { 
      companyName, vatNumber, contactPerson, email, phone, address, city, website, notes,
      hasHosting = false, hostingPrice = 20, hostingInterval = 'MONTHLY', hostingStartDate, hostingEndDate
    } = req.body;

    // Update client basic info
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        companyName,
        vatNumber,
        contactPerson,
        email,
        phone,
        address,
        city,
        website,
        notes
      }
    });

    // Handle hosting updates
    const existingDeal = await prisma.deal.findFirst({
      where: { clientId: client.id }
    });

    if (hasHosting) {
      const hostingMonthly = parseFloat(hostingPrice) || 20;
      const start = hostingStartDate ? new Date(hostingStartDate) : new Date();
      let nextInvoice = new Date(start);
      if (hostingInterval === 'YEARLY') {
        nextInvoice.setFullYear(nextInvoice.getFullYear() + 1);
      } else {
        nextInvoice.setMonth(nextInvoice.getMonth() + 1);
      }

      const totalValue = hostingMonthly * 12;

      if (existingDeal) {
        // Update existing deal
        await prisma.deal.update({
          where: { id: existingDeal.id },
          data: {
            hasHosting: true,
            hostingPrice: hostingMonthly,
            hostingInterval,
            hostingStartDate: start,
            hostingEndDate: hostingEndDate ? new Date(hostingEndDate) : null,
            nextInvoiceDate: nextInvoice,
            totalValue
          }
        });
      } else {
        // Create new deal with hosting
        let defaultPackage = await prisma.package.findFirst({
          where: { name: 'Direct klant' }
        });

        if (!defaultPackage) {
          defaultPackage = await prisma.package.create({
            data: {
              name: 'Direct klant',
              oneTimePrice: 0,
              monthlyPrice: hostingMonthly,
              description: 'Standaard pakket voor directe klanten'
            }
          });
        }

        // Find or create lead for this client
        let lead = await prisma.lead.findFirst({
          where: { companyName: client.companyName, status: 'KLANT' }
        });

        if (!lead) {
          lead = await prisma.lead.create({
            data: {
              companyName: client.companyName,
              vatNumber: client.vatNumber,
              contactPerson: client.contactPerson,
              email: client.email,
              phone: client.phone,
              address: client.address,
              city: client.city,
              website: client.website,
              source: 'CRM',
              status: 'KLANT'
            }
          });
        }

        await prisma.deal.create({
          data: {
            leadId: lead.id,
            clientId: client.id,
            packageId: defaultPackage.id,
            acquisitionCost: 0,
            acquisitionType: 'none',
            totalValue,
            saleDate: new Date(),
            hasHosting: true,
            hostingPrice: hostingMonthly,
            hostingInterval,
            hostingStartDate: start,
            hostingEndDate: hostingEndDate ? new Date(hostingEndDate) : null,
            nextInvoiceDate: nextInvoice
          }
        });
      }
    } else if (existingDeal && existingDeal.hasHosting) {
      // Disable hosting if it was previously enabled
      await prisma.deal.update({
        where: { id: existingDeal.id },
        data: {
          hasHosting: false,
          hostingEndDate: new Date()
        }
      });
    }

    // Return updated client with deal info
    const updatedClient = await prisma.client.findUnique({
      where: { id: client.id },
      include: {
        deal: {
          include: {
            package: true
          }
        }
      }
    });

    res.json(updatedClient);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
