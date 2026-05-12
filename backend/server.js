require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const professorRoutes = require('./routes/professors');
const materialRoutes = require('./routes/materials');
const emailRoutes = require('./routes/emails');
const { initScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || `http://localhost:${PORT}`,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'tracker-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the tracker frontend
app.get('/tracker', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'tracker.html'));
});

// Serve the main site too
app.use(express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/professors', professorRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/emails', emailRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Start scheduler
initScheduler();

app.listen(PORT, () => {
  console.log(`\n  Tracker backend running at http://localhost:${PORT}`);
  console.log(`  Dashboard at            http://localhost:${PORT}/tracker\n`);
});
