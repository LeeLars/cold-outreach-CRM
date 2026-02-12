const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { website: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { name: true } } }
      }),
      prisma.lead.count({ where })
    ]);

    res.json({
      leads,
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
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { name: true } },
        deal: {
          include: {
            package: true,
            upsells: { include: { upsell: true } }
          }
        }
      }
    });
    if (!lead) {
      return res.status(404).json({ error: 'Lead niet gevonden' });
    }
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { companyName, city, website, status, notes } = req.body;
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { companyName, city, website, status, notes }
    });
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { status }
    });
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

router.post('/bulk-status', async (req, res, next) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || !status) {
      return res.status(400).json({ error: 'IDs en status zijn verplicht' });
    }
    await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { status }
    });
    res.json({ message: `${ids.length} leads bijgewerkt` });
  } catch (err) {
    next(err);
  }
});

router.delete('/bulk', async (req, res, next) => {
  try {
    if (req.session.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Geen toegang' });
    }
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'IDs zijn verplicht' });
    }
    await prisma.lead.deleteMany({
      where: { id: { in: ids } }
    });
    res.json({ message: `${ids.length} leads verwijderd` });
  } catch (err) {
    next(err);
  }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Geen bestand geupload' });
    }

    const records = [];
    const parser = parse(req.file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    for await (const record of parser) {
      records.push({
        companyName: record.bedrijfsnaam || record.companyName || record.Bedrijfsnaam || '',
        city: record.gemeente || record.city || record.Gemeente || record.stad || '',
        website: record.website || record.Website || '',
        status: 'NIEUW',
        createdById: req.session.userId
      });
    }

    const validRecords = records.filter(r => r.companyName);

    if (validRecords.length === 0) {
      return res.status(400).json({ error: 'Geen geldige records gevonden' });
    }

    await prisma.lead.createMany({ data: validRecords });

    res.json({
      message: `${validRecords.length} leads geimporteerd`,
      count: validRecords.length
    });
  } catch (err) {
    next(err);
  }
});

router.post('/import/preview', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Geen bestand geupload' });
    }

    const records = [];
    const parser = parse(req.file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    for await (const record of parser) {
      records.push({
        companyName: record.bedrijfsnaam || record.companyName || record.Bedrijfsnaam || '',
        city: record.gemeente || record.city || record.Gemeente || record.stad || '',
        website: record.website || record.Website || ''
      });
    }

    res.json({
      records: records.slice(0, 20),
      total: records.length
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
