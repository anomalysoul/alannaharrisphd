const router = require('express').Router();
const { getAuthUrl, exchangeCode, isGmailAuthenticated, ensureSheets } = require('../services/gmail');
const { ensureSheets: initSheets } = require('../services/sheets');

// ── Dashboard login ────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.DASHBOARD_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Incorrect password.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  res.json({
    loggedIn: !!req.session.authenticated,
    gmailConnected: isGmailAuthenticated(),
    sheetsConfigured: !!process.env.GOOGLE_SHEETS_ID
  });
});

// ── Gmail OAuth2 ───────────────────────────────────────────────────────────────

router.get('/google', requireAuth, (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/tracker?gmailError=' + encodeURIComponent(error));
  if (!code) return res.redirect('/tracker?gmailError=no_code');

  try {
    await exchangeCode(code);
    // Init Google Sheets tabs on first connect
    await initSheets().catch(err => console.warn('Sheets init warning:', err.message));
    res.redirect('/tracker?gmailConnected=1');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/tracker?gmailError=' + encodeURIComponent(err.message));
  }
});

// ── Middleware ─────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.authenticated) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
