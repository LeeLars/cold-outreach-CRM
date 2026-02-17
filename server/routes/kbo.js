const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/lookup/:vatNumber', async (req, res, next) => {
  try {
    let vatNumber = req.params.vatNumber.replace(/[.\s]/g, '').replace(/^BE/i, '').trim();
    
    if (vatNumber.length === 9) {
      vatNumber = '0' + vatNumber;
    }
    
    if (vatNumber.length !== 10 || !/^\d+$/.test(vatNumber)) {
      return res.status(400).json({ error: 'Ongeldig BTW nummer. Gebruik formaat: BE0123.456.789 of 0123456789' });
    }

    const apiToken = process.env.CBEAPI_TOKEN;
    
    const headers = {
      'Accept': 'application/json',
      'Accept-Language': 'nl'
    };
    
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    }

    const response = await fetch(`https://cbeapi.be/api/v1/company/${vatNumber}`, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Bedrijf niet gevonden voor dit BTW nummer' });
      }
      return res.status(response.status).json({ error: 'Fout bij opzoeken BTW nummer' });
    }

    const result = await response.json();
    const company = result.data;

    if (!company) {
      return res.status(404).json({ error: 'Geen bedrijfsgegevens gevonden' });
    }

    const address = company.address || {};
    const contact = company.contact_infos || {};

    const fullAddress = [
      address.street,
      address.street_number,
      address.box ? `bus ${address.box}` : null
    ].filter(Boolean).join(' ');

    const companyData = {
      vatNumber: `BE${vatNumber}`,
      vatNumberFormatted: company.cbe_number_formatted ? `BE ${company.cbe_number_formatted}` : `BE${vatNumber}`,
      companyName: company.denomination || company.commercial_name || company.abbreviation || '',
      commercialName: company.commercial_name || '',
      abbreviation: company.abbreviation || '',
      legalForm: company.juridical_form_short || company.juridical_form || '',
      address: fullAddress || '',
      postCode: address.post_code || '',
      city: address.city || '',
      phone: contact.phone || '',
      email: contact.email || '',
      website: contact.web || '',
      status: company.status || '',
      startDate: company.start_date || '',
      naceActivities: company.nace_activities || []
    };

    res.json(companyData);
  } catch (err) {
    console.error('KBO lookup error:', err);
    next(err);
  }
});

module.exports = router;
