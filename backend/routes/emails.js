const router = require('express').Router();
const { requireAuth } = require('./auth');
const { sendEmail } = require('../services/gmail');
const { listEmailLog, listTemplates, upsertTemplate } = require('../services/sheets');

router.use(requireAuth);

router.get('/log', async (req, res) => {
  try {
    const log = await listEmailLog();
    res.json(log.reverse()); // newest first
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/templates', async (req, res) => {
  try {
    res.json(await listTemplates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/templates/:name', async (req, res) => {
  try {
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body required.' });
    await upsertTemplate(decodeURIComponent(req.params.name), subject, body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a one-off test email to verify Gmail is working
router.post('/test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'to is required.' });
    await sendEmail({
      to,
      subject: 'Test Email — Alanna Harris Tracker',
      textBody: 'If you received this, your Gmail connection is working correctly.\n\n— Alanna Harris Tracker'
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
