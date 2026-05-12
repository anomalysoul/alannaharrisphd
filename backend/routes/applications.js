const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./auth');
const { sendEmail } = require('../services/gmail');
const {
  listApplications, addApplication, updateApplication, deleteApplication,
  logEmail, listTemplates
} = require('../services/sheets');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.json(await listApplications());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const app = await addApplication(req.body);
    res.json(app);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await updateApplication(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteApplication(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send application email with attachments
router.post('/:id/apply', async (req, res) => {
  try {
    const { to, subject, body, attachmentNames = [] } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required.' });
    }

    const attachmentPaths = attachmentNames
      .map(name => path.join(UPLOADS_DIR, name))
      .filter(p => fs.existsSync(p));

    await sendEmail({ to, subject, textBody: body, attachmentPaths });

    await updateApplication(req.params.id, {
      status: 'Applied',
      dateApplied: new Date().toISOString().slice(0, 10),
      materialsSent: attachmentNames.join(', ')
    });

    await logEmail({
      recipientEmail: to,
      subject,
      type: 'Application',
      result: 'Sent',
      relatedId: req.params.id
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get template preview filled with application data
router.get('/:id/template', async (req, res) => {
  try {
    const apps = await listApplications();
    const app = apps.find(a => a.id === req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found.' });

    const templates = await listTemplates();
    const tmpl = templates.find(t => t.name === (req.query.templateName || 'Job Application'));
    if (!tmpl) return res.status(404).json({ error: 'Template not found.' });

    const fill = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => app[k] || `{{${k}}}`);

    res.json({
      subject: fill(tmpl.subject).replace('{{positionTitle}}', app.title).replace('{{institution}}', app.institution),
      body: fill(tmpl.body)
        .replace(/\{\{positionTitle\}\}/g, app.title)
        .replace(/\{\{institution\}\}/g, app.institution)
        .replace(/\{\{dateApplied\}\}/g, app.dateApplied || '')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
