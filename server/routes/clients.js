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

// Update client
router.put('/:id', async (req, res, next) => {
  try {
    const { companyName, vatNumber, contactPerson, email, phone, address, city, website, notes } = req.body;

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

    res.json(client);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
