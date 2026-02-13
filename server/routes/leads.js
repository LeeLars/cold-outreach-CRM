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
        { website: { contains: search, mode: 'insensitive' } },
        { contactPerson: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } }
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
    const { companyName, city, address, website, phone, email, contactPerson, status, source, notes } = req.body;
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { companyName, city, address, website, phone, email, contactPerson, status, source, notes }
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

const ENRICH_BATCH_SIZE = 25;
const ENRICH_DELAY_MS = 200;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

router.post('/enrich', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'IDs zijn verplicht' });
    }

    const batchIds = ids.slice(0, ENRICH_BATCH_SIZE);
    const skipped = ids.length - batchIds.length;

    const apiKey = process.env.MAPS_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Google Maps API key niet geconfigureerd' });

    const leads = await prisma.lead.findMany({ where: { id: { in: batchIds } } });
    let enriched = 0;
    const results = [];

    for (const lead of leads) {
      try {
        await delay(ENRICH_DELAY_MS);

        const query = lead.city ? `${lead.companyName} ${lead.city} Belgium` : `${lead.companyName} Belgium`;
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=be&language=nl&key=${apiKey}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();

        if (searchData.status !== 'OK' || searchData.results.length === 0) {
          results.push({ id: lead.id, name: lead.companyName, status: 'not_found' });
          continue;
        }

        const place = searchData.results[0];
        const updateData = {};

        if (!lead.address && place.formatted_address) {
          updateData.address = place.formatted_address;
        }

        if (place.place_id) {
          await delay(ENRICH_DELAY_MS);
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website&language=nl&key=${apiKey}`;
          const detailRes = await fetch(detailUrl);
          const detailData = await detailRes.json();

          if (detailData.status === 'OK' && detailData.result) {
            if (!lead.phone && detailData.result.formatted_phone_number) {
              updateData.phone = detailData.result.formatted_phone_number;
            }
            if (!lead.website && detailData.result.website) {
              updateData.website = detailData.result.website;
            }
          }
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.lead.update({ where: { id: lead.id }, data: updateData });
          enriched++;
          results.push({ id: lead.id, name: lead.companyName, status: 'enriched', fields: Object.keys(updateData) });
        } else {
          results.push({ id: lead.id, name: lead.companyName, status: 'no_new_data' });
        }
      } catch (e) {
        console.error(`Enrich error for ${lead.companyName}:`, e.message);
        results.push({ id: lead.id, name: lead.companyName, status: 'error' });
      }
    }

    const msg = skipped > 0
      ? `${enriched} van ${leads.length} leads verrijkt (${skipped} overgeslagen, max ${ENRICH_BATCH_SIZE} per keer)`
      : `${enriched} van ${leads.length} leads verrijkt`;

    res.json({ message: msg, enriched, total: leads.length, skipped, batchSize: ENRICH_BATCH_SIZE, results });
  } catch (err) {
    next(err);
  }
});

router.post('/auto-expire', async (req, res, next) => {
  try {
    const { days = 7 } = req.body;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await prisma.lead.updateMany({
      where: {
        status: 'VERSTUURD',
        updatedAt: { lt: cutoff }
      },
      data: { status: 'GEEN_REACTIE' }
    });

    res.json({ message: `${result.count} leads naar 'Geen reactie' gezet`, count: result.count });
  } catch (err) {
    next(err);
  }
});

router.get('/duplicates', async (req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({
      select: { id: true, companyName: true, city: true, status: true, createdAt: true }
    });

    const groups = {};
    for (const lead of leads) {
      const key = lead.companyName.trim().toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(lead);
    }

    const duplicates = Object.entries(groups)
      .filter(([, items]) => items.length > 1)
      .map(([name, items]) => ({
        companyName: items[0].companyName,
        count: items.length,
        leads: items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      }));

    res.json({ duplicates, totalGroups: duplicates.length, totalDuplicates: duplicates.reduce((s, d) => s + d.count - 1, 0) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
