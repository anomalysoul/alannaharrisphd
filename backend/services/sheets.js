const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./gmail');

const SHEET_ID = () => process.env.GOOGLE_SHEETS_ID;

const TABS = {
  APPLICATIONS: 'Applications',
  PROFESSORS: 'Professors',
  EMAIL_LOG: 'Email Log',
  TEMPLATES: 'Templates'
};

// Column definitions
const APP_COLS = ['id','title','institution','location','department','status','dateAdded','dateApplied','deadline','jobUrl','contactEmail','materialsSent','notes','followUpDate'];
const PROF_COLS = ['id','name','title','institution','department','email','field','lastContacted','nextScheduled','timesContacted','status','notes'];
const LOG_COLS  = ['id','date','recipientEmail','recipientName','subject','type','result','relatedId'];
const TMPL_COLS = ['name','subject','body'];

async function getSheets() {
  const auth = await getAuthenticatedClient();
  return google.sheets({ version: 'v4', auth });
}

async function ensureSheets() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const existing = meta.data.sheets.map(s => s.properties.title);

  const needed = Object.values(TABS).filter(t => !existing.includes(t));
  if (needed.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: {
      requests: needed.map(title => ({
        addSheet: { properties: { title } }
      }))
    }
  });

  // Write headers
  const headerMap = {
    [TABS.APPLICATIONS]: APP_COLS,
    [TABS.PROFESSORS]:   PROF_COLS,
    [TABS.EMAIL_LOG]:    LOG_COLS,
    [TABS.TEMPLATES]:    TMPL_COLS
  };

  for (const tab of needed) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID(),
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headerMap[tab]] }
    });
  }

  // Seed default email templates
  if (needed.includes(TABS.TEMPLATES)) {
    await seedTemplates(sheets);
  }
}

async function seedTemplates(sheets) {
  const defaults = [
    {
      name: 'Professor Outreach',
      subject: 'Inquiry Regarding Teaching Opportunities — Dr. Alanna Harris',
      body: `Dear Professor {{professorName}},

I hope this message finds you well. My name is Dr. Alanna Harris, and I am an equity-centered educator, literacy scholar, and qualitative researcher specializing in literacy leadership, writing instruction, and teacher professional development. I recently came across your work in {{field}} at {{institution}}, and I was deeply impressed by your contributions to the field.

I am currently exploring teaching opportunities at institutions where my expertise in literacy education, writing pedagogy, and equity-centered practice would complement existing programs. I would be honored to discuss any openings in your department — whether tenure-track positions, visiting faculty roles, or adjunct opportunities — and to explore how my background might serve your students and colleagues.

I have attached my CV for your review. My research and teaching bridge literacy leadership, culturally responsive writing instruction, and professional development for educators — areas I believe align closely with the work being done at {{institution}}.

I would welcome the opportunity to connect at your convenience. Thank you for your time and consideration.

Warm regards,
Dr. Alanna Harris, Ph.D.
Equity-Centered Educator · Literacy Leader · Speaker
Milwaukee, WI
www.alannaharrisphd.com`
    },
    {
      name: 'Job Application',
      subject: 'Application for {{positionTitle}} — Dr. Alanna Harris',
      body: `Dear Hiring Committee,

I am writing to express my strong interest in the {{positionTitle}} position at {{institution}}. As an equity-centered educator with a Ph.D. and extensive experience in literacy leadership, writing instruction, and qualitative research, I am confident that my background aligns well with the goals of your department.

In my work, I have consistently centered equity and access in both research and teaching, developing transformative learning experiences for students across diverse educational contexts. My scholarship focuses on literacy leadership and culturally responsive pedagogy — areas I believe are central to the mission at {{institution}}.

Please find my CV and supporting materials attached. I would welcome the opportunity to discuss how I can contribute to your program.

Thank you for your consideration.

Sincerely,
Dr. Alanna Harris, Ph.D.
Equity-Centered Educator · Literacy Leader · Speaker
Milwaukee, WI
www.alannaharrisphd.com`
    },
    {
      name: 'Follow-Up',
      subject: 'Following Up — {{positionTitle}} Application — Dr. Alanna Harris',
      body: `Dear {{contactName}},

I wanted to follow up on my application for the {{positionTitle}} position submitted on {{dateApplied}}. I remain very enthusiastic about this opportunity and the work being done at {{institution}}.

Please let me know if you need any additional materials or have questions. I look forward to hearing from you.

Warm regards,
Dr. Alanna Harris, Ph.D.
www.alannaharrisphd.com`
    }
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${TABS.TEMPLATES}!A2`,
    valueInputOption: 'RAW',
    requestBody: { values: defaults.map(t => [t.name, t.subject, t.body]) }
  });
}

// ── Generic row helpers ──────────────────────────────────────────────────────

function rowToObj(cols, row) {
  const obj = {};
  cols.forEach((col, i) => { obj[col] = row[i] || ''; });
  return obj;
}

function objToRow(cols, obj) {
  return cols.map(col => obj[col] !== undefined ? String(obj[col]) : '');
}

async function readRows(tab) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A2:ZZ`
  });
  return res.data.values || [];
}

async function appendRow(tab, cols, obj) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [objToRow(cols, obj)] }
  });
}

async function updateRow(tab, cols, id, updates) {
  const sheets = await getSheets();
  const rows = await readRows(tab);
  const idx = rows.findIndex(r => r[0] === id);
  if (idx === -1) throw new Error(`Row ${id} not found in ${tab}`);

  const existing = rowToObj(cols, rows[idx]);
  const updated = { ...existing, ...updates };
  const rowNum = idx + 2; // +1 for header, +1 for 1-based

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${tab}!A${rowNum}`,
    valueInputOption: 'RAW',
    requestBody: { values: [objToRow(cols, updated)] }
  });

  return updated;
}

async function deleteRow(tab, id) {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const sheetMeta = meta.data.sheets.find(s => s.properties.title === tab);
  if (!sheetMeta) throw new Error(`Sheet ${tab} not found`);
  const sheetId = sheetMeta.properties.sheetId;

  const rows = await readRows(tab);
  const idx = rows.findIndex(r => r[0] === id);
  if (idx === -1) throw new Error(`Row ${id} not found`);

  const rowNum = idx + 1; // 0-based, but header is row 0

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNum,
            endIndex: rowNum + 1
          }
        }
      }]
    }
  });
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Applications ─────────────────────────────────────────────────────────────

async function listApplications() {
  const rows = await readRows(TABS.APPLICATIONS);
  return rows.map(r => rowToObj(APP_COLS, r));
}

async function addApplication(data) {
  const obj = {
    id: makeId(),
    dateAdded: new Date().toISOString().slice(0, 10),
    status: 'Saved',
    timesContacted: '0',
    ...data
  };
  await appendRow(TABS.APPLICATIONS, APP_COLS, obj);
  return obj;
}

async function updateApplication(id, updates) {
  return updateRow(TABS.APPLICATIONS, APP_COLS, id, updates);
}

async function deleteApplication(id) {
  return deleteRow(TABS.APPLICATIONS, id);
}

// ── Professors ────────────────────────────────────────────────────────────────

async function listProfessors() {
  const rows = await readRows(TABS.PROFESSORS);
  return rows.map(r => rowToObj(PROF_COLS, r));
}

async function addProfessor(data) {
  const obj = {
    id: makeId(),
    timesContacted: '0',
    status: 'Active',
    lastContacted: '',
    nextScheduled: new Date().toISOString().slice(0, 10),
    ...data
  };
  await appendRow(TABS.PROFESSORS, PROF_COLS, obj);
  return obj;
}

async function updateProfessor(id, updates) {
  return updateRow(TABS.PROFESSORS, PROF_COLS, id, updates);
}

async function deleteProfessor(id) {
  return deleteRow(TABS.PROFESSORS, id);
}

async function getProfessorsDueForOutreach() {
  const profs = await listProfessors();
  const intervalDays = parseInt(process.env.OUTREACH_INTERVAL_DAYS || '7', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - intervalDays);

  return profs.filter(p => {
    if (p.status !== 'Active') return false;
    if (!p.email) return false;
    if (!p.lastContacted) return true;
    return new Date(p.lastContacted) <= cutoff;
  });
}

// ── Email Log ─────────────────────────────────────────────────────────────────

async function logEmail(data) {
  const obj = {
    id: makeId(),
    date: new Date().toISOString(),
    result: 'Sent',
    ...data
  };
  await appendRow(TABS.EMAIL_LOG, LOG_COLS, obj);
  return obj;
}

async function listEmailLog() {
  const rows = await readRows(TABS.EMAIL_LOG);
  return rows.map(r => rowToObj(LOG_COLS, r));
}

// ── Templates ─────────────────────────────────────────────────────────────────

async function listTemplates() {
  const rows = await readRows(TABS.TEMPLATES);
  return rows.map(r => rowToObj(TMPL_COLS, r));
}

async function upsertTemplate(name, subject, body) {
  const sheets = await getSheets();
  const rows = await readRows(TABS.TEMPLATES);
  const idx = rows.findIndex(r => r[0] === name);

  if (idx === -1) {
    await appendRow(TABS.TEMPLATES, TMPL_COLS, { name, subject, body });
  } else {
    const rowNum = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID(),
      range: `${TABS.TEMPLATES}!A${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[name, subject, body]] }
    });
  }
}

module.exports = {
  ensureSheets,
  listApplications, addApplication, updateApplication, deleteApplication,
  listProfessors, addProfessor, updateProfessor, deleteProfessor, getProfessorsDueForOutreach,
  logEmail, listEmailLog,
  listTemplates, upsertTemplate
};
