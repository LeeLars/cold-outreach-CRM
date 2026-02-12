const express = require('express');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

router.use(requireAuth);

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, lastLogin: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, email, password, role = 'EMPLOYEE' } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Naam, e-mail en wachtwoord zijn verplicht' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'E-mailadres is al in gebruik' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, email, role, password } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (role !== undefined) data.role = role;
    if (password) data.password = await bcrypt.hash(password, 12);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.session.userId) {
      return res.status(400).json({ error: 'Je kunt jezelf niet verwijderen' });
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'Gebruiker verwijderd' });
  } catch (err) {
    next(err);
  }
});

router.put('/account/update', async (req, res, next) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    const data = {};

    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Huidig wachtwoord is verplicht' });
      }
      const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return res.status(401).json({ error: 'Huidig wachtwoord is onjuist' });
      }
      data.password = await bcrypt.hash(newPassword, 12);
    }

    const updated = await prisma.user.update({
      where: { id: req.session.userId },
      data,
      select: { id: true, name: true, email: true, role: true }
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
