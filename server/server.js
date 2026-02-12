require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const leadsRoutes = require('./routes/leads');
const dealsRoutes = require('./routes/deals');
const packagesRoutes = require('./routes/packages');
const statsRoutes = require('./routes/stats');
const usersRoutes = require('./routes/users');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const corsOptions = {
  origin: ['https://leelars.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cold-outreach-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

app.use(express.static(path.join(__dirname, '..', 'web')));

app.use('/api/auth', authRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/deals', dealsRoutes);
app.use('/api/packages', packagesRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/users', usersRoutes);

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
  }
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
