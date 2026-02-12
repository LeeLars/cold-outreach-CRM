function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Niet ingelogd' });
  }
  if (req.session.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Geen toegang' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
