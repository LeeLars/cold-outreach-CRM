const express = require('express');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const AVAILABILITY = {
  days: [1, 2, 3, 4, 5, 6],
  startHour: 9,
  endHour: 17,
  slotMinutes: 30
};

function getOAuth2Client() {
  const redirectUri = process.env.NODE_ENV === 'production'
    ? 'https://cold-outreach-crm-production.up.railway.app/api/calendar/callback'
    : process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/calendar/callback';

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

async function getAuthenticatedClient(userId) {
  const token = await prisma.googleToken.findUnique({ where: { userId } });
  if (!token) return null;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt.getTime()
  });

  oauth2Client.on('tokens', async (tokens) => {
    await prisma.googleToken.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token || token.accessToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : token.expiresAt
      }
    });
  });

  return { oauth2Client, calendarId: token.calendarId };
}

router.get('/connect', requireAuth, (req, res) => {
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: req.session.userId
  });
  res.json({ url });
});

router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) {
    return res.status(400).send('Ongeldige callback');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    await prisma.googleToken.upsert({
      where: { userId },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt: new Date(tokens.expiry_date)
      },
      create: {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt: new Date(tokens.expiry_date)
      }
    });

    const redirectBase = process.env.NODE_ENV === 'production'
      ? 'https://leelars.github.io/cold-outreach-CRM/web'
      : '';
    res.redirect(redirectBase + '/settings.html?calendar=connected');
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.status(500).send('Fout bij koppelen Google Calendar');
  }
});

router.get('/status', requireAuth, async (req, res) => {
  const token = await prisma.googleToken.findUnique({
    where: { userId: req.session.userId }
  });
  res.json({ connected: !!token, calendarId: token?.calendarId || 'primary' });
});

router.delete('/disconnect', requireAuth, async (req, res) => {
  await prisma.googleToken.deleteMany({ where: { userId: req.session.userId } });
  res.json({ message: 'Google Calendar ontkoppeld' });
});

router.get('/slots', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Datum is verplicht' });

  const auth = await getAuthenticatedClient(req.session.userId);
  if (!auth) return res.status(400).json({ error: 'Google Calendar niet gekoppeld' });

  const { oauth2Client, calendarId } = auth;
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const dayStart = new Date(date + 'T00:00:00');
  const dayOfWeek = dayStart.getDay();

  if (!AVAILABILITY.days.includes(dayOfWeek)) {
    return res.json({ slots: [], message: 'Geen beschikbaarheid op deze dag' });
  }

  const timeMin = new Date(date + `T${String(AVAILABILITY.startHour).padStart(2, '0')}:00:00`);
  const timeMax = new Date(date + `T${String(AVAILABILITY.endHour).padStart(2, '0')}:00:00`);

  try {
    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: 'Europe/Brussels',
        items: [{ id: calendarId }]
      }
    });

    const busySlots = freeBusy.data.calendars[calendarId]?.busy || [];

    const slots = [];
    let current = new Date(timeMin);

    while (current < timeMax) {
      const slotEnd = new Date(current.getTime() + AVAILABILITY.slotMinutes * 60000);

      const isBusy = busySlots.some(busy => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return current < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        slots.push({
          start: current.toISOString(),
          end: slotEnd.toISOString(),
          label: `${current.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })} - ${slotEnd.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })}`
        });
      }

      current = slotEnd;
    }

    res.json({ slots, date });
  } catch (err) {
    console.error('FreeBusy error:', err);
    res.status(500).json({ error: 'Fout bij ophalen beschikbaarheid' });
  }
});

router.post('/book', requireAuth, async (req, res) => {
  const { leadId, startTime, endTime, title, description } = req.body;

  if (!leadId || !startTime || !endTime) {
    return res.status(400).json({ error: 'Lead, starttijd en eindtijd zijn verplicht' });
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return res.status(404).json({ error: 'Lead niet gevonden' });

  const auth = await getAuthenticatedClient(req.session.userId);
  let googleEventId = null;

  if (auth) {
    const { oauth2Client, calendarId } = auth;
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
      const event = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: title || `Afspraak - ${lead.companyName}`,
          description: description || `Cold outreach afspraak met ${lead.companyName}`,
          start: { dateTime: startTime, timeZone: 'Europe/Brussels' },
          end: { dateTime: endTime, timeZone: 'Europe/Brussels' },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'popup', minutes: 30 },
              { method: 'email', minutes: 60 }
            ]
          }
        }
      });
      googleEventId = event.data.id;
    } catch (err) {
      console.error('Calendar insert error:', err);
    }
  }

  const appointment = await prisma.appointment.create({
    data: {
      leadId,
      title: title || `Afspraak - ${lead.companyName}`,
      description,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      googleEventId,
      createdById: req.session.userId
    },
    include: { lead: true }
  });

  if (lead.status !== 'AFSPRAAK' && lead.status !== 'KLANT') {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'AFSPRAAK' }
    });
  }

  res.json(appointment);
});

router.get('/appointments', requireAuth, async (req, res) => {
  const { leadId } = req.query;
  const where = leadId ? { leadId } : {};

  const appointments = await prisma.appointment.findMany({
    where,
    include: { lead: true, createdBy: { select: { name: true } } },
    orderBy: { startTime: 'desc' }
  });

  res.json(appointments);
});

router.delete('/appointments/:id', requireAuth, async (req, res) => {
  const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!appointment) return res.status(404).json({ error: 'Afspraak niet gevonden' });

  if (appointment.googleEventId) {
    const auth = await getAuthenticatedClient(req.session.userId);
    if (auth) {
      const { oauth2Client, calendarId } = auth;
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      try {
        await calendar.events.delete({ calendarId, eventId: appointment.googleEventId });
      } catch (err) {
        console.error('Calendar delete error:', err);
      }
    }
  }

  await prisma.appointment.delete({ where: { id: req.params.id } });
  res.json({ message: 'Afspraak verwijderd' });
});

module.exports = router;
