const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});
const bucketName = process.env.S3_BUCKET_NAME;
const publicUrlBase = process.env.S3_PUBLIC_URL;

async function initDb() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      position TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      project TEXT,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS daily_reports (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      date TEXT,
      foreman TEXT,
      project TEXT,
      phase TEXT,
      phase_finish TEXT,
      progress_percent TEXT,
      progress_type TEXT,
      work TEXT,
      plan TEXT,
      weather TEXT,
      issue TEXT,
      extra_materials TEXT,
      notes TEXT,
      mp JSONB DEFAULT '[]',
      materials JSONB DEFAULT '[]',
      images JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS phase TEXT`,
    `ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS phase_finish TEXT`,
    `ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS progress_percent TEXT`,
    `ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS progress_type TEXT`,
    `ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS extra_materials TEXT`,
    `ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS notes TEXT`,
    `CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      original_name TEXT,
      s3_key TEXT,
      content_type TEXT,
      category_id TEXT,
      url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, data_key)
    )`,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      action TEXT,
      entity TEXT,
      entity_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      site_name TEXT,
      item_name TEXT,
      quantity NUMERIC,
      unit TEXT,
      required_date TEXT,
      status TEXT DEFAULT 'รอจัดซื้อ',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'`
  ];
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error('initDb statement failed:', sql, err.message);
    }
  }
}

async function checkS3() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (err) {
    console.error('S3 bucket check failed:', err.message);
    return false;
  }
}

async function logAction({ userId, action, entity, entityId, details }) {
  try {
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [userId, action, entity, entityId, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('logAction error:', err.message);
  }
}

app.get('/api/health', async (req, res) => {
  try {
    const db = await pool.query('SELECT NOW() AS now');
    const s3ok = await checkS3();
    res.json({ status: 'ok', db: db.rows[0].now, s3: s3ok });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/api/sync/:userId', async (req, res) => {
  try {
    const { key, data, action } = req.body;
    const userId = req.params.userId;
    await pool.query(
      'INSERT INTO user_data (user_id, data_key, data, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id, data_key) DO UPDATE SET data = $3, updated_at = NOW()',
      [userId, key, JSON.stringify(data)]
    );
    await logAction({
      userId,
      action: action || 'sync',
      entity: key,
      entityId: userId + ':' + key,
      details: { size: JSON.stringify(data).length }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/:userId', async (req, res) => {
  try {
    const { key } = req.query;
    const userId = req.params.userId;
    if (key) {
      const result = await pool.query('SELECT data FROM user_data WHERE user_id = $1 AND data_key = $2', [userId, key]);
      res.json({ data: result.rows.length ? result.rows[0].data : null });
    } else {
      const result = await pool.query('SELECT data_key, data FROM user_data WHERE user_id = $1', [userId]);
      const all = {};
      result.rows.forEach((row) => { all[row.data_key] = row.data; });
      res.json({ data: all });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:userId', async (req, res) => {
  try {
    const { limit = 200 } = req.query;
    const result = await pool.query(
      'SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.params.userId, Number(limit)]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { limit = 500 } = req.query;
    const result = await pool.query(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1',
      [Number(limit)]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, position, phone, project, isAdmin } = req.body;
    const id = 'u_' + phone.replace(/\D/g, '') + '_' + Date.now().toString(36).slice(-4);
    const result = await pool.query(
      `INSERT INTO users (id, first_name, last_name, position, phone, project, is_admin)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, firstName, lastName, position, phone, project || '', isAdmin || false]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM daily_reports WHERE user_id = $1 ORDER BY id DESC',
      [req.params.userId]
    );
    res.json({ reports: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reports/:userId', async (req, res) => {
  try {
    const { date, foreman, project, phase, phaseFinish, progressPercent, progressType, work, plan, weather, issue, extraMaterials, notes, mp, materials, images } = req.body;
    const result = await pool.query(
      `INSERT INTO daily_reports
       (user_id, date, foreman, project, phase, phase_finish, progress_percent, progress_type, work, plan, weather, issue, extra_materials, notes, mp, materials, images)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [req.params.userId, date, foreman, project, phase || '', phaseFinish || '', progressPercent || '', progressType || '', work, plan, weather, issue, extraMaterials || '', notes || '', JSON.stringify(mp || []), JSON.stringify(materials || []), JSON.stringify(images || [])]
    );
    await logAction({ userId: req.params.userId, action: 'create', entity: 'daily_report', entityId: String(result.rows[0].id), details: req.body });
    res.json({ report: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pr/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM purchase_requisitions WHERE user_id = $1 ORDER BY id DESC',
      [req.params.userId]
    );
    res.json({ prs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pr/:userId', async (req, res) => {
  try {
    const { siteName, items, requiredDate, status, notes } = req.body;
    const itemList = Array.isArray(items) ? items : [];
    const first = itemList[0] || {};
    const result = await pool.query(
      `INSERT INTO purchase_requisitions (user_id, site_name, item_name, quantity, unit, required_date, status, notes, items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.params.userId, siteName || '', first.itemName || '', Number(first.quantity) || 0, first.unit || '', requiredDate || '', status || 'รอจัดซื้อ', notes || '', JSON.stringify(itemList)]
    );
    await logAction({ userId: req.params.userId, action: 'create', entity: 'purchase_requisition', entityId: String(result.rows[0].id), details: req.body });
    res.json({ pr: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/pr/:userId/:id', async (req, res) => {
  try {
    const { status, items } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (items !== undefined) {
      fields.push(`items = $${idx++}`);
      values.push(JSON.stringify(items));
      const first = (Array.isArray(items) ? items : [])[0] || {};
      fields.push(`item_name = $${idx++}`);
      values.push(first.itemName || '');
      fields.push(`quantity = $${idx++}`);
      values.push(Number(first.quantity) || 0);
      fields.push(`unit = $${idx++}`);
      values.push(first.unit || '');
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id, req.params.userId);
    const result = await pool.query(
      `UPDATE purchase_requisitions SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx++} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    await logAction({ userId: req.params.userId, action: 'update', entity: 'purchase_requisition', entityId: req.params.id, details: req.body });
    res.json({ pr: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pr/:userId/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM purchase_requisitions WHERE id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
    await logAction({ userId: req.params.userId, action: 'delete', entity: 'purchase_requisition', entityId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reports/:userId/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM daily_reports WHERE id = $1 AND user_id = $2', [req.params.id, req.params.userId]);
    await logAction({ userId: req.params.userId, action: 'delete', entity: 'daily_report', entityId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/:userId', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const ext = path.extname(req.file.originalname);
    const key = `${req.params.userId}/${crypto.randomUUID()}${ext}`;
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));
    const url = `${publicUrlBase}/${key}`;
    const result = await pool.query(
      'INSERT INTO files (user_id, original_name, s3_key, content_type, category_id, url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.params.userId, req.file.originalname, key, req.file.mimetype, req.body.categoryId || null, url]
    );
    res.json({ file: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files WHERE user_id = $1 ORDER BY id DESC', [req.params.userId]);
    res.json({ files: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8081;

module.exports = app;

if (require.main === module) {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`WD Construction API running on http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });
} else {
  initDb().catch((err) => {
    console.error('DB init failed (serverless):', err);
  });
}