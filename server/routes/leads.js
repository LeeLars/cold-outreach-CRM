const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { normalizeCity } = require('../utils/normalize');
const { distance } = require('fastest-levenshtein');

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

router.post('/', async (req, res, next) => {
  try {
    const { companyName, vatNumber, city, address, website, phone, email, contactPerson, source, notes } = req.body;
    
    if (!companyName) {
      return res.status(400).json({ error: 'Bedrijfsnaam is verplicht' });
    }

    const lead = await prisma.lead.create({
      data: {
        companyName,
        vatNumber: vatNumber || null,
        city: normalizeCity(city),
        address: address || null,
        website: website || null,
        phone: phone || null,
        email: email || null,
        contactPerson: contactPerson || null,
        source: source || null,
        notes: notes || null,
        status: 'NIEUW',
        createdById: req.session.userId
      }
    });

    res.status(201).json(lead);
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
    const { companyName, vatNumber, city, address, website, phone, email, contactPerson, status, source, notes } = req.body;
    const normalizedCity = normalizeCity(city);
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { 
        companyName, 
        vatNumber,
        city: normalizedCity, 
        address, 
        website, 
        phone, 
        email, 
        contactPerson, 
        status, 
        source, 
        notes 
      },
      include: { deal: { select: { client: { select: { id: true } } } } }
    });

    // Sync client data if this lead has a client
    if (lead.deal && lead.deal.client) {
      await prisma.client.update({
        where: { id: lead.deal.client.id },
        data: {
          companyName,
          vatNumber,
          contactPerson,
          email,
          phone,
          address,
          city: normalizedCity,
          website,
          notes
        }
      });
    }

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

    // First delete related records that depend on deals/leads
    // DealUpsells -> Clients -> Deals -> Appointments are all cascade from Lead
    // But deleteMany doesn't trigger cascades, so we need to clean up manually
    const leads = await prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, deal: { select: { id: true } } }
    });

    const dealIds = leads.filter(l => l.deal).map(l => l.deal.id);

    if (dealIds.length > 0) {
      await prisma.dealUpsell.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.client.deleteMany({ where: { dealId: { in: dealIds } } });
      await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
    }

    await prisma.appointment.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: { in: ids } } });

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
      const cityValue = record.gemeente || record.city || record.Gemeente || record.stad || '';
      records.push({
        companyName: record.bedrijfsnaam || record.companyName || record.Bedrijfsnaam || '',
        city: normalizeCity(cityValue),
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
      const cityValue = record.gemeente || record.city || record.Gemeente || record.stad || '';
      records.push({
        companyName: record.bedrijfsnaam || record.companyName || record.Bedrijfsnaam || '',
        city: normalizeCity(cityValue),
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

// --- Envelope scanning ---

function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return ((maxLen - distance(na, nb)) / maxLen) * 100;
}

function extractAddressFromBlock(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let companyName = '';
  let street = '';
  let city = '';
  let postalCode = '';

  for (const line of lines) {
    const postalMatch = line.match(/(\d{4})\s+([A-Za-zÀ-ÿ\s\-]+)/);
    if (postalMatch) {
      postalCode = postalMatch[1];
      city = postalMatch[2].trim();
      continue;
    }

    const streetMatch = line.match(/^(.+?)\s+(\d+\s*[A-Za-z]?\s*(?:bus\s*\d+)?)$/i);
    if (streetMatch && !street) {
      street = line;
      continue;
    }

    if (!companyName) {
      companyName = line;
    }
  }

  if (!companyName && lines.length > 0) {
    companyName = lines[0];
  }

  return { companyName, street, city, postalCode, rawLines: lines };
}

function extractMultipleAddresses(annotations) {
  if (!annotations || annotations.length < 2) {
    const fullText = annotations?.[0]?.description || '';
    return [extractAddressFromBlock(fullText)];
  }

  const wordAnnotations = annotations.slice(1);

  const imageWidth = Math.max(...wordAnnotations.map(a => {
    const verts = a.boundingPoly?.vertices || [];
    return Math.max(...verts.map(v => v.x || 0));
  }));

  if (imageWidth === 0) {
    return [extractAddressFromBlock(annotations[0].description)];
  }

  const clusters = [];
  const GAP_THRESHOLD = imageWidth * 0.08;

  const wordsByX = wordAnnotations.map(a => {
    const verts = a.boundingPoly?.vertices || [];
    const xs = verts.map(v => v.x || 0);
    const ys = verts.map(v => v.y || 0);
    return {
      text: a.description,
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      xCenter: (Math.min(...xs) + Math.max(...xs)) / 2,
      yMin: Math.min(...ys),
      yMax: Math.max(...ys)
    };
  }).sort((a, b) => a.xCenter - b.xCenter);

  let currentCluster = [wordsByX[0]];
  for (let i = 1; i < wordsByX.length; i++) {
    const prev = currentCluster[currentCluster.length - 1];
    const curr = wordsByX[i];

    const clusterMaxX = Math.max(...currentCluster.map(w => w.xMax));
    const clusterMinX = Math.min(...currentCluster.map(w => w.xMin));

    if (curr.xMin > clusterMaxX + GAP_THRESHOLD && 
        curr.xCenter > clusterMaxX) {
      clusters.push(currentCluster);
      currentCluster = [curr];
    } else {
      currentCluster.push(curr);
    }
  }
  clusters.push(currentCluster);

  if (clusters.length <= 1) {
    return [extractAddressFromBlock(annotations[0].description)];
  }

  return clusters.map(cluster => {
    const sorted = [...cluster].sort((a, b) => {
      if (Math.abs(a.yMin - b.yMin) < 8) return a.xMin - b.xMin;
      return a.yMin - b.yMin;
    });

    const lineGroups = [];
    let currentLine = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prevY = currentLine[0].yMin;
      if (Math.abs(sorted[i].yMin - prevY) < 12) {
        currentLine.push(sorted[i]);
      } else {
        lineGroups.push(currentLine.map(w => w.text).join(' '));
        currentLine = [sorted[i]];
      }
    }
    lineGroups.push(currentLine.map(w => w.text).join(' '));

    const blockText = lineGroups.join('\n');
    return extractAddressFromBlock(blockText);
  }).filter(addr => addr.companyName || addr.city);
}

function matchLeadToOcr(extracted, leads) {
  let bestMatch = null;
  let bestScore = 0;

  for (const lead of leads) {
    let score = 0;
    let factors = 0;

    if (extracted.companyName && lead.companyName) {
      const nameSim = similarity(extracted.companyName, lead.companyName);
      score += nameSim * 3;
      factors += 3;
    }

    if (extracted.city && lead.city) {
      const citySim = similarity(extracted.city, lead.city);
      score += citySim * 2;
      factors += 2;
    }

    if (extracted.street && lead.address) {
      const addrSim = similarity(extracted.street, lead.address);
      score += addrSim * 1;
      factors += 1;
    }

    const finalScore = factors > 0 ? score / factors : 0;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestMatch = lead;
    }
  }

  return { lead: bestMatch, confidence: Math.round(bestScore * 10) / 10 };
}

router.post('/scan-envelopes', upload.array('images', 50), async (req, res, next) => {
  try {
    const apiKey = process.env.VISION_KEY || process.env.MAPS_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'Google Vision API key niet geconfigureerd (VISION_KEY of MAPS_KEY)' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Geen afbeeldingen geupload' });
    }

    const leads = await prisma.lead.findMany({
      where: { status: 'NIEUW' },
      select: { id: true, companyName: true, city: true, address: true }
    });

    const results = await Promise.all(req.files.map(async (file) => {
      try {
        const base64 = file.buffer.toString('base64');

        const visionRes = await fetch(
          `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{
                image: { content: base64 },
                features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
              }]
            })
          }
        );

        const visionData = await visionRes.json();

        if (visionData.error) {
          return [{
            fileName: file.originalname,
            status: 'ocr_failed',
            error: visionData.error.message,
            ocrText: '',
            extracted: {},
            matchedLead: null,
            confidence: 0
          }];
        }

        const annotations = visionData.responses?.[0]?.textAnnotations;
        if (!annotations || annotations.length === 0) {
          return [{
            fileName: file.originalname,
            status: 'ocr_failed',
            error: 'Geen tekst gevonden op afbeelding',
            ocrText: '',
            extracted: {},
            matchedLead: null,
            confidence: 0
          }];
        }

        const ocrText = annotations[0].description;
        const addresses = extractMultipleAddresses(annotations);

        return addresses.map((extracted, idx) => {
          const { lead, confidence } = matchLeadToOcr(extracted, leads);
          const label = addresses.length > 1
            ? `${file.originalname} (#${idx + 1})`
            : file.originalname;

          return {
            fileName: label,
            status: lead && confidence >= 60 ? 'matched' : 'no_match',
            ocrText: extracted.rawLines.join('\n'),
            extracted: {
              companyName: extracted.companyName,
              city: extracted.city,
              street: extracted.street
            },
            matchedLead: lead ? {
              id: lead.id,
              companyName: lead.companyName,
              city: lead.city,
              address: lead.address
            } : null,
            confidence
          };
        });
      } catch (err) {
        return [{
          fileName: file.originalname,
          status: 'ocr_failed',
          error: err.message,
          ocrText: '',
          extracted: {},
          matchedLead: null,
          confidence: 0
        }];
      }
    }));

    const flatResults = results.flat();
    const matched = flatResults.filter(r => r.status === 'matched').length;
    const noMatch = flatResults.filter(r => r.status === 'no_match').length;
    const failed = flatResults.filter(r => r.status === 'ocr_failed').length;

    res.json({
      results: flatResults,
      summary: { total: flatResults.length, matched, noMatch, failed }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/confirm-scanned', async (req, res, next) => {
  try {
    const { leadIds } = req.body;
    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ error: 'Geen lead IDs opgegeven' });
    }

    await prisma.lead.updateMany({
      where: {
        id: { in: leadIds },
        status: 'NIEUW'
      },
      data: { status: 'VERSTUURD' }
    });

    res.json({ message: `${leadIds.length} leads als verstuurd gemarkeerd` });
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

module.exports = router;
