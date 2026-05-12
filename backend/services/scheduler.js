const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { sendEmail } = require('./gmail');
const {
  getProfessorsDueForOutreach,
  updateProfessor,
  logEmail,
  listTemplates,
  listApplications,
  updateApplication
} = require('./sheets');

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

function getUploadDir() {
  return path.join(__dirname, '../uploads');
}

function findCvPath() {
  const dir = getUploadDir();
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  // Prefer files with "cv" or "resume" in the name
  const preferred = files.find(f => /cv|resume|curriculum/i.test(f));
  return preferred ? path.join(dir, preferred) : null;
}

async function runOutreachBatch() {
  console.log('[Scheduler] Running professor outreach batch...');

  let professors;
  let templates;

  try {
    [professors, templates] = await Promise.all([
      getProfessorsDueForOutreach(),
      listTemplates()
    ]);
  } catch (err) {
    console.error('[Scheduler] Failed to load data from Sheets:', err.message);
    return;
  }

  if (professors.length === 0) {
    console.log('[Scheduler] No professors due for outreach.');
    return;
  }

  const outreachTemplate = templates.find(t => t.name === 'Professor Outreach');
  if (!outreachTemplate) {
    console.error('[Scheduler] "Professor Outreach" template not found in Sheets.');
    return;
  }

  const batchSize = parseInt(process.env.OUTREACH_BATCH_SIZE || '10', 10);
  const batch = professors.slice(0, batchSize);
  const cvPath = findCvPath();
  const today = new Date().toISOString().slice(0, 10);

  const intervalDays = parseInt(process.env.OUTREACH_INTERVAL_DAYS || '7', 10);
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + intervalDays);
  const nextScheduled = nextDate.toISOString().slice(0, 10);

  let sent = 0;
  let failed = 0;

  for (const prof of batch) {
    const vars = {
      professorName: prof.name,
      institution: prof.institution,
      department: prof.department,
      field: prof.field || 'education and literacy'
    };

    const subject = fillTemplate(outreachTemplate.subject, vars);
    const textBody = fillTemplate(outreachTemplate.body, vars);

    try {
      await sendEmail({
        to: prof.email,
        subject,
        textBody,
        attachmentPaths: cvPath ? [cvPath] : []
      });

      await updateProfessor(prof.id, {
        lastContacted: today,
        nextScheduled,
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

      sent++;
      console.log(`[Scheduler] Sent outreach to ${prof.name} <${prof.email}>`);

      // Small delay to avoid hitting Gmail rate limits
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      failed++;
      console.error(`[Scheduler] Failed to email ${prof.name}: ${err.message}`);

      await logEmail({
        recipientEmail: prof.email,
        recipientName: prof.name,
        subject,
        type: 'Outreach',
        result: `Failed: ${err.message}`,
        relatedId: prof.id
      }).catch(() => {});
    }
  }

  console.log(`[Scheduler] Outreach complete — ${sent} sent, ${failed} failed.`);
}

async function runFollowUpCheck() {
  console.log('[Scheduler] Checking for application follow-ups...');
  let applications;
  try {
    applications = await listApplications();
  } catch (err) {
    console.error('[Scheduler] Could not load applications:', err.message);
    return;
  }

  const today = new Date();
  const due = applications.filter(a => {
    if (!a.followUpDate || a.status === 'Rejected' || a.status === 'Withdrawn') return false;
    return new Date(a.followUpDate) <= today;
  });

  if (due.length > 0) {
    console.log(`[Scheduler] ${due.length} application(s) due for follow-up: ${due.map(a => a.title + ' @ ' + a.institution).join(', ')}`);
    // Mark them so the dashboard shows the alert (the user sends follow-up manually or via the UI)
    for (const app of due) {
      await updateApplication(app.id, { status: app.status === 'Applied' ? 'Follow-Up Due' : app.status })
        .catch(() => {});
    }
  }
}

function initScheduler() {
  const outreachCron = process.env.OUTREACH_CRON || '0 9 * * 1'; // Monday 9am
  const followUpCron = '0 8 * * *'; // Every day at 8am

  if (!cron.validate(outreachCron)) {
    console.warn(`[Scheduler] Invalid OUTREACH_CRON "${outreachCron}", using default.`);
  }

  cron.schedule(outreachCron, () => {
    runOutreachBatch().catch(err => console.error('[Scheduler] Outreach error:', err));
  }, { timezone: 'America/Chicago' });

  cron.schedule(followUpCron, () => {
    runFollowUpCheck().catch(err => console.error('[Scheduler] Follow-up error:', err));
  }, { timezone: 'America/Chicago' });

  console.log(`[Scheduler] Outreach scheduled: "${outreachCron}" (CT)`);
  console.log(`[Scheduler] Follow-up check:   "${followUpCron}" (CT)`);
}

module.exports = { initScheduler, runOutreachBatch };
