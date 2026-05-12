const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./auth');
const { sendEmail } = require('../services/gmail');
const {
  listProfessors, addProfessor, updateProfessor, deleteProfessor,
  getProfessorsDueForOutreach, logEmail, listTemplates
} = require('../services/sheets');
const { runOutreachBatch } = require('../services/scheduler');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.json(await listProfessors());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/due', async (req, res) => {
  try {
    res.json(await getProfessorsDueForOutreach());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const prof = await addProfessor(req.body);
    res.json(prof);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updated = await updateProfessor(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteProfessor(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send outreach email to a single professor
router.post('/:id/email', async (req, res) => {
  try {
    const profs = await listProfessors();
    const prof = profs.find(p => p.id === req.params.id);
    if (!prof) return res.status(404).json({ error: 'Professor not found.' });

    const { subject, body, attachmentNames = [] } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required.' });

    const attachmentPaths = attachmentNames
      .map(name => path.join(UPLOADS_DIR, name))
      .filter(p => fs.existsSync(p));

    await sendEmail({
      to: prof.email,
      subject,
      textBody: body,
      attachmentPaths
    });

    const today = new Date().toISOString().slice(0, 10);
    const intervalDays = parseInt(process.env.OUTREACH_INTERVAL_DAYS || '7', 10);
    const next = new Date();
    next.setDate(next.getDate() + intervalDays);

    await updateProfessor(prof.id, {
      lastContacted: today,
      nextScheduled: next.toISOString().slice(0, 10),
      timesContacted: String((parseInt(prof.timesContacted || '0', 10) + 1))
    });

    await logEmail({
      recipientEmail: prof.email,
      recipientName: prof.name,
      subject,
      type: 'Outreach',
      result: 'Sent',
      relatedId: prof.id
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get prefilled outreach template for a professor
router.get('/:id/template', async (req, res) => {
  try {
    const profs = await listProfessors();
    const prof = profs.find(p => p.id === req.params.id);
    if (!prof) return res.status(404).json({ error: 'Professor not found.' });

    const templates = await listTemplates();
    const tmpl = templates.find(t => t.name === 'Professor Outreach');
    if (!tmpl) return res.status(404).json({ error: 'Outreach template not found.' });

    const vars = {
      professorName: prof.name,
      institution: prof.institution,
      department: prof.department,
      field: prof.field || 'education and literacy'
    };

    const fill = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || `{{${k}}}`);

    res.json({ subject: fill(tmpl.subject), body: fill(tmpl.body) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger the outreach batch (sends to all professors due)
router.post('/run-batch', async (req, res) => {
  try {
    res.json({ ok: true, message: 'Outreach batch started.' });
    runOutreachBatch().catch(err => console.error('Manual batch error:', err));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
