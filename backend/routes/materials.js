const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./auth');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Sanitize filename: keep original name but strip dangerous chars
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type "${ext}" not allowed. Accepted: ${allowed.join(', ')}`));
    }
  }
});

router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return res.json([]);
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => f !== '.gitkeep')
      .map(f => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        return {
          name: f,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          url: `/uploads/${encodeURIComponent(f)}`
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided.' });
  res.json({
    name: req.file.filename,
    size: req.file.size,
    url: `/uploads/${encodeURIComponent(req.file.filename)}`
  });
});

router.delete('/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  // Prevent path traversal
  const resolved = path.resolve(UPLOADS_DIR, filename);
  if (!resolved.startsWith(UPLOADS_DIR)) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found.' });
  fs.unlinkSync(resolved);
  res.json({ ok: true });
});

module.exports = router;
