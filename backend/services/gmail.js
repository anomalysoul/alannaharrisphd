const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '../.gmail-tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = makeOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

async function exchangeCode(code) {
  const client = makeOAuth2Client();
  const { tokens } = await client.getToken(code);
  saveTokens(tokens);
  return tokens;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function isGmailAuthenticated() {
  return fs.existsSync(TOKENS_FILE);
}

async function getAuthenticatedClient() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Gmail not connected. Please authenticate via Settings.');

  const client = makeOAuth2Client();
  client.setCredentials(tokens);

  client.on('tokens', (updated) => {
    const merged = { ...tokens, ...updated };
    saveTokens(merged);
  });

  return client;
}

function buildRawMessage({ to, subject, textBody, htmlBody, attachments = [], fromName }) {
  const boundary = `==tracker_${Date.now()}==`;
  const from = fromName
    ? `"${fromName}" <${process.env.GMAIL_USER_EMAIL}>`
    : process.env.GMAIL_USER_EMAIL;

  const hasAttachments = attachments.length > 0;
  const isMultipart = hasAttachments || htmlBody;

  let msg = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\n`;

  if (!isMultipart) {
    msg += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${textBody}`;
  } else {
    msg += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    msg += `--${boundary}\r\n`;

    if (htmlBody) {
      const innerBoundary = `==inner_${Date.now()}==`;
      msg += `Content-Type: multipart/alternative; boundary="${innerBoundary}"\r\n\r\n`;
      msg += `--${innerBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${textBody}\r\n\r\n`;
      msg += `--${innerBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${htmlBody}\r\n\r\n`;
      msg += `--${innerBoundary}--\r\n`;
    } else {
      msg += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${textBody}\r\n`;
    }

    for (const att of attachments) {
      msg += `\r\n--${boundary}\r\n`;
      msg += `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n`;
      msg += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
      msg += `Content-Transfer-Encoding: base64\r\n\r\n`;
      msg += att.data + '\r\n';
    }

    msg += `\r\n--${boundary}--`;
  }

  return Buffer.from(msg).toString('base64url');
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  return map[ext] || 'application/octet-stream';
}

async function sendEmail({ to, subject, textBody, htmlBody, attachmentPaths = [], fromName }) {
  const auth = await getAuthenticatedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const attachments = attachmentPaths
    .filter(p => fs.existsSync(p))
    .map(p => ({
      filename: path.basename(p),
      data: fs.readFileSync(p).toString('base64'),
      mimeType: getMimeType(p)
    }));

  const raw = buildRawMessage({
    to,
    subject,
    textBody: textBody || '',
    htmlBody,
    attachments,
    fromName: fromName || process.env.EMAIL_FROM_NAME
  });

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });

  return result.data;
}

module.exports = { getAuthUrl, exchangeCode, isGmailAuthenticated, getAuthenticatedClient, sendEmail, loadTokens };
