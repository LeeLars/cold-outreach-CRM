const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const packages = await prisma.package.findMany({
      where: { isArchived: false },
      orderBy: { oneTimePrice: 'asc' }
    });
    res.json(packages);
  } catch (err) {
    next(err);
  }
});

router.get('/upsells', async (req, res, next) => {
  try {
    const upsells = await prisma.upsell.findMany({
      where: { isArchived: false },
      orderBy: { name: 'asc' }
    });
    res.json(upsells);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, oneTimePrice, monthlyPrice = 20, costPrice = 0 } = req.body;
    if (!name || oneTimePrice === undefined) {
      return res.status(400).json({ error: 'Naam en prijs zijn verplicht' });
    }
    const pkg = await prisma.package.create({
      data: { name, oneTimePrice: parseFloat(oneTimePrice), monthlyPrice: parseFloat(monthlyPrice), costPrice: parseFloat(costPrice) }
    });
    res.status(201).json(pkg);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, oneTimePrice, monthlyPrice, costPrice, isArchived } = req.body;
    const pkg = await prisma.package.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(oneTimePrice !== undefined && { oneTimePrice: parseFloat(oneTimePrice) }),
        ...(monthlyPrice !== undefined && { monthlyPrice: parseFloat(monthlyPrice) }),
        ...(costPrice !== undefined && { costPrice: parseFloat(costPrice) }),
        ...(isArchived !== undefined && { isArchived })
      }
    });
    res.json(pkg);
  } catch (err) {
    next(err);
  }
});

router.post('/upsells', requireAdmin, async (req, res, next) => {
  try {
    const { name, price, billingType, costPrice = 0 } = req.body;
    if (!name || price === undefined || !billingType) {
      return res.status(400).json({ error: 'Naam, prijs en type zijn verplicht' });
    }
    const upsell = await prisma.upsell.create({
      data: { name, price: parseFloat(price), billingType, costPrice: parseFloat(costPrice) }
    });
    res.status(201).json(upsell);
  } catch (err) {
    next(err);
  }
});

router.put('/upsells/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, price, billingType, costPrice, isArchived } = req.body;
    const upsell = await prisma.upsell.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(costPrice !== undefined && { costPrice: parseFloat(costPrice) }),
        ...(billingType !== undefined && { billingType }),
        ...(isArchived !== undefined && { isArchived })
      }
    });
    res.json(upsell);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
